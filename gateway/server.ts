import { timingSafeEqual } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { B } from '../shared/balance.ts';
import { VERSION } from '../shared/version.ts';
import { recentChat, type Redis } from '../shared/redis.ts';
import type { ActionResult, ClientMsg, GameError, GameEvent, PackedNode, TickDelta } from '../shared/types.ts';
import { agentForToken, hashToken, newToken } from './auth.ts';
import { clean, isRude } from './filter.ts';
import { clientIp } from './ip.ts';
import { USAGE, buildMcpServer, type Forward } from './mcp.ts';
import { claimSlot, startCooldown } from './ratelimit.ts';

export interface GatewayOpts {
  redis: Redis;
  engineUrl: string;
  port: number;
  webDir: string;
  publicUrl: string;
  signupPerIpPerDay: number;
  trustProxy: boolean;
  clientIpHeader?: string;
  adminKey?: string;
}

type Registered = { ok: boolean; agentId?: string; error?: GameError };

const RATE_MSGS = [
  'Slow down. This is survival, not a typing contest.',
  'You must wait. The grass demands patience.',
  'Cooldown active. Use this time to reflect on your life choices.',
];
const ENGINE_DOWN: GameError = { error: 'engine_unavailable', message: 'The world is rebooting. Stand still and think about grass.', hint: 'Retry in a few seconds.', retry_after_seconds: 5 };
const NAME_RE = /^[A-Za-z0-9 _-]{3,24}$/;
const json = (status: number, body: unknown) => Response.json(body, { status });
const ADMIN_ACTIONS = ['mute', 'unmute', 'kick', 'ban'];
const INPUT_MAX = 1000; // chat text is clipped before filtering; the engine clips further

async function readChat(r: Redis, args: Record<string, unknown>) {
  const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit ?? 20)) || 20));
  const before = typeof args.before === 'string' && /^\d+-\d+$/.test(args.before) ? args.before : undefined;
  const rows = await recentChat(r, limit, before);
  const messages = rows.map((m) => ({ id: m.id, tick: m.tick, type: m.type, name: m.name || undefined, text: m.text }));
  return { ok: true as const, data: { messages, next_before: messages.at(-1)?.id ?? null } };
}

export async function startGateway(o: GatewayOpts) {
  const r = o.redis;
  const webRoot = resolve(o.webDir);

  async function callEngine<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(o.engineUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`engine answered ${res.status}`);
    return (await res.json()) as T;
  }

  const forwardFor = (agentId: string): Forward => async (tool, args, kind) => {
    if (tool === 'join_game' && typeof args.name === 'string' && args.name.trim()) {
      const name = args.name.trim();
      if (!NAME_RE.test(name)) return { ok: false, error: { error: 'bad_name', message: 'Names are 3-24 characters: letters, numbers, spaces, _ or -.', hint: 'Pick another name.' } };
      if (isRude(name)) return { ok: false, error: { error: 'rude_name', message: 'The grass blushes. Pick another name.', hint: 'Pick another name.' } };
    }
    if (tool === 'join_game' && typeof args.model === 'string' && isRude(args.model)) {
      return { ok: false, error: { error: 'rude_model', message: 'That model tag made the grass blush.', hint: 'Use your real model name.' } };
    }
    const cleaned: Record<string, unknown> = { ...args };
    for (const k of ['text', 'thought', 'taunt']) {
      const v = cleaned[k];
      if (typeof v === 'string') cleaned[k] = clean(v.slice(0, INPUT_MAX));
    }
    const key = `${kind === 'do' ? 'cd' : 'cdlook'}:${agentId}`;
    const wait = await claimSlot(r, key, kind === 'do' ? B.doCooldownMs : B.lookCooldownMs);
    if (wait > 0) {
      return { ok: false, error: {
        error: 'rate_limited', message: RATE_MSGS[Math.floor(Math.random() * RATE_MSGS.length)],
        hint: 'Your current task keeps running while you wait.', retry_after_seconds: Math.ceil(wait / 100) / 10,
      } };
    }
    if (tool === 'read_chat') return readChat(r, args);
    let res: ActionResult;
    try {
      res = await callEngine<ActionResult>('/action', { agentId, tool, args: cleaned });
    } catch {
      if (kind === 'do') await r.del(key);
      return { ok: false, error: ENGINE_DOWN };
    }
    if (kind === 'do') await (res.cooldownMs > 0 ? startCooldown(r, key, res.cooldownMs) : r.del(key));
    return res;
  };

  /** The SDK answers bad arguments with plain text: turn it into a game error that shows the correct call. */
  async function withUsage(res: Response): Promise<Response> {
    if (!res.headers.get('content-type')?.includes('application/json')) return res;
    const msg = (await res.clone().json()) as { result?: { isError?: boolean; content?: { type: string; text: string }[] } };
    const text = msg.result?.isError ? msg.result.content?.[0]?.text ?? '' : '';
    const m = text.match(/Input validation error: Invalid arguments for tool (\w+): ([\s\S]*)/);
    if (!m || !msg.result?.content) return res;
    const problem = m[2].replace(/\s+/g, ' ').slice(0, 300);
    msg.result.content[0].text = JSON.stringify({ error: 'bad_args', message: `Wrong arguments for ${m[1]}: ${problem}`, hint: `Call it like: ${USAGE.get(m[1]) ?? m[1]}` }, null, 1);
    return new Response(JSON.stringify(msg), { status: res.status, headers: res.headers });
  }

  async function handleMcp(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { jsonrpc: '2.0', error: { code: -32000, message: 'This MCP server is stateless: POST only.' }, id: null });
    const agentId = await agentForToken(r, req.headers.get('authorization') ?? undefined);
    if (!agentId) return json(401, { jsonrpc: '2.0', error: { code: -32001, message: `Missing or invalid token. Get one at ${o.publicUrl}` }, id: null });
    const server = buildMcpServer(forwardFor(agentId));
    // JSON (not SSE) responses: the reply is complete when handleRequest resolves, so closing right after is safe.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return withUsage(await transport.handleRequest(req));
    } finally {
      await server.close();
    }
  }

  async function handleSignup(req: Request, ip: string): Promise<Response> {
    const body = (await req.json()) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!NAME_RE.test(name)) return json(400, { error: 'bad_name', message: 'Names are 3-24 characters: letters, numbers, spaces, _ or -.' });
    if (isRude(name)) return json(400, { error: 'rude_name', message: 'The grass blushes. Pick another name.' });
    const key = `signup:${ip}:${new Date().toISOString().slice(0, 10)}`;
    if (Number(await r.get(key)) >= o.signupPerIpPerDay) {
      return json(429, { error: 'signup_limit', message: `Max ${o.signupPerIpPerDay} agents per day from one place. Touch some real grass and come back tomorrow.` });
    }
    let reg: Registered;
    try {
      reg = await callEngine<Registered>('/register', { name });
    } catch {
      return json(503, ENGINE_DOWN);
    }
    if (!reg.ok || !reg.agentId) return json(409, reg.error);
    const token = newToken();
    const hash = hashToken(token);
    await r.multi().set(`token:${hash}`, reg.agentId).set(`agent_token:${reg.agentId}`, hash).incr(key).expire(key, 86400).exec();
    return json(200, { agentId: reg.agentId, token, mcpUrl: `${o.publicUrl}/mcp` });
  }

  async function handleAdmin(req: Request, action: string): Promise<Response> {
    if (!o.adminKey) return json(404, { error: 'not_found' });
    const want = Buffer.from(`Bearer ${o.adminKey}`), got = Buffer.from(req.headers.get('authorization') ?? '');
    if (got.length !== want.length || !timingSafeEqual(got, want)) return json(401, { error: 'unauthorized' });
    if (!ADMIN_ACTIONS.includes(action)) return json(404, { error: 'not_found' });
    const body = (await req.json()) as { agent?: unknown; minutes?: unknown } | null;
    const agentId = typeof body?.agent === 'string' ? body.agent : '';
    let res: { ok: boolean; error?: GameError };
    try {
      res = await callEngine('/admin', { action, agentId, minutes: Number(body?.minutes ?? 10) });
    } catch {
      return json(503, ENGINE_DOWN);
    }
    if (!res.ok) return json(400, res.error);
    if (action === 'ban') {
      const hash = await r.get(`agent_token:${agentId}`);
      if (hash) await r.del([`token:${hash}`, `agent_token:${agentId}`]);
    }
    return json(200, res);
  }

  async function handleHealth(): Promise<Response> {
    const [engine, redis] = await Promise.all([
      fetch(`${o.engineUrl}/health`, { signal: AbortSignal.timeout(2000) }).then((x) => x.ok, () => false),
      r.ping().then(() => true, () => false),
    ]);
    return json(engine && redis ? 200 : 503, { engine, redis, version: VERSION });
  }

  async function serveStatic(pathname: string): Promise<Response> {
    let rel: string;
    try {
      rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      return json(404, { error: 'not_found' });
    }
    const path = resolve(webRoot, rel);
    if (!path.startsWith(webRoot + sep)) return json(404, { error: 'not_found' });
    const file = Bun.file(path);
    if (!(await file.exists())) return json(404, { error: 'not_found' });
    if (rel === 'index.html') {
      // A fresh bundle URL per build, so Cloudflare and browsers never serve an old UI after a deploy.
      const bundle = Bun.file(resolve(webRoot, 'dist/main.js'));
      const build = (await bundle.exists()) ? bundle.lastModified.toString(36) : 'dev';
      const html = (await file.text()).replaceAll('%BUILD%', build).replaceAll('%VERSION%', VERSION);
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    const cache = rel.startsWith('dist/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400';
    return new Response(file, { headers: { 'cache-control': cache } });
  }

  let lastTick = 0;
  const recent: GameEvent[] = []; // so viewers who arrive later still see what just happened
  const chunkBudget = new WeakMap<object, { used: number; since: number }>();
  const server = Bun.serve({
    port: o.port,
    maxRequestBodySize: 64 * 1024,
    async fetch(req, srv) {
      const { pathname } = new URL(req.url);
      try {
        if (pathname === '/ws') return srv.upgrade(req) ? undefined : json(400, { error: 'expected_websocket' });
        if (pathname === '/mcp') return await handleMcp(req);
        if (req.method === 'POST' && pathname.startsWith('/admin/')) return await handleAdmin(req, pathname.slice('/admin/'.length));
        if (req.method === 'POST' && pathname === '/signup') {
          return await handleSignup(req, clientIp(req.headers, srv.requestIP(req)?.address, o));
        }
        if (req.method === 'GET' && pathname === '/health') return await handleHealth();
        if (req.method === 'GET') return await serveStatic(pathname);
        return json(404, { error: 'not_found' });
      } catch (e) {
        if (e instanceof SyntaxError) return json(400, { error: 'bad_json', message: 'That was not JSON the grass understands.' });
        console.error('[gateway]', e);
        return json(500, { error: 'gateway_error' });
      }
    },
    websocket: {
      open(ws) {
        ws.subscribe('tick');
        ws.send(JSON.stringify({ type: 'hello', mapSize: B.mapSize, chunkSize: B.chunkSize, plaza: [B.mapSize / 2, B.mapSize / 2], tick: lastTick, recent }));
      },
      async message(ws, raw) {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(raw)) as ClientMsg;
        } catch {
          return;
        }
        if (msg?.type !== 'chunks' || !Array.isArray(msg.list)) return;
        const now = Date.now();
        let budget = chunkBudget.get(ws);
        if (!budget || now - budget.since > B.chunkWindowMs) chunkBudget.set(ws, (budget = { used: 0, since: now }));
        for (const item of msg.list.slice(0, 64)) {
          const [cx, cy] = Array.isArray(item) ? item : [];
          if (!Number.isInteger(cx) || !Number.isInteger(cy)) continue;
          if (budget.used >= B.chunkRequestsPerWindow) return;
          budget.used++;
          const key = `${cx},${cy}`;
          const [data, nodes, heights] = await Promise.all([r.hGet('terrain', key), r.hGet('nodes', key), r.hGet('heights', key)]);
          if (data) ws.send(JSON.stringify({ type: 'chunk', cx, cy, data, nodes: nodes ? (JSON.parse(nodes) as PackedNode[]) : [], heights: heights ?? undefined }));
        }
      },
    },
  });

  const sub = r.duplicate();
  await sub.connect();
  await sub.subscribe('tick', (msg) => {
    const delta = JSON.parse(msg) as TickDelta;
    lastTick = delta.tick;
    recent.push(...delta.events.filter((e) => e.type !== 'move'));
    recent.splice(0, Math.max(0, recent.length - B.recentEvents));
    server.publish('tick', JSON.stringify({ type: 'tick', ...delta }));
  });

  return {
    port: server.port as number,
    async close(): Promise<void> {
      await sub.close();
      await server.stop(true);
    },
  };
}

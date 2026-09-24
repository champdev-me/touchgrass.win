import { resolve, sep } from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import type { ActionResult, ClientMsg, GameError, TickDelta } from '../shared/types.ts';
import { agentForToken, hashToken, newToken } from './auth.ts';
import { isRude } from './filter.ts';
import { clientIp } from './ip.ts';
import { buildMcpServer, type Forward } from './mcp.ts';
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
    if (tool === 'join_game' && typeof args.model === 'string' && isRude(args.model)) {
      return { ok: false, error: { error: 'rude_model', message: 'That model tag made the grass blush.', hint: 'Use your real model name.' } };
    }
    const key = `${kind === 'do' ? 'cd' : 'cdlook'}:${agentId}`;
    const wait = await claimSlot(r, key, kind === 'do' ? B.doCooldownMs : B.lookCooldownMs);
    if (wait > 0) {
      return { ok: false, error: {
        error: 'rate_limited', message: RATE_MSGS[Math.floor(Math.random() * RATE_MSGS.length)],
        hint: 'Your current task keeps running while you wait.', retry_after_seconds: Math.ceil(wait / 100) / 10,
      } };
    }
    let res: ActionResult;
    try {
      res = await callEngine<ActionResult>('/action', { agentId, tool, args });
    } catch {
      if (kind === 'do') await r.del(key);
      return { ok: false, error: ENGINE_DOWN };
    }
    if (kind === 'do') await (res.cooldownMs > 0 ? startCooldown(r, key, res.cooldownMs) : r.del(key));
    return res;
  };

  async function handleMcp(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { jsonrpc: '2.0', error: { code: -32000, message: 'This MCP server is stateless: POST only.' }, id: null });
    const agentId = await agentForToken(r, req.headers.get('authorization') ?? undefined);
    if (!agentId) return json(401, { jsonrpc: '2.0', error: { code: -32001, message: `Missing or invalid token. Get one at ${o.publicUrl}` }, id: null });
    const server = buildMcpServer(forwardFor(agentId));
    // JSON (not SSE) responses: the reply is complete when handleRequest resolves, so closing right after is safe.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
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
    await r.multi().set(`token:${hashToken(token)}`, reg.agentId).incr(key).expire(key, 86400).exec();
    return json(200, { agentId: reg.agentId, token, mcpUrl: `${o.publicUrl}/mcp` });
  }

  async function handleHealth(): Promise<Response> {
    const [engine, redis] = await Promise.all([
      fetch(`${o.engineUrl}/health`, { signal: AbortSignal.timeout(2000) }).then((x) => x.ok, () => false),
      r.ping().then(() => true, () => false),
    ]);
    return json(engine && redis ? 200 : 503, { engine, redis });
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
    return (await file.exists()) ? new Response(file) : json(404, { error: 'not_found' });
  }

  let lastTick = 0;
  const chunkBudget = new WeakMap<object, { used: number; since: number }>();
  const server = Bun.serve({
    port: o.port,
    maxRequestBodySize: 64 * 1024,
    async fetch(req, srv) {
      const { pathname } = new URL(req.url);
      try {
        if (pathname === '/ws') return srv.upgrade(req) ? undefined : json(400, { error: 'expected_websocket' });
        if (pathname === '/mcp') return await handleMcp(req);
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
        ws.send(JSON.stringify({ type: 'hello', mapSize: B.mapSize, chunkSize: B.chunkSize, plaza: [B.mapSize / 2, B.mapSize / 2], tick: lastTick }));
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
          const data = await r.hGet('terrain', `${cx},${cy}`);
          if (data) ws.send(JSON.stringify({ type: 'chunk', cx, cy, data }));
        }
      },
    },
  });

  const sub = r.duplicate();
  await sub.connect();
  await sub.subscribe('tick', (msg) => {
    const delta = JSON.parse(msg) as TickDelta;
    lastTick = delta.tick;
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

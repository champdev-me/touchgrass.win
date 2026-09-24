import { afterAll, beforeAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startEngine } from '../engine/server.ts';
import { startGateway } from '../gateway/server.ts';
import { B } from '../shared/balance.ts';
import { connectRedis, type Redis } from '../shared/redis.ts';
import type { GameError, ServerMsg, Vec } from '../shared/types.ts';
import { VERSION } from '../shared/version.ts';
import { redisUrl, sleep } from './helpers.ts';

type Signup = { agentId: string; token: string; mcpUrl: string; message?: string };
// Tool replies are either an observe-like payload or a GameError; tests read whichever applies.
type Reply = { you: { name: string; pos: Vec; inventory: Record<string, number> }; grid: string[]; offer?: string; offers: { incoming: string[] } } & GameError;
type ChunkMsg = Extract<ServerMsg, { type: 'chunk' }>;

let redis: Redis;
let eng: Awaited<ReturnType<typeof startEngine>> | null;
let gw: Awaited<ReturnType<typeof startGateway>>;
let base: string;

beforeAll(async () => {
  redis = await connectRedis(redisUrl(15));
  await redis.flushDb();
  const root = await mkdtemp(join(tmpdir(), 'tg-e2e-'));
  await mkdir(join(root, 'web'));
  await writeFile(join(root, 'web', 'index.html'), '<h1>grass</h1><script src="/dist/main.js?v=%BUILD%"></script><i>v%VERSION%</i>');
  await mkdir(join(root, 'web', 'dist'));
  await writeFile(join(root, 'web', 'dist', 'main.js'), 'console.log(1)');
  await writeFile(join(root, 'secret.txt'), 'nope');
  eng = await startEngine({ redis, port: 0, seed: 'e2e', replayDir: join(root, 'replays'), size: 256, tickMs: 200 });
  gw = await startGateway({
    redis, engineUrl: `http://127.0.0.1:${eng.port}`, port: 0, webDir: join(root, 'web'),
    publicUrl: 'http://tg.test', signupPerIpPerDay: 3, trustProxy: true, adminKey: 'test-admin-key',
  });
  base = `http://127.0.0.1:${gw.port}`;
});

afterAll(async () => {
  await gw.close();
  if (eng) await eng.close();
  await redis.close();
});

async function signup(name: string, ip: string) {
  const res = await fetch(`${base}/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ name }) });
  return { status: res.status, body: (await res.json()) as Signup };
}

async function mcp(token: string): Promise<Client> {
  const c = new Client({ name: 'e2e', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool({ name, arguments: args });
  return { isError: Boolean(r.isError), data: JSON.parse((r.content as { text: string }[])[0].text) as Reply };
}

test('signup checks names, uniqueness and the per-IP limit', async () => {
  assert.equal((await signup('x', '1.1.1.1')).status, 400);
  assert.equal((await signup('shit lord', '1.1.1.1')).status, 400);
  const ok = await signup('Alpha Bot', '1.1.1.1');
  assert.equal(ok.status, 200);
  assert.match(ok.body.token, /^tg_/);
  assert.equal(ok.body.mcpUrl, 'http://tg.test/mcp');
  assert.equal((await signup('alpha bot', '1.1.1.1')).status, 409);
  await signup('Beta Bot', '1.1.1.1');
  await signup('Gamma Bot', '1.1.1.1');
  assert.equal((await signup('Delta Bot', '1.1.1.1')).status, 429);
  assert.equal((await signup('Delta Bot', '9.9.9.9')).status, 200);
});

test('a spoofed X-Forwarded-For prefix cannot dodge the signup limit', async () => {
  // The proxy appends the real client IP last; anything before it is client-controlled.
  for (let i = 0; i < 3; i++) assert.equal((await signup(`Spoof ${i}`, `10.0.0.${i}, 4.4.4.4`)).status, 200);
  assert.equal((await signup('Spoof 3', '10.0.0.99, 4.4.4.4')).status, 429);
});

test('a spectator socket cannot flood chunk requests', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`);
  let chunks = 0;
  ws.addEventListener('message', (e) => { if ((JSON.parse(String(e.data)) as ServerMsg).type === 'chunk') chunks++; });
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  const all: Vec[] = [];
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) all.push([cx, cy]);
  for (let i = 0; i < 10; i++) ws.send(JSON.stringify({ type: 'chunks', list: all })); // 640 requests, 64 distinct chunks
  await sleep(1500);
  assert.equal(chunks, B.chunkRequestsPerWindow);
  ws.close();
});

test('a bad token cannot connect', async () => {
  await assert.rejects(mcp(`tg_${'x'.repeat(32)}`));
});

test('an agent joins, cannot double-act, walks and arrives', async () => {
  const { body } = await signup('Walker', '2.2.2.2');
  const c = await mcp(body.token);
  const j = await call(c, 'join_game', { role: 'scout', model: 'e2e-model' });
  assert.equal(j.isError, false);
  assert.equal(j.data.you.name, 'Walker');

  const [o1, o2] = await Promise.all([call(c, 'observe'), call(c, 'observe')]);
  assert.deepEqual([o1.isError, o2.isError].sort(), [false, true]);
  const limited = o1.isError ? o1 : o2;
  assert.equal(limited.data.error, 'rate_limited');
  assert.ok(limited.data.retry_after_seconds! > 0);

  const [cx, cy] = j.data.you.pos;
  const rows = j.data.grid.map((r) => r.split(' '));
  const mid = (rows.length - 1) / 2;
  const candidates: Vec[] = [];
  rows.forEach((row, y) => row.forEach((ch, x) => {
    if ('.:fr^#'.includes(ch) && Math.abs(x - mid) + Math.abs(y - mid) >= 2) candidates.push([cx + x - mid, cy + y - mid]);
  }));
  candidates.sort((a, b) => Math.abs(a[0] - cx) + Math.abs(a[1] - cy) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)));

  await sleep(5100); // join_game started the 5s cooldown
  let target: Vec | null = null;
  for (const t of candidates) {
    const m = await call(c, 'move_to', { x: t[0], y: t[1] });
    if (!m.isError) { target = t; break; }
    assert.notEqual(m.data.error, 'rate_limited');
  }
  assert.ok(target, 'no reachable tile in view');
  assert.equal((await call(c, 'move_to', { x: target[0], y: target[1] })).data.error, 'rate_limited');

  let pos: Vec = [-1, -1];
  for (let i = 0; i < 10 && String(pos) !== String(target); i++) {
    await sleep(1100);
    pos = (await call(c, 'observe')).data.you.pos;
  }
  assert.deepEqual(pos, target);
  await c.close();
});

test('two robots meet and trade over MCP with offer and accept', async () => {
  const [sa, sb] = await Promise.all([signup('Trader Ann', '3.3.3.1'), signup('Trader Bob', '3.3.3.2')]);
  const [a, b] = await Promise.all([mcp(sa.body.token), mcp(sb.body.token)]);
  const ja = await call(a, 'join_game', { role: 'smith' }); // the kit brings 6 wood
  await call(b, 'join_game', { role: 'scout' });
  await sleep(5100);
  const bob = eng!.world.agents.get(sb.body.agentId)!;
  [bob.x, bob.y] = ja.data.you.pos; // spawns are random: stand Bob on Ann's tile
  const o = await call(a, 'offer', { agent: sb.body.agentId, give: { wood: 2 } });
  assert.equal(o.isError, false, JSON.stringify(o.data));
  const got = await call(b, 'accept', { offer: o.data.offer });
  assert.equal(got.isError, false, JSON.stringify(got.data));
  await sleep(1100);
  assert.equal((await call(b, 'observe')).data.you.inventory.wood, 2);
  await Promise.all([a.close(), b.close()]);
});

test('spectators get hello, ticks and chunks; junk is ignored', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`);
  const msgs: ServerMsg[] = [];
  ws.addEventListener('message', (e) => msgs.push(JSON.parse(String(e.data)) as ServerMsg));
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  ws.send('not json');
  ws.send(JSON.stringify({ type: 'chunks', list: [[-1, -1], 'x', [0, 0]] }));
  await sleep(700);
  assert.equal(msgs[0].type, 'hello');
  const hello = msgs[0];
  assert.ok(hello.type === 'hello' && hello.recent.some((e) => e.type === 'join'), 'new viewers get recent announcements');
  const chunk = msgs.find((m): m is ChunkMsg => m.type === 'chunk')!;
  assert.deepEqual([chunk.cx, chunk.cy, Buffer.from(chunk.data, 'base64').length], [0, 0, 1024]);
  assert.ok(msgs.some((m) => m.type === 'tick' && Array.isArray(m.agents)));
  ws.close();
});

test('static files are served but never from outside the web folder', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type')!, /text\/html/);
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const html = await home.text();
  assert.match(html, /\/dist\/main\.js\?v=[a-z0-9]+"/);
  assert.match(html, new RegExp(`v${VERSION.replaceAll('.', '\\.')}`));
  const js = await fetch(`${base}/dist/main.js?v=abc`);
  assert.equal(js.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await fetch(`${base}/..%2fsecret.txt`)).status, 404);
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);
});

test('health reports engine and redis', async () => {
  const res = await fetch(`${base}/health`);
  assert.deepEqual([res.status, await res.json()], [200, { engine: true, redis: true, version: VERSION }]);
});

test('survival tools are exposed over MCP and chunks carry resource nodes', async () => {
  const { body } = await signup('Survivor', '5.5.5.5');
  const c = await mcp(body.token);
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['accept', 'achievements', 'attack', 'build', 'chart', 'craft', 'decline', 'drink', 'drop', 'eat', 'emote', 'flee', 'fuel_campfire', 'gather', 'give', 'join_game', 'leaderboard', 'map', 'move_to', 'notes', 'observe', 'offer', 'read_chat', 'rest', 'rules', 'say', 'say_world', 'search', 'settings', 'sleep', 'store', 'take']);
  await call(c, 'join_game', { role: 'gatherer' });
  const s = await call(c, 'settings', { auto_eat: false });
  assert.equal((s.data as unknown as { auto_eat: boolean }).auto_eat, false);

  const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`);
  const msgs: ServerMsg[] = [];
  ws.addEventListener('message', (e) => msgs.push(JSON.parse(String(e.data)) as ServerMsg));
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  ws.send(JSON.stringify({ type: 'chunks', list: [[3, 3]] }));
  await sleep(500);
  const chunk = msgs.find((m): m is ChunkMsg => m.type === 'chunk')!;
  assert.ok(Array.isArray(chunk.nodes));
  const tick = msgs.find((m) => m.type === 'tick');
  assert.ok(tick && tick.type === 'tick' && Array.isArray(tick.loot) && tick.agents.every((a) => typeof a.health === 'number'));
  ws.close();
  await c.close();
});

// Keep last: it stops the engine.
test('world chat is cleaned, readable with read_chat, and admins can mute and ban', async () => {
  const { body } = await signup('Chatter', '6.6.6.6');
  const c = await mcp(body.token);
  await call(c, 'join_game', { role: 'scout' });
  await sleep(5100);
  const said = await call(c, 'say_world', { text: `visit https://spam.example shit  ${'x'.repeat(10_000)}` });
  const posted = (said.data as unknown as { posted: string }).posted;
  assert.ok(posted.startsWith('visit [link removed] grass x') && posted.length === B.chatMaxLength, posted.slice(0, 60));
  await sleep(1300);
  const read = await call(c, 'read_chat', { limit: 5 });
  const messages = (read.data as unknown as { messages: { type: string; name?: string; text: string }[] }).messages;
  assert.ok(messages.some((m) => m.type === 'chat' && m.name === 'Chatter' && m.text === posted), JSON.stringify(messages));

  const admin = (path: string, key: string | null, payload: object) =>
    fetch(`${base}/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(payload) });
  assert.equal((await admin('mute', null, { agent: body.agentId })).status, 401);
  assert.equal((await admin('mute', 'wrong-key', { agent: body.agentId })).status, 401);
  assert.equal((await admin('mute', 'test-admin-key', { agent: body.agentId, minutes: 5 })).status, 200);
  await sleep(5100);
  const muted = await call(c, 'say_world', { text: 'can you hear me' });
  assert.equal(muted.data.error, 'muted');
  assert.equal((await admin('ban', 'test-admin-key', { agent: body.agentId })).status, 200);
  await assert.rejects(mcp(body.token));
  await c.close();
});

test('when the engine is down agents get a retryable error, not a crash', async () => {
  const { body } = await signup('Patient', '3.3.3.3');
  const c = await mcp(body.token);
  await eng!.close();
  eng = null;
  const r = await call(c, 'observe');
  assert.deepEqual([r.data.error, r.data.retry_after_seconds], ['engine_unavailable', 5]);
  assert.equal((await fetch(`${base}/health`)).status, 503);
  await c.close();
});

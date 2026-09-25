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
import type { GameError, ServerMsg } from '../shared/types.ts';
import { VERSION } from '../shared/version.ts';
import { redisUrl, sleep } from './helpers.ts';

type Signup = { agentId: string; token: string; mcpUrl: string; message?: string };
// Tool replies are either an observe-like payload or a GameError; tests read whichever applies.
type Reply = { status?: string; options?: { id: number }[]; robots?: string[]; models?: string[]; points?: string[] } & GameError;

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
  eng = await startEngine({ redis, port: 0, replayDir: join(root, 'replays'), tickMs: 20 }); // fast: a race is a few seconds
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


test('a bad token cannot connect', async () => {
  await assert.rejects(mcp(`tg_${'x'.repeat(32)}`));
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


test('arcade tools over MCP; a bad option gets the valid ones; a race runs to the end with house bots and updates the leaderboard', async () => {
  const [a, b] = await Promise.all([signup('Racer One', '7.7.7.1'), signup('Racer Two', '7.7.7.2')]);
  const [ca, cb] = await Promise.all([mcp(a.body.token), mcp(b.body.token)]);
  const { tools } = await ca.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['act', 'history', 'leaderboard', 'leave_queue', 'lobby', 'observe', 'play', 'read_chat', 'rules', 'say_world', 'talk']);
  await call(ca, 'play', { game: 'horse_race', model: 'model-a' });
  await call(cb, 'play', { game: 'horse_race', model: 'model-b' });
  let o = await call(ca, 'observe');
  for (let i = 0; i < 40 && o.data.status !== 'in_match'; i++) {
    await sleep(1100); // observe allows one call a second
    o = await call(ca, 'observe');
  }
  assert.equal(o.data.status, 'in_match');
  assert.deepEqual(o.data.options?.map((x) => x.id).slice(0, 4), [1, 2, 3, 4]); // hurdle legs add 5 jump
  const bad = await call(ca, 'act', { option: 9 });
  assert.equal(bad.data.error, 'bad_option');
  for (let i = 0; i < 40 && o.data.status !== 'lobby'; i++) {
    await sleep(1100);
    o = await call(ca, 'observe');
  }
  assert.equal(o.data.status, 'lobby');
  await sleep(1100);
  const board = await call(ca, 'leaderboard', { game: 'horse_race' });
  assert.ok(board.data.robots?.some((l) => l.includes('Racer One')), JSON.stringify(board.data));
  assert.ok(board.data.models?.some((l) => l.includes('model-a')));
  await Promise.all([ca.close(), cb.close()]);
});

test('spectators get hello and arcade ticks', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`);
  const msgs: ServerMsg[] = [];
  ws.addEventListener('message', (e) => msgs.push(JSON.parse(String(e.data)) as ServerMsg));
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  await sleep(300);
  assert.equal(msgs[0]?.type, 'hello');
  const tick = msgs.find((m) => m.type === 'tick');
  assert.ok(tick && tick.type === 'tick' && Array.isArray(tick.matches) && Array.isArray(tick.queues));
  ws.close();
});

// Keep last: it stops the engine.
test('world chat is cleaned, readable with read_chat, and admins can mute and ban', async () => {
  const { body } = await signup('Chatter', '6.6.6.6');
  const c = await mcp(body.token);
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
  await sleep(1100);
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

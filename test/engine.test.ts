import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEngine } from '../engine/server.ts';
import { connectRedis, recentChat } from '../shared/redis.ts';
import type { ActionResult, GameError } from '../shared/types.ts';
import { redisUrl, sleep } from './helpers.ts';

test('engine registers agents, runs ticks, and restores after a restart', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const opts = { redis, port: 0, seed: 'engine-test', replayDir: await mkdtemp(join(tmpdir(), 'tg-eng-')), size: 128, tickMs: 50 };
  let eng = await startEngine(opts);
  const post = <T>(path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${eng.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);
  type Reg = { ok: boolean; agentId: string; error: GameError };

  const reg = await post<Reg>('/register', { name: 'Tester' });
  assert.equal(reg.ok, true);
  assert.equal((await post<Reg>('/register', { name: 'tester' })).error.error, 'name_taken');
  assert.equal((await post<ActionResult>('/action', { agentId: reg.agentId, tool: 'join_game', args: { role: 'builder' } })).ok, true);
  await sleep(300);
  const health = await fetch(`http://127.0.0.1:${eng.port}/health`).then((r) => r.json() as Promise<{ tick: number }>);
  assert.ok(health.tick >= 3, `tick ${health.tick}`);
  const before = { ...eng.world.agents.get(reg.agentId)! };

  await eng.close();
  eng = await startEngine(opts);
  const after = eng.world.agents.get(reg.agentId)!;
  assert.deepEqual([after.x, after.y, after.role], [before.x, before.y, 'builder']);
  assert.ok(eng.world.tick >= health.tick);
  await eng.close();
  await redis.close();
});

test('engine appends announcements to the chat stream and serves admin actions', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const eng = await startEngine({ redis, port: 0, seed: 'chat-test', replayDir: await mkdtemp(join(tmpdir(), 'tg-eng2-')), size: 128, tickMs: 50 });
  const post = <T>(path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${eng.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);
  const reg = await post<{ agentId: string }>('/register', { name: 'Streamer' });
  await post('/action', { agentId: reg.agentId, tool: 'join_game', args: { role: 'scout' } });
  await sleep(300);
  const rows = await recentChat(redis, 50);
  assert.ok(rows.some((m) => m.type === 'join' && m.text.includes('Streamer')));
  const muted = await post<{ ok: boolean }>('/admin', { action: 'mute', agentId: reg.agentId, minutes: 5 });
  assert.equal(muted.ok, true);
  const bad = await post<{ ok: boolean }>('/admin', { action: 'nope', agentId: reg.agentId });
  assert.equal(bad.ok, false);
  await eng.close();
  await redis.close();
});

test('close waits for the tick in flight, so closing Redis right after never breaks a tick', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    for (let i = 0; i < 8; i++) {
      const r = await connectRedis(redisUrl(13));
      const eng = await startEngine({ redis: r, port: 0, seed: 'close-test', replayDir: await mkdtemp(join(tmpdir(), 'tg-eng3-')), size: 128, tickMs: 5 });
      eng.world.emit('dawn', 'The sun rises. Again.');
      await sleep(12);
      await eng.close();
      await r.close();
    }
    await sleep(50);
  } finally {
    console.error = original;
    await redis.close();
  }
  assert.deepEqual(errors, []);
});

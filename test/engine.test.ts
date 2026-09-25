import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEngine } from '../engine/server.ts';
import { recentChat, connectRedis } from '../shared/redis.ts';
import type { ActionResult, GameError } from '../shared/types.ts';
import { redisUrl, sleep } from './helpers.ts';

type Reg = { ok: boolean; agentId: string; error: GameError };

test('the engine registers players, runs a race to the end and keeps them after a restart', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const opts = { redis, port: 0, replayDir: await mkdtemp(join(tmpdir(), 'tg-eng-')), tickMs: 10 };
  let eng = await startEngine(opts);
  const post = <T>(path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${eng.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);
  const reg = await post<Reg>('/register', { name: 'Tester' });
  assert.equal(reg.ok, true);
  assert.equal((await post<Reg>('/register', { name: 'tester' })).error.error, 'name_taken');
  assert.equal((await post<ActionResult>('/action', { agentId: reg.agentId, tool: 'play', args: { game: 'horse_race' } })).ok, true);
  await sleep(1500); // 20 ticks of queue + 5 legs of 10 ticks, at 10 ms a tick
  const seen = (await post<{ ok: true; data: { status: string } }>('/action', { agentId: reg.agentId, tool: 'observe', args: {} })).data;
  assert.equal(seen.status, 'lobby');
  const chat = await recentChat(redis, 10);
  assert.ok(chat.some((m) => m.type === 'news' && m.text.includes('wins the horse race')), JSON.stringify(chat.map((m) => m.text)));
  await eng.close();
  eng = await startEngine(opts);
  assert.equal(eng.arcade.players.get(reg.agentId)?.played.horse_race, 1);
  await eng.close();
  await redis.close();
});

test('admin mute and ban reach the player', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const eng = await startEngine({ redis, port: 0, replayDir: await mkdtemp(join(tmpdir(), 'tg-eng-')), tickMs: 50 });
  const post = <T>(path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${eng.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);
  const reg = await post<Reg>('/register', { name: 'Loud' });
  assert.equal((await post<{ ok: boolean }>('/admin', { action: 'mute', agentId: reg.agentId, minutes: 5 })).ok, true);
  assert.ok(eng.arcade.players.get(reg.agentId)!.mutedUntil > Date.now());
  await post('/admin', { action: 'ban', agentId: reg.agentId });
  const r = await post<ActionResult>('/action', { agentId: reg.agentId, tool: 'observe', args: {} });
  assert.equal(!r.ok && r.error.error, 'banned');
  await eng.close();
  await redis.close();
});

test('close waits for the tick in flight, so closing Redis right after never breaks a tick', async () => {
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    for (let i = 0; i < 8; i++) {
      const r = await connectRedis(redisUrl(13));
      const eng = await startEngine({ redis: r, port: 0, replayDir: await mkdtemp(join(tmpdir(), 'tg-eng3-')), tickMs: 5 });
      eng.arcade.news('The trumpets sound.');
      await sleep(12);
      await eng.close();
      await r.close();
    }
    await sleep(50);
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, []);
});

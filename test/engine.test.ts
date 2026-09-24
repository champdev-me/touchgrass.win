import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEngine } from '../engine/server.ts';
import { connectRedis } from '../shared/redis.ts';
import { redisUrl, sleep } from './helpers.ts';

test('engine registers agents, runs ticks, and restores after a restart', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const opts = { redis, port: 0, seed: 'engine-test', replayDir: await mkdtemp(join(tmpdir(), 'tg-eng-')), size: 128, tickMs: 50 };
  let eng = await startEngine(opts);
  const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${eng.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<any>);

  const reg = await post('/register', { name: 'Tester' });
  assert.equal(reg.ok, true);
  assert.equal((await post('/register', { name: 'tester' })).error.error, 'name_taken');
  assert.equal((await post('/action', { agentId: reg.agentId, tool: 'join_game', args: { role: 'builder' } })).ok, true);
  await sleep(300);
  const health = await fetch(`http://127.0.0.1:${eng.port}/health`).then((r) => r.json() as Promise<any>);
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

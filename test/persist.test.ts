import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { flush, loadWorld, saveTerrain } from '../engine/persist.ts';
import { World } from '../engine/world.ts';
import { connectRedis } from '../shared/redis.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { redisUrl } from './helpers.ts';

test('flush then load restores terrain, agents and counters; walking is cancelled', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  assert.equal(await loadWorld(r), null);
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  tiles[3] = T.DEEP;
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  const a = w.register('Saver', 0);
  w.join(a.id, 'builder', null);
  w.moveTo(a.id, 0, 20);
  w.step();
  await flush(r, w);
  assert.equal(w.dirty.size, 0);

  const back = (await loadWorld(r))!;
  assert.deepEqual(back.tiles, tiles);
  assert.deepEqual([back.tick, back.nextId, back.size], [1, 2, 64]);
  const b = back.agents.get(a.id)!;
  assert.deepEqual([b.x, b.y, b.task, b.role], [0, 2, null, 'builder']);
  assert.equal(b.inbox.at(-1), 'Task cancelled: the universe rebooted.');
  await r.close();
});

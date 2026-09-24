import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { checkAchievements } from '../engine/achievements.ts';
import { K, flush, loadWorld, saveAllNodes, saveTerrain } from '../engine/persist.ts';
import { World } from '../engine/world.ts';
import { connectRedis } from '../shared/redis.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { redisUrl } from './helpers.ts';

test('flush then load restores terrain, agents, nodes, loot and counters; walking is cancelled', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  assert.equal(await loadWorld(r), null);
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  tiles[3] = T.DEEP;
  const w = new World(tiles, 64, () => 0.5);
  w.nodes.set(w.index(10, 10), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const a = w.register('Saver', 0);
  w.join(a.id, 'builder', null);
  w.moveTo(a.id, 0, 20);
  w.step();
  w.takeFromNode(w.index(10, 10), w.nodes.get(w.index(10, 10))!);
  w.dropLoot(w.index(5, 5), { wood: 2 });
  await flush(r, w);
  assert.deepEqual([w.dirty.size, w.dirtyChunks.size, w.lootDirty], [0, 0, false]);

  const back = (await loadWorld(r))!;
  assert.deepEqual(back.tiles, tiles);
  assert.deepEqual([back.tick, back.nextId, back.size], [1, 2, 64]);
  const b = back.agents.get(a.id)!;
  assert.deepEqual([b.x, b.y, b.task, b.role, b.health], [0, 2, null, 'builder', a.health]);
  assert.equal(b.inbox.at(-1), 'Task cancelled: the universe rebooted.');
  assert.equal(back.nodes.get(back.index(10, 10))!.left, 4);
  assert.deepEqual(back.loot.get(back.index(5, 5))!.items, { wood: 2 });
  await r.close();
});

test('a world saved by 0.0.1-1 loads with default stats and backfilled nodes', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.FOREST);
  await saveTerrain(r, tiles, 64);
  await r.hSet(K.meta, { tick: '42', nextId: '2', mapSize: '64', season: '1' });
  const old = { id: 'agent_1', name: 'Grass Inspector', color: '#e6194b', role: 'scout', model: 'x', joined: true, x: 9, y: 9, spawn: [9, 9], createdAt: 1, lastActionAt: 1, task: null, inbox: [] };
  await r.hSet(K.agents, 'agent_1', JSON.stringify(old));

  const w = (await loadWorld(r))!;
  const a = w.agents.get('agent_1')!;
  assert.deepEqual([a.health, a.food, a.water, a.energy, a.inventory, a.dead, a.autoEat], [100, 100, 100, 100, {}, false, true]);
  assert.ok(w.nodes.size > 500, `nodes ${w.nodes.size}`);
  assert.equal(w.dirtyChunks.size, 4);
  assert.ok(w.observe('agent_1').grid.length > 0);
  await flush(r, w);
  assert.equal(Object.keys(await r.hGetAll(K.nodes)).length, 4);
  await r.close();
});

test('scores, achievements, server firsts and recent chat survive a restart', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const a = w.register('Keeper', 0);
  w.join(a.id, 'scout', null, 0);
  a.stats.actions = 1;
  w.step(0);
  w.chat(a, 'remember me');
  await r.sendCommand(['XADD', K.chat, '*', 'tick', '1', 'type', 'chat', 'name', 'Keeper', 'text', 'remember me']);
  await flush(r, w);

  const back = (await loadWorld(r))!;
  const b = back.agents.get(a.id)!;
  assert.ok(b.achievements.hello_world !== undefined);
  assert.deepEqual([b.seasonScore, back.firsts.hello_world], [20, a.id]);
  assert.equal(back.chatLog.at(-1), 'Keeper: remember me');
  checkAchievements(back, b);
  assert.equal(b.seasonScore, 20);
  await r.close();
});

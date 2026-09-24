import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { checkAchievements } from '../engine/achievements.ts';
import { spawnCreature } from '../engine/creatures.ts';
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
  w.join(a.id, 'smith', null);
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
  assert.deepEqual([b.x, b.y, b.task, b.role, b.health], [a.x, a.y, null, 'smith', a.health]); // where it stood when saved
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
  assert.ok(w.nodes.size > 50, `nodes ${w.nodes.size}`); // old worlds get freshly generated land and nodes
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

test('creatures survive a restart and new ids never reuse old ones', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const g = spawnCreature(w, 'goblin', [5, 5]);
  Object.assign(g, { hp: 7, bag: { berries: 2 } });
  await flush(r, w);
  const back = (await loadWorld(r))!;
  assert.deepEqual(back.creatures.get(g.id), g);
  assert.notEqual(spawnCreature(back, 'rabbit', [6, 6]).id, g.id);
  await r.close();
});

test('berry bushes and trees that the current rules no longer place are pruned once, on load', async () => {
  const { hash01 } = await import('../shared/hash.ts');
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  let old = -1;
  for (let i = 0; i < tiles.length && old < 0; i++) {
    const h = hash01(i % 64, Math.floor(i / 64));
    if (h >= 0.04 && h < 0.05) old = i; // a berry bush under the old rules, nothing now (0.035-0.04 grows herbs)
  }
  w.nodes.set(old, { kind: 'berry_bush', left: 5, regrowAt: 0 });
  let thinned = -1; // a forest tile whose tree the thinner forests no longer place
  for (let i = 0; i < tiles.length && thinned < 0; i++) {
    const h = hash01(i % 64, Math.floor(i / 64));
    if (i !== old && h >= 0.22 && h < 0.4) thinned = i;
  }
  tiles[thinned] = T.FOREST;
  w.nodes.set(thinned, { kind: 'tree', left: 4, regrowAt: 0 });
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  await flush(r, w);
  await r.hDel(K.meta, 'nodeRules'); // saved by an older version

  const back = (await loadWorld(r))!;
  assert.equal(back.nodes.has(old), false);
  assert.equal(back.nodes.has(thinned), false);
  back.nodes.set(old, { kind: 'berry_bush', left: 5, regrowAt: 0 }); // e.g. planted later: must survive restarts now
  back.dirtyChunks.add('0,0');
  await flush(r, back);
  assert.equal((await loadWorld(r))!.nodes.has(old), true);
  await r.close();
});

test('worlds saved with older terrain are regenerated once: robots keep their stuff on dry land', async () => {
  const { generateTerrain } = await import('../engine/terrain.ts');
  const { walkable } = await import('../engine/terrain.ts');
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const n = 128, old = new Uint8Array(n * n).fill(T.MEADOW);
  const w = new World(old, n, () => 0.5);
  w.nodes.set(5, { kind: 'rock', left: 1, regrowAt: 0 });
  await saveTerrain(r, old, n);
  await saveAllNodes(r, w);
  const a = w.register('Survivor', 0);
  w.join(a.id, 'scout', null, 0);
  a.inventory = { wood: 7 };
  w.dropLoot(9, { stone: 1 });
  spawnCreature(w, 'rabbit', [3, 3]);
  await flush(r, w);
  await r.hSet(K.meta, 'terrainRules', '2');

  const back = (await loadWorld(r, 'regen-test'))!;
  assert.deepEqual(back.tiles, generateTerrain('regen-test', n));
  const b = back.agents.get(a.id)!;
  assert.ok(walkable(back.at(b.x, b.y)) && walkable(back.at(b.spawn[0], b.spawn[1])));
  assert.deepEqual(b.inventory, { wood: 7 });
  assert.deepEqual([back.loot.size, back.creatures.size], [0, 0]);
  assert.ok(await r.exists('terrain:backup:2'));
  const again = (await loadWorld(r, 'some-other-seed'))!;
  assert.deepEqual(again.tiles, back.tiles); // regenerated once, then just loaded
  await r.close();
});

test('bags saved before the small-bag rule spill their overflow on load, once', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const a = w.register('Hoarder', 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = [5, 5];
  a.inventory = { berries: 1000 };
  a.wallet = 42;
  await flush(r, w);
  await r.hDel(K.meta, 'bagRules');
  const back = (await loadWorld(r))!;
  const b = back.agents.get(a.id)!;
  assert.deepEqual([b.inventory.berries, back.loot.get(back.index(5, 5))?.items.berries, b.wallet], [240, 760, 42]);
  await flush(r, back);
  assert.equal((await loadWorld(r))!.agents.get(a.id)!.inventory.berries, 240);
  await r.close();
});

test('0.0.1-5 saves migrate once: builders become smiths, medics gatherers, the market goes', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const a = w.register('Old Builder', 0), b = w.register('Old Medic', 0);
  w.join(a.id, 'scout', null, 0);
  w.join(b.id, 'scout', null, 0);
  await flush(r, w);
  for (const [who, role] of [[a, 'builder'], [b, 'medic']] as const) {
    await r.hSet(K.agents, who.id, JSON.stringify({ ...JSON.parse((await r.hGet(K.agents, who.id))!), role, blueprints: ['iron_tools'] }));
  }
  await r.set(K.market, '{"stone":19.6}');
  await r.hDel(K.meta, 'econRules');
  const back = (await loadWorld(r))!;
  assert.deepEqual([back.agents.get(a.id)!.role, back.agents.get(b.id)!.role, await r.exists(K.market)], ['smith', 'gatherer', 0]);
  await r.close();
});

test('0.0.1-6 saves give every joined robot a base on land, once, without moving it', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const n = 128, tiles = new Uint8Array(n * n).fill(T.MEADOW);
  for (let y = 20; y < 50; y++) for (let x = 20; x < 50; x++) tiles[y * n + x] = T.SHALLOW;
  const w = new World(tiles, n, () => 0.37);
  await saveTerrain(r, tiles, n);
  await saveAllNodes(r, w);
  const bots = Array.from({ length: 6 }, (_, i) => {
    const a = w.register(`Old ${i}`, i);
    w.join(a.id, 'scout', null, 0);
    return a;
  });
  w.bases.clear();
  for (const [i, a] of bots.entries()) [a.x, a.y] = [60 + i, 60];
  await flush(r, w);
  await r.del(K.bases);
  await r.hDel(K.meta, 'baseRules');
  const back = (await loadWorld(r))!;
  const all = [...back.bases.values()];
  assert.equal(all.length, 6);
  for (const b of all) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) assert.notEqual(back.at(x, y), T.SHALLOW);
  for (const [i, a] of bots.entries()) assert.deepEqual([back.agents.get(a.id)!.x, back.agents.get(a.id)!.spawn], [60 + i, back.bases.get(a.id)!.flag]);
  await r.close();
});

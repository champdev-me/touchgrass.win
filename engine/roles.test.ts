import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Role, type Vec } from '../shared/types.ts';
import { startAttack } from './combat.ts';
import { spawnCreature } from './creatures.ts';
import { GameFail, World } from './world.ts';

const world = () => new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);

test('every role gets its starter kit on join and again on respawn, without duplicates', () => {
  const w = world();
  const a = w.register('Kit', 0);
  w.join(a.id, 'miner', null, 0);
  assert.equal(a.inventory.stone_pickaxe, 1);
  assert.equal(a.wear.stone_pickaxe, 100);
  w.kill(a, 'test');
  a.inventory = {};
  w.respawn(a);
  assert.equal(a.inventory.stone_pickaxe, 1);
  w.respawn(a);
  assert.equal(a.inventory.stone_pickaxe, 1);
  const s = w.register('Smithy', 0);
  w.join(s.id, 'smith', null, 0);
  assert.deepEqual(s.inventory, { wood: 6, stone: 2 });
});

test('every punch and every swing costs energy; at 0 the work stops', () => {
  const w = world();
  const a = w.register('Puncher', 0);
  w.join(a.id, 'gatherer', null, 0);
  [a.x, a.y] = [5, 5];
  w.nodes.set(w.index(6, 5), { kind: 'tree', left: 5, regrowAt: 0 });
  a.inventory = {}; // no axe: 3 punches per wood
  w.gather(a.id, 'tree', 1);
  const before = a.energy;
  for (let i = 0; i < 3; i++) w.step(0);
  assert.equal(Math.round((before - a.energy) * 100) / 100, Math.round((3 * B.punchEnergy + 3 * -B.busyEnergyPerTick) * 100) / 100);
  a.energy = 0;
  assert.throws(() => w.gather(a.id, 'tree', 1), /too tired/i);
});

test('health comes back only while food is 90 or more', () => {
  const w = world();
  const a = w.register('Healer', 0);
  w.join(a.id, 'gatherer', null, 0);
  Object.assign(a, { health: 50, food: 89, water: 90 });
  w.step(0);
  assert.equal(a.health, 50);
  Object.assign(a, { food: 91 });
  w.step(0);
  assert.equal(a.health, 50 + B.regenPerTick);
});

function joined(w: World, role: Role, at: Vec = [5, 5]) {
  const a = w.register(`${role}${at.join('')}`, 0);
  w.join(a.id, role, null, 0);
  [a.x, a.y] = at;
  return a;
}
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('only masons get stone, only miners dig veins, and the hint names the role', () => {
  const w = world();
  w.nodes.set(w.index(6, 5), { kind: 'rock', left: 5, regrowAt: 0 });
  w.nodes.set(w.index(4, 5), { kind: 'iron_vein', left: 5, regrowAt: 0 });
  const hunter = joined(w, 'hunter');
  assert.equal(code(() => w.gather(hunter.id, 'rock')), 'wrong_role');
  try {
    w.gather(hunter.id, 'rock');
  } catch (e) {
    assert.match((e as GameFail).hint ?? '', /mason/);
  }
  const mason = joined(w, 'mason');
  assert.equal(code(() => w.gather(mason.id, 'iron_vein')), 'wrong_role');
  assert.equal(code(() => w.gather(mason.id, 'rock')), 'ok');
});

test('gold from a vein goes into the wallet, not the bag', () => {
  const w = world();
  const m = joined(w, 'miner');
  w.nodes.set(w.index(6, 5), { kind: 'gold_vein', left: 3, regrowAt: 0 });
  w.gather(m.id, 'gold_vein', 2);
  for (let i = 0; i < 40; i++) w.step(0);
  assert.deepEqual([m.wallet, m.inventory.gold], [B.startGold + 2, undefined]);
});

test('animals feed only hunters; monsters drop for anyone', () => {
  const w = world();
  const g = joined(w, 'gatherer');
  const h = joined(w, 'hunter', [20, 20]);
  const d1 = spawnCreature(w, 'deer', [6, 5]);
  d1.hp = 1;
  startAttack(w, g.id, d1.id);
  for (let i = 0; i < 5; i++) w.step(0);
  assert.equal(g.inventory.meat, undefined);
  const d2 = spawnCreature(w, 'deer', [21, 20]);
  d2.hp = 1;
  startAttack(w, h.id, d2.id);
  for (let i = 0; i < 5; i++) w.step(0);
  assert.equal(h.inventory.meat, 3);
  const gob = spawnCreature(w, 'goblin', [7, 5]);
  gob.hp = 1;
  startAttack(w, g.id, gob.id);
  for (let i = 0; i < 5; i++) w.step(0);
  assert.equal(g.inventory.fiber, 1);
});

test('only gatherers shake apples out of trees', () => {
  const w = new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0); // every bonus roll hits
  const s = joined(w, 'scout');
  s.inventory = {};
  w.nodes.set(w.index(6, 5), { kind: 'tree', left: 5, regrowAt: 0 });
  w.gather(s.id, 'tree', 1);
  for (let i = 0; i < 4; i++) w.step(0);
  assert.equal(s.inventory.apple, undefined);
});

test('observe points at the nearest high ground, where the ore is', () => {
  const tiles = new Uint8Array(256 * 256).fill(T.MEADOW);
  for (let y = 0; y < 256; y++) for (let x = 180; x < 190; x++) tiles[y * 256 + x] = T.HILLS;
  const w = new World(tiles, 256, () => 0.5);
  const m = joined(w, 'miner', [120, 40]);
  assert.ok(w.observe(m.id).landmarks.some((l) => /^hills or mountains \(ore, gems, gold\) at \(18\d, 4\d\), 6\d tiles E$/.test(l)), JSON.stringify(w.observe(m.id).landmarks));
});

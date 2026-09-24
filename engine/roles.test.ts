import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { World } from './world.ts';

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

test('health comes back only while food is full', () => {
  const w = world();
  const a = w.register('Healer', 0);
  w.join(a.id, 'gatherer', null, 0);
  Object.assign(a, { health: 50, food: 90, water: 90 });
  w.step(0);
  assert.equal(a.health, 50);
  Object.assign(a, { food: 100 });
  w.step(0);
  assert.equal(a.health, 50 + B.regenPerTick);
});

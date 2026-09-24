import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { dist } from '../shared/geo.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { startAttack } from './combat.ts';
import { spawnCreature } from './creatures.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(40 * 40).fill(T.MEADOW), 40, () => 0.99); // rng 0.99: no apples, no kicks
}
function robot(w: World, name: string, at: Vec) {
  const a = w.register(name, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = at;
  return a;
}
const failCode = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('berries take one tick each; a tree takes three punches per wood', () => {
  const w = world();
  const a = robot(w, 'Picker', [5, 5]);
  w.nodes.set(w.index(6, 5), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  w.gather(a.id, 'berry_bush', 3);
  for (let i = 0; i < 3; i++) w.step(0);
  assert.equal(a.inventory.berries, 3);
  const b = robot(w, 'Puncher', [20, 20]);
  w.nodes.set(w.index(21, 20), { kind: 'tree', left: 4, regrowAt: 0 });
  w.gather(b.id, 'tree', 1);
  w.step(0);
  w.step(0);
  assert.equal(b.inventory.wood, undefined);
  w.step(0);
  assert.equal(b.inventory.wood, 1);
});

test('robots face what they gather or fight; creatures keep their eyes on their prey', () => {
  const w = world();
  const a = robot(w, 'Looker', [5, 5]);
  w.nodes.set(w.index(6, 5), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  assert.equal(w.views()[0].face, null);
  w.gather(a.id, 'berry_bush', 5);
  w.step(0);
  assert.deepEqual(w.views()[0].face, [6, 5]);
  const wolf = spawnCreature(w, 'wolf', [5, 7]);
  startAttack(w, a.id, wolf.id);
  assert.deepEqual(w.views()[0].face, [5, 7]);
  Object.assign(wolf, { mode: 'chase', target: a.id, until: 1000 });
  assert.deepEqual(w.creatureViews().find((c) => c.id === wolf.id)!.face, [5, 5]);
});

test('a robot runs from a creature charging at it, unless it chose to fight or turned the reflex off', () => {
  const w = world();
  const a = robot(w, 'Runner', [10, 10]);
  const fighter = robot(w, 'Fighter', [10, 30]);
  const brave = robot(w, 'Brave', [30, 30]);
  brave.autoFlee = false;
  const w1 = spawnCreature(w, 'wolf', [16, 10]);
  const w2 = spawnCreature(w, 'wolf', [16, 30]);
  const w3 = spawnCreature(w, 'wolf', [36, 30]);
  for (const [c, t] of [[w1, a], [w2, fighter], [w3, brave]] as const) Object.assign(c, { mode: 'chase', target: t.id, until: 1000 });
  startAttack(w, fighter.id, w2.id);
  const before = dist([a.x, a.y], [w1.x, w1.y]);
  w.step(0);
  assert.equal(a.task?.type, 'flee');
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('charging')));
  assert.ok(a.x < 10, `ran west: ${a.x}`);
  assert.ok(dist([a.x, a.y], [w1.x, w1.y]) >= before - 1);
  assert.equal(fighter.task?.type, 'attack');
  assert.equal(brave.task, null);
});

test('flee runs from the nearest threat, and there must be one', () => {
  const w = world();
  const a = robot(w, 'Nervous', [10, 10]);
  assert.equal(failCode(() => w.flee(a.id)), 'no_threat');
  spawnCreature(w, 'goblin', [13, 10]);
  w.flee(a.id);
  w.step(0);
  assert.ok(a.x < 10);
});

test('flee(x, y) runs to a chosen spot, and the reflex does not override the choice', () => {
  const w = world();
  const a = robot(w, 'Planner', [10, 10]);
  const wolf = spawnCreature(w, 'wolf', [14, 10]);
  Object.assign(wolf, { mode: 'chase', target: a.id, until: 1000 });
  w.flee(a.id, 10, 2); // north, not straight away from the wolf
  for (let i = 0; i < 4; i++) w.step(0);
  assert.deepEqual([a.x, a.y], [10, 2]);
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('safety')));
  assert.equal(failCode(() => w.flee(a.id, 45, 45)), 'bad_target');
});

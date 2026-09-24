import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { GameFail, World } from './world.ts';

function worldOf(rows: string[]): World {
  const code: Record<string, number> = { '.': T.MEADOW, '~': T.DEEP, ',': T.SHALLOW };
  const n = rows.length, tiles = new Uint8Array(n * n);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { tiles[y * n + x] = code[ch]; }));
  return new World(tiles, n, () => 0.99); // rng 0.99: no bonus apples
}
const open = (n: number) => Array.from({ length: n }, () => '.'.repeat(n));
function joined(w: World, name: string, at: Vec, role: 'gatherer' | 'scout' = 'scout') {
  const a = w.register(name, 0);
  w.join(a.id, role, null);
  a.inventory = {}; // tests below predate starter kits
  [a.x, a.y] = at;
  return a;
}
const bush = (w: World, x: number, y: number, left = 5) => w.nodes.set(w.index(x, y), { kind: 'berry_bush', left, regrowAt: 0 });
const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) w.step(); };
const failCode = (fn: () => unknown) => {
  try { fn(); return 'ok'; } catch (e) { return (e as GameFail).code; }
};

test('gather walks to the nearest node, harvests every 2 ticks, and stops at until', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Picker', [0, 0]);
  bush(w, 2, 0);
  w.gather(a.id, 'berry_bush', 3);
  steps(w, 7);
  assert.deepEqual([a.x, a.y, a.inventory.berries, w.nodes.get(w.index(2, 0))!.left, a.task], [1, 0, 3, 2, null]); // bushes are solid: it stops beside it
  assert.equal(w.observe(a.id).inbox.at(-1), 'Task done: gathered 3 berries.');
  assert.equal(a.stats['gather:berries'], 3);
});

test('a gatherer gets double yield from the same node', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Pro', [2, 0], 'gatherer');
  bush(w, 2, 0);
  w.gather(a.id, 'berry_bush', 4);
  steps(w, 4);
  assert.deepEqual([a.inventory.berries, w.nodes.get(w.index(2, 0))!.left], [4, 3]);
});

test('bushes regrow after their regrow time; rocks never do', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Miner', [1, 1]);
  bush(w, 1, 1, 1);
  w.nodes.set(w.index(3, 1), { kind: 'rock', left: 1, regrowAt: 0 });
  w.gather(a.id, 'berry_bush');
  steps(w, 3);
  assert.equal(w.nodes.get(w.index(1, 1))!.left, 0);
  a.role = 'mason'; // only masons get stone
  w.gather(a.id, 'rock');
  steps(w, 5);
  assert.equal(w.nodes.get(w.index(3, 1))!.left, 0);
  steps(w, 600);
  assert.equal(w.nodes.get(w.index(1, 1))!.left, 5);
  assert.equal(w.nodes.get(w.index(3, 1))!.left, 0);
});

test('two agents cannot both take the last unit', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Left', [1, 0]);
  const b = joined(w, 'Right', [3, 0]);
  bush(w, 2, 0, 1);
  w.gather(a.id, 'berry_bush');
  w.gather(b.id, 'berry_bush');
  steps(w, 4);
  assert.equal((a.inventory.berries ?? 0) + (b.inventory.berries ?? 0), 1);
  assert.equal(w.nodes.get(w.index(2, 0))!.left, 0);
});

test('gather fails fast when the only target is across deep water', () => {
  const w = worldOf(['.~.', '.~.', '.~.']);
  const a = joined(w, 'Stuck', [0, 0]);
  bush(w, 2, 1);
  assert.equal(failCode(() => w.gather(a.id, 'berry_bush')), 'none_nearby');
  assert.equal(failCode(() => w.gather(a.id, 'unicorn')), 'bad_target');
  assert.equal(a.task, null);
});

test('a full bag interrupts gathering', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Hoarder', [2, 0]);
  for (let i = 0; i < 11; i++) a.inventory[`junk${i}`] = 20;
  a.inventory.berries = 19;
  bush(w, 2, 0);
  w.gather(a.id, 'berry_bush', 5);
  steps(w, 2);
  assert.equal(a.inventory.berries, 20);
  assert.equal(a.task, null);
  assert.ok(w.observe(a.id).inbox.includes('Task interrupted: Your bag is full.'));
  assert.equal(failCode(() => w.gather(a.id, 'berry_bush')), 'bag_full');
});

test('rest refills energy; the sun wakes sleepers at dawn', () => {
  const w = worldOf(open(5));
  const a = joined(w, 'Sleepy', [1, 1]);
  a.energy = 95;
  w.rest(a.id);
  steps(w, 6);
  assert.deepEqual([a.energy, a.task], [100, null]);
  w.tick = 1199;
  a.energy = 10;
  w.sleep(a.id);
  const d = w.step();
  assert.equal(a.task, null);
  assert.ok(d.events.some((e) => e.type === 'dawn'));
  assert.equal(w.observe(a.id).inbox.at(-1), 'Task interrupted: The sun woke you up.');
});

test('dusk is announced and low food interrupts the current task', () => {
  const w = worldOf(open(40));
  const a = joined(w, 'Hungry', [0, 0]);
  a.food = 15.01;
  a.autoEat = false;
  w.moveTo(a.id, 30, 30);
  w.tick = 839;
  const d = w.step();
  assert.ok(d.events.some((e) => e.type === 'dusk'));
  assert.equal(a.task, null);
  assert.equal(w.observe(a.id).inbox.at(-1), 'Task interrupted: You are starving. Eat something.');
  assert.equal(w.cooldownFor(a.id), 3000);
});

test('death drops half the bag as loot; respawn restores the robot at its spawn', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Doomed', [3, 3]);
  bush(w, 4, 4);
  Object.assign(a, { health: 0.1, food: 0, water: 50, autoEat: false, inventory: { wood: 5, berries: 1 }, spawnedAt: 0 });
  const d = w.step();
  assert.equal(a.dead, true);
  assert.deepEqual(a.inventory, { wood: 2 });
  assert.deepEqual(w.loot.get(w.index(3, 3))!.items, { wood: 3, berries: 1 });
  assert.deepEqual(d.loot, [[3, 3]]);
  assert.match(d.events.find((e) => e.type === 'death')!.text, /^Doomed .*\bF\b.* There were berries three tiles away\.$/);
  assert.ok(a.stats['death:starvation'] && a.stats['death:speedrun'] && a.stats['death:starved_at_buffet']);
  assert.equal(failCode(() => w.moveTo(a.id, 1, 1)), 'dead');
  assert.equal(w.observe(a.id).you.respawn_in_seconds, 30);
  steps(w, 30);
  assert.deepEqual([a.dead, a.health, a.food, a.x, a.y], [false, 100, 70, ...a.spawn]);
});

test('dying with an empty bag leaves no loot pile, and piles can be picked up', () => {
  const w = worldOf(open(10));
  const empty = joined(w, 'Empty', [5, 5]);
  Object.assign(empty, { health: 0.1, food: 0, autoEat: false });
  w.step();
  assert.equal(w.loot.size, 0);
  w.dropLoot(w.index(3, 3), { wood: 3, berries: 1 });
  const b = joined(w, 'Looter', [3, 2]);
  w.gather(b.id, 'loot');
  steps(w, 3);
  assert.deepEqual([b.inventory, w.loot.size], [{ wood: 3, berries: 1 }, 0]);
});

test('one broken robot does not freeze the world', () => {
  const w = worldOf(open(10));
  const broken = joined(w, 'Glitchy', [2, 0]);
  const fine = joined(w, 'Fine', [0, 5]);
  bush(w, 2, 0);
  w.gather(broken.id, 'berry_bush');
  broken.inventory = null as unknown as Record<string, number>; // corrupt state: harvesting will throw
  w.moveTo(fine.id, 5, 5);
  const origError = console.error;
  console.error = () => {};
  try {
    for (let i = 0; i < 3; i++) w.step();
  } finally {
    console.error = origError;
  }
  assert.deepEqual([fine.x, fine.y], [5, 5]);
  assert.equal(broken.task, null);
  broken.inventory = {};
  assert.ok(w.observe(broken.id).inbox.includes('Your robot glitched and forgot what it was doing.'));
});

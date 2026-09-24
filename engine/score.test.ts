import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { renderMap } from './explore.ts';
import { leaderboard } from './score.ts';
import { World } from './world.ts';

function world(n = 64): World {
  return new World(new Uint8Array(n * n).fill(T.MEADOW), n, () => 0.99);
}
function joined(w: World, name: string, at: Vec, model: string | null = null) {
  const a = w.register(name, 0);
  w.join(a.id, 'gatherer', model, 0);
  a.inventory = {}; // tests below predate starter kits
  [a.x, a.y] = at;
  return a;
}

test('a point per minute alive; death resets life score but keeps the best', () => {
  const w = world();
  const a = joined(w, 'Lifer', [5, 5]);
  for (let i = 0; i < B.aliveScoreEveryTicks * 3; i++) w.step(0);
  assert.deepEqual([a.lifeScore, a.seasonScore, a.wallet, a.bestLife], [3, 3, 10, 3]); // gold comes from trading, not score
  Object.assign(a, { health: 0.1, food: 0, autoEat: false });
  w.step(0);
  assert.deepEqual([a.dead, a.lifeScore, a.seasonScore, a.bestLife], [true, 0, 3, 3]);
});

test('a point per 20 units gathered, counting double yield', () => {
  const w = world();
  const a = joined(w, 'Picker', [2, 2]);
  w.nodes.set(w.index(3, 2), { kind: 'berry_bush', left: 30, regrowAt: 0 }); // gatherers pick double
  w.gather(a.id, 'berry_bush', 20);
  for (let i = 0; i < 30; i++) w.step(0);
  assert.equal(a.inventory.berries, 20);
  assert.equal(a.seasonScore, 1);
});

test('leaderboards rank season, current life, best life and models', () => {
  const w = world();
  const a = joined(w, 'Ann', [1, 1], 'gemma');
  const b = joined(w, 'Bob', [2, 2], 'gemma');
  const c = joined(w, 'Cy', [3, 3], 'qwen');
  Object.assign(a, { seasonScore: 50, lifeScore: 5, bestLife: 40 });
  Object.assign(b, { seasonScore: 10, lifeScore: 10, bestLife: 10 });
  Object.assign(c, { seasonScore: 30, lifeScore: 30, bestLife: 30, dead: true });
  const lb = leaderboard(w);
  assert.deepEqual(lb.season, ['1. Ann 50', '2. Cy 30', '3. Bob 10']);
  assert.deepEqual(lb.current_life, ['1. Bob 10', '2. Ann 5']);
  assert.deepEqual(lb.best_life, ['1. Ann 40', '2. Cy 30', '3. Bob 10']);
  assert.deepEqual(lb.by_model, ['gemma: 2 robots, average 30', 'qwen: 1 robots, average 30']);
});

test('walking explores chunks and the map shows them', () => {
  const w = world(128);
  const a = joined(w, 'Scout', [5, 5]);
  w.step(0);
  assert.deepEqual(a.explored, [0]);
  w.moveTo(a.id, 40, 5);
  for (let i = 0; i < 25; i++) w.step(0);
  assert.deepEqual(a.explored, [0, 1]);
  const m = renderMap(w, a);
  assert.equal(m.map.length, 4);
  assert.deepEqual(m.map[0].split(' '), ['.', '@', '?', '?']);
  assert.equal(m.explored, '2/16 chunks');
});

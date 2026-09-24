import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { spawnCreature } from './creatures.ts';
import { GameFail, World } from './world.ts';

// 20x20 meadow at level 1, with a wall at x=10 that is level 3 (a cliff) except a ramp at y=0 (levels 2, 3).
function world(): World {
  const n = 20, tiles = new Uint8Array(n * n).fill(T.MEADOW), heights = new Uint8Array(n * n).fill(1);
  for (let y = 0; y < n; y++) for (let x = 10; x < n; x++) heights[y * n + x] = 3;
  heights[9] = 2; // the ramp: (9,0) is level 2
  return new World(tiles, n, () => 0.5, heights);
}
function robot(w: World, x: number, y: number) {
  const a = w.register(`Bot ${x}${y}`, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = [x, y];
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

test('robots climb one level per step: the ramp works, the cliff does not', () => {
  const w = world();
  const a = robot(w, 8, 5);
  w.moveTo(a.id, 12, 5);
  const path = a.task?.type === 'move_to' ? a.task.path : [];
  assert.ok(path.some(([x, y]) => x === 9 && y === 0), 'goes round by the ramp');
  for (let i = 0; i < 30; i++) w.step(0);
  assert.deepEqual([a.x, a.y], [12, 5]);
  assert.equal(w.observe(a.id).you.altitude, 3);
});

test('trees and berry bushes are solid: robots gather standing next to them', () => {
  const w = world();
  const a = robot(w, 2, 5);
  w.nodes.set(w.index(5, 5), { kind: 'tree', left: 3, regrowAt: 0 });
  assert.equal(failCode(() => w.moveTo(a.id, 5, 5)), 'blocked');
  w.gather(a.id, 'tree', 1);
  for (let i = 0; i < 6; i++) w.step(0);
  assert.equal(a.inventory.wood, 1);
  assert.notDeepEqual([a.x, a.y], [5, 5]);
  assert.ok(Math.max(Math.abs(a.x - 5), Math.abs(a.y - 5)) === 1, `${a.x},${a.y}`);
});

test('creatures cannot climb cliffs either', () => {
  const w = world();
  robot(w, 5, 5);
  const rabbit = spawnCreature(w, 'rabbit', [9, 5]); // flees east, but x=10 is two levels up
  for (let i = 0; i < 3; i++) w.step(0);
  assert.ok(rabbit.x <= 9, `${rabbit.x},${rabbit.y}`);
});

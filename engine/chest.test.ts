import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { store, take } from './chest.ts';
import { GameFail, World } from './world.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};
function setup() {
  const w = new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
  const a = w.register('Owner', 0), b = w.register('Thief', 0);
  w.join(a.id, 'mason', null, 0);
  w.join(b.id, 'hunter', null, 0);
  [a.x, a.y, b.x, b.y] = [5, 5, 5, 6];
  a.inventory = { stone: 45 };
  w.structures.set(w.index(6, 5), { kind: 'chest', owner: a.id, litUntil: 0, items: {} });
  return { w, a, b };
}

test('the owner stores and takes; the chest keeps stack rules and 12 slots', () => {
  const { w, a } = setup();
  store(w, a.id, 'stone', 45);
  assert.deepEqual([a.inventory.stone, w.structures.get(w.index(6, 5))!.items], [undefined, { stone: 45 }]);
  take(w, a.id, 'stone', 5);
  assert.equal(a.inventory.stone, 5);
  a.inventory = { stone: 240, backpack: 1 };
  assert.equal(code(() => store(w, a.id, 'stone', 240)), 'chest_full');
  assert.equal(code(() => store(w, a.id, 'backpack', 1)), 'no_backpacks');
  assert.equal(code(() => take(w, a.id, 'stone', 999)), 'missing_items');
});

test('only the owner opens a chest, and only within 2 tiles', () => {
  const { w, a, b } = setup();
  b.inventory = { meat: 1 };
  assert.equal(code(() => store(w, b.id, 'meat', 1)), 'no_chest');
  a.x = 20;
  assert.equal(code(() => take(w, a.id, 'stone', 1)), 'no_chest');
});

test('observe shows your chest contents and other chests as locked', () => {
  const { w, a, b } = setup();
  store(w, a.id, 'stone', 45);
  assert.ok(w.observe(a.id).stations.some((l) => l.startsWith('chest (yours, 3/12 slots: stone 45)')));
  assert.ok(w.observe(b.id).stations.some((l) => l.startsWith("chest (Owner's, locked)")));
});

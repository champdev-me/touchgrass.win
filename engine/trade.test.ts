import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { drop, give } from './trade.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
}
function robot(w: World, name: string, at: Vec, bag: Record<string, number> = {}) {
  const a = w.register(name, 0);
  w.join(a.id, 'miner', null, 0);
  [a.x, a.y] = at;
  a.inventory = bag;
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

test('give hands items or gold to a robot within 2 tiles; nothing moves on failure', () => {
  const w = world();
  const a = robot(w, 'Giver', [10, 10], { wood: 5 });
  const b = robot(w, 'Taker', [11, 10]);
  const c = robot(w, 'Faraway', [30, 30]);
  give(w, a.id, b.id, 'wood', 3);
  give(w, a.id, b.id, 'gold', 4);
  assert.deepEqual([a.inventory.wood, b.inventory.wood, a.wallet, b.wallet], [2, 3, 6, 14]);
  assert.equal(failCode(() => give(w, a.id, c.id, 'wood', 1)), 'too_far');
  assert.equal(failCode(() => give(w, a.id, b.id, 'wood', 9)), 'missing_items');
  assert.equal(failCode(() => give(w, a.id, b.id, 'gold', 99)), 'not_enough_gold');
  assert.equal(failCode(() => give(w, a.id, a.id, 'wood', 1)), 'bad_target');
  assert.ok(w.observe(b.id).inbox.some((l) => l.includes('Giver gave you 3 wood')));
});

test('drop leaves items in a loot pile underfoot to free bag space', () => {
  const w = world();
  const a = robot(w, 'Hoarder', [10, 10], { berries: 240 });
  drop(w, a.id, 'berries', 200);
  assert.deepEqual([a.inventory.berries, w.loot.get(w.index(10, 10))?.items.berries], [40, 200]);
  assert.equal(failCode(() => drop(w, a.id, 'wood', 1)), 'missing_items');
});

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { buyPrice, decayMarket, give, smith, smithAt } from './smith.ts';
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

test('robots start with 10 gold; the Smith only trades with robots next to him', () => {
  const w = world();
  const [sx, sy] = smithAt(w);
  const far = robot(w, 'Far', [5, 5], { iron_ore: 1 });
  assert.equal(far.wallet, B.startGold);
  assert.equal(failCode(() => smith(w, far.id, 'sell', 'iron_ore', 1)), 'too_far');
});

test('selling pays gold, and the price drops as the Smith stocks up, never below 1, recovering over time', () => {
  const w = world();
  const [sx, sy] = smithAt(w);
  const a = robot(w, 'Miner', [sx + 1, sy], { iron_ore: 20, stone: 20 });
  const first = buyPrice(w, 'iron_ore');
  assert.equal(first, 4);
  const earned = Number(smith(w, a.id, 'sell', 'iron_ore', 20).gold_earned);
  assert.ok(earned < 20 * 4 && earned > 0, String(earned));
  assert.equal(a.wallet, B.startGold + earned);
  assert.ok(buyPrice(w, 'iron_ore') < first);
  smith(w, a.id, 'sell', 'stone', 20);
  assert.ok(buyPrice(w, 'stone') >= 1);
  const low = buyPrice(w, 'iron_ore');
  for (let i = 0; i < 100; i++) decayMarket(w);
  assert.ok(buyPrice(w, 'iron_ore') > low);
  assert.equal(failCode(() => smith(w, a.id, 'sell', 'iron_ore', 1)), 'missing_items');
  assert.equal(failCode(() => smith(w, a.id, 'sell', 'berries', 1)), 'not_buying');
});

test('buying shop items, stocked goods and blueprints costs gold; no debt, no overfull bags', () => {
  const w = world();
  const [sx, sy] = smithAt(w);
  const a = robot(w, 'Buyer', [sx, sy + 1]);
  a.wallet = 130;
  smith(w, a.id, 'buy', 'stone_axe', 1);
  assert.deepEqual([a.inventory.stone_axe, a.wallet], [1, 115]);
  assert.equal(failCode(() => smith(w, a.id, 'buy', 'iron', 1)), 'out_of_stock');
  w.market.iron = 5;
  smith(w, a.id, 'buy', 'iron', 2);
  assert.deepEqual([a.inventory.iron, a.wallet, w.market.iron], [2, 115 - 2 * 2 * 10, 3]);
  assert.equal(failCode(() => smith(w, a.id, 'blueprint', 'iron_sword')), 'not_enough_gold');
  a.wallet = 150;
  smith(w, a.id, 'blueprint', 'iron_sword');
  assert.deepEqual([a.blueprints, a.wallet], [['iron_sword'], 0]);
  assert.equal(failCode(() => smith(w, a.id, 'blueprint', 'iron_sword')), 'already_known');
  a.wallet = 1000;
  a.inventory = { berries: 240 };
  assert.equal(failCode(() => smith(w, a.id, 'buy', 'club', 1)), 'bag_full');
  assert.equal(a.wallet, 1000);
});

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

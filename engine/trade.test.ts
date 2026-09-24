import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { accept, decline, drop, give, offer } from './trade.ts';
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

test('offer then accept swaps everything at once, both ways, with gold', () => {
  const w = world();
  const m = robot(w, 'Miner', [10, 10], { iron_ore: 10 });
  const s = robot(w, 'Smith', [11, 10], {});
  s.wallet = 60;
  const o = offer(w, m.id, s.id, { iron_ore: 10 }, { gold: 50 });
  accept(w, s.id, o.offer);
  assert.deepEqual([m.inventory.iron_ore, m.wallet, s.inventory.iron_ore, s.wallet], [undefined, B.startGold + 50, 10, 10]);
  assert.equal(w.offers.size, 0);
  const news = w.step(0).events.find((e) => e.type === 'trade');
  assert.equal(news?.text, '💰 Miner traded 10 iron_ore to Smith for 50 gold.');
  assert.deepEqual([news?.agent, news?.other], [m.id, s.id]);
  assert.deepEqual([m.stats.trades, s.stats.trades], [1, 1]);
});

test('accept checks everything; a failed check moves nothing', () => {
  const w = world();
  const m = robot(w, 'Miner', [10, 10], { iron_ore: 10 });
  const s = robot(w, 'Smith', [11, 10], { stone: 240 });
  const o1 = offer(w, m.id, s.id, { iron_ore: 10 }, {});
  assert.equal(failCode(() => accept(w, s.id, o1.offer)), 'bag_full'); // the accepter's bag
  const o0 = offer(w, m.id, s.id, {}, { stone: 20 });
  m.inventory = { iron_ore: 10, wood: 220 };
  assert.equal(failCode(() => accept(w, s.id, o0.offer)), 'their_bag_full'); // the offerer's bag
  m.inventory = { iron_ore: 10 };
  const o3 = offer(w, m.id, s.id, { iron_ore: 10 }, {});
  s.inventory = {};
  m.inventory = {};
  assert.equal(failCode(() => accept(w, s.id, o3.offer)), 'offer_gone_stale');
  m.inventory = { iron_ore: 10 };
  const o2 = offer(w, m.id, s.id, { iron_ore: 10 }, { gold: 999 });
  assert.equal(failCode(() => accept(w, s.id, o2.offer)), 'not_enough_gold');
  s.x = 30;
  assert.equal(failCode(() => accept(w, s.id, o2.offer)), 'too_far');
  assert.deepEqual([m.inventory.iron_ore, s.inventory.iron_ore ?? 0, s.wallet, m.wallet], [10, 0, B.startGold, B.startGold]);
});

test('offers: validation, one per pair, decline, expiry, and only the target accepts', () => {
  const w = world();
  const a = robot(w, 'Ann', [10, 10], { wood: 5 });
  const b = robot(w, 'Bob', [11, 10], {});
  assert.equal(failCode(() => offer(w, a.id, a.id, { wood: 1 }, {})), 'bad_target');
  assert.equal(failCode(() => offer(w, a.id, b.id, {}, {})), 'empty_offer');
  assert.equal(failCode(() => offer(w, a.id, b.id, { wood: 9 }, {})), 'missing_items');
  assert.equal(failCode(() => offer(w, a.id, b.id, { gold: 99 }, {})), 'not_enough_gold');
  const first = offer(w, a.id, b.id, { wood: 1 }, {});
  const second = offer(w, a.id, b.id, { wood: 2 }, {});
  assert.deepEqual([w.offers.has(first.offer), w.offers.has(second.offer)], [false, true]);
  assert.equal(failCode(() => accept(w, a.id, second.offer)), 'not_yours');
  decline(w, b.id, second.offer);
  assert.equal(w.offers.size, 0);
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('declined')));
  offer(w, a.id, b.id, { wood: 1 }, {});
  for (let i = 0; i <= B.offerTicks; i++) w.step(0);
  assert.equal(w.offers.size, 0);
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('expired')));
});

test('observe lists incoming and outgoing offers', () => {
  const w = world();
  const a = robot(w, 'Ann', [10, 10], { wood: 5 });
  const b = robot(w, 'Bob', [11, 10], {});
  const o = offer(w, a.id, b.id, { wood: 5 }, { gold: 3 });
  assert.match(w.observe(b.id).offers.incoming[0], new RegExp(`^${o.offer} from Ann \\(${a.id}\\): gives 5 wood, wants 3 gold, \\d+ s left$`));
  assert.equal(w.observe(a.id).offers.outgoing.length, 1);
});

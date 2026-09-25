import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { buy, cancelSale, marketView, sell } from './market.ts';
import { drop } from './trade.ts';
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
  const w = new World(new Uint8Array(128 * 128).fill(T.MEADOW), 128, () => 0.5);
  const s = w.register('Seller', 0), b = w.register('Buyer', 0);
  w.join(s.id, 'miner', null, 0);
  w.join(b.id, 'smith', null, 0);
  s.inventory = { iron_ore: 20 };
  b.inventory = {};
  b.wallet = 100;
  return { w, s, b };
}

test('sell puts goods on the market; anyone anywhere buys; the seller is paid and chat hears about it', () => {
  const { w, s, b } = setup();
  const l = sell(w, s.id, 'iron_ore', 10, 4).listing;
  assert.equal(s.inventory.iron_ore, 10);
  [b.x, b.y] = [s.x + 60, s.y + 60]; // far away is fine
  buy(w, b.id, l, 5);
  assert.deepEqual([b.inventory.iron_ore, b.wallet, s.wallet], [5, 80, B.startGold + 20]);
  assert.ok(w.step(0).events.some((e) => e.text === '📈 Seller sold 5 iron_ore to Buyer for 20 gold.'));
  assert.deepEqual([s.stats.sales, s.stats['earned:gold']], [1, 20]);
  const view = marketView(w, 'iron_ore');
  assert.equal(view.listings[0], `${l}: 5 iron_ore at 4 gold each, by Seller`);
});

test('the market is an order book: cheapest first; rules on money, room, own listings and cancelling', () => {
  const { w, s, b } = setup();
  const pricey = sell(w, s.id, 'iron_ore', 5, 9).listing;
  const cheap = sell(w, s.id, 'iron_ore', 5, 3).listing;
  assert.equal(marketView(w, 'iron_ore').listings[0].startsWith(cheap), true);
  assert.equal(code(() => buy(w, s.id, cheap, 1)), 'own_listing');
  b.wallet = 2;
  assert.equal(code(() => buy(w, b.id, cheap, 1)), 'not_enough_gold');
  b.wallet = 100;
  b.inventory = { stone: 240 };
  assert.equal(code(() => buy(w, b.id, cheap, 1)), 'bag_full');
  assert.equal(code(() => sell(w, s.id, 'iron_ore', 99, 1)), 'missing_items');
  assert.equal(code(() => sell(w, s.id, 'iron_ore', 1, 0)), 'bad_price');
  cancelSale(w, s.id, pricey);
  assert.equal(s.inventory.iron_ore, 15);
  assert.equal(code(() => cancelSale(w, b.id, cheap)), 'not_yours');
});

test('dropping destroys the items and costs a 1-gold fine: store or sell instead', () => {
  const { w, s } = setup();
  drop(w, s.id, 'iron_ore', 5);
  assert.deepEqual([s.inventory.iron_ore, s.wallet, w.loot.size], [15, B.startGold - 1, 0]);
});

test('ticks carry the cheapest ask per item, and sales carry item, count and gold for the trade view', () => {
  const { w, s, b } = setup();
  sell(w, s.id, 'iron_ore', 5, 6);
  const cheap = sell(w, s.id, 'iron_ore', 3, 4).listing;
  const t = w.step(0);
  assert.deepEqual(t.asks, [['iron_ore', 4, 3]]);
  buy(w, b.id, cheap, 2);
  const sale = w.step(0).events.find((e) => e.type === 'market' && e.sale);
  assert.deepEqual(sale?.sale, ['iron_ore', 2, 8]);
});

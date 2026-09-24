import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from './balance.ts';
import { ITEMS, RECIPES, addItem, room, slotsOf, slotsUsed, stackOf, takeItem, trimBag } from './items.ts';

test('bags are small: 12 slots of 20, gear takes a whole slot, a backpack adds 6', () => {
  assert.deepEqual([B.inventorySlots, B.stackSize, stackOf('berries'), stackOf('stone_axe')], [12, 20, 20, 1]);
  const inv: Record<string, number> = {};
  assert.equal(addItem(inv, 'berries', 1000), 240);
  assert.equal(room(inv, 'wood'), 0);
  const bag: Record<string, number> = { stone_axe: 1, club: 1, wood: 21 };
  assert.equal(slotsUsed(bag), 4);
  assert.equal(slotsOf(bag), 12);
  bag.backpack = 1;
  assert.deepEqual([slotsOf(bag), slotsUsed(bag)], [18, 5]);
  assert.equal(takeItem(bag, 'wood', 30), false);
});

test('an overfull bag keeps gear first, then food, then materials; the rest overflows', () => {
  const inv: Record<string, number> = { berries: 1000, club: 1, stone: 30 };
  const extra = trimBag(inv);
  assert.equal(inv.club, 1);
  assert.equal(inv.berries, 220); // 11 slots of food after the club
  assert.equal(inv.stone, undefined);
  assert.deepEqual(extra, { berries: 780, stone: 30 });
});

test('every recipe and blueprint item is a known item', () => {
  for (const [item, r] of Object.entries(RECIPES)) {
    assert.ok(ITEMS[item], item);
    for (const m of Object.keys(r.needs)) assert.ok(ITEMS[m], `${item} needs ${m}`);
  }
});

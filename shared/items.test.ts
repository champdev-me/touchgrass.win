import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { addItem, room, slotsUsed, takeItem, type Inventory } from './items.ts';

test('an empty bag fits 20 stacks of 50', () => {
  assert.equal(room({}, 'wood'), 1000);
});

test('partial stacks fill before new slots', () => {
  const inv: Inventory = { wood: 45 };
  assert.equal(slotsUsed(inv), 1);
  assert.equal(room(inv, 'wood'), 5 + 19 * 50);
  assert.equal(room(inv, 'stone'), 19 * 50);
});

test('addItem stops at capacity and takeItem clears empty stacks', () => {
  const inv: Inventory = {};
  for (let i = 0; i < 20; i++) addItem(inv, `item${i}`, 50);
  assert.equal(addItem(inv, 'wood', 3), 0);
  assert.equal(addItem(inv, 'item0', 1), 0);
  assert.equal(takeItem(inv, 'item0', 50), true);
  assert.equal('item0' in inv, false);
  assert.equal(takeItem(inv, 'item1', 51), false);
  assert.equal(addItem(inv, 'berries', 7), 7);
});

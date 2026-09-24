import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { howTo } from './how.ts';
import { GameFail, World } from './world.ts';

function robot(role: 'hunter' | 'carpenter' | 'smith') {
  const w = new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.5);
  const a = w.register('Asker', 0);
  w.join(a.id, role, null, 0);
  return { w, a };
}

test('how to build a bed: who, where, what, and the exact calls', () => {
  const { w, a } = robot('hunter');
  const text = howTo(w, a.id, 'bed').steps.join('\n');
  assert.match(text, /carpenter/);
  assert.match(text, /inside your own base/);
  assert.match(text, /gather \{"target":"tree"\}/);
  assert.match(text, /gather \{"target":"grass"\}/);
  assert.match(text, /build \{"structure":"bed"\}/);
  assert.match(text, /switch_role \{"role":"carpenter"\}|offer/);
});

test('how to make iron: the smith at a furnace, ore from a miner', () => {
  const { w, a } = robot('smith');
  const text = howTo(w, a.id, 'iron').steps.join('\n');
  assert.match(text, /furnace/);
  assert.match(text, /iron_ore/);
  assert.match(text, /miner/);
  assert.match(text, /craft \{"item":"iron"\}/);
});

test('topics and unknown things', () => {
  const { w, a } = robot('carpenter');
  assert.match(howTo(w, a.id, 'land').steps.join(' '), /buy_land \{"direction":"e"\}/);
  assert.match(howTo(w, a.id, 'trade').steps.join(' '), /offer/);
  try {
    howTo(w, a.id, 'spaceship');
    assert.fail('should not know spaceships');
  } catch (e) {
    assert.equal((e as GameFail).code, 'unknown_thing');
    assert.match((e as GameFail).hint ?? '', /bed/);
  }
});

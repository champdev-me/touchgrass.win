import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { eloUpdate } from './elo.ts';

test('pairwise Elo: equal players, the winner gains what the loser loses', () => {
  const r = eloUpdate(['a', 'b'], () => 1000, 24);
  assert.deepEqual([r.get('a'), r.get('b')], [1012, 988]);
});

test('three players: first gains most, last loses most; an upset against a stronger player pays more', () => {
  const r = eloUpdate(['a', 'b', 'c'], () => 1000, 24);
  assert.deepEqual([r.get('a'), r.get('b'), r.get('c')], [1024, 1000, 976]);
  const upset = eloUpdate(['weak', 'strong'], (id) => (id === 'weak' ? 900 : 1100), 24);
  assert.ok(upset.get('weak')! - 900 > 12);
});

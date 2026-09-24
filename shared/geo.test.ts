import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compass, dist } from './geo.ts';

test('compass uses screen coordinates (y grows south)', () => {
  assert.equal(compass(0, -3), 'N');
  assert.equal(compass(2, 0), 'E');
  assert.equal(compass(1, 1), 'SE');
  assert.equal(compass(-1, -1), 'NW');
  assert.equal(compass(-5, 0), 'W');
  assert.equal(compass(2, -1), 'NE');
  assert.equal(compass(0, 0), 'here');
});

test('dist is the larger axis gap', () => {
  assert.equal(dist([0, 0], [3, -7]), 7);
  assert.equal(dist([5, 5], [5, 5]), 0);
});

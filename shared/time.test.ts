import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { daylight, timeOf } from './time.ts';

test('a day is 14 minutes of light then 6 of night', () => {
  assert.deepEqual([timeOf(0).phase, timeOf(0).day], ['day', 1]);
  assert.equal(timeOf(839).phase, 'day');
  assert.equal(timeOf(839).secondsToSwitch, 1);
  assert.equal(timeOf(840).phase, 'night');
  assert.equal(timeOf(840).secondsToSwitch, 360);
  assert.deepEqual([timeOf(1200).phase, timeOf(1200).day], ['day', 2]);
});

test('daylight eases in at dawn and out at dusk', () => {
  assert.equal(daylight(0), 0);
  assert.equal(daylight(15), 0.5);
  assert.equal(daylight(500), 1);
  assert.equal(daylight(825), 0.5);
  assert.equal(daylight(900), 0);
});

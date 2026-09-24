import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { isRude } from './filter.ts';

test('profanity is caught, normal names and model tags pass', () => {
  assert.equal(isRude('Grasslord'), false);
  assert.equal(isRude('claude-opus-5-5'), false);
  assert.equal(isRude('shit lord'), true);
});

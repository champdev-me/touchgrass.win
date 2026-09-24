import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { clean, isRude } from './filter.ts';

test('profanity is caught, normal names and model tags pass', () => {
  assert.equal(isRude('Grasslord'), false);
  assert.equal(isRude('claude-opus-5-5'), false);
  assert.equal(isRude('shit lord'), true);
});

test('clean replaces rudeness with grass, strips links and collapses whitespace', () => {
  assert.equal(clean('you are a  shit\nbot'), 'you are a grass bot');
  assert.equal(clean('visit https://evil.example/x now'), 'visit [link removed] now');
  assert.equal(clean('go to www.spam.com today'), 'go to [link removed] today');
  assert.equal(clean('hello grass'), 'hello grass');
});

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { joust as J } from './joust.ts';

const fixed = (v: number) => () => v;
const pts = (s: ReturnType<typeof J.start>) => [...s.riders.values()].map((r) => r.points);

test('options: helm, shield, body; the default is the shield', () => {
  const s = J.start(['a', 'b'], fixed(0.5));
  assert.deepEqual(J.options(s, 'a').map((o) => o.label), ['helm', 'shield', 'body']);
  assert.equal(J.defaultOption(s, 'a'), 2);
});

test('matching aims score big, mismatches score nothing, the shield always scores 1', () => {
  const s = J.start(['a', 'b'], fixed(0.5));
  J.resolve(s, new Map([['a', 1], ['b', 1]]), fixed(0.9)); // helm clash, nobody falls
  assert.deepEqual(pts(s), [3, 3]);
  J.resolve(s, new Map([['a', 3], ['b', 3]]), fixed(0.9));
  assert.deepEqual(pts(s), [5, 5]);
  J.resolve(s, new Map([['a', 1], ['b', 3]]), fixed(0.9));
  assert.deepEqual(pts(s), [5, 5]);
  const lines = J.resolve(s, new Map([['a', 2], ['b', 1]]), fixed(0.9));
  assert.deepEqual(pts(s), [6, 5]);
  assert.ok(lines.some((l) => l.startsWith('a hits the shield')));
});

test('a helm clash unhorses one rider a third of the time, and that ends the joust', () => {
  const s = J.start(['a', 'b'], fixed(0.5));
  const lines = J.resolve(s, new Map([['a', 1], ['b', 1]]), fixed(0.1)); // < 1/6: b falls
  assert.equal(s.unhorsed, 'b');
  assert.ok(lines.some((l) => l.startsWith('b is UNHORSED')));
  assert.ok(J.finished(s));
  assert.deepEqual(J.ranking(s), ['a', 'b']);
  const t = J.start(['a', 'b'], fixed(0.5));
  J.resolve(t, new Map([['a', 1], ['b', 1]]), fixed(0.25)); // 1/6..1/3: a falls
  assert.equal(t.unhorsed, 'a');
});

test('five passes, then sudden death while tied, capped at eight', () => {
  const s = J.start(['a', 'b'], fixed(0.5));
  for (let i = 0; i < 5; i++) J.resolve(s, new Map([['a', 2], ['b', 2]]), fixed(0.9));
  assert.ok(!J.finished(s)); // 5-5
  J.resolve(s, new Map([['a', 2], ['b', 3]]), fixed(0.9));
  assert.ok(J.finished(s));
  assert.deepEqual(J.ranking(s), ['a', 'b']);
  const t = J.start(['a', 'b'], fixed(0.5));
  for (let i = 0; i < 8; i++) J.resolve(t, new Map([['a', 2], ['b', 2]]), fixed(0.9));
  assert.ok(J.finished(t));
});

test('the view shows each rider its opponent\'s recent aims; house riders pick a valid option', () => {
  const s = J.start(['a', 'b'], fixed(0.5));
  J.resolve(s, new Map([['a', 1], ['b', 3]]), fixed(0.9));
  J.resolve(s, new Map([['a', 2], ['b', 3]]), fixed(0.9));
  const v = J.view(s) as { pass: number; riders: { id: string; aims: string[] }[] };
  assert.equal(v.pass, 2);
  assert.deepEqual(v.riders.find((r) => r.id === 'b')!.aims, ['body', 'body']);
  for (const r of [0, 0.3, 0.6, 0.99]) assert.ok([1, 2, 3].includes(J.houseChoice(s, 'a', fixed(r))));
});

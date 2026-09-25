import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { horseRace as H } from './horse.ts';

const noLuck = () => 0.5; // luck = floor(0.5 * 5) - 2 = 0; events pick 'tailwind'... see below
const fixed = (v: number) => () => v;

test('options and effects: sprint, steady, conserve, overtake on a clear leg', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.1)); // event index 0 = clear
  assert.equal(s.event, 'clear');
  assert.deepEqual(H.options(s, 'a').map((o) => o.label), ['sprint', 'steady', 'conserve', 'overtake']);
  H.resolve(s, new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4]]), noLuck);
  const r = (id: string) => s.runners.get(id)!;
  assert.deepEqual([r('a').distance, r('a').stamina], [24, 7]);
  assert.deepEqual([r('b').distance, r('b').stamina], [20, 9]);
  assert.deepEqual([r('c').distance, r('c').stamina], [16, 10]); // capped at 10
  assert.equal(r('d').distance, 26); // 22, then within 3 behind a (24): +4 = 26
});

test('exhausted runners stagger; luck stays within -2..+2', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  s.runners.get('a')!.stamina = 0;
  H.resolve(s, new Map([['a', 1]]), fixed(0));
  assert.deepEqual([s.runners.get('a')!.distance, s.runners.get('a')!.stamina, s.runners.get('a')!.last], [10, 1, 'exhausted']); // 12 - 2 luck
  const t = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  H.resolve(t, new Map(), fixed(0.99));
  assert.equal(t.runners.get('a')!.distance, 22); // steady 20 + 2 luck
});

test('leg events: mud, tailwind, hill, and the home stretch on the last leg', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.3)); // index 1 = mud
  assert.equal(s.event, 'mud');
  H.resolve(s, new Map([['a', 1]]), noLuck);
  assert.equal(s.runners.get('a')!.stamina, 5); // sprint 3 + mud 2
  const t = H.start(['a', 'b', 'c', 'd'], fixed(0.6)); // index 2 = tailwind
  H.resolve(t, new Map([['a', 2]]), noLuck);
  assert.equal(t.runners.get('a')!.distance, 23);
  const u = H.start(['a', 'b', 'c', 'd'], fixed(0.8)); // index 3 = hill
  u.runners.get('a')!.stamina = 5;
  H.resolve(u, new Map([['a', 3]]), noLuck);
  assert.equal(u.runners.get('a')!.stamina, 5);
  const v = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  v.leg = 9;
  v.event = 'home_stretch';
  H.resolve(v, new Map([['a', 1]]), noLuck);
  assert.equal(v.runners.get('a')!.distance, 28);
  assert.ok(H.finished(v));
});

test('two laps of the oval: straight, hurdle, turn, hurdle, turn, then the home stretch', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  const seen: string[] = [];
  while (!H.finished(s)) {
    seen.push(s.event);
    H.resolve(s, new Map(), noLuck);
  }
  assert.deepEqual(seen, ['clear', 'hurdle', 'turn', 'hurdle', 'turn', 'tailwind', 'hurdle', 'turn', 'hurdle', 'home_stretch']);
});

test('turns: a sprint goes wide (+18), an overtake takes the inside (+2)', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  s.event = 'turn';
  H.resolve(s, new Map([['a', 1], ['b', 4], ['c', 2], ['d', 2]]), noLuck);
  assert.equal(s.runners.get('a')!.distance, 18);
  assert.equal(s.runners.get('b')!.distance, 24); // 22 + 2 inside; nobody within 3 ahead
});

test('hurdles: jump appears and always clears; sprints clip half the time and lose 8', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  s.event = 'hurdle';
  assert.deepEqual(H.options(s, 'a').map((o) => o.label), ['sprint', 'steady', 'conserve', 'overtake', 'jump']);
  const lines = H.resolve(s, new Map([['a', 5], ['b', 1], ['c', 3], ['d', 2]]), fixed(0.2)); // luck -1, every clip roll hits
  const r = (id: string) => s.runners.get(id)!;
  assert.deepEqual([r('a').distance, r('a').stamina], [17, 8]); // jump 18 - 1
  assert.equal(r('b').distance, 24 - 1 - 8); // clipped
  assert.equal(r('c').distance, 16 - 1); // conserve never clips
  assert.equal(r('d').distance, 20 - 1 - 8); // steady clips at 0.2 < 0.25
  assert.ok(lines.some((l) => l.startsWith('b clips the hurdle')));
  const t = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  t.event = 'hurdle';
  H.resolve(t, new Map([['a', 1], ['b', 2]]), fixed(0.6)); // rolls miss
  assert.equal(t.runners.get('a')!.distance, 25);
  assert.equal(H.options(H.start(['a'], fixed(0.1)), 'a').length, 4); // no jump off the hurdles
});

test('ten legs; winner by distance, then stamina, then lot', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  for (let i = 0; i < 10; i++) H.resolve(s, new Map([['a', 3], ['b', 2], ['c', 2], ['d', 2]]), noLuck);
  assert.ok(H.finished(s));
  const t = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  for (const [id, r] of t.runners) Object.assign(r, { distance: 50, stamina: id === 'c' ? 9 : 3 });
  t.leg = 10;
  assert.equal(H.ranking(t)[0], 'c');
});

test('house bots conserve early, sprint late when they can', () => {
  const s = H.start(['a', 'b', 'c', 'd'], fixed(0.1));
  assert.equal(H.houseChoice(s, 'a', fixed(0.9)), 3);
  s.event = 'hurdle';
  assert.equal(H.houseChoice(s, 'a', fixed(0.9)), 5);
  s.event = 'home_stretch';
  s.leg = 9;
  assert.equal(H.houseChoice(s, 'a', fixed(0.9)), 1);
  s.runners.get('a')!.stamina = 1;
  assert.equal(H.houseChoice(s, 'a', fixed(0.9)), 2);
});

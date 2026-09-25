import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { roulette as R, type RouletteState } from './roulette.ts';

const fixed = (v: number) => () => v;
const pick = (s: RouletteState, who: string, label: string) => R.options(s, who).find((o) => o.label === label)!.id;
const load = (s: RouletteState, live: number, at: number) => Object.assign(s, { live, at, clicks: 0 });

test('one player holds the gun and has to pull: no passing', () => {
  const s = R.start(['a', 'b', 'c', 'd'], fixed(0.5));
  assert.deepEqual(R.actors!(s), ['a']);
  assert.deepEqual(R.options(s, 'b'), []);
  assert.deepEqual(R.options(s, 'a').map((o) => o.label), ['pull the trigger']);
});

test('a click earns nerve, raises the odds and passes the gun; the sixth chamber is certain', () => {
  const s = load(R.start(['a', 'b', 'c', 'd'], fixed(0.5)), 5, 0);
  const lines = R.resolve(s, new Map([['a', pick(s, 'a', 'pull the trigger')]]), fixed(0.5));
  assert.ok(lines.some((l) => l.startsWith('a pulls the trigger') && l.includes('click')));
  assert.equal(s.players.get('a')!.nerve, 1);
  assert.equal(s.clicks, 1);
  assert.deepEqual(R.actors!(s), ['b']);
  assert.match(R.options(s, 'b')[0].effect, /1 in 5/);
  Object.assign(s, { clicks: 5, at: 5 });
  assert.match(R.options(s, 'b')[0].effect, /certain/);
});

test('bang: the holder is out, the gun is reloaded, the next seat takes it', () => {
  const s = load(R.start(['a', 'b', 'c', 'd'], fixed(0.5)), 2, 2);
  const lines = R.resolve(s, new Map([['a', pick(s, 'a', 'pull the trigger')]]), fixed(0.5));
  assert.ok(lines.some((l) => l.includes('BANG') && l.includes('a')));
  assert.ok(s.players.get('a')!.out);
  assert.equal(s.clicks, 0);
  assert.deepEqual(R.actors!(s), ['b']);
});

test('last one seated wins; then who left last; at the cap, most nerve among the seated', () => {
  const s = R.start(['a', 'b', 'c', 'd'], fixed(0.5));
  for (const id of ['b', 'c', 'd']) s.players.get(id)!.out = true;
  s.outOrder.push('c', 'd', 'b');
  assert.ok(R.finished(s));
  assert.deepEqual(R.ranking(s), ['a', 'b', 'd', 'c']);
  const t = R.start(['a', 'b', 'c', 'd'], fixed(0.5));
  t.turns = 999;
  t.players.get('c')!.nerve = 4;
  assert.ok(R.finished(t));
  assert.equal(R.ranking(t)[0], 'c');
});

test('players never see the live chamber; spectators do', () => {
  const s = load(R.start(['a', 'b', 'c', 'd'], fixed(0.5)), 3, 1);
  assert.equal((R.view(s) as { live_in: number }).live_in, 2);
  assert.equal((R.playerView!(s, 'a') as { live_in?: number }).live_in, undefined);
  for (const r of [0.05, 0.5, 0.95]) assert.ok(R.options(s, 'a').map((o) => o.id).includes(R.houseChoice(s, 'a', fixed(r))));
  assert.equal(R.defaultOption(s, 'a'), pick(s, 'a', 'pull the trigger')); // too slow: the trigger anyway
});

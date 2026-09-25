import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { tavern as T, type TavernState } from './tavern.ts';

const fixed = (v: number) => () => v;
const deal = (s: TavernState, hands: Record<string, number[]>) => {
  for (const [id, dice] of Object.entries(hands)) s.seats.get(id)!.dice = dice;
};
const pick = (s: TavernState, who: string, label: string) => T.options(s, who).find((o) => o.label === label)!.id;

test('one player acts at a time; the opener bids, and only later players may call liar', () => {
  const s = T.start(['a', 'b', 'c', 'd'], fixed(0.5));
  assert.deepEqual(T.actors!(s), ['a']);
  assert.deepEqual(T.options(s, 'b'), []);
  const opening = T.options(s, 'a').map((o) => o.label);
  assert.ok(!opening.includes('call liar'));
  assert.ok(opening.includes('bid 1 six') && opening.includes('bid 2 sixes'));
  T.resolve(s, new Map([['a', pick(s, 'a', 'bid 2 fives')]]), fixed(0.5));
  assert.deepEqual(s.bid, { count: 2, face: 5, by: 'a' });
  assert.deepEqual(T.actors!(s), ['b']);
  const next = T.options(s, 'b').map((o) => o.label);
  assert.equal(next[0], 'call liar');
  assert.ok(next.includes('bid 2 sixes') && next.includes('bid 3 ones') && !next.includes('bid 2 fours'));
});

test('calling liar on a bluff: the bidder loses a die and opens the next round', () => {
  const s = T.start(['a', 'b', 'c', 'd'], fixed(0.5));
  deal(s, { a: [5, 1], b: [2, 3], c: [4, 4], d: [6, 6] }); // one 5 on the table
  T.resolve(s, new Map([['a', pick(s, 'a', 'bid 2 fives')]]), fixed(0.5));
  const lines = T.resolve(s, new Map([['b', pick(s, 'b', 'call liar')]]), fixed(0.5));
  assert.ok(lines.some((l) => l.startsWith('b calls LIAR on a')));
  assert.ok(lines.some((l) => l.includes('1 five') && l.includes('a loses a die')));
  assert.equal(s.seats.get('a')!.dice.length, 1);
  assert.equal(s.bid, null);
  assert.deepEqual(T.actors!(s), ['a']);
  assert.equal(s.reveal?.loser, 'a');
});

test('calling liar on an honest bid costs the caller; a player with no dice is thrown out', () => {
  const s = T.start(['a', 'b', 'c', 'd'], fixed(0.5));
  deal(s, { a: [5, 5], b: [6], c: [4, 4], d: [5, 2] });
  T.resolve(s, new Map([['a', pick(s, 'a', 'bid 2 fives')]]), fixed(0.5)); // 3 fives on the table: honest
  const lines = T.resolve(s, new Map([['b', pick(s, 'b', 'call liar')]]), fixed(0.5));
  assert.ok(lines.some((l) => l.includes('b is thrown out of the tavern')));
  assert.ok(s.seats.get('b')!.out);
  assert.deepEqual(T.actors!(s), ['c']); // the loser is out: the next seat opens
});

test('last one at the table wins; ranking is the winner, then who left last', () => {
  const s = T.start(['a', 'b', 'c', 'd'], fixed(0.5));
  for (const id of ['b', 'c', 'd']) s.seats.get(id)!.out = true;
  s.outOrder.push('d', 'b', 'c');
  assert.ok(T.finished(s));
  assert.deepEqual(T.ranking(s), ['a', 'c', 'b', 'd']);
});

test('players see only their own dice; spectators see every die', () => {
  const s = T.start(['a', 'b', 'c', 'd'], fixed(0.5));
  deal(s, { a: [1, 2], b: [3, 4], c: [5, 6], d: [6, 6] });
  const mine = T.playerView!(s, 'a') as { seats: { id: string; dice: number[] | null; dice_left: number }[] };
  assert.deepEqual(mine.seats.find((x) => x.id === 'a')!.dice, [1, 2]);
  assert.equal(mine.seats.find((x) => x.id === 'b')!.dice, null);
  assert.equal(mine.seats.find((x) => x.id === 'b')!.dice_left, 2);
  const all = T.view(s) as { seats: { id: string; dice: number[] | null }[] };
  assert.deepEqual(all.seats.find((x) => x.id === 'd')!.dice, [6, 6]);
});

test('house and default choices are valid; a house rider calls an impossible bid', () => {
  const s = T.start(['a', 'b', 'c', 'd'], fixed(0.5));
  for (const r of [0.05, 0.5, 0.95]) {
    const valid = T.options(s, 'a').map((o) => o.id);
    assert.ok(valid.includes(T.houseChoice(s, 'a', fixed(r))));
    assert.ok(valid.includes(T.defaultOption(s, 'a')));
  }
  s.bid = { count: 7, face: 3, by: 'a' };
  s.turn = 1;
  assert.equal(T.houseChoice(s, 'b', fixed(0.5)), pick(s, 'b', 'call liar'));
});

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { Arcade } from './arcade.ts';
import { GameFail } from './errors.ts';
import { horseRace } from './games/horse.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};
const ROUND = B.roundMs / B.tickMs, MIN = B.minRoundMs / B.tickMs;
function arcade() {
  let seed = 9;
  return new Arcade(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
}
const run = (a: Arcade, ticks: number) => {
  for (let i = 0; i < ticks; i++) a.step();
};

test('a queue waits 20 s, then starts with house bots filling the field to 4', () => {
  const a = arcade();
  const p = a.register('Ann'), q = a.register('Bob');
  a.play(p.id, 'horse_race');
  a.play(q.id, 'horse_race');
  assert.equal(code(() => a.play(p.id, 'horse_race')), 'busy');
  run(a, B.queueWaitTicks - 1);
  assert.equal(a.matches.length, 0);
  run(a, 1);
  assert.equal(a.matches.length, 1);
  const m = a.matches[0];
  assert.equal(m.players.length, 4);
  assert.equal(m.players.filter((id) => a.players.get(id)!.house).length, 2);
  assert.equal(a.observe(p.id).status, 'in_match');
});

test('four in the queue start at once (a fifth waits for the next race); a lone leaver empties the queue', () => {
  const a = arcade();
  const ps = Array.from({ length: 5 }, (_, i) => a.register(`P${i}`));
  for (const p of ps) a.play(p.id, 'horse_race');
  run(a, 1);
  assert.equal(a.matches[0]?.players.length, 4);
  assert.equal(a.observe(ps[4].id).status, 'queued');
  const b = arcade();
  const x = b.register('Solo');
  b.play(x.id, 'horse_race');
  b.leaveQueue(x.id);
  run(b, B.queueWaitTicks + 1);
  assert.equal(b.matches.length, 0);
});

test('rounds: menu choices, replacing a choice, early resolve when all acted, defaults when late', () => {
  const a = arcade();
  const p = a.register('Ann'), q = a.register('Bob');
  for (const x of [p, q]) a.play(x.id, 'horse_race');
  run(a, B.queueWaitTicks);
  assert.deepEqual(a.observe(p.id).options?.map((o) => o.id), [1, 2, 3, 4]);
  assert.equal(code(() => a.act(p.id, 9)), 'bad_option');
  a.act(p.id, 3);
  a.act(p.id, 1); // replaces the conserve
  a.act(q.id, 2);
  run(a, 1); // both acted, but a leg lasts at least B.minRoundMs so viewers see the gallop
  assert.equal(a.observe(p.id).round, 0);
  run(a, MIN - 1); // then it resolves early
  assert.equal(a.observe(p.id).round, 1);
  assert.match(a.observe(p.id).last_round?.join(' ') ?? '', /Ann sprints/);
  run(a, ROUND); // nobody acts: defaults
  assert.equal(a.observe(p.id).round, 2);
  assert.ok(a.observe(q.id).last_round?.some((l) => l.includes('too slow')));
});

test('a race finishes: points, Elo for humans only, a chat line, history, and everyone back in the lobby', () => {
  const a = arcade();
  const p = a.register('Ann'), q = a.register('Bob');
  for (const x of [p, q]) a.play(x.id, 'horse_race');
  run(a, B.queueWaitTicks);
  for (let leg = 0; leg < horseRace.rounds; leg++) {
    a.act(p.id, 1);
    a.act(q.id, 3);
    run(a, MIN);
  }
  assert.equal(a.observe(p.id).status, 'lobby');
  assert.ok(p.points > 0 && p.played.horse_race === 1);
  assert.notEqual(p.elo.horse_race, B.eloStart);
  assert.equal((p.elo.horse_race ?? 0) + (q.elo.horse_race ?? 0), 2 * B.eloStart);
  assert.ok(a.chatLog.some((l) => l.startsWith('🏇 ')));
  assert.equal(a.history(p.id).length, 1);
  assert.equal(code(() => a.act(p.id, 1)), 'not_in_match');
  const houses = [...a.players.values()].filter((x) => x.house);
  assert.ok(houses.every((h) => h.elo.horse_race === undefined));
});

test('a player who stops acting still finishes the race on defaults', () => {
  const a = arcade();
  const p = a.register('Ghost');
  a.play(p.id, 'horse_race');
  run(a, B.queueWaitTicks + horseRace.rounds * ROUND + 1);
  assert.equal(a.observe(p.id).status, 'lobby');
  assert.equal(p.played.horse_race, 1);
});

test('a joust: one human against a house bot runs to the end and records the result', () => {
  const a = arcade();
  const p = a.register('Lancelot');
  a.play(p.id, 'joust');
  run(a, B.queueWaitTicks);
  const o = a.observe(p.id);
  assert.equal(o.status, 'in_match');
  assert.deepEqual(o.options?.map((x) => x.label), ['helm', 'shield', 'body']);
  for (let pass = 0; pass < 8 && a.observe(p.id).status === 'in_match'; pass++) {
    a.act(p.id, 2);
    run(a, MIN);
  }
  assert.equal(a.observe(p.id).status, 'lobby');
  assert.equal(p.played.joust, 1);
  assert.match(a.history(p.id)[0] ?? '', /joust/);
});

test('turn-based games: only the player on turn acts; others wait without "too slow" lines', () => {
  const a = arcade();
  const ps = ['Ann', 'Bob', 'Cid', 'Dee'].map((n) => a.register(n));
  for (const p of ps) a.play(p.id, 'tavern');
  run(a, 1); // full table: starts at once
  const first = a.observe(ps[0].id), second = a.observe(ps[1].id);
  assert.equal(first.status, 'in_match');
  assert.ok((first.options?.length ?? 0) > 0);
  assert.deepEqual(second.options, []);
  assert.deepEqual(second.turn, ['Ann']);
  assert.equal(code(() => a.act(ps[1].id, 1)), 'not_your_turn');
  a.act(ps[0].id, 1);
  run(a, MIN);
  assert.equal(a.observe(ps[0].id).round, 1);
  assert.ok(!a.observe(ps[0].id).last_round?.some((l) => l.includes('too slow')));
  assert.deepEqual(a.observe(ps[0].id).turn, ['Bob']);
});

test('players see only their own dice at the tavern', () => {
  const a = arcade();
  const ps = ['Ann', 'Bob', 'Cid', 'Dee'].map((n) => a.register(n));
  for (const p of ps) a.play(p.id, 'tavern');
  run(a, 1);
  const seats = (a.observe(ps[1].id).state as { seats: { id: string; dice: number[] | null }[] }).seats;
  assert.equal(seats.find((x) => x.id === 'Bob')!.dice?.length, 2);
  assert.equal(seats.find((x) => x.id === 'Ann')!.dice, null);
});

test('table talk: act can carry a line, talk works any time; everyone at the table and spectators see it', () => {
  const a = arcade();
  const ps = ['Ann', 'Bob', 'Cid', 'Dee'].map((n) => a.register(n));
  for (const p of ps) a.play(p.id, 'tavern');
  run(a, 1);
  a.act(ps[0].id, 1, 'I have the sixes, trust me');
  a.talk(ps[2].id, 'she is lying');
  assert.equal(code(() => a.talk(ps[2].id, 'again')), 'rate_limited');
  assert.deepEqual(a.observe(ps[1].id).talk?.map((t) => `${t.name}: ${t.text}`), ['Ann: I have the sixes, trust me', 'Cid: she is lying']);
  const view = a.step().matches[0];
  assert.equal(view.talk.at(-1)?.text, 'she is lying');
  assert.equal(code(() => a.talk(a.register('Eve').id, 'hi')), 'not_in_match');
});

test('games can set a slower pace: a roulette turn never resolves before its own minimum', () => {
  const a = arcade();
  const ps = ['Ann', 'Bob', 'Cid', 'Dee'].map((n) => a.register(n));
  for (const p of ps) a.play(p.id, 'roulette');
  run(a, 1);
  a.act(ps[0].id, 1);
  run(a, MIN);
  assert.equal(a.observe(ps[0].id).round, 0); // the race's minimum is not enough here
  run(a, 9000 / B.tickMs - MIN);
  assert.equal(a.observe(ps[0].id).round, 1);
});

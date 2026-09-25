import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { baseOf, basesOf } from './bases.ts';
import { answerChallenge, beats, challenge, fight } from './duel.ts';
import { GameFail, World } from './world.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};
/** Two veterans (joined long ago) with bases; the challenger stands in the defender's base. */
function setup() {
  let seed = 3;
  const w = new World(new Uint8Array(256 * 256).fill(T.MEADOW), 256, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = Date.now();
  const a = w.register('Ann', now - 2 * B.newcomerShieldMs), b = w.register('Bob', now - 2 * B.newcomerShieldMs);
  w.join(a.id, 'hunter', null, now);
  w.join(b.id, 'farmer', null, now);
  [a.wallet, b.wallet] = [100, 100];
  const home = baseOf(w, b.id)!;
  [a.x, a.y] = [home.x0, home.y0];
  return { w, a, b, home };
}

test('moves: block beats slash, lunge beats block, slash beats lunge', () => {
  assert.deepEqual([beats('block', 'slash'), beats('lunge', 'block'), beats('slash', 'lunge'), beats('slash', 'block'), beats('slash', 'slash')], [true, true, true, false, false]);
});

test('challenge rules: in their base, 50 gold staked, one at a time, shields', () => {
  const { w, a, b, home } = setup();
  [a.x, a.y] = [home.x0 - 10, home.y0];
  assert.equal(code(() => challenge(w, a.id, b.id)), 'not_their_base');
  [a.x, a.y] = [home.x0, home.y0];
  a.wallet = 10;
  assert.equal(code(() => challenge(w, a.id, b.id)), 'not_enough_gold');
  a.wallet = 100;
  challenge(w, a.id, b.id);
  assert.equal(a.wallet, 50);
  assert.ok(w.step(0).events.some((e) => e.text === '⚔️ Ann challenges Bob for their land!'));
  const c = w.register('Cat', Date.now() - 2 * B.newcomerShieldMs);
  w.join(c.id, 'scout', null, Date.now());
  [c.x, c.y, c.wallet] = [home.x0 + 1, home.y0, 100];
  assert.equal(code(() => challenge(w, c.id, b.id)), 'busy');
  const n = w.register('Newbie', Date.now());
  w.join(n.id, 'scout', null, Date.now());
  const nb = baseOf(w, n.id)!;
  [c.x, c.y] = [nb.x0, nb.y0];
  assert.equal(code(() => challenge(w, c.id, n.id)), 'shielded');
});

test('reject: the chicken tax goes to the challenger with its stake; the fourth challenge in a day is accepted automatically', () => {
  const { w, a, b } = setup();
  for (let i = 0; i < 3; i++) {
    challenge(w, a.id, b.id);
    answerChallenge(w, b.id, 'reject');
  }
  assert.deepEqual([a.wallet, b.wallet], [200, 0]); // taxed 50, 50, then 0: Bob ran out
  challenge(w, a.id, b.id);
  assert.ok(w.duels.some((d) => d.b === b.id), 'auto-accepted');
});

test('no answer in 60 s: the defender fights on autopilot; a challenger who walks away forfeits nothing', () => {
  const { w, a, b } = setup();
  challenge(w, a.id, b.id);
  for (let i = 0; i <= B.answerTicks; i++) w.step(0);
  assert.ok(w.duels.some((d) => d.b === b.id && d.autopilot));
  const s2 = setup();
  challenge(s2.w, s2.a.id, s2.b.id);
  s2.a.x -= 40;
  s2.w.step(0);
  assert.deepEqual([s2.w.challenges.size, s2.a.wallet], [0, 100]);
});

test('an accepted duel: the Colosseum, hearts, in_duel, and the winner takes the land', () => {
  const { w, a, b, home } = setup();
  const [ax, ay] = [a.x, a.y];
  challenge(w, a.id, b.id);
  answerChallenge(w, b.id, 'accept');
  w.step(0);
  const d = w.duels[0];
  assert.ok(d.ring !== null);
  assert.ok(Math.abs(a.x - w.plaza[0]) <= 10 && Math.abs(b.y - w.plaza[1]) <= 10, 'both are in the Colosseum');
  assert.equal(code(() => w.gather(a.id, 'tree')), 'in_duel');
  const r = handleAction(w, { agentId: a.id, tool: 'move_to', args: { x: 1, y: 1 } });
  assert.equal(!r.ok && r.error.error, 'in_duel');
  for (let i = 0; i < 20 && w.duels.length; i++) {
    fight(w, a.id, ['lunge', 'lunge', 'lunge', 'lunge', 'lunge']);
    fight(w, b.id, ['block', 'block', 'block', 'block', 'block']);
    w.step(0);
  }
  assert.equal(w.duels.length, 0);
  assert.deepEqual([a.x, a.y], [ax, ay]); // back where it stood
  assert.deepEqual([b.x, b.y], baseOf(w, b.id)!.flag); // the loser starts over at its new base
  assert.equal(home.owner, a.id);
  assert.ok((home.shieldUntil ?? 0) > w.tick);
  assert.equal(a.wallet, 100);
  assert.ok(baseOf(w, b.id) && baseOf(w, b.id) !== home, 'the loser got a fresh base');
  assert.equal(basesOf(w, a.id).length, 2);
});

test('after 60 rounds a tie goes to the defender, who keeps the stake', () => {
  const { w, a, b, home } = setup();
  challenge(w, a.id, b.id);
  answerChallenge(w, b.id, 'accept');
  for (let i = 0; i < B.duelMaxRounds + 5 && w.duels.length; i++) {
    fight(w, a.id, ['slash', 'slash', 'slash', 'slash', 'slash']);
    fight(w, b.id, ['slash', 'slash', 'slash', 'slash', 'slash']);
    w.step(0);
  }
  assert.equal(w.duels.length, 0);
  assert.deepEqual([home.owner, b.wallet, a.wallet], [b.id, 150, 50]);
});

test('five accepted duels share four rings: the fifth waits its turn', () => {
  let seed = 5;
  const w = new World(new Uint8Array(256 * 256).fill(T.MEADOW), 256, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  const old = Date.now() - 2 * B.newcomerShieldMs;
  const pairs = Array.from({ length: 5 }, (_, i) => {
    const a = w.register(`A${i}`, old), b = w.register(`B${i}`, old);
    w.join(a.id, 'scout', null, Date.now());
    w.join(b.id, 'scout', null, Date.now());
    a.wallet = 100;
    const home = baseOf(w, b.id)!;
    [a.x, a.y] = [home.x0, home.y0];
    challenge(w, a.id, b.id);
    answerChallenge(w, b.id, 'accept');
    return a;
  });
  w.step(0);
  assert.deepEqual(w.duels.map((d) => d.ring), [0, 1, 2, 3, null]);
  assert.ok(pairs);
});

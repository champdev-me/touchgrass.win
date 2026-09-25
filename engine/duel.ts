import { B } from '../shared/balance.ts';
import type { Agent, Vec } from '../shared/types.ts';
import { basesOf, placeBase } from './bases.ts';
import { addScore } from './score.ts';
import { walkable } from './terrain.ts';
import { GameFail, type World } from './world.ts';

export const MOVES = ['slash', 'block', 'lunge'] as const;
export type Move = (typeof MOVES)[number];
const WINS: Record<Move, Move> = { block: 'slash', lunge: 'block', slash: 'lunge' }; // key beats value
export const beats = (x: Move, y: Move): boolean => WINS[x] === y;

export interface Challenge { from: string; to: string; base: string; expiresAt: number }
export interface Duel {
  a: string; b: string; base: string; // challenger, defender, the land at stake
  ring: number | null; // null while waiting for a free ring
  hearts: [number, number]; round: number;
  queue: [Move[], Move[]]; last: [Move[], Move[]];
  autopilot: boolean; // the defender never answered
}

export const inDuel = (w: World, id: string): Duel | undefined => w.duels.find((d) => d.a === id || d.b === id);
const busy = (w: World, id: string) => Boolean(inDuel(w, id)) || [...w.challenges.values()].some((c) => c.from === id || c.to === id);
const ringAt = (w: World, ring: number): Vec => [w.plaza[0] + (ring % 2 ? 6 : -6), w.plaza[1] + (ring < 2 ? -6 : 6)];

export function challenge(w: World, id: string, target: string) {
  const a = w.alive(id), t = w.agents.get(target);
  if (!t || !t.joined || t.dead || t.id === a.id) throw new GameFail('bad_target', 'Nobody like that to challenge.', 'Use an agent id from observe.');
  const base = w.baseAt(a.x, a.y);
  if (!base || base.owner !== t.id) throw new GameFail('not_their_base', `Stand inside ${t.name}'s base to challenge them for it.`, 'Walk into their land first.');
  if (busy(w, a.id) || busy(w, t.id)) throw new GameFail('busy', 'One of you is already in a challenge or a duel.', 'Wait for it to finish.');
  const now = Date.now();
  if (now - t.createdAt < B.newcomerShieldMs || (w.defended.get(t.id) ?? 0) > w.tick || (base.shieldUntil ?? 0) > w.tick) {
    throw new GameFail('shielded', `${t.name}'s land is shielded right now (new robot, fresh win, or it just changed hands).`, 'Try again later.');
  }
  if (a.wallet < B.duelStake) throw new GameFail('not_enough_gold', `A challenge stakes ${B.duelStake} gold.`, 'Earn some first.');
  a.wallet -= B.duelStake;
  w.dirty.add(a.id);
  w.emit('duel', `⚔️ ${a.name} challenges ${t.name} for their land!`, a, t);
  const c: Challenge = { from: a.id, to: t.id, base: base.id, expiresAt: w.tick + B.answerTicks };
  const recent = (w.chickens.get(t.id) ?? []).filter((at) => now - at < 24 * 3600 * 1000);
  if (recent.length >= B.chickenLimit) {
    w.note(t, `${a.name} challenged you and you have chickened out too often today: the duel is on.`);
    start(w, c, false);
  } else {
    w.challenges.set(t.id, c);
    w.note(t, `${a.name} challenges you for your land! answer_challenge accept or reject within ${B.answerTicks}s (rejecting costs up to ${B.duelStake} gold).`);
  }
  w.touch(a);
  return { challenged: t.name, stake: B.duelStake };
}

export function answerChallenge(w: World, id: string, answer: string) {
  const t = w.alive(id), c = w.challenges.get(t.id);
  if (!c) throw new GameFail('no_challenge', 'Nobody is challenging you.', 'Enjoy the peace.');
  const a = w.agents.get(c.from)!;
  w.challenges.delete(t.id);
  if (answer === 'accept') {
    start(w, c, false);
    return { accepted: a.name };
  }
  const tax = Math.max(0, Math.min(B.duelStake, t.wallet));
  t.wallet -= tax;
  a.wallet += tax + B.duelStake;
  w.chickens.set(t.id, [...(w.chickens.get(t.id) ?? []), Date.now()]);
  w.dirty.add(a.id).add(t.id);
  w.emit('duel', `🐔 ${t.name} chickened out.`, t);
  w.touch(t);
  return { rejected: a.name, paid: tax };
}

function start(w: World, c: Challenge, autopilot: boolean): void {
  for (const r of [c.from, c.to]) {
    const x = w.agents.get(r)!;
    x.task = null;
    x.duelReturn = [x.x, x.y];
    w.dirty.add(x.id);
  }
  w.duels.push({ a: c.from, b: c.to, base: c.base, ring: null, hearts: [B.duelHearts, B.duelHearts], round: 0, queue: [[], []], last: [[], []], autopilot });
}

export function fight(w: World, id: string, moves: unknown[], taunt?: string) {
  const a = w.alive(id), d = inDuel(w, a.id);
  if (!d) throw new GameFail('not_in_duel', 'You are not in a duel.', 'challenge someone first.');
  const good = moves.filter((m): m is Move => (MOVES as readonly string[]).includes(String(m))).slice(0, B.fightQueue);
  if (!good.length) throw new GameFail('bad_moves', `Moves are ${MOVES.join(', ')} (up to ${B.fightQueue}).`, 'fight(moves=["block","lunge","slash"])');
  d.queue[d.a === a.id ? 0 : 1] = good;
  if (taunt?.trim()) {
    w.bubble(a, 'say', taunt.trim().slice(0, B.tauntMax));
    w.note(w.agents.get(d.a === a.id ? d.b : d.a)!, `${a.name} taunts: ${taunt.trim().slice(0, B.tauntMax)}`);
  }
  w.touch(a);
  return { queued: good };
}

function home(w: World, a: Agent): void {
  const [x, y] = a.duelReturn ?? a.spawn;
  a.duelReturn = null;
  [a.x, a.y] = walkable(w.at(x, y)) && !w.solid(x, y) ? [x, y] : w.nearestWalkable(x, y);
  w.dirty.add(a.id);
}

function finish(w: World, d: Duel): void {
  w.duels.splice(w.duels.indexOf(d), 1);
  const a = w.agents.get(d.a)!, b = w.agents.get(d.b)!;
  const challengerWins = d.hearts[0] > d.hearts[1];
  home(w, a);
  home(w, b);
  const base = w.bases.get(d.base);
  if (challengerWins && base) {
    base.owner = a.id;
    base.shieldUntil = w.tick + B.duelShieldTicks;
    for (const [i, s] of w.structures) {
      const [x, y] = w.xy(i);
      if (x >= base.x0 && x <= base.x1 && y >= base.y0 && y <= base.y1) s.owner = a.id;
    }
    w.basesDirty = w.structuresDirty = true;
    a.wallet += B.duelStake;
    addScore(w, a, B.duelScore);
    const left = basesOf(w, b.id);
    if (!left.length) placeBase(w, b);
    else if (!left.some((l) => l.flag[0] === b.spawn[0] && l.flag[1] === b.spawn[1])) b.spawn = left[0].flag;
    w.emit('duel', `🏆 ${a.name} beat ${b.name} and took their land!`, a, b);
  } else {
    b.wallet += B.duelStake;
    addScore(w, b, B.duelScore);
    w.defended.set(b.id, w.tick + B.duelShieldTicks);
    w.emit('duel', `🛡️ ${b.name} defended their land against ${a.name}.`, b, a);
  }
  w.dirty.add(a.id).add(b.id);
}

/** One tick: lapse or auto-accept challenges, seat waiting duels, play a round in every ring. */
export function stepDuels(w: World): void {
  for (const [key, c] of w.challenges) {
    const a = w.agents.get(c.from), base = w.bases.get(c.base);
    const gone = !a || a.dead || !a.online || !base || !(a.x >= base.x0 && a.x <= base.x1 && a.y >= base.y0 && a.y <= base.y1);
    if (gone) {
      w.challenges.delete(key);
      if (a) {
        a.wallet += B.duelStake;
        w.note(a, 'Your challenge lapsed; your stake is back.');
      }
    } else if (w.tick >= c.expiresAt) {
      w.challenges.delete(key);
      const t = w.agents.get(c.to)!;
      w.emit('duel', `😴 ${t.name} is asleep, their robot fights on autopilot.`, t);
      start(w, c, true);
    }
  }
  const used = new Set(w.duels.map((d) => d.ring).filter((r) => r !== null));
  for (const d of w.duels) {
    if (d.ring !== null) continue;
    const free = [...Array(B.rings).keys()].find((r) => !used.has(r));
    if (free === undefined) break; // first come, first served
    d.ring = free;
    used.add(free);
    const [cx, cy] = ringAt(w, free), a = w.agents.get(d.a)!, b = w.agents.get(d.b)!;
    [a.x, a.y, b.x, b.y] = [cx - 1, cy, cx + 2, cy];
    w.dirty.add(a.id).add(b.id);
  }
  for (const d of [...w.duels]) {
    if (d.ring === null) continue;
    const pick = (q: Move[], auto: boolean): Move => (!auto && q.shift()) || MOVES[Math.floor(w.rng() * MOVES.length)];
    const ma = pick(d.queue[0], false), mb = pick(d.queue[1], d.autopilot);
    if (beats(ma, mb)) d.hearts[1]--;
    else if (beats(mb, ma)) d.hearts[0]--;
    d.round++;
    d.last[0] = [...d.last[0], ma].slice(-5);
    d.last[1] = [...d.last[1], mb].slice(-5);
    if (d.hearts[0] <= 0 || d.hearts[1] <= 0 || d.round >= B.duelMaxRounds) finish(w, d);
  }
}

/** observe for a duelling robot. */
export function duelView(w: World, id: string) {
  const d = inDuel(w, id);
  if (!d) return null;
  const me = d.a === id ? 0 : 1, them = 1 - me;
  return { ring: d.ring, waiting_for_ring: d.ring === null, round: d.round, your_hearts: d.hearts[me], their_hearts: d.hearts[them], opponent: w.agents.get(me ? d.a : d.b)?.name, their_last_moves: d.last[them], your_queue: d.queue[me] };
}

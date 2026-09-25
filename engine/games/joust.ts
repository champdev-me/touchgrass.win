import type { Game, Option } from './game.ts';

export interface Rider { points: number; aims: string[]; lot: number }
export interface JoustState { pass: number; riders: Map<string, Rider>; unhorsed: string | null }

const PASSES = 5, MAX_PASSES = 8; // tied after 5: sudden death, at most 3 more
const AIMS = ['helm', 'shield', 'body'] as const;
const EFFECT: Record<string, string> = {
  helm: '3 points if they also aim at the helm (a helm clash unhorses one of you 1 time in 3); 0 otherwise',
  shield: 'always 1 point, safe',
  body: '2 points if they also aim at the body; 0 otherwise',
};

export const joust: Game<JoustState> = {
  id: 'joust',
  name: 'Joust',
  minPlayers: 2,
  maxPlayers: 2,
  rounds: PASSES,
  rules: [
    `Two riders, ${PASSES} passes; most points wins. Tied after ${PASSES}: sudden-death passes (at most ${MAX_PASSES} in all).`,
    'Each pass pick where your lance goes: 1 helm, 2 shield (the default), 3 body. Your shield covers the other way.',
    'Helm vs helm: 3 points each, and 1 time in 3 one rider is unhorsed and loses on the spot. Body vs body: 2 points each.',
    'Shield: always 1 point. Any other pairing scores 0. You see your opponent\'s last aims: read them.',
  ],
  start(players, rng) {
    return { pass: 0, unhorsed: null, riders: new Map(players.map((p) => [p, { points: 0, aims: [], lot: rng() }])) };
  },
  options(): Option[] {
    return AIMS.map((a, i) => ({ id: i + 1, label: a, effect: EFFECT[a] }));
  },
  defaultOption: () => 2,
  houseChoice(s, player, rng) {
    const theirs = [...s.riders.entries()].find(([id]) => id !== player)?.[1].aims.at(-1);
    const r = rng();
    if (theirs && theirs !== 'shield' && r < 0.4) return AIMS.indexOf(theirs as (typeof AIMS)[number]) + 1; // match their habit
    return r < 0.6 ? 2 : r < 0.8 ? 1 : 3;
  },
  resolve(s, choices, rng) {
    const [[a, ra], [b, rb]] = [...s.riders.entries()];
    const aim = (id: string) => AIMS[(choices.get(id) ?? 2) - 1] ?? 'shield';
    const [aa, ab] = [aim(a), aim(b)], lines: string[] = [];
    for (const [id, r, mine, theirs] of [[a, ra, aa, ab], [b, rb, ab, aa]] as const) {
      r.aims.push(mine);
      if (mine === 'shield') {
        r.points += 1;
        lines.push(`${id} hits the shield (+1)`);
      } else if (mine === theirs) {
        r.points += mine === 'helm' ? 3 : 2;
        lines.push(`${id} strikes the ${mine}! (+${mine === 'helm' ? 3 : 2})`);
      } else lines.push(`${id} misses`);
    }
    if (aa === 'helm' && ab === 'helm') {
      const roll = rng();
      s.unhorsed = roll < 1 / 6 ? b : roll < 1 / 3 ? a : null;
      if (s.unhorsed) lines.push(`${s.unhorsed} is UNHORSED!`);
    }
    s.pass++;
    return lines;
  },
  round: (s) => s.pass,
  finished(s) {
    const [p, q] = [...s.riders.values()];
    return s.unhorsed !== null || s.pass >= MAX_PASSES || (s.pass >= PASSES && p.points !== q.points);
  },
  ranking(s) {
    return [...s.riders.entries()]
      .sort(([ia, a], [ib, b]) => Number(ia === s.unhorsed) - Number(ib === s.unhorsed) || b.points - a.points || a.lot - b.lot)
      .map(([id]) => id);
  },
  view(s) {
    return { pass: s.pass, passes: PASSES, unhorsed: s.unhorsed, riders: [...s.riders.entries()].map(([id, r]) => ({ id, points: r.points, aims: r.aims.slice(-3) })) };
  },
};

import type { Game, Option } from './game.ts';

export interface Runner { distance: number; stamina: number; last: string | null; lot: number }
export interface HorseState { leg: number; event: string; runners: Map<string, Runner> }

const LEGS = 15, MAX_STAMINA = 15, CLIP_LOSS = 8;
const WEATHER = ['clear', 'mud', 'tailwind', 'hill'] as const;
const LAP = ['straight', 'hurdle', 'turn', 'hurdle', 'turn']; // one lap of the oval, three laps a race
const EVENT_TEXT: Record<string, string> = {
  clear: 'straight, clear skies', mud: 'straight in the mud: sprints cost 2 more stamina', tailwind: 'straight with a tailwind: +3 for everyone', hill: 'uphill straight: conserving gives no stamina',
  hurdle: 'hurdle: jump clears it; sprint and overtake clip it half the time, steady a quarter (-8)', turn: 'turn: sprints go wide (+18), overtakes take the inside (+2)', home_stretch: 'home stretch: sprints get +4',
};
const MOVES = ['sprint', 'steady', 'conserve', 'overtake', 'jump'] as const;
const CLIP: Record<string, number> = { sprint: 0.5, overtake: 0.5, steady: 0.25 };

function nextEvent(leg: number, rng: () => number): string {
  if (leg >= LEGS - 1) return 'home_stretch';
  const kind = LAP[leg % LAP.length];
  return kind === 'straight' ? WEATHER[Math.floor(rng() * WEATHER.length)] : kind;
}

/** Distance and stamina change for one move, before luck and the overtake bonus. */
function effect(move: string, event: string, stamina: number): { gain: number; cost: number; label: string } {
  if (stamina <= 0) return { gain: 12, cost: -1, label: 'exhausted' };
  const tail = event === 'tailwind' ? 3 : 0;
  if (move === 'sprint') return { gain: event === 'turn' ? 18 : 24 + tail + (event === 'home_stretch' ? 4 : 0), cost: 3 + (event === 'mud' ? 2 : 0), label: 'sprint' };
  if (move === 'conserve') return { gain: 16 + tail, cost: event === 'hill' ? 0 : -2, label: 'conserve' };
  if (move === 'overtake') return { gain: 22 + tail + (event === 'turn' ? 2 : 0), cost: 2, label: 'overtake' };
  if (move === 'jump' && event === 'hurdle') return { gain: 18, cost: 2, label: 'jump' };
  return { gain: 20 + tail, cost: 1, label: 'steady' };
}

export const horseRace: Game<HorseState> = {
  id: 'horse_race',
  name: 'Horse race',
  minPlayers: 4,
  maxPlayers: 4, // a medieval race: four riders at most
  rounds: LEGS,
  rules: [
    `Three laps of an oval, ${LEGS} legs; the runner furthest along after the last leg wins (ties: more stamina left, then by lot). Stamina starts at ${MAX_STAMINA}.`,
    'Each leg pick: 1 sprint (+24, -3 stamina), 2 steady (+20, -1; the default), 3 conserve (+16, +2), 4 overtake (+22, -2, and +4 more if you end the leg within 3 lengths behind someone).',
    'At 0 stamina you are exhausted: +12 and +1 stamina whatever you pick. Luck adds -2..+2 per leg.',
    'Each lap: straight, hurdle, turn, hurdle, turn. Straights have weather: mud (sprints cost 2 more), tailwind (+3 for all), hill (conserve gives no stamina). The last leg is the home stretch (sprints +4).',
    `Hurdles add 5 jump (+18, -2): it always clears. Otherwise sprint and overtake clip the hurdle half the time, steady a quarter of the time (-${CLIP_LOSS}); conserve never clips.`,
    'Turns: a sprint goes wide (+18 instead of +24); an overtake takes the inside (+2).',
  ],
  start(players, rng) {
    return { leg: 0, event: nextEvent(0, rng), runners: new Map(players.map((p) => [p, { distance: 0, stamina: MAX_STAMINA, last: null, lot: rng() }])) };
  },
  options(s, player): Option[] {
    const r = s.runners.get(player)!;
    return MOVES.filter((m) => m !== 'jump' || s.event === 'hurdle').map((m, i) => {
      const e = effect(m, s.event, r.stamina);
      return { id: i + 1, label: m, effect: e.label === 'exhausted' ? 'exhausted: +12, +1 stamina' : `+${e.gain}${m === 'overtake' ? ' (+4 if you end within 3 behind someone)' : ''}, ${e.cost > 0 ? `-${e.cost}` : `+${-e.cost}`} stamina` };
    });
  },
  defaultOption: () => 2,
  houseChoice(s, player, rng) {
    const r = s.runners.get(player)!;
    if (s.event === 'hurdle') return r.stamina >= 2 ? 5 : 3;
    if (s.leg === 0) return 3;
    if (s.leg >= LEGS - 3 && s.event !== 'turn') return r.stamina >= 3 ? 1 : 2;
    return rng() < 0.2 ? 4 : 2;
  },
  resolve(s, choices, rng) {
    const lines: string[] = [];
    const moved: [string, Runner, string][] = [];
    for (const [id, r] of s.runners) {
      const move = MOVES[(choices.get(id) ?? 2) - 1] ?? 'steady';
      const e = effect(move, s.event, r.stamina);
      const luck = Math.floor(rng() * 5) - 2;
      const clip = s.event === 'hurdle' && rng() < (CLIP[e.label] ?? 0);
      r.distance += e.gain + luck - (clip ? CLIP_LOSS : 0);
      r.stamina = Math.max(0, Math.min(MAX_STAMINA, r.stamina - e.cost));
      r.last = e.label;
      moved.push([id, r, clip ? 'clip' : e.label]);
    }
    for (const [id, r, label] of moved) {
      const ahead = [...s.runners.entries()].some(([o, x]) => o !== id && x.distance > r.distance && x.distance - r.distance <= 3);
      if (label === 'overtake' && ahead) {
        r.distance += 4;
        lines.push(`${id} overtakes!`);
      } else if (label === 'clip') lines.push(`${id} clips the hurdle! (-${CLIP_LOSS})`);
      else if (label === 'jump') lines.push(`${id} jumps clean`);
      else if (label === 'exhausted') lines.push(`${id} is exhausted`);
      else if (label === 'sprint') lines.push(`${id} ${s.event === 'turn' ? 'goes wide' : 'sprints'}`);
    }
    s.leg++;
    if (s.leg < LEGS) s.event = nextEvent(s.leg, rng);
    return lines;
  },
  round: (s) => s.leg,
  finished: (s) => s.leg >= LEGS,
  ranking(s) {
    return [...s.runners.entries()].sort(([, a], [, b]) => b.distance - a.distance || b.stamina - a.stamina || a.lot - b.lot).map(([id]) => id);
  },
  view(s) {
    return { leg: s.leg, legs: LEGS, laps: LEGS / LAP.length, stamina_max: MAX_STAMINA, event: s.event, event_text: EVENT_TEXT[s.event], runners: [...s.runners.entries()].map(([id, r]) => ({ id, distance: r.distance, stamina: r.stamina, last: r.last })) };
  },
};

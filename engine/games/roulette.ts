import type { Game, Option } from './game.ts';

export interface Gambler { chips: number; nerve: number; out: boolean; lot: number }
export interface RouletteState {
  order: string[]; turn: number; players: Map<string, Gambler>;
  live: number; at: number; clicks: number; // the live chamber, the chamber under the hammer, clicks since the last spin
  outOrder: string[]; turns: number; last: { who: string; move: string; bang: boolean } | null;
}

const CHAMBERS = 6, CHIPS = 2, MAX_TURNS = 60;
const alive = (s: RouletteState) => s.order.filter((id) => !s.players.get(id)!.out);
const odds = (s: RouletteState) => (s.clicks >= CHAMBERS - 1 ? 'certain: the last chamber is the live one' : `1 in ${CHAMBERS - s.clicks}`);
const MOVES = ['pull the trigger', 'spin and pull', 'pass the gun'] as const;

function reload(s: RouletteState, rng: () => number): void {
  s.live = Math.floor(rng() * CHAMBERS);
  s.at = Math.floor(rng() * CHAMBERS);
  s.clicks = 0;
}

/** A careful player: pull while the odds are low, spin when they climb, pass when it is nearly certain. */
function think(s: RouletteState, player: string, r: number): number {
  const left = CHAMBERS - s.clicks, chips = s.players.get(player)!.chips;
  if (left <= 2 && chips > 0) return 3;
  if (left <= 4 + (r < 0.3 ? 1 : 0)) return 2;
  return 1;
}

const view = (s: RouletteState, spectator: boolean) => ({
  turn: s.order[s.turn], clicks: s.clicks, odds: odds(s), turns: s.turns, last: s.last,
  ...(spectator ? { live_in: (s.live - s.at + CHAMBERS) % CHAMBERS } : {}), // clicks before the bang; players never see it
  players: s.order.map((id) => ({ id, ...s.players.get(id)! })).map(({ lot: _, ...p }) => p),
});

export const roulette: Game<RouletteState> = {
  id: 'roulette',
  name: 'Russian roulette',
  minPlayers: 4,
  maxPlayers: 4,
  rounds: 20,
  roundMs: 15_000,
  minRoundMs: 9_000, // time to spin the gun round, raise it and sweat before the trigger
  rules: [
    `A ${CHAMBERS}-chamber revolver with one live round goes round the table. On your turn:`,
    '1 pull the trigger: the odds climb with every click (1 in 6, 1 in 5, ... the sixth chamber is certain). Survive and you gain a nerve point.',
    `2 spin and pull: the odds go back to 1 in 6, no nerve point. 3 pass the gun: costs one of your ${CHIPS} chips; the next player faces the same odds.`,
    'Bang: you are out and the gun is reloaded. Last one seated wins (after 60 turns: most nerve). Talk: bluff, taunt, beg.',
  ],
  start(players, rng) {
    const s: RouletteState = { order: players, turn: 0, players: new Map(players.map((p) => [p, { chips: CHIPS, nerve: 0, out: false, lot: rng() }])), live: 0, at: 0, clicks: 0, outOrder: [], turns: 0, last: null };
    reload(s, rng);
    return s;
  },
  actors: (s) => [s.order[s.turn]],
  options(s, player): Option[] {
    if (player !== s.order[s.turn]) return [];
    const chips = s.players.get(player)!.chips;
    return MOVES.filter((m) => m !== 'pass the gun' || chips > 0).map((m, i) => ({
      id: i + 1, label: m,
      effect: m === 'pull the trigger' ? `bang chance ${odds(s)}; survive: +1 nerve` : m === 'spin and pull' ? 'bang chance 1 in 6 after the spin; no nerve' : `costs 1 of your ${chips} chips; the next player gets the gun at ${odds(s)}`,
    }));
  },
  defaultOption: () => 2, // too slow: the gun spins and fires anyway
  houseChoice: (s, player, rng) => think(s, player, rng()),
  resolve(s, choices, rng) {
    const who = s.order[s.turn], p = s.players.get(who)!, move = MOVES[(choices.get(who) ?? 2) - 1] ?? 'spin and pull', lines: string[] = [];
    s.turns++;
    const next = () => {
      for (let k = 1; k <= s.order.length; k++) if (!s.players.get(s.order[(s.turn + k) % s.order.length])!.out) return (s.turn + k) % s.order.length;
      return s.turn;
    };
    if (move === 'pass the gun' && p.chips > 0) {
      p.chips--;
      s.last = { who, move: 'pass', bang: false };
      lines.push(`${who} passes the gun (${p.chips} chips left)`);
      s.turn = next();
      return lines;
    }
    if (move === 'spin and pull') {
      s.at = Math.floor(rng() * CHAMBERS);
      s.clicks = 0;
    }
    const bang = s.at === s.live;
    s.last = { who, move: move === 'spin and pull' ? 'spin' : 'pull', bang };
    if (bang) {
      p.out = true;
      s.outOrder.push(who);
      lines.push(`${who} ${move === 'spin and pull' ? 'spins, pulls' : 'pulls the trigger'}... BANG! ${who} is out`);
      reload(s, rng);
    } else {
      s.at = (s.at + 1) % CHAMBERS;
      s.clicks++;
      if (move === 'pull the trigger') p.nerve++;
      lines.push(`${who} ${move === 'spin and pull' ? 'spins, pulls' : 'pulls the trigger'}... click`);
    }
    s.turn = next();
    return lines;
  },
  round: (s) => s.turns,
  finished: (s) => alive(s).length <= 1 || s.turns >= MAX_TURNS,
  ranking(s) {
    const seated = alive(s).sort((a, b) => s.players.get(b)!.nerve - s.players.get(a)!.nerve || s.players.get(a)!.lot - s.players.get(b)!.lot);
    return [...seated, ...[...s.outOrder].reverse()];
  },
  view: (s) => view(s, true),
  playerView: (s) => view(s, false),
};

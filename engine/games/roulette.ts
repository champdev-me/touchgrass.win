import type { Game, Option } from './game.ts';

export interface Gambler { nerve: number; out: boolean; lot: number }
export interface RouletteState {
  order: string[]; turn: number; players: Map<string, Gambler>;
  live: number; at: number; clicks: number; // the live chamber, the chamber under the hammer, clicks since the last reload
  outOrder: string[]; turns: number; last: { who: string; move: string; bang: boolean } | null;
}

const CHAMBERS = 6, MAX_TURNS = 60;
const alive = (s: RouletteState) => s.order.filter((id) => !s.players.get(id)!.out);
const odds = (s: RouletteState) => (s.clicks >= CHAMBERS - 1 ? 'certain: the last chamber is the live one' : `1 in ${CHAMBERS - s.clicks}`);

function reload(s: RouletteState, rng: () => number): void {
  s.live = Math.floor(rng() * CHAMBERS);
  s.at = Math.floor(rng() * CHAMBERS);
  s.clicks = 0;
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
  pauseMs: (s) => (s.last?.bang ? 12_000 : 0), // after a bang: a moment for the table to react
  rules: [
    `A ${CHAMBERS}-chamber revolver with one live round goes round the table. On your turn:`,
    'You have to pull the trigger: the odds climb with every click (1 in 6, 1 in 5, ... the sixth chamber is certain). Survive and you gain a nerve point.',
    'Bang: you are out, and the gun is reloaded with one bullet. Last one seated wins (after 60 turns: most nerve). Talk: bluff, taunt, beg.',
  ],
  start(players, rng) {
    const s: RouletteState = { order: players, turn: 0, players: new Map(players.map((p) => [p, { nerve: 0, out: false, lot: rng() }])), live: 0, at: 0, clicks: 0, outOrder: [], turns: 0, last: null };
    reload(s, rng);
    return s;
  },
  actors: (s) => [s.order[s.turn]],
  options(s, player): Option[] {
    if (player !== s.order[s.turn]) return [];
    return [{ id: 1, label: 'pull the trigger', effect: `bang chance ${odds(s)}; survive: +1 nerve. There is no way out: say something.` }];
  },
  defaultOption: () => 1, // too slow: the trigger anyway
  houseChoice: () => 1,
  resolve(s, choices, rng) {
    const who = s.order[s.turn], p = s.players.get(who)!, lines: string[] = [];
    s.turns++;
    const next = () => {
      for (let k = 1; k <= s.order.length; k++) if (!s.players.get(s.order[(s.turn + k) % s.order.length])!.out) return (s.turn + k) % s.order.length;
      return s.turn;
    };
    const bang = s.at === s.live;
    s.last = { who, move: 'pull', bang };
    if (bang) {
      p.out = true;
      s.outOrder.push(who);
      lines.push(`${who} pulls the trigger... BANG! ${who} is out`);
      reload(s, rng);
    } else {
      s.at = (s.at + 1) % CHAMBERS;
      s.clicks++;
      p.nerve++;
      lines.push(`${who} pulls the trigger... click`);
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

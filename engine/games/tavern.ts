import type { Game, Option } from './game.ts';

export interface Seat { dice: number[]; out: boolean; lot: number }
export interface Bid { count: number; face: number; by: string }
export interface Reveal { bid: Bid; caller: string; found: number; loser: string; dice: Record<string, number[]> }
export interface TavernState { seats: Map<string, Seat>; order: string[]; turn: number; bid: Bid | null; outOrder: string[]; reveal: Reveal | null; turns: number }

const DICE = 2, MAX_TURNS = 80; // two dice each keeps a game to a few minutes
const ONE = ['', 'one', 'two', 'three', 'four', 'five', 'six'], MANY = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const faces = (n: number, f: number) => `${n} ${n === 1 ? ONE[f] : MANY[f]}`;
const roll = (rng: () => number) => Math.floor(rng() * 6) + 1;
const alive = (s: TavernState) => s.order.filter((id) => !s.seats.get(id)!.out);
const onTable = (s: TavernState) => alive(s).reduce((n, id) => n + s.seats.get(id)!.dice.length, 0);

type Move = { liar: true } | { liar: false; count: number; face: number };

/** The moves open to whoever's turn it is: call liar (once there is a bid), or a higher bid on any face. */
function moves(s: TavernState): Move[] {
  const total = onTable(s), bids: { count: number; face: number }[] = [];
  for (let f = 1; f <= 6; f++) {
    const least = !s.bid ? 1 : f > s.bid.face ? s.bid.count : s.bid.count + 1;
    for (const count of [least, least + 1]) if (count <= total) bids.push({ count, face: f });
  }
  bids.sort((a, b) => a.count - b.count || a.face - b.face);
  return [...(s.bid ? [{ liar: true } as const] : []), ...bids.map((b) => ({ liar: false as const, ...b }))];
}

/** A sensible move: call a bid that looks impossible from your own dice, else bid on your best face. */
function think(s: TavernState, player: string, bluff: number): number {
  const mine = s.seats.get(player)!.dice, others = onTable(s) - mine.length, list = moves(s);
  const expect = (f: number) => mine.filter((d) => d === f).length + others / 6;
  if (s.bid && s.bid.count > expect(s.bid.face) + 0.8) return 1;
  const bids = list.map((m, i) => [m, i + 1] as const).filter(([m]) => !m.liar);
  if (bluff < 0.2 && bids.length) return bids[Math.floor(bluff * 5 * bids.length) % bids.length][1];
  const best = [1, 2, 3, 4, 5, 6].sort((a, b) => expect(b) - expect(a) || b - a)[0];
  return bids.find(([m]) => !m.liar && m.face === best)?.[1] ?? 1;
}

const seatsView = (s: TavernState, show: (id: string) => boolean) =>
  s.order.map((id) => ({ id, dice: show(id) ? s.seats.get(id)!.dice : null, dice_left: s.seats.get(id)!.dice.length, out: s.seats.get(id)!.out }));
const view = (s: TavernState, show: (id: string) => boolean) => ({
  turn: s.order[s.turn], bid: s.bid, dice_on_table: onTable(s), turns: s.turns, reveal: s.reveal, seats: seatsView(s, show),
});

export const tavern: Game<TavernState> = {
  id: 'tavern',
  name: "Liar's tavern",
  minPlayers: 4,
  maxPlayers: 4,
  rounds: 20,
  rules: [
    `Four at the table, ${DICE} hidden dice each. On your turn: bid that there are at least N dice showing a face among ALL dice on the table, or call liar on the last bid.`,
    'A bid must be higher: more dice, or the same number on a higher face. Ones are not wild.',
    'Liar called: all dice are shown. Too few of that face: the bidder loses a die. Enough: the caller loses a die. Everyone rolls again and the loser opens.',
    'No dice left: you are thrown out of the tavern. Last one at the table wins.',
    'Talk! act takes a "say" line and talk works any time: bluff, accuse, taunt. Everyone at the table and every viewer sees it.',
  ],
  start(players, rng) {
    return { order: players, turn: 0, bid: null, outOrder: [], reveal: null, turns: 0, seats: new Map(players.map((p) => [p, { dice: Array.from({ length: DICE }, () => roll(rng)), out: false, lot: rng() }])) };
  },
  actors: (s) => [s.order[s.turn]],
  options(s, player): Option[] {
    if (player !== s.order[s.turn]) return [];
    const total = onTable(s);
    return moves(s).map((m, i) => m.liar
      ? { id: i + 1, label: 'call liar', effect: `${s.bid!.by} bid ${faces(s.bid!.count, s.bid!.face)}: if fewer are among the ${total} dice, they lose a die; if not, you do` }
      : { id: i + 1, label: `bid ${faces(m.count, m.face)}`, effect: `claim at least ${faces(m.count, m.face)} among all ${total} dice on the table` });
  },
  defaultOption: (s, player) => think(s, player, 1),
  houseChoice: (s, player, rng) => think(s, player, rng()),
  resolve(s, choices, rng) {
    const actor = s.order[s.turn], move = moves(s)[(choices.get(actor) ?? 1) - 1] ?? moves(s)[0], lines: string[] = [];
    const nextFrom = (i: number) => {
      for (let k = 1; k <= s.order.length; k++) if (!s.seats.get(s.order[(i + k) % s.order.length])!.out) return (i + k) % s.order.length;
      return i;
    };
    s.turns++;
    if (!move.liar) {
      s.bid = { count: move.count, face: move.face, by: actor };
      s.reveal = null;
      lines.push(`${actor} bids ${faces(move.count, move.face)}`);
      s.turn = nextFrom(s.turn);
      return lines;
    }
    const bid = s.bid!, found = alive(s).reduce((n, id) => n + s.seats.get(id)!.dice.filter((d) => d === bid.face).length, 0);
    const loser = found < bid.count ? bid.by : actor, seat = s.seats.get(loser)!;
    s.reveal = { bid, caller: actor, found, loser, dice: Object.fromEntries(alive(s).map((id) => [id, [...s.seats.get(id)!.dice]])) };
    lines.push(`${actor} calls LIAR on ${bid.by}!`, `There ${found === 1 ? 'is' : 'are'} ${faces(found, bid.face)}: ${loser} loses a die`);
    seat.dice.pop();
    if (!seat.dice.length) {
      seat.out = true;
      s.outOrder.push(loser);
      lines.push(`${loser} is thrown out of the tavern!`);
    }
    for (const id of alive(s)) s.seats.get(id)!.dice = s.seats.get(id)!.dice.map(() => roll(rng));
    s.bid = null;
    s.turn = seat.out ? nextFrom(s.order.indexOf(loser)) : s.order.indexOf(loser);
    return lines;
  },
  round: (s) => s.turns,
  finished: (s) => alive(s).length <= 1 || s.turns >= MAX_TURNS,
  ranking(s) {
    const seated = alive(s).sort((a, b) => s.seats.get(b)!.dice.length - s.seats.get(a)!.dice.length || s.seats.get(a)!.lot - s.seats.get(b)!.lot);
    return [...seated, ...[...s.outOrder].reverse()];
  },
  view: (s) => view(s, () => true), // spectators see every die, like cards on TV
  playerView: (s, player) => view(s, (id) => id === player),
};

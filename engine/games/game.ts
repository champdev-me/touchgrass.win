/** One numbered choice on a player's menu. */
export interface Option { id: number; label: string; effect: string }

/** A turn-based arcade game: players pick menu options each round, rounds resolve together. */
export interface Game<S> {
  id: string;
  name: string;
  minPlayers: number; // house bots fill seats up to this
  maxPlayers: number;
  start(players: string[], rng: () => number): S;
  options(s: S, player: string): Option[];
  defaultOption(s: S, player: string): number;
  houseChoice(s: S, player: string, rng: () => number): number;
  resolve(s: S, choices: Map<string, number>, rng: () => number): string[]; // lines about the round, by player id
  round(s: S): number; // rounds played so far
  rounds: number;
  finished(s: S): boolean;
  ranking(s: S): string[]; // best first
  view(s: S): unknown; // what spectators see (and observe, unless playerView says otherwise)
  playerView?(s: S, player: string): unknown; // what one player may see, for hidden information
  actors?(s: S): string[];
  roundMs?: number; // decision window, if not the arcade's
  minRoundMs?: number; // a round never resolves sooner, if not the arcade's // turn-based games: who chooses this round (default: everyone)
  rules: string[];
}

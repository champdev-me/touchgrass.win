import type { Game } from './game.ts';
import { horseRace } from './horse.ts';
import { joust } from './joust.ts';

// Every game the arcade can run, by id. New games are one more line here.
export const GAMES: Record<string, Game<unknown>> = { horse_race: horseRace as Game<unknown>, joust: joust as Game<unknown> };
export const GAME_EMOJI: Record<string, string> = { horse_race: '🏇', joust: '⚔️' };

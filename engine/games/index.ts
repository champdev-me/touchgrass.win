import type { Game } from './game.ts';
import { horseRace } from './horse.ts';

// Every game the arcade can run, by id. New games are one more line here.
export const GAMES: Record<string, Game<unknown>> = { horse_race: horseRace as Game<unknown> };
export const GAME_EMOJI: Record<string, string> = { horse_race: '🏇' };

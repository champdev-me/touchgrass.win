import type { Inventory } from './items.ts';

export const CREATURE_KINDS = ['rabbit', 'deer', 'boar', 'duck', 'goblin', 'wolf', 'roomba', 'golem'] as const;
export type CreatureKind = (typeof CREATURE_KINDS)[number];

export interface CreatureDef {
  emoji: string;
  name: string;
  hp: number;
  damage: number; // per bite, at most one bite every B.monsterBiteTicks
  hostile: boolean; // hunts robots on its own
  monster: boolean; // runs home at dawn
  flees: boolean; // runs from robots that come close
  kick: number; // untamed animals sometimes kick robots that come close; 0 = never
  speed: number; // tiles per tick while chasing; below 1 moves every other tick
  drops: Inventory;
  score: number; // for the killing blow
  char: string; // observe grid
}

export const CREATURES: Record<CreatureKind, CreatureDef> = {
  rabbit: { emoji: '🐇', name: 'rabbit', hp: 5, damage: 0, hostile: false, monster: false, flees: true, kick: 3, speed: 1, drops: { meat: 1 }, score: 1, char: '%' },
  deer: { emoji: '🦌', name: 'deer', hp: 15, damage: 0, hostile: false, monster: false, flees: true, kick: 5, speed: 1, drops: { meat: 3, hide: 2 }, score: 1, char: '%' },
  boar: { emoji: '🐗', name: 'boar', hp: 25, damage: 8, hostile: false, monster: false, flees: false, kick: 6, speed: 1, drops: { meat: 4, hide: 1 }, score: 1, char: '%' },
  duck: { emoji: '🦆', name: 'Confused Duck', hp: 5, damage: 0, hostile: false, monster: false, flees: false, kick: 1, speed: 1, drops: { meat: 1 }, score: 1, char: '%' },
  goblin: { emoji: '👺', name: 'Grass Goblin', hp: 20, damage: 4, hostile: true, monster: true, flees: false, kick: 0, speed: 1, drops: { fiber: 1 }, score: 2, char: '&' },
  wolf: { emoji: '🐺', name: 'wolf', hp: 30, damage: 8, hostile: true, monster: true, flees: false, kick: 0, speed: 2, drops: { meat: 2, hide: 1 }, score: 2, char: '&' },
  roomba: { emoji: '🤖', name: 'Lost Roomba', hp: 40, damage: 0, hostile: false, monster: false, flees: false, kick: 0, speed: 1, drops: { battery: 1 }, score: 2, char: '=' },
  golem: { emoji: '🗿', name: 'Moss Golem', hp: 200, damage: 20, hostile: true, monster: true, flees: false, kick: 0, speed: 0.5, drops: { crystal: 5 }, score: 20, char: '&' },
};

export const isCreatureKind = (s: string): s is CreatureKind => (CREATURE_KINDS as readonly string[]).includes(s);

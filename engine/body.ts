import { B } from '../shared/balance.ts';
import { FOOD, FOOD_ITEMS, takeItem } from '../shared/items.ts';
import type { Agent } from '../shared/types.ts';

export type Activity = 'idle' | 'busy' | 'rest' | 'sleep';
export interface BodyNews {
  alerts: string[];
  ate: string | null;
  death: string | null;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

/** Returns true when raw food upset the stomach. */
export function eat(a: Agent, item: string, rng: () => number = Math.random): boolean {
  const f = FOOD[item];
  takeItem(a.inventory, item);
  a.food = clamp(a.food + f.food);
  a.water = clamp(a.water + f.water);
  a.energy = clamp(a.energy + (f.energy ?? 0));
  const ache = Boolean(f.tummy) && rng() < B.tummyAcheChance;
  if (ache) a.energy = clamp(a.energy - B.tummyAcheEnergy);
  return ache;
}

/** Eats the lowest-value real food carried; returns what was eaten. */
export function eatBest(a: Agent, rng: () => number = Math.random): string | null {
  const item = FOOD_ITEMS.filter((f) => FOOD[f].food > 0 && (a.inventory[f] ?? 0) > 0).sort((p, q) => FOOD[p].food - FOOD[q].food)[0];
  if (!item) return null;
  eat(a, item, rng);
  return item;
}

/** One tick of needs. Alerts fire once, on the tick a stat crosses its warning line. */
export function tickBody(a: Agent, activity: Activity): BodyNews {
  const before = { food: a.food, water: a.water, health: a.health };
  a.food = clamp(a.food + B.foodPerTick);
  a.water = clamp(a.water + B.waterPerTick);
  const empty = (a.food === 0 ? 1 : 0) + (a.water === 0 ? 1 : 0);
  if (empty) a.health = clamp(a.health + B.starvePerTick * empty);
  else if (a.food >= B.regenFood && a.water > B.regenAbove) a.health = clamp(a.health + B.regenPerTick);
  const energy = { idle: 0, busy: B.busyEnergyPerTick, rest: B.restEnergyPerTick, sleep: B.sleepEnergyPerTick }[activity];
  a.energy = clamp(a.energy + energy);

  const ate = a.autoEat && a.food < B.lowStat ? eatBest(a) : null;

  const alerts: string[] = [];
  const crossed = (was: number, now: number, line: number) => was >= line && now < line;
  if (crossed(before.food, a.food, B.lowStat)) alerts.push('You are starving. Eat something.');
  if (crossed(before.water, a.water, B.lowStat)) alerts.push('You are very thirsty. Drink next to water.');
  if (crossed(before.health, a.health, B.lowHealth)) alerts.push('Your health is low.');
  const death = a.health > 0 ? null : a.food === 0 && a.water === 0 ? 'hunger and thirst' : a.food === 0 ? 'starvation' : 'thirst';
  return { alerts, ate, death };
}

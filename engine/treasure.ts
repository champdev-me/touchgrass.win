import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, takeItem } from '../shared/items.ts';
import { TERRAIN as T, type Agent } from '../shared/types.ts';
import { walkable } from './terrain.ts';
import { GameFail, type World } from './world.ts';

export const mapOf = (x: number, y: number): string => `treasure_map:${x},${y}`;

/** Keeps treasureTarget treasures buried on open land far from the Plaza. Never sent to spectators. */
export function spawnTreasures(w: World): void {
  for (let tries = 0; w.treasures.size < w.treasureTarget && tries < 500; tries++) {
    const x = Math.floor(w.rng() * w.size), y = Math.floor(w.rng() * w.size), i = w.index(x, y);
    if (!walkable(w.at(x, y)) || w.at(x, y) === T.SHALLOW || w.solid(x, y) || w.nodes.has(i) || w.treasures.has(i)) continue;
    if (dist([x, y], w.plaza) < B.treasureMinFromPlaza) continue;
    w.treasures.set(i, { loot: 1 });
    w.treasuresDirty = true;
  }
}

/** Scouts draw a map of a treasure within 2 tiles; the map is an item anyone can trade. */
export function chart(w: World, id: string, x: number, y: number) {
  const a = w.alive(id);
  if (a.role !== 'scout') throw new GameFail('wrong_role', 'Only scouts read the land well enough to chart treasure.', 'Buy a treasure map from a scout.');
  if (!Number.isInteger(x) || !Number.isInteger(y) || !w.treasures.has(w.index(x, y)) || dist([x, y], [a.x, a.y]) > 2) {
    throw new GameFail('no_treasure', 'No buried treasure there within 2 tiles of you.', 'Stand next to a treasure you can see in observe.');
  }
  if (!takeItem(a.inventory, 'fiber', B.chartFiber)) throw new GameFail('missing_materials', `Charting costs ${B.chartFiber} fiber.`, 'Pull some grass.');
  const map = mapOf(x, y);
  if (!addItem(a.inventory, map, 1)) {
    addItem(a.inventory, 'fiber', B.chartFiber);
    throw new GameFail('bag_full', 'No room for the map.', 'Make room first.');
  }
  w.bump(a, 'chart');
  w.dirty.add(a.id);
  w.touch(a);
  return { map };
}

/** A miner holding the map finishes digging: gold, a bonus find, and a new treasure elsewhere. */
export function dig(w: World, a: Agent, i: number): string {
  const [x, y] = w.xy(i);
  takeItem(a.inventory, mapOf(x, y), 1);
  w.treasures.delete(i);
  w.treasuresDirty = true;
  const [lo, hi] = B.treasureGold, gold = lo + Math.floor(w.rng() * (hi - lo + 1));
  a.wallet += gold;
  const roll = w.rng();
  const bonus: Record<string, number> = roll < 0.4 ? { gem: 2 } : roll < 0.7 ? { crystal: 2 } : roll < 0.9 ? { iron_pickaxe: 1 } : { lucky_charm: 1 };
  for (const [item, n] of Object.entries(bonus)) if (!addItem(a.inventory, item, n)) w.dropLoot(i, { [item]: n });
  w.bump(a, 'dig:treasure');
  w.dirty.add(a.id);
  const found = Object.entries(bonus).map(([k, n]) => `${n} ${k}`).join(', ');
  w.emit('treasure', `🗺️ ${a.name} dug up buried treasure: ${gold} gold and ${found}!`, a);
  spawnTreasures(w);
  return `Task done: dug up the treasure (${gold} gold, ${found}).`;
}

import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, isClue, takeItem } from '../shared/items.ts';
import { TERRAIN as T, type Agent, type Vec } from '../shared/types.ts';
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

export interface Clue { at: number; step: number; treasure: number; hint: Vec } // at: the next find; hint: centre of the vague area

/** A random open land tile 20-60 tiles from `from`, or null. */
function spotNear(w: World, [fx, fy]: Vec): number | null {
  const [lo, hi] = B.clueHop;
  for (let tries = 0; tries < 60; tries++) {
    const ang = w.rng() * Math.PI * 2, r = lo + w.rng() * (hi - lo);
    const x = Math.round(fx + Math.cos(ang) * r), y = Math.round(fy + Math.sin(ang) * r);
    if (x < 0 || y < 0 || x >= w.size || y >= w.size || !walkable(w.at(x, y)) || w.at(x, y) === T.SHALLOW || w.solid(x, y)) continue;
    return w.index(x, y);
  }
  return null;
}

function newClue(w: World, a: Agent, from: Vec, step: number, treasure: number): string | null {
  const at = spotNear(w, from);
  if (at === null) return null;
  const [x, y] = w.xy(at), f = B.clueFuzz;
  const hint: Vec = [x + Math.round((w.rng() * 2 - 1) * f), y + Math.round((w.rng() * 2 - 1) * f)];
  const id = `clue:${w.nextClueId++}`;
  if (!addItem(a.inventory, id, 1)) return null;
  w.clues.set(id, { at, step, treasure, hint });
  w.cluesDirty = true;
  w.dirty.add(a.id);
  return id;
}

/** A lucky punch turns up the start of a trail to one of the buried treasures. */
export function findClue(w: World, a: Agent): string | null {
  const all = [...w.treasures.keys()];
  if (!all.length) return null;
  const id = newClue(w, a, [a.x, a.y], 1, all[Math.floor(w.rng() * all.length)]);
  if (id) w.note(a, `You found a clue (${id.replace(':', '_')})! It points somewhere. observe shows where; scouts read clues best.`);
  return id;
}

/** Digs around your tile for the next find on any clue you hold. */
export function search(w: World, id: string) {
  const a = w.alive(id);
  if (a.energy <= 0) throw new GameFail('too_tired', 'Too tired to dig around.', 'rest or sleep first.');
  a.energy = Math.max(0, a.energy - B.punchEnergy * 5);
  for (const item of Object.keys(a.inventory).filter(isClue)) {
    const c = w.clues.get(item);
    if (!c) continue;
    const [x, y] = w.xy(c.at);
    if (dist([x, y], [a.x, a.y]) > 1) continue;
    takeItem(a.inventory, item, 1);
    w.clues.delete(item);
    w.cluesDirty = true;
    w.dirty.add(a.id);
    w.touch(a);
    if (!w.treasures.has(c.treasure)) throw new GameFail('trail_cold', 'The trail went cold: someone already dug that treasure up.', 'Keep punching trees; there are more clues.');
    const [tx, ty] = w.xy(c.treasure);
    const found = c.step >= 2 ? mapOf(tx, ty) : newClue(w, a, [x, y], c.step + 1, c.treasure);
    if (!found || (found === mapOf(tx, ty) && !addItem(a.inventory, found, 1))) throw new GameFail('bag_full', 'You found something but have no room for it. It crumbled.', 'Keep a slot free when you search.');
    w.bump(a, 'search:found');
    return { found };
  }
  w.touch(a);
  throw new GameFail('nothing_here', 'Nothing but dirt.', 'Stand within 1 tile of the spot your clue points at.');
}

/** How a robot reads its clues: scouts exactly, everyone else roughly. */
export function clueLines(w: World, a: Agent, terrainName: (x: number, y: number) => string): string[] {
  return Object.keys(a.inventory).filter(isClue).flatMap((item) => {
    const c = w.clues.get(item);
    if (!c) return [];
    const [x, y] = w.xy(c.at), label = `${item.replace(':', '_')} (step ${c.step} of 3)`;
    return a.role === 'scout' ? [`${label}: the next find is at (${x}, ${y})`] : [`${label}: somewhere within ${B.clueFuzz} tiles of (${c.hint[0]}, ${c.hint[1]}), near ${terrainName(x, y)}`];
  });
}

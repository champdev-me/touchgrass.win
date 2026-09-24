import { ITEMS } from '../shared/items.ts';
import type { Agent } from '../shared/types.ts';
import type { World } from './world.ts';

const pretty = (item: string) => item.replace('_', ' ');

/** One use of a carried gear item; true when it broke (and is gone). */
export function useGear(w: World, a: Agent, item: string): boolean {
  const def = ITEMS[item];
  if (!def?.uses || !(a.inventory[item] > 0)) return false;
  a.wear[item] = (a.wear[item] ?? def.uses) - 1;
  if (a.wear[item] > 0) return false;
  if (item === 'waterskin') return false; // empties, refills at water; never breaks
  a.inventory[item] -= 1;
  if (!a.inventory[item]) delete a.inventory[item];
  if (a.inventory[item]) a.wear[item] = def.uses;
  else delete a.wear[item];
  const line = item === 'torch' ? `${a.name}'s torch burned out.` : `${a.name}'s ${pretty(item)} snapped mid-swing.`;
  w.note(a, line);
  w.emit('broke', `🔧 ${line}`, a);
  return true;
}

/** The best carried tool for a node kind. */
export function bestTool(a: Agent, node: string): { item: string; tier: 1 | 2 } | null {
  let best: { item: string; tier: 1 | 2 } | null = null;
  for (const item of Object.keys(a.inventory)) {
    const t = ITEMS[item]?.tool;
    if (t && t.nodes.includes(node) && (!best || t.tier > best.tier)) best = { item, tier: t.tier };
  }
  return best;
}

/** Share of damage absorbed: the best armor carried counts. */
export const armorOf = (a: Agent): number => Math.max(0, ...Object.keys(a.inventory).map((i) => ITEMS[i]?.armor ?? 0));

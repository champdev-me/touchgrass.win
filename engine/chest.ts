import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, room, takeItem, type Inventory } from '../shared/items.ts';
import type { Agent, Structure } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

/** A chest holds 12 slots, the same as a bag without a backpack, so it reuses the bag rules. */
const bagOf = (s: Structure): Inventory => (s.items ??= {});

function ownChest(w: World, a: Agent): Structure {
  let best: [Structure, number] | null = null;
  for (const [i, s] of w.structures) {
    const d = dist(w.xy(i), [a.x, a.y]);
    if (s.kind === 'chest' && s.owner === a.id && d <= B.stationRange && (!best || d < best[1])) best = [s, d];
  }
  if (!best) throw new GameFail('no_chest', `None of your chests is within ${B.stationRange} tiles.`, 'build(chest) costs 4 wood. Chests only open for their owner.');
  return best[0];
}

export function store(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id), chest = ownChest(w, a), n = Math.max(1, Math.floor(count));
  if (item === 'backpack') throw new GameFail('no_backpacks', 'Chests do not wear backpacks.', 'Carry it instead.');
  if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
  if (room(bagOf(chest), item) < n) throw new GameFail('chest_full', 'The chest is full.', `A chest holds ${B.chestSlots} slots. Take something out or build another.`);
  takeItem(a.inventory, item, n);
  addItem(bagOf(chest), item, n);
  w.structuresDirty = true;
  w.dirty.add(a.id);
  w.touch(a);
  return { stored: `${n} ${item}`, chest: chest.items };
}

export function take(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id), chest = ownChest(w, a), n = Math.max(1, Math.floor(count));
  if ((bagOf(chest)[item] ?? 0) < n) throw new GameFail('missing_items', `The chest has no ${n} ${item}.`, 'observe lists what is inside.');
  if (room(a.inventory, item) < n) throw new GameFail('bag_full', 'No room in your bag.', 'Take less.');
  takeItem(bagOf(chest), item, n);
  addItem(a.inventory, item, n);
  w.structuresDirty = true;
  w.dirty.add(a.id);
  w.touch(a);
  return { took: `${n} ${item}`, chest: chest.items };
}

import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, room, takeItem } from '../shared/items.ts';
import { GameFail, type World } from './world.ts';

/** Hand items (or "gold") to a robot within 2 tiles. */
export function give(w: World, id: string, to: string, item: string, count = 1) {
  const a = w.alive(id), n = Math.max(1, Math.floor(count));
  const b = w.agents.get(to);
  if (!b || b.id === a.id || !b.joined || b.dead) throw new GameFail('bad_target', 'There is nobody like that to give to.', 'Use an agent id from observe.');
  if (dist([b.x, b.y], [a.x, a.y]) > B.giveRange) throw new GameFail('too_far', `${b.name} is too far away.`, `Stand within ${B.giveRange} tiles.`);
  if (item === 'gold') {
    if (a.wallet < n) throw new GameFail('not_enough_gold', `You only have ${a.wallet} gold.`, 'Give less.');
    a.wallet -= n;
    b.wallet += n;
  } else {
    if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
    if (room(b.inventory, item) < n) throw new GameFail('their_bag_full', `${b.name}'s bag is too full.`, 'Give less.');
    takeItem(a.inventory, item, n);
    addItem(b.inventory, item, n);
  }
  w.note(b, `${a.name} gave you ${n} ${item}.`);
  w.dirty.add(a.id);
  w.dirty.add(b.id);
  w.touch(a);
  return { gave: `${n} ${item}`, to: b.name };
}

/** Leave items in a loot pile underfoot; anyone can pick it up until it rots. */
export function drop(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id), n = Math.max(1, Math.floor(count));
  if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
  takeItem(a.inventory, item, n);
  w.dropLoot(w.index(a.x, a.y), { [item]: n });
  w.dirty.add(a.id);
  w.touch(a);
  return { dropped: `${n} ${item}` };
}

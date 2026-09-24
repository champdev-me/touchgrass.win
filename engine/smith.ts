import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { BLUEPRINTS, ITEMS, SMITH_BUYS, SMITH_SELLS, addItem, room, takeItem } from '../shared/items.ts';
import type { Vec } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

export const smithAt = (w: World): Vec => w.plaza;

/** What the Smith pays for one unit now: less the more he already holds. */
export const buyPrice = (w: World, item: string): number =>
  SMITH_BUYS[item] ? Math.max(1, Math.round((SMITH_BUYS[item] * B.marketDepth) / (B.marketDepth + (w.market[item] ?? 0)))) : 0;

export function smith(w: World, id: string, action: string, item = '', count = 1) {
  const a = w.alive(id);
  if (dist(smithAt(w), [a.x, a.y]) > B.smithRange) {
    throw new GameFail('too_far', 'The Smith cannot hear you from there.', `Walk to the Smith at the Plaza, (${smithAt(w).join(', ')}).`);
  }
  const n = Math.max(1, Math.min(100, Math.floor(count)));
  if (action === 'prices') {
    const buying = Object.fromEntries(Object.keys(SMITH_BUYS).map((i) => [i, buyPrice(w, i)]));
    const stocked = Object.fromEntries(Object.entries(w.market).filter(([, k]) => k >= 1).map(([i, k]) => [i, { price: SMITH_BUYS[i] * 2, stock: Math.floor(k) }]));
    return { buying, selling: { ...Object.fromEntries(Object.entries(SMITH_SELLS).map(([i, s]) => [i, `${s.count} for ${s.price}`])), ...stocked }, blueprints: BLUEPRINTS, your_gold: a.wallet };
  }
  if (action === 'sell') {
    if (!SMITH_BUYS[item]) throw new GameFail('not_buying', `The Smith does not want ${item}.`, `He buys: ${Object.keys(SMITH_BUYS).join(', ')}.`);
    if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
    let earned = 0;
    for (let i = 0; i < n; i++) {
      earned += buyPrice(w, item);
      w.market[item] = (w.market[item] ?? 0) + 1;
    }
    takeItem(a.inventory, item, n);
    a.wallet += earned;
    w.bump(a, `sell:${item}`);
    w.marketDirty = true;
    w.dirty.add(a.id);
    return { sold: `${n} ${item}`, gold_earned: earned, gold: a.wallet, next_price: buyPrice(w, item) };
  }
  if (action === 'blueprint') {
    const price = BLUEPRINTS[item];
    if (price === undefined) throw new GameFail('unknown_blueprint', `There is no "${item}" blueprint.`, `Blueprints: ${Object.keys(BLUEPRINTS).join(', ')}.`);
    if (a.blueprints.includes(item)) throw new GameFail('already_known', 'You already know that one.', 'Craft it at a workbench.');
    if (a.wallet < price) throw new GameFail('not_enough_gold', `That costs ${price} gold; you have ${a.wallet}.`, 'Sell ore, crystals, hides or meat to the Smith.');
    a.wallet -= price;
    a.blueprints.push(item);
    w.dirty.add(a.id);
    return { learned: item, gold: a.wallet };
  }
  if (action === 'buy') {
    const shop = SMITH_SELLS[item];
    const stocked = (w.market[item] ?? 0) >= n && SMITH_BUYS[item];
    if (!shop && !stocked) throw new GameFail(SMITH_BUYS[item] ? 'out_of_stock' : 'not_selling', `The Smith has no ${item} for you.`, 'Try smith(prices) to see what he has.');
    const units = shop ? shop.count * n : n, price = shop ? shop.price * n : SMITH_BUYS[item] * 2 * n;
    if (a.wallet < price) throw new GameFail('not_enough_gold', `That costs ${price} gold; you have ${a.wallet}.`, 'Sell something first.');
    if (room(a.inventory, item) < units) throw new GameFail('bag_full', 'No room in your bag for that.', 'Eat, sell or drop something first.');
    addItem(a.inventory, item, units);
    if (ITEMS[item]?.uses && a.wear[item] === undefined) a.wear[item] = ITEMS[item].uses!;
    if (!shop) w.market[item] -= n;
    a.wallet -= price;
    w.marketDirty = true;
    w.dirty.add(a.id);
    return { bought: `${units} ${item}`, gold_spent: price, gold: a.wallet };
  }
  throw new GameFail('bad_action', `The Smith does not know how to "${action}".`, 'Use buy, sell, blueprint or prices.');
}

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

/** The Smith uses up a little of his stock every minute, so prices recover. */
export function decayMarket(w: World): void {
  for (const [item, n] of Object.entries(w.market)) {
    const left = n * (1 - B.marketDecay);
    if (left < 0.5) delete w.market[item];
    else w.market[item] = left;
  }
  w.marketDirty = true;
}

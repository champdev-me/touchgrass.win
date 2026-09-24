import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, isMap, room, takeItem, type Inventory } from '../shared/items.ts';
import type { Agent } from '../shared/types.ts';
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

export interface Offer { id: string; from: string; to: string; give: Inventory; want: Inventory; expiresAt: number }

const describe = (inv: Inventory) => Object.entries(inv).map(([i, n]) => `${n} ${i}`).join(', ') || 'nothing';
const publicly = (inv: Inventory) => Object.entries(inv).map(([i, n]) => (isMap(i) ? 'a treasure_map' : `${n} ${i}`)).join(', ') || 'nothing'; // news never names a treasure spot
const clean = (inv: Inventory): Inventory => Object.fromEntries(Object.entries(inv).filter(([, n]) => Number.isInteger(n) && n > 0));

/** Throws unless `a` holds everything in `inv` ("gold" comes from the wallet). */
function holds(a: Agent, inv: Inventory, code: 'missing_items' | 'offer_gone_stale') {
  for (const [item, n] of Object.entries(inv)) {
    if (item === 'gold' ? a.wallet >= n : (a.inventory[item] ?? 0) >= n) continue;
    if (item === 'gold') throw new GameFail('not_enough_gold', `${a.name} does not have ${n} gold.`, 'Offer less, or earn more.');
    throw new GameFail(code, code === 'missing_items' ? `${a.name} does not have ${n} ${item}.` : `${a.name} no longer has ${n} ${item}.`, 'Check the bags and make a new offer.');
  }
}

function fits(a: Agent, inv: Inventory): boolean {
  const bag = { ...a.inventory };
  return Object.entries(inv).every(([item, n]) => item === 'gold' || addItem(bag, item, n) === n);
}

function move(from: Agent, to: Agent, inv: Inventory) {
  for (const [item, n] of Object.entries(inv)) {
    if (item === 'gold') {
      from.wallet -= n;
      to.wallet += n;
    } else {
      takeItem(from.inventory, item, n);
      addItem(to.inventory, item, n);
    }
  }
}

function near(a: Agent, b: Agent) {
  if (dist([a.x, a.y], [b.x, b.y]) > B.tradeRange) throw new GameFail('too_far', `${b.name} is too far away to trade.`, `Stand within ${B.tradeRange} tiles.`);
}

/** Proposes a swap to a robot nearby; nothing moves until they accept. */
export function offer(w: World, id: string, to: string, give: Inventory, want: Inventory) {
  const a = w.alive(id), b = w.agents.get(to);
  if (!b || b.id === a.id || !b.joined || b.dead) throw new GameFail('bad_target', 'There is nobody like that to trade with.', 'Use an agent id from observe.');
  const g = clean(give), wt = clean(want);
  if (!Object.keys(g).length && !Object.keys(wt).length) throw new GameFail('empty_offer', 'An offer of nothing for nothing. Very zen.', 'Put something in give or want.');
  near(a, b);
  holds(a, g, 'missing_items');
  for (const [oid, o] of w.offers) if (o.from === a.id && o.to === b.id) w.offers.delete(oid); // one per pair
  const o: Offer = { id: `offer_${w.nextOfferId++}`, from: a.id, to: b.id, give: g, want: wt, expiresAt: w.tick + B.offerTicks };
  w.offers.set(o.id, o);
  w.note(b, `${a.name} offers you ${describe(g)} for ${describe(wt)} (${o.id}). accept or decline within ${B.offerTicks}s.`);
  w.touch(a);
  return { offer: o.id, expires_in_seconds: B.offerTicks };
}

/** Swaps both sides at once, or nothing at all. */
export function accept(w: World, id: string, offerId: string) {
  const b = w.alive(id), o = w.offers.get(offerId);
  if (!o) throw new GameFail('no_offer', 'That offer is gone.', 'observe shows your open offers.');
  if (o.to !== b.id) throw new GameFail('not_yours', 'That offer was made to someone else.', 'You can only accept offers made to you.');
  const a = w.agents.get(o.from);
  if (!a || a.dead || !a.joined) {
    w.offers.delete(o.id);
    throw new GameFail('no_offer', 'The other robot is not around any more.', 'Make a new deal.');
  }
  near(b, a);
  holds(a, o.give, 'offer_gone_stale');
  holds(b, o.want, 'missing_items');
  if (!fits(b, o.give)) throw new GameFail('bag_full', 'Your bag has no room for all that.', 'Drop or store something first.');
  if (!fits(a, o.want)) throw new GameFail('their_bag_full', `${a.name}'s bag has no room for your side.`, 'Ask them to make room.');
  move(a, b, o.give);
  move(b, a, o.want);
  w.offers.delete(o.id);
  for (const r of [a, b]) {
    w.bump(r, 'trades');
    w.dirty.add(r.id);
  }
  if (Object.keys(o.give).some(isMap)) w.bump(a, 'sold:map');
  if (Object.keys(o.want).some(isMap)) w.bump(b, 'sold:map');
  w.note(a, `${b.name} accepted: you gave ${describe(o.give)} and got ${describe(o.want)}.`);
  if ((o.give.gold ?? 0) >= B.bigTradeGold || (o.want.gold ?? 0) >= B.bigTradeGold) {
    w.emit('trade', `💰 ${a.name} traded ${publicly(o.give)} to ${b.name} for ${publicly(o.want)}.`, a, b);
  }
  w.touch(b);
  return { traded: `${describe(o.want)} for ${describe(o.give)}`, with: a.name };
}

export function decline(w: World, id: string, offerId: string) {
  const b = w.alive(id), o = w.offers.get(offerId);
  if (!o || o.to !== b.id) throw new GameFail('no_offer', 'No such offer to you.', 'observe shows your open offers.');
  w.offers.delete(o.id);
  const a = w.agents.get(o.from);
  if (a) w.note(a, `${b.name} declined your offer (${o.id}).`);
  w.touch(b);
  return { declined: o.id };
}

export function expireOffers(w: World): void {
  for (const [oid, o] of w.offers) {
    if (o.expiresAt > w.tick) continue;
    w.offers.delete(oid);
    const a = w.agents.get(o.from), b = w.agents.get(o.to);
    if (a) w.note(a, `Your offer to ${b?.name ?? 'someone'} expired (${oid}).`);
    if (b) w.note(b, `The offer from ${a?.name ?? 'someone'} expired (${oid}).`);
  }
}

export function offerLines(w: World, a: Agent): { incoming: string[]; outgoing: string[] } {
  const line = (o: Offer, dir: 'from' | 'to') => {
    const other = w.agents.get(dir === 'from' ? o.from : o.to);
    return `${o.id} ${dir} ${other?.name ?? '?'} (${other?.id ?? '?'}): gives ${describe(o.give)}, wants ${describe(o.want)}, ${Math.max(0, o.expiresAt - w.tick)} s left`;
  };
  const all = [...w.offers.values()];
  return { incoming: all.filter((o) => o.to === a.id).map((o) => line(o, 'from')), outgoing: all.filter((o) => o.from === a.id).map((o) => line(o, 'to')) };
}

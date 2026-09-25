import { B } from '../shared/balance.ts';
import { addItem, room, takeItem } from '../shared/items.ts';
import { GameFail, type World } from './world.ts';

/** Goods on sale in the world market; they are held by the market until bought or cancelled. */
export interface Listing { id: string; seller: string; item: string; count: number; price: number }

export function sell(w: World, id: string, item: string, count: number, price: number) {
  const a = w.alive(id), n = Math.floor(count), p = Math.floor(price);
  if (!Number.isInteger(n) || n < 1) throw new GameFail('bad_count', 'Sell at least 1.', 'sell(item, count, price)');
  if (!Number.isInteger(p) || p < 1) throw new GameFail('bad_price', 'The price is whole gold per item, at least 1.', 'sell(item="iron_ore", count=5, price=4)');
  if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
  if ([...w.listings.values()].filter((l) => l.seller === a.id).length >= B.maxListings) throw new GameFail('too_many_listings', `You already have ${B.maxListings} things on sale.`, 'cancel_sale one first.');
  takeItem(a.inventory, item, n);
  const l: Listing = { id: `sale_${w.nextListingId++}`, seller: a.id, item, count: n, price: p };
  w.listings.set(l.id, l);
  w.listingsDirty = true;
  w.dirty.add(a.id);
  w.emit('market', `🏷️ ${a.name} is selling ${n} ${item} at ${p} gold each.`, a);
  w.touch(a);
  return { listing: l.id };
}

export function buy(w: World, id: string, listing: string, count?: number) {
  const b = w.alive(id), l = w.listings.get(listing);
  if (!l) throw new GameFail('no_listing', 'That listing is gone.', 'market shows what is on sale.');
  if (l.seller === b.id) throw new GameFail('own_listing', 'That is your own listing.', 'cancel_sale to take it back.');
  const n = Math.max(1, Math.min(l.count, Math.floor(count ?? l.count))), cost = n * l.price;
  if (b.wallet < cost) throw new GameFail('not_enough_gold', `${n} ${l.item} cost ${cost} gold; you have ${b.wallet}.`, 'Buy fewer, or earn more.');
  if (room(b.inventory, l.item) < n) throw new GameFail('bag_full', 'No room in your bag for that.', 'Store or sell something first.');
  const s = w.agents.get(l.seller);
  addItem(b.inventory, l.item, n);
  b.wallet -= cost;
  l.count -= n;
  if (!l.count) w.listings.delete(l.id);
  if (s) {
    s.wallet += cost;
    w.bump(s, 'sales');
    s.stats['earned:gold'] = (s.stats['earned:gold'] ?? 0) + cost;
    w.note(s, `${b.name} bought ${n} ${l.item} from you for ${cost} gold.`);
    w.dirty.add(s.id);
  }
  w.listingsDirty = true;
  w.dirty.add(b.id);
  w.emit('market', `📈 ${s?.name ?? 'someone'} sold ${n} ${l.item} to ${b.name} for ${cost} gold.`, b, s);
  w.touch(b);
  return { bought: `${n} ${l.item}`, paid: cost };
}

export function cancelSale(w: World, id: string, listing: string) {
  const a = w.alive(id), l = w.listings.get(listing);
  if (!l) throw new GameFail('no_listing', 'That listing is gone.', 'market shows what is on sale.');
  if (l.seller !== a.id) throw new GameFail('not_yours', 'That is not your listing.', 'You can only cancel your own.');
  if (room(a.inventory, l.item) < l.count) throw new GameFail('bag_full', 'No room in your bag to take it back.', 'Make room first.');
  addItem(a.inventory, l.item, l.count);
  w.listings.delete(l.id);
  w.listingsDirty = true;
  w.dirty.add(a.id);
  w.touch(a);
  return { cancelled: l.id };
}

/** The order book: cheapest first, optionally for one item. */
export function marketView(w: World, item?: string) {
  const list = [...w.listings.values()].filter((l) => !item || l.item === item).sort((p, q) => p.price - q.price || p.id.localeCompare(q.id));
  return { listings: list.slice(0, 30).map((l) => `${l.id}: ${l.count} ${l.item} at ${l.price} gold each, by ${w.agents.get(l.seller)?.name ?? '?'}`) };
}

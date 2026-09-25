import { B } from '../shared/balance.ts';
import { CREATURES } from '../shared/creatures.ts';
import { RECIPES, STRUCTURES, isStructure } from '../shared/items.ts';
import type { Role } from '../shared/types.ts';
import { NODE_DEF } from './nodes.ts';
import { GameFail, type World } from './world.ts';

const call = (tool: string, args: Record<string, unknown>) => `${tool} ${JSON.stringify(args)}`;

/** Where a material comes from, as one short line with the call that gets it. */
function source(item: string, role: Role | null): string {
  const nodes = Object.entries(NODE_DEF).filter(([, d]) => d.item === item);
  if (nodes.length) {
    return nodes.map(([kind, d]) => {
      const who = d.roles && !d.roles.includes(role!) ? ` (only ${d.roles.join('/')}s; buy it from one with offer)` : '';
      return `${item}: ${call('gather', { target: kind })}${d.needsPickaxe ? ', needs a pickaxe' : ''}${who}`;
    }).join('; ');
  }
  const prey = Object.entries(CREATURES).filter(([, c]) => (c.drops[item] ?? 0) > 0).map(([k]) => k);
  if (prey.length) return `${item}: hunt ${prey.slice(0, 3).join(', ')} with ${call('attack', { target: prey[0] })}${item === 'meat' || item === 'hide' ? (role === 'hunter' ? '' : ' (animals only drop it for hunters; buy it from one)') : ''}`;
  if (RECIPES[item]) return `${item}: crafted, ask ${call('how', { thing: item })}`;
  return `${item}: trade for it with offer`;
}

const TOPICS: Record<string, (w: World) => string[]> = {
  land: () => [
    'You get a 5x5 base on land when you join; observe shows you.base and the price of the next strip on each side.',
    `Grow it standing inside it: ${call('buy_land', { direction: 'e' })} (n, e, s or w), paid in gold; land only, max ${B.baseMaxSide} tiles a side.`,
    'Inside someone else\'s base you may walk, talk, fight and trade, but not gather, build, plant or harvest.',
  ],
  market: () => [
    `Put goods on sale: ${call('sell', { item: 'iron_ore', count: 10, price: 4 })}. See what is for sale: ${call('market', { item: 'iron_ore' })}. Buy: ${call('buy', { listing: 'sale_3', count: 5 })}.`,
  ],
  trade: () => [
    `Offer a swap to a robot within ${B.tradeRange} tiles: ${call('offer', { agent: 'agent_7', give: { wood: 10 }, want: { gold: 8 } })}.`,
    `They answer with ${call('accept', { offer: 'offer_3' })} or decline within ${B.offerTicks}s; nothing moves unless both sides still have the goods.`,
  ],
  treasure: () => [
    `Scouts see buried treasure and chart it: ${call('chart', { x: 100, y: 200 })} (2 fiber). Clues turn up while gathering; ${call('search', {})} at a clue's spot.`,
    `Whoever holds the map digs: ${call('gather', { target: 'treasure' })} (faster with a pickaxe).`,
  ],
  duel: () => [
    `Stand in their base: ${call('challenge', { agent: 'agent_7' })} (stakes ${B.duelStake} gold). If challenged: ${call('answer_challenge', { answer: 'accept' })}.`,
    `In the ring: ${call('fight', { moves: ['block', 'lunge', 'slash', 'block', 'lunge'] })}. Block beats slash, lunge beats block, slash beats lunge.`,
  ],
  roles: () => [`Change jobs at home, once every ${B.switchRoleTicks / 60} min: ${call('switch_role', { role: 'carpenter' })}. No new starter kit.`],
};

/** A step-by-step answer for making, building or getting something, with the exact tool calls. */
export function howTo(w: World, id: string, thing: string) {
  const a = w.get(id), t = thing.trim().toLowerCase().replaceAll(' ', '_'), role = a.role;
  if (TOPICS[t]) return { thing: t, steps: TOPICS[t](w) };
  const steps: string[] = [];
  const who = (roles?: Role[]) => (roles && !roles.includes(role!) ? `Only ${roles.join('/')}s can do this. Buy it from one with offer, or ${call('switch_role', { role: roles[0] })} at home.` : null);
  if (isStructure(t)) {
    const d = STRUCTURES[t];
    const w1 = who(d.roles);
    if (w1) steps.push(w1);
    steps.push(t === 'campfire' ? 'Build it anywhere outside the Plaza.' : 'Build it inside your own base (observe shows you.base).');
    for (const [m, n] of Object.entries(d.needs)) steps.push(`Get ${n} ${source(m, role)}`);
    if (t === 'farm_plot') steps.push('Carry a hoe (smiths craft it) and stand by meadow or sand.');
    steps.push(`Then: ${call('build', { structure: t })} (or add x and y for a tile within ${B.stationRange} of you).`);
    return { thing: t, steps };
  }
  const r = RECIPES[t];
  if (r) {
    const w1 = who(r.roles);
    if (w1) steps.push(w1);
    if (r.station !== 'hand') steps.push(`Stand within ${B.stationRange} tiles of a ${r.station}${r.station === 'campfire' ? ' (lit)' : ''}; ${call('how', { thing: r.station })} if you have none.`);
    for (const [m, n] of Object.entries(r.needs)) steps.push(`Get ${n} ${source(m, role)}`);
    steps.push(`Then: ${call('craft', { item: t })}.`);
    return { thing: t, steps };
  }
  if (Object.values(NODE_DEF).some((d) => d.item === t) || Object.values(CREATURES).some((c) => (c.drops[t] ?? 0) > 0)) return { thing: t, steps: [source(t, role)] };
  const known = [...Object.keys(TOPICS), ...Object.keys(STRUCTURES), ...Object.keys(RECIPES)];
  throw new GameFail('unknown_thing', `No recipe, building or topic called "${thing}".`, `Try one of: ${known.join(', ')}.`);
}

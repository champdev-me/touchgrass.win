import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { ITEMS, RECIPES, STRUCTURES, addItem, isStructure, takeItem, type Inventory } from '../shared/items.ts';
import { TERRAIN as T, type Agent, type Vec } from '../shared/types.ts';
import { useGear } from './gear.ts';
import { addScore } from './score.ts';
import { isLand, lockCheck } from './bases.ts';
import { walkable } from './terrain.ts';
import { GameFail, type World } from './world.ts';

const has = (a: Agent, needs: Inventory, times = 1) => Object.entries(needs).every(([m, n]) => (a.inventory[m] ?? 0) >= n * times);
const missing = (a: Agent, needs: Inventory, times = 1) =>
  Object.entries(needs).filter(([m, n]) => (a.inventory[m] ?? 0) < n * times).map(([m, n]) => `${n * times - (a.inventory[m] ?? 0)} ${m}`).join(', ');

export function craft(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id);
  const r = RECIPES[item];
  if (!r) throw new GameFail('unknown_recipe', `Nobody knows how to make "${item}".`, `Recipes: ${Object.keys(RECIPES).join(', ')}. The rules tool lists what each needs.`);
  if (r.roles && !r.roles.includes(a.role!)) throw new GameFail('wrong_role', `Only ${r.roles.join(' or ')}s can make ${item}.`, `Offer a ${r.roles[0]} something for it.`);
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  if (r.station !== 'hand' && !w.stationNear(a, r.station)) throw new GameFail('no_station', `You need a ${r.station === 'campfire' ? 'lit campfire' : r.station} within ${B.stationRange} tiles.`, `build(${r.station}) one first.`);
  if (!has(a, r.needs, n)) throw new GameFail('missing_materials', `You need ${missing(a, r.needs, n)} more.`, 'Gather, trade or buy them.');
  let made = 0;
  for (; made < n; made++) {
    for (const [m, k] of Object.entries(r.needs)) takeItem(a.inventory, m, k);
    if (addItem(a.inventory, item, 1)) continue;
    for (const [m, k] of Object.entries(r.needs)) addItem(a.inventory, m, k); // no room: give the materials back
    break;
  }
  if (!made) throw new GameFail('bag_full', 'No room in your bag for it.', 'Eat, sell or drop something first.');
  if (ITEMS[item].uses && a.wear[item] === undefined) a.wear[item] = ITEMS[item].uses!;
  for (let i = 0; i < made; i++) w.bump(a, `craft:${item}`);
  w.touch(a);
  return { crafted: item, count: made, inventory: a.inventory };
}

const free = (w: World, x: number, y: number) =>
  isLand(w, x, y) && !w.structures.has(w.index(x, y)) && !w.nodes.has(w.index(x, y)) && ![...w.agents.values()].some((o) => o.joined && !o.dead && o.x === x && o.y === y);

/** Places a structure on a free tile next to you, or on (x, y) within 2 tiles. Only campfires go outside your base. */
export function build(w: World, id: string, kind: string, x?: number, y?: number) {
  const a = w.alive(id);
  if (!isStructure(kind)) throw new GameFail('bad_structure', `You cannot build "${kind}".`, `Buildable: ${Object.keys(STRUCTURES).join(', ')}.`);
  if (w.at(a.x, a.y) === T.PLAZA) throw new GameFail('plaza_rules', 'No building in the Plaza. It is for trading.', 'Walk out of the Plaza first.');
  const def = STRUCTURES[kind], cost = def.needs;
  if (def.roles && !def.roles.includes(a.role!)) throw new GameFail('wrong_role', `Only ${def.roles.join(' or ')}s can build a ${kind}.`, `Ask a ${def.roles[0]} to build one, or switch_role at home.`);
  if (kind === 'bed' && [...w.structures.values()].some((s) => s.kind === 'bed' && s.owner === a.id)) throw new GameFail('one_bed', 'You already have a bed.', 'demolish the old one first.');
  if (!has(a, cost)) throw new GameFail('missing_materials', `You need ${missing(a, cost)} more.`, 'Gather them first.');
  let spot: Vec | undefined;
  if (x !== undefined && y !== undefined) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || dist([x, y], [a.x, a.y]) > B.stationRange) throw new GameFail('too_far', `Build within ${B.stationRange} tiles of you.`, 'Walk closer.');
    if (!free(w, x, y)) throw new GameFail('no_space', 'That tile is not free open land.', 'Pick an empty land tile.');
    spot = [x, y];
  } else {
    spot = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Vec[]).map(([dx, dy]): Vec => [a.x + dx, a.y + dy])
      .find(([sx, sy]) => free(w, sx, sy) && Math.abs(w.height(sx, sy) - w.height(a.x, a.y)) <= B.maxClimb);
  }
  if (!spot) throw new GameFail('no_space', 'There is no free spot next to you.', 'Stand somewhere with open ground around you.');
  lockCheck(w, a, spot[0], spot[1]);
  if (kind === 'farm_plot') {
    if (!(a.inventory.hoe ?? 0)) throw new GameFail('no_hoe', 'You need a hoe to till the ground.', 'Smiths craft hoes.');
    if (w.at(spot[0], spot[1]) !== T.MEADOW && w.at(spot[0], spot[1]) !== T.SAND) throw new GameFail('bad_ground', 'Crops only grow on meadow or sand.', 'Pick another tile.');
  }
  if (kind !== 'campfire' && w.baseAt(spot[0], spot[1])?.owner !== a.id) throw new GameFail('not_home', `A ${kind} goes inside your own base.`, 'Walk home first (observe shows your base); only campfires go anywhere.');
  for (const [m, k] of Object.entries(cost)) takeItem(a.inventory, m, k);
  w.structures.set(w.index(spot[0], spot[1]), { kind, owner: a.id, litUntil: kind === 'campfire' ? w.tick + B.campfireTicks : 0, ...(kind === 'chest' ? { items: {} } : {}) });
  if (kind === 'farm_plot') useGear(w, a, 'hoe');
  w.structuresDirty = true;
  w.bump(a, `build:${kind}`);
  w.touch(a);
  return { built: kind, at: spot };
}

/** Removes your own structure (or an ownerless ruin) within 2 tiles: half the materials back, chests spill. */
export function demolish(w: World, id: string, x: number, y: number) {
  const a = w.alive(id), i = w.index(x, y), s = w.structures.get(i);
  if (!s || dist([x, y], [a.x, a.y]) > B.stationRange) throw new GameFail('nothing_there', `No structure at (${x}, ${y}) within ${B.stationRange} tiles.`, 'Stand next to it.');
  if (s.owner && s.owner !== a.id) throw new GameFail('not_yours', 'That is not yours to knock down.', 'Only the owner can demolish it.');
  const back: Inventory = {};
  for (const [m, n] of Object.entries(STRUCTURES[s.kind].needs)) if (Math.floor(n / 2) > 0) back[m] = Math.floor(n / 2);
  const spill: Inventory = { ...(s.items ?? {}) };
  for (const [m, n] of Object.entries(back)) {
    const got = addItem(a.inventory, m, n);
    if (got < n) spill[m] = (spill[m] ?? 0) + n - got;
  }
  w.structures.delete(i);
  if (Object.keys(spill).length) w.dropLoot(i, spill);
  w.structuresDirty = true;
  w.touch(a);
  return { demolished: s.kind, got_back: back };
}

/** One wood keeps the nearest campfire burning longer. */
export function fuel(w: World, id: string) {
  const a = w.alive(id);
  let best: [number, number] | null = null;
  for (const [i, s] of w.structures) {
    const d = dist(w.xy(i), [a.x, a.y]);
    if (s.kind === 'campfire' && d <= B.stationRange && (!best || d < best[1])) best = [i, d];
  }
  if (!best) throw new GameFail('no_station', `No campfire within ${B.stationRange} tiles.`, 'build(campfire) first.');
  if (!takeItem(a.inventory, 'wood', 1)) throw new GameFail('missing_materials', 'You need 1 wood to feed the fire.', 'Gather wood first.');
  const fire = w.structures.get(best[0])!;
  fire.litUntil = Math.max(fire.litUntil, w.tick) + B.campfireTicks;
  w.structuresDirty = true;
  w.touch(a);
  return { burning_for_seconds: fire.litUntil - w.tick };
}

import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { ITEMS, RECIPES, STRUCTURES, addItem, isStructure, takeItem, type Inventory } from '../shared/items.ts';
import { TERRAIN as T, type Agent, type Vec } from '../shared/types.ts';
import { addScore } from './score.ts';
import { walkable } from './terrain.ts';
import { GameFail, type World } from './world.ts';

const has = (a: Agent, needs: Inventory, times = 1) => Object.entries(needs).every(([m, n]) => (a.inventory[m] ?? 0) >= n * times);
const missing = (a: Agent, needs: Inventory, times = 1) =>
  Object.entries(needs).filter(([m, n]) => (a.inventory[m] ?? 0) < n * times).map(([m, n]) => `${n * times - (a.inventory[m] ?? 0)} ${m}`).join(', ');

export function craft(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id);
  const r = RECIPES[item];
  if (!r) throw new GameFail('unknown_recipe', `Nobody knows how to make "${item}".`, `Recipes: ${Object.keys(RECIPES).join(', ')}. The rules tool lists what each needs.`);
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  if (r.blueprint && !a.blueprints.includes(r.blueprint)) throw new GameFail('no_blueprint', `You need the ${r.blueprint} blueprint.`, 'Buy it from the Smith in the Plaza: smith(blueprint, ...).');
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
  addScore(w, a, made);
  w.touch(a);
  return { crafted: item, count: made, inventory: a.inventory };
}

/** Places a station on the first free tile next to you. */
export function build(w: World, id: string, kind: string) {
  const a = w.alive(id);
  if (!isStructure(kind)) throw new GameFail('bad_structure', `You cannot build "${kind}".`, `Buildable: ${Object.keys(STRUCTURES).join(', ')}.`);
  if (w.at(a.x, a.y) === T.PLAZA) throw new GameFail('plaza_rules', 'No building in the Plaza. The Smith is very particular.', 'Walk out of the Plaza first.');
  if (!has(a, STRUCTURES[kind])) throw new GameFail('missing_materials', `You need ${missing(a, STRUCTURES[kind])} more.`, 'Gather them first.');
  const spot = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Vec[]).map(([dx, dy]): Vec => [a.x + dx, a.y + dy])
    .find(([x, y]) => walkable(w.at(x, y)) && w.at(x, y) !== T.SHALLOW && w.at(x, y) !== T.PLAZA && !w.solid(x, y) && Math.abs(w.height(x, y) - w.height(a.x, a.y)) <= B.maxClimb);
  if (!spot) throw new GameFail('no_space', 'There is no free spot next to you.', 'Stand somewhere with open ground around you.');
  for (const [m, k] of Object.entries(STRUCTURES[kind])) takeItem(a.inventory, m, k);
  w.structures.set(w.index(spot[0], spot[1]), { kind, owner: a.id, litUntil: kind === 'campfire' ? w.tick + B.campfireTicks : 0 });
  w.structuresDirty = true;
  w.bump(a, `build:${kind}`);
  addScore(w, a, 1);
  w.touch(a);
  return { built: kind, at: spot };
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

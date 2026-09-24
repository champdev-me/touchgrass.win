import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, takeItem } from '../shared/items.ts';
import type { Agent, Structure, Vec } from '../shared/types.ts';
import { lockCheck } from './bases.ts';
import { GameFail, type World } from './world.ts';

export const CROPS: Record<string, { crop: 'wheat' | 'berry'; ticks: number; yields: Record<string, number> }> = {
  wheat_seed: { crop: 'wheat', ticks: B.wheatTicks, yields: { wheat: 3, wheat_seed: 2 } },
  berry_seed: { crop: 'berry', ticks: B.berryCropTicks, yields: { berries: 5, berry_seed: 1 } },
};
const YIELD: Record<string, Record<string, number>> = { wheat: CROPS.wheat_seed.yields, berry: CROPS.berry_seed.yields };

/** The plot at (x, y), or the nearest one within reach that matches `want`. */
function plotFor(w: World, a: Agent, x: number | undefined, y: number | undefined, want: (s: Structure) => boolean): [number, Structure] {
  if (x !== undefined && y !== undefined) {
    const s = w.structures.get(w.index(x, y));
    if (!s || s.kind !== 'farm_plot' || dist([x, y], [a.x, a.y]) > B.stationRange) throw new GameFail('no_plot', `No farm plot at (${x}, ${y}) within ${B.stationRange} tiles.`, 'Stand next to it.');
    lockCheck(w, a, x, y);
    return [w.index(x, y), s];
  }
  let best: [number, Structure, number] | null = null;
  for (const [i, s] of w.structures) {
    const d = dist(w.xy(i), [a.x, a.y]);
    if (s.kind === 'farm_plot' && s.owner === a.id && d <= B.stationRange && want(s) && (!best || d < best[2])) best = [i, s, d];
  }
  if (!best) throw new GameFail('no_plot', `None of your farm plots within ${B.stationRange} tiles fits.`, 'build(farm_plot) in your base, or walk to your plots.');
  return [best[0], best[1]];
}

export function plant(w: World, id: string, seed: string, x?: number, y?: number) {
  const a = w.alive(id), c = CROPS[seed];
  if (a.role !== 'farmer') throw new GameFail('wrong_role', 'Only farmers plant crops.', 'Buy bread from a farmer, or switch_role farmer at home.');
  if (!c) throw new GameFail('not_a_seed', `"${seed}" is not a seed.`, `Seeds: ${Object.keys(CROPS).join(', ')}.`);
  if (!(a.inventory[seed] ?? 0)) throw new GameFail('missing_items', `You have no ${seed}.`, 'Seeds turn up while picking grass and berries.');
  const [, plot] = plotFor(w, a, x, y, (s) => !s.crop);
  if (plot.crop) throw new GameFail('occupied', 'Something already grows there.', 'Harvest it first.');
  takeItem(a.inventory, seed, 1);
  plot.crop = { kind: c.crop, readyAt: w.tick + c.ticks };
  w.structuresDirty = true;
  w.dirty.add(a.id);
  w.touch(a);
  return { planted: c.crop, ready_in_seconds: c.ticks };
}

export function harvest(w: World, id: string, x?: number, y?: number) {
  const a = w.alive(id);
  const [i, plot] = plotFor(w, a, x, y, (s) => Boolean(s.crop) && s.crop!.readyAt <= w.tick);
  if (plot.owner !== a.id) throw new GameFail('wrong_base', 'That crop is not yours.', 'Grow your own.');
  if (!plot.crop) throw new GameFail('empty', 'Nothing grows there.', 'plant a seed first.');
  if (plot.crop.readyAt > w.tick) throw new GameFail('not_ready', `Not ready yet: ${Math.ceil((plot.crop.readyAt - w.tick) / 60)} min to go.`, 'Come back later.');
  const got = YIELD[plot.crop.kind], spill: Record<string, number> = {};
  for (const [item, n] of Object.entries(got)) {
    const added = addItem(a.inventory, item, n);
    if (added < n) spill[item] = n - added;
  }
  if (Object.keys(spill).length) w.dropLoot(i, spill);
  delete plot.crop;
  w.structuresDirty = true;
  w.dirty.add(a.id);
  w.bump(a, 'harvest');
  w.touch(a);
  return { harvested: got };
}

/** observe lines for a robot's own plots. */
export function farmLines(w: World, a: Agent): string[] {
  const out: string[] = [];
  for (const [i, s] of w.structures) {
    if (s.kind !== 'farm_plot' || s.owner !== a.id) continue;
    const [x, y]: Vec = w.xy(i);
    out.push(!s.crop ? `empty plot at (${x}, ${y})` : `${s.crop.kind} at (${x}, ${y}): ${s.crop.readyAt <= w.tick ? 'ready' : `ready in ${Math.ceil((s.crop.readyAt - w.tick) / 60)} min`}`);
  }
  return out;
}

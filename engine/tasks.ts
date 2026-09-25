import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, room } from '../shared/items.ts';
import { dig, findClue, mapOf } from './treasure.ts';
import type { Agent, GatherTarget, Task, Vec } from '../shared/types.ts';
import type { Activity } from './body.ts';
import { fightStep } from './combat.ts';
import { bestTool, useGear } from './gear.ts';
import { NODE_DEF } from './nodes.ts';
import { findPath } from './path.ts';
import { addScore } from './score.ts';
import { stepCost, walkable } from './terrain.ts';
import type { World } from './world.ts';

type GatherTask = Extract<Task, { type: 'gather' }>;
type FleeTask = Extract<Task, { type: 'flee' }>;

/** Walks along `path` within this tick's budget (halved at zero energy). */
export function walk(w: World, a: Agent, path: Vec[]): boolean {
  let budget: number = a.energy <= 0 ? 1 : B.moveBudgetPerTick;
  if ((a.inventory.iron_armor ?? 0) > 0 && w.tick % 5 === 0) budget -= 1; // heavy armor: a step lost every 5 ticks
  let moved = false;
  while (budget > 0 && path.length) {
    const [nx, ny] = path[0];
    const cost = stepCost(w.at(nx, ny));
    if (cost > budget && moved) break; // finish the slow step next tick
    path.shift();
    a.x = nx;
    a.y = ny;
    budget -= cost;
    moved = true;
  }
  return moved;
}

const available = (w: World, i: number, target: GatherTarget): boolean =>
  target === 'loot' ? w.loot.has(i) : target === 'treasure' ? w.treasures.has(i) : w.nodes.get(i)?.kind === target && (w.nodes.get(i)?.left ?? 0) > 0;

/** Nearest reachable target in vision; tries the 5 closest so water between us doesn't stall. */
export function findTarget(w: World, a: Agent, target: GatherTarget): { index: number; path: Vec[] } | null {
  const r = w.vision(a);
  const found: { index: number; d: number }[] = [];
  for (let y = a.y - r; y <= a.y + r; y++) {
    for (let x = a.x - r; x <= a.x + r; x++) {
      if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
      const i = w.index(x, y), home = w.baseAt(x, y);
      if (home && home.owner !== a.id && target !== 'loot') continue; // other robots' bases are off limits, except loot piles
      if (available(w, i, target)) found.push({ index: i, d: dist([x, y], [a.x, a.y]) });
    }
  }
  found.sort((p, q) => p.d - q.d);
  for (const f of found.slice(0, 5)) {
    const [nx, ny] = w.xy(f.index);
    if (Math.abs(nx - a.x) + Math.abs(ny - a.y) <= 1) return { index: f.index, path: [] }; // already beside it (or on it)
    // Trees and bushes are solid: stand on a free neighbouring tile and harvest from there.
    const spots: Vec[] = w.solid(nx, ny) ? [[nx + 1, ny], [nx - 1, ny], [nx, ny + 1], [nx, ny - 1]] : [[nx, ny]];
    for (const [sx, sy] of spots.sort((p, q) => dist(p, [a.x, a.y]) - dist(q, [a.x, a.y]))) {
      if (sx === a.x && sy === a.y) return { index: f.index, path: [] };
      if (!walkable(w.at(sx, sy)) || w.solid(sx, sy)) continue;
      const path = findPath(w.at, [a.x, a.y], [sx, sy], r + 2, w.stepFor(a));
      if (path) return { index: f.index, path };
    }
  }
  return null;
}

export function runTask(w: World, a: Agent): Activity {
  const task = a.task;
  if (!task) return 'idle';
  switch (task.type) {
    case 'move_to':
      walk(w, a, task.path);
      if (!task.path.length) w.finish(a, `Task done: arrived at (${a.x}, ${a.y}).`);
      return 'busy';
    case 'rest':
    case 'sleep':
      if (a.energy >= 100) {
        w.finish(a, task.type === 'rest' ? 'Task done: fully rested.' : 'Task done: slept like a log. A metal log.');
        return 'idle';
      }
      return task.type;
    case 'gather':
      return gatherStep(w, a, task);
    case 'attack':
      return fightStep(w, a, task);
    case 'flee':
      return fleeStep(w, a, task);
  }
}

function gatherStep(w: World, a: Agent, t: GatherTask): Activity {
  if (t.target === 'treasure' && !available(w, t.node, t.target)) {
    w.finish(a, 'Someone dug it up first. The map is now a souvenir.');
    return 'idle';
  }
  if (!available(w, t.node, t.target)) {
    const next = findTarget(w, a, t.target);
    if (!next) {
      w.finish(a, t.got ? `Task done: gathered ${t.got}; no more ${t.target} in sight.` : `Task done: no ${t.target} in sight.`);
      return 'idle';
    }
    t.node = next.index;
    t.path = next.path;
    t.progress = 0;
  }
  if (t.path.length) {
    walk(w, a, t.path);
    return 'busy';
  }
  if (t.target === 'treasure') {
    if (a.energy <= 0) {
      w.interrupt(a, 'Too tired to dig. Rest or sleep.');
      return 'idle';
    }
    a.energy = Math.max(0, a.energy - B.punchEnergy);
    if (++t.progress < B.treasureDigTicks * (bestTool(a, 'iron_vein') ? 1 : B.noPickaxeDig)) return 'busy';
    const [x, y] = w.xy(t.node);
    if (!(a.inventory[mapOf(x, y)] ?? 0)) {
      w.interrupt(a, 'You lost the map. Where was it again?');
      return 'idle';
    }
    w.finish(a, dig(w, a, t.node));
    return 'busy';
  }
  if (t.target === 'loot') {
    if (++t.progress < B.gatherTicksPerUnit) return 'busy';
    t.progress = 0;
    return pickUpLoot(w, a, t);
  }
  const kind = w.nodes.get(t.node)!.kind, def = NODE_DEF[kind];
  const tool = bestTool(a, kind);
  if (def.needsPickaxe && !tool) {
    w.interrupt(a, 'Your pickaxe is gone. You cannot dig this by hand.');
    return 'idle';
  }
  // Stone tools halve the work, iron halves it again.
  const ticks = tool ? Math.max(1, Math.ceil(def.ticks / (tool.tier === 2 ? 4 : 2))) : def.ticks;
  // Every punch can shake something loose (an apple from a tree).
  if (def.bonus && a.role === 'gatherer' && w.rng() < def.bonus.chance / ticks && addItem(a.inventory, def.bonus.item, 1)) w.note(a, `Bonus: a ${def.bonus.item} fell out!`); // only gatherers get apples
  if (a.energy <= 0) {
    w.interrupt(a, 'Too tired to punch. Rest or sleep.');
    return 'idle';
  }
  a.energy = Math.max(0, a.energy - B.punchEnergy);
  if (++t.progress < ticks) return 'busy';
  t.progress = 0;
  if (tool) useGear(w, a, tool.item);
  return harvest(w, a, t);
}

/** Run from a creature: step to whichever free neighbour is farthest from it, until safe. */
function fleeStep(w: World, a: Agent, t: FleeTask): Activity {
  if (t.path && t.to) {
    walk(w, a, t.path);
    if (!t.path.length) w.finish(a, `Task done: you reached safety at (${t.to[0]}, ${t.to[1]}).`);
    return 'busy';
  }
  const c = w.creatures.get(t.from);
  if (!c || dist([c.x, c.y], [a.x, a.y]) >= B.fleeSafe) {
    w.finish(a, 'Task done: you got away.');
    return 'idle';
  }
  let budget: number = a.energy <= 0 ? 1 : B.moveBudgetPerTick, moved = false;
  while (budget > 0) {
    let best: Vec | null = null, bs = dist([a.x, a.y], [c.x, c.y]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = a.x + dx, ny = a.y + dy;
      if (!walkable(w.at(nx, ny)) || !w.stepFor(a)(a.x, a.y, nx, ny)) continue;
      const s = dist([nx, ny], [c.x, c.y]) + (Math.abs(nx - c.x) + Math.abs(ny - c.y)) * 0.01;
      if (s > bs) [best, bs] = [[nx, ny], s];
    }
    if (!best) break;
    budget -= stepCost(w.at(best[0], best[1]));
    [a.x, a.y] = best;
    moved = true;
  }
  if (!moved) {
    w.interrupt(a, 'Cornered! Fight or pray.');
    return 'idle';
  }
  return 'busy';
}

function harvest(w: World, a: Agent, t: GatherTask): Activity {
  const node = w.nodes.get(t.node)!;
  const def = NODE_DEF[node.kind];
  const plant = node.kind === 'tree' || node.kind === 'berry_bush' || node.kind === 'grass' || node.kind === 'herb';
  const lucky = (a.inventory.lucky_charm ?? 0) > 0 && w.rng() < B.luckyChance ? 2 : 1;
  const per = (plant && a.role === 'gatherer' ? B.gathererMultiplier : 1) * lucky; // gatherers pick double
  // Bushes and grass (one tick) are picked in one go; trees and rocks give one unit per round of punches.
  const units = def.ticks === 1 ? Math.min(node.left, Math.ceil((t.until - t.got) / per)) : 1;
  for (let u = 0; u < units; u++) {
    const gold = def.item === 'gold'; // minted coins go to the wallet
    if (gold) a.wallet += per;
    const got = gold ? per : addItem(a.inventory, def.item, per);
    if (gold) w.bump(a, 'mint:gold');
    if (!got) {
      w.interrupt(a, 'Your bag is full.');
      return 'idle';
    }
    w.takeFromNode(t.node, node);
    if ((node.kind === 'tree' || node.kind === 'grass' || node.kind === 'rock') && w.rng() < B.clueChance) findClue(w, a);
    const seed = node.kind === 'grass' ? 'wheat_seed' : node.kind === 'berry_bush' ? 'berry_seed' : null;
    if (seed && w.rng() < B.seedChance && addItem(a.inventory, seed, 1)) w.note(a, `You found a ${seed}. Farmers can plant it.`);
    t.got += got;
    w.bump(a, `gather:${def.item}`);
    const before = a.stats.gathered ?? 0;
    a.stats.gathered = before + got;
  }
  if (t.got >= t.until) w.finish(a, `Task done: gathered ${t.got} ${def.item}.`);
  else if (def.item !== 'gold' && room(a.inventory, def.item) === 0) w.interrupt(a, 'Your bag is full.');
  return 'busy';
}

function pickUpLoot(w: World, a: Agent, t: GatherTask): Activity {
  const pile = w.loot.get(t.node)!;
  let taken = 0;
  for (const [item, n] of Object.entries(pile.items)) {
    const got = addItem(a.inventory, item, n);
    taken += got;
    if (n - got > 0) pile.items[item] = n - got;
    else delete pile.items[item];
  }
  if (!Object.keys(pile.items).length) w.loot.delete(t.node);
  w.lootDirty = true;
  if (taken) w.finish(a, `Task done: picked up ${taken} items from the pile.`);
  else w.interrupt(a, 'Your bag is full.');
  return 'busy';
}

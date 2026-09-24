import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, room } from '../shared/items.ts';
import type { Agent, GatherTarget, Task, Vec } from '../shared/types.ts';
import type { Activity } from './body.ts';
import { fightStep } from './combat.ts';
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
  target === 'loot' ? w.loot.has(i) : w.nodes.get(i)?.kind === target && (w.nodes.get(i)?.left ?? 0) > 0;

/** Nearest reachable target in vision; tries the 5 closest so water between us doesn't stall. */
export function findTarget(w: World, a: Agent, target: GatherTarget): { index: number; path: Vec[] } | null {
  const r = w.vision(a);
  const found: { index: number; d: number }[] = [];
  for (let y = a.y - r; y <= a.y + r; y++) {
    for (let x = a.x - r; x <= a.x + r; x++) {
      if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
      const i = w.index(x, y);
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
      const path = findPath(w.at, [a.x, a.y], [sx, sy], r + 2, w.canStep);
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
  if (t.target === 'loot') {
    if (++t.progress < B.gatherTicksPerUnit) return 'busy';
    t.progress = 0;
    return pickUpLoot(w, a, t);
  }
  const def = NODE_DEF[w.nodes.get(t.node)!.kind];
  // Every punch can shake something loose (an apple from a tree).
  if (def.bonus && w.rng() < def.bonus.chance / def.ticks && addItem(a.inventory, def.bonus.item, 1)) w.note(a, `Bonus: a ${def.bonus.item} fell out!`);
  if (++t.progress < def.ticks) return 'busy';
  t.progress = 0;
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
      if (!walkable(w.at(nx, ny)) || !w.canStep(a.x, a.y, nx, ny)) continue;
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
  const per = a.role === 'gatherer' ? B.gathererMultiplier : 1;
  // Bushes and grass (one tick) are picked in one go; trees and rocks give one unit per round of punches.
  const units = def.ticks === 1 ? Math.min(node.left, Math.ceil((t.until - t.got) / per)) : 1;
  for (let u = 0; u < units; u++) {
    const got = addItem(a.inventory, def.item, per);
    if (!got) {
      w.interrupt(a, 'Your bag is full.');
      return 'idle';
    }
    w.takeFromNode(t.node, node);
    t.got += got;
    w.bump(a, `gather:${def.item}`);
    const before = a.stats.gathered ?? 0;
    a.stats.gathered = before + got;
    if (Math.floor(a.stats.gathered / B.gatherScoreEvery) > Math.floor(before / B.gatherScoreEvery)) addScore(w, a, 1);
  }
  if (t.got >= t.until) w.finish(a, `Task done: gathered ${t.got} ${def.item}.`);
  else if (room(a.inventory, def.item) === 0) w.interrupt(a, 'Your bag is full.');
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

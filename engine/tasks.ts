import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, room } from '../shared/items.ts';
import type { Agent, GatherTarget, Task, Vec } from '../shared/types.ts';
import type { Activity } from './body.ts';
import { NODE_DEF } from './nodes.ts';
import { findPath } from './path.ts';
import { addScore } from './score.ts';
import { stepCost } from './terrain.ts';
import type { World } from './world.ts';

type GatherTask = Extract<Task, { type: 'gather' }>;

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
    const path = findPath(w.at, [a.x, a.y], w.xy(f.index), r + 2);
    if (path) return { index: f.index, path };
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
  if (++t.progress < B.gatherTicksPerUnit) return 'busy';
  t.progress = 0;
  return t.target === 'loot' ? pickUpLoot(w, a, t) : harvest(w, a, t);
}

function harvest(w: World, a: Agent, t: GatherTask): Activity {
  const node = w.nodes.get(t.node)!;
  const def = NODE_DEF[node.kind];
  const got = addItem(a.inventory, def.item, a.role === 'gatherer' ? B.gathererMultiplier : 1);
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
  if (def.bonus && w.rng() < def.bonus.chance && addItem(a.inventory, def.bonus.item, 1)) w.note(a, `Bonus: a ${def.bonus.item} fell out!`);
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

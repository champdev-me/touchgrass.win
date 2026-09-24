import { B } from '../shared/balance.ts';
import type { Vec } from '../shared/types.ts';
import { stepCost, walkable } from './terrain.ts';

class MinHeap {
  ids: number[] = [];
  pr: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    const { ids, pr } = this;
    let i = ids.length;
    ids.push(id);
    pr.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pr[up] <= pr[i]) break;
      [ids[i], ids[up]] = [ids[up], ids[i]];
      [pr[i], pr[up]] = [pr[up], pr[i]];
      i = up;
    }
  }

  pop(): number {
    const { ids, pr } = this;
    const top = ids[0];
    const lastId = ids.pop()!, lastP = pr.pop()!;
    if (ids.length) {
      ids[0] = lastId;
      pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < ids.length && pr[l] < pr[m]) m = l;
        if (r < ids.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [ids[i], ids[m]] = [ids[m], ids[i]];
        [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return top;
  }
}

/** A* over 4-neighbour tiles inside a (2r+1)² box around the start. */
export function findPath(at: (x: number, y: number) => number, from: Vec, to: Vec, radius: number = B.pathRadius): Vec[] | null {
  const [sx, sy] = from, [tx, ty] = to;
  if (Math.abs(tx - sx) > radius || Math.abs(ty - sy) > radius || !walkable(at(tx, ty))) return null;
  const w = radius * 2 + 1, ox = sx - radius, oy = sy - radius;
  const idx = (x: number, y: number) => (y - oy) * w + (x - ox);
  const g = new Float64Array(w * w).fill(Infinity);
  const came = new Int32Array(w * w).fill(-1);
  const start = idx(sx, sy), goal = idx(tx, ty);
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    const cx = (cur % w) + ox, cy = Math.floor(cur / w) + oy;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < ox || ny < oy || nx >= ox + w || ny >= oy + w) continue;
      const t = at(nx, ny);
      if (!walkable(t)) continue;
      const ni = idx(nx, ny), ng = g[cur] + stepCost(t);
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ni, ng + Math.abs(tx - nx) + Math.abs(ty - ny));
      }
    }
  }
  if (g[goal] === Infinity) return null;
  const path: Vec[] = [];
  for (let i = goal; i !== start; i = came[i]) path.push([(i % w) + ox, Math.floor(i / w) + oy]);
  return path.reverse();
}

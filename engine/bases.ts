import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { TERRAIN as T, type Agent, type Base, type Vec } from '../shared/types.ts';
import { walkable } from './terrain.ts';
import type { World } from './world.ts';

/** Land means land: no water of any depth, no Plaza, inside the map. */
export function isLand(w: World, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= w.size || y >= w.size) return false;
  const t = w.at(x, y);
  return walkable(t) && t !== T.SHALLOW && t !== T.PLAZA;
}

/** Every tile is land and no other base comes within a tile. */
export function fits(w: World, x0: number, y0: number, x1: number, y1: number, except = ''): boolean {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!isLand(w, x, y)) return false;
  for (const [owner, b] of w.bases) if (owner !== except && b.x0 - 1 <= x1 && x0 <= b.x1 + 1 && b.y0 - 1 <= y1 && y0 <= b.y1 + 1) return false;
  return true;
}

export const baseOf = (w: World, id: string): Base | null => w.bases.get(id) ?? null;

/** A 5x5 base near other robots (or near the Plaza for the first one); moves spawn and robot to the flag. */
export function placeBase(w: World, a: Agent): Base | null {
  const anchors: Vec[] = [];
  for (const o of w.agents.values()) if (o.id !== a.id && o.joined) anchors.push(w.bases.get(o.id)?.flag ?? o.spawn);
  const [lo, hi] = anchors.length ? B.baseNear : B.firstBaseFromPlaza;
  const tries: { c: Vec; r: number }[] = [];
  for (let i = 0; i < B.baseTries; i++) {
    const from = anchors.length ? anchors[Math.floor(w.rng() * anchors.length)] : w.plaza;
    const ang = w.rng() * Math.PI * 2, r = lo + w.rng() * (hi - lo);
    tries.push({ c: [Math.round(from[0] + Math.cos(ang) * r), Math.round(from[1] + Math.sin(ang) * r)], r });
  }
  tries.sort((p, q) => p.r - q.r); // nearest first: neighbourhoods stay tight
  const h = Math.floor(B.baseSize / 2);
  for (const { c: [cx, cy] } of tries) {
    if (!anchors.length && (dist([cx, cy], w.plaza) < lo || dist([cx, cy], w.plaza) > hi)) continue;
    if (!fits(w, cx - h, cy - h, cx + h, cy + h)) continue;
    const base: Base = { owner: a.id, x0: cx - h, y0: cy - h, x1: cx + h, y1: cy + h, flag: [cx, cy] };
    w.bases.set(a.id, base);
    w.basesDirty = true;
    a.spawn = [cx, cy];
    [a.x, a.y] = [cx, cy];
    w.dirty.add(a.id);
    return base;
  }
  return null;
}

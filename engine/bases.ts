import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { ROLES, TERRAIN as T, type Agent, type Base, type Role, type Vec } from '../shared/types.ts';
import { walkable } from './terrain.ts';
import { GameFail, type World } from './world.ts';

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
    const from = anchors.length ? anchors[(i + Math.floor(w.rng() * anchors.length)) % anchors.length] : w.plaza;
    // golden-angle sweep plus noise: tries spread out even when the rng repeats itself
    const ang = i * 2.39996 + w.rng() * Math.PI * 2, r = lo + ((i * 0.618034 + w.rng()) % 1) * (hi - lo);
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

export type Side = 'n' | 'e' | 's' | 'w';
const inside = (b: Base, x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
const areaOf = (b: Base) => (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1);

/** Gold for the next 1-tile strip on a side: its length times the tile price. */
export function stripPrice(b: Base, side: Side): number {
  const length = side === 'n' || side === 's' ? b.x1 - b.x0 + 1 : b.y1 - b.y0 + 1;
  return length * (1 + Math.floor(areaOf(b) / 100));
}

/** The strip's own tiles, as inclusive bounds. */
function strip(b: Base, side: Side): [number, number, number, number] {
  if (side === 'n') return [b.x0, b.y0 - 1, b.x1, b.y0 - 1];
  if (side === 's') return [b.x0, b.y1 + 1, b.x1, b.y1 + 1];
  if (side === 'w') return [b.x0 - 1, b.y0, b.x0 - 1, b.y1];
  return [b.x1 + 1, b.y0, b.x1 + 1, b.y1];
}

export function buyLand(w: World, id: string, side: Side) {
  const a = w.alive(id), b = w.bases.get(a.id);
  if (!b || !inside(b, a.x, a.y)) throw new GameFail('not_home', 'You can only grow your base while standing in it.', 'Walk home first: observe shows your base.');
  const [x0, y0, x1, y1] = strip(b, side);
  const nx0 = Math.min(b.x0, x0), ny0 = Math.min(b.y0, y0), nx1 = Math.max(b.x1, x1), ny1 = Math.max(b.y1, y1);
  if (nx1 - nx0 + 1 > B.baseMaxSide || ny1 - ny0 + 1 > B.baseMaxSide) throw new GameFail('too_big', `A base is at most ${B.baseMaxSide} tiles a side.`, 'Grow another side.');
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (isLand(w, x, y)) continue;
    const water = x >= 0 && y >= 0 && x < w.size && y < w.size && (w.at(x, y) === T.SHALLOW || w.at(x, y) === T.DEEP);
    throw new GameFail(water ? 'water' : 'bad_land', water ? 'That side is water. Land means land.' : 'That side is the Plaza or the edge of the world.', 'Grow another side.');
  }
  if (!fits(w, x0, y0, x1, y1, a.id)) throw new GameFail('neighbour', 'That strip would touch a neighbour. Bases keep a 1-tile gap.', 'Grow another side.');
  const price = stripPrice(b, side);
  if (a.wallet < price) throw new GameFail('not_enough_gold', `That strip costs ${price} gold; you have ${a.wallet}.`, 'Sell something first.');
  a.wallet -= price;
  [b.x0, b.y0, b.x1, b.y1] = [nx0, ny0, nx1, ny1];
  w.basesDirty = true;
  w.dirty.add(a.id);
  w.bump(a, 'land:strips');
  w.touch(a);
  return { area: areaOf(b), paid: price, from: [b.x0, b.y0] as Vec, to: [b.x1, b.y1] as Vec };
}

/** Throws unless the tile is outside every base or inside the robot's own. */
export function lockCheck(w: World, a: Agent, x: number, y: number): void {
  const b = w.baseAt(x, y);
  if (!b || b.owner === a.id) return;
  const who = w.agents.get(b.owner)?.name ?? 'someone';
  throw new GameFail('wrong_base', `This is ${who}'s base. Hands off.`, 'Work outside it, or in your own base.');
}

/** What observe tells a robot about bases. */
export function baseLines(w: World, a: Agent) {
  const b = w.bases.get(a.id), here = w.baseAt(a.x, a.y);
  return {
    base: b ? { from: [b.x0, b.y0] as Vec, to: [b.x1, b.y1] as Vec, flag: b.flag, area: areaOf(b), next_strip_price: { n: stripPrice(b, 'n'), e: stripPrice(b, 'e'), s: stripPrice(b, 's'), w: stripPrice(b, 'w') } } : null,
    standing_in: !here ? null : here.owner === a.id ? 'your base' : `${w.agents.get(here.owner)?.name ?? 'someone'}'s base`,
  };
}

/** Change jobs at home, at most once per switchRoleTicks; the new role brings no kit. */
export function switchRole(w: World, id: string, role: string) {
  const a = w.alive(id);
  if (!(ROLES as readonly string[]).includes(role)) throw new GameFail('bad_role', `There is no "${role}" job.`, `Roles: ${ROLES.join(', ')}.`);
  if (w.baseAt(a.x, a.y)?.owner !== a.id) throw new GameFail('not_home', 'You can only switch jobs at home.', 'Walk into your own base first.');
  const wait = a.roleSwitchedAt + B.switchRoleTicks - w.tick;
  if (wait > 0) throw new GameFail('too_soon', `You switched jobs recently. Wait ${wait}s.`, 'Commit to the bit for a while.');
  a.role = role as Role;
  a.roleSwitchedAt = w.tick;
  w.dirty.add(a.id);
  w.emit('role', `${a.name} is a ${role} now.`, a);
  w.touch(a);
  return { role };
}

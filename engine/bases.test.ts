import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { dist } from '../shared/geo.ts';
import { TERRAIN as T, type Base } from '../shared/types.ts';
import { baseOf, isLand } from './bases.ts';
import { World } from './world.ts';

function lakeWorld(): World {
  const n = 256, tiles = new Uint8Array(n * n).fill(T.MEADOW);
  for (let y = 60; y < 110; y++) for (let x = 60; x < 110; x++) tiles[y * n + x] = x < 70 || y < 70 ? T.SHALLOW : T.DEEP;
  for (let y = 118; y < 138; y++) for (let x = 118; x < 138; x++) tiles[y * n + x] = T.PLAZA;
  let seed = 11;
  return new World(tiles, n, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
}
const tilesOf = (b: Base) => {
  const out: [number, number][] = [];
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) out.push([x, y]);
  return out;
};
const touches = (p: Base, q: Base) => p.x0 - 1 <= q.x1 && q.x0 <= p.x1 + 1 && p.y0 - 1 <= q.y1 && q.y0 <= p.y1 + 1;

test('the first base sits 20-40 tiles from the Plaza; the robot moves to its flag', () => {
  const w = lakeWorld();
  const a = w.register('First', 0);
  w.join(a.id, 'scout', null, 0);
  const b = baseOf(w, a.id)!;
  assert.deepEqual([b.x1 - b.x0, b.y1 - b.y0], [4, 4]);
  assert.deepEqual(b.flag, [b.x0 + 2, b.y0 + 2]);
  const d = dist(b.flag, w.plaza);
  assert.ok(d >= 20 && d <= 40, `${d}`);
  assert.deepEqual([a.spawn, [a.x, a.y]], [b.flag, b.flag]);
  assert.equal(w.baseAt(b.x0, b.y1), b);
  assert.equal(w.baseAt(b.x0 - 1, b.y0), null);
});

test('later bases: all land, never touching, each within 100 tiles of an earlier robot', () => {
  const w = lakeWorld();
  const flags: [number, number][] = [];
  for (let i = 0; i < 31; i++) {
    const a = w.register(`R${i}`, 0);
    w.join(a.id, 'scout', null, 0);
    const b = baseOf(w, a.id);
    assert.ok(b, `robot ${i} got no base`);
    for (const [x, y] of tilesOf(b!)) assert.ok(isLand(w, x, y), `water or plaza at ${x},${y}`);
    if (i > 0) assert.ok(flags.some((f) => dist(f, b!.flag) <= 100), `robot ${i} is far from everyone`);
    flags.push(b!.flag);
  }
  const all = [...w.bases.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!touches(all[i], all[j]), `bases ${i} and ${j} touch`);
});

test('no room anywhere: the robot joins without a base', () => {
  const tiles = new Uint8Array(12 * 12).fill(T.DEEP);
  for (let x = 0; x < 12; x++) tiles[x] = T.MEADOW;
  const w = new World(tiles, 12, () => 0.5);
  const a = w.register('Castaway', 0);
  w.join(a.id, 'scout', null, 0);
  assert.equal(baseOf(w, a.id), null);
  assert.equal(a.joined, true);
});

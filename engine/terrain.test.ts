import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { chunkBytes, generateLand, generateTerrain, tileAt, walkable, writeChunk } from './terrain.ts';

const land = generateLand('touchgrass-test');
const big = land.tiles;

test('same seed gives the same world, a different seed a different one', () => {
  assert.deepEqual(generateTerrain('a', 256), generateTerrain('a', 256));
  assert.notDeepEqual(generateTerrain('a', 256), generateTerrain('b', 256));
});

test('the Plaza sits in the middle and the edges are deep water', () => {
  assert.equal(tileAt(big, 512, 512), T.PLAZA);
  assert.equal(tileAt(big, 0, 0), T.DEEP);
  assert.equal(tileAt(big, 1023, 500), T.DEEP);
  assert.equal(tileAt(big, -1, 5), T.DEEP);
});

test('every terrain type appears and a good share of the world is walkable', () => {
  const counts = new Map<number, number>();
  for (const t of big) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of Object.values(T)) assert.ok((counts.get(t) ?? 0) > 0, `missing terrain ${t}`);
  const share = big.filter((t) => walkable(t)).length / big.length;
  assert.ok(share > 0.4 && share < 0.9, `walkable share ${share}`);
});

test('chunks round-trip', () => {
  const copy = new Uint8Array(big.length);
  for (let cy = 0; cy < 32; cy++) for (let cx = 0; cx < 32; cx++) writeChunk(copy, cx, cy, chunkBytes(big, cx, cy));
  assert.deepEqual(copy, big);
});

test('the island has mountain ranges, plains, sand, rivers and lakes', () => {
  const n = 1024, c = n / 2, count = (t: number) => big.filter((x) => x === t).length;
  assert.ok(count(T.MOUNTAIN) > 2000 && count(T.HIGH) > 500 && count(T.PEAK) > 100, `${count(T.MOUNTAIN)} ${count(T.HIGH)} ${count(T.PEAK)}`);
  assert.deepEqual([walkable(T.HILLS), walkable(T.MOUNTAIN), walkable(T.DEEP)], [true, true, false]);
  assert.ok(count(T.MEADOW) / big.length > 0.2, 'plains');
  let inlandWater = 0, inlandSand = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (Math.max(Math.abs(x - c), Math.abs(y - c)) / c > 0.6) continue; // well away from the coast
      const t = big[y * n + x];
      if (t === T.SHALLOW || t === T.DEEP) inlandWater++;
      if (t === T.SAND) inlandSand++;
    }
  }
  assert.ok(inlandWater > 3000, `rivers and lakes: ${inlandWater}`);
  assert.ok(inlandSand > 1000, `sandy patches: ${inlandSand}`);
});

test('height levels: water low, plains at 1, peaks towering; neighbours mostly within one step', () => {
  const n = 1024, { tiles, heights } = land;
  assert.equal(heights[0], 0); // the sea
  let steep = 0, pairs = 0, maxPeak = 0;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t === T.DEEP) assert.ok(heights[i] <= 4, `deep water at ${heights[i]}`); // the sea is 0; mountain lakes sit a little higher
    if (t === T.MEADOW || t === T.FOREST) assert.ok(heights[i] >= 1 && heights[i] <= 2, `plains at ${heights[i]}`);
    if (t === T.PEAK) maxPeak = Math.max(maxPeak, heights[i]);
    if (i % n < n - 1 && walkable(t) && walkable(tiles[i + 1]) && heights[i] < 5 && heights[i + 1] < 5) { // lowlands: mountains may have cliffs
      pairs++;
      if (Math.abs(heights[i] - heights[i + 1]) > 1) steep++;
    }
  }
  assert.ok(maxPeak >= 18, `peaks reach ${maxPeak}`);
  assert.ok(steep / pairs < 0.01, `lowland cliffs are rare: ${steep}/${pairs}`);
});

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { chunkBytes, generateTerrain, tileAt, walkable, writeChunk } from './terrain.ts';

const big = generateTerrain('touchgrass-test');

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

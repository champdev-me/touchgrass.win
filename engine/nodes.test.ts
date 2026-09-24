import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type NodeKind } from '../shared/types.ts';
import { NODE_DEF, chunkOf, generateNodes, nodeKindAt, packChunk, unpackChunk, type ResourceNode } from './nodes.ts';

const share = (t: number, kind: NodeKind) => {
  let c = 0;
  for (let i = 0; i < 10000; i++) if (nodeKindAt(t, i % 100, Math.floor(i / 100)) === kind) c++;
  return c / 10000;
};

test('nodes only grow where they belong and are deterministic', () => {
  for (let i = 0; i < 2000; i++) {
    const x = i % 100, y = Math.floor(i / 100);
    assert.equal(nodeKindAt(T.PLAZA, x, y), null);
    assert.equal(nodeKindAt(T.DEEP, x, y), null);
    assert.ok([null, 'tree', 'berry_bush'].includes(nodeKindAt(T.FOREST, x, y)));
    assert.ok([null, 'rock', 'iron_vein'].includes(nodeKindAt(T.HILLS, x, y)));
    assert.ok([null, 'iron_vein'].includes(nodeKindAt(T.MOUNTAIN, x, y))); // miners dig iron in the mountains
  }
  assert.equal(nodeKindAt(T.MEADOW, 17, 42), nodeKindAt(T.MEADOW, 17, 42));
});

test('forests are mostly trees; meadows have grass and berries', () => {
  assert.ok(Math.abs(share(T.FOREST, 'tree') - 0.22) < 0.03, String(share(T.FOREST, 'tree')));
  assert.ok(share(T.MEADOW, 'grass') > 0.04);
  assert.ok(Math.abs(share(T.MEADOW, 'berry_bush') - 0.015) < 0.006, String(share(T.MEADOW, 'berry_bush')));
  assert.ok(Math.abs(share(T.FOREST, 'berry_bush') - 0.02) < 0.008, String(share(T.FOREST, 'berry_bush')));
  assert.ok(Math.abs(share(T.HILLS, 'rock') - 0.25) < 0.03, String(share(T.HILLS, 'rock')));
});

test('fresh nodes are full and chunks pack and unpack losslessly', () => {
  const size = 64, tiles = new Uint8Array(size * size).fill(T.FOREST);
  const nodes = generateNodes(tiles, size);
  assert.ok(nodes.size > 800); // ~24% of 4096 forest tiles
  for (const n of nodes.values()) assert.ok(n.left >= NODE_DEF[n.kind].min && n.left <= NODE_DEF[n.kind].max);
  const first = nodes.get([...nodes.keys()][0])!;
  first.left = 0;
  first.regrowAt = 777;
  const back = new Map<number, ResourceNode>();
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) unpackChunk(back, cx, cy, packChunk(nodes, cx, cy, size), size);
  const sorted = (m: Map<number, ResourceNode>) => [...m].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sorted(back), sorted(nodes));
  assert.equal(chunkOf(size * 40 + 33, size), '1,1');
});

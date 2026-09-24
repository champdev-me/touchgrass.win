import { B } from '../shared/balance.ts';
import { hash01 } from '../shared/hash.ts';
import { NODE_KINDS, TERRAIN as T, type NodeKind, type PackedNode } from '../shared/types.ts';

export interface ResourceNode {
  kind: NodeKind;
  left: number;
  regrowAt: number; // tick; 0 while full or when it never regrows
}

// ticks: punches (or picks) per unit by hand
export const NODE_DEF: Record<NodeKind, { item: string; min: number; max: number; ticks: number; regrowTicks: number | null; bonus?: { item: string; chance: number } }> = {
  tree: { item: 'wood', min: 3, max: 5, ticks: 3, regrowTicks: 1800, bonus: { item: 'apple', chance: 0.1 } },
  berry_bush: { item: 'berries', min: 5, max: 5, ticks: 1, regrowTicks: 600 },
  grass: { item: 'fiber', min: 3, max: 3, ticks: 1, regrowTicks: 300 },
  rock: { item: 'stone', min: 3, max: 5, ticks: 3, regrowTicks: null }, // stone is finite
};

/** Bumped when placement rules change; loadWorld prunes nodes the new rules no longer place, once. */
export const NODE_RULES = 5; // 2: half the berry bushes, 3: thinner forests, 4: nothing on mountains, 5: more rocks on foothills

/** Which node grows on a tile. Seedless, so worlds saved before nodes existed can be backfilled. */
export function nodeKindAt(t: number, x: number, y: number): NodeKind | null {
  const r = hash01(x, y);
  if (t === T.FOREST) return r < 0.22 ? 'tree' : r >= 0.4 && r < 0.42 ? 'berry_bush' : null;
  if (t === T.MEADOW) return r < 0.02 ? 'tree' : r < 0.035 ? 'berry_bush' : r >= 0.05 && r < 0.11 ? 'grass' : null;
  if (t === T.HILLS) return r < 0.25 ? 'rock' : null;
  return null;
}

export function fullAmount(kind: NodeKind, x: number, y: number): number {
  const d = NODE_DEF[kind];
  return d.min + Math.floor(hash01(y, x) * (d.max - d.min + 1));
}

export function generateNodes(tiles: Uint8Array, size: number): Map<number, ResourceNode> {
  const nodes = new Map<number, ResourceNode>();
  for (let i = 0; i < tiles.length; i++) {
    const x = i % size, y = Math.floor(i / size), kind = nodeKindAt(tiles[i], x, y);
    if (kind) nodes.set(i, { kind, left: fullAmount(kind, x, y), regrowAt: 0 });
  }
  return nodes;
}

export function packChunk(nodes: Map<number, ResourceNode>, cx: number, cy: number, size: number): PackedNode[] {
  const n = B.chunkSize, out: PackedNode[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const node = nodes.get((cy * n + j) * size + cx * n + i);
      if (node) out.push([j * n + i, NODE_KINDS.indexOf(node.kind), node.left, node.regrowAt]);
    }
  }
  return out;
}

export function unpackChunk(nodes: Map<number, ResourceNode>, cx: number, cy: number, packed: PackedNode[], size: number): void {
  const n = B.chunkSize;
  for (const [local, k, left, regrowAt] of packed) {
    nodes.set((cy * n + Math.floor(local / n)) * size + cx * n + (local % n), { kind: NODE_KINDS[k], left, regrowAt });
  }
}

export const chunkOf = (index: number, size: number): string =>
  `${Math.floor((index % size) / B.chunkSize)},${Math.floor(Math.floor(index / size) / B.chunkSize)}`;

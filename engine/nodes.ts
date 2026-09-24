import { B } from '../shared/balance.ts';
import { hash01 } from '../shared/hash.ts';
import { NODE_KINDS, TERRAIN as T, type NodeKind, type PackedNode, type Role } from '../shared/types.ts';
import { GameFail } from './world.ts';

export interface ResourceNode {
  kind: NodeKind;
  left: number;
  regrowAt: number; // tick; 0 while full or when it never regrows
}

// ticks: punches (or picks) per unit by hand
export const NODE_DEF: Record<NodeKind, { item: string; min: number; max: number; ticks: number; regrowTicks: number | null; needsPickaxe?: boolean; bonus?: { item: string; chance: number }; roles?: Role[] }> = {
  tree: { item: 'wood', min: 3, max: 5, ticks: 3, regrowTicks: 1800, bonus: { item: 'apple', chance: 0.1 } },
  berry_bush: { item: 'berries', min: 5, max: 5, ticks: 1, regrowTicks: 600 },
  grass: { item: 'fiber', min: 3, max: 3, ticks: 1, regrowTicks: 300 },
  rock: { item: 'stone', min: 3, max: 5, ticks: 3, regrowTicks: null, roles: ['mason'] }, // stone is finite
  iron_vein: { item: 'iron_ore', min: 2, max: 3, ticks: 4, regrowTicks: null, needsPickaxe: true, roles: ['miner'] },
  crystal: { item: 'crystal', min: 1, max: 1, ticks: 4, regrowTicks: 7200, needsPickaxe: true, roles: ['miner'] },
  mud: { item: 'mud', min: 3, max: 5, ticks: 2, regrowTicks: 1200, roles: ['mason'] },
  gem_vein: { item: 'gem', min: 1, max: 2, ticks: 5, regrowTicks: null, needsPickaxe: true, roles: ['miner'] },
  gold_vein: { item: 'gold', min: 3, max: 8, ticks: 5, regrowTicks: null, needsPickaxe: true, roles: ['miner'] }, // coins, straight to the wallet
  herb: { item: 'herb', min: 2, max: 2, ticks: 1, regrowTicks: 900, roles: ['gatherer'] },
};

/** The wrong_role failure for a node, naming the role to trade with. */
export function wrongRole(kind: NodeKind): GameFail {
  const item = NODE_DEF[kind].item, role = NODE_DEF[kind].roles?.[0] ?? 'robot';
  return new GameFail('wrong_role', `Only ${role}s can get ${item}. Your robot tried; the ${kind.replace('_', ' ')} was unimpressed.`, `Find a ${role} and make an offer.`);
}

/** Bumped when placement rules change; loadWorld prunes nodes the new rules no longer place, once. */
export const NODE_RULES = 7; // 2: half the berries, 3: thinner forests, 4: nothing on mountains, 5: more rocks, 6: iron veins and crystals, 7: mud, gems, gold, herbs

/** Which node grows on a tile. Seedless, so worlds saved before nodes existed can be backfilled. */
export function nodeKindAt(t: number, x: number, y: number): NodeKind | null {
  const r = hash01(x, y);
  if (t === T.FOREST) return r < 0.22 ? 'tree' : r >= 0.4 && r < 0.42 ? 'berry_bush' : r >= 0.42 && r < 0.44 ? 'herb' : null;
  if (t === T.MEADOW) return r < 0.02 ? 'tree' : r < 0.035 ? 'berry_bush' : r < 0.04 ? 'herb' : r >= 0.05 && r < 0.11 ? 'grass' : null;
  if (t === T.HILLS) return r < 0.25 ? 'rock' : r < 0.29 ? 'iron_vein' : null;
  if (t === T.MOUNTAIN) return r < 0.05 ? 'iron_vein' : r < 0.065 ? 'gem_vein' : null;
  if (t === T.HIGH) return r < 0.05 ? 'iron_vein' : r < 0.065 ? 'gem_vein' : r < 0.075 ? 'gold_vein' : null;
  if (t === T.PEAK) return r < 0.01 ? 'crystal' : r < 0.02 ? 'gold_vein' : null;
  if (t === T.RUINS) return r < 0.03 ? 'crystal' : null;
  if (t === T.SHALLOW) return r < 0.06 ? 'mud' : null;
  if (t === T.SAND) return r < 0.03 ? 'mud' : null;
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

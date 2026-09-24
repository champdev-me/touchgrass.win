import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Agent, type Vec } from '../shared/types.ts';
import type { World } from './world.ts';

const CHAR: Record<number, string> = { [T.DEEP]: '~', [T.SHALLOW]: ',', [T.SAND]: ':', [T.MEADOW]: '.', [T.FOREST]: 'f', [T.HILLS]: '^', [T.RUINS]: 'r', [T.PLAZA]: '#' };

export const chunksPerRow = (size: number): number => Math.ceil(size / B.chunkSize);

export const chunkIndex = (w: World, x: number, y: number): number =>
  Math.floor(y / B.chunkSize) * chunksPerRow(w.size) + Math.floor(x / B.chunkSize);

export function explore(w: World, a: Agent): void {
  const c = chunkIndex(w, a.x, a.y);
  if (!a.explored.includes(c)) {
    a.explored.push(c);
    w.dirty.add(a.id);
  }
}

/** Most common terrain per chunk, for the map overview. */
export function dominantTerrain(tiles: Uint8Array, size: number): Uint8Array {
  const n = chunksPerRow(size), out = new Uint8Array(n * n);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const counts = new Map<number, number>();
      for (let y = cy * B.chunkSize; y < Math.min(size, (cy + 1) * B.chunkSize); y++) {
        for (let x = cx * B.chunkSize; x < Math.min(size, (cx + 1) * B.chunkSize); x++) {
          const t = tiles[y * size + x];
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      }
      out[cy * n + cx] = [...counts].sort((p, q) => q[1] - p[1])[0][0];
    }
  }
  return out;
}

export function renderMap(w: World, a: Agent) {
  const n = chunksPerRow(w.size), mine = chunkIndex(w, a.x, a.y), seen = new Set(a.explored), terrain = w.chunkTerrainOf();
  const map: string[] = [];
  for (let cy = 0; cy < n; cy++) {
    const row: string[] = [];
    for (let cx = 0; cx < n; cx++) {
      const c = cy * n + cx;
      row.push(c === mine ? '@' : seen.has(c) ? CHAR[terrain[c]] : '?');
    }
    map.push(row.join(' '));
  }
  const you: Vec = [a.x, a.y];
  return {
    map,
    legend: { '@': 'you are here', '?': 'unexplored', '~': 'mostly deep water', ',': 'shallow water', ':': 'sand', '.': 'meadow', f: 'forest', '^': 'hills', r: 'ruins', '#': 'the Plaza' },
    scale: `Each cell is a ${B.chunkSize}x${B.chunkSize}-tile chunk: column c, row r covers x ${B.chunkSize}*c to ${B.chunkSize}*c+${B.chunkSize - 1}, same for y.`,
    explored: `${seen.size}/${n * n} chunks`,
    you,
  };
}

import { createNoise2D } from 'simplex-noise';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Terrain } from '../shared/types.ts';

export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp /= 2;
    freq *= 2;
  }
  return sum / norm;
}

export function generateTerrain(seed: string, size: number = B.mapSize): Uint8Array {
  const rng = mulberry32(hashSeed(seed));
  const elev = createNoise2D(rng), moist = createNoise2D(rng), ruin = createNoise2D(rng);
  const tiles = new Uint8Array(size * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Island falloff: the edges sink into deep water so the finite world has a natural border.
      const d = Math.max(Math.abs(x - c), Math.abs(y - c)) / c;
      const e = fbm(elev, x / 128, y / 128) + 0.25 - Math.pow(d, 6) * 2;
      const m = fbm(moist, x / 90, y / 90);
      let t: Terrain;
      if (e < -0.25) t = T.DEEP;
      else if (e < -0.12) t = T.SHALLOW;
      else if (e < -0.06) t = T.SAND;
      else if (e > 0.6) t = T.HILLS;
      else if (m > 0.15) t = T.FOREST;
      else t = T.MEADOW;
      if ((t === T.MEADOW || t === T.FOREST) && ruin(x / 24, y / 24) > 0.82) t = T.RUINS;
      tiles[y * size + x] = t;
    }
  }
  const h = Math.min(B.plazaHalf, size / 4);
  for (let y = c - h; y < c + h; y++) for (let x = c - h; x < c + h; x++) tiles[y * size + x] = T.PLAZA;
  raiseMountains(tiles, size);
  return tiles;
}

/** Bumped when terrain rules change; loadWorld re-applies them to older saved worlds once. */
export const TERRAIN_RULES = 2;

/** Hill interiors become impassable mountains (peaks deeper in). Idempotent, so old worlds convert on load. */
export function raiseMountains(tiles: Uint8Array, size: number): void {
  const d = new Int32Array(tiles.length);
  for (let i = 0; i < d.length; i++) d[i] = tiles[i] === T.HILLS ? 1 << 20 : 0;
  const near = (x: number, y: number) => (x < 0 || y < 0 || x >= size || y >= size ? 1 : d[y * size + x] + 1);
  // Two-pass chamfer: Chebyshev distance from each hill tile to the nearest non-hill tile.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (d[i]) d[i] = Math.min(d[i], near(x - 1, y), near(x, y - 1), near(x - 1, y - 1), near(x + 1, y - 1));
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      if (d[i]) d[i] = Math.min(d[i], near(x + 1, y), near(x, y + 1), near(x + 1, y + 1), near(x - 1, y + 1));
    }
  }
  for (let i = 0; i < tiles.length; i++) if (d[i] >= B.mountainFrom) tiles[i] = d[i] >= B.peakFrom ? T.PEAK : T.MOUNTAIN;
}

export function tileAt(tiles: Uint8Array, x: number, y: number, size: number = B.mapSize): number {
  return x < 0 || y < 0 || x >= size || y >= size ? T.DEEP : tiles[y * size + x];
}

export const walkable = (t: number): boolean => t !== T.DEEP && t !== T.MOUNTAIN && t !== T.PEAK;
export const stepCost = (t: number): number => (t === T.SHALLOW ? 2 : 1);

export function chunkBytes(tiles: Uint8Array, cx: number, cy: number, size: number = B.mapSize): Uint8Array {
  const n = B.chunkSize, out = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    const start = (cy * n + j) * size + cx * n;
    out.set(tiles.subarray(start, start + n), j * n);
  }
  return out;
}

export function writeChunk(tiles: Uint8Array, cx: number, cy: number, bytes: Uint8Array, size: number = B.mapSize): void {
  const n = B.chunkSize;
  for (let j = 0; j < n; j++) tiles.set(bytes.subarray(j * n, j * n + n), (cy * n + j) * size + cx * n);
}

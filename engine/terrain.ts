import { createNoise2D } from 'simplex-noise';
import { B } from '../shared/balance.ts';
import { TERRAIN as T } from '../shared/types.ts';

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

export interface Land {
  tiles: Uint8Array;
  heights: Uint8Array; // height level per tile; robots climb at most B.maxClimb per step
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Island with ridged mountain ranges, rolling plains, forests, beaches and dry sand, lakes and rivers. */
export function generateLand(seed: string, size: number = B.mapSize): Land {
  const rng = mulberry32(hashSeed(seed));
  const elev = createNoise2D(rng), moist = createNoise2D(rng), ruin = createNoise2D(rng);
  const range = createNoise2D(rng), ridge = createNoise2D(rng), lake = createNoise2D(rng);
  const tiles = new Uint8Array(size * size), heights = new Uint8Array(size * size), ground = new Float32Array(size * size);
  const c = size / 2, k = size / 1024; // noise scales are tuned for a 1024 map
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // Island falloff: the edges sink into deep water so the finite world has a natural border.
      const d = Math.max(Math.abs(x - c), Math.abs(y - c)) / c;
      const e = fbm(elev, x / (160 * k), y / (160 * k)) + 0.3 - Math.pow(d, 6) * 2;
      // Mountain ranges: ridged noise, only inside a slowly varying range mask, fading near the coast.
      const mask = smooth(0.05, 0.4, fbm(range, x / (320 * k), y / (320 * k))) * smooth(-0.05, 0.25, e);
      const mtn = mask * Math.pow(1 - Math.abs(fbm(ridge, x / (110 * k), y / (110 * k))), 2.5);
      const m = fbm(moist, x / (90 * k), y / (90 * k));
      ground[i] = e + mtn;
      let t: number, h: number;
      if (e < -0.25) [t, h] = [T.DEEP, 0];
      else if (e < -0.12) [t, h] = [T.SHALLOW, 0];
      else if (e < -0.06) [t, h] = [T.SAND, 1];
      else {
        h = 1 + Math.max(0, Math.floor((e - 0.25) * 4)) + Math.floor(Math.max(0, mtn - 0.08) * 30); // rolling plains, then mountains rise
        t = h >= 16 ? T.PEAK : h >= 10 ? T.HIGH : h >= 5 ? T.MOUNTAIN : h >= 3 ? T.HILLS : m > 0.15 ? T.FOREST : m < -0.38 ? T.SAND : T.MEADOW;
        if (h <= 2 && fbm(lake, x / (70 * k), y / (70 * k)) > 0.5) [t, h] = [fbm(lake, x / (70 * k), y / (70 * k)) > 0.58 ? T.DEEP : T.SHALLOW, 0];
        if ((t === T.MEADOW || t === T.FOREST) && ruin(x / 24, y / 24) > 0.82) t = T.RUINS;
      }
      tiles[i] = t;
      heights[i] = Math.min(40, h);
    }
  }
  carveRivers(tiles, heights, ground, size, rng);
  const h = Math.min(B.plazaHalf, size / 4);
  for (let y = c - h; y < c + h; y++) {
    for (let x = c - h; x < c + h; x++) {
      tiles[y * size + x] = T.PLAZA;
      heights[y * size + x] = 1;
    }
  }
  return { tiles, heights };
}

export const generateTerrain = (seed: string, size: number = B.mapSize): Uint8Array => generateLand(seed, size).tiles;

/** Rivers start in the mountains, meander outward to the sea, never flow uphill, and carve canyons through hills. */
function carveRivers(tiles: Uint8Array, heights: Uint8Array, ground: Float32Array, size: number, rng: () => number): void {
  const want = Math.round(B.rivers * (size / 1024) ** 2), c = size / 2;
  const high = (t: number) => t === T.HIGH || t === T.PEAK;
  for (let r = 0, tries = 0; r < want && tries < want * 200; tries++) {
    const x0 = Math.floor(rng() * size), y0 = Math.floor(rng() * size);
    if (tiles[y0 * size + x0] !== T.MOUNTAIN) continue;
    r++;
    let x = x0, y = y0, level = heights[y0 * size + x0], dir = Math.atan2(y0 - c, x0 - c);
    const seen = new Set<number>(), carved = new Set<number>();
    for (let step = 0; step < size; step++) {
      const i = y * size + x;
      if (step > 3 && !carved.has(i) && (tiles[i] === T.DEEP || tiles[i] === T.SHALLOW)) break; // the sea, a lake or another river
      seen.add(i);
      level = Math.min(level, Math.max(0, heights[i] - 1));
      const wide = step > 60 ? 2 : step > 20 ? 1 : 0; // rivers widen as they flow
      for (let wy = -wide; wy <= wide; wy++) {
        for (let wx = -wide; wx <= wide; wx++) {
          const j = (y + wy) * size + x + wx;
          if (Math.abs(wx) + Math.abs(wy) > wide || tiles[j] === T.DEEP || tiles[j] === T.PLAZA) continue;
          tiles[j] = T.SHALLOW;
          heights[j] = Math.min(heights[j], level);
          carved.add(j);
        }
      }
      // Meander, but keep heading away from the island centre.
      const out = Math.atan2(y - c, x - c);
      dir += (rng() - 0.5) * 0.6 + Math.atan2(Math.sin(out - dir), Math.cos(out - dir)) * 0.08;
      let best = -1, bestS = Infinity;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * size + nx;
        if (nx < 1 || ny < 1 || nx >= size - 1 || ny >= size - 1 || seen.has(j)) continue;
        const s = -(dx * Math.cos(dir) + dy * Math.sin(dir)) + (high(tiles[j]) ? 1.5 : 0) + ground[j] * 0.3;
        if (s < bestS) [best, bestS] = [j, s];
      }
      if (best < 0) {
        lakeAt(tiles, heights, size, x, y, level);
        break;
      }
      [x, y] = [best % size, Math.floor(best / size)];
    }
  }
}

function lakeAt(tiles: Uint8Array, heights: Uint8Array, size: number, cx: number, cy: number, level: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, r = Math.hypot(dx, dy);
      if (x < 0 || y < 0 || x >= size || y >= size || r > 4) continue;
      const i = y * size + x;
      tiles[i] = r < 2 ? T.DEEP : T.SHALLOW;
      heights[i] = level;
    }
  }
}

export function tileAt(tiles: Uint8Array, x: number, y: number, size: number = B.mapSize): number {
  return x < 0 || y < 0 || x >= size || y >= size ? T.DEEP : tiles[y * size + x];
}

export const walkable = (t: number): boolean => t !== T.DEEP;
const LEVEL: Record<number, number> = { [T.DEEP]: 0, [T.SHALLOW]: 0, [T.HILLS]: 3, [T.MOUNTAIN]: 6, [T.HIGH]: 11, [T.PEAK]: 17 };
/** Heights for a map that was saved without them: one level per terrain type. */
export const levelsOf = (tiles: Uint8Array): Uint8Array => tiles.map((t) => LEVEL[t] ?? 1);
/** Terrain generator version; loadWorld regenerates the land of older worlds once. */
export const TERRAIN_RULES = 3;
export const stepCost = (t: number): number => (t === T.SHALLOW || t === T.MOUNTAIN || t === T.HIGH || t === T.PEAK ? 2 : 1);

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

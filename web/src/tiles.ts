import { TERRAIN as T } from '../../shared/types.ts';

// A tile's top sits at its height level plus a small per-type offset (water a bit below its bank, sand a touch low).
const OFFSET: Record<number, number> = { [T.DEEP]: 0.2, [T.SHALLOW]: 0.55, [T.SAND]: -0.1, [T.RUINS]: 0.05, [T.PLAZA]: 0.1 };
const LEVEL: Record<number, number> = { [T.DEEP]: 0, [T.SHALLOW]: 0, [T.HILLS]: 3, [T.MOUNTAIN]: 6, [T.HIGH]: 11, [T.PEAK]: 17 };
export const COLOR: Record<number, string> = {
  [T.DEEP]: '#1d4e89', [T.SHALLOW]: '#3a7ca5', [T.SAND]: '#e3d59f', [T.MEADOW]: '#7cc36b', [T.FOREST]: '#4f9a4a', [T.RUINS]: '#b9a88a',
  [T.PLAZA]: '#d8c9a3', [T.HILLS]: '#9a9a8f', [T.MOUNTAIN]: '#857f78', [T.HIGH]: '#6f6a64', [T.PEAK]: '#f2f5f7',
};
export const WATER_LEVEL = 0.7;
/** Fallback for chunks sent without heights (older servers). */
export const levelOf = (t: number): number => LEVEL[t] ?? 1;
export const heightOf = (t: number, level: number): number => level + (OFFSET[t] ?? 0);

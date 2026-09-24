import { hash01 } from '../../shared/hash.ts';
import { TERRAIN as T } from '../../shared/types.ts';

const HEIGHT: Record<number, number> = { [T.DEEP]: 0.2, [T.SHALLOW]: 0.55, [T.SAND]: 0.9, [T.MEADOW]: 1, [T.FOREST]: 1, [T.RUINS]: 1.05, [T.PLAZA]: 1.1, [T.HILLS]: 1.6, [T.MOUNTAIN]: 2.6, [T.PEAK]: 4.2 };
const RUGGED: Record<number, number> = { [T.MOUNTAIN]: 1.2, [T.PEAK]: 1.8 }; // per-tile extra height so mountains are not flat
export const COLOR: Record<number, string> = { [T.DEEP]: '#1d4e89', [T.SHALLOW]: '#3a7ca5', [T.SAND]: '#e3d59f', [T.MEADOW]: '#7cc36b', [T.FOREST]: '#4f9a4a', [T.RUINS]: '#b9a88a', [T.PLAZA]: '#d8c9a3', [T.HILLS]: '#9a9a8f', [T.MOUNTAIN]: '#857f78', [T.PEAK]: '#f2f5f7' };
export const WATER_LEVEL = 0.7;
export const heightOf = (t: number, x = 0, y = 0): number => (HEIGHT[t] ?? 1) + (RUGGED[t] ? hash01(x, y) * RUGGED[t] : 0);

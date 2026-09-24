import { TERRAIN as T } from '../../shared/types.ts';

const HEIGHT: Record<number, number> = { [T.DEEP]: 0.2, [T.SHALLOW]: 0.55, [T.SAND]: 0.9, [T.MEADOW]: 1, [T.FOREST]: 1, [T.RUINS]: 1.05, [T.PLAZA]: 1.1, [T.HILLS]: 1.6 };
export const COLOR: Record<number, string> = { [T.DEEP]: '#1d4e89', [T.SHALLOW]: '#3a7ca5', [T.SAND]: '#e3d59f', [T.MEADOW]: '#7cc36b', [T.FOREST]: '#4f9a4a', [T.RUINS]: '#b9a88a', [T.PLAZA]: '#d8c9a3', [T.HILLS]: '#9a9a8f' };
export const WATER_LEVEL = 0.7;
export const heightOf = (t: number): number => HEIGHT[t] ?? 1;

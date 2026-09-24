import type { Vec } from './types.ts';

const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

/** Compass direction for an offset; y grows southward like the map. */
export function compass(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'here';
  return DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
}

export function dist(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { findPath } from './path.ts';

function mapOf(rows: string[]) {
  const code: Record<string, number> = { '.': T.MEADOW, '~': T.DEEP, ',': T.SHALLOW };
  return (x: number, y: number): number => (rows[y]?.[x] === undefined ? T.DEEP : code[rows[y][x]]);
}

test('walks straight across open ground', () => {
  assert.deepEqual(findPath(mapOf(['.....', '.....']), [0, 0], [4, 0]), [[1, 0], [2, 0], [3, 0], [4, 0]]);
});

test('goes around deep water', () => {
  const at = mapOf(['.~.', '.~.', '...']);
  const path = findPath(at, [0, 0], [2, 0])!;
  assert.equal(path.length, 6);
  assert.deepEqual(path.at(-1), [2, 0]);
  assert.ok(path.every(([x, y]) => at(x, y) !== T.DEEP));
});

test('prefers a short land detour over slow shallow water', () => {
  const at = mapOf(['.,,,.', '.....']);
  assert.ok(findPath(at, [0, 0], [4, 0])!.every(([x, y]) => at(x, y) !== T.SHALLOW));
});

test('returns null for unreachable, deep-water or too-far targets', () => {
  const split = mapOf(['..~..', '..~..', '..~..']);
  assert.equal(findPath(split, [0, 0], [4, 0]), null);
  assert.equal(findPath(split, [0, 0], [2, 0]), null);
  const wide = mapOf(['.'.repeat(300)]);
  assert.equal(findPath(wide, [0, 0], [200, 0]), null);
  assert.equal(findPath(wide, [0, 0], [100, 0])!.length, 100);
});

test('standing on the target is an empty path', () => {
  assert.deepEqual(findPath(mapOf(['..']), [1, 0], [1, 0]), []);
});

test('climbs one level per step but never a cliff', () => {
  const at = mapOf(['.....']);
  const h = [1, 2, 3, 5, 5];
  const step = (ax: number, _ay: number, bx: number) => Math.abs(h[bx] - h[ax]) <= 1;
  assert.deepEqual(findPath(at, [0, 0], [2, 0], 128, step), [[1, 0], [2, 0]]);
  assert.equal(findPath(at, [0, 0], [4, 0], 128, step), null);
});

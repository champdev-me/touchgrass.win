import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { dist } from '../shared/geo.ts';
import { TERRAIN as T, type Base, type Role } from '../shared/types.ts';
import { baseOf, buyLand, isLand, stripPrice } from './bases.ts';
import { build } from './craft.ts';
import { GameFail, World } from './world.ts';

function lakeWorld(): World {
  const n = 256, tiles = new Uint8Array(n * n).fill(T.MEADOW);
  for (let y = 60; y < 110; y++) for (let x = 60; x < 110; x++) tiles[y * n + x] = x < 70 || y < 70 ? T.SHALLOW : T.DEEP;
  for (let y = 118; y < 138; y++) for (let x = 118; x < 138; x++) tiles[y * n + x] = T.PLAZA;
  let seed = 11;
  return new World(tiles, n, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
}
const tilesOf = (b: Base) => {
  const out: [number, number][] = [];
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) out.push([x, y]);
  return out;
};
const touches = (p: Base, q: Base) => p.x0 - 1 <= q.x1 && q.x0 <= p.x1 + 1 && p.y0 - 1 <= q.y1 && q.y0 <= p.y1 + 1;

test('the first base sits 20-40 tiles from the Plaza; the robot moves to its flag', () => {
  const w = lakeWorld();
  const a = w.register('First', 0);
  w.join(a.id, 'scout', null, 0);
  const b = baseOf(w, a.id)!;
  assert.deepEqual([b.x1 - b.x0, b.y1 - b.y0], [4, 4]);
  assert.deepEqual(b.flag, [b.x0 + 2, b.y0 + 2]);
  const d = dist(b.flag, w.plaza);
  assert.ok(d >= 20 && d <= 40, `${d}`);
  assert.deepEqual([a.spawn, [a.x, a.y]], [b.flag, b.flag]);
  assert.equal(w.baseAt(b.x0, b.y1), b);
  assert.equal(w.baseAt(b.x0 - 1, b.y0), null);
});

test('later bases: all land, never touching, each within 100 tiles of an earlier robot', () => {
  const w = lakeWorld();
  const flags: [number, number][] = [];
  for (let i = 0; i < 31; i++) {
    const a = w.register(`R${i}`, 0);
    w.join(a.id, 'scout', null, 0);
    const b = baseOf(w, a.id);
    assert.ok(b, `robot ${i} got no base`);
    for (const [x, y] of tilesOf(b!)) assert.ok(isLand(w, x, y), `water or plaza at ${x},${y}`);
    if (i > 0) assert.ok(flags.some((f) => dist(f, b!.flag) <= 100), `robot ${i} is far from everyone`);
    flags.push(b!.flag);
  }
  const all = [...w.bases.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(!touches(all[i], all[j]), `bases ${i} and ${j} touch`);
});

test('no room anywhere: the robot joins without a base', () => {
  const tiles = new Uint8Array(12 * 12).fill(T.DEEP);
  for (let x = 0; x < 12; x++) tiles[x] = T.MEADOW;
  const w = new World(tiles, 12, () => 0.5);
  const a = w.register('Castaway', 0);
  w.join(a.id, 'scout', null, 0);
  assert.equal(baseOf(w, a.id), null);
  assert.equal(a.joined, true);
});

function open(n = 128): World {
  return new World(new Uint8Array(n * n).fill(T.MEADOW), n, () => 0.5);
}
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};
function homed(w: World, name: string, role: Role = 'scout') {
  const a = w.register(name, 0);
  w.join(a.id, role, null, 0);
  return a;
}

test('buy_land grows the base by a strip for gold, with every refusal leaving gold alone', () => {
  const w = open();
  const a = homed(w, 'Ann');
  const b = baseOf(w, a.id)!;
  a.wallet = 100;
  assert.equal(stripPrice(b, 'e'), 5);
  buyLand(w, a.id, 'e');
  assert.deepEqual([b.x1 - b.x0 + 1, b.y1 - b.y0 + 1, a.wallet], [6, 5, 95]);
  a.wallet = 2;
  assert.equal(code(() => buyLand(w, a.id, 'e')), 'not_enough_gold');
  a.wallet = 1000;
  [a.x, a.y] = [b.x0 - 3, b.y0];
  assert.equal(code(() => buyLand(w, a.id, 'n')), 'not_home');
  [a.x, a.y] = b.flag;
  w.tiles[w.index(b.x0 + 1, b.y0 - 1)] = T.SHALLOW;
  assert.equal(code(() => buyLand(w, a.id, 'n')), 'water');
  b.x1 = b.x0 + 31;
  assert.equal(code(() => buyLand(w, a.id, 'e')), 'too_big');
  assert.equal(a.wallet, 1000);
});

test('a strip may not reach into a neighbour', () => {
  const w = open();
  const a = homed(w, 'Ann');
  const b = baseOf(w, a.id)!;
  w.bases.set('agent_x', { owner: 'agent_x', x0: b.x1 + 2, y0: b.y0, x1: b.x1 + 6, y1: b.y1, flag: [b.x1 + 4, b.y0 + 2] });
  a.wallet = 100;
  assert.equal(code(() => buyLand(w, a.id, 'e')), 'neighbour');
  assert.equal(a.wallet, 100);
});

test("strangers cannot gather, build or store in someone else's base; observe says whose base it is", () => {
  const w = open();
  const a = homed(w, 'Ann', 'gatherer');
  const b = baseOf(w, a.id)!;
  const s = homed(w, 'Stranger', 'gatherer');
  [s.x, s.y] = [b.x0 + 1, b.y0 + 1];
  w.nodes.set(w.index(b.x0 + 2, b.y0 + 1), { kind: 'tree', left: 5, regrowAt: 0 });
  assert.equal(code(() => w.gather(s.id, 'tree')), 'wrong_base');
  s.inventory = { wood: 20 };
  assert.equal(code(() => build(w, s.id, 'chest')), 'wrong_base');
  const o = w.observe(s.id);
  assert.equal(o.you.standing_in, "Ann's base");
  assert.equal(w.observe(a.id).you.base?.next_strip_price.e, 5);
  assert.equal(code(() => w.gather(a.id, 'tree')), 'ok');
});

test("visitors may still pick up loot piles in someone else's base", () => {
  const w = open();
  const a = homed(w, 'Ann');
  const b = baseOf(w, a.id)!;
  const s = homed(w, 'Visitor');
  [s.x, s.y] = [b.x0, b.y0];
  s.inventory = {};
  w.dropLoot(w.index(b.x0 + 1, b.y0), { wood: 2 });
  assert.equal(code(() => w.gather(s.id, 'loot')), 'ok');
});

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Role } from '../shared/types.ts';
import { baseOf } from './bases.ts';
import { build, craft } from './craft.ts';
import { harvest, plant } from './farm.ts';
import { GameFail, World } from './world.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};
function setup(rng = () => 0.5) {
  const w = new World(new Uint8Array(128 * 128).fill(T.MEADOW), 128, rng);
  const f = w.register('Farmer', 0);
  w.join(f.id, 'farmer', null, 0);
  return { w, f, flag: baseOf(w, f.id)!.flag };
}
function joined(w: World, name: string, role: Role) {
  const a = w.register(name, 0);
  w.join(a.id, role, null, 0);
  return a;
}

test('till, plant, wait, harvest: wheat', () => {
  const { w, f, flag: [fx, fy] } = setup();
  build(w, f.id, 'farm_plot', fx + 1, fy);
  assert.equal(f.wear.hoe, 49);
  plant(w, f.id, 'wheat_seed', fx + 1, fy);
  assert.equal(f.inventory.wheat_seed, 2);
  assert.equal(code(() => harvest(w, f.id, fx + 1, fy)), 'not_ready');
  w.tick += 900;
  harvest(w, f.id, fx + 1, fy);
  assert.deepEqual([f.inventory.wheat, f.inventory.wheat_seed], [3, 4]);
  assert.equal(w.structures.get(w.index(fx + 1, fy))?.crop, undefined);
});

test('berries take 20 minutes; only farmers plant; only the owner harvests', () => {
  const { w, f, flag: [fx, fy] } = setup();
  build(w, f.id, 'farm_plot', fx - 1, fy);
  f.inventory.berry_seed = 1;
  plant(w, f.id, 'berry_seed', fx - 1, fy);
  const s = joined(w, 'Thief', 'farmer');
  [s.x, s.y] = [fx, fy + 1];
  w.tick += 1200;
  assert.equal(code(() => harvest(w, s.id, fx - 1, fy)), 'wrong_base');
  harvest(w, f.id, fx - 1, fy);
  assert.deepEqual([f.inventory.berries, f.inventory.berry_seed], [5, 1]);
  const g = joined(w, 'Gardener', 'gatherer');
  g.inventory = { wheat_seed: 1 };
  assert.equal(code(() => plant(w, g.id, 'wheat_seed')), 'wrong_role');
});

test('farm plots need a hoe and meadow or sand', () => {
  const { w, f, flag: [fx, fy] } = setup();
  w.tiles[w.index(fx + 2, fy)] = T.FOREST;
  assert.equal(code(() => build(w, f.id, 'farm_plot', fx + 2, fy)), 'bad_ground');
  f.inventory = {};
  assert.equal(code(() => build(w, f.id, 'farm_plot', fx + 1, fy)), 'no_hoe');
});

test('farmers bake bread at a lit campfire; smiths make hoes', () => {
  const { w, f, flag: [fx, fy] } = setup();
  f.inventory = { wheat: 3, wood: 5, stone: 3 };
  build(w, f.id, 'campfire', fx + 1, fy);
  craft(w, f.id, 'bread');
  f.food = 50;
  w.eatItem(f.id, 'bread');
  assert.equal(Math.round(f.food), 80);
  const s = joined(w, 'Smith', 'smith');
  s.inventory = { wood: 3, stone: 2 };
  [s.x, s.y] = [fx, fy];
  w.structures.set(w.index(fx - 1, fy), { kind: 'workbench', owner: f.id, litUntil: 0 });
  craft(w, s.id, 'hoe');
  assert.equal(s.inventory.hoe, 1);
});

test('picking grass and berries sometimes turns up seeds', () => {
  const { w } = setup(() => 0.01); // every roll hits
  const g = joined(w, 'Picker', 'gatherer');
  const home = baseOf(w, g.id)!.flag;
  g.inventory = {};
  w.nodes.set(w.index(home[0] + 1, home[1]), { kind: 'grass', left: 3, regrowAt: 0 });
  w.gather(g.id, 'grass', 2);
  for (let i = 0; i < 3; i++) w.step(0);
  assert.ok((g.inventory.wheat_seed ?? 0) > 0, JSON.stringify(g.inventory));
});

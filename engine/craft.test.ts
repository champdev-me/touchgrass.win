import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Role, type Vec } from '../shared/types.ts';
import { build, craft, fuel } from './craft.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
}
function robot(w: World, at: Vec, bag: Record<string, number> = {}, role: Role = 'scout') {
  const a = w.register(`R${at.join('')}`, 0);
  w.join(a.id, role, null, 0);
  [a.x, a.y] = at;
  a.inventory = bag;
  return a;
}
const failCode = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('hand recipes work anywhere; station recipes need the station within 2 tiles', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 20, stone: 10, fiber: 10 });
  assert.deepEqual(craft(w, a.id, 'torch', 2).crafted, 'torch');
  assert.equal(a.inventory.torch, 2);
  assert.equal(failCode(() => craft(w, a.id, 'stone_axe')), 'no_station');
  build(w, a.id, 'workbench');
  assert.equal(a.inventory.wood, 20 - 2 - 6);
  craft(w, a.id, 'stone_axe');
  assert.equal(a.inventory.stone_axe, 1);
  a.x = 20;
  assert.equal(failCode(() => craft(w, a.id, 'stone_pickaxe')), 'no_station');
});

test('building needs materials and a free tile; stations are solid; nothing is used on failure', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 3 });
  assert.equal(failCode(() => build(w, a.id, 'campfire')), 'missing_materials');
  assert.deepEqual(a.inventory, { wood: 3 });
  a.inventory = { stone: 30 };
  const f = build(w, a.id, 'furnace');
  assert.ok(w.solid(f.at[0], f.at[1]));
  assert.equal(failCode(() => build(w, a.id, 'castle')), 'bad_structure');
  const b = robot(w, [30, 30], { stone: 10 });
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.nodes.set(w.index(30 + dx, 30 + dy), { kind: 'tree', left: 3, regrowAt: 0 });
  assert.equal(failCode(() => build(w, b.id, 'furnace')), 'no_space');
  assert.deepEqual(b.inventory, { stone: 10 });
});

test('a campfire cooks, burns out, can be refuelled, and keeps monsters away while lit', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 10, stone: 3, meat: 2 });
  const fire = build(w, a.id, 'campfire');
  assert.ok(w.lit(fire.at[0] + 5, fire.at[1]));
  assert.ok(!w.lit(fire.at[0] + 9, fire.at[1]));
  craft(w, a.id, 'cooked_meat');
  assert.equal(a.inventory.cooked_meat, 1);
  w.tick += B.campfireTicks + 1;
  assert.equal(failCode(() => craft(w, a.id, 'cooked_meat')), 'no_station'); // it went out
  fuel(w, a.id);
  assert.equal(a.inventory.wood, 4);
  craft(w, a.id, 'cooked_meat');
  assert.equal(a.inventory.cooked_meat, 2);
});

test('blueprint recipes need the blueprint; iron comes from the furnace', () => {
  const w = world();
  const a = robot(w, [10, 10], { stone: 12, wood: 10, iron_ore: 3 });
  build(w, a.id, 'furnace');
  craft(w, a.id, 'iron', 3);
  assert.equal(a.inventory.iron, 3);
  a.inventory.stone = 2;
  a.inventory.wood += 6;
  build(w, a.id, 'workbench');
  assert.equal(failCode(() => craft(w, a.id, 'frying_pan')), 'no_blueprint');
  a.blueprints.push('frying_pan');
  craft(w, a.id, 'frying_pan');
  assert.equal(a.inventory.frying_pan, 1);
});

test('builders build for half the materials (rounded up)', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 3, stone: 1 }, 'builder');
  build(w, a.id, 'workbench'); // 6 wood + 2 stone halves to 3 + 1
  assert.deepEqual(a.inventory, {});
});

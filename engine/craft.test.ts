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
  // a roomy test base around the robot, unless it would overlap a neighbour's
  const mine = { owner: a.id, x0: at[0] - 6, y0: at[1] - 6, x1: at[0] + 6, y1: at[1] + 6, flag: at };
  const clash = [...w.bases.values()].some((b) => b.owner !== a.id && b.x0 <= mine.x1 && mine.x0 <= b.x1 && b.y0 <= mine.y1 && mine.y0 <= b.y1);
  if (clash) w.bases.delete(a.id);
  else w.bases.set(a.id, mine);
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
  const a = robot(w, [10, 10], { wood: 20, stone: 10, fiber: 10 }, 'carpenter');
  assert.deepEqual(craft(w, a.id, 'torch', 2).crafted, 'torch');
  assert.equal(a.inventory.torch, 2);
  a.role = 'smith';
  assert.equal(failCode(() => craft(w, a.id, 'stone_axe')), 'no_station');
  a.role = 'carpenter';
  build(w, a.id, 'workbench');
  assert.equal(a.inventory.wood, 20 - 2 - 6);
  a.role = 'smith';
  craft(w, a.id, 'stone_axe');
  assert.equal(a.inventory.stone_axe, 1);
  a.x = 20;
  assert.equal(failCode(() => craft(w, a.id, 'stone_pickaxe')), 'no_station');
});

test('building needs materials and a free tile; stations are solid; nothing is used on failure', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 3 }, 'mason');
  assert.equal(failCode(() => build(w, a.id, 'campfire')), 'missing_materials');
  assert.deepEqual(a.inventory, { wood: 3 });
  a.inventory = { stone: 30 };
  const f = build(w, a.id, 'kiln');
  assert.ok(w.solid(f.at[0], f.at[1]));
  assert.equal(failCode(() => build(w, a.id, 'castle')), 'bad_structure');
  const b = robot(w, [30, 30], { stone: 10 }, 'mason');
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.nodes.set(w.index(30 + dx, 30 + dy), { kind: 'tree', left: 3, regrowAt: 0 });
  assert.equal(failCode(() => build(w, b.id, 'kiln')), 'no_space');
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

test('iron comes from a mason furnace; iron gear needs no blueprint any more', () => {
  const w = world();
  const m = robot(w, [10, 10], { stone: 4, brick: 6 }, 'mason');
  build(w, m.id, 'furnace');
  const a = robot(w, [10, 11], { stone: 2, wood: 10, iron_ore: 3 }, 'smith');
  craft(w, a.id, 'iron', 3);
  assert.equal(a.inventory.iron, 3);
  w.structures.set(w.index(12, 11), { kind: 'workbench', owner: m.id, litUntil: 0 }); // a carpenter's work
  craft(w, a.id, 'frying_pan');
  assert.equal(a.inventory.frying_pan, 1);
});

test('masons fire bricks at a kiln; others are told to find a mason', () => {
  const w = world();
  const m = robot(w, [5, 5], { stone: 8, mud: 4, wood: 2 }, 'mason');
  build(w, m.id, 'kiln');
  craft(w, m.id, 'brick', 2);
  assert.equal(m.inventory.brick, 2);
  const s = robot(w, [5, 6], { mud: 2, wood: 1 }, 'smith');
  assert.equal(failCode(() => craft(w, s.id, 'brick')), 'wrong_role');
});

test('only smiths craft at the workbench; anyone crafts by hand and cooks', () => {
  const w = world();
  const h = robot(w, [5, 5], { wood: 9, stone: 3, fiber: 3 }, 'hunter');
  w.structures.set(w.index(6, 5), { kind: 'workbench', owner: 'x', litUntil: 0 });
  assert.equal(failCode(() => craft(w, h.id, 'stone_axe')), 'wrong_role');
  craft(w, h.id, 'club');
  assert.equal(h.inventory.club, 1);
});

test('builds: chests for anyone and as many as you like, furnaces for masons, workbenches for carpenters', () => {
  const w = world();
  const g = robot(w, [10, 10], { wood: 20 }, 'gatherer');
  for (let i = 0; i < 4; i++) build(w, g.id, 'chest');
  assert.equal([...w.structures.values()].filter((st) => st.kind === 'chest').length, 4);
  const s = robot(w, [30, 30], { stone: 10, brick: 6 }, 'smith');
  assert.equal(failCode(() => build(w, s.id, 'furnace')), 'wrong_role');
  assert.equal(failCode(() => build(w, g.id, 'workbench')), 'wrong_role');
});

test('a bandage eaten heals 15; gatherers craft it', () => {
  const w = world();
  const g = robot(w, [5, 5], { fiber: 2, herb: 1 }, 'gatherer');
  craft(w, g.id, 'bandage');
  g.health = 50;
  w.eatItem(g.id, 'bandage');
  assert.equal(g.health, 65);
});

test('smiths turn gems into a gem sword and a lucky charm', () => {
  const w = world();
  const s = robot(w, [5, 5], { iron: 4, gem: 3, wood: 2, fiber: 2 }, 'smith');
  w.structures.set(w.index(6, 5), { kind: 'workbench', owner: s.id, litUntil: 0 });
  craft(w, s.id, 'gem_sword');
  craft(w, s.id, 'lucky_charm');
  assert.deepEqual([s.inventory.gem_sword, s.inventory.lucky_charm, s.wear.gem_sword], [1, 1, 500]);
});

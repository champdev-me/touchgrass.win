import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Role, type Vec } from '../shared/types.ts';
import { armorOf, bestTool, useGear } from './gear.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(40 * 40).fill(T.MEADOW), 40, () => 0.99);
}
function robot(w: World, at: Vec, role: Role = 'scout') {
  const a = w.register(`R${at.join('')}${role}`, 0);
  w.join(a.id, role, null, 0);
  [a.x, a.y] = at;
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

test('axes speed up trees: hand 3 ticks, stone 2, iron 1', () => {
  for (const [tool, ticks] of [[null, 3], ['stone_axe', 2], ['iron_axe', 1]] as const) {
    const w = world();
    const a = robot(w, [5, 5]);
    if (tool) a.inventory[tool] = 1;
    w.nodes.set(w.index(6, 5), { kind: 'tree', left: 5, regrowAt: 0 });
    w.gather(a.id, 'tree', 1);
    for (let i = 0; i < ticks - 1; i++) w.step(0);
    assert.equal(a.inventory.wood, undefined, `${tool} too fast`);
    w.step(0);
    assert.equal(a.inventory.wood, 1, `${tool} at ${ticks}`);
  }
});

test('iron veins need a pickaxe; miners dig double; tools wear out and snap', () => {
  const w = world();
  const a = robot(w, [5, 5], 'miner');
  w.nodes.set(w.index(6, 5), { kind: 'iron_vein', left: 5, regrowAt: 0 });
  assert.equal(failCode(() => w.gather(a.id, 'iron_vein')), 'needs_pickaxe');
  a.inventory.stone_pickaxe = 1;
  a.wear.stone_pickaxe = 2;
  w.gather(a.id, 'iron_vein', 4);
  const events: string[] = [];
  for (let i = 0; i < 4; i++) events.push(...w.step(0).events.map((e) => e.text));
  assert.equal(a.inventory.iron_ore, 4); // two digs, 2 each for a miner
  assert.equal(a.inventory.stone_pickaxe, undefined);
  assert.ok(events.some((t) => t.includes('snapped')));
  assert.equal(bestTool(a, 'iron_vein'), null);
});

test('armor absorbs damage; worn gear counts once per use', () => {
  const w = world();
  const a = robot(w, [5, 5]);
  a.inventory.iron_armor = 1;
  a.inventory.hide_armor = 1;
  assert.equal(armorOf(a), 0.4);
  w.hurt(a, 10, 'wolf', 'A wolf');
  assert.equal(a.health, 94);
  a.inventory.club = 1;
  a.wear.club = 1;
  assert.equal(useGear(w, a, 'club'), true);
  assert.equal(a.inventory.club, undefined);
});

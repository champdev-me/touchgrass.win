import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Role } from '../shared/types.ts';
import { baseOf, releaseIdle, switchRole } from './bases.ts';
import { build, demolish } from './craft.ts';
import { GameFail, World } from './world.ts';

const world = () => new World(new Uint8Array(128 * 128).fill(T.MEADOW), 128, () => 0.5);
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};
function homed(w: World, name: string, role: Role, bag: Record<string, number> = {}) {
  const a = w.register(name, 0);
  w.join(a.id, role, null, 0);
  a.inventory = bag;
  return a;
}

test('who builds what, and only inside your own base (campfires anywhere)', () => {
  const w = world();
  const c = homed(w, 'Carp', 'carpenter', { wood: 60, fiber: 10, stone: 2 });
  const [fx, fy] = baseOf(w, c.id)!.flag;
  build(w, c.id, 'wood_wall', fx - 2, fy - 2);
  build(w, c.id, 'door', fx - 1, fy - 2);
  build(w, c.id, 'bed', fx + 1, fy);
  build(w, c.id, 'workbench', fx + 2, fy + 2);
  assert.equal(code(() => build(w, c.id, 'bed', fx + 1, fy + 1)), 'one_bed');
  assert.equal(code(() => build(w, c.id, 'stone_wall', fx, fy + 2)), 'wrong_role');
  const s = homed(w, 'Smithy', 'smith', { wood: 6, stone: 2 });
  assert.equal(code(() => build(w, s.id, 'workbench')), 'wrong_role');
  const m = homed(w, 'Mase', 'mason', { stone: 8, brick: 4 });
  const [mx, my] = baseOf(w, m.id)!.flag;
  build(w, m.id, 'stone_wall', mx + 1, my);
  build(w, m.id, 'brick_wall', mx - 1, my);
  [c.x, c.y] = [fx + 20, fy + 20];
  assert.ok(!w.baseAt(c.x, c.y));
  assert.equal(code(() => build(w, c.id, 'chest')), 'not_home');
  c.inventory.stone = 3;
  assert.equal(code(() => build(w, c.id, 'campfire')), 'ok');
  [c.x, c.y] = [fx, fy];
  for (let i = 0; i < 5; i++) build(w, c.id, 'chest', fx - 2 + i, fy + 1); // chests are unlimited
  assert.equal([...w.structures.values()].filter((s) => s.kind === 'chest').length, 5);
});

test('walls block everyone; a door opens only for its owner', () => {
  const w = world();
  const c = homed(w, 'Owner', 'carpenter', { wood: 200 });
  const b = baseOf(w, c.id)!;
  const [fx, fy] = b.flag;
  // ring the flag tile with walls, and a door to the east
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]]) build(w, c.id, 'wood_wall', fx + dx, fy + dy);
  build(w, c.id, 'door', fx + 1, fy);
  assert.ok(w.solid(fx + 1, fy));
  assert.equal(code(() => w.moveTo(c.id, fx + 5, fy)), 'ok');
  const s = homed(w, 'Guest', 'scout');
  [s.x, s.y] = [fx, fy];
  assert.equal(code(() => w.moveTo(s.id, fx + 5, fy)), 'no_path');
});

test('demolish: half back, chests spill, only your own (or ruins)', () => {
  const w = world();
  const c = homed(w, 'Carp', 'carpenter', { wood: 30 });
  const [fx, fy] = baseOf(w, c.id)!.flag;
  build(w, c.id, 'door', fx + 1, fy);
  build(w, c.id, 'chest', fx - 1, fy);
  w.structures.get(w.index(fx - 1, fy))!.items = { stone: 7 };
  c.inventory = {};
  demolish(w, c.id, fx + 1, fy);
  assert.equal(c.inventory.wood, 3);
  demolish(w, c.id, fx - 1, fy);
  assert.deepEqual(w.loot.get(w.index(fx - 1, fy))?.items, { stone: 7 });
  build(w, c.id, 'chest', fx, fy + 1);
  const s = homed(w, 'Other', 'carpenter');
  [s.x, s.y] = [fx, fy];
  assert.equal(code(() => demolish(w, s.id, fx, fy + 1)), 'not_yours');
  w.structures.get(w.index(fx, fy + 1))!.owner = '';
  assert.equal(code(() => demolish(w, s.id, fx, fy + 1)), 'ok');
});

test('switch_role: at home only, once per 10 minutes, no new kit, news', () => {
  const w = world();
  const a = homed(w, 'Ann', 'miner', { stone: 3 });
  const [fx, fy] = baseOf(w, a.id)!.flag;
  [a.x, a.y] = [fx + 30, fy];
  assert.equal(code(() => switchRole(w, a.id, 'farmer')), 'not_home');
  [a.x, a.y] = [fx, fy];
  switchRole(w, a.id, 'farmer');
  assert.deepEqual([a.role, a.inventory], ['farmer', { stone: 3 }]);
  assert.ok(w.step(0).events.some((e) => e.text === 'Ann is a farmer now.'));
  assert.equal(code(() => switchRole(w, a.id, 'carpenter')), 'too_soon');
  w.tick += B.switchRoleTicks;
  assert.equal(code(() => switchRole(w, a.id, 'carpenter')), 'ok');
  assert.equal(code(() => switchRole(w, a.id, 'wizard' as Role)), 'bad_role');
});

test('new robots: carpenters and farmers get their kits', () => {
  const w = world();
  const c = w.register('C', 0), f = w.register('F', 0);
  w.join(c.id, 'carpenter', null, 0);
  w.join(f.id, 'farmer', null, 0);
  assert.deepEqual([c.inventory, f.inventory.hoe, f.inventory.wheat_seed], [{ wood: 10 }, 1, 3]);
});

test('a bed is your respawn point, and sleeping by it restores energy three times as fast', () => {
  const w = world();
  const c = homed(w, 'Sleepy', 'carpenter', { wood: 10, fiber: 10 });
  const b = baseOf(w, c.id)!;
  w.kill(c, 'test');
  w.respawn(c);
  assert.deepEqual([c.x, c.y], b.flag);
  c.inventory = { wood: 10, fiber: 10 }; // dying dropped half the bag
  build(w, c.id, 'bed', b.flag[0] + 1, b.flag[1]);
  w.kill(c, 'test');
  w.respawn(c);
  assert.deepEqual([c.x, c.y], [b.flag[0] + 1, b.flag[1]]);
  c.energy = 10;
  w.sleep(c.id);
  w.step(0);
  const byBed = c.energy - 10;
  const o = homed(w, 'Camper', 'scout');
  [o.x, o.y] = [b.flag[0] + 30, b.flag[1]];
  o.energy = 10;
  w.sleep(o.id);
  w.step(0);
  assert.equal(Math.round(byBed * 100), Math.round((o.energy - 10) * 3 * 100));
});

test('a robot idle for 7 days loses its base; its buildings become ruins anyone may demolish', () => {
  const w = world();
  const c = homed(w, 'Sleeper', 'carpenter', { wood: 10 });
  const [fx, fy] = baseOf(w, c.id)!.flag;
  build(w, c.id, 'wood_wall', fx + 1, fy);
  const now = 10_000_000_000;
  c.lastActionAt = now - B.idleReleaseMs + 1000;
  releaseIdle(w, now);
  assert.ok(baseOf(w, c.id));
  c.lastActionAt = now - B.idleReleaseMs - 1;
  releaseIdle(w, now);
  assert.equal(baseOf(w, c.id), null);
  assert.equal(w.structures.get(w.index(fx + 1, fy))?.owner, '');
  const s = homed(w, 'Scavenger', 'scout');
  [s.x, s.y] = [fx, fy];
  assert.equal(code(() => demolish(w, s.id, fx + 1, fy)), 'ok');
});

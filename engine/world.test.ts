import { B } from '../shared/balance.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { GameFail, World } from './world.ts';

function worldOf(rows: string[]): World {
  const code: Record<string, number> = { '.': T.MEADOW, '~': T.DEEP, ',': T.SHALLOW };
  const n = rows.length, tiles = new Uint8Array(n * n);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { tiles[y * n + x] = code[ch]; }));
  return new World(tiles, n, () => 0.5);
}
const open = (n: number) => Array.from({ length: n }, () => '.'.repeat(n));

function joined(w: World, name = 'Grasslord', at: Vec = [2, 2]) {
  const a = w.register(name, 0);
  w.join(a.id, 'gatherer', 'test-model');
  [a.x, a.y] = at;
  return a;
}
const failCode = (fn: () => unknown) => {
  try { fn(); return 'ok'; } catch (e) { return (e as GameFail).code; }
};

test('register hands out ids and rejects duplicate names in any case', () => {
  const w = worldOf(open(10));
  assert.equal(w.register('Alpha', 0).id, 'agent_1');
  assert.equal(w.register('Beta', 0).id, 'agent_2');
  assert.equal(failCode(() => w.register('ALPHA', 0)), 'name_taken');
});

test('register refuses when 200 agents were active in the last day', () => {
  const w = worldOf(open(10));
  for (let i = 0; i < 200; i++) w.register(`bot${i}`, 0);
  assert.equal(failCode(() => w.register('late', 1000)), 'world_full');
  assert.equal(w.register('late', 25 * 3600 * 1000).id, 'agent_201');
});

test('world actions need join_game first', () => {
  const w = worldOf(open(10));
  const a = w.register('Shy', 0);
  assert.equal(failCode(() => w.observe(a.id)), 'not_joined');
  assert.equal(failCode(() => w.observe('agent_999')), 'unknown_agent');
});

test('rejoining keeps the role and leaves a note that observe hands over once', () => {
  const w = worldOf(open(10));
  const a = joined(w);
  w.join(a.id, 'hunter', null);
  assert.equal(a.role, 'gatherer');
  assert.deepEqual(w.observe(a.id).inbox, ['Welcome back. Your robot missed you. Probably.']);
  assert.deepEqual(w.observe(a.id).inbox, []);
});

test('observe shows a 17x17 grid with you in the middle and neighbours lettered', () => {
  const w = worldOf(open(40));
  const a = joined(w, 'Grasslord', [20, 20]);
  const b = joined(w, 'Bob', [22, 19]);
  const o = w.observe(a.id);
  const rows = o.grid.map((r) => r.split(' '));
  assert.equal(rows.length, 17);
  assert.ok(rows.every((r) => r.length === 17));
  assert.equal(rows[8][8], '@');
  assert.equal(rows[7][10], 'A');
  assert.equal(o.legend.A, `${b.id} Bob`);
  assert.deepEqual(o.nearby, [`${b.id} Bob (gatherer, test-model) 2 tiles NE`]);
  assert.deepEqual(o.roles, { gatherer: 2, hunter: 0, builder: 0, medic: 0, scout: 0 });
});

test('move_to rejects outside, deep water and unreachable targets', () => {
  const w = worldOf(['...~.', '...~.', '...~.', '...~.', '...~.']);
  const a = joined(w, 'Walker', [0, 0]);
  assert.equal(failCode(() => w.moveTo(a.id, 9, 0)), 'bad_target');
  assert.equal(failCode(() => w.moveTo(a.id, 3, 0)), 'blocked');
  assert.equal(failCode(() => w.moveTo(a.id, 4, 0)), 'no_path');
  assert.equal(failCode(() => w.moveTo(a.id, 2, 4)), 'ok');
});

test('agents walk 2 land tiles per tick, 1 in shallow water, then finish', () => {
  const w = worldOf(['.,,..', '~~~~~', '~~~~~', '~~~~~', '~~~~~']);
  const a = joined(w, 'Walker', [0, 0]);
  assert.deepEqual(w.moveTo(a.id, 4, 0), { steps: 4, eta_seconds: 3 });
  w.step();
  assert.deepEqual([a.x, a.y], [1, 0]);
  w.step();
  assert.deepEqual([a.x, a.y], [2, 0]);
  w.step();
  assert.deepEqual([a.x, a.y], [4, 0]);
  assert.equal(a.task, null);
  assert.match(w.observe(a.id).inbox.at(-1)!, /arrived at \(4, 0\)/);
});

test('joining is announced; tick deltas list joined agents only', () => {
  const w = worldOf(open(10));
  w.register('Lurker', 0);
  const a = joined(w);
  const d = w.step();
  assert.equal(d.tick, 1);
  assert.deepEqual(d.agents.map((v) => v.id), [a.id]);
  assert.equal(d.events[0].type, 'join');
  assert.match(d.events[0].text, /Grasslord/);
  assert.equal(w.step().events.length, 0);
});

test('new agents start healthy with an empty bag', () => {
  const w = worldOf(open(10));
  const a = w.register('Fresh', 0);
  assert.deepEqual([a.health, a.food, a.water, a.energy, a.inventory, a.autoEat], [100, 100, 100, 100, {}, true]);
});

test('observe shows stats, time, resources and drink spots', () => {
  const w = worldOf(Array.from({ length: 20 }, (_, y) => (y === 15 ? '~'.repeat(20) : '.'.repeat(20))));
  const a = joined(w, 'Looker', [10, 10]);
  w.nodes.set(w.index(12, 10), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  const o = w.observe(a.id);
  assert.equal(o.grid.map((r) => r.split(' '))[8][10], '*');
  assert.match(o.resources[0], /^berry_bush \(5 left\) at \(12, 10\), 2 tiles E$/);
  assert.ok(o.resources.some((r) => /^drink spot at \(\d+, 14\)/.test(r)), o.resources.join(' | '));
  assert.deepEqual([o.you.health, o.you.food, o.you.slots, o.time.phase], [100, 100, '0/20', 'day']);
});

test('vision halves at night', () => {
  const w = worldOf(open(30));
  const a = joined(w, 'Owl', [15, 15]);
  w.tick = 900;
  assert.equal(w.observe(a.id).grid.length, 9);
  assert.equal(w.observe(a.id).time.phase, 'night');
});

test('eat and drink need the right conditions', () => {
  const w = worldOf(['...~', '....', '....', '....']);
  const a = joined(w, 'Snacker', [0, 3]);
  assert.equal(failCode(() => w.eatItem(a.id, 'berries')), 'not_carrying');
  assert.equal(failCode(() => w.eatItem(a.id, 'wood')), 'not_food');
  assert.equal(failCode(() => w.drink(a.id)), 'no_water');
  a.inventory = { berries: 1 };
  a.food = 50;
  a.water = 50;
  w.eatItem(a.id, 'berries');
  assert.deepEqual([a.food, a.water, a.inventory], [58, 52, {}]);
  [a.x, a.y] = [2, 0];
  w.drink(a.id);
  assert.equal(a.water, 82);
});

test('settings toggles auto-eat', () => {
  const w = worldOf(open(5));
  const a = joined(w);
  assert.deepEqual(w.settings(a.id, false), { auto_eat: false });
  assert.deepEqual(w.settings(a.id, 'nope'), { auto_eat: false });
  assert.equal(a.autoEat, false);
});

test('joining, leaving and coming back are announced once each', () => {
  const w = worldOf(open(10));
  const a = w.register('Ghost', 0);
  w.join(a.id, 'scout', null, 1000);
  assert.deepEqual([a.online, a.lastSeenAt], [true, 1000]);
  assert.deepEqual(w.step(1000 + 1000).events.map((e) => e.type).filter((t) => t !== 'achievement'), ['join']);
  const away = w.step(1000 + B.awayAfterMs + 1);
  assert.deepEqual(away.events.map((e) => e.type), ['leave']);
  assert.match(away.events[0].text, /Ghost/);
  assert.equal(a.online, false);
  assert.deepEqual(w.step(1000 + 2 * B.awayAfterMs).events, []);
  w.seen(a.id, 1000 + 3 * B.awayAfterMs);
  const back = w.step(1000 + 3 * B.awayAfterMs);
  assert.deepEqual(back.events.map((e) => e.type), ['return']);
  assert.equal(a.online, true);
  assert.equal(back.agents[0].online, true);
});

test('a first join does not also announce a return', () => {
  const w = worldOf(open(10));
  const a = w.register('Newbie', 0);
  w.join(a.id, 'scout', null, 5000);
  w.seen(a.id, 5000);
  assert.deepEqual(w.step(5000).events.map((e) => e.type).filter((t) => t !== 'achievement'), ['join']);
});

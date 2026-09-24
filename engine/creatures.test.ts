import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { dist } from '../shared/geo.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { spawnCreature } from './creatures.ts';
import { World } from './world.ts';

// 256 map: the Plaza is at (128, 128), so (20, 20) is 108 tiles away. rng 0.5 keeps spawns off-map and wanderers still.
function world(rng = () => 0.5): World {
  return new World(new Uint8Array(256 * 256).fill(T.MEADOW), 256, rng);
}
function joined(w: World, name: string, at: Vec) {
  const a = w.register(name, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = at;
  return a;
}

test('rabbits run from robots; distant creatures stand still; very distant ones vanish', () => {
  const w = world();
  joined(w, 'Walker', [20, 20]);
  const rabbit = spawnCreature(w, 'rabbit', [22, 20]);
  const idle = spawnCreature(w, 'deer', [80, 20]);
  const gone = spawnCreature(w, 'boar', [200, 20]);
  const d = w.step(0);
  assert.deepEqual([rabbit.x, rabbit.y, rabbit.mode], [23, 20, 'flee']);
  assert.deepEqual([idle.x, idle.y], [80, 20]);
  assert.equal(w.creatures.has(gone.id), false);
  assert.ok(d.creatures.some((c) => c.id === rabbit.id && c.kind === 'rabbit' && c.maxHp === 5));
});

test('a wolf pack hunts a lone robot and bites every 2 ticks', () => {
  const w = world();
  const a = joined(w, 'Loner', [30, 30]);
  const pack = [spawnCreature(w, 'wolf', [35, 30], 7), spawnCreature(w, 'wolf', [35, 31], 7), spawnCreature(w, 'wolf', [35, 29], 7)];
  for (let i = 0; i < 6; i++) w.step(0);
  assert.ok(pack.every((wf) => wf.mode === 'chase' && wf.target === a.id));
  assert.ok(a.health < 100 && !a.dead, String(a.health));
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('wolf pack is hunting you')));
});

test('wolves leave robots who have company', () => {
  const w = world();
  joined(w, 'Ann', [30, 30]);
  joined(w, 'Bob', [33, 30]);
  const wolf = spawnCreature(w, 'wolf', [36, 30]);
  for (let i = 0; i < 5; i++) w.step(0);
  assert.equal(wolf.mode, 'wander');
});

test('a goblin steals one item, hits for 4 and runs', () => {
  const w = world();
  const a = joined(w, 'Pocket', [20, 20]);
  a.inventory = { berries: 3 };
  const g = spawnCreature(w, 'goblin', [21, 20]);
  const d = w.step(0);
  assert.deepEqual([a.inventory.berries, g.bag.berries, g.mode, a.health], [2, 1, 'flee', 96]);
  assert.ok(d.events.some((e) => e.type === 'steal' && e.text.includes('Pocket')));
});

test('a Roomba vacuums loot piles older than 2 minutes', () => {
  const w = world();
  joined(w, 'Messy', [20, 20]);
  w.dropLoot(w.index(40, 20), { wood: 3 });
  const r = spawnCreature(w, 'roomba', [45, 20]);
  w.tick = 200;
  for (let i = 0; i < 7; i++) w.step(0);
  assert.equal(w.loot.has(w.index(40, 20)), false);
  assert.deepEqual(r.bag, { wood: 3 });
});

test('monsters come at night, never near the Plaza, and run home at dawn; the Roomba stays', () => {
  const w = world(() => 0); // spawn chance always passes; spots land 16 tiles east
  joined(w, 'Night Owl', [20, 20]);
  w.tick = 900; // night
  w.step(0);
  const monsters = () => [...w.creatures.values()].filter((c) => c.kind === 'goblin' || c.kind === 'wolf');
  assert.ok(monsters().length > 0);
  assert.ok(monsters().every((c) => dist([c.x, c.y], w.plaza) > 40));
  const near = world(() => 0);
  joined(near, 'Plaza Fan', [140, 128]); // spawn spots fall within 40 of the Plaza
  near.tick = 900;
  near.step(0);
  assert.equal([...near.creatures.values()].filter((c) => c.kind === 'goblin' || c.kind === 'wolf').length, 0);
  w.tick = 1199;
  const dawn = w.step(0);
  assert.equal(monsters().length, 0);
  assert.ok([...w.creatures.values()].some((c) => c.kind === 'roomba'));
  assert.ok(dawn.events.some((e) => e.type === 'monsters'));
});

test('death by monster names the killer and is never "starved at the buffet"', () => {
  const w = world();
  const a = joined(w, 'Snack', [20, 20]);
  w.nodes.set(w.index(21, 20), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  assert.equal(w.hurt(a, 500, 'wolf', 'A wolf'), true);
  const e = w.step(0).events.find((x) => x.type === 'death')!;
  assert.ok(a.dead && !e.text.includes('berries three tiles') && !a.stats['death:starved_at_buffet']);
  assert.match(e.text, /Snack/);
});

test('a monster that spawns out of sight comes for you', () => {
  const w = world();
  const a = joined(w, 'Target', [30, 30]);
  const wolf = spawnCreature(w, 'wolf', [30 + 28, 30]); // the far edge of the spawn ring
  w.step(0);
  assert.deepEqual([wolf.mode, wolf.target], ['chase', a.id]);
});

test('wolves keep pace with a walking robot and bite the moment it stops', () => {
  const w = world();
  const a = joined(w, 'Walker', [30, 30]);
  w.moveTo(a.id, 40, 30);
  const wolf = spawnCreature(w, 'wolf', [26, 30]);
  Object.assign(wolf, { mode: 'chase', target: a.id, until: 1000 });
  for (let i = 0; i < 8; i++) w.step(0);
  assert.ok(a.health < 100, String(a.health));
});

test('a wolf pack gives a lone robot time to react (it survives 12 seconds)', () => {
  const w = world();
  const a = joined(w, 'Slowpoke', [30, 30]);
  for (const at of [[31, 30], [31, 31], [31, 29]] as Vec[]) Object.assign(spawnCreature(w, 'wolf', at, 9), { mode: 'chase', target: a.id, until: 1000 });
  for (let i = 0; i < 12; i++) w.step(0);
  assert.ok(!a.dead && a.health < 100, String(a.health));
});

test('rabbits sometimes dropkick a nearby robot, then run', () => {
  const w = world(() => 0.01); // under the 3% kick chance
  const a = joined(w, 'Victim', [20, 20]);
  const rabbit = spawnCreature(w, 'rabbit', [22, 20]);
  const d = w.step(0);
  assert.equal(a.health, 97);
  assert.equal(rabbit.mode, 'flee');
  assert.ok(d.events.some((e) => e.type === 'kick' && e.text.includes('Victim')));
});

test('animals spawn close enough to see; monsters stay out of sight', () => {
  const w = world(() => 0); // every spawn lands at the minimum distance, due east
  joined(w, 'Viewer', [20, 20]);
  w.tick = 900;
  w.step(0);
  const at = (kind: string) => [...w.creatures.values()].find((c) => c.kind === kind)!;
  assert.ok(dist([at('rabbit').x, at('rabbit').y], [20, 20]) <= 9);
  assert.ok(dist([at('goblin').x, at('goblin').y], [20, 20]) >= 16);
});

test('the Confused Duck waddles right next to its robot', () => {
  const w = world();
  joined(w, 'Mom', [20, 20]);
  const duck = spawnCreature(w, 'duck', [25, 20]);
  for (let i = 0; i < 6; i++) w.step(0);
  assert.equal(duck.mode, 'follow');
  assert.ok(dist([duck.x, duck.y], [20, 20]) <= 1, `${duck.x},${duck.y}`);
});

test('the duck gets bored: after a minute of following it wanders off for two', () => {
  const w = world();
  joined(w, 'Mom', [20, 20]);
  const duck = spawnCreature(w, 'duck', [22, 20]);
  w.step(0);
  assert.equal(duck.mode, 'follow');
  for (let i = 0; i < 60; i++) w.step(0);
  assert.equal(duck.mode, 'wander');
  for (let i = 0; i < 100; i++) w.step(0);
  assert.equal(duck.mode, 'wander');
  for (let i = 0; i < 30; i++) w.step(0);
  assert.equal(duck.mode, 'follow');
});

test('every untamed animal kicks robots that come close: deer 5, boar 6, duck 1', () => {
  for (const [kind, damage] of [['deer', 5], ['boar', 6], ['duck', 1]] as const) {
    const w = world(() => 0.01);
    const a = joined(w, 'Walker', [20, 20]);
    const c = spawnCreature(w, kind, [22, 20]);
    w.step(0);
    assert.equal(a.health, 100 - damage, kind);
    assert.equal(c.mode, 'flee', kind);
  }
});

test('kicks are news at most every 30 s, never interrupt work, and a duck spares the robot it follows', () => {
  const w = world(() => 0.01);
  const a = joined(w, 'Ann', [20, 20]);
  const b = joined(w, 'Bob', [40, 40]);
  Object.assign(a, { energy: 50, task: { type: 'rest' } });
  spawnCreature(w, 'rabbit', [22, 20]);
  spawnCreature(w, 'rabbit', [42, 40]);
  const d = w.step(0);
  assert.equal(d.events.filter((e) => e.type === 'kick').length, 1);
  assert.deepEqual([a.health, b.health], [97, 97]);
  assert.deepEqual(a.task, { type: 'rest' });
  assert.ok(w.observe(b.id).inbox.some((l) => l.includes('kicked you')));

  const w2 = world(() => 0.01);
  const mom = joined(w2, 'Mom', [20, 20]);
  const duck = spawnCreature(w2, 'duck', [21, 20]);
  Object.assign(duck, { mode: 'follow', target: mom.id, until: 1000 });
  for (let i = 0; i < 5; i++) w2.step(0);
  assert.equal(mom.health, 100);
});

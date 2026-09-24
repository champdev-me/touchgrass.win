import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Role, type Vec } from '../shared/types.ts';
import { TIER_POINTS } from './achievements.ts';
import { heal, startAttack, weaponOf } from './combat.ts';
import { craft } from './craft.ts';
import { spawnCreature } from './creatures.ts';
import { GameFail, World } from './world.ts';

function world(tiles = new Uint8Array(64 * 64).fill(T.MEADOW)): World {
  return new World(tiles, 64, () => 0.5);
}
function joined(w: World, name: string, at: Vec, role: Role = 'gatherer') {
  const a = w.register(name, 0);
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

test('a hit every 2 ticks; hunters hit 1.5x; a kill scores 5, drops half the bag and names the killer', () => {
  const w = world();
  const a = joined(w, 'Bruiser', [10, 10], 'hunter');
  const b = joined(w, 'Victim', [11, 10]);
  Object.assign(b, { food: 50, water: 50, inventory: { wood: 4 } });
  startAttack(w, a.id, b.id);
  w.step(0);
  assert.equal(b.health, 100);
  w.step(0);
  assert.equal(b.health, 92.5);
  b.health = 5;
  w.step(0);
  const d = w.step(0);
  assert.ok(b.dead);
  assert.equal(a.seasonScore, 5 + 2 * TIER_POINTS.common); // kill + First Blood (server first)
  assert.deepEqual(w.loot.get(w.index(11, 10))?.items, { wood: 2 });
  assert.match(d.events.find((e) => e.type === 'death')?.text ?? '', /Bruiser/);
  assert.equal(a.task, null);
});

test('killing the same robot again within 10 minutes scores nothing', () => {
  const w = world();
  const a = joined(w, 'Farmer', [10, 10]);
  const b = joined(w, 'Friend', [11, 10]);
  Object.assign(b, { health: 5, food: 50, water: 50 });
  a.recentKills[b.id] = 0;
  startAttack(w, a.id, b.id);
  w.step(0);
  w.step(0);
  assert.ok(b.dead);
  assert.equal(a.seasonScore, 2 * TIER_POINTS.common);
  assert.ok(w.observe(a.id).inbox.includes('No score: you already beat Friend recently.'));
});

test('no fighting robots in the Plaza, from either side', () => {
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) tiles[y * 64 + x] = T.PLAZA;
  const w = world(tiles);
  const inside = joined(w, 'Inside', [20, 20]);
  const edge = joined(w, 'Edge', [24, 20]);
  const out = joined(w, 'Outside', [25, 20]);
  assert.equal(failCode(() => startAttack(w, inside.id, edge.id)), 'plaza_peace');
  assert.equal(failCode(() => startAttack(w, out.id, edge.id)), 'plaza_peace');
});

test('the attack ends cleanly when the target walks out of sight or dies', () => {
  const w = world();
  const a = joined(w, 'Chaser', [10, 10]);
  const b = joined(w, 'Runner', [11, 10]);
  startAttack(w, a.id, b.id);
  b.x = 60;
  w.step(0);
  assert.equal(a.task, null);
  assert.ok(w.observe(a.id).inbox.includes('Task done: your target is gone.'));
  const wolf = spawnCreature(w, 'wolf', [12, 10]);
  a.x = 11;
  startAttack(w, a.id, 'wolf');
  w.creatures.delete(wolf.id);
  w.step(0);
  assert.equal(a.task, null);
});

test('punching a rock: the rock is unimpressed and you are a clown', () => {
  const w = world();
  const a = joined(w, 'Rocky', [10, 10]);
  w.nodes.set(w.index(11, 10), { kind: 'rock', left: 3, regrowAt: 0 });
  startAttack(w, a.id, 'rock');
  for (let i = 0; i < 3; i++) w.step(0);
  assert.equal(a.stats['attack:rock'], 1);
  assert.ok(a.achievements.rock_fighter !== undefined);
  assert.equal(a.badge?.emoji, '🤡');
});

test('boars fight back; rabbits flee but can be caught; kills fill the bag and score', () => {
  const w = world();
  const a = joined(w, 'Hunter', [10, 10]);
  const boar = spawnCreature(w, 'boar', [11, 10]);
  startAttack(w, a.id, boar.id);
  w.step(0);
  w.step(0);
  assert.deepEqual([boar.hp, boar.mode, a.health], [20, 'chase', 92]);

  const w2 = world();
  const h = joined(w2, 'Chef', [10, 10]);
  const rabbit = spawnCreature(w2, 'rabbit', [11, 10]);
  startAttack(w2, h.id, 'rabbit');
  for (let i = 0; i < 3; i++) w2.step(0);
  assert.equal(w2.creatures.has(rabbit.id), false);
  assert.equal(h.inventory.meat, 1);
  assert.equal(h.seasonScore, 1);
});

test('killing a goblin or a Roomba returns what they took', () => {
  const w = world();
  const a = joined(w, 'Cop', [10, 10]);
  const g = spawnCreature(w, 'goblin', [11, 10]);
  Object.assign(g, { hp: 3, bag: { berries: 2 } });
  startAttack(w, a.id, g.id);
  let events: string[] = [];
  for (let i = 0; i < 3; i++) events = events.concat(w.step(0).events.map((e) => e.text));
  assert.deepEqual([a.inventory.berries, a.inventory.fiber], [2, 1]);
  assert.ok(events.some((t) => t.includes('Cop') && t.includes('Grass Goblin')));
  const r = spawnCreature(w, 'roomba', [a.x + 1, a.y]);
  Object.assign(r, { hp: 1, bag: { wood: 3 } });
  startAttack(w, a.id, r.id);
  for (let i = 0; i < 3; i++) w.step(0);
  assert.deepEqual([a.inventory.wood, a.inventory.battery], [3, 1]);
});

test('medics heal others nearby; Field Medic counts different robots under half health', () => {
  const w = world();
  const m = joined(w, 'Doc', [10, 10], 'medic');
  const p = joined(w, 'Patient', [11, 10]);
  const far = joined(w, 'Far', [20, 10]);
  const g = joined(w, 'Nurse', [9, 10]);
  p.health = 40;
  assert.deepEqual(heal(w, m.id, p.id), { healed: 'Patient', health: 60 });
  heal(w, m.id, p.id);
  assert.deepEqual([p.health, m.healed], [80, [p.id]]);
  assert.equal(failCode(() => heal(w, g.id, p.id)), 'not_medic');
  assert.equal(failCode(() => heal(w, m.id, m.id)), 'self_heal');
  assert.equal(failCode(() => heal(w, m.id, far.id)), 'too_far');
});

test('craft a club from 5 wood and fight with it', () => {
  const w = world();
  const a = joined(w, 'Smith', [10, 10]);
  assert.equal(failCode(() => craft(w, a.id, 'club')), 'missing_materials');
  a.inventory = { wood: 7 };
  craft(w, a.id, 'club');
  assert.deepEqual(a.inventory, { wood: 2, club: 1 });
  assert.deepEqual(weaponOf(a), { name: 'club', damage: 10 });
  assert.equal(failCode(() => craft(w, a.id, 'laser')), 'unknown_recipe');
});

test('combat means 2 s cooldowns; observe shows creatures and your weapon', () => {
  const w = world();
  const a = joined(w, 'Tense', [10, 10]);
  assert.equal(w.cooldownFor(a.id), 5000);
  spawnCreature(w, 'wolf', [12, 10]);
  assert.equal(w.cooldownFor(a.id), 2000);
  const o = w.observe(a.id);
  assert.ok(o.nearby.some((l) => l.startsWith('mob_') && l.includes('🐺 wolf (hp 30/30')));
  assert.ok(o.grid.some((row) => row.includes('&')));
  assert.equal(o.you.weapon, 'fists (5 damage)');
  assert.equal(o.you.in_combat, true);
});

test('running into the Plaza ends the fight', () => {
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) tiles[y * 64 + x] = T.PLAZA;
  const w = world(tiles);
  const a = joined(w, 'Bully', [26, 20]);
  const b = joined(w, 'Runner', [27, 20]);
  startAttack(w, a.id, b.id);
  b.x = 24; // steps onto the Plaza
  for (let i = 0; i < 3; i++) w.step(0);
  assert.equal(b.health, 100);
  assert.equal(a.task, null);
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('Plaza')));
});

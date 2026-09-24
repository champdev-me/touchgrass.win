import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { ACHIEVEMENTS, checkAchievements, listAchievements } from './achievements.ts';
import { rules } from './rules.ts';
import { World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
}
function joined(w: World, name: string, at: Vec = [5, 5]) {
  const a = w.register(name, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = at;
  return a;
}

test('the first unlock is a server first worth double; the second is normal', () => {
  const w = world();
  const a = joined(w, 'First');
  const b = joined(w, 'Second');
  a.stats.actions = 1;
  checkAchievements(w, a);
  b.stats.actions = 1;
  checkAchievements(w, b);
  assert.deepEqual([a.seasonScore, b.seasonScore, w.firsts.hello_world], [20, 10, a.id]);
  const texts = w.step(0).events.filter((e) => e.type === 'achievement').map((e) => e.text);
  assert.deepEqual(texts, ['🏆 First unlocked 🤖 Hello World (+20). ⭐ Server first!', '🏆 Second unlocked 🤖 Hello World (+10).']);
  assert.equal(w.urgent, true);
  checkAchievements(w, a);
  assert.equal(a.seasonScore, 20);
});

test('cursed achievements pay nothing and hang a clown badge for an hour', () => {
  const w = world();
  const a = joined(w, 'Clown');
  a.stats['death:speedrun'] = 1;
  checkAchievements(w, a);
  assert.equal(a.seasonScore, 0);
  assert.deepEqual(a.badge, { emoji: '🤡', until: w.tick + B.cursedBadgeTicks });
  assert.match(w.step(0).events.find((e) => e.type === 'achievement')!.text, /^🤡 Clown earned the cursed achievement 🥀 Speedrun Any%/);
  assert.equal(w.views()[0].badge, '🤡');
});

test('stat-driven achievements unlock from play', () => {
  const w = world();
  const a = joined(w, 'Player');
  w.nodes.set(w.index(5, 5), { kind: 'grass', left: 3, regrowAt: 0 });
  w.gather(a.id, 'grass', 1);
  for (let i = 0; i < 3; i++) w.step(0);
  assert.ok(a.achievements.touched_grass !== undefined);
});

test('listing shows progress, points and open server firsts', () => {
  const w = world();
  const a = joined(w, 'Lister');
  a.stats['eat:berries'] = 12;
  const list = listAchievements(w, a);
  assert.equal(list.length, ACHIEVEMENTS.length);
  const berry = list.find((x) => x.id === 'berry_addict')!;
  assert.deepEqual([berry.progress, berry.unlocked, berry.points, berry.server_first], ['12/50', false, 10, 'still open (double points)']);
  assert.equal(list.find((x) => x.id === 'cartographer')!.progress, '0/2');
});

test('rules and observe expose the new systems', () => {
  const w = world();
  const a = joined(w, 'Reader');
  const r = rules(w);
  assert.ok(r.achievements.length === ACHIEVEMENTS.length && r.scoring.length > 0 && r.chat.length > 0);
  w.log('Someone: hi');
  const o = w.observe(a.id);
  assert.deepEqual([o.you.score, o.you.gold], [{ life: 0, season: 0, best_life: 0 }, 10]);
  assert.equal(o.you.achievements, `0/${ACHIEVEMENTS.length} unlocked`);
  assert.equal(o.world_chat.length, 2);
  assert.ok(o.world_chat[0].includes('Reader'));
  assert.equal(o.world_chat.at(-1), 'Someone: hi');
});

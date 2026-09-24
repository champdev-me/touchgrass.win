import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { World } from './world.ts';

function setup() {
  const tiles = new Uint8Array(100).fill(T.MEADOW);
  tiles[5] = T.DEEP;
  const w = new World(tiles, 10, () => 0.5);
  return { w, id: w.register('Actor', 0).id };
}

test('join_game then observe: do tools cost 5s, look tools cost nothing', () => {
  const { w, id } = setup();
  const j = handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout', model: 'claude-test' } });
  assert.deepEqual([j.ok, j.cooldownMs], [true, 5000]);
  const o = handleAction(w, { agentId: id, tool: 'observe', args: {} });
  assert.deepEqual([o.ok, o.cooldownMs], [true, 0]);
  const m = handleAction(w, { agentId: id, tool: 'move_to', args: { x: 0, y: 5 } });
  assert.deepEqual([m.ok, m.cooldownMs], [true, 5000]);
});

test('failures explain themselves and cost no cooldown', () => {
  const { w, id } = setup();
  const bad = handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'wizard' } });
  assert.deepEqual([bad.ok, bad.cooldownMs], [false, 0]);
  assert.equal(!bad.ok && bad.error.error, 'bad_role');
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'mason' } });
  const blocked = handleAction(w, { agentId: id, tool: 'move_to', args: { x: 5, y: 0 } });
  assert.equal(!blocked.ok && blocked.error.error, 'blocked');
  const unknown = handleAction(w, { agentId: id, tool: 'fly', args: {} });
  assert.equal(!unknown.ok && unknown.error.error, 'unknown_tool');
});

test('survival tools are wired and a low stat shortens the cooldown to 3 s', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'gatherer' } });
  const a = w.agents.get(id)!;
  a.inventory = { berries: 2 };
  a.water = 10;
  const ate = handleAction(w, { agentId: id, tool: 'eat', args: { item: 'berries' } });
  assert.deepEqual([ate.ok, ate.cooldownMs], [true, 3000]);
  const dry = handleAction(w, { agentId: id, tool: 'drink', args: {} });
  assert.deepEqual([dry.ok, dry.cooldownMs, !dry.ok && dry.error.error], [false, 0, 'no_water']);
  a.x = 4;
  const drank = handleAction(w, { agentId: id, tool: 'drink', args: {} });
  assert.deepEqual([drank.ok, drank.cooldownMs], [true, 5000]);
  const set = handleAction(w, { agentId: id, tool: 'settings', args: { auto_eat: false } });
  assert.deepEqual([set.ok && set.data, set.cooldownMs], [{ auto_eat: false, auto_flee: true }, 0]);
  assert.equal(handleAction(w, { agentId: id, tool: 'rest', args: {} }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'sleep', args: {} }).ok, true);
  const none = handleAction(w, { agentId: id, tool: 'gather', args: { target: 'rock' } });
  assert.equal(!none.ok && none.error.error, 'none_nearby');
});

test('the dead can only look', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } });
  const a = w.agents.get(id)!;
  a.dead = true;
  a.respawnAt = w.tick + 10;
  const move = handleAction(w, { agentId: id, tool: 'move_to', args: { x: 1, y: 1 } });
  assert.deepEqual([move.ok, move.cooldownMs, !move.ok && move.error.error], [false, 0, 'dead']);
  const look = handleAction(w, { agentId: id, tool: 'observe', args: {} });
  assert.equal(look.ok, true);
});

test('social and info tools are wired; thoughts become bubbles; actions are counted', () => {
  const { w, id } = setup();
  const j = handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout', thought: 'here we go' } });
  assert.equal(j.ok, true);
  const a = w.agents.get(id)!;
  assert.deepEqual([a.stats.actions, a.bubble?.text, a.achievements.hello_world !== undefined], [1, 'here we go', true]);
  const say = handleAction(w, { agentId: id, tool: 'say_world', args: { text: 'hello grass' } });
  assert.deepEqual([say.ok, say.cooldownMs], [true, 5000]);
  for (const tool of ['map', 'rules', 'achievements', 'leaderboard']) {
    const r = handleAction(w, { agentId: id, tool, args: {} });
    assert.deepEqual([r.ok, r.cooldownMs], [true, 0], tool);
  }
  assert.equal(handleAction(w, { agentId: id, tool: 'emote', args: { name: 'wave' } }).ok, true);
  const n = handleAction(w, { agentId: id, tool: 'notes', args: { write: 'remember the lake' } });
  assert.deepEqual(n.ok && n.data, { notes: 'remember the lake', max_length: 2048 });
  assert.equal(handleAction(w, { agentId: id, tool: 'say', args: { text: 'anyone?' } }).ok, true);
});

test('speaking keeps the speech bubble even when a thought is attached', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } });
  handleAction(w, { agentId: id, tool: 'say_world', args: { text: 'hello grass', thought: 'be nice' } });
  assert.deepEqual(w.views()[0].bubble, { kind: 'world', text: 'hello grass' });
});

test('attack and craft are wired as action tools; heal is gone', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'mason' } });
  const a = w.agents.get(id)!;
  a.inventory = { wood: 5 };
  const c = handleAction(w, { agentId: id, tool: 'craft', args: { item: 'club' } });
  assert.deepEqual([c.ok, a.inventory.club], [true, 1]);
  const other = w.register('Other', 0);
  w.join(other.id, 'scout', null, 0);
  [other.x, other.y] = [a.x + 1, a.y];
  const h = handleAction(w, { agentId: id, tool: 'heal', args: { agent: other.id } });
  assert.equal(!h.ok && h.error.error, 'unknown_tool');
  const at = handleAction(w, { agentId: id, tool: 'attack', args: { target: other.id } });
  assert.deepEqual([at.ok, at.cooldownMs], [true, 2000]);
});

test('build and fuel_campfire are wired, the Smith is gone; eating salad is cursed; a waterskin carries drinks', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'miner' } });
  const a = w.agents.get(id)!;
  a.inventory = { wood: 10, stone: 3, fiber: 5, waterskin: 1 };
  a.wear.waterskin = 5;
  assert.equal(handleAction(w, { agentId: id, tool: 'build', args: { structure: 'campfire' } }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'fuel_campfire', args: {} }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'craft', args: { item: 'grass_salad' } }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'eat', args: { item: 'grass_salad' } }).ok, true);
  assert.ok(a.achievements.literally_touched_grass !== undefined);
  const s = handleAction(w, { agentId: id, tool: 'smith', args: { action: 'prices' } });
  assert.equal(!s.ok && s.error.error, 'unknown_tool');
  a.water = 50;
  [a.x, a.y] = [9, 9]; // far from water on this map
  assert.equal(handleAction(w, { agentId: id, tool: 'drink', args: {} }).ok, true);
  assert.deepEqual([a.water, a.wear.waterskin], [80, 4]);
});

test('every action shows a bubble: the thought, a label when there is none, and failures too', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } });
  const bubble = () => w.views()[0].bubble?.text;
  handleAction(w, { agentId: id, tool: 'move_to', args: { x: 0, y: 3, thought: 'stretching my legs' } });
  assert.equal(bubble(), 'stretching my legs');
  handleAction(w, { agentId: id, tool: 'move_to', args: { x: 0, y: 4 } });
  assert.equal(bubble(), 'move_to 0, 4');
  handleAction(w, { agentId: id, tool: 'move_to', args: { x: 5, y: 0 } });
  assert.match(bubble() ?? '', /^✖ /);
});

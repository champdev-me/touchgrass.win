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
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'medic' } });
  const blocked = handleAction(w, { agentId: id, tool: 'move_to', args: { x: 5, y: 0 } });
  assert.equal(!blocked.ok && blocked.error.error, 'blocked');
  const unknown = handleAction(w, { agentId: id, tool: 'fly', args: {} });
  assert.equal(!unknown.ok && unknown.error.error, 'unknown_tool');
});

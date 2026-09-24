import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { adminAction } from './admin.ts';
import { World } from './world.ts';

function setup() {
  const w = new World(new Uint8Array(100).fill(T.MEADOW), 10, () => 0.5);
  const id = w.register('Troll', 0).id;
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } });
  return { w, id };
}

test('mute blocks chat for the given minutes', () => {
  const { w, id } = setup();
  adminAction(w, 'mute', id, 10, 0);
  assert.equal(w.agents.get(id)!.mutedUntil, 10 * 60_000);
  assert.equal(w.urgent, true);
  adminAction(w, 'unmute', id, 0, 0);
  assert.equal(w.agents.get(id)!.mutedUntil, 0);
});

test('kick removes the robot until it joins again', () => {
  const { w, id } = setup();
  adminAction(w, 'kick', id, 0);
  assert.equal(w.views().length, 0);
  assert.match(w.step(0).events.find((e) => e.type === 'kick')!.text, /Troll/);
  assert.equal(handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } }).ok, true);
  assert.equal(w.views().length, 1);
});

test('ban removes the robot for good and every tool refuses', () => {
  const { w, id } = setup();
  adminAction(w, 'ban', id, 0);
  for (const tool of ['join_game', 'observe', 'say_world']) {
    const r = handleAction(w, { agentId: id, tool, args: { role: 'scout', text: 'hi' } });
    assert.equal(!r.ok && r.error.error, 'banned', tool);
  }
  assert.throws(() => adminAction(w, 'yeet', id, 0));
});

import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { Agent } from '../shared/types.ts';
import { normalizeAgent } from './agent.ts';
import { tickBody } from './body.ts';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const bot = (over: Partial<Agent> = {}) => normalizeAgent({ id: 'agent_1', name: 'Bot', ...over });

test('old records get full stats, an empty bag, auto-eat on, and zeroed social fields', () => {
  const a = normalizeAgent({ id: 'agent_1', name: 'Old', x: 5, y: 6 });
  assert.deepEqual([a.health, a.food, a.water, a.energy, a.inventory, a.autoEat, a.dead, a.x], [100, 100, 100, 100, {}, true, false, 5]);
  assert.deepEqual([a.lifeScore, a.seasonScore, a.bestLife, a.wallet, a.achievements, a.explored, a.notes, a.banned, a.bubble], [0, 0, 0, 0, {}, [], '', false, null]);
  const b = normalizeAgent({ id: 'agent_2', name: 'Other' });
  b.explored.push(1);
  assert.deepEqual(normalizeAgent({ id: 'agent_3', name: 'Third' }).explored, []);
});

test('food drops 1 per 30 s and water 1 per 20 s', () => {
  const a = bot();
  for (let i = 0; i < 60; i++) tickBody(a, 'idle');
  assert.ok(near(a.food, 98) && near(a.water, 97), `${a.food} ${a.water}`);
});

test('empty stats hurt and full stats heal', () => {
  const a = bot({ food: 0, water: 0, health: 50 });
  tickBody(a, 'idle');
  assert.ok(near(a.health, 49.6), `${a.health}`);
  const b = bot({ health: 50 });
  tickBody(b, 'idle');
  assert.ok(near(b.health, 50.1), `${b.health}`);
});

test('energy drains while busy and refills while resting or sleeping', () => {
  const a = bot({ energy: 50 });
  tickBody(a, 'busy');
  assert.ok(near(a.energy, 49.9));
  tickBody(a, 'rest');
  assert.ok(near(a.energy, 50.9));
  tickBody(a, 'sleep');
  assert.ok(near(a.energy, 52.9));
});

test('auto-eat eats the cheapest food when starving, unless turned off', () => {
  const a = bot({ food: 15, inventory: { apple: 1, berries: 2 } });
  const news = tickBody(a, 'idle');
  assert.equal(news.ate, 'berries');
  assert.deepEqual(a.inventory, { apple: 1, berries: 1 });
  assert.deepEqual(news.alerts, []);
  const b = bot({ food: 15, autoEat: false, inventory: { berries: 2 } });
  const quiet = tickBody(b, 'idle');
  assert.equal(quiet.ate, null);
  assert.deepEqual(quiet.alerts, ['You are starving. Eat something.']);
});

test('warnings fire once, when a line is crossed', () => {
  const a = bot({ water: 15, autoEat: false });
  assert.deepEqual(tickBody(a, 'idle').alerts, ['You are very thirsty. Drink next to water.']);
  assert.deepEqual(tickBody(a, 'idle').alerts, []);
});

test('health reaching zero reports the cause', () => {
  assert.equal(tickBody(bot({ food: 0, water: 60, health: 0.1 }), 'idle').death, 'starvation');
  assert.equal(tickBody(bot({ food: 60, water: 0, health: 0.1 }), 'idle').death, 'thirst');
  assert.equal(tickBody(bot({ food: 0, water: 0, health: 0.3 }), 'idle').death, 'hunger and thirst');
  assert.equal(tickBody(bot(), 'idle').death, null);
});

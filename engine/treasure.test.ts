import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Role, type Vec } from '../shared/types.ts';
import { packChunk } from './nodes.ts';
import { accept, offer } from './trade.ts';
import { chart } from './treasure.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  let seed = 7;
  const w = new World(new Uint8Array(256 * 256).fill(T.MEADOW), 256, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  w.treasureTarget = 1;
  return w;
}
function joined(w: World, role: Role, at: Vec) {
  const a = w.register(`${role}${at.join('')}`, 0);
  w.join(a.id, role, null, 0);
  [a.x, a.y] = at;
  return a;
}
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('treasure is invisible to non-scouts and absent from ticks and chunks', () => {
  const w = world();
  const s = joined(w, 'scout', [10, 10]);
  const m = joined(w, 'miner', [10, 11]);
  w.treasures.set(w.index(14, 10), { loot: 1 });
  assert.ok(w.observe(s.id).resources.some((l) => l.startsWith('buried treasure at (14, 10)')));
  assert.ok(!JSON.stringify(w.observe(m.id)).includes('treasure'));
  assert.ok(!JSON.stringify(w.step(0)).includes('treasure'));
  assert.ok(!JSON.stringify(packChunk(w.nodes, 0, 0, w.size)).includes('treasure'));
});

test('a scout charts a map, sells it, and only a miner with that map digs it up', () => {
  const w = world();
  const s = joined(w, 'scout', [14, 10]);
  const m = joined(w, 'miner', [13, 10]);
  w.treasures.set(w.index(14, 10), { loot: 1 });
  s.inventory.fiber = 2;
  chart(w, s.id, 14, 10);
  assert.equal(s.inventory['treasure_map:14,10'], 1);
  assert.equal(code(() => w.gather(s.id, 'treasure')), 'wrong_role');
  assert.equal(code(() => w.gather(m.id, 'treasure')), 'no_map');
  const o = offer(w, s.id, m.id, { 'treasure_map:14,10': 1 }, { gold: 5 });
  accept(w, m.id, o.offer);
  assert.equal(s.stats['sold:map'], 1);
  assert.ok(w.observe(m.id).you.maps.includes('treasure_map -> (14, 10)'));
  w.gather(m.id, 'treasure');
  for (let i = 0; i < 20; i++) w.step(0);
  assert.ok(m.wallet >= B.startGold - 5 + 30, `${m.wallet}`);
  assert.equal(m.inventory['treasure_map:14,10'], undefined);
  assert.equal(w.treasures.has(w.index(14, 10)), false);
  assert.equal(w.treasures.size, 1); // a new one was buried elsewhere
  assert.equal(m.stats['dig:treasure'], 1);
});

test('a map for a treasure someone already dug is stale; charting needs a treasure and fiber', () => {
  const w = world();
  const m = joined(w, 'miner', [13, 10]);
  m.inventory['treasure_map:14,10'] = 1;
  assert.equal(code(() => w.gather(m.id, 'treasure')), 'stale_map');
  assert.equal(m.inventory['treasure_map:14,10'], 1);
  const s = joined(w, 'scout', [40, 40]);
  s.inventory = {};
  assert.equal(code(() => chart(w, s.id, 40, 41)), 'no_treasure');
  w.treasures.set(w.index(40, 41), { loot: 1 });
  assert.equal(code(() => chart(w, s.id, 40, 41)), 'missing_materials');
  assert.equal(code(() => chart(w, m.id, 40, 41)), 'wrong_role');
});

test('treasure is buried on land far from the Plaza', () => {
  const w = world();
  w.treasureTarget = 6;
  for (let i = 0; i < 61; i++) w.step(0);
  assert.equal(w.treasures.size, 6);
  for (const i of w.treasures.keys()) {
    const [x, y] = w.xy(i);
    assert.ok(Math.max(Math.abs(x - w.plaza[0]), Math.abs(y - w.plaza[1])) >= B.treasureMinFromPlaza);
  }
});

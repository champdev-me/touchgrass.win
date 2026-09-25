import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { K, flush, loadArcade } from '../engine/persist.ts';
import { connectRedis } from '../shared/redis.ts';
import { redisUrl } from './helpers.ts';

test('a survival save becomes arcade players once: ids, names and models kept, so tokens still work', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  await r.hSet(K.oldAgents, { agent_3: JSON.stringify({ id: 'agent_3', name: 'Old Timer', model: 'gemma4', inventory: { wood: 5 } }), agent_7: JSON.stringify({ id: 'agent_7', name: 'Banned One', banned: true }) });
  await r.hSet(K.oldMeta, { nextId: '9', tick: '12345' });
  await r.hSet('terrain', '0,0', 'ignored');
  const a = await loadArcade(r);
  assert.deepEqual([a.players.get('agent_3')?.name, a.players.get('agent_3')?.model, a.players.get('agent_7')?.banned, a.nextId], ['Old Timer', 'gemma4', true, 9]);
  await flush(r, a);
  a.players.get('agent_3')!.points = 16;
  a.dirty.add('agent_3');
  await flush(r, a);
  const b = await loadArcade(r);
  assert.deepEqual([b.players.get('agent_3')?.points, b.players.size], [16, 2]);
  assert.equal(b.register('Newcomer').id, 'agent_9');
  await r.close();
});

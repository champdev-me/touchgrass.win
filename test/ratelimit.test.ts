import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { claimSlot, startCooldown } from '../gateway/ratelimit.ts';
import { connectRedis } from '../shared/redis.ts';
import { redisUrl, sleep } from './helpers.ts';

test('claimSlot lets exactly one of two racing callers in', async () => {
  const r = await connectRedis(redisUrl(12));
  await r.flushDb();
  const waits = await Promise.all([claimSlot(r, 'cd:x', 1000), claimSlot(r, 'cd:x', 1000)]);
  assert.equal(waits.filter((w) => w === 0).length, 1);
  const wait = Math.max(...waits);
  assert.ok(wait > 0 && wait <= 1000, `wait ${wait}`);
  await startCooldown(r, 'cd:x', 50);
  await sleep(80);
  assert.equal(await claimSlot(r, 'cd:x', 1000), 0);
  await r.close();
});

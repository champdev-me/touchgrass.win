import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { Redis } from '../shared/redis.ts';
import { agentForToken, hashToken, newToken } from './auth.ts';

test('tokens are tg_ plus 32 url-safe chars and hash stably', () => {
  const t = newToken();
  assert.match(t, /^tg_[A-Za-z0-9_-]{32}$/);
  assert.equal(hashToken(t), hashToken(t));
  assert.notEqual(hashToken(t), hashToken(newToken()));
});

test('agentForToken only looks up well-formed bearer headers', async () => {
  const seen: string[] = [];
  const fake = { get: async (k: string) => { seen.push(k); return 'agent_7'; } } as unknown as Redis;
  const t = newToken();
  assert.equal(await agentForToken(fake, `Bearer ${t}`), 'agent_7');
  assert.equal(await agentForToken(fake, 'Bearer nope'), null);
  assert.equal(await agentForToken(fake, undefined), null);
  assert.deepEqual(seen, [`token:${hashToken(t)}`]);
});

import type { Redis } from '../shared/redis.ts';

/** Atomically takes the slot for `ms`; returns 0 on success, otherwise the ms still to wait. */
export async function claimSlot(r: Redis, key: string, ms: number): Promise<number> {
  const ok = await r.sendCommand(['SET', key, '1', 'NX', 'PX', String(ms)]);
  if (String(ok) === 'OK') return 0;
  const left = await r.pTTL(key);
  return left > 0 ? left : 1;
}

export async function startCooldown(r: Redis, key: string, ms: number): Promise<void> {
  if (ms > 0) await r.sendCommand(['SET', key, '1', 'PX', String(ms)]);
}

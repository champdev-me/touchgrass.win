import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from '../shared/redis.ts';

export const newToken = (): string => `tg_${randomBytes(24).toString('base64url')}`;
export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

export async function agentForToken(r: Redis, header: string | undefined): Promise<string | null> {
  const m = /^Bearer (tg_[A-Za-z0-9_-]{32})$/.exec(header ?? '');
  return m ? r.get(`token:${hashToken(m[1])}`) : null;
}

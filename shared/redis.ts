import { createClient } from 'redis';

const makeClient = (url: string) => createClient({ url });
export type Redis = ReturnType<typeof makeClient>;

export async function connectRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Promise<Redis> {
  const r = makeClient(url);
  r.on('error', (e) => console.error('[redis]', e.message));
  await r.connect();
  return r;
}

import { createClient } from 'redis';

const makeClient = (url: string) => createClient({ url });
export type Redis = ReturnType<typeof makeClient>;

export async function connectRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Promise<Redis> {
  const r = makeClient(url);
  r.on('error', (e) => console.error('[redis]', e.message));
  await r.connect();
  return r;
}

export const CHAT_STREAM = 'chat';
export type ChatRow = { id: string; tick: number; type: string; name: string; text: string };

/** World chat and announcements, newest first; `before` is a stream id to page back from. */
export async function recentChat(r: Redis, count: number, before?: string): Promise<ChatRow[]> {
  const rows = await r.xRevRange(CHAT_STREAM, before ? `(${before}` : '+', '-', { COUNT: count });
  return rows.map(({ id, message }) => {
    const f = message as unknown as Record<string, string>;
    return { id: String(id), tick: Number(f.tick), type: f.type, name: f.name ?? '', text: f.text };
  });
}

import { CHAT_STREAM, type Redis } from '../shared/redis.ts';
import { Arcade, type MatchRecord, type Player } from './arcade.ts';

export const K = { meta: 'arcade:meta', players: 'arcade:players', history: 'arcade:history', chat: CHAT_STREAM, oldAgents: 'agents', oldMeta: 'meta' } as const;

/** Saves players that changed, the counters and recent match history. */
export async function flush(r: Redis, a: Arcade): Promise<void> {
  const m = r.multi().hSet(K.meta, { tick: String(a.tick), nextId: String(a.nextId), nextMatch: String(a.nextMatch) }).set(K.history, JSON.stringify(a.records));
  for (const id of a.dirty) {
    const p = a.players.get(id);
    if (p && !p.house) m.hSet(K.players, id, JSON.stringify(p));
  }
  a.dirty.clear();
  await m.exec();
}

/** Loads the arcade, or builds it once from a survival save (robots keep their ids, so their tokens still work). */
export async function loadArcade(r: Redis, rng: () => number = Math.random): Promise<Arcade> {
  const a = new Arcade(rng);
  const meta = await r.hGetAll(K.meta);
  const saved = await r.hGetAll(K.players);
  if (Object.keys(saved).length) {
    for (const json of Object.values(saved)) {
      const p = JSON.parse(json) as Player;
      a.players.set(p.id, p);
    }
    a.tick = Number(meta.tick) || 0;
    a.nextId = Number(meta.nextId) || a.players.size + 1;
    a.nextMatch = Number(meta.nextMatch) || 1;
    const h = await r.get(K.history);
    if (h) a.records = JSON.parse(h) as MatchRecord[];
    return a;
  }
  const old = await r.hGetAll(K.oldAgents);
  for (const json of Object.values(old)) {
    const o = JSON.parse(json) as { id: string; name: string; model?: string | null; createdAt?: number; banned?: boolean };
    const p = a.register(o.name, o.createdAt ?? Date.now());
    a.players.delete(p.id);
    Object.assign(p, { id: o.id, model: o.model ?? null, banned: Boolean(o.banned) });
    a.players.set(p.id, p);
    a.dirty.add(p.id);
  }
  a.nextId = Math.max(Number((await r.hGet(K.oldMeta, 'nextId')) ?? 1), a.players.size + 1);
  return a;
}

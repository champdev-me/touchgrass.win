import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import type { Agent } from '../shared/types.ts';
import { chunkBytes, writeChunk } from './terrain.ts';
import { World } from './world.ts';

export const K = { meta: 'meta', terrain: 'terrain', agents: 'agents' } as const;

export async function saveTerrain(r: Redis, tiles: Uint8Array, size: number): Promise<void> {
  const n = size / B.chunkSize, fields: Record<string, string> = {};
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) fields[`${cx},${cy}`] = Buffer.from(chunkBytes(tiles, cx, cy, size)).toString('base64');
  }
  await r.hSet(K.terrain, fields);
}

export async function flush(r: Redis, w: World): Promise<void> {
  const m = r.multi().hSet(K.meta, { tick: String(w.tick), nextId: String(w.nextId), mapSize: String(w.size), season: '1' });
  const ids = [...w.dirty];
  for (const id of ids) {
    const a = w.agents.get(id);
    if (a) m.hSet(K.agents, id, JSON.stringify(a));
  }
  w.dirty.clear();
  try {
    await m.exec();
  } catch (e) {
    for (const id of ids) w.dirty.add(id);
    throw e;
  }
}

export async function saveAgentNow(r: Redis, w: World, id: string): Promise<void> {
  const a = w.agents.get(id);
  if (a) await r.multi().hSet(K.agents, id, JSON.stringify(a)).hSet(K.meta, 'nextId', String(w.nextId)).exec();
}

export async function loadWorld(r: Redis): Promise<World | null> {
  const meta = await r.hGetAll(K.meta);
  if (!meta.mapSize) return null;
  const size = Number(meta.mapSize), tiles = new Uint8Array(size * size);
  for (const [key, b64] of Object.entries(await r.hGetAll(K.terrain))) {
    const [cx, cy] = key.split(',').map(Number);
    writeChunk(tiles, cx, cy, Buffer.from(b64, 'base64'), size);
  }
  const w = new World(tiles, size);
  w.tick = Number(meta.tick);
  w.nextId = Number(meta.nextId);
  for (const json of Object.values(await r.hGetAll(K.agents))) {
    const a = JSON.parse(json) as Agent;
    if (a.task) {
      a.task = null;
      a.inbox.push('Task cancelled: the universe rebooted.');
      w.dirty.add(a.id);
    }
    w.agents.set(a.id, a);
  }
  return w;
}

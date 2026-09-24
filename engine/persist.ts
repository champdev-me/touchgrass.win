import { B } from '../shared/balance.ts';
import { CHAT_STREAM, recentChat, type Redis } from '../shared/redis.ts';
import type { Agent, PackedNode } from '../shared/types.ts';
import { normalizeAgent } from './agent.ts';
import { generateNodes, packChunk, unpackChunk } from './nodes.ts';
import { chunkBytes, writeChunk } from './terrain.ts';
import { World, type LootPile } from './world.ts';

export const K = { meta: 'meta', terrain: 'terrain', agents: 'agents', nodes: 'nodes', loot: 'loot', firsts: 'firsts', chat: CHAT_STREAM } as const;

const chunkKeys = (size: number): string[] => {
  const n = size / B.chunkSize, keys: string[] = [];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) keys.push(`${cx},${cy}`);
  return keys;
};
const packed = (w: World, key: string): string => {
  const [cx, cy] = key.split(',').map(Number);
  return JSON.stringify(packChunk(w.nodes, cx, cy, w.size));
};

export async function saveTerrain(r: Redis, tiles: Uint8Array, size: number): Promise<void> {
  const fields: Record<string, string> = {};
  for (const key of chunkKeys(size)) {
    const [cx, cy] = key.split(',').map(Number);
    fields[key] = Buffer.from(chunkBytes(tiles, cx, cy, size)).toString('base64');
  }
  await r.hSet(K.terrain, fields);
}

export async function saveAllNodes(r: Redis, w: World): Promise<void> {
  const fields: Record<string, string> = {};
  for (const key of chunkKeys(w.size)) fields[key] = packed(w, key);
  await r.hSet(K.nodes, fields);
  w.dirtyChunks.clear();
}

export async function flush(r: Redis, w: World): Promise<void> {
  const m = r.multi().hSet(K.meta, { tick: String(w.tick), nextId: String(w.nextId), mapSize: String(w.size), season: '1' });
  const ids = [...w.dirty];
  const chunks = [...w.dirtyChunks];
  const lootWasDirty = w.lootDirty;
  for (const id of ids) {
    const a = w.agents.get(id);
    if (a) m.hSet(K.agents, id, JSON.stringify(a));
  }
  for (const key of chunks) m.hSet(K.nodes, key, packed(w, key));
  if (lootWasDirty) m.set(K.loot, JSON.stringify([...w.loot]));
  const firstsWasDirty = w.firstsDirty;
  if (firstsWasDirty && Object.keys(w.firsts).length) m.hSet(K.firsts, w.firsts);
  w.firstsDirty = false;
  w.dirty.clear();
  w.dirtyChunks.clear();
  w.lootDirty = false;
  try {
    await m.exec();
  } catch (e) {
    for (const id of ids) w.dirty.add(id);
    for (const key of chunks) w.dirtyChunks.add(key);
    w.lootDirty ||= lootWasDirty;
    w.firstsDirty ||= firstsWasDirty;
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
    const a = normalizeAgent(JSON.parse(json) as Partial<Agent> & { id: string; name: string });
    if (a.task) {
      a.task = null;
      a.inbox.push('Task cancelled: the universe rebooted.');
      w.dirty.add(a.id);
    }
    w.agents.set(a.id, a);
  }
  const savedNodes = await r.hGetAll(K.nodes);
  if (Object.keys(savedNodes).length) {
    for (const [key, json] of Object.entries(savedNodes)) {
      const [cx, cy] = key.split(',').map(Number);
      unpackChunk(w.nodes, cx, cy, JSON.parse(json) as PackedNode[], size);
    }
  } else {
    // Worlds from before resource nodes existed: grow them now, save on the next flush.
    w.nodes = generateNodes(tiles, size);
    for (const key of chunkKeys(size)) w.dirtyChunks.add(key);
  }
  for (const [i, node] of w.nodes) if (node.left === 0 && node.regrowAt > 0) w.depleted.add(i);
  const loot = await r.get(K.loot);
  if (loot) w.loot = new Map(JSON.parse(loot) as [number, LootPile][]);
  w.firsts = await r.hGetAll(K.firsts);
  w.chatLog = (await recentChat(r, B.chatLogKeep)).reverse().map((m) => (m.type === 'chat' ? `${m.name}: ${m.text}` : m.text));
  return w;
}

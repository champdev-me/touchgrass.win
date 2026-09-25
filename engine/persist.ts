import { B } from '../shared/balance.ts';
import { trimBag } from '../shared/items.ts';
import { CHAT_STREAM, recentChat, type Redis } from '../shared/redis.ts';
import { TERRAIN as T } from '../shared/types.ts';
import type { Agent, Base, Creature, NodeKind, PackedNode, Structure, Vec } from '../shared/types.ts';
import type { Clue } from './treasure.ts';
import { baseOf, placeBase } from './bases.ts';
import { normalizeAgent } from './agent.ts';
import { NODE_RULES, chunkOf, fullAmount, generateNodes, nodeKindAt, packChunk, unpackChunk } from './nodes.ts';
import { TERRAIN_RULES, chunkBytes, generateLand, levelsOf, walkable, writeChunk } from './terrain.ts';
import { World, type LootPile } from './world.ts';

export const BAG_RULES = 2; // 2: small bags
export const BASE_RULES = 1; // 1: every joined robot gets a base
export const ECON_RULES = 1; // 1: the Smith retired, robots trade with robots

export const K = { meta: 'meta', terrain: 'terrain', agents: 'agents', nodes: 'nodes', loot: 'loot', firsts: 'firsts', chat: CHAT_STREAM, creatures: 'creatures', heights: 'heights', structures: 'structures', market: 'market', treasures: 'treasures', clues: 'clues', bases: 'bases' } as const;

const chunkKeys = (size: number): string[] => {
  const n = size / B.chunkSize, keys: string[] = [];
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) keys.push(`${cx},${cy}`);
  return keys;
};
const packed = (w: World, key: string): string => {
  const [cx, cy] = key.split(',').map(Number);
  return JSON.stringify(packChunk(w.nodes, cx, cy, w.size));
};

export async function saveTerrain(r: Redis, tiles: Uint8Array, size: number, heights?: Uint8Array): Promise<void> {
  const fields: Record<string, string> = {}, levels: Record<string, string> = {};
  for (const key of chunkKeys(size)) {
    const [cx, cy] = key.split(',').map(Number);
    fields[key] = Buffer.from(chunkBytes(tiles, cx, cy, size)).toString('base64');
    if (heights) levels[key] = Buffer.from(chunkBytes(heights, cx, cy, size)).toString('base64');
  }
  await r.hSet(K.terrain, fields);
  if (heights) await r.hSet(K.heights, levels);
}

export async function saveAllNodes(r: Redis, w: World): Promise<void> {
  const fields: Record<string, string> = {};
  for (const key of chunkKeys(w.size)) fields[key] = packed(w, key);
  await r.hSet(K.nodes, fields);
  w.dirtyChunks.clear();
}

export async function flush(r: Redis, w: World): Promise<void> {
  const m = r.multi().hSet(K.meta, { tick: String(w.tick), nextId: String(w.nextId), nextMobId: String(w.nextMobId), mapSize: String(w.size), season: '1', seed: w.seed, nodeRules: String(NODE_RULES), bagRules: String(BAG_RULES), terrainRules: String(TERRAIN_RULES), econRules: String(ECON_RULES), baseRules: String(BASE_RULES) });
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
  const basesWereDirty = w.basesDirty;
  if (basesWereDirty) m.set(K.bases, JSON.stringify([...w.bases.values()]));
  w.basesDirty = false;
  const treasuresWereDirty = w.treasuresDirty || w.cluesDirty;
  if (treasuresWereDirty) m.set(K.treasures, JSON.stringify([...w.treasures])).set(K.clues, JSON.stringify({ next: w.nextClueId, all: [...w.clues] }));
  w.cluesDirty = false;
  w.treasuresDirty = false;
  const structuresWereDirty = w.structuresDirty;
  if (structuresWereDirty) m.set(K.structures, JSON.stringify([...w.structures]));
  w.structuresDirty = false;
  const creaturesWereDirty = w.creaturesDirty;
  if (creaturesWereDirty) m.set(K.creatures, JSON.stringify([...w.creatures.values()]));
  w.creaturesDirty = false;
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
    w.creaturesDirty ||= creaturesWereDirty;
    w.structuresDirty ||= structuresWereDirty;
    w.basesDirty ||= basesWereDirty;
    w.treasuresDirty ||= treasuresWereDirty;
    throw e;
  }
}

export async function saveAgentNow(r: Redis, w: World, id: string): Promise<void> {
  const a = w.agents.get(id);
  if (a) await r.multi().hSet(K.agents, id, JSON.stringify(a)).hSet(K.meta, 'nextId', String(w.nextId)).exec();
}

export async function loadWorld(r: Redis, seed = 'touchgrass-season-1'): Promise<World | null> {
  const meta = await r.hGetAll(K.meta);
  if (!meta.mapSize) return null;
  const size = Number(meta.mapSize), tiles = new Uint8Array(size * size);
  const readChunks = async (key: string, into: Uint8Array) => {
    const all = await r.hGetAll(key);
    for (const [k, b64] of Object.entries(all)) {
      const [cx, cy] = k.split(',').map(Number);
      writeChunk(into, cx, cy, Buffer.from(b64, 'base64'), size);
    }
    return Object.keys(all).length > 0;
  };
  await readChunks(K.terrain, tiles);
  let heights: Uint8Array = new Uint8Array(size * size);
  const oldTerrain = Number(meta.terrainRules ?? 1) < TERRAIN_RULES;
  if (oldTerrain) {
    // 3: height levels, mountain ranges, rivers and lakes. Regenerate the land once; keep a backup of the old one.
    await r.copy(K.terrain, `${K.terrain}:backup:${meta.terrainRules ?? 1}`, { REPLACE: true });
    const land = generateLand(meta.seed || seed, size);
    tiles.set(land.tiles);
    heights = land.heights;
    await saveTerrain(r, tiles, size, heights);
    await r.hSet(K.meta, { terrainRules: String(TERRAIN_RULES), seed: meta.seed || seed });
  } else if (!(await readChunks(K.heights, heights))) heights = levelsOf(tiles);
  const w = new World(tiles, size, Math.random, heights);
  w.seed = meta.seed || seed;
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
  const savedNodes = oldTerrain ? {} : await r.hGetAll(K.nodes); // new land grows fresh nodes
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
  if (Number(meta.nodeRules ?? 1) < NODE_RULES) {
    // Placement got sparser: drop nodes the current rules no longer place (once, so later planted ones survive)
    for (const [i, node] of w.nodes) {
      const [x, y] = w.xy(i);
      if (nodeKindAt(tiles[i], x, y) === node.kind) continue;
      w.nodes.delete(i);
      w.dirtyChunks.add(chunkOf(i, size));
    }
  }
  // Node kinds added by later rules grow into saved worlds once: 6 iron and crystal, 7 mud, gems, gold, herbs.
  const added: NodeKind[] = [...(Number(meta.nodeRules ?? 1) < 6 ? ['iron_vein', 'crystal'] as const : []), ...(Number(meta.nodeRules ?? 1) < 7 ? ['mud', 'gem_vein', 'gold_vein', 'herb'] as const : [])];
  if (added.length) {
    for (let i = 0; i < tiles.length; i++) {
      if (w.nodes.has(i)) continue;
      const [x, y] = w.xy(i), kind = nodeKindAt(tiles[i], x, y);
      if (!kind || !added.includes(kind)) continue;
      w.nodes.set(i, { kind, left: fullAmount(kind, x, y), regrowAt: 0 });
      w.dirtyChunks.add(chunkOf(i, size));
    }
  }
  for (const [i, node] of w.nodes) if (node.left === 0 && node.regrowAt > 0) w.depleted.add(i);
  if (oldTerrain) {
    const stuck = (x: number, y: number) => !walkable(w.at(x, y)) || w.at(x, y) === T.SHALLOW || w.solid(x, y);
    for (const a of w.agents.values()) {
      if (stuck(a.x, a.y)) [a.x, a.y] = w.nearestWalkable(a.x, a.y);
      if (stuck(a.spawn[0], a.spawn[1])) a.spawn = w.nearestWalkable(a.spawn[0], a.spawn[1]);
      w.dirty.add(a.id);
    }
  }
  const loot = await r.get(K.loot);
  if (loot) w.loot = new Map(JSON.parse(loot) as [number, LootPile][]);
  if (Number(meta.bagRules ?? 1) < BAG_RULES) {
    // Small bags: the overflow falls at the robot's feet as a loot pile.
    for (const a of w.agents.values()) {
      const extra = trimBag(a.inventory);
      if (Object.keys(extra).length) w.dropLoot(w.index(a.x, a.y), extra);
      w.dirty.add(a.id);
    }
  }
  w.firsts = await r.hGetAll(K.firsts);
  if (Number(meta.econRules ?? 0) < ECON_RULES) {
    await r.del(K.market); // the Smith retired
    for (const a of w.agents.values()) {
      const old: string | null = a.role;
      if (old === 'builder') a.role = 'smith';
      if (old === 'medic') a.role = 'gatherer';
      w.dirty.add(a.id);
    }
  }
  const bs = await r.get(K.bases);
  if (bs) {
    for (const b of JSON.parse(bs) as Base[]) {
      b.id ??= `base_${w.nextBaseId}`; // saved before bases had ids
      w.nextBaseId = Math.max(w.nextBaseId, Number(b.id.slice(5)) + 1);
      w.bases.set(b.id, b);
    }
  }
  if (Number(meta.baseRules ?? 0) < BASE_RULES) {
    // Robots from before bases: each gets one in join order; it respawns there, it is not moved now.
    for (const a of [...w.agents.values()].filter((o) => o.joined && !baseOf(w, o.id)).sort((p, q) => p.createdAt - q.createdAt)) {
      const at: Vec = [a.x, a.y];
      placeBase(w, a);
      [a.x, a.y] = at;
    }
  }
  const tr = await r.get(K.treasures); // the gateway never reads this key
  if (tr) w.treasures = new Map(JSON.parse(tr) as [number, { loot: number }][]);
  const cl = await r.get(K.clues);
  if (cl) {
    const saved = JSON.parse(cl) as { next: number; all: [string, Clue][] };
    [w.nextClueId, w.clues] = [saved.next, new Map(saved.all)];
  }
  const st = await r.get(K.structures);
  if (st) w.structures = new Map(JSON.parse(st) as [number, Structure][]);
  w.nextMobId = Number(meta.nextMobId) || 1;
  const mobs = await r.get(K.creatures);
  if (mobs) for (const c of JSON.parse(mobs) as Creature[]) w.creatures.set(c.id, c);
  if (oldTerrain) {
    // The land changed under them: creatures respawn near robots and loot piles are gone.
    w.creatures.clear();
    w.loot.clear();
    w.creaturesDirty = w.lootDirty = true;
  }
  w.chatLog = (await recentChat(r, B.chatLogKeep)).reverse().map((m) => (m.type === 'chat' ? `${m.name}: ${m.text}` : m.text));
  return w;
}

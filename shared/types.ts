import type { CreatureKind } from './creatures.ts';
import type { StructureKind } from './items.ts';

export const TERRAIN = { DEEP: 0, SHALLOW: 1, SAND: 2, MEADOW: 3, FOREST: 4, HILLS: 5, RUINS: 6, PLAZA: 7, MOUNTAIN: 8, PEAK: 9, HIGH: 10 } as const;
export type Terrain = (typeof TERRAIN)[keyof typeof TERRAIN];

export const ROLES = ['miner', 'mason', 'smith', 'carpenter', 'farmer', 'hunter', 'gatherer', 'scout'] as const;
export type Role = (typeof ROLES)[number];

export type Vec = [number, number];

export const NODE_KINDS = ['tree', 'berry_bush', 'grass', 'rock', 'iron_vein', 'crystal', 'mud', 'gem_vein', 'gold_vein', 'herb'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const GATHER_TARGETS = [...NODE_KINDS, 'loot', 'treasure'] as const;
export type GatherTarget = (typeof GATHER_TARGETS)[number];

export const EMOTES = ['dance', 'wave', 'bow', 'cry', 'flex'] as const;
export type Emote = (typeof EMOTES)[number];

export interface Bubble {
  kind: 'say' | 'world' | 'thought';
  text: string;
  until: number; // tick
}

/** A resource node inside a chunk: [local tile index, NODE_KINDS index, units left, regrow tick]. */
export type PackedNode = [number, number, number, number];

export type Task =
  | { type: 'move_to'; target: Vec; path: Vec[] }
  | { type: 'gather'; target: GatherTarget; until: number; got: number; node: number; path: Vec[]; progress: number }
  | { type: 'rest' }
  | { type: 'sleep' }
  | { type: 'attack'; target: string; progress: number }
  | { type: 'flee'; from: string; to?: Vec; path?: Vec[] }; // away from a creature, or to a chosen spot

export interface Agent {
  id: string;
  name: string;
  color: string;
  role: Role | null;
  model: string | null;
  joined: boolean;
  x: number;
  y: number;
  spawn: Vec;
  createdAt: number;
  lastActionAt: number;
  task: Task | null;
  inbox: string[];
  health: number;
  food: number;
  water: number;
  energy: number;
  inventory: Record<string, number>;
  dead: boolean;
  respawnAt: number;
  spawnedAt: number;
  autoEat: boolean;
  stats: Record<string, number>;
  online: boolean;
  lastSeenAt: number; // ms, last tool call of any kind
  lifeScore: number;
  seasonScore: number;
  bestLife: number;
  wallet: number;
  achievements: Record<string, number>; // achievement id -> tick unlocked
  explored: number[]; // chunk indices visited
  notes: string;
  mutedUntil: number; // ms epoch
  banned: boolean;
  bubble: Bubble | null;
  emote: { name: Emote; until: number } | null;
  badge: { emoji: string; until: number } | null;
  lastWorldChatTick: number;
  lastCountedChatTick: number;
  lastHurtAt: number; // tick
  recentKills: Record<string, number>; // victim agent id -> tick, for anti-farm
  autoFlee: boolean; // reflex: run from creatures charging at you
  wear: Record<string, number>; // uses left on the gear item in use, per item
  roleSwitchedAt: number; // tick of the last switch_role
  duelReturn: Vec | null; // where to put the robot back after a duel
}

export interface GameError {
  error: string;
  message: string;
  hint?: string;
  retry_after_seconds?: number;
}

export interface ActionRequest {
  agentId: string;
  tool: string;
  args: Record<string, unknown>;
}

export type ActionResult =
  | { ok: true; data: unknown; cooldownMs: number }
  | { ok: false; error: GameError; cooldownMs: number };

export interface AgentView {
  held: string | null; // the tool or weapon in its hand, for show
  id: string;
  name: string;
  color: string;
  role: Role | null;
  model: string | null;
  x: number;
  y: number;
  moving: boolean;
  health: number;
  food: number;
  water: number;
  energy: number;
  dead: boolean;
  action: string;
  online: boolean;
  bubble: { kind: Bubble['kind']; text: string } | null;
  emote: Emote | null;
  badge: string | null;
  score: number; // season score
  life: number; // current life score
  trophies: number; // achievements unlocked
  fighting: boolean;
  inventory: Record<string, number>;
  gold: number;
  face: Vec | null; // tile it is working on or fighting, to turn toward
}

export interface Creature {
  id: string;
  kind: CreatureKind;
  x: number;
  y: number;
  hp: number;
  mode: 'wander' | 'chase' | 'flee' | 'follow';
  target: string | null; // agent it chases, flees from or follows
  until: number; // tick when the mode ends
  bag: Record<string, number>; // a goblin's loot, a Roomba's vacuumings
  pack: number; // wolves spawned together share it; 0 = alone
  hitAt: number; // tick of its last bite
}

/** A robot's base: inclusive tile bounds and the flag on its centre. */
export interface Base { id: string; owner: string; x0: number; y0: number; x1: number; y1: number; flag: Vec; shieldUntil?: number }

export interface Structure {
  kind: StructureKind;
  owner: string; // agent id
  litUntil: number; // tick; campfires only
  items?: Record<string, number>; // chests only
  crop?: { kind: 'wheat' | 'berry'; readyAt: number }; // farm plots only
}
export type StructureView = [number, number, StructureKind, boolean, [string, number] | null]; // x, y, kind, lit, crop [kind, growth 0-1]

export interface CreatureView {
  id: string;
  kind: CreatureKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mode: Creature['mode'];
  face: Vec | null; // its prey, while charging
}

export interface GameEvent {
  tick: number;
  type: string;
  text: string;
  agent?: string;
  name?: string; // speaker, on 'chat' events
  other?: string; // the second robot, on 'trade' events
  x?: number;
  y?: number;
}

export interface TickDelta {
  tick: number;
  agents: AgentView[];
  events: GameEvent[];
  nodes: [number, number][]; // [global tile index, units left] changed this tick
  loot: Vec[]; // every loot pile currently on the map
  creatures: CreatureView[];
  structures: StructureView[];
  bases: [number, number, number, number, string][]; // x0, y0, x1, y1, owner colour
  duels: DuelView[];
}

/** A duel as spectators see it: names, hearts and the last round's moves. */
export interface DuelView { ring: number | null; a: string; b: string; an: string; bn: string; ah: number; bh: number; round: number; la: string | null; lb: string | null }

export type ServerMsg =
  | { type: 'hello'; mapSize: number; chunkSize: number; plaza: Vec; tick: number; recent: GameEvent[] }
  | { type: 'chunk'; cx: number; cy: number; data: string; nodes: PackedNode[]; heights?: string }
  | ({ type: 'tick' } & TickDelta);

export type ClientMsg = { type: 'chunks'; list: Vec[] };

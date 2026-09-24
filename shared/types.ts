export const TERRAIN = { DEEP: 0, SHALLOW: 1, SAND: 2, MEADOW: 3, FOREST: 4, HILLS: 5, RUINS: 6, PLAZA: 7 } as const;
export type Terrain = (typeof TERRAIN)[keyof typeof TERRAIN];

export const ROLES = ['gatherer', 'hunter', 'builder', 'medic', 'scout'] as const;
export type Role = (typeof ROLES)[number];

export type Vec = [number, number];

export interface Task {
  type: 'move_to';
  target: Vec;
  path: Vec[];
}

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
  id: string;
  name: string;
  color: string;
  role: Role | null;
  model: string | null;
  x: number;
  y: number;
  moving: boolean;
}

export interface GameEvent {
  tick: number;
  type: string;
  text: string;
  agent?: string;
  x?: number;
  y?: number;
}

export interface TickDelta {
  tick: number;
  agents: AgentView[];
  events: GameEvent[];
}

export type ServerMsg =
  | { type: 'hello'; mapSize: number; chunkSize: number; plaza: Vec; tick: number }
  | { type: 'chunk'; cx: number; cy: number; data: string }
  | ({ type: 'tick' } & TickDelta);

export type ClientMsg = { type: 'chunks'; list: Vec[] };

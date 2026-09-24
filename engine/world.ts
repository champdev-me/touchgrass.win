import { B } from '../shared/balance.ts';
import { compass, dist } from '../shared/geo.ts';
import { ROLES, TERRAIN as T, type Agent, type AgentView, type GameEvent, type Role, type TickDelta, type Vec } from '../shared/types.ts';
import { findPath } from './path.ts';
import { stepCost, tileAt, walkable } from './terrain.ts';

const COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3'];
const GRID: Record<number, string> = { [T.DEEP]: '~', [T.SHALLOW]: ',', [T.SAND]: ':', [T.MEADOW]: '.', [T.FOREST]: 'f', [T.HILLS]: '^', [T.RUINS]: 'r', [T.PLAZA]: '#' };
const LEGEND: Record<string, string> = { '@': 'you', '~': 'deep water (blocked)', ',': 'shallow water (slow)', ':': 'sand', '.': 'meadow', f: 'forest', '^': 'hills', r: 'ruins', '#': 'the Plaza', 'A-Z': 'other agents' };
const TERRAIN_NAME: Record<number, string> = { [T.DEEP]: 'deep water', [T.SHALLOW]: 'shallow water', [T.SAND]: 'sand', [T.MEADOW]: 'meadow', [T.FOREST]: 'forest', [T.HILLS]: 'hills', [T.RUINS]: 'ruins', [T.PLAZA]: 'the Plaza' };

/** A rule the agent broke; the dispatcher turns it into a GameError instead of a crash. */
export class GameFail extends Error {
  code: string;
  hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}

export class World {
  size: number;
  tiles: Uint8Array;
  rng: () => number;
  tick = 0;
  nextId = 1;
  agents = new Map<string, Agent>();
  dirty = new Set<string>();
  events: GameEvent[] = [];

  constructor(tiles: Uint8Array, size: number = B.mapSize, rng: () => number = Math.random) {
    this.tiles = tiles;
    this.size = size;
    this.rng = rng;
  }

  at = (x: number, y: number): number => tileAt(this.tiles, x, y, this.size);

  get plaza(): Vec {
    return [this.size / 2, this.size / 2];
  }

  register(name: string, now = Date.now()): Agent {
    const lower = name.toLowerCase();
    let active = 0;
    for (const a of this.agents.values()) {
      if (a.name.toLowerCase() === lower) throw new GameFail('name_taken', `Someone already touches grass as "${name}".`, 'Pick another name.');
      if (now - a.lastActionAt < B.activeWindowMs) active++;
    }
    if (active >= B.maxActiveAgents) throw new GameFail('world_full', 'The grass is full.', 'Try again tomorrow.');
    const id = `agent_${this.nextId}`;
    const spawn = this.pickSpawn();
    const a: Agent = {
      id, name, color: COLORS[(this.nextId - 1) % COLORS.length], role: null, model: null, joined: false,
      x: spawn[0], y: spawn[1], spawn, createdAt: now, lastActionAt: now, task: null, inbox: [],
    };
    this.nextId++;
    this.agents.set(id, a);
    this.dirty.add(id);
    return a;
  }

  join(id: string, role: Role, model: string | null): Agent {
    const a = this.get(id);
    if (model) a.model = model;
    if (!a.joined) {
      a.joined = true;
      a.role = role;
      this.emit('join', `${a.name} has entered the grass. Lower your expectations.`, a);
    } else {
      this.note(a, 'Welcome back. Your robot missed you. Probably.');
    }
    this.touch(a);
    return a;
  }

  observe(id: string) {
    const a = this.joined(id);
    const r = a.role === 'scout' ? B.scoutVision : B.vision;
    const others = [...this.agents.values()]
      .filter((o) => o.joined && o.id !== a.id && dist([o.x, o.y], [a.x, a.y]) <= r)
      .sort((p, q) => dist([p.x, p.y], [a.x, a.y]) - dist([q.x, q.y], [a.x, a.y]));
    const legend: Record<string, string> = { ...LEGEND };
    const marks = new Map<string, string>();
    others.forEach((o, i) => {
      const ch = String.fromCharCode(65 + (i % 26));
      marks.set(`${o.x},${o.y}`, ch);
      legend[ch] = legend[ch] ? `${legend[ch]}, ${o.id} ${o.name}` : `${o.id} ${o.name}`;
    });
    const grid: string[] = [];
    for (let y = a.y - r; y <= a.y + r; y++) {
      const row: string[] = [];
      for (let x = a.x - r; x <= a.x + r; x++) row.push(x === a.x && y === a.y ? '@' : (marks.get(`${x},${y}`) ?? GRID[this.at(x, y)]));
      grid.push(row.join(' '));
    }
    const [px, py] = this.plaza;
    const inbox = a.inbox;
    a.inbox = [];
    if (inbox.length) this.dirty.add(a.id);
    return {
      you: { id: a.id, name: a.name, role: a.role, model: a.model, pos: [a.x, a.y] as Vec, standing_on: TERRAIN_NAME[this.at(a.x, a.y)] },
      task: a.task ? { type: a.task.type, target: a.task.target, steps_left: a.task.path.length } : null,
      tick: this.tick,
      grid,
      legend,
      nearby: others.map((o) => `${o.id} ${o.name} (${o.role}${o.model ? `, ${o.model}` : ''}) ${dist([o.x, o.y], [a.x, a.y])} tiles ${compass(o.x - a.x, o.y - a.y)}`),
      landmarks: [`the Plaza (${px}, ${py}) is ${dist([px, py], [a.x, a.y])} tiles ${compass(px - a.x, py - a.y)}`],
      inbox,
      roles: this.census(),
    };
  }

  moveTo(id: string, x: number, y: number): { steps: number; eta_seconds: number } {
    const a = this.joined(id);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.size || y >= this.size) {
      throw new GameFail('bad_target', 'That place is outside the world.', `Use whole numbers from 0 to ${this.size - 1}.`);
    }
    if (!walkable(this.at(x, y))) throw new GameFail('blocked', 'That is deep water. Your robot cannot swim that deep.', 'Pick a land or shallow-water tile.');
    const path = findPath(this.at, [a.x, a.y], [x, y]);
    if (!path) throw new GameFail('no_path', 'Your robot cannot find a way there.', `Targets must be within ${B.pathRadius} tiles and reachable without crossing deep water.`);
    a.task = { type: 'move_to', target: [x, y], path };
    this.touch(a);
    this.emit('move', `${a.name} heads to (${x}, ${y}).`, a);
    const cost = path.reduce((s, [px, py]) => s + stepCost(this.at(px, py)), 0);
    return { steps: path.length, eta_seconds: Math.ceil(cost / B.moveBudgetPerTick) };
  }

  step(): TickDelta {
    this.tick++;
    for (const a of this.agents.values()) {
      if (!a.joined || a.task?.type !== 'move_to') continue;
      let budget: number = B.moveBudgetPerTick;
      while (budget > 0 && a.task.path.length) {
        const [nx, ny] = a.task.path[0];
        const cost = stepCost(this.at(nx, ny));
        if (cost > budget && budget < B.moveBudgetPerTick) break; // finish the slow step next tick
        a.task.path.shift();
        a.x = nx;
        a.y = ny;
        budget -= cost;
      }
      this.dirty.add(a.id);
      if (!a.task.path.length) {
        a.task = null;
        this.note(a, `Task done: arrived at (${a.x}, ${a.y}).`);
      }
    }
    const events = this.events;
    this.events = [];
    return { tick: this.tick, agents: this.views(), events };
  }

  views(): AgentView[] {
    return [...this.agents.values()]
      .filter((a) => a.joined)
      .map((a) => ({ id: a.id, name: a.name, color: a.color, role: a.role, model: a.model, x: a.x, y: a.y, moving: a.task !== null }));
  }

  get(id: string): Agent {
    const a = this.agents.get(id);
    if (!a) throw new GameFail('unknown_agent', 'Your robot does not exist. Spooky.', 'Sign up again at https://touchgrass.win');
    return a;
  }

  joined(id: string): Agent {
    const a = this.get(id);
    if (!a.joined) throw new GameFail('not_joined', 'You are not in the world yet.', 'Call join_game first.');
    return a;
  }

  census(): Record<Role, number> {
    const c = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
    for (const a of this.agents.values()) if (a.joined && a.role) c[a.role]++;
    return c;
  }

  note(a: Agent, text: string): void {
    a.inbox.push(text);
    if (a.inbox.length > B.inboxMax) a.inbox.splice(0, a.inbox.length - B.inboxMax);
    this.dirty.add(a.id);
  }

  emit(type: string, text: string, a?: Agent): void {
    this.events.push({ tick: this.tick, type, text, agent: a?.id, x: a?.x, y: a?.y });
  }

  touch(a: Agent): void {
    a.lastActionAt = Date.now();
    this.dirty.add(a.id);
  }

  pickSpawn(): Vec {
    const [px, py] = this.plaza;
    for (let i = 0; i < 10000; i++) {
      const x = Math.floor(this.rng() * this.size), y = Math.floor(this.rng() * this.size);
      if (this.at(x, y) === T.MEADOW && dist([x, y], [px, py]) >= B.spawnMinPlazaDist) return [x, y];
    }
    // ponytail: tiny test maps have no far meadow; first walkable tile is good enough there
    for (let i = 0; i < this.tiles.length; i++) {
      if (walkable(this.tiles[i]) && this.tiles[i] !== T.PLAZA) return [i % this.size, Math.floor(i / this.size)];
    }
    throw new Error('map has no walkable tiles');
  }
}

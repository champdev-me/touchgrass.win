import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { FOOD, room, type Inventory } from '../shared/items.ts';
import { timeOf } from '../shared/time.ts';
import { GATHER_TARGETS, ROLES, TERRAIN as T, type Agent, type AgentView, type GameEvent, type GatherTarget, type Role, type TickDelta, type Vec } from '../shared/types.ts';
import { AGENT_COLORS, normalizeAgent } from './agent.ts';
import { eat, tickBody } from './body.ts';
import { NODE_DEF, chunkOf, fullAmount, type ResourceNode } from './nodes.ts';
import { buildObservation } from './observe.ts';
import { findPath } from './path.ts';
import { findTarget, runTask } from './tasks.ts';
import { stepCost, tileAt, walkable } from './terrain.ts';

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

export interface LootPile {
  items: Inventory;
  expiresAt: number;
}

const DEATH_TEXT: Record<string, string> = {
  starvation: 'starved. The berries watched.',
  thirst: 'dried out like forgotten toast.',
  'hunger and thirst': 'ran out of food and water at the same time. Efficient.',
};
const isTarget = (s: string): s is GatherTarget => (GATHER_TARGETS as readonly string[]).includes(s);

export class World {
  size: number;
  tiles: Uint8Array;
  rng: () => number;
  tick = 0;
  nextId = 1;
  agents = new Map<string, Agent>();
  dirty = new Set<string>();
  events: GameEvent[] = [];
  nodes = new Map<number, ResourceNode>();
  depleted = new Set<number>();
  dirtyChunks = new Set<string>();
  nodeChanges: [number, number][] = [];
  loot = new Map<number, LootPile>();
  lootDirty = false;

  constructor(tiles: Uint8Array, size: number = B.mapSize, rng: () => number = Math.random) {
    this.tiles = tiles;
    this.size = size;
    this.rng = rng;
  }

  at = (x: number, y: number): number => tileAt(this.tiles, x, y, this.size);

  get plaza(): Vec {
    return [this.size / 2, this.size / 2];
  }

  index(x: number, y: number): number {
    return y * this.size + x;
  }

  xy(i: number): Vec {
    return [i % this.size, Math.floor(i / this.size)];
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
    const a = normalizeAgent({
      id, name, color: AGENT_COLORS[(this.nextId - 1) % AGENT_COLORS.length], x: spawn[0], y: spawn[1], spawn, createdAt: now, lastActionAt: now,
    });
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
      a.spawnedAt = this.tick;
      this.emit('join', `${a.name} has entered the grass. Lower your expectations.`, a);
    } else {
      this.note(a, 'Welcome back. Your robot missed you. Probably.');
    }
    this.touch(a);
    return a;
  }

  observe(id: string) {
    return buildObservation(this, this.joined(id));
  }

  moveTo(id: string, x: number, y: number): { steps: number; eta_seconds: number } {
    const a = this.alive(id);
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

  gather(id: string, target: string, until?: number) {
    const a = this.alive(id);
    if (!isTarget(target)) throw new GameFail('bad_target', `You cannot gather "${target}".`, `Gather one of: ${GATHER_TARGETS.join(', ')}.`);
    if (target !== 'loot' && room(a.inventory, NODE_DEF[target].item) === 0) throw new GameFail('bag_full', 'Your bag is full.', `It holds ${B.inventorySlots} stacks of ${B.stackSize}. Eat something or stop hoarding.`);
    const found = findTarget(this, a, target);
    if (!found) throw new GameFail('none_nearby', `No reachable ${target.replace('_', ' ')} in sight.`, 'Walk somewhere new, then observe again.');
    const want = until !== undefined && Number.isInteger(until) && until > 0 ? until : B.gatherUntilFull;
    a.task = { type: 'gather', target, until: want, got: 0, node: found.index, path: found.path, progress: 0 };
    this.touch(a);
    return { target, until: want === B.gatherUntilFull ? 'bag full' : want, walk_steps: found.path.length };
  }

  eatItem(id: string, item: string) {
    const a = this.alive(id);
    if (!FOOD[item]) throw new GameFail('not_food', `${item} is not food. Probably.`, `Edible: ${Object.keys(FOOD).join(', ')}.`);
    if (!((a.inventory[item] ?? 0) > 0)) throw new GameFail('not_carrying', `You have no ${item}.`, 'Gather some first.');
    eat(a, item);
    this.bump(a, `eat:${item}`);
    this.touch(a);
    return { ate: item, food: Math.round(a.food), water: Math.round(a.water) };
  }

  drink(id: string) {
    const a = this.alive(id);
    if (!this.nearWater(a.x, a.y)) throw new GameFail('no_water', 'There is no water next to you.', 'Stand next to (or in) water, then drink. observe lists drink spots.');
    a.water = Math.min(100, a.water + B.drinkAmount);
    this.touch(a);
    return { water: Math.round(a.water) };
  }

  rest(id: string) {
    const a = this.alive(id);
    a.task = { type: 'rest' };
    this.touch(a);
    return { energy: Math.round(a.energy) };
  }

  sleep(id: string) {
    const a = this.alive(id);
    a.task = { type: 'sleep' };
    this.touch(a);
    return { energy: Math.round(a.energy) };
  }

  settings(id: string, autoEat: unknown) {
    const a = this.joined(id);
    if (typeof autoEat === 'boolean') {
      a.autoEat = autoEat;
      this.dirty.add(a.id);
    }
    return { auto_eat: a.autoEat };
  }

  cooldownFor(id: string): number {
    const a = this.agents.get(id);
    return a && (a.health < B.lowHealth || a.food < B.lowStat || a.water < B.lowStat) ? B.lowStatCooldownMs : B.doCooldownMs;
  }

  vision(a: Agent): number {
    const base = a.role === 'scout' ? B.scoutVision : B.vision;
    return timeOf(this.tick).phase === 'night' ? Math.ceil(base * B.nightVisionFactor) : base;
  }

  nearWater(x: number, y: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= this.size || ny >= this.size) continue; // the void is not a drink spot
        const t = this.at(nx, ny);
        if (t === T.DEEP || t === T.SHALLOW) return true;
      }
    }
    return false;
  }

  step(): TickDelta {
    this.tick++;
    const { dayTick } = timeOf(this.tick);
    if (dayTick === 0) this.emit('dawn', 'The sun rises. Robots squint.');
    if (dayTick === B.dayTicks - B.nightTicks) this.emit('dusk', 'Night falls. Vision halves. Something rustles.');
    for (const a of this.agents.values()) {
      if (!a.joined) continue;
      if (a.dead) {
        if (this.tick >= a.respawnAt) this.respawn(a);
        continue;
      }
      if (dayTick === 0 && a.task?.type === 'sleep') this.interrupt(a, 'The sun woke you up.');
      const news = tickBody(a, runTask(this, a));
      this.dirty.add(a.id);
      if (news.ate) {
        this.note(a, `Reflex: you ate ${news.ate}.`);
        this.bump(a, `eat:${news.ate}`);
      }
      for (const alert of news.alerts) this.interrupt(a, alert);
      if (news.death) this.kill(a, news.death);
    }
    this.regrow();
    for (const [i, pile] of this.loot) {
      if (pile.expiresAt <= this.tick) {
        this.loot.delete(i);
        this.lootDirty = true;
      }
    }
    const events = this.events;
    const nodes = this.nodeChanges;
    this.events = [];
    this.nodeChanges = [];
    return { tick: this.tick, agents: this.views(), events, nodes, loot: [...this.loot.keys()].map((i) => this.xy(i)) };
  }

  takeFromNode(i: number, node: ResourceNode): void {
    node.left = Math.max(0, node.left - 1);
    if (node.left === 0) {
      const regrow = NODE_DEF[node.kind].regrowTicks;
      if (regrow !== null) {
        node.regrowAt = this.tick + regrow;
        this.depleted.add(i);
      }
    }
    this.nodeChanged(i, node);
  }

  nodeChanged(i: number, node: ResourceNode): void {
    this.dirtyChunks.add(chunkOf(i, this.size));
    this.nodeChanges.push([i, node.left]);
  }

  regrow(): void {
    for (const i of this.depleted) {
      const node = this.nodes.get(i);
      if (!node || this.tick < node.regrowAt) continue;
      const [x, y] = this.xy(i);
      node.left = fullAmount(node.kind, x, y);
      node.regrowAt = 0;
      this.depleted.delete(i);
      this.nodeChanged(i, node);
    }
  }

  dropLoot(i: number, items: Inventory): void {
    const pile = this.loot.get(i) ?? { items: {}, expiresAt: 0 };
    for (const [item, n] of Object.entries(items)) pile.items[item] = (pile.items[item] ?? 0) + n;
    pile.expiresAt = this.tick + B.lootTicks;
    this.loot.set(i, pile);
    this.lootDirty = true;
  }

  kill(a: Agent, cause: string): void {
    a.dead = true;
    a.task = null;
    a.health = 0;
    a.respawnAt = this.tick + B.respawnTicks;
    const dropped: Inventory = {};
    for (const [item, n] of Object.entries(a.inventory)) {
      const d = Math.ceil(n / 2);
      dropped[item] = d;
      if (n - d > 0) a.inventory[item] = n - d;
      else delete a.inventory[item];
    }
    if (Object.keys(dropped).length) this.dropLoot(this.index(a.x, a.y), dropped);
    this.bump(a, `death:${cause}`);
    if (this.tick - a.spawnedAt < B.speedrunTicks) this.bump(a, 'death:speedrun');
    if (cause !== 'thirst' && this.berriesNear(a.x, a.y, 3)) this.bump(a, 'death:starved_at_buffet');
    this.emit('death', `${a.name} ${DEATH_TEXT[cause] ?? `died of ${cause}.`}`, a);
    this.note(a, `You died of ${cause}. You respawn in ${B.respawnTicks}s. Half your bag stayed behind.`);
  }

  respawn(a: Agent): void {
    a.dead = false;
    a.health = 100;
    a.food = B.respawnStats;
    a.water = B.respawnStats;
    a.energy = 100;
    [a.x, a.y] = a.spawn;
    a.spawnedAt = this.tick;
    this.dirty.add(a.id);
    this.emit('respawn', `${a.name} is back. Nobody learned anything.`, a);
    this.note(a, 'You respawned at your spawn point.');
  }

  berriesNear(x: number, y: number, r: number): boolean {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const node = this.nodes.get(this.index(x + dx, y + dy));
        if (node?.kind === 'berry_bush' && node.left > 0) return true;
      }
    }
    return false;
  }

  views(): AgentView[] {
    return [...this.agents.values()]
      .filter((a) => a.joined)
      .map((a) => ({
        id: a.id, name: a.name, color: a.color, role: a.role, model: a.model, x: a.x, y: a.y,
        moving: a.task?.type === 'move_to' || (a.task?.type === 'gather' && a.task.path.length > 0),
        health: Math.round(a.health), food: Math.round(a.food), water: Math.round(a.water), energy: Math.round(a.energy),
        dead: a.dead, action: a.dead ? 'dead' : (a.task?.type ?? 'idle'),
      }));
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

  alive(id: string): Agent {
    const a = this.joined(id);
    if (a.dead) throw new GameFail('dead', `You are dead. You respawn in ${Math.max(0, a.respawnAt - this.tick)}s.`, 'Being dead is mostly waiting. observe still works.');
    return a;
  }

  census(): Record<Role, number> {
    const c = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
    for (const a of this.agents.values()) if (a.joined && a.role) c[a.role]++;
    return c;
  }

  finish(a: Agent, message: string): void {
    a.task = null;
    this.note(a, message);
  }

  interrupt(a: Agent, reason: string): void {
    if (!a.task) return this.note(a, reason);
    a.task = null;
    this.note(a, `Task interrupted: ${reason}`);
  }

  note(a: Agent, text: string): void {
    a.inbox.push(text);
    if (a.inbox.length > B.inboxMax) a.inbox.splice(0, a.inbox.length - B.inboxMax);
    this.dirty.add(a.id);
  }

  emit(type: string, text: string, a?: Agent): void {
    this.events.push({ tick: this.tick, type, text, agent: a?.id, x: a?.x, y: a?.y });
  }

  bump(a: Agent, key: string): void {
    a.stats[key] = (a.stats[key] ?? 0) + 1;
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

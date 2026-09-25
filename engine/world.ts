import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { FOOD, ITEMS, KITS, addItem, isMap, room, slotsOf, type Inventory } from '../shared/items.ts';
import { CREATURES } from '../shared/creatures.ts';
import { timeOf } from '../shared/time.ts';
import { GATHER_TARGETS, ROLES, TERRAIN as T, type Agent, type AgentView, type Bubble, type Creature, type CreatureView, type Base, type Structure, type StructureView, type GameEvent, type GatherTarget, type Role, type TickDelta, type Vec } from '../shared/types.ts';
import { checkAchievements } from './achievements.ts';
import { AGENT_COLORS, normalizeAgent } from './agent.ts';
import { BUFFET_SUFFIX, say } from './lines.ts';
import { eat, tickBody } from './body.ts';
import { stepCreatures } from './creatures.ts';
import { armorOf, bestTool, useGear } from './gear.ts';
import { weaponOf } from './combat.ts';
import { chunksPerRow, dominantTerrain, explore } from './explore.ts';
import { NODE_DEF, chunkOf, fullAmount, wrongRole, type ResourceNode } from './nodes.ts';
import { buildObservation } from './observe.ts';
import { expireOffers, type Offer } from './trade.ts';
import { spawnTreasures, type Clue } from './treasure.ts';
import { duelViews, inDuel, stepDuels, type Challenge, type Duel } from './duel.ts';
import { baseOf, lockCheck, placeBase, releaseIdle } from './bases.ts';
import { findPath } from './path.ts';
import { addScore } from './score.ts';
import { findTarget, runTask } from './tasks.ts';
import { levelsOf, stepCost, tileAt, walkable } from './terrain.ts';

/** A rule the agent broke; the dispatcher turns it into a GameError instead of a crash. */
/** A bag as spectators see it: treasure maps lose their coordinates. */
function publicBag(inv: Inventory): Inventory {
  if (!inv || !Object.keys(inv).some(isMap)) return inv; // a corrupt bag must not stop the tick
  const out: Inventory = {};
  for (const [k, n] of Object.entries(inv)) out[isMap(k) ? 'treasure_map' : k] = (out[isMap(k) ? 'treasure_map' : k] ?? 0) + n;
  return out;
}

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
  offers = new Map<string, Offer>(); // memory only: a restart clears open offers
  bases = new Map<string, Base>(); // base id -> base; a robot may own several
  challenges = new Map<string, Challenge>(); // defender id -> open challenge (memory only)
  duels: Duel[] = []; // seated or waiting, first come first served
  chickens = new Map<string, number[]>(); // robot -> times it rejected a challenge (ms)
  defended = new Map<string, number>(); // robot -> tick its defense shield ends
  nextBaseId = 1;
  basesDirty = false;
  treasures = new Map<number, { loot: number }>(); // tile -> buried treasure; scouts only, never broadcast
  treasuresDirty = false;
  treasureTarget: number = B.treasureCount;
  clues = new Map<string, Clue>(); // clue item -> where its next find lies
  nextClueId = 1;
  cluesDirty = false;
  nextOfferId = 1;
  lootDirty = false;
  chatLog: string[] = [];
  chunkTerrain: Uint8Array | null = null;
  firsts: Record<string, string> = {}; // achievement id -> agent id of the server first
  firstsDirty = false;
  urgent = false;
  creatures = new Map<string, Creature>();
  nextMobId = 1;
  creaturesDirty = false;
  lastKickNews = -1_000_000;
  structures = new Map<number, Structure>();
  structuresDirty = false;

  heights: Uint8Array;
  seed = ''; // the land's generator seed, kept so migrations can regenerate it

  constructor(tiles: Uint8Array, size: number = B.mapSize, rng: () => number = Math.random, heights: Uint8Array = levelsOf(tiles)) {
    this.tiles = tiles;
    this.heights = heights;
    this.size = size;
    this.rng = rng;
  }

  at = (x: number, y: number): number => tileAt(this.tiles, x, y, this.size);

  height = (x: number, y: number): number => (x < 0 || y < 0 || x >= this.size || y >= this.size ? 0 : this.heights[y * this.size + x]);

  /** Trees and berry bushes are solid; robots and creatures stand next to them. */
  solid = (x: number, y: number): boolean => {
    const i = y * this.size + x, k = this.nodes.get(i)?.kind, s = this.structures.get(i)?.kind;
    return k === 'tree' || k === 'berry_bush' || (s !== undefined && s !== 'bed' && s !== 'farm_plot');
  };

  /** Stepping for one robot: its own doors open for it. */
  stepFor = (a: Agent) => (ax: number, ay: number, bx: number, by: number): boolean => {
    const s = this.structures.get(by * this.size + bx);
    if (s?.kind === 'door' && s.owner === a.id) return Math.abs(this.height(bx, by) - this.height(ax, ay)) <= B.maxClimb;
    return this.canStep(ax, ay, bx, by);
  };

  /** One level up or down per step, and never into a tree. */
  canStep = (ax: number, ay: number, bx: number, by: number): boolean =>
    Math.abs(this.height(bx, by) - this.height(ax, ay)) <= B.maxClimb && !this.solid(bx, by);

  get plaza(): Vec {
    return [this.size / 2, this.size / 2];
  }

  index(x: number, y: number): number {
    return y * this.size + x;
  }

  xy(i: number): Vec {
    return [i % this.size, Math.floor(i / this.size)];
  }

  chunkCount(): number {
    return chunksPerRow(this.size) ** 2;
  }

  chunkTerrainOf(): Uint8Array {
    this.chunkTerrain ??= dominantTerrain(this.tiles, this.size);
    return this.chunkTerrain;
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
      id, name, color: AGENT_COLORS[(this.nextId - 1) % AGENT_COLORS.length], x: spawn[0], y: spawn[1], spawn, createdAt: now, lastActionAt: now, wallet: B.startGold,
    });
    this.nextId++;
    this.agents.set(id, a);
    this.dirty.add(id);
    return a;
  }

  join(id: string, role: Role, model: string | null, now = Date.now()): Agent {
    const a = this.get(id);
    if (a.banned) throw new GameFail('banned', 'You are banned from the grass.', 'Contact the admin if you think this is a mistake.');
    if (model) a.model = model;
    if (!a.joined) {
      a.joined = true;
      a.role = role;
      this.giveKit(a);
      if (!baseOf(this, a.id)) placeBase(this, a);
      a.spawnedAt = this.tick;
      a.online = true;
      a.lastSeenAt = now;
      this.emit('join', say('join', a.name, this.rng), a);
    } else {
      this.note(a, 'Welcome back. Your robot missed you. Probably.');
    }
    this.touch(a);
    return a;
  }

  /** Any tool call counts as presence; coming back after being away is announced. */
  seen(id: string, now = Date.now()): void {
    const a = this.agents.get(id);
    if (!a?.joined) return;
    a.lastSeenAt = now;
    if (!a.online) {
      a.online = true;
      this.emit('return', say('return', a.name, this.rng), a);
    }
    this.dirty.add(a.id);
  }

  observe(id: string) {
    return buildObservation(this, this.joined(id));
  }

  moveTo(id: string, x: number, y: number): { steps: number; eta_seconds: number } {
    const a = this.alive(id);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.size || y >= this.size) {
      throw new GameFail('bad_target', 'That place is outside the world.', `Use whole numbers from 0 to ${this.size - 1}.`);
    }
    if (!walkable(this.at(x, y))) {
      const deep = this.at(x, y) === T.DEEP;
      throw new GameFail('blocked', deep ? 'That is deep water. Your robot cannot swim that deep.' : 'That is a mountain. Your robot is not a goat.', 'Pick a land or shallow-water tile.');
    }
    if (this.solid(x, y) && this.structures.get(this.index(x, y))?.owner !== a.id) throw new GameFail('blocked', 'Something is in the way there. Your robot cannot stand inside it.', 'Pick a tile next to it.');
    const path = findPath(this.at, [a.x, a.y], [x, y], B.pathRadius, this.stepFor(a));
    if (!path) throw new GameFail('no_path', 'Your robot cannot find a way there.', `Targets must be within ${B.pathRadius} tiles and reachable without deep water or cliffs: robots climb one level per step.`);
    a.task = { type: 'move_to', target: [x, y], path };
    this.touch(a);
    this.emit('move', `${a.name} heads to (${x}, ${y}).`, a);
    const cost = path.reduce((s, [px, py]) => s + stepCost(this.at(px, py)), 0);
    return { steps: path.length, eta_seconds: Math.ceil(cost / B.moveBudgetPerTick) };
  }

  gather(id: string, target: string, until?: number) {
    const a = this.alive(id);
    if (inDuel(this, a.id)) throw new GameFail('in_duel', 'You are in a duel. Fight!', 'fight(moves=[...])');
    if (a.energy <= 0) throw new GameFail('too_tired', 'Your robot is too tired to punch anything.', 'rest or sleep first.');
    if (!isTarget(target)) throw new GameFail('bad_target', `You cannot gather "${target}".`, `Gather one of: ${GATHER_TARGETS.join(', ')}.`);
    if (target === 'treasure') return this.digFor(a);
    if (target !== 'loot' && NODE_DEF[target].roles && !NODE_DEF[target].roles!.includes(a.role!)) throw wrongRole(target);
    if (target !== 'loot' && target !== 'gold_vein' && room(a.inventory, NODE_DEF[target].item) === 0) throw new GameFail('bag_full', 'Your bag is full.', `It holds ${slotsOf(a.inventory)} slots. Eat, drop, trade or store something, or stop hoarding.`);
    if (target !== 'loot' && NODE_DEF[target].needsPickaxe && !bestTool(a, target)) {
      throw new GameFail('needs_pickaxe', 'You need a pickaxe for that.', 'Buy one from a smith, or craft one if you are a smith.');
    }
    const found = findTarget(this, a, target);
    if (!found && target !== 'loot' && this.lockedNear(a, target)) lockCheck(this, a, ...this.lockedNear(a, target)!);
    if (!found) throw new GameFail('none_nearby', `No reachable ${target.replace('_', ' ')} in sight.`, 'Walk somewhere new, then observe again.');
    const want = until !== undefined && Number.isInteger(until) && until > 0 ? until : B.gatherUntilFull;
    a.task = { type: 'gather', target, until: want, got: 0, node: found.index, path: found.path, progress: 0 };
    this.touch(a);
    return { target, until: want === B.gatherUntilFull ? 'bag full' : want, walk_steps: found.path.length };
  }

  /** Whoever holds a treasure map walks to the spot and digs (slowly without a pickaxe). */
  private digFor(a: Agent) {
    const map = Object.keys(a.inventory).find(isMap);
    if (!map) throw new GameFail('no_map', 'You need a treasure map to know where to dig.', 'Buy one from a scout, or follow a clue trail.');
    const [x, y] = map.slice('treasure_map:'.length).split(',').map(Number);
    if (!this.treasures.has(this.index(x, y))) throw new GameFail('stale_map', 'Someone already dug this one up. The map is now a souvenir.', 'Buy a fresher map.');
    const path = x === a.x && y === a.y ? [] : findPath(this.at, [a.x, a.y], [x, y], B.pathRadius, this.stepFor(a));
    if (!path) throw new GameFail('no_path', 'Your robot cannot find a way to the treasure.', `Walk within ${B.pathRadius} tiles of (${x}, ${y}) first.`);
    a.task = { type: 'gather', target: 'treasure', until: 1, got: 0, node: this.index(x, y), path, progress: 0 };
    this.touch(a);
    return { target: 'treasure', at: [x, y], walk_steps: path.length };
  }

  eatItem(id: string, item: string) {
    const a = this.alive(id);
    if (!FOOD[item]) throw new GameFail('not_food', `${item} is not food. Probably.`, `Edible: ${Object.keys(FOOD).join(', ')}.`);
    if (!((a.inventory[item] ?? 0) > 0)) throw new GameFail('not_carrying', `You have no ${item}.`, 'Gather some first.');
    const ache = eat(a, item, this.rng);
    if (ache) this.note(a, 'Raw food. Tummy ache! −20 energy.');
    this.bump(a, `eat:${item}`);
    this.touch(a);
    return { ate: item, food: Math.round(a.food), water: Math.round(a.water), energy: Math.round(a.energy), tummy_ache: ache };
  }

  drink(id: string) {
    const a = this.alive(id);
    if (this.nearWater(a.x, a.y)) {
      a.water = Math.min(100, a.water + B.drinkAmount);
      if ((a.inventory.waterskin ?? 0) > 0) a.wear.waterskin = ITEMS.waterskin.uses!; // refill it too
    } else if ((a.inventory.waterskin ?? 0) > 0 && (a.wear.waterskin ?? 0) > 0) {
      a.water = Math.min(100, a.water + B.drinkAmount);
      a.wear.waterskin -= 1;
    } else {
      throw new GameFail('no_water', 'There is no water next to you.', 'Stand next to (or in) water, or carry a filled waterskin.');
    }
    this.touch(a);
    return { water: Math.round(a.water), waterskin: a.inventory.waterskin ? a.wear.waterskin : undefined };
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

  settings(id: string, autoEat: unknown, autoFlee?: unknown) {
    const a = this.joined(id);
    if (typeof autoEat === 'boolean') a.autoEat = autoEat;
    if (typeof autoFlee === 'boolean') a.autoFlee = autoFlee;
    this.dirty.add(a.id);
    return { auto_eat: a.autoEat, auto_flee: a.autoFlee };
  }

  /** Run from the nearest dangerous creature in sight, or to a chosen spot. */
  flee(id: string, x?: number, y?: number) {
    const a = this.alive(id);
    if (x !== undefined && y !== undefined) {
      const { steps } = this.moveTo(id, x, y); // same checks and path as walking there
      const path = a.task?.type === 'move_to' ? a.task.path : [];
      a.task = { type: 'flee', from: '', to: [x, y], path };
      return { fleeing_to: [x, y], steps };
    }
    let threat: Creature | null = null, bd = Infinity;
    for (const c of this.creatures.values()) {
      const d = dist([c.x, c.y], [a.x, a.y]);
      if (CREATURES[c.kind].damage > 0 && d <= this.vision(a) && d < bd) [threat, bd] = [c, d];
    }
    if (!threat) throw new GameFail('no_threat', 'Nothing scary in sight. You run anyway, in your heart.', 'flee works when a dangerous creature is in sight.');
    a.task = { type: 'flee', from: threat.id };
    this.bubble(a, 'say', say('flee', a.name, this.rng, CREATURES[threat.kind].name));
    this.touch(a);
    return { fleeing_from: `${threat.id} ${CREATURES[threat.kind].name}` };
  }

  /** A creature charging at this robot close enough to notice. */
  chargingAt(a: Agent): Creature | null {
    for (const c of this.creatures.values()) {
      if (c.mode === 'chase' && c.target === a.id && CREATURES[c.kind].damage > 0 && dist([c.x, c.y], [a.x, a.y]) <= B.fleeNotice) return c;
    }
    return null;
  }

  /** Where a task target is: an agent, a creature, or a node. */
  targetPos(target: string): Vec | null {
    if (target.startsWith('rock:')) return this.xy(Number(target.slice(5)));
    const c = this.creatures.get(target);
    if (c) return [c.x, c.y];
    const o = this.agents.get(target);
    return o && o.joined && !o.dead ? [o.x, o.y] : null;
  }

  faceOf(a: Agent): Vec | null {
    const t = a.task;
    if (t?.type === 'gather' && !t.path.length) return this.xy(t.node);
    if (t?.type === 'attack') return this.targetPos(t.target);
    const d = inDuel(this, a.id);
    if (d?.ring != null) {
      const o = this.agents.get(d.a === a.id ? d.b : d.a);
      return o ? [o.x, o.y] : null;
    }
    return null;
  }

  inCombat(a: Agent): boolean {
    if (a.task?.type === 'attack' || this.tick - a.lastHurtAt <= B.combatTicks) return true;
    for (const c of this.creatures.values()) if (CREATURES[c.kind].hostile && dist([c.x, c.y], [a.x, a.y]) <= B.threatRadius) return true;
    return false;
  }

  cooldownFor(id: string): number {
    const a = this.agents.get(id);
    if (!a) return B.doCooldownMs;
    if (inDuel(this, a.id)) return B.duelCooldownMs;
    if (this.inCombat(a)) return B.combatCooldownMs;
    return a.health < B.lowHealth || a.food < B.lowStat || a.water < B.lowStat ? B.lowStatCooldownMs : B.doCooldownMs;
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

  step(now = Date.now()): TickDelta {
    this.tick++;
    const { dayTick } = timeOf(this.tick);
    if (dayTick === 0) this.emit('dawn', say('dawn', '', this.rng));
    if (dayTick === B.dayTicks - B.nightTicks) this.emit('dusk', say('dusk', '', this.rng));
    for (const a of this.agents.values()) {
      if (!a.joined) continue;
      try {
        this.stepAgent(a, dayTick);
      } catch (e) {
        // One robot's bad state must never freeze the world for everyone else.
        console.error(`[engine] ${a.id} tick failed`, e);
        a.task = null;
        this.note(a, 'Your robot glitched and forgot what it was doing.');
      }
    }
    for (const a of this.agents.values()) {
      if (!a.joined || !a.online || now - a.lastSeenAt <= B.awayAfterMs) continue;
      a.online = false;
      this.dirty.add(a.id);
      this.emit('leave', say('leave', a.name, this.rng), a);
    }
    stepCreatures(this);
    expireOffers(this);
    stepDuels(this);
    if (this.tick % 60 === 0) spawnTreasures(this);
    if (this.tick % 3600 === 0) releaseIdle(this, Date.now());
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
    return { tick: this.tick, agents: this.views(), events, nodes, loot: [...this.loot.keys()].map((i) => this.xy(i)), creatures: this.creatureViews(), structures: this.structureViews(), bases: [...this.bases.values()].map((b) => [b.x0, b.y0, b.x1, b.y1, this.agents.get(b.owner)?.color ?? '#ffffff']), duels: duelViews(this) };
  }

  stepAgent(a: Agent, dayTick: number): void {
    if (a.dead) {
      if (this.tick >= a.respawnAt) this.respawn(a);
      return;
    }
    if (dayTick === 0 && a.task?.type === 'sleep') this.interrupt(a, 'The sun woke you up.');
    if (timeOf(this.tick).phase === 'night' && (a.inventory.torch ?? 0) > 0) useGear(this, a, 'torch');
    const charging = a.autoFlee && a.task?.type !== 'attack' && a.task?.type !== 'flee' ? this.chargingAt(a) : null;
    if (charging) {
      a.task = { type: 'flee', from: charging.id }; // reflex; attack() or settings(auto_flee=false) to stand and fight
      this.bubble(a, 'say', say('flee', a.name, this.rng, CREATURES[charging.kind].name));
      this.note(a, `Reflex: a ${CREATURES[charging.kind].name} is charging at you. You run!`);
    }
    const activity = runTask(this, a);
    const news = tickBody(a, activity);
    const bed = activity === 'sleep' ? this.bedOf(a) : null;
    if (bed && dist(bed, [a.x, a.y]) <= 1) a.energy = Math.min(100, a.energy + (B.bedSleepMultiplier - 1) * B.sleepEnergyPerTick); // a proper bed
    this.dirty.add(a.id);
    if (news.ate) {
      this.note(a, `Reflex: you ate ${news.ate}.`);
      this.bump(a, `eat:${news.ate}`);
    }
    for (const alert of news.alerts) this.interrupt(a, alert);
    if (news.death) this.kill(a, news.death);
    if (!a.dead) {
      explore(this, a);
      if (this.tick > a.spawnedAt && (this.tick - a.spawnedAt) % B.aliveScoreEveryTicks === 0) addScore(this, a, 1);
    }
    checkAchievements(this, a);
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

  stationNear(a: Agent, kind: string): boolean {
    for (const [i, s] of this.structures) {
      if (s.kind !== kind || dist(this.xy(i), [a.x, a.y]) > B.stationRange) continue;
      if (kind !== 'campfire' || s.litUntil > this.tick) return true;
    }
    return false;
  }

  /** Campfires (and robots carrying torches at night) keep monsters from appearing. */
  lit(x: number, y: number): boolean {
    for (const [i, s] of this.structures) if (s.kind === 'campfire' && s.litUntil > this.tick && dist(this.xy(i), [x, y]) <= B.campfireLight) return true;
    if (timeOf(this.tick).phase !== 'night') return false;
    for (const a of this.agents.values()) if (a.joined && !a.dead && (a.inventory.torch ?? 0) > 0 && dist([a.x, a.y], [x, y]) <= B.torchLight) return true;
    return false;
  }

  structureViews(): StructureView[] {
    return [...this.structures].map(([i, s]) => {
      const crop: [string, number] | null = s.crop ? [s.crop.kind, Math.min(1, 1 - (s.crop.readyAt - this.tick) / (s.crop.kind === 'wheat' ? B.wheatTicks : B.berryCropTicks))] : null;
      return [...this.xy(i), s.kind, s.kind === 'campfire' && s.litUntil > this.tick, crop];
    });
  }

  creatureViews(): CreatureView[] {
    return [...this.creatures.values()].map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, hp: Math.max(0, Math.round(c.hp)), maxHp: CREATURES[c.kind].hp, mode: c.mode,
      face: c.mode === 'chase' && c.target ? this.targetPos(c.target) : null }));
  }

  /** Damage from a creature or robot; true when it was the killing blow. */
  hurt(a: Agent, damage: number, cause: string, by: string, alarm = true): boolean {
    if (a.dead) return false;
    damage *= 1 - armorOf(a);
    const fresh = this.tick - a.lastHurtAt > B.combatTicks;
    a.lastHurtAt = this.tick;
    a.health = Math.max(0, a.health - damage);
    this.dirty.add(a.id);
    if (a.health <= 0) {
      this.kill(a, cause, by);
      return true;
    }
    if (fresh && alarm) this.alarm(a, `${by} is attacking you!`);
    return false;
  }

  /** Danger stops calm tasks; walking away or fighting back keeps going. */
  alarm(a: Agent, reason: string): void {
    if (a.task?.type === 'move_to' || a.task?.type === 'attack' || a.task?.type === 'flee') this.note(a, reason);
    else this.interrupt(a, reason);
  }

  kill(a: Agent, cause: string, by = ''): void {
    a.dead = true;
    a.task = null;
    a.health = 0;
    a.lifeScore = 0;
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
    const buffet = (cause === 'starvation' || cause === 'hunger and thirst') && this.berriesNear(a.x, a.y, 3);
    if (buffet) this.bump(a, 'death:starved_at_buffet');
    this.emit('death', say(`death:${cause}`, a.name, this.rng, by) + (buffet ? BUFFET_SUFFIX : ''), a);
    this.note(a, `You died${by ? ` (${by})` : ` of ${cause}`}. You respawn in ${B.respawnTicks}s. Half your bag stayed behind.`);
  }

  respawn(a: Agent): void {
    a.dead = false;
    a.health = 100;
    a.food = B.respawnStats;
    a.water = B.respawnStats;
    a.energy = 100;
    [a.x, a.y] = this.bedOf(a) ?? a.spawn; // your bed, else your flag
    a.spawnedAt = this.tick;
    this.dirty.add(a.id);
    this.emit('respawn', say('respawn', a.name, this.rng), a);
    this.note(a, 'You respawned at your spawn point.');
    this.giveKit(a);
  }

  /** A node of this kind in sight that sits in someone else's base, if any. */
  lockedNear(a: Agent, kind: string): Vec | null {
    const r = this.vision(a);
    for (const [i, n] of this.nodes) {
      const [x, y] = this.xy(i);
      if (n.kind === kind && n.left > 0 && dist([x, y], [a.x, a.y]) <= r && this.baseAt(x, y) && this.baseAt(x, y)!.owner !== a.id) return [x, y];
    }
    return null;
  }

  /** A new unique username (the gateway checks format and manners). */
  rename(id: string, name: string): void {
    const a = this.get(id), lower = name.toLowerCase();
    if (a.name === name) return;
    for (const o of this.agents.values()) if (o.id !== id && o.name.toLowerCase() === lower) throw new GameFail('name_taken', `Someone already touches grass as "${name}".`, 'Pick another name.');
    const old = a.name;
    a.name = name;
    this.dirty.add(a.id);
    if (a.joined) this.emit('rename', `${old} is now ${name}.`, a);
  }

  /** What a robot holds: the tool for the job, else its weapon, else its best tool, else a torch at night. */
  heldOf(a: Agent): string | null {
    const t = a.task;
    if (a.dead || !a.inventory || t?.type === 'rest' || t?.type === 'sleep') return null; // a corrupt bag must not stop the tick
    if (t?.type === 'gather') {
      const kind = t.target === 'treasure' ? 'iron_vein' : this.nodes.get(t.node)?.kind;
      const tool = kind ? bestTool(a, kind)?.item : undefined;
      if (tool) return tool;
    }
    const weapon = weaponOf(a).name;
    if (weapon !== 'fists') return weapon;
    const tools = Object.keys(a.inventory).filter((i) => ITEMS[i]?.tool).sort((p, q) => (ITEMS[q].tool!.tier - ITEMS[p].tool!.tier));
    if (tools.length) return tools[0];
    return (a.inventory.torch ?? 0) > 0 && timeOf(this.tick).phase === 'night' ? 'torch' : null;
  }

  bedOf(a: Agent): Vec | null {
    for (const [i, s] of this.structures) if (s.kind === 'bed' && s.owner === a.id) return this.xy(i);
    return null;
  }

  baseAt(x: number, y: number): Base | null {
    for (const b of this.bases.values()) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return b;
    return null;
  }

  giveKit(a: Agent): void {
    if (!a.role) return;
    for (const [item, n] of Object.entries(KITS[a.role])) {
      if ((a.inventory[item] ?? 0) > 0) continue;
      if (addItem(a.inventory, item, n) && ITEMS[item].uses) a.wear[item] = ITEMS[item].uses!;
    }
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
        dead: a.dead, action: a.dead ? 'dead' : inDuel(this, a.id)?.ring != null ? 'attack' : (a.task?.type ?? 'idle'), online: a.online,
        bubble: a.bubble && a.bubble.until >= this.tick ? { kind: a.bubble.kind, text: a.bubble.text } : null,
        emote: a.emote && a.emote.until >= this.tick ? a.emote.name : null,
        badge: a.badge && a.badge.until >= this.tick ? a.badge.emoji : null,
        score: a.seasonScore,
        life: a.lifeScore,
        trophies: Object.keys(a.achievements).length,
        fighting: this.inCombat(a),
        inventory: publicBag(a.inventory),
        gold: a.wallet,
        face: this.faceOf(a),
        held: this.heldOf(a),
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

  emit(type: string, text: string, a?: Agent, other?: Agent): void {
    this.events.push({ tick: this.tick, type, text, agent: a?.id, x: a?.x, y: a?.y, ...(other ? { other: other.id } : {}) });
    if (type !== 'move') this.log(text);
  }

  /** World chat from a robot: a 'chat' event carrying the speaker's name. */
  chat(a: Agent, text: string): void {
    this.events.push({ tick: this.tick, type: 'chat', text, agent: a.id, name: a.name, x: a.x, y: a.y });
    this.log(`${a.name}: ${text}`);
  }

  log(line: string): void {
    this.chatLog.push(line);
    if (this.chatLog.length > B.chatLogKeep) this.chatLog.splice(0, this.chatLog.length - B.chatLogKeep);
  }

  bubble(a: Agent, kind: Bubble['kind'], text: string): void {
    a.bubble = { kind, text, until: this.tick + B.bubbleTicks };
    this.dirty.add(a.id);
  }

  bump(a: Agent, key: string): void {
    a.stats[key] = (a.stats[key] ?? 0) + 1;
  }

  touch(a: Agent): void {
    a.lastActionAt = Date.now();
    this.dirty.add(a.id);
  }

  /** Closest walkable tile, for robots stranded by terrain changes. */
  nearestWalkable(x: number, y: number): Vec {
    for (let r = 1; r < 128; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && walkable(this.at(x + dx, y + dy)) && this.at(x + dx, y + dy) !== T.SHALLOW && !this.solid(x + dx, y + dy)) return [x + dx, y + dy];
        }
      }
    }
    return this.plaza;
  }

  pickSpawn(): Vec {
    const [px, py] = this.plaza;
    for (let i = 0; i < 10000; i++) {
      const x = Math.floor(this.rng() * this.size), y = Math.floor(this.rng() * this.size);
      if (this.at(x, y) === T.MEADOW && !this.solid(x, y) && dist([x, y], [px, py]) >= B.spawnMinPlazaDist) return [x, y];
    }
    // ponytail: tiny test maps have no far meadow; first walkable tile is good enough there
    for (let i = 0; i < this.tiles.length; i++) {
      if (walkable(this.tiles[i]) && this.tiles[i] !== T.PLAZA) return [i % this.size, Math.floor(i / this.size)];
    }
    throw new Error('map has no walkable tiles');
  }
}

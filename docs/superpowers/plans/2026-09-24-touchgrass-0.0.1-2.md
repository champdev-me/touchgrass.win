# Touch Grass 0.0.1-2 "Don't Die" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Robots now have bodies. Food, water, health and energy drain and refill. Agents gather wood, berries, fiber and stone from real resource nodes, eat, drink, rest and sleep through a day/night cycle, and die and respawn with a dropped loot pile. The 3D spectator shows all of it.

**Architecture:** The engine gains four focused modules:
- `engine/agent.ts`: agent defaults and migration of old saves.
- `engine/body.ts`: needs, one tick at a time.
- `engine/nodes.ts`: resource nodes.
- `engine/tasks.ts`: the task runner.

`engine/observe.ts` builds what agents see, and `World` orchestrates them. Resource nodes are generated from terrain plus a tile hash (no seed needed), so the live 0.0.1-1 world is backfilled on its first load. Nodes are saved per chunk in Redis, sent to spectators with each chunk, and updated by per-tick deltas.

**Tech Stack:** unchanged from 0.0.1-1 (Bun 1.4.2, node-redis, MCP SDK web-standard transport, Three.js). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md` (release row 0.0.1-2; §8.2 Body, §8.4 Death, §9 Tasks and interrupts, §10.1 Resource nodes, §7 Time of day, §6.4 Rate limits).

**Deviations from the spec (Task 10 updates the spec):**
- The user does not want a Claude API example agent. It is replaced by a provider-neutral `examples/AGENT_PROMPT.md` that any MCP-capable LLM client can use.
- The 0.0.1-2 demo uses scripted survival bots plus whatever agents the user connects.
- In 0.0.1-2, resource nodes are trees, berry bushes, grass and rocks (spec §10.1 row "Gathering"). Wild wheat, iron, crystals, mushrooms and Wobble Weed arrive with the versions that use them.

## Global Constraints

- Bun ≥ 1.4 is the only runtime. Always write `.ts` extensions in relative imports, use `import type` for type-only imports, and **never use `any`**. Use named types, generics, or `unknown` with narrowing.
- Every tunable number lives in `shared/balance.ts`.
- All four stats run 0–100, and higher is better (spec §8.2): food −1 per 30 s, water −1 per 20 s, health +1 per 10 s when food and water are both above 50, health −1 per 5 s per empty stat, energy −1 per 10 s while busy, +1/s resting, +2/s sleeping. `drink()` adds 30.
- Death drops half of each stack (rounded up) as a loot pile that lasts 15 minutes. Respawn after 30 s at the spawn point.
- Inventory: 20 slots, stacks of 50. Gathering takes 2 ticks per unit, and Gatherers get 2× yield.
- A day is 1200 ticks, and the last 360 are night. Vision is halved (rounded up) at night.
- Do cooldown is 3 s when health < 30 or food < 15 or water < 15, otherwise 5 s. Failed actions and Look tools cost no cooldown.
- Code comments are at most 2 lines. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Commit and push to `main` after every task (standing user instruction).

## Review Focus

1. **Loading the live 0.0.1-1 world.** Old agent records lack body fields and there is no `nodes` hash yet. Loading must fill defaults (full stats, empty bag) and generate nodes, never crash. Pinned in Task 6 (`test/persist.test.ts` migration test).
2. **Two agents taking the last unit of one node in the same tick.** Exactly one gets it and the node never goes negative. Pinned in Task 5.
3. **A robot dying with an empty bag.** No empty loot pile appears. Pinned in Task 5.
4. **The only matching resource in sight is across deep water.** `gather` fails immediately with a clear error instead of starting a task that can never finish. Pinned in Task 5.
5. **Dead agents calling action tools.** They get a `dead` error with the respawn countdown and no cooldown, while `observe` keeps working. Pinned in Task 6.

---

## File Structure

```text
shared/
  balance.ts        + body, gathering, death, time numbers (Task 1)
  types.ts          + NodeKind, GatherTarget, PackedNode, Task union, Agent body fields, AgentView/TickDelta/chunk msg (Task 1)
  items.ts          NEW: FOOD table, inventory slots/room/add/take (Task 1)
  time.ts           NEW: timeOf(tick), daylight(tick) (Task 1)
  hash.ts           NEW: hash01(x, y), moved from web/src/props.ts (Task 1)
engine/
  agent.ts          NEW: AGENT_COLORS, normalizeAgent (Task 3)
  body.ts           NEW: tickBody, eat, eatBest (Task 3)
  nodes.ts          NEW: node kinds, generation, chunk packing (Task 2)
  tasks.ts          NEW: walk, findTarget, runTask (Task 5)
  observe.ts        NEW: buildObservation (Task 4)
  world.ts          REWRITTEN: orchestration, instant actions, death/respawn/loot (Tasks 4–5)
  actions.ts        + gather/eat/drink/rest/sleep/settings (Task 6)
  persist.ts        + nodes, loot, migration (Task 6)
  server.ts         + node generation for new worlds (Task 6)
gateway/
  mcp.ts            + 6 tools (Task 7)
  server.ts         + nodes in chunk messages (Task 7)
web/
  index.html        + stat bars, event feed styles/panel (Task 8)
  src/props.ts      REWRITTEN: render real nodes (Task 8)
  src/terrain.ts    + node state per chunk, live updates (Task 8)
  src/loot.ts       NEW: loot pile boxes (Task 8)
  src/robots.ts     + stat bars, animations per action (Task 8)
  src/ui.ts         + event feed, day/phase status (Task 8)
  src/main.ts       + day/night lighting, wiring (Task 8)
examples/
  scripted-bot.ts   survival brain (Task 9)
  AGENT_PROMPT.md   NEW: provider-neutral agent prompt (Task 10)
```

---

### Task 1: Shared foundations: balance, types, items, time, hash

**Files:**
- Modify: `shared/balance.ts`, `shared/types.ts`
- Create: `shared/items.ts`, `shared/time.ts`, `shared/hash.ts`
- Test: `shared/items.test.ts`, `shared/time.test.ts`

**Interfaces:**
- Produces:
  - `B` gains the body, gathering, death and time constants.
  - Types: `NODE_KINDS`, `NodeKind`, `GATHER_TARGETS`, `GatherTarget`, `PackedNode = [local, kindIndex, left, regrowAt]`, `Task` union (`move_to` | `gather` | `rest` | `sleep`), and `Agent` with `health, food, water, energy, inventory, dead, respawnAt, spawnedAt, autoEat, stats`.
  - `AgentView` gains `health, food, water, energy, dead, action`.
  - `TickDelta` gains `nodes: [number, number][]` and `loot: Vec[]`.
  - The `chunk` `ServerMsg` gains `nodes: PackedNode[]`.
  - `FOOD`, `FOOD_ITEMS`, `Inventory`, `slotsUsed(inv)`, `room(inv, item)`, `addItem(inv, item, n): number`, `takeItem(inv, item, n?): boolean`.
  - `Phase`, `timeOf(tick): { day, phase, secondsToSwitch, dayTick }`, `daylight(tick): number`.
  - `hash01(x, y): number`.

- [ ] **Step 1: Write the failing tests**

`shared/items.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { addItem, room, slotsUsed, takeItem, type Inventory } from './items.ts';

test('an empty bag fits 20 stacks of 50', () => {
  assert.equal(room({}, 'wood'), 1000);
});

test('partial stacks fill before new slots', () => {
  const inv: Inventory = { wood: 45 };
  assert.equal(slotsUsed(inv), 1);
  assert.equal(room(inv, 'wood'), 5 + 19 * 50);
  assert.equal(room(inv, 'stone'), 19 * 50);
});

test('addItem stops at capacity and takeItem clears empty stacks', () => {
  const inv: Inventory = {};
  for (let i = 0; i < 20; i++) addItem(inv, `item${i}`, 50);
  assert.equal(addItem(inv, 'wood', 3), 0);
  assert.equal(addItem(inv, 'item0', 1), 0);
  assert.equal(takeItem(inv, 'item0', 50), true);
  assert.equal('item0' in inv, false);
  assert.equal(takeItem(inv, 'item1', 51), false);
  assert.equal(addItem(inv, 'berries', 7), 7);
});
```

`shared/time.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { daylight, timeOf } from './time.ts';

test('a day is 14 minutes of light then 6 of night', () => {
  assert.deepEqual([timeOf(0).phase, timeOf(0).day], ['day', 1]);
  assert.equal(timeOf(839).phase, 'day');
  assert.equal(timeOf(839).secondsToSwitch, 1);
  assert.equal(timeOf(840).phase, 'night');
  assert.equal(timeOf(840).secondsToSwitch, 360);
  assert.deepEqual([timeOf(1200).phase, timeOf(1200).day], ['day', 2]);
});

test('daylight eases in at dawn and out at dusk', () => {
  assert.equal(daylight(0), 0);
  assert.equal(daylight(15), 0.5);
  assert.equal(daylight(500), 1);
  assert.equal(daylight(825), 0.5);
  assert.equal(daylight(900), 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test`
Expected: FAIL, cannot find modules `./items.ts` and `./time.ts`.

- [ ] **Step 3: Replace shared/balance.ts**

```ts
// Every tunable number lives here so a balance pass touches one file.
export const B = {
  mapSize: 1024,
  chunkSize: 32,
  tickMs: 1000,
  flushEveryTicks: 5,
  moveBudgetPerTick: 2, // a land step costs 1, shallow water 2
  pathRadius: 128,
  vision: 8,
  scoutVision: 15,
  nightVisionFactor: 0.5,
  plazaHalf: 20,
  spawnMinPlazaDist: 50,
  inboxMax: 20,
  doCooldownMs: 5000,
  lowStatCooldownMs: 3000,
  lookCooldownMs: 1000,
  maxActiveAgents: 200,
  activeWindowMs: 24 * 60 * 60 * 1000,
  chunkRequestsPerWindow: 400, // per spectator socket, enough to load a view and pan fast
  chunkWindowMs: 10_000,
  // body: every stat runs 0-100, higher is better
  foodPerTick: -1 / 30,
  waterPerTick: -1 / 20,
  regenPerTick: 1 / 10, // health, while food and water are both above regenAbove
  regenAbove: 50,
  starvePerTick: -1 / 5, // health, per empty stat
  busyEnergyPerTick: -1 / 10,
  restEnergyPerTick: 1,
  sleepEnergyPerTick: 2,
  lowStat: 15, // food/water: interrupts, auto-eat, faster cooldown
  lowHealth: 30,
  drinkAmount: 30,
  respawnStats: 70, // food and water after a respawn
  // gathering and inventory
  gatherTicksPerUnit: 2,
  gathererMultiplier: 2,
  inventorySlots: 20,
  stackSize: 50,
  gatherUntilFull: 9999,
  // death
  respawnTicks: 30,
  lootTicks: 900,
  speedrunTicks: 60,
  // time: a day is 20 minutes, the last 6 are night
  dayTicks: 1200,
  nightTicks: 360,
} as const;
```

- [ ] **Step 4: Update shared/types.ts**

Replace the `Task` interface and the `Agent`, `AgentView`, `TickDelta` and `ServerMsg` declarations, and add the node types after `Vec`:
```ts
export type Vec = [number, number];

export const NODE_KINDS = ['tree', 'berry_bush', 'grass', 'rock'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];
export const GATHER_TARGETS = [...NODE_KINDS, 'loot'] as const;
export type GatherTarget = (typeof GATHER_TARGETS)[number];

/** A resource node inside a chunk: [local tile index, NODE_KINDS index, units left, regrow tick]. */
export type PackedNode = [number, number, number, number];

export type Task =
  | { type: 'move_to'; target: Vec; path: Vec[] }
  | { type: 'gather'; target: GatherTarget; until: number; got: number; node: number; path: Vec[]; progress: number }
  | { type: 'rest' }
  | { type: 'sleep' };

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
}
```
```ts
export interface AgentView {
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
}
```
```ts
export interface TickDelta {
  tick: number;
  agents: AgentView[];
  events: GameEvent[];
  nodes: [number, number][]; // [global tile index, units left] changed this tick
  loot: Vec[]; // every loot pile currently on the map
}

export type ServerMsg =
  | { type: 'hello'; mapSize: number; chunkSize: number; plaza: Vec; tick: number }
  | { type: 'chunk'; cx: number; cy: number; data: string; nodes: PackedNode[] }
  | ({ type: 'tick' } & TickDelta);
```
(`TERRAIN`, `Terrain`, `ROLES`, `Role`, `GameError`, `ActionRequest`, `ActionResult`, `GameEvent` and `ClientMsg` stay unchanged.)

- [ ] **Step 5: Create shared/items.ts, shared/time.ts, shared/hash.ts**

`shared/items.ts`:
```ts
import { B } from './balance.ts';

export const FOOD: Record<string, { food: number; water: number }> = {
  berries: { food: 8, water: 2 },
  apple: { food: 10, water: 0 },
};
export const FOOD_ITEMS = Object.keys(FOOD);

export type Inventory = Record<string, number>;

export function slotsUsed(inv: Inventory): number {
  let slots = 0;
  for (const n of Object.values(inv)) slots += Math.ceil(n / B.stackSize);
  return slots;
}

/** How many of `item` still fit, topping up its partial stack first. */
export function room(inv: Inventory, item: string): number {
  const rest = (inv[item] ?? 0) % B.stackSize;
  return (rest ? B.stackSize - rest : 0) + (B.inventorySlots - slotsUsed(inv)) * B.stackSize;
}

export function addItem(inv: Inventory, item: string, n: number): number {
  const added = Math.max(0, Math.min(n, room(inv, item)));
  if (added) inv[item] = (inv[item] ?? 0) + added;
  return added;
}

export function takeItem(inv: Inventory, item: string, n = 1): boolean {
  if ((inv[item] ?? 0) < n) return false;
  inv[item] -= n;
  if (!inv[item]) delete inv[item];
  return true;
}
```

`shared/time.ts`:
```ts
import { B } from './balance.ts';

export type Phase = 'day' | 'night';

export function timeOf(tick: number) {
  const dayTick = tick % B.dayTicks;
  const nightStart = B.dayTicks - B.nightTicks;
  const phase: Phase = dayTick >= nightStart ? 'night' : 'day';
  const ticksLeft = phase === 'day' ? nightStart - dayTick : B.dayTicks - dayTick;
  return { day: Math.floor(tick / B.dayTicks) + 1, phase, secondsToSwitch: (ticksLeft * B.tickMs) / 1000, dayTick };
}

/** 1 at full day, 0 at full night; eases over 30 ticks at dawn and dusk. Fractional ticks are fine. */
export function daylight(tick: number): number {
  const t = tick % B.dayTicks, nightStart = B.dayTicks - B.nightTicks, ramp = 30;
  if (t < ramp) return t / ramp;
  if (t < nightStart - ramp) return 1;
  if (t < nightStart) return (nightStart - t) / ramp;
  return 0;
}
```

`shared/hash.ts`:
```ts
/** Stable 0..1 hash of a tile, so the engine and every client agree without sharing a seed. */
export function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
```

- [ ] **Step 6: Run the new tests**

Run: `bun test ./shared`
Expected: the items, time and geo tests pass (7 tests). `bunx tsc --noEmit` now reports errors in `engine/world.ts` and in `engine`/`test` files that build `Agent`, `AgentView` or `TickDelta`. Tasks 3–6 fix those, so don't commit a broken type-check.

- [ ] **Step 7: Commit (type-check intentionally deferred to Task 4)**

```bash
git add shared
git commit -m "feat(shared): body/time/gathering balance, items, day clock, node types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 2: Resource nodes

**Files:**
- Create: `engine/nodes.ts`
- Test: `engine/nodes.test.ts`

**Interfaces:**
- Consumes: `B`, `hash01`, `NODE_KINDS`, `NodeKind`, `PackedNode`, `TERRAIN`.
- Produces:
  - `ResourceNode = { kind: NodeKind; left: number; regrowAt: number }`
  - `NODE_DEF[kind] = { item, min, max, regrowTicks: number | null, bonus? }`
  - `nodeKindAt(terrain, x, y): NodeKind | null`
  - `fullAmount(kind, x, y): number`
  - `generateNodes(tiles, size): Map<number, ResourceNode>`
  - `packChunk(nodes, cx, cy, size): PackedNode[]`
  - `unpackChunk(nodes, cx, cy, packed, size): void`
  - `chunkOf(index, size): string` (returns `"cx,cy"`)

- [ ] **Step 1: Write the failing test**

`engine/nodes.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type NodeKind } from '../shared/types.ts';
import { NODE_DEF, chunkOf, generateNodes, nodeKindAt, packChunk, unpackChunk, type ResourceNode } from './nodes.ts';

const share = (t: number, kind: NodeKind) => {
  let c = 0;
  for (let i = 0; i < 10000; i++) if (nodeKindAt(t, i % 100, Math.floor(i / 100)) === kind) c++;
  return c / 10000;
};

test('nodes only grow where they belong and are deterministic', () => {
  for (let i = 0; i < 2000; i++) {
    const x = i % 100, y = Math.floor(i / 100);
    assert.equal(nodeKindAt(T.PLAZA, x, y), null);
    assert.equal(nodeKindAt(T.DEEP, x, y), null);
    assert.ok([null, 'tree', 'berry_bush'].includes(nodeKindAt(T.FOREST, x, y)));
    assert.ok([null, 'rock'].includes(nodeKindAt(T.HILLS, x, y)));
  }
  assert.equal(nodeKindAt(T.MEADOW, 17, 42), nodeKindAt(T.MEADOW, 17, 42));
});

test('forests are mostly trees; meadows have grass and berries', () => {
  assert.ok(Math.abs(share(T.FOREST, 'tree') - 0.4) < 0.03);
  assert.ok(share(T.MEADOW, 'grass') > 0.04);
  assert.ok(share(T.MEADOW, 'berry_bush') > 0.02);
});

test('fresh nodes are full and chunks pack and unpack losslessly', () => {
  const size = 64, tiles = new Uint8Array(size * size).fill(T.FOREST);
  const nodes = generateNodes(tiles, size);
  assert.ok(nodes.size > 1000);
  for (const n of nodes.values()) assert.ok(n.left >= NODE_DEF[n.kind].min && n.left <= NODE_DEF[n.kind].max);
  const first = nodes.get([...nodes.keys()][0])!;
  first.left = 0;
  first.regrowAt = 777;
  const back = new Map<number, ResourceNode>();
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) unpackChunk(back, cx, cy, packChunk(nodes, cx, cy, size), size);
  const sorted = (m: Map<number, ResourceNode>) => [...m].sort((a, b) => a[0] - b[0]);
  assert.deepEqual(sorted(back), sorted(nodes));
  assert.equal(chunkOf(size * 40 + 33, size), '1,1');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./engine/nodes.test.ts`
Expected: FAIL, cannot find module `./nodes.ts`.

- [ ] **Step 3: Implement engine/nodes.ts**

```ts
import { B } from '../shared/balance.ts';
import { hash01 } from '../shared/hash.ts';
import { NODE_KINDS, TERRAIN as T, type NodeKind, type PackedNode } from '../shared/types.ts';

export interface ResourceNode {
  kind: NodeKind;
  left: number;
  regrowAt: number; // tick; 0 while full or when it never regrows
}

export const NODE_DEF: Record<NodeKind, { item: string; min: number; max: number; regrowTicks: number | null; bonus?: { item: string; chance: number } }> = {
  tree: { item: 'wood', min: 3, max: 5, regrowTicks: 1800, bonus: { item: 'apple', chance: 0.1 } },
  berry_bush: { item: 'berries', min: 5, max: 5, regrowTicks: 600 },
  grass: { item: 'fiber', min: 3, max: 3, regrowTicks: 300 },
  rock: { item: 'stone', min: 3, max: 5, regrowTicks: null }, // stone is finite
};

/** Which node grows on a tile. Seedless, so worlds saved before nodes existed can be backfilled. */
export function nodeKindAt(t: number, x: number, y: number): NodeKind | null {
  const r = hash01(x, y);
  if (t === T.FOREST) return r < 0.4 ? 'tree' : r < 0.44 ? 'berry_bush' : null;
  if (t === T.MEADOW) return r < 0.02 ? 'tree' : r < 0.05 ? 'berry_bush' : r < 0.11 ? 'grass' : null;
  if (t === T.HILLS) return r < 0.12 ? 'rock' : null;
  return null;
}

export function fullAmount(kind: NodeKind, x: number, y: number): number {
  const d = NODE_DEF[kind];
  return d.min + Math.floor(hash01(y, x) * (d.max - d.min + 1));
}

export function generateNodes(tiles: Uint8Array, size: number): Map<number, ResourceNode> {
  const nodes = new Map<number, ResourceNode>();
  for (let i = 0; i < tiles.length; i++) {
    const x = i % size, y = Math.floor(i / size), kind = nodeKindAt(tiles[i], x, y);
    if (kind) nodes.set(i, { kind, left: fullAmount(kind, x, y), regrowAt: 0 });
  }
  return nodes;
}

export function packChunk(nodes: Map<number, ResourceNode>, cx: number, cy: number, size: number): PackedNode[] {
  const n = B.chunkSize, out: PackedNode[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const node = nodes.get((cy * n + j) * size + cx * n + i);
      if (node) out.push([j * n + i, NODE_KINDS.indexOf(node.kind), node.left, node.regrowAt]);
    }
  }
  return out;
}

export function unpackChunk(nodes: Map<number, ResourceNode>, cx: number, cy: number, packed: PackedNode[], size: number): void {
  const n = B.chunkSize;
  for (const [local, k, left, regrowAt] of packed) {
    nodes.set((cy * n + Math.floor(local / n)) * size + cx * n + (local % n), { kind: NODE_KINDS[k], left, regrowAt });
  }
}

export const chunkOf = (index: number, size: number): string =>
  `${Math.floor((index % size) / B.chunkSize)},${Math.floor(Math.floor(index / size) / B.chunkSize)}`;
```

- [ ] **Step 4: Run tests**

Run: `bun test ./engine/nodes.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add engine/nodes.ts engine/nodes.test.ts
git commit -m "feat(engine): seedless resource nodes with per-chunk packing" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 3: Agent defaults and the body

**Files:**
- Create: `engine/agent.ts`, `engine/body.ts`
- Test: `engine/body.test.ts`

**Interfaces:**
- Consumes: `B`, `FOOD`, `FOOD_ITEMS`, `takeItem`, `Agent`.
- Produces:
  - `AGENT_COLORS: string[]`
  - `normalizeAgent(a: Partial<Agent> & { id: string; name: string }): Agent`, which fills every missing field with its default.
  - `Activity = 'idle' | 'busy' | 'rest' | 'sleep'`
  - `BodyNews = { alerts: string[]; ate: string | null; death: string | null }`
  - `tickBody(a, activity): BodyNews`
  - `eat(a, item): void`
  - `eatBest(a): string | null`

- [ ] **Step 1: Write the failing test**

`engine/body.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { normalizeAgent } from './agent.ts';
import { tickBody } from './body.ts';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const bot = (over: Parameters<typeof normalizeAgent>[0] extends infer P ? Omit<P & object, 'id' | 'name'> : never = {}) =>
  normalizeAgent({ id: 'agent_1', name: 'Bot', ...over });

test('old records get full stats, an empty bag and auto-eat on', () => {
  const a = normalizeAgent({ id: 'agent_1', name: 'Old', x: 5, y: 6 });
  assert.deepEqual([a.health, a.food, a.water, a.energy, a.inventory, a.autoEat, a.dead, a.x], [100, 100, 100, 100, {}, true, false, 5]);
});

test('food drops 1 per 30 s and water 1 per 20 s', () => {
  const a = bot();
  for (let i = 0; i < 60; i++) tickBody(a, 'idle');
  assert.ok(near(a.food, 98) && near(a.water, 97), `${a.food} ${a.water}`);
});

test('empty stats hurt and full stats heal', () => {
  const a = bot({ food: 0, water: 0, health: 50 });
  tickBody(a, 'idle');
  assert.ok(near(a.health, 49.6), `${a.health}`);
  const b = bot({ health: 50 });
  tickBody(b, 'idle');
  assert.ok(near(b.health, 50.1), `${b.health}`);
});

test('energy drains while busy and refills while resting or sleeping', () => {
  const a = bot({ energy: 50 });
  tickBody(a, 'busy');
  assert.ok(near(a.energy, 49.9));
  tickBody(a, 'rest');
  assert.ok(near(a.energy, 50.9));
  tickBody(a, 'sleep');
  assert.ok(near(a.energy, 52.9));
});

test('auto-eat eats the cheapest food when starving, unless turned off', () => {
  const a = bot({ food: 15, inventory: { apple: 1, berries: 2 } });
  const news = tickBody(a, 'idle');
  assert.equal(news.ate, 'berries');
  assert.deepEqual(a.inventory, { apple: 1, berries: 1 });
  assert.deepEqual(news.alerts, []);
  const b = bot({ food: 15, autoEat: false, inventory: { berries: 2 } });
  const quiet = tickBody(b, 'idle');
  assert.equal(quiet.ate, null);
  assert.deepEqual(quiet.alerts, ['You are starving. Eat something.']);
});

test('warnings fire once, when a line is crossed', () => {
  const a = bot({ water: 15, autoEat: false });
  assert.deepEqual(tickBody(a, 'idle').alerts, ['You are very thirsty. Drink next to water.']);
  assert.deepEqual(tickBody(a, 'idle').alerts, []);
});

test('health reaching zero reports the cause', () => {
  assert.equal(tickBody(bot({ food: 0, water: 60, health: 0.1 }), 'idle').death, 'starvation');
  assert.equal(tickBody(bot({ food: 60, water: 0, health: 0.1 }), 'idle').death, 'thirst');
  assert.equal(tickBody(bot({ food: 0, water: 0, health: 0.3 }), 'idle').death, 'hunger and thirst');
  assert.equal(tickBody(bot(), 'idle').death, null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./engine/body.test.ts`
Expected: FAIL, cannot find module `./agent.ts`.

- [ ] **Step 3: Implement engine/agent.ts and engine/body.ts**

`engine/agent.ts`:
```ts
import type { Agent } from '../shared/types.ts';

export const AGENT_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3'];

const DEFAULTS: Omit<Agent, 'id' | 'name'> = {
  color: '#cccccc', role: null, model: null, joined: false, x: 0, y: 0, spawn: [0, 0], createdAt: 0, lastActionAt: 0,
  task: null, inbox: [], health: 100, food: 100, water: 100, energy: 100, inventory: {}, dead: false, respawnAt: 0,
  spawnedAt: 0, autoEat: true, stats: {},
};

/** Fills fields added after an agent was first saved, so records from older versions keep loading. */
export function normalizeAgent(a: Partial<Agent> & { id: string; name: string }): Agent {
  return { ...DEFAULTS, inventory: {}, stats: {}, inbox: [], ...a };
}
```

`engine/body.ts`:
```ts
import { B } from '../shared/balance.ts';
import { FOOD, FOOD_ITEMS, takeItem } from '../shared/items.ts';
import type { Agent } from '../shared/types.ts';

export type Activity = 'idle' | 'busy' | 'rest' | 'sleep';
export interface BodyNews {
  alerts: string[];
  ate: string | null;
  death: string | null;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function eat(a: Agent, item: string): void {
  takeItem(a.inventory, item);
  a.food = clamp(a.food + FOOD[item].food);
  a.water = clamp(a.water + FOOD[item].water);
}

/** Eats the lowest-value food carried; returns what was eaten. */
export function eatBest(a: Agent): string | null {
  const item = FOOD_ITEMS.filter((f) => (a.inventory[f] ?? 0) > 0).sort((p, q) => FOOD[p].food - FOOD[q].food)[0];
  if (!item) return null;
  eat(a, item);
  return item;
}

/** One tick of needs. Alerts fire once, on the tick a stat crosses its warning line. */
export function tickBody(a: Agent, activity: Activity): BodyNews {
  const before = { food: a.food, water: a.water, health: a.health };
  a.food = clamp(a.food + B.foodPerTick);
  a.water = clamp(a.water + B.waterPerTick);
  const empty = (a.food === 0 ? 1 : 0) + (a.water === 0 ? 1 : 0);
  if (empty) a.health = clamp(a.health + B.starvePerTick * empty);
  else if (a.food > B.regenAbove && a.water > B.regenAbove) a.health = clamp(a.health + B.regenPerTick);
  const energy = { idle: 0, busy: B.busyEnergyPerTick, rest: B.restEnergyPerTick, sleep: B.sleepEnergyPerTick }[activity];
  a.energy = clamp(a.energy + energy);

  const ate = a.autoEat && a.food < B.lowStat ? eatBest(a) : null;

  const alerts: string[] = [];
  const crossed = (was: number, now: number, line: number) => was >= line && now < line;
  if (crossed(before.food, a.food, B.lowStat)) alerts.push('You are starving. Eat something.');
  if (crossed(before.water, a.water, B.lowStat)) alerts.push('You are very thirsty. Drink next to water.');
  if (crossed(before.health, a.health, B.lowHealth)) alerts.push('Your health is low.');
  const death = a.health > 0 ? null : a.food === 0 && a.water === 0 ? 'hunger and thirst' : a.food === 0 ? 'starvation' : 'thirst';
  return { alerts, ate, death };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test ./engine/body.test.ts`
Expected: 7 pass. If the `bot()` helper's parameter type trips the checker in Task 4's type-check, simplify it to `(over: Partial<Agent> = {})` with `import type { Agent }`. The behavior is the same.

- [ ] **Step 5: Commit**

```bash
git add engine/agent.ts engine/body.ts engine/body.test.ts
git commit -m "feat(engine): agent defaults and body needs with auto-eat and alerts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 4: World core, observe, and instant actions

**Files:**
- Rewrite: `engine/world.ts`
- Create: `engine/observe.ts`, `engine/tasks.ts` (full version; Task 5 adds its tests)
- Modify: `engine/world.test.ts` (add tests; existing ones stay)

**Interfaces:**
- Consumes: Tasks 1–3, `findPath`, `tileAt`, `walkable`, `stepCost`.
- Produces:
  - `World` gains fields `nodes`, `depleted`, `dirtyChunks`, `nodeChanges`, `loot: Map<number, LootPile>`, `lootDirty`.
  - `World` gains methods: `index(x,y)`, `xy(i)`, `vision(a)`, `nearWater(x,y)`, `gather(id, target, until?)`, `eatItem(id, item)`, `drink(id)`, `rest(id)`, `sleep(id)`, `settings(id, autoEat)`, `cooldownFor(id)`, `alive(id)`, `finish(a, msg)`, `interrupt(a, reason)`, `bump(a, key)`, `takeFromNode(i, node)`, `dropLoot(i, items)`, `kill(a, cause)`, `respawn(a)`.
  - `step()` now runs tasks, body, death, regrowth and loot expiry.
  - `LootPile = { items: Inventory; expiresAt: number }`
  - `buildObservation(w, a)` returns `you` (with stats, inventory, slots, dead, respawn countdown), `task`, `time`, `grid`, `legend`, `nearby`, `resources`, `landmarks`, `inbox`, `roles`.
  - `tasks.ts`: `walk(w, a, path): boolean`, `findTarget(w, a, target): { index, path } | null`, `runTask(w, a): Activity`.

- [ ] **Step 1: Add the failing world tests**

Append to `engine/world.test.ts`:
```ts
test('new agents start healthy with an empty bag', () => {
  const w = worldOf(open(10));
  const a = w.register('Fresh', 0);
  assert.deepEqual([a.health, a.food, a.water, a.energy, a.inventory, a.autoEat], [100, 100, 100, 100, {}, true]);
});

test('observe shows stats, time, resources and drink spots', () => {
  const w = worldOf(Array.from({ length: 20 }, (_, y) => (y === 15 ? '~'.repeat(20) : '.'.repeat(20))));
  const a = joined(w, 'Looker', [10, 10]);
  w.nodes.set(w.index(12, 10), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  const o = w.observe(a.id);
  assert.equal(o.grid.map((r) => r.split(' '))[8][10], '*');
  assert.match(o.resources[0], /^berry_bush \(5 left\) at \(12, 10\), 2 tiles E$/);
  assert.ok(o.resources.some((r) => /^drink spot at \(\d+, 14\)/.test(r)), o.resources.join(' | '));
  assert.deepEqual([o.you.health, o.you.food, o.you.slots, o.time.phase], [100, 100, '0/20', 'day']);
});

test('vision halves at night', () => {
  const w = worldOf(open(30));
  const a = joined(w, 'Owl', [15, 15]);
  w.tick = 900;
  assert.equal(w.observe(a.id).grid.length, 9);
  assert.equal(w.observe(a.id).time.phase, 'night');
});

test('eat and drink need the right conditions', () => {
  const w = worldOf(['...~', '....', '....', '....']);
  const a = joined(w, 'Snacker', [0, 3]);
  assert.equal(failCode(() => w.eatItem(a.id, 'berries')), 'not_carrying');
  assert.equal(failCode(() => w.eatItem(a.id, 'wood')), 'not_food');
  assert.equal(failCode(() => w.drink(a.id)), 'no_water');
  a.inventory = { berries: 1 };
  a.food = 50;
  a.water = 50;
  w.eatItem(a.id, 'berries');
  assert.deepEqual([a.food, a.water, a.inventory], [58, 52, {}]);
  [a.x, a.y] = [2, 0];
  w.drink(a.id);
  assert.equal(a.water, 82);
});

test('settings toggles auto-eat', () => {
  const w = worldOf(open(5));
  const a = joined(w);
  assert.deepEqual(w.settings(a.id, false), { auto_eat: false });
  assert.deepEqual(w.settings(a.id, 'nope'), { auto_eat: false });
  assert.equal(a.autoEat, false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./engine/world.test.ts`
Expected: FAIL, e.g. `w.nodes` is undefined / `w.index is not a function`.

- [ ] **Step 3: Create engine/tasks.ts**

```ts
import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, room } from '../shared/items.ts';
import type { Agent, GatherTarget, Task, Vec } from '../shared/types.ts';
import type { Activity } from './body.ts';
import { NODE_DEF } from './nodes.ts';
import { findPath } from './path.ts';
import { stepCost } from './terrain.ts';
import type { World } from './world.ts';

type GatherTask = Extract<Task, { type: 'gather' }>;

/** Walks along `path` within this tick's budget (halved at zero energy). */
export function walk(w: World, a: Agent, path: Vec[]): boolean {
  let budget: number = a.energy <= 0 ? 1 : B.moveBudgetPerTick;
  let moved = false;
  while (budget > 0 && path.length) {
    const [nx, ny] = path[0];
    const cost = stepCost(w.at(nx, ny));
    if (cost > budget && moved) break; // finish the slow step next tick
    path.shift();
    a.x = nx;
    a.y = ny;
    budget -= cost;
    moved = true;
  }
  return moved;
}

const available = (w: World, i: number, target: GatherTarget): boolean =>
  target === 'loot' ? w.loot.has(i) : w.nodes.get(i)?.kind === target && (w.nodes.get(i)?.left ?? 0) > 0;

/** Nearest reachable target in vision; tries the 5 closest so water between us doesn't stall. */
export function findTarget(w: World, a: Agent, target: GatherTarget): { index: number; path: Vec[] } | null {
  const r = w.vision(a);
  const found: { index: number; d: number }[] = [];
  for (let y = a.y - r; y <= a.y + r; y++) {
    for (let x = a.x - r; x <= a.x + r; x++) {
      if (x < 0 || y < 0 || x >= w.size || y >= w.size) continue;
      const i = w.index(x, y);
      if (available(w, i, target)) found.push({ index: i, d: dist([x, y], [a.x, a.y]) });
    }
  }
  found.sort((p, q) => p.d - q.d);
  for (const f of found.slice(0, 5)) {
    const path = findPath(w.at, [a.x, a.y], w.xy(f.index), r + 2);
    if (path) return { index: f.index, path };
  }
  return null;
}

export function runTask(w: World, a: Agent): Activity {
  const task = a.task;
  if (!task) return 'idle';
  switch (task.type) {
    case 'move_to':
      walk(w, a, task.path);
      if (!task.path.length) w.finish(a, `Task done: arrived at (${a.x}, ${a.y}).`);
      return 'busy';
    case 'rest':
    case 'sleep':
      if (a.energy >= 100) {
        w.finish(a, task.type === 'rest' ? 'Task done: fully rested.' : 'Task done: slept like a log. A metal log.');
        return 'idle';
      }
      return task.type;
    case 'gather':
      return gatherStep(w, a, task);
  }
}

function gatherStep(w: World, a: Agent, t: GatherTask): Activity {
  if (!available(w, t.node, t.target)) {
    const next = findTarget(w, a, t.target);
    if (!next) {
      w.finish(a, t.got ? `Task done: gathered ${t.got}; no more ${t.target} in sight.` : `Task done: no ${t.target} in sight.`);
      return 'idle';
    }
    t.node = next.index;
    t.path = next.path;
    t.progress = 0;
  }
  if (t.path.length) {
    walk(w, a, t.path);
    return 'busy';
  }
  if (++t.progress < B.gatherTicksPerUnit) return 'busy';
  t.progress = 0;
  return t.target === 'loot' ? pickUpLoot(w, a, t) : harvest(w, a, t);
}

function harvest(w: World, a: Agent, t: GatherTask): Activity {
  const node = w.nodes.get(t.node)!;
  const def = NODE_DEF[node.kind];
  const got = addItem(a.inventory, def.item, a.role === 'gatherer' ? B.gathererMultiplier : 1);
  if (!got) {
    w.interrupt(a, 'Your bag is full.');
    return 'idle';
  }
  w.takeFromNode(t.node, node);
  t.got += got;
  w.bump(a, `gather:${def.item}`);
  if (def.bonus && w.rng() < def.bonus.chance && addItem(a.inventory, def.bonus.item, 1)) w.note(a, `Bonus: a ${def.bonus.item} fell out!`);
  if (t.got >= t.until) w.finish(a, `Task done: gathered ${t.got} ${def.item}.`);
  else if (room(a.inventory, def.item) === 0) w.interrupt(a, 'Your bag is full.');
  return 'busy';
}

function pickUpLoot(w: World, a: Agent, t: GatherTask): Activity {
  const pile = w.loot.get(t.node)!;
  let taken = 0;
  for (const [item, n] of Object.entries(pile.items)) {
    const got = addItem(a.inventory, item, n);
    taken += got;
    if (n - got > 0) pile.items[item] = n - got;
    else delete pile.items[item];
  }
  if (!Object.keys(pile.items).length) w.loot.delete(t.node);
  w.lootDirty = true;
  if (taken) w.finish(a, `Task done: picked up ${taken} items from the pile.`);
  else w.interrupt(a, 'Your bag is full.');
  return 'busy';
}
```

- [ ] **Step 4: Create engine/observe.ts**

```ts
import { B } from '../shared/balance.ts';
import { compass, dist } from '../shared/geo.ts';
import { slotsUsed } from '../shared/items.ts';
import { timeOf } from '../shared/time.ts';
import { TERRAIN as T, type Agent, type NodeKind, type Task, type Vec } from '../shared/types.ts';
import type { World } from './world.ts';

const GRID: Record<number, string> = { [T.DEEP]: '~', [T.SHALLOW]: ',', [T.SAND]: ':', [T.MEADOW]: '.', [T.FOREST]: 'f', [T.HILLS]: '^', [T.RUINS]: 'r', [T.PLAZA]: '#' };
const NODE_CHAR: Record<NodeKind, string> = { tree: 'T', berry_bush: '*', grass: '"', rock: 'o' };
const LEGEND: Record<string, string> = {
  '@': 'you', '~': 'deep water (blocked)', ',': 'shallow water (slow)', ':': 'sand', '.': 'meadow', f: 'forest', '^': 'hills',
  r: 'ruins', '#': 'the Plaza', T: 'tree (wood)', '*': 'berry bush (berries)', '"': 'grass (fiber)', o: 'rock (stone)',
  $: 'loot pile', 'A-Z': 'other agents',
};
const TERRAIN_NAME: Record<number, string> = { [T.DEEP]: 'deep water', [T.SHALLOW]: 'shallow water', [T.SAND]: 'sand', [T.MEADOW]: 'meadow', [T.FOREST]: 'forest', [T.HILLS]: 'hills', [T.RUINS]: 'ruins', [T.PLAZA]: 'the Plaza' };

const describeTask = (t: Task | null) => {
  if (!t) return null;
  if (t.type === 'move_to') return { type: t.type, target: t.target, steps_left: t.path.length };
  if (t.type === 'gather') return { type: t.type, target: t.target, got: t.got, until: t.until === B.gatherUntilFull ? 'bag full' : t.until };
  return { type: t.type };
};

export function buildObservation(w: World, a: Agent) {
  const r = w.vision(a);
  const here: Vec = [a.x, a.y];
  const where = (x: number, y: number) => `at (${x}, ${y}), ${dist([x, y], here)} tiles ${compass(x - a.x, y - a.y)}`;
  const others = [...w.agents.values()]
    .filter((o) => o.joined && o.id !== a.id && dist([o.x, o.y], here) <= r)
    .sort((p, q) => dist([p.x, p.y], here) - dist([q.x, q.y], here));
  const legend: Record<string, string> = { ...LEGEND };
  const marks = new Map<string, string>();
  others.forEach((o, i) => {
    const ch = String.fromCharCode(65 + (i % 26));
    marks.set(`${o.x},${o.y}`, ch);
    legend[ch] = legend[ch] ? `${legend[ch]}, ${o.id} ${o.name}` : `${o.id} ${o.name}`;
  });

  const grid: string[] = [];
  const nearest = new Map<string, { d: number; line: string }[]>();
  const offer = (key: string, d: number, line: string) => (nearest.get(key) ?? nearest.set(key, []).get(key)!).push({ d, line });
  for (let y = a.y - r; y <= a.y + r; y++) {
    const row: string[] = [];
    for (let x = a.x - r; x <= a.x + r; x++) {
      const i = x >= 0 && y >= 0 && x < w.size && y < w.size ? w.index(x, y) : -1;
      const node = i >= 0 ? w.nodes.get(i) : undefined;
      const d = dist([x, y], here);
      if (node && node.left > 0) offer(node.kind, d, `${node.kind} (${node.left} left) ${where(x, y)}`);
      if (i >= 0 && w.loot.has(i)) offer('loot', d, `loot pile ${where(x, y)}`);
      if (i >= 0 && w.at(x, y) !== T.DEEP && w.nearWater(x, y)) offer('water', d, `drink spot ${where(x, y)}`);
      row.push(
        x === a.x && y === a.y ? '@'
          : marks.get(`${x},${y}`) ?? (i >= 0 && w.loot.has(i) ? '$' : node && node.left > 0 ? NODE_CHAR[node.kind] : GRID[w.at(x, y)]),
      );
    }
    grid.push(row.join(' '));
  }
  const resources = [...nearest.values()].flatMap((list) => list.sort((p, q) => p.d - q.d).slice(0, 2)).sort((p, q) => p.d - q.d).map((e) => e.line);

  const time = timeOf(w.tick);
  const [px, py] = w.plaza;
  const inbox = a.inbox;
  a.inbox = [];
  if (inbox.length) w.dirty.add(a.id);
  return {
    you: {
      id: a.id, name: a.name, role: a.role, model: a.model, pos: here, standing_on: TERRAIN_NAME[w.at(a.x, a.y)],
      health: Math.round(a.health), food: Math.round(a.food), water: Math.round(a.water), energy: Math.round(a.energy),
      inventory: a.inventory, slots: `${slotsUsed(a.inventory)}/${B.inventorySlots}`, auto_eat: a.autoEat,
      dead: a.dead, respawn_in_seconds: a.dead ? Math.max(0, a.respawnAt - w.tick) : undefined,
    },
    task: describeTask(a.task),
    time: { day: time.day, phase: time.phase, [time.phase === 'day' ? 'seconds_to_night' : 'seconds_to_day']: time.secondsToSwitch },
    tick: w.tick,
    grid,
    legend,
    nearby: others.map((o) => `${o.id} ${o.name} (${o.role}${o.model ? `, ${o.model}` : ''})${o.dead ? ' (dead)' : ''} ${dist([o.x, o.y], here)} tiles ${compass(o.x - a.x, o.y - a.y)}`),
    resources,
    landmarks: [`the Plaza (${px}, ${py}) is ${dist([px, py], here)} tiles ${compass(px - a.x, py - a.y)}`],
    inbox,
    roles: w.census(),
  };
}
```

- [ ] **Step 5: Rewrite engine/world.ts**

```ts
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
        const t = this.at(x + dx, y + dy);
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
```

- [ ] **Step 6: Run the world tests and the type-check**

Run: `bun test ./engine/world.test.ts && bunx tsc --noEmit`
Expected: all world tests pass (8 old and 5 new). tsc may still flag `engine/actions.ts` (no changes yet) and `test/*.ts`, both of which Task 6 fixes. Fix any error inside `world.ts`, `observe.ts` or `tasks.ts` now.

- [ ] **Step 7: Commit**

```bash
git add engine/world.ts engine/observe.ts engine/tasks.ts engine/world.test.ts
git commit -m "feat(engine): world orchestrates body, nodes and tasks; observe shows stats, time and resources" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 5: Tasks, interrupts, death and respawn

**Files:**
- Test: `engine/tasks.test.ts` (new). `engine/tasks.ts` and `engine/world.ts` already contain the code from Task 4. This task proves it and fixes whatever the tests expose.

**Interfaces:**
- Consumes: `World` API and `tasks.ts` from Task 4.
- Produces: verified behavior for gathering, regrowth, contention, interrupts, sleep/dawn, death, loot, respawn and cooldowns.

- [ ] **Step 1: Write the tests**

`engine/tasks.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { GameFail, World } from './world.ts';

function worldOf(rows: string[]): World {
  const code: Record<string, number> = { '.': T.MEADOW, '~': T.DEEP, ',': T.SHALLOW };
  const n = rows.length, tiles = new Uint8Array(n * n);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { tiles[y * n + x] = code[ch]; }));
  return new World(tiles, n, () => 0.99); // rng 0.99: no bonus apples
}
const open = (n: number) => Array.from({ length: n }, () => '.'.repeat(n));
function joined(w: World, name: string, at: Vec, role: 'gatherer' | 'scout' = 'scout') {
  const a = w.register(name, 0);
  w.join(a.id, role, null);
  [a.x, a.y] = at;
  return a;
}
const bush = (w: World, x: number, y: number, left = 5) => w.nodes.set(w.index(x, y), { kind: 'berry_bush', left, regrowAt: 0 });
const steps = (w: World, n: number) => { for (let i = 0; i < n; i++) w.step(); };
const failCode = (fn: () => unknown) => {
  try { fn(); return 'ok'; } catch (e) { return (e as GameFail).code; }
};

test('gather walks to the nearest node, harvests every 2 ticks, and stops at until', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Picker', [0, 0]);
  bush(w, 2, 0);
  w.gather(a.id, 'berry_bush', 3);
  steps(w, 7);
  assert.deepEqual([a.x, a.y, a.inventory.berries, w.nodes.get(w.index(2, 0))!.left, a.task], [2, 0, 3, 2, null]);
  assert.equal(w.observe(a.id).inbox.at(-1), 'Task done: gathered 3 berries.');
  assert.equal(a.stats['gather:berries'], 3);
});

test('a gatherer gets double yield from the same node', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Pro', [2, 0], 'gatherer');
  bush(w, 2, 0);
  w.gather(a.id, 'berry_bush', 4);
  steps(w, 4);
  assert.deepEqual([a.inventory.berries, w.nodes.get(w.index(2, 0))!.left], [4, 3]);
});

test('bushes regrow after their regrow time; rocks never do', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Miner', [1, 1]);
  bush(w, 1, 1, 1);
  w.nodes.set(w.index(3, 1), { kind: 'rock', left: 1, regrowAt: 0 });
  w.gather(a.id, 'berry_bush');
  steps(w, 3);
  assert.equal(w.nodes.get(w.index(1, 1))!.left, 0);
  w.gather(a.id, 'rock');
  steps(w, 5);
  assert.equal(w.nodes.get(w.index(3, 1))!.left, 0);
  steps(w, 600);
  assert.equal(w.nodes.get(w.index(1, 1))!.left, 5);
  assert.equal(w.nodes.get(w.index(3, 1))!.left, 0);
});

test('two agents cannot both take the last unit', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Left', [1, 0]);
  const b = joined(w, 'Right', [3, 0]);
  bush(w, 2, 0, 1);
  w.gather(a.id, 'berry_bush');
  w.gather(b.id, 'berry_bush');
  steps(w, 4);
  assert.equal((a.inventory.berries ?? 0) + (b.inventory.berries ?? 0), 1);
  assert.equal(w.nodes.get(w.index(2, 0))!.left, 0);
});

test('gather fails fast when the only target is across deep water', () => {
  const w = worldOf(['.~.', '.~.', '.~.']);
  const a = joined(w, 'Stuck', [0, 0]);
  bush(w, 2, 1);
  assert.equal(failCode(() => w.gather(a.id, 'berry_bush')), 'none_nearby');
  assert.equal(failCode(() => w.gather(a.id, 'unicorn')), 'bad_target');
  assert.equal(a.task, null);
});

test('a full bag interrupts gathering', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Hoarder', [2, 0]);
  for (let i = 0; i < 19; i++) a.inventory[`junk${i}`] = 50;
  a.inventory.berries = 49;
  bush(w, 2, 0);
  w.gather(a.id, 'berry_bush', 5);
  steps(w, 2);
  assert.equal(a.inventory.berries, 50);
  assert.equal(a.task, null);
  assert.equal(w.observe(a.id).inbox.at(-1), 'Task interrupted: Your bag is full.');
  assert.equal(failCode(() => w.gather(a.id, 'berry_bush')), 'bag_full');
});

test('rest refills energy; the sun wakes sleepers at dawn', () => {
  const w = worldOf(open(5));
  const a = joined(w, 'Sleepy', [1, 1]);
  a.energy = 95;
  w.rest(a.id);
  steps(w, 6);
  assert.deepEqual([a.energy, a.task], [100, null]);
  w.tick = 1199;
  a.energy = 10;
  w.sleep(a.id);
  const d = w.step();
  assert.equal(a.task, null);
  assert.ok(d.events.some((e) => e.type === 'dawn'));
  assert.equal(w.observe(a.id).inbox.at(-1), 'Task interrupted: The sun woke you up.');
});

test('dusk is announced and low food interrupts the current task', () => {
  const w = worldOf(open(40));
  const a = joined(w, 'Hungry', [0, 0]);
  a.food = 15.01;
  a.autoEat = false;
  w.moveTo(a.id, 30, 30);
  w.tick = 839;
  const d = w.step();
  assert.ok(d.events.some((e) => e.type === 'dusk'));
  assert.equal(a.task, null);
  assert.equal(w.observe(a.id).inbox.at(-1), 'Task interrupted: You are starving. Eat something.');
  assert.equal(w.cooldownFor(a.id), 3000);
});

test('death drops half the bag as loot; respawn restores the robot at its spawn', () => {
  const w = worldOf(open(10));
  const a = joined(w, 'Doomed', [3, 3]);
  bush(w, 4, 4);
  Object.assign(a, { health: 0.1, food: 0, water: 50, autoEat: false, inventory: { wood: 5, berries: 1 }, spawnedAt: 0 });
  const d = w.step();
  assert.equal(a.dead, true);
  assert.deepEqual(a.inventory, { wood: 2 });
  assert.deepEqual(w.loot.get(w.index(3, 3))!.items, { wood: 3, berries: 1 });
  assert.deepEqual(d.loot, [[3, 3]]);
  assert.match(d.events.find((e) => e.type === 'death')!.text, /Doomed starved/);
  assert.ok(a.stats['death:starvation'] && a.stats['death:speedrun'] && a.stats['death:starved_at_buffet']);
  assert.equal(failCode(() => w.moveTo(a.id, 1, 1)), 'dead');
  assert.equal(w.observe(a.id).you.respawn_in_seconds, 30);
  steps(w, 30);
  assert.deepEqual([a.dead, a.health, a.food, a.x, a.y], [false, 100, 70, ...a.spawn]);
});

test('dying with an empty bag leaves no loot pile, and piles can be picked up', () => {
  const w = worldOf(open(10));
  const empty = joined(w, 'Empty', [5, 5]);
  Object.assign(empty, { health: 0.1, food: 0, autoEat: false });
  w.step();
  assert.equal(w.loot.size, 0);
  w.dropLoot(w.index(3, 3), { wood: 3, berries: 1 });
  const b = joined(w, 'Looter', [3, 2]);
  w.gather(b.id, 'loot');
  steps(w, 3);
  assert.deepEqual([b.inventory, w.loot.size], [{ wood: 3, berries: 1 }, 0]);
});
```

- [ ] **Step 2: Run them**

Run: `bun test ./engine/tasks.test.ts`
Expected: 10 pass. Where one fails, trace it with superpowers:systematic-debugging and fix `engine/tasks.ts` or `engine/world.ts`, not the test (the numbers come from the spec). Two known subtleties:
- The last-unit test depends on `gatherStep` re-checking `available()` at the start of every tick.
- The dusk test needs `interrupt()` to run after `runTask` within the same tick.

- [ ] **Step 3: Run the whole unit suite**

Run: `bun test ./shared ./engine`
Expected: everything except `engine/actions.test.ts` passes. Its `unknown_tool` hint changes in Task 6.

- [ ] **Step 4: Commit**

```bash
git add engine
git commit -m "test(engine): gathering, regrowth, contention, interrupts, dawn, death, loot and respawn" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 6: Dispatcher, persistence and migration

**Files:**
- Modify: `engine/actions.ts`, `engine/persist.ts`, `engine/server.ts`
- Test: `engine/actions.test.ts` (add), `test/persist.test.ts` (update and add)

**Interfaces:**
- Consumes: the World API from Tasks 4–5, and `generateNodes`/`packChunk`/`unpackChunk` from Task 2.
- Produces:
  - Tools: `gather {target, until?}`, `eat {item}`, `drink {}`, `rest {}`, `sleep {}` (Do); `settings {auto_eat?}` (Look). Do cooldowns come from `world.cooldownFor`.
  - Redis gains the `nodes` hash (field `cx,cy` → `JSON(PackedNode[])`) and the `loot` string (`JSON([index, LootPile][])`).
  - `saveAllNodes(r, w)`.
  - `loadWorld` backfills missing nodes and normalizes agents.

- [ ] **Step 1: Add the failing tests**

Append to `engine/actions.test.ts`:
```ts
test('survival tools are wired and a low stat shortens the cooldown to 3 s', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'gatherer' } });
  const a = w.agents.get(id)!;
  a.inventory = { berries: 2 };
  a.water = 10;
  const ate = handleAction(w, { agentId: id, tool: 'eat', args: { item: 'berries' } });
  assert.deepEqual([ate.ok, ate.cooldownMs], [true, 3000]);
  const dry = handleAction(w, { agentId: id, tool: 'drink', args: {} });
  assert.deepEqual([dry.ok, dry.cooldownMs, !dry.ok && dry.error.error], [false, 0, 'no_water']);
  a.x = 4;
  const drank = handleAction(w, { agentId: id, tool: 'drink', args: {} });
  assert.deepEqual([drank.ok, drank.cooldownMs], [true, 5000]);
  const set = handleAction(w, { agentId: id, tool: 'settings', args: { auto_eat: false } });
  assert.deepEqual([set.ok && set.data, set.cooldownMs], [{ auto_eat: false }, 0]);
  assert.equal(handleAction(w, { agentId: id, tool: 'rest', args: {} }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'sleep', args: {} }).ok, true);
  const none = handleAction(w, { agentId: id, tool: 'gather', args: { target: 'rock' } });
  assert.equal(!none.ok && none.error.error, 'none_nearby');
});

test('the dead can only look', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } });
  const a = w.agents.get(id)!;
  a.dead = true;
  a.respawnAt = w.tick + 10;
  const move = handleAction(w, { agentId: id, tool: 'move_to', args: { x: 1, y: 1 } });
  assert.deepEqual([move.ok, move.cooldownMs, !move.ok && move.error.error], [false, 0, 'dead']);
  const look = handleAction(w, { agentId: id, tool: 'observe', args: {} });
  assert.equal(look.ok, true);
});
```

Replace `test/persist.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { K, flush, loadWorld, saveAllNodes, saveTerrain } from '../engine/persist.ts';
import { World } from '../engine/world.ts';
import { connectRedis } from '../shared/redis.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { redisUrl } from './helpers.ts';

test('flush then load restores terrain, agents, nodes, loot and counters; walking is cancelled', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  assert.equal(await loadWorld(r), null);
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  tiles[3] = T.DEEP;
  const w = new World(tiles, 64, () => 0.5);
  w.nodes.set(w.index(10, 10), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const a = w.register('Saver', 0);
  w.join(a.id, 'builder', null);
  w.moveTo(a.id, 0, 20);
  w.step();
  w.takeFromNode(w.index(10, 10), w.nodes.get(w.index(10, 10))!);
  w.dropLoot(w.index(5, 5), { wood: 2 });
  await flush(r, w);
  assert.deepEqual([w.dirty.size, w.dirtyChunks.size, w.lootDirty], [0, 0, false]);

  const back = (await loadWorld(r))!;
  assert.deepEqual(back.tiles, tiles);
  assert.deepEqual([back.tick, back.nextId, back.size], [1, 2, 64]);
  const b = back.agents.get(a.id)!;
  assert.deepEqual([b.x, b.y, b.task, b.role, b.health], [0, 2, null, 'builder', a.health]);
  assert.equal(b.inbox.at(-1), 'Task cancelled: the universe rebooted.');
  assert.equal(back.nodes.get(back.index(10, 10))!.left, 4);
  assert.deepEqual(back.loot.get(back.index(5, 5))!.items, { wood: 2 });
  await r.close();
});

test('a world saved by 0.0.1-1 loads with default stats and backfilled nodes', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.FOREST);
  await saveTerrain(r, tiles, 64);
  await r.hSet(K.meta, { tick: '42', nextId: '2', mapSize: '64', season: '1' });
  const old = { id: 'agent_1', name: 'Grass Inspector', color: '#e6194b', role: 'scout', model: 'x', joined: true, x: 9, y: 9, spawn: [9, 9], createdAt: 1, lastActionAt: 1, task: null, inbox: [] };
  await r.hSet(K.agents, 'agent_1', JSON.stringify(old));

  const w = (await loadWorld(r))!;
  const a = w.agents.get('agent_1')!;
  assert.deepEqual([a.health, a.food, a.water, a.energy, a.inventory, a.dead, a.autoEat], [100, 100, 100, 100, {}, false, true]);
  assert.ok(w.nodes.size > 500, `nodes ${w.nodes.size}`);
  assert.equal(w.dirtyChunks.size, 4);
  assert.ok(w.observe('agent_1').grid.length > 0);
  await flush(r, w);
  assert.equal(Object.keys(await r.hGetAll(K.nodes)).length, 4);
  await r.close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./engine/actions.test.ts; bun run test:int`
Expected: FAIL. `eat`/`drink`/`settings` return `unknown_tool`, and `saveAllNodes` is not exported.

- [ ] **Step 3: Replace engine/actions.ts**

```ts
import { ROLES, type ActionRequest, type ActionResult, type Role } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

const DO_TOOLS = new Set(['join_game', 'move_to', 'gather', 'eat', 'drink', 'rest', 'sleep']);

export function handleAction(world: World, req: ActionRequest): ActionResult {
  try {
    const data = run(world, req);
    return { ok: true, data, cooldownMs: DO_TOOLS.has(req.tool) ? world.cooldownFor(req.agentId) : 0 };
  } catch (e) {
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  }
}

function run(world: World, { agentId, tool, args }: ActionRequest): unknown {
  const withView = (result: object) => ({ ...result, observe: world.observe(agentId) });
  switch (tool) {
    case 'join_game': {
      const role = args.role as Role;
      if (!ROLES.includes(role)) throw new GameFail('bad_role', 'That is not a job.', `Pick one of: ${ROLES.join(', ')}.`);
      world.join(agentId, role, typeof args.model === 'string' ? args.model.slice(0, 40) : null);
      return { ...world.observe(agentId), message: 'Welcome to Touch Grass. Try not to die immediately.' };
    }
    case 'observe':
      return world.observe(agentId);
    case 'move_to':
      return withView({ ...world.moveTo(agentId, Number(args.x), Number(args.y)), message: 'Your robot starts walking with great confidence.' });
    case 'gather':
      return withView({ ...world.gather(agentId, String(args.target), typeof args.until === 'number' ? args.until : undefined), message: 'Your robot rolls up its sleeves. It has no sleeves.' });
    case 'eat':
      return withView({ ...world.eatItem(agentId, String(args.item)), message: 'Nom. Robots should not need this, yet here we are.' });
    case 'drink':
      return withView({ ...world.drink(agentId), message: 'Glug. Hydrated circuits.' });
    case 'rest':
      return withView({ ...world.rest(agentId), message: 'You sit down and contemplate the grass.' });
    case 'sleep':
      return withView({ ...world.sleep(agentId), message: 'Zzz. You dream of electric sheep.' });
    case 'settings':
      return world.settings(agentId, args.auto_eat);
    default:
      throw new GameFail('unknown_tool', `There is no "${tool}" in this world.`, 'Use join_game, observe, move_to, gather, eat, drink, rest, sleep or settings.');
  }
}
```
Then change the `unknown_tool` assertion's expectation in the existing `failures explain themselves` test only if it compared the hint (it compares only the code, so no edit is needed).

- [ ] **Step 4: Replace engine/persist.ts**

```ts
import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import type { Agent, PackedNode } from '../shared/types.ts';
import { normalizeAgent } from './agent.ts';
import { generateNodes, packChunk, unpackChunk } from './nodes.ts';
import { chunkBytes, writeChunk } from './terrain.ts';
import { World, type LootPile } from './world.ts';

export const K = { meta: 'meta', terrain: 'terrain', agents: 'agents', nodes: 'nodes', loot: 'loot' } as const;

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
  w.dirty.clear();
  w.dirtyChunks.clear();
  w.lootDirty = false;
  try {
    await m.exec();
  } catch (e) {
    for (const id of ids) w.dirty.add(id);
    for (const key of chunks) w.dirtyChunks.add(key);
    w.lootDirty ||= lootWasDirty;
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
  return w;
}
```

- [ ] **Step 5: Generate nodes for brand-new worlds in engine/server.ts**

In `startEngine`, replace the new-world branch:
```ts
    const size = o.size ?? B.mapSize;
    w = new World(generateTerrain(o.seed, size), size);
    w.nodes = generateNodes(w.tiles, size);
    await saveTerrain(r, w.tiles, size);
    await saveAllNodes(r, w);
    await flush(r, w);
    console.log(`[engine] generated a new ${size}x${size} world from seed "${o.seed}" with ${w.nodes.size} resource nodes`);
```
and update the imports:
```ts
import { flush, loadWorld, saveAgentNow, saveAllNodes, saveTerrain } from './persist.ts';
import { generateNodes } from './nodes.ts';
```

- [ ] **Step 6: Run everything**

Run: `bun run test && bun run test:int && bunx tsc --noEmit`
Expected: all unit tests pass. The integration tests pass, including both persist tests, and the engine restart test still passes. tsc is clean for the server project. If `test/e2e.test.ts` fails because tool replies now include body fields, that's fine: it only reads fields that still exist. Fix anything else before committing.

- [ ] **Step 7: Commit**

```bash
git add engine test
git commit -m "feat(engine): survival tools, node/loot persistence, migration of 0.0.1-1 worlds" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 7: Gateway: MCP tools and node-aware chunks

**Files:**
- Modify: `gateway/mcp.ts`, `gateway/server.ts`
- Test: `test/e2e.test.ts` (add)

**Interfaces:**
- Consumes: the engine tools from Task 6, and the Redis `nodes` hash.
- Produces: 9 MCP tools, and `chunk` messages that carry `nodes: PackedNode[]`.

- [ ] **Step 1: Add the failing e2e test**

Append to `test/e2e.test.ts`, before the final engine-down test:
```ts
test('survival tools are exposed over MCP and chunks carry resource nodes', async () => {
  const { body } = await signup('Survivor', '5.5.5.5');
  const c = await mcp(body.token);
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['drink', 'eat', 'gather', 'join_game', 'move_to', 'observe', 'rest', 'settings', 'sleep']);
  await call(c, 'join_game', { role: 'gatherer' });
  const s = await call(c, 'settings', { auto_eat: false });
  assert.equal((s.data as unknown as { auto_eat: boolean }).auto_eat, false);

  const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`);
  const msgs: ServerMsg[] = [];
  ws.addEventListener('message', (e) => msgs.push(JSON.parse(String(e.data)) as ServerMsg));
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  ws.send(JSON.stringify({ type: 'chunks', list: [[3, 3]] }));
  await sleep(500);
  const chunk = msgs.find((m): m is ChunkMsg => m.type === 'chunk')!;
  assert.ok(Array.isArray(chunk.nodes));
  const tick = msgs.find((m) => m.type === 'tick');
  assert.ok(tick && tick.type === 'tick' && Array.isArray(tick.loot) && tick.agents.every((a) => typeof a.health === 'number'));
  ws.close();
  await c.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:int`
Expected: FAIL. The tool list only has 3 names, and `chunk.nodes` is undefined.

- [ ] **Step 3: Register the tools in gateway/mcp.ts**

Add `import { FOOD_ITEMS } from '../shared/items.ts';`, change the types import to `import { GATHER_TARGETS, ROLES, type GameError } from '../shared/types.ts';`, and replace the `observe` and `move_to` registrations and everything after them (up to `return s;`) with:
```ts
  s.registerTool('observe', {
    description: 'Look around: your health/food/water/energy (0-100, higher is better), bag, current task, time of day, an ASCII map (see legend), nearby agents, the nearest resources and drink spots with coordinates, and your inbox of events since your last call. Free, max 1 call per second.',
    inputSchema: {},
  }, () => reply('observe', {}, 'look'));

  s.registerTool('move_to', {
    description: `Start walking to tile (x, y). Your robot pathfinds and keeps walking between your calls: 2 tiles/s on land, 1 in shallow water, never through deep water; half speed at 0 energy. Target must be within ${B.pathRadius} tiles. Costs an action cooldown (${B.doCooldownMs / 1000}s, ${B.lowStatCooldownMs / 1000}s when a stat is low).`,
    inputSchema: { x: z.number().int().min(0).max(B.mapSize - 1), y: z.number().int().min(0).max(B.mapSize - 1) },
  }, (args) => reply('move_to', args, 'do'));

  s.registerTool('gather', {
    description: 'Walk to the nearest target in sight and harvest it, repeating until you hold "until" more items (default: until your bag is full) or none are left in sight. tree = wood (sometimes an apple), berry_bush = berries, grass = fiber, rock = stone, loot = a dead robot\'s dropped items. 2 seconds per unit; gatherers get double. Costs an action cooldown.',
    inputSchema: { target: z.enum(GATHER_TARGETS), until: z.number().int().min(1).max(999).optional() },
  }, (args) => reply('gather', args, 'do'));

  s.registerTool('eat', {
    description: 'Eat one food item from your bag: berries (+8 food, +2 water) or apple (+10 food). Instant. Costs an action cooldown.',
    inputSchema: { item: z.enum(FOOD_ITEMS as [string, ...string[]]) },
  }, (args) => reply('eat', args, 'do'));

  s.registerTool('drink', {
    description: `Drink (+${B.drinkAmount} water). You must stand in or next to water; observe lists drink spots. Instant. Costs an action cooldown.`,
    inputSchema: {},
  }, () => reply('drink', {}, 'do'));

  s.registerTool('rest', {
    description: 'Sit down and recover 1 energy per second until full or interrupted. Costs an action cooldown.',
    inputSchema: {},
  }, () => reply('rest', {}, 'do'));

  s.registerTool('sleep', {
    description: 'Sleep: 2 energy per second until full. The sun wakes you at dawn; hunger and thirst wake you too. Costs an action cooldown.',
    inputSchema: {},
  }, () => reply('sleep', {}, 'do'));

  s.registerTool('settings', {
    description: 'Read or change your reflexes. auto_eat (default on) eats your cheapest food when food drops below 15. Free.',
    inputSchema: { auto_eat: z.boolean().optional() },
  }, (args) => reply('settings', args, 'look'));

  return s;
```
Also bump `new McpServer({ name: 'touchgrass', version: '0.0.1-2' })`.

- [ ] **Step 4: Send nodes with chunks in gateway/server.ts**

Add `PackedNode` to the types import, and in the websocket `message` handler replace the terrain lookup and send:
```ts
          const key = `${cx},${cy}`;
          const [data, nodes] = await Promise.all([r.hGet('terrain', key), r.hGet('nodes', key)]);
          if (data) ws.send(JSON.stringify({ type: 'chunk', cx, cy, data, nodes: nodes ? (JSON.parse(nodes) as PackedNode[]) : [] }));
```

- [ ] **Step 5: Run the suites**

Run: `bun run test:int && bun run test && bunx tsc --noEmit`
Expected: all pass (13 integration tests).

- [ ] **Step 6: Commit**

```bash
git add gateway test
git commit -m "feat(gateway): gather/eat/drink/rest/sleep/settings tools; chunks carry resource nodes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 8: Spectator: real nodes, stats, loot, events, day and night

**Files:**
- Modify: `web/index.html`, `web/src/props.ts`, `web/src/terrain.ts`, `web/src/robots.ts`, `web/src/ui.ts`, `web/src/main.ts`
- Create: `web/src/loot.ts`

**Interfaces:**
- Consumes: `ServerMsg` with `chunk.nodes`, `TickDelta.nodes/loot`, `AgentView` stats, `daylight`, `hash01`.
- Produces: the visible 0.0.1-2 world. There are no automated tests (WebGL); it is verified in Chrome in Step 8.

- [ ] **Step 1: Styles and event panel in web/index.html**

Inside `<style>`, add:
```css
  .tag .name { text-align: center; }
  .tag .bars { display: flex; gap: 2px; margin-top: 2px; justify-content: center; }
  .tag .bar { width: 20px; height: 3px; background: rgba(255, 255, 255, 0.18); border-radius: 2px; overflow: hidden; }
  .tag .bar i { display: block; height: 100%; }
  .tag .bar.hp i { background: #ff5a5a; } .tag .bar.food i { background: #ffae42; }
  .tag .bar.water i { background: #4fb3ff; } .tag .bar.energy i { background: #ffe14d; }
  .tag.dead { opacity: 0.55; text-decoration: line-through; }
  #events { bottom: 58px; right: 12px; width: min(360px, calc(100vw - 50px)); max-height: 30vh; overflow: hidden; font-size: 12px; }
  #events div { padding: 2px 0; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
```
and after the `#agents` panel add:
```html
<div id="events" class="panel"><b>What just happened</b><div id="event-list"></div></div>
```

- [ ] **Step 2: Replace web/src/props.ts**

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hash01 } from '../../shared/hash.ts';
import { NODE_KINDS, type NodeKind } from '../../shared/types.ts';
import { heightOf } from './tiles.ts';

export type Models = Map<string, THREE.Mesh[]>;
/** A chunk's nodes: local tile index -> [NODE_KINDS index, units left]. */
export type ChunkNodes = Map<number, [number, number]>;

const NAMES = ['tree_default', 'tree_oak', 'tree_pineRoundA', 'plant_bush', 'grass_large', 'stone_largeA'];
const TREES = ['tree_default', 'tree_oak', 'tree_pineRoundA'];
const MODEL: Record<NodeKind, (x: number, y: number) => string> = {
  tree: (x, y) => TREES[Math.floor(hash01(x, y) * TREES.length)],
  berry_bush: () => 'plant_bush',
  grass: () => 'grass_large',
  rock: () => 'stone_largeA',
};
const SCALE: Record<NodeKind, number> = { tree: 1, berry_bush: 1.6, grass: 1.2, rock: 1 };
const berryGeo = new THREE.SphereGeometry(0.06, 6, 4);
const berryMat = new THREE.MeshLambertMaterial({ color: '#d62246' });
const BERRY_OFFSETS = [[0.12, 0.3, 0.05], [-0.1, 0.26, 0.1], [0.02, 0.34, -0.12]];

export async function loadProps(): Promise<Models> {
  const loader = new GLTFLoader(), out: Models = new Map();
  await Promise.all(NAMES.map(async (n) => {
    const g = await loader.loadAsync(`/assets/${n}.glb`);
    g.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    g.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.material instanceof THREE.MeshStandardMaterial) o.material.metalness = 0; // glTF defaults to metallic, which renders black without an env map
      meshes.push(o);
    });
    out.set(n, meshes);
  }));
  return out;
}

/** One InstancedMesh per model part per chunk keeps draw calls low. Empty nodes are not drawn. */
export function buildProps(models: Models, tiles: Uint8Array, nodes: ChunkNodes, n: number, x0: number, y0: number): THREE.Group {
  const byModel = new Map<string, THREE.Matrix4[]>();
  const berries: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [local, [k, left]] of nodes) {
    if (left <= 0) continue;
    const kind = NODE_KINDS[k], x = x0 + (local % n), y = y0 + Math.floor(local / n);
    const r = hash01(y, x), s = SCALE[kind] * (0.85 + r * 0.3);
    q.setFromAxisAngle(up, r * Math.PI * 2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, heightOf(tiles[local]), y + 0.5), q, new THREE.Vector3(s, s, s));
    const name = MODEL[kind](x, y);
    (byModel.get(name) ?? byModel.set(name, []).get(name)!).push(m);
    if (kind === 'berry_bush') for (const [bx, by, bz] of BERRY_OFFSETS) berries.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(bx, by, bz)));
  }
  const group = new THREE.Group(), tmp = new THREE.Matrix4();
  for (const [name, mats] of byModel) {
    for (const mesh of models.get(name) ?? []) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
      mats.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, mesh.matrixWorld)));
      group.add(inst);
    }
  }
  if (berries.length) {
    const inst = new THREE.InstancedMesh(berryGeo, berryMat, berries.length);
    berries.forEach((m, i) => inst.setMatrixAt(i, m));
    group.add(inst);
  }
  return group;
}
```

- [ ] **Step 3: Track nodes per chunk in web/src/terrain.ts**

Change the imports to:
```ts
import { TERRAIN as T, type PackedNode, type Vec } from '../../shared/types.ts';
import { buildProps, type ChunkNodes, type Models } from './props.ts';
```
Add fields to `ChunkView`:
```ts
  nodes = new Map<string, ChunkNodes>();
  stale = new Set<string>();
```
Replace `add`:
```ts
  add(cx: number, cy: number, b64: string, packed: PackedNode[]): void {
    const key = `${cx},${cy}`;
    this.tiles.set(key, Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    this.nodes.set(key, new Map(packed.map(([local, k, left]) => [local, [k, left] as [number, number]])));
  }

  /** Applies per-tick node changes ([global tile index, units left]); affected chunks re-render soon. */
  applyNodes(changes: [number, number][]): void {
    for (const [i, left] of changes) {
      const x = i % B.mapSize, y = Math.floor(i / B.mapSize);
      const key = `${Math.floor(x / this.n)},${Math.floor(y / this.n)}`;
      const entry = this.nodes.get(key)?.get((y % this.n) * this.n + (x % this.n));
      if (!entry) continue;
      entry[1] = left;
      if (this.meshes.has(key)) this.stale.add(key);
    }
  }
```
In `update`, after the loop that builds new chunks and before the request line, add:
```ts
    for (const key of this.stale) {
      if (built >= BUILDS_PER_FRAME) break;
      this.stale.delete(key);
      const g = this.meshes.get(key);
      if (!g) continue;
      const [cx, cy] = key.split(',').map(Number);
      const old = g.children[1];
      g.remove(old);
      old.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      g.add(buildProps(this.models, this.tiles.get(key)!, this.nodes.get(key) ?? new Map(), this.n, cx * this.n, cy * this.n));
      built++;
    }
```
In `build`, pass the nodes:
```ts
    g.add(buildProps(this.models, tiles, this.nodes.get(key) ?? new Map(), this.n, x0, y0));
```

- [ ] **Step 4: Create web/src/loot.ts**

```ts
import * as THREE from 'three';
import type { Vec } from '../../shared/types.ts';

const geo = new THREE.BoxGeometry(0.35, 0.25, 0.35);
const mat = new THREE.MeshLambertMaterial({ color: '#8b5a2b' });

export class LootView {
  group = new THREE.Group();
  key = '';
  heightAt: (x: number, y: number) => number;

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number) {
    this.heightAt = heightAt;
    scene.add(this.group);
  }

  sync(piles: Vec[]): void {
    const key = piles.map((p) => p.join(',')).join(';');
    if (key === this.key) return;
    this.key = key;
    this.group.clear();
    for (const [x, y] of piles) {
      const box = new THREE.Mesh(geo, mat);
      box.position.set(x + 0.5, this.heightAt(x, y) + 0.12, y + 0.5);
      this.group.add(box);
    }
  }
}
```

- [ ] **Step 5: Stat bars and per-action animation in web/src/robots.ts**

Add `bars: HTMLElement[]` to the `Bot` interface. In `spawn`, replace the tag construction with:
```ts
    const tag = document.createElement('div');
    tag.className = 'tag';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = v.model ? `${v.name} · ${v.model}` : v.name;
    const barRow = document.createElement('div');
    barRow.className = 'bars';
    const bars = ['hp', 'food', 'water', 'energy'].map((cls) => {
      const bar = document.createElement('span');
      bar.className = `bar ${cls}`;
      const fill = document.createElement('i');
      bar.append(fill);
      barRow.append(bar);
      return fill;
    });
    tag.append(name, barRow);
```
and after the `actions` map is built:
```ts
    for (const once of ['Death', 'Sitting']) {
      const act = b.actions.get(once);
      if (act) {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
    }
```
(add `bars` to the `b` object literal). In `sync`, replace the `this.play(...)` line with:
```ts
      [v.health, v.food, v.water, v.energy].forEach((val, i) => { b.bars[i].style.width = `${val}%`; });
      b.tag.classList.toggle('dead', v.dead);
      const walking = v.moving || b.from.distanceToSquared(b.to) > 1e-4;
      this.play(b, v.dead ? 'Death' : walking ? 'Walking' : v.action === 'gather' ? 'Punch' : v.action === 'rest' || v.action === 'sleep' ? 'Sitting' : 'Idle');
```

- [ ] **Step 6: Event feed and phase status in web/src/ui.ts**

Add the `GameEvent` type import, and inside `setupUi` add:
```ts
  const feed = $('event-list');
  const shown: string[] = [];
```
and add to the returned object:
```ts
    events: (events: GameEvent[]) => {
      for (const e of events) if (e.type !== 'move') shown.unshift(e.text);
      shown.length = Math.min(shown.length, 8);
      feed.replaceChildren(...shown.map((t) => Object.assign(document.createElement('div'), { textContent: t })));
    },
```

- [ ] **Step 7: Wire it up with day/night lighting in web/src/main.ts**

Imports:
```ts
import { daylight, timeOf } from '../../shared/time.ts';
import { LootView } from './loot.ts';
```
Name the lights and add the colors (replace the two `scene.add(new THREE.HemisphereLight(...))` / `sun` lines):
```ts
const hemi = new THREE.HemisphereLight('#e4f4ff', '#4a6b3a', 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d0', 1.8);
sun.position.set(-0.4, 1, -0.25);
scene.add(sun);
const SKY_DAY = new THREE.Color('#9fd3ff'), SKY_NIGHT = new THREE.Color('#0b1733');
const SUN_DAY = new THREE.Color('#fff1d0'), SUN_NIGHT = new THREE.Color('#8fa8ff');
let lastTick = 0, lastTickAt = performance.now();
```
After `chunks` is created:
```ts
const loot = new LootView(scene, (x, y) => chunks.heightAt(x, y));
```
Replace the `send = connect(...)` handler body:
```ts
send = connect((m: ServerMsg) => {
  if (m.type === 'hello') {
    chunks.reset();
    lastTick = m.tick;
    lastTickAt = performance.now();
  } else if (m.type === 'chunk') {
    chunks.add(m.cx, m.cy, m.data, m.nodes);
  } else {
    lastTick = m.tick;
    lastTickAt = performance.now();
    robots.sync(m.agents);
    chunks.applyNodes(m.nodes);
    loot.sync(m.loot);
    ui.agents(m.agents);
    ui.events(m.events);
    const t = timeOf(m.tick);
    ui.status(`day ${t.day} · ${t.phase} · ${m.agents.length} robots`);
  }
}, (s) => ui.status(s));
```
In the animation loop, before `renderer.render(...)`, add:
```ts
  const light = daylight(lastTick + (performance.now() - lastTickAt) / B.tickMs);
  hemi.intensity = 0.3 + light;
  sun.intensity = 0.15 + light * 1.65;
  sun.color.lerpColors(SUN_NIGHT, SUN_DAY, light);
  (scene.background as THREE.Color).lerpColors(SKY_NIGHT, SKY_DAY, light);
  scene.fog!.color.lerpColors(SKY_NIGHT, SKY_DAY, light);
```

- [ ] **Step 8: Build, type-check, and verify in Chrome**

Run: `bun run build:web && bun run typecheck`
Expected: clean.

Then, with Redis running:
```bash
docker exec tg-redis redis-cli -n 1 flushdb
REDIS_URL=redis://localhost:6379/1 bun run engine      # shell 1: generates world + nodes
REDIS_URL=redis://localhost:6379/1 SIGNUP_PER_IP_PER_DAY=100 bun run gateway   # shell 2
rm -f examples/.bots.json; BOTS=5 bun run bots        # shell 3 (Task 9 makes them survive; wandering is enough here)
```
Open `http://localhost:3000`, activate the tab (background tabs pause rendering), and check:
- Trees, berry bushes with red berries, grass and rocks appear where the engine put them.
- Each name tag has 4 bars.
- The event feed shows joins.

Then check night: stop the engine (Ctrl-C, which flushes), run `docker exec tg-redis redis-cli -n 1 hset meta tick 830`, start the engine again, and within ~20 s the scene should fade to blue night, with `night` in the status. Take a screenshot of day and of night, and confirm there are no console errors.

- [ ] **Step 9: Commit**

```bash
git add web
git commit -m "feat(web): real resource nodes, loot piles, stat bars, action animations, event feed, day/night" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 9: Scripted bots that survive

**Files:**
- Modify: `examples/scripted-bot.ts`

**Interfaces:**
- Consumes: the MCP tools and the `observe` shape from Tasks 4–7.
- Produces: bots that drink, eat, gather, sleep at night and wander. They are the load and demo agents.

- [ ] **Step 1: Replace the reply type and the inner loop of examples/scripted-bot.ts**

Replace the `Reply` type:
```ts
type Reply = {
  you: { pos: Vec; food: number; water: number; energy: number; dead: boolean; inventory: Record<string, number> };
  task: unknown;
  time: { phase: string };
  resources: string[];
} & GameError;
```
Replace the inner `for (;;) { ... }` loop body in `runBot` with:
```ts
      for (;;) {
        await sleep(5500 + Math.random() * 2000);
        const o = await call(c, 'observe');
        if (o.error || o.data.you.dead || o.data.task) continue;
        const me = o.data.you;
        const spot = (kind: string) => {
          const m = o.data.resources.find((r) => r.startsWith(kind))?.match(/at \((\d+), (\d+)\)/);
          return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
        };
        let did = '';
        if (me.water < 50) {
          const d = await call(c, 'drink');
          did = d.error ? '' : 'drink';
          const place = spot('drink spot');
          if (!did && place) did = (await call(c, 'move_to', place)).error ? '' : 'walk to water';
        } else if (me.food < 60 && (me.inventory.berries ?? 0) > 0) {
          did = (await call(c, 'eat', { item: 'berries' })).error ? '' : 'eat';
        } else if (me.food < 70) {
          did = (await call(c, 'gather', { target: 'berry_bush', until: 6 })).error ? '' : 'gather berries';
        } else if (o.data.time.phase === 'night' && me.energy < 90) {
          did = (await call(c, 'sleep')).error ? '' : 'sleep';
        } else if (Math.random() < 0.4) {
          const target = ['tree', 'grass', 'rock'][Math.floor(Math.random() * 3)];
          did = (await call(c, 'gather', { target, until: 5 })).error ? '' : `gather ${target}`;
        }
        if (!did) {
          const [x, y] = me.pos;
          const clamp = (v: number) => Math.max(0, Math.min(1023, v));
          const m = await call(c, 'move_to', { x: clamp(x + Math.round((Math.random() - 0.5) * 60)), y: clamp(y + Math.round((Math.random() - 0.5) * 60)) });
          did = m.error ? `wander failed (${m.data.error})` : 'wander';
        }
        console.log(`bot ${i}: ${did} | food ${Math.round(me.food)} water ${Math.round(me.water)} energy ${Math.round(me.energy)}`);
      }
```

- [ ] **Step 2: Type-check and run against the local stack for 3 minutes**

Run: `bunx tsc --noEmit`, then with engine and gateway from Task 8 running: `rm -f examples/.bots.json; BOTS=5 bun run bots`
Expected: the logs show a mix of `wander`, `gather …`, `drink`/`walk to water` and `eat`. After ~3 min no bot's water is below 40 for long. In the browser, robots punch trees (gathering animation), and bushes lose their berries and regrow later.

- [ ] **Step 3: Commit**

```bash
git add examples/scripted-bot.ts
git commit -m "feat: scripted bots drink, eat, gather and sleep to survive" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 10: Agent prompt, README and spec sync

**Files:**
- Create: `examples/AGENT_PROMPT.md`
- Modify: `README.md`, `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`

**Interfaces:**
- Produces: a provider-neutral prompt anyone can paste into their MCP-capable agent, and a spec that matches what shipped.

- [ ] **Step 1: Create examples/AGENT_PROMPT.md**

```markdown
# Touch Grass agent prompt

Paste this as the system prompt of any LLM agent that has the Touch Grass MCP server connected
(see README → "Send your agent in"). It works with any provider.

---

You are a robot in Touch Grass, a persistent survival world shared with other AI agents and watched live by humans.
Your goal: stay alive, gather resources, and be interesting to watch. Mild chaos is welcome; cruelty is not.

How the world works:
- Call `observe` often; it is free (1 per second). It shows your health, food, water and energy (0-100, higher is better),
  your bag, your current task, the time of day, an ASCII map around you, the nearest resources and drink spots with
  coordinates, nearby agents, and an inbox of what happened since your last look.
- Action tools (`join_game`, `move_to`, `gather`, `eat`, `drink`, `rest`, `sleep`) start a task or act instantly, then put
  you on a short cooldown (5 s, or 3 s when a stat is low). Tasks keep running between your calls until they finish or are
  interrupted; check `observe` to see why something stopped.
- Food drops 1 every 30 s, water 1 every 20 s. At 0 you lose health. Health regenerates when food and water are above 50.
- Drink next to water (`drink`). Berries (+8 food) and apples (+10 food) are food. Auto-eat is on by default.
- `gather` harvests the nearest tree, berry_bush, grass, rock or loot pile in sight. Resources regrow; rocks do not.
- Nights last 6 minutes: vision halves. Sleep to restore energy; the sun wakes you.
- If you die you drop half your bag and respawn after 30 s.

First call `join_game` with a role (gatherer, hunter, builder, medic or scout) and your model name.
Then loop: observe → decide → one action → observe again. Explain your plan to yourself in one short sentence before
each action. Never spam action tools during a cooldown.
```

- [ ] **Step 2: Update README.md**

Replace step 3 of "Send your agent in" with:
```markdown
3. Give your agent the prompt in [`examples/AGENT_PROMPT.md`](examples/AGENT_PROMPT.md), then let it `join_game` and survive.
   Tools: `join_game`, `observe`, `move_to`, `gather`, `eat`, `drink`, `rest`, `sleep`, `settings`.
```

- [ ] **Step 3: Sync the spec**

In `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`:
- §3 row 0.0.1-2: replace `Claude example agent.` with `Provider-neutral agent prompt (examples/AGENT_PROMPT.md).` and its demo cell `3 Claude agents and 5 bots survive…` with `5 scripted survival bots plus user-connected agents survive a full day/night cycle; …` (keep the rest of the sentence).
- §3 row 0.0.1-3: `Claude example agent` does not appear there; no change.
- §5 key table: add the rows ``| `nodes` | hash | field `cx,cy` → JSON `[local, kind, left, regrowAt][]` resource nodes of that chunk |`` and ``| `loot` | string | JSON `[tileIndex, {items, expiresAt}][]` of all loot piles |``.
- §10.1: add a sentence after the table: `0.0.1-2 ships trees, berry bushes, grass and rocks; node placement is a deterministic function of terrain and tile position so older worlds can be backfilled.`

- [ ] **Step 4: Commit**

```bash
git add examples/AGENT_PROMPT.md README.md docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md
git commit -m "docs: provider-neutral agent prompt; spec and README for 0.0.1-2" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q
```

---

### Task 11: Demo, deploy and tag

**Files:** none (operational). This is the only task that touches production.

**Interfaces:**
- Consumes: everything above, and EasyPanel (project `rohit-personal`; services `touchgrass-engine`, `touchgrass-gateway`, `touchgrass-redis`).
- Produces: tag `v0.0.1-2` and https://touchgrass.win running 0.0.1-2.

- [ ] **Step 1: Full local verification**

Run: `bun run test && bun run test:int && bun run typecheck && bun run build:web`
Expected: all green.

- [ ] **Step 2: Local death/respawn demo**

With the local stack from Task 8 and 5 bots running, stop the engine (Ctrl-C). Starve `agent_1` directly in Redis:
```bash
bun -e "import { connectRedis } from './shared/redis.ts'; const r = await connectRedis('redis://localhost:6379/1'); const a = JSON.parse((await r.hGet('agents', 'agent_1'))!); Object.assign(a, { health: 1, food: 0, water: 0, autoEat: false, inventory: { wood: 4, berries: 2 } }); await r.hSet('agents', 'agent_1', JSON.stringify(a)); await r.close();"
```
Start the engine again. Within ~5 s the browser shows the robot's death animation, a brown loot box, and a death line in the event feed. After 30 s it respawns and the feed says so.

- [ ] **Step 3: Deploy to EasyPanel**

Ask the user for EasyPanel credentials if this session has none. Never write them to a file other than the session scratchpad token file, and log out afterwards. Then redeploy `touchgrass-engine` first (zero-downtime is off; it backfills resource nodes and upgrades old agent records on first boot), then `touchgrass-gateway`:
- `POST /api/deployAppService {"projectName":"rohit-personal","serviceName":"touchgrass-engine"}`
- `POST /api/deployAppService {"projectName":"rohit-personal","serviceName":"touchgrass-gateway"}`

- [ ] **Step 4: Production smoke test**

- Poll `https://touchgrass.win/health` until it returns `{"engine":true,"redis":true}`.
- Over MCP with a fresh signup (the per-IP limit is 3 per day), `tools/list` shows 9 tools, and `observe` shows `health`, `resources` and `time`.
- The Grass Inspector from 0.0.1-1 still exists with full stats.
- The live page renders nodes and day/night.

- [ ] **Step 5: Tag**

```bash
git tag v0.0.1-2 && git push -q origin v0.0.1-2
```

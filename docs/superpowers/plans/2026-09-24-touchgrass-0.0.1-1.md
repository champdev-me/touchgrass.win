# Touch Grass 0.0.1-1 "Robots in a Field" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI agents sign up on the website, connect over MCP, join a stored 1024×1024 world, walk around with `move_to`, and survive engine restarts, while a 3D spectator page shows them with free cam and follow cam.

**Architecture:** Two Bun services plus Redis. `engine` owns the world in memory, ticks once per second, saves changed state to Redis every 5 ticks, publishes tick deltas on Redis pub/sub, and appends a JSONL replay. `gateway` is the public edge: stateless MCP endpoint, signup, static files, spectator WebSocket, token auth and cooldowns. It forwards every game action to the engine over internal HTTP. The browser client renders chunk meshes and robots with Three.js.

**Tech Stack:** Bun ≥1.4 (runs `.ts` directly; `Bun.serve` for HTTP + WebSockets with built-in pub/sub topics; `bun build` bundles the web client; `bun test`), `@modelcontextprotocol/sdk` 1.30.1 (`WebStandardStreamableHTTPServerTransport`), `redis` 6.2.1 (node-redis), `simplex-noise` 4.0.3, `zod` 4.6.5, `obscenity` 0.4.6, `three` 0.186.0, `typescript` 7.0.2 (type-check only), Docker Compose with `oven/bun:1-alpine` and `redis:7.4-alpine`.

**Spec:** `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md` (release row 0.0.1-1, and §4–§8, §21, §24).

**Deliberate deviations from the spec (Task 14 updates the spec to match):**
- One root `package.json` with top-level folders, not npm workspaces.
- Redis stores terrain in one hash `terrain` (field `cx,cy`, base64 chunk) and agents in one hash `agents` (field id, JSON), not one key per chunk or agent. Base64 avoids binary-reply handling, and whole-hash loads avoid SCAN.
- The name and tag filter uses the `obscenity` package instead of a hand-written `data/blocklist.txt`.

## Global Constraints

- Bun ≥ 1.4 is the only runtime (dev, tests, Docker). Server code runs as `.ts` with no build step. Use `import type` / inline `type` for type-only imports and always write the `.ts` extension in relative imports. Use Bun-native APIs (`Bun.serve`, `Bun.file`, `bun:test`) instead of `node:http`, `ws`, or esbuild.
- Every tunable number lives in `shared/balance.ts`.
- Do cooldown 5 s (`B.doCooldownMs`), Look limit 1 call per second (`B.lookCooldownMs`). Failed actions cost no cooldown.
- The engine saves every 5 ticks (`B.flushEveryTicks`), and immediately on signup. The engine is the only writer of world state.
- MCP endpoint `POST /mcp`, stateless (`sessionIdGenerator: undefined`), `Authorization: Bearer tg_<32 url-safe chars>`. Redis stores only the SHA-256 of each token.
- Signup: name `^[A-Za-z0-9 _-]{3,24}$`, unique case-insensitively, profanity-filtered; 3 per IP per day (env `SIGNUP_PER_IP_PER_DAY`); max 200 agents active in 24 h.
- World: 1024×1024 tiles in 32×32 chunks, Plaza 40×40 at the center, spawn ≥ 50 tiles from the Plaza, movement 2 tiles per tick on land and 1 in shallow water, deep water impassable, A* radius 128.
- Assets must be CC0 and listed in `web/assets/CREDITS.md`.
- Code comments: at most 2 lines each, only where the why is not obvious.
- Commit messages end with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The same agent fires two actions at once** (a retrying client). Exactly one runs and the other gets `rate_limited`. Pinned in Task 9 (parallel `observe`) and Task 8 (`claimSlot` race).
2. **The engine is down or restarting while agents call tools.** Agents get `engine_unavailable` with `retry_after_seconds: 5`, the gateway stays up, and `/health` returns 503. Pinned in Task 9.
3. **Junk or out-of-range spectator WebSocket messages.** They are ignored, and valid chunk requests on the same socket are still answered. Pinned in Task 9.
4. **Encoded path traversal on static files** (`/..%2fsecret.txt`). Returns 404, never a file outside `web/`. Pinned in Task 9.
5. **The engine is hard-killed while agents are walking.** On restart agents are at their last saved spot, their task is cancelled, and their inbox says why. Pinned in Task 6 (persist test) and the Task 14 demo.

---

## File Structure

```text
touchgrass/
  package.json, bun.lock, tsconfig.json (server), .gitignore, .dockerignore
  Dockerfile, docker-compose.yml, README.md
  shared/
    balance.ts        every tunable number
    types.ts          terrain ids, roles, Agent, actions, tick deltas, WS messages
    geo.ts            compass + distance
    redis.ts          connectRedis + Redis type
  engine/
    terrain.ts        seeded generation, tile helpers, chunk (de)serialisation
    path.ts           A* pathfinding
    world.ts          World state + rules: register, join, observe, moveTo, step
    actions.ts        tool dispatcher -> ActionResult with cooldown
    persist.ts        Redis save/load (terrain, agents, meta)
    replay.ts         JSONL event log
    server.ts         startEngine(): internal HTTP API + tick loop
    main.ts           env -> startEngine
  gateway/
    auth.ts           token create/hash/lookup
    filter.ts         profanity check
    ratelimit.ts      atomic cooldown slots
    mcp.ts            MCP tool definitions
    server.ts         startGateway(): /mcp, /signup, /health, static, /ws
    main.ts           env -> startGateway
  web/
    index.html        page + panels
    tsconfig.json     browser type-check (DOM)
    assets/           CC0 .glb models + CREDITS.md
    src/tiles.ts      terrain heights/colours
    src/props.ts      Kenney props, instanced per chunk
    src/terrain.ts    chunk meshes + ChunkView (load/unload around camera)
    src/robots.ts     RobotExpressive instances, animation, name tags
    src/net.ts        WebSocket with reconnect
    src/ui.ts         status, agent list, signup form
    src/main.ts       scene, cameras, input, render loop
  examples/scripted-bot.ts
  test/               integration tests needing Redis (helpers.ts + *.test.ts)
```

Unit tests sit next to their module (`engine/world.test.ts`). Integration tests in `test/` need Redis on `localhost:6379`. They use separate DB indexes (12–15) and flush them first.

---

### Task 1: Project scaffold and shared foundations

**Files:**
- Create: `package.json`, `tsconfig.json`, `web/tsconfig.json`, `.gitignore`, `shared/balance.ts`, `shared/types.ts`, `shared/geo.ts`, `shared/redis.ts`
- Test: `shared/geo.test.ts`

**Interfaces:**
- Produces: `B` (balance constants); `TERRAIN`, `Terrain`, `ROLES`, `Role`, `Vec`, `Task`, `Agent`, `GameError`, `ActionRequest`, `ActionResult`, `AgentView`, `GameEvent`, `TickDelta`, `ServerMsg`, `ClientMsg`; `compass(dx, dy): string`, `dist(a: Vec, b: Vec): number`; `connectRedis(url?): Promise<Redis>`, `type Redis`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "touchgrass",
  "version": "0.0.1-1",
  "private": true,
  "type": "module",
  "scripts": {
    "engine": "bun engine/main.ts",
    "gateway": "bun gateway/main.ts",
    "build:web": "bun build web/src/main.ts --outdir web/dist --format esm --minify --sourcemap=linked",
    "dev:web": "bun build web/src/main.ts --outdir web/dist --format esm --sourcemap=linked --watch",
    "test": "bun test --timeout 30000 ./shared ./engine ./gateway",
    "test:int": "bun test --timeout 30000 ./test",
    "typecheck": "tsc --noEmit && tsc --noEmit -p web",
    "bots": "bun examples/scripted-bot.ts"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:
```bash
bun add @modelcontextprotocol/sdk@1.30.1 redis@6.2.1 simplex-noise@4.0.3 zod@4.6.5 obscenity@0.4.6
bun add -d three@0.186.0 @types/three@0.186.0 typescript@7.0.2 @types/bun
```
Expected: `bun.lock` created, no errors.

- [ ] **Step 3: Create tsconfig.json, web/tsconfig.json and .gitignore**

`tsconfig.json` (server, tests, examples; Bun types):
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["bun"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  },
  "include": ["shared", "engine", "gateway", "examples", "test"]
}
```

`web/tsconfig.json` (browser; kept separate so DOM and Bun globals don't clash):
```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": { "lib": ["ESNext", "DOM", "DOM.Iterable"], "types": [] },
  "include": ["src", "../shared"]
}
```

Until Task 12 creates `web/src`, type-check with `bunx tsc --noEmit` (the `-p web` half of `bun run typecheck` has no inputs yet).

`.gitignore`:
```text
node_modules/
web/dist/
data/
examples/.bots.json
```

- [ ] **Step 4: Create shared/balance.ts**

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
  plazaHalf: 20,
  spawnMinPlazaDist: 50,
  inboxMax: 20,
  doCooldownMs: 5000,
  lookCooldownMs: 1000,
  maxActiveAgents: 200,
  activeWindowMs: 24 * 60 * 60 * 1000,
} as const;
```

- [ ] **Step 5: Create shared/types.ts**

```ts
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
```

- [ ] **Step 6: Write the failing geo test**

`shared/geo.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { compass, dist } from './geo.ts';

test('compass uses screen coordinates (y grows south)', () => {
  assert.equal(compass(0, -3), 'N');
  assert.equal(compass(2, 0), 'E');
  assert.equal(compass(1, 1), 'SE');
  assert.equal(compass(-1, -1), 'NW');
  assert.equal(compass(-5, 0), 'W');
  assert.equal(compass(2, -1), 'NE');
  assert.equal(compass(0, 0), 'here');
});

test('dist is the larger axis gap', () => {
  assert.equal(dist([0, 0], [3, -7]), 7);
  assert.equal(dist([5, 5], [5, 5]), 0);
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `bun run test`
Expected: FAIL, cannot find module `./geo.ts`.

- [ ] **Step 8: Implement shared/geo.ts and shared/redis.ts**

`shared/geo.ts`:
```ts
import type { Vec } from './types.ts';

const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

/** Compass direction for an offset; y grows southward like the map. */
export function compass(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'here';
  return DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
}

export function dist(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}
```

`shared/redis.ts`:
```ts
import { createClient } from 'redis';

export type Redis = ReturnType<typeof createClient>;

export async function connectRedis(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): Promise<Redis> {
  const r = createClient({ url });
  r.on('error', (e) => console.error('[redis]', e.message));
  await r.connect();
  return r;
}
```

- [ ] **Step 9: Run tests and type-check**

Run: `bun run test && bunx tsc --noEmit`
Expected: 2 tests pass; tsc prints nothing.

- [ ] **Step 10: Commit**

```bash
git add package.json bun.lock tsconfig.json .gitignore shared
git commit -m "feat: project scaffold and shared types" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Terrain generation

**Files:**
- Create: `engine/terrain.ts`
- Test: `engine/terrain.test.ts`

**Interfaces:**
- Consumes: `B`, `TERRAIN`.
- Produces: `generateTerrain(seed: string, size?: number): Uint8Array`; `tileAt(tiles, x, y, size?): number` (out of bounds = DEEP); `walkable(t: number): boolean`; `stepCost(t: number): number`; `chunkBytes(tiles, cx, cy, size?): Uint8Array`; `writeChunk(tiles, cx, cy, bytes, size?): void`; `mulberry32(seed: number): () => number`; `hashSeed(s: string): number`.

- [ ] **Step 1: Write the failing test**

`engine/terrain.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { chunkBytes, generateTerrain, tileAt, walkable, writeChunk } from './terrain.ts';

const big = generateTerrain('touchgrass-test');

test('same seed gives the same world, a different seed a different one', () => {
  assert.deepEqual(generateTerrain('a', 256), generateTerrain('a', 256));
  assert.notDeepEqual(generateTerrain('a', 256), generateTerrain('b', 256));
});

test('the Plaza sits in the middle and the edges are deep water', () => {
  assert.equal(tileAt(big, 512, 512), T.PLAZA);
  assert.equal(tileAt(big, 0, 0), T.DEEP);
  assert.equal(tileAt(big, 1023, 500), T.DEEP);
  assert.equal(tileAt(big, -1, 5), T.DEEP);
});

test('every terrain type appears and a good share of the world is walkable', () => {
  const counts = new Map<number, number>();
  for (const t of big) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of Object.values(T)) assert.ok((counts.get(t) ?? 0) > 0, `missing terrain ${t}`);
  const share = big.filter((t) => walkable(t)).length / big.length;
  assert.ok(share > 0.4 && share < 0.9, `walkable share ${share}`);
});

test('chunks round-trip', () => {
  const copy = new Uint8Array(big.length);
  for (let cy = 0; cy < 32; cy++) for (let cx = 0; cx < 32; cx++) writeChunk(copy, cx, cy, chunkBytes(big, cx, cy));
  assert.deepEqual(copy, big);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./engine/terrain.test.ts`
Expected: FAIL, cannot find module `./terrain.ts`.

- [ ] **Step 3: Implement engine/terrain.ts**

```ts
import { createNoise2D } from 'simplex-noise';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Terrain } from '../shared/types.ts';

export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

function fbm(noise: (x: number, y: number) => number, x: number, y: number): number {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp /= 2;
    freq *= 2;
  }
  return sum / norm;
}

export function generateTerrain(seed: string, size: number = B.mapSize): Uint8Array {
  const rng = mulberry32(hashSeed(seed));
  const elev = createNoise2D(rng), moist = createNoise2D(rng), ruin = createNoise2D(rng);
  const tiles = new Uint8Array(size * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Island falloff: the edges sink into deep water so the finite world has a natural border.
      const d = Math.max(Math.abs(x - c), Math.abs(y - c)) / c;
      const e = fbm(elev, x / 128, y / 128) + 0.25 - Math.pow(d, 6) * 2;
      const m = fbm(moist, x / 90, y / 90);
      let t: Terrain;
      if (e < -0.25) t = T.DEEP;
      else if (e < -0.12) t = T.SHALLOW;
      else if (e < -0.06) t = T.SAND;
      else if (e > 0.6) t = T.HILLS;
      else if (m > 0.15) t = T.FOREST;
      else t = T.MEADOW;
      if ((t === T.MEADOW || t === T.FOREST) && ruin(x / 24, y / 24) > 0.82) t = T.RUINS;
      tiles[y * size + x] = t;
    }
  }
  const h = Math.min(B.plazaHalf, size / 4);
  for (let y = c - h; y < c + h; y++) for (let x = c - h; x < c + h; x++) tiles[y * size + x] = T.PLAZA;
  return tiles;
}

export function tileAt(tiles: Uint8Array, x: number, y: number, size: number = B.mapSize): number {
  return x < 0 || y < 0 || x >= size || y >= size ? T.DEEP : tiles[y * size + x];
}

export const walkable = (t: number): boolean => t !== T.DEEP;
export const stepCost = (t: number): number => (t === T.SHALLOW ? 2 : 1);

export function chunkBytes(tiles: Uint8Array, cx: number, cy: number, size: number = B.mapSize): Uint8Array {
  const n = B.chunkSize, out = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    const start = (cy * n + j) * size + cx * n;
    out.set(tiles.subarray(start, start + n), j * n);
  }
  return out;
}

export function writeChunk(tiles: Uint8Array, cx: number, cy: number, bytes: Uint8Array, size: number = B.mapSize): void {
  const n = B.chunkSize;
  for (let j = 0; j < n; j++) tiles.set(bytes.subarray(j * n, j * n + n), (cy * n + j) * size + cx * n);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test ./engine/terrain.test.ts`
Expected: 4 tests pass. If the variety test fails because a terrain type is missing or the walkable share is outside 0.4–0.9, adjust the thresholds in `generateTerrain` (the `e` and `m` cut-offs), not the test.

- [ ] **Step 5: Commit**

```bash
git add engine/terrain.ts engine/terrain.test.ts
git commit -m "feat(engine): seeded island terrain with Plaza and chunk helpers" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Pathfinding

**Files:**
- Create: `engine/path.ts`
- Test: `engine/path.test.ts`

**Interfaces:**
- Consumes: `B.pathRadius`, `walkable`, `stepCost`, `Vec`.
- Produces: `findPath(at: (x: number, y: number) => number, from: Vec, to: Vec, radius?: number): Vec[] | null`. The path excludes the start and ends at the target; `[]` when already there; `null` if unreachable, deep water, or farther than `radius` on either axis.

- [ ] **Step 1: Write the failing test**

`engine/path.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { findPath } from './path.ts';

function mapOf(rows: string[]) {
  const code: Record<string, number> = { '.': T.MEADOW, '~': T.DEEP, ',': T.SHALLOW };
  return (x: number, y: number): number => (rows[y]?.[x] === undefined ? T.DEEP : code[rows[y][x]]);
}

test('walks straight across open ground', () => {
  assert.deepEqual(findPath(mapOf(['.....', '.....']), [0, 0], [4, 0]), [[1, 0], [2, 0], [3, 0], [4, 0]]);
});

test('goes around deep water', () => {
  const at = mapOf(['.~.', '.~.', '...']);
  const path = findPath(at, [0, 0], [2, 0])!;
  assert.equal(path.length, 6);
  assert.deepEqual(path.at(-1), [2, 0]);
  assert.ok(path.every(([x, y]) => at(x, y) !== T.DEEP));
});

test('prefers a short land detour over slow shallow water', () => {
  const at = mapOf(['.,,,.', '.....']);
  assert.ok(findPath(at, [0, 0], [4, 0])!.every(([x, y]) => at(x, y) !== T.SHALLOW));
});

test('returns null for unreachable, deep-water or too-far targets', () => {
  const split = mapOf(['..~..', '..~..', '..~..']);
  assert.equal(findPath(split, [0, 0], [4, 0]), null);
  assert.equal(findPath(split, [0, 0], [2, 0]), null);
  const wide = mapOf(['.'.repeat(300)]);
  assert.equal(findPath(wide, [0, 0], [200, 0]), null);
  assert.equal(findPath(wide, [0, 0], [100, 0])!.length, 100);
});

test('standing on the target is an empty path', () => {
  assert.deepEqual(findPath(mapOf(['..']), [1, 0], [1, 0]), []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./engine/path.test.ts`
Expected: FAIL, cannot find module `./path.ts`.

- [ ] **Step 3: Implement engine/path.ts**

```ts
import { B } from '../shared/balance.ts';
import type { Vec } from '../shared/types.ts';
import { stepCost, walkable } from './terrain.ts';

class MinHeap {
  ids: number[] = [];
  pr: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number): void {
    const { ids, pr } = this;
    let i = ids.length;
    ids.push(id);
    pr.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pr[up] <= pr[i]) break;
      [ids[i], ids[up]] = [ids[up], ids[i]];
      [pr[i], pr[up]] = [pr[up], pr[i]];
      i = up;
    }
  }

  pop(): number {
    const { ids, pr } = this;
    const top = ids[0];
    const lastId = ids.pop()!, lastP = pr.pop()!;
    if (ids.length) {
      ids[0] = lastId;
      pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < ids.length && pr[l] < pr[m]) m = l;
        if (r < ids.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [ids[i], ids[m]] = [ids[m], ids[i]];
        [pr[i], pr[m]] = [pr[m], pr[i]];
        i = m;
      }
    }
    return top;
  }
}

/** A* over 4-neighbour tiles inside a (2r+1)² box around the start. */
export function findPath(at: (x: number, y: number) => number, from: Vec, to: Vec, radius: number = B.pathRadius): Vec[] | null {
  const [sx, sy] = from, [tx, ty] = to;
  if (Math.abs(tx - sx) > radius || Math.abs(ty - sy) > radius || !walkable(at(tx, ty))) return null;
  const w = radius * 2 + 1, ox = sx - radius, oy = sy - radius;
  const idx = (x: number, y: number) => (y - oy) * w + (x - ox);
  const g = new Float64Array(w * w).fill(Infinity);
  const came = new Int32Array(w * w).fill(-1);
  const start = idx(sx, sy), goal = idx(tx, ty);
  const heap = new MinHeap();
  g[start] = 0;
  heap.push(start, 0);
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    const cx = (cur % w) + ox, cy = Math.floor(cur / w) + oy;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < ox || ny < oy || nx >= ox + w || ny >= oy + w) continue;
      const t = at(nx, ny);
      if (!walkable(t)) continue;
      const ni = idx(nx, ny), ng = g[cur] + stepCost(t);
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ni, ng + Math.abs(tx - nx) + Math.abs(ty - ny));
      }
    }
  }
  if (g[goal] === Infinity) return null;
  const path: Vec[] = [];
  for (let i = goal; i !== start; i = came[i]) path.push([(i % w) + ox, Math.floor(i / w) + oy]);
  return path.reverse();
}
```

- [ ] **Step 4: Run tests**

Run: `bun test ./engine/path.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add engine/path.ts engine/path.test.ts
git commit -m "feat(engine): bounded A* pathfinding with shallow-water cost" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: World model

**Files:**
- Create: `engine/world.ts`
- Test: `engine/world.test.ts`

**Interfaces:**
- Consumes: `B`, types, `compass`, `dist`, `findPath`, `tileAt`, `walkable`, `stepCost`.
- Produces:
  - `class GameFail extends Error { code: string; hint?: string }`: a rule violation that becomes a `GameError`.
  - `class World` with fields `size`, `tiles`, `tick`, `nextId`, `agents: Map<string, Agent>`, `dirty: Set<string>`, `events: GameEvent[]`, `plaza: Vec` (getter), and methods:
    - `register(name: string, now?: number): Agent`
    - `join(id: string, role: Role, model: string | null): Agent`
    - `observe(id: string)`: returns `{ you: {id,name,role,model,pos,standing_on}, task, tick, grid: string[], legend: Record<string,string>, nearby: string[], landmarks: string[], inbox: string[], roles: Record<Role, number> }`
    - `moveTo(id: string, x: number, y: number): { steps: number; eta_seconds: number }`
    - `step(): TickDelta`
    - `views(): AgentView[]`
    - `at(x, y): number`

- [ ] **Step 1: Write the failing test**

`engine/world.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { GameFail, World } from './world.ts';

function worldOf(rows: string[]): World {
  const code: Record<string, number> = { '.': T.MEADOW, '~': T.DEEP, ',': T.SHALLOW };
  const n = rows.length, tiles = new Uint8Array(n * n);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { tiles[y * n + x] = code[ch]; }));
  return new World(tiles, n, () => 0.5);
}
const open = (n: number) => Array.from({ length: n }, () => '.'.repeat(n));

function joined(w: World, name = 'Grasslord', at: Vec = [2, 2]) {
  const a = w.register(name, 0);
  w.join(a.id, 'gatherer', 'test-model');
  [a.x, a.y] = at;
  return a;
}
const failCode = (fn: () => unknown) => {
  try { fn(); return 'ok'; } catch (e) { return (e as GameFail).code; }
};

test('register hands out ids and rejects duplicate names in any case', () => {
  const w = worldOf(open(10));
  assert.equal(w.register('Alpha', 0).id, 'agent_1');
  assert.equal(w.register('Beta', 0).id, 'agent_2');
  assert.equal(failCode(() => w.register('ALPHA', 0)), 'name_taken');
});

test('register refuses when 200 agents were active in the last day', () => {
  const w = worldOf(open(10));
  for (let i = 0; i < 200; i++) w.register(`bot${i}`, 0);
  assert.equal(failCode(() => w.register('late', 1000)), 'world_full');
  assert.equal(w.register('late', 25 * 3600 * 1000).id, 'agent_201');
});

test('world actions need join_game first', () => {
  const w = worldOf(open(10));
  const a = w.register('Shy', 0);
  assert.equal(failCode(() => w.observe(a.id)), 'not_joined');
  assert.equal(failCode(() => w.observe('agent_999')), 'unknown_agent');
});

test('rejoining keeps the role and leaves a note that observe hands over once', () => {
  const w = worldOf(open(10));
  const a = joined(w);
  w.join(a.id, 'hunter', null);
  assert.equal(a.role, 'gatherer');
  assert.deepEqual(w.observe(a.id).inbox, ['Welcome back. Your robot missed you. Probably.']);
  assert.deepEqual(w.observe(a.id).inbox, []);
});

test('observe shows a 17x17 grid with you in the middle and neighbours lettered', () => {
  const w = worldOf(open(40));
  const a = joined(w, 'Grasslord', [20, 20]);
  const b = joined(w, 'Bob', [22, 19]);
  const o = w.observe(a.id);
  const rows = o.grid.map((r) => r.split(' '));
  assert.equal(rows.length, 17);
  assert.ok(rows.every((r) => r.length === 17));
  assert.equal(rows[8][8], '@');
  assert.equal(rows[7][10], 'A');
  assert.equal(o.legend.A, `${b.id} Bob`);
  assert.deepEqual(o.nearby, [`${b.id} Bob (gatherer, test-model) 2 tiles NE`]);
  assert.deepEqual(o.roles, { gatherer: 2, hunter: 0, builder: 0, medic: 0, scout: 0 });
});

test('move_to rejects outside, deep water and unreachable targets', () => {
  const w = worldOf(['...~.', '...~.', '...~.', '...~.', '...~.']);
  const a = joined(w, 'Walker', [0, 0]);
  assert.equal(failCode(() => w.moveTo(a.id, 9, 0)), 'bad_target');
  assert.equal(failCode(() => w.moveTo(a.id, 3, 0)), 'blocked');
  assert.equal(failCode(() => w.moveTo(a.id, 4, 0)), 'no_path');
  assert.equal(failCode(() => w.moveTo(a.id, 2, 4)), 'ok');
});

test('agents walk 2 land tiles per tick, 1 in shallow water, then finish', () => {
  const w = worldOf(['.,,..', '~~~~~', '~~~~~', '~~~~~', '~~~~~']);
  const a = joined(w, 'Walker', [0, 0]);
  assert.deepEqual(w.moveTo(a.id, 4, 0), { steps: 4, eta_seconds: 3 });
  w.step();
  assert.deepEqual([a.x, a.y], [1, 0]);
  w.step();
  assert.deepEqual([a.x, a.y], [2, 0]);
  w.step();
  assert.deepEqual([a.x, a.y], [4, 0]);
  assert.equal(a.task, null);
  assert.match(w.observe(a.id).inbox.at(-1)!, /arrived at \(4, 0\)/);
});

test('joining is announced; tick deltas list joined agents only', () => {
  const w = worldOf(open(10));
  w.register('Lurker', 0);
  const a = joined(w);
  const d = w.step();
  assert.equal(d.tick, 1);
  assert.deepEqual(d.agents.map((v) => v.id), [a.id]);
  assert.match(d.events[0].text, /Grasslord has entered the grass/);
  assert.equal(w.step().events.length, 0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./engine/world.test.ts`
Expected: FAIL, cannot find module `./world.ts`.

- [ ] **Step 3: Implement engine/world.ts**

```ts
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
```

- [ ] **Step 4: Run tests and type-check**

Run: `bun test ./engine/world.test.ts && bun run typecheck`
Expected: 8 tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add engine/world.ts engine/world.test.ts
git commit -m "feat(engine): world state with register, join, observe, move_to and ticking" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Action dispatcher

**Files:**
- Create: `engine/actions.ts`
- Test: `engine/actions.test.ts`

**Interfaces:**
- Consumes: `World`, `GameFail`, `B`, `ROLES`.
- Produces: `handleAction(world: World, req: ActionRequest): ActionResult`. Do tools (`join_game`, `move_to`) cost `B.doCooldownMs` on success; Look tools and every failure cost 0. Unknown `GameFail`s become `{ ok: false, error }`; other errors are rethrown.

- [ ] **Step 1: Write the failing test**

`engine/actions.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { World } from './world.ts';

function setup() {
  const tiles = new Uint8Array(100).fill(T.MEADOW);
  tiles[5] = T.DEEP;
  const w = new World(tiles, 10, () => 0.5);
  return { w, id: w.register('Actor', 0).id };
}

test('join_game then observe: do tools cost 5s, look tools cost nothing', () => {
  const { w, id } = setup();
  const j = handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout', model: 'claude-test' } });
  assert.deepEqual([j.ok, j.cooldownMs], [true, 5000]);
  const o = handleAction(w, { agentId: id, tool: 'observe', args: {} });
  assert.deepEqual([o.ok, o.cooldownMs], [true, 0]);
  const m = handleAction(w, { agentId: id, tool: 'move_to', args: { x: 0, y: 5 } });
  assert.deepEqual([m.ok, m.cooldownMs], [true, 5000]);
});

test('failures explain themselves and cost no cooldown', () => {
  const { w, id } = setup();
  const bad = handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'wizard' } });
  assert.deepEqual([bad.ok, bad.cooldownMs], [false, 0]);
  assert.equal(!bad.ok && bad.error.error, 'bad_role');
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'medic' } });
  const blocked = handleAction(w, { agentId: id, tool: 'move_to', args: { x: 5, y: 0 } });
  assert.equal(!blocked.ok && blocked.error.error, 'blocked');
  const unknown = handleAction(w, { agentId: id, tool: 'fly', args: {} });
  assert.equal(!unknown.ok && unknown.error.error, 'unknown_tool');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./engine/actions.test.ts`
Expected: FAIL, cannot find module `./actions.ts`.

- [ ] **Step 3: Implement engine/actions.ts**

```ts
import { B } from '../shared/balance.ts';
import { ROLES, type ActionRequest, type ActionResult, type Role } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

const DO_TOOLS = new Set(['join_game', 'move_to']);

export function handleAction(world: World, req: ActionRequest): ActionResult {
  try {
    return { ok: true, data: run(world, req), cooldownMs: DO_TOOLS.has(req.tool) ? B.doCooldownMs : 0 };
  } catch (e) {
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  }
}

function run(world: World, { agentId, tool, args }: ActionRequest): unknown {
  switch (tool) {
    case 'join_game': {
      const role = args.role as Role;
      if (!ROLES.includes(role)) throw new GameFail('bad_role', 'That is not a job.', `Pick one of: ${ROLES.join(', ')}.`);
      world.join(agentId, role, typeof args.model === 'string' ? args.model.slice(0, 40) : null);
      return { ...world.observe(agentId), message: 'Welcome to Touch Grass. Try not to die immediately.' };
    }
    case 'observe':
      return world.observe(agentId);
    case 'move_to': {
      const res = world.moveTo(agentId, Number(args.x), Number(args.y));
      return { ...res, message: 'Your robot starts walking with great confidence.', observe: world.observe(agentId) };
    }
    default:
      throw new GameFail('unknown_tool', `There is no "${tool}" in this world.`, 'Use join_game, observe or move_to.');
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test && bun run typecheck`
Expected: all unit tests pass; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add engine/actions.ts engine/actions.test.ts
git commit -m "feat(engine): tool dispatcher with cooldown rules" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Persistence and replay log

**Files:**
- Create: `engine/persist.ts`, `engine/replay.ts`, `test/helpers.ts`
- Test: `engine/replay.test.ts`, `test/persist.test.ts`

**Interfaces:**
- Consumes: `Redis`, `World`, `chunkBytes`, `writeChunk`, `B`.
- Produces:
  - `K = { meta: 'meta', terrain: 'terrain', agents: 'agents' }`
  - `saveTerrain(r, tiles, size): Promise<void>`
  - `flush(r, w): Promise<void>`: writes meta plus dirty agents atomically and clears `dirty`; on failure the ids go back into `dirty`.
  - `saveAgentNow(r, w, id): Promise<void>`: immediate write used at signup.
  - `loadWorld(r): Promise<World | null>`: returns null on an empty DB; cancels saved tasks with an inbox note.
  - `appendReplay(dir, season, events, now?): Promise<void>`
  - `test/helpers.ts`: `redisUrl(db: number): string`, `sleep(ms): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`engine/replay.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendReplay } from './replay.ts';

test('events are appended as JSON lines per season and day', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-replay-'));
  const now = new Date('2026-09-24T10:00:00Z');
  await appendReplay(dir, 1, [{ tick: 1, type: 'join', text: 'A joined' }], now);
  await appendReplay(dir, 1, [], now);
  await appendReplay(dir, 1, [{ tick: 2, type: 'move', text: 'A walks' }], now);
  const lines = (await readFile(join(dir, 'season-1', '2026-09-24.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.tick), [1, 2]);
  assert.equal(lines[0].ts, '2026-09-24T10:00:00.000Z');
});
```

`test/helpers.ts`:
```ts
export const redisUrl = (db: number): string => `${process.env.TEST_REDIS ?? 'redis://localhost:6379'}/${db}`;
export const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));
```

`test/persist.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { flush, loadWorld, saveTerrain } from '../engine/persist.ts';
import { World } from '../engine/world.ts';
import { connectRedis } from '../shared/redis.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { redisUrl } from './helpers.ts';

test('flush then load restores terrain, agents and counters; walking is cancelled', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  assert.equal(await loadWorld(r), null);
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  tiles[3] = T.DEEP;
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  const a = w.register('Saver', 0);
  w.join(a.id, 'builder', null);
  w.moveTo(a.id, 0, 20);
  w.step();
  await flush(r, w);
  assert.equal(w.dirty.size, 0);

  const back = (await loadWorld(r))!;
  assert.deepEqual(back.tiles, tiles);
  assert.deepEqual([back.tick, back.nextId, back.size], [1, 2, 64]);
  const b = back.agents.get(a.id)!;
  assert.deepEqual([b.x, b.y, b.task, b.role], [0, 2, null, 'builder']);
  assert.equal(b.inbox.at(-1), 'Task cancelled: the universe rebooted.');
  await r.close();
});
```

- [ ] **Step 2: Start Redis for integration tests and verify the tests fail**

Run:
```bash
docker run -d --name tg-redis -p 6379:6379 redis:7.4-alpine
bun test ./engine/replay.test.ts; bun run test:int
```
Expected: both FAIL, cannot find modules `./replay.ts` / `../engine/persist.ts`.

- [ ] **Step 3: Implement engine/replay.ts and engine/persist.ts**

`engine/replay.ts`:
```ts
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameEvent } from '../shared/types.ts';

export async function appendReplay(dir: string, season: number, events: GameEvent[], now = new Date()): Promise<void> {
  if (!events.length) return;
  const folder = join(dir, `season-${season}`);
  await mkdir(folder, { recursive: true });
  const ts = now.toISOString();
  await appendFile(join(folder, `${ts.slice(0, 10)}.jsonl`), events.map((e) => JSON.stringify({ ...e, ts })).join('\n') + '\n');
}
```

`engine/persist.ts`:
```ts
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
```

- [ ] **Step 4: Run tests**

Run: `bun run test && bun run test:int && bun run typecheck`
Expected: unit tests pass, `test/persist.test.ts` passes, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add engine/persist.ts engine/replay.ts engine/replay.test.ts test
git commit -m "feat(engine): Redis persistence and JSONL replay log" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Engine service

**Files:**
- Create: `engine/server.ts`, `engine/main.ts`
- Test: `test/engine.test.ts`

**Interfaces:**
- Consumes: `World`, `generateTerrain`, `handleAction`, persistence functions, `appendReplay`.
- Produces: `startEngine(o: { redis: Redis; port: number; seed: string; replayDir: string; size?: number; tickMs?: number }): Promise<{ world: World; port: number; close(): Promise<void> }>`. Internal HTTP API:
  - `GET /health` → `{ ok, tick, agents }`
  - `POST /register {name}` → `{ ok: true, agentId }` or `{ ok: false, error }`
  - `POST /action ActionRequest` → `ActionResult`
  - Redis channel `tick` carries `JSON.stringify(TickDelta)` every tick.

- [ ] **Step 1: Write the failing test**

`test/engine.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startEngine } from '../engine/server.ts';
import { connectRedis } from '../shared/redis.ts';
import { redisUrl, sleep } from './helpers.ts';

test('engine registers agents, runs ticks, and restores after a restart', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const opts = { redis, port: 0, seed: 'engine-test', replayDir: await mkdtemp(join(tmpdir(), 'tg-eng-')), size: 128, tickMs: 50 };
  let eng = await startEngine(opts);
  const post = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${eng.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  const reg = await post('/register', { name: 'Tester' });
  assert.equal(reg.ok, true);
  assert.equal((await post('/register', { name: 'tester' })).error.error, 'name_taken');
  assert.equal((await post('/action', { agentId: reg.agentId, tool: 'join_game', args: { role: 'builder' } })).ok, true);
  await sleep(300);
  const health = await fetch(`http://127.0.0.1:${eng.port}/health`).then((r) => r.json());
  assert.ok(health.tick >= 3, `tick ${health.tick}`);
  const before = { ...eng.world.agents.get(reg.agentId)! };

  await eng.close();
  eng = await startEngine(opts);
  const after = eng.world.agents.get(reg.agentId)!;
  assert.deepEqual([after.x, after.y, after.role], [before.x, before.y, 'builder']);
  assert.ok(eng.world.tick >= health.tick);
  await eng.close();
  await redis.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:int`
Expected: FAIL, cannot find module `../engine/server.ts`.

- [ ] **Step 3: Implement engine/server.ts and engine/main.ts**

`engine/server.ts`:
```ts
import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import { handleAction } from './actions.ts';
import { flush, loadWorld, saveAgentNow, saveTerrain } from './persist.ts';
import { appendReplay } from './replay.ts';
import { generateTerrain } from './terrain.ts';
import { GameFail, World } from './world.ts';

export interface EngineOpts {
  redis: Redis;
  port: number;
  seed: string;
  replayDir: string;
  size?: number;
  tickMs?: number;
}

export async function startEngine(o: EngineOpts) {
  const r = o.redis;
  let w = await loadWorld(r);
  if (w) {
    console.log(`[engine] restored world at tick ${w.tick} with ${w.agents.size} agents`);
  } else {
    const size = o.size ?? B.mapSize;
    w = new World(generateTerrain(o.seed, size), size);
    await saveTerrain(r, w.tiles, size);
    await flush(r, w);
    console.log(`[engine] generated a new ${size}x${size} world from seed "${o.seed}"`);
  }
  const world = w;

  const server = Bun.serve({
    port: o.port,
    maxRequestBodySize: 64 * 1024,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      try {
        if (req.method === 'GET' && pathname === '/health') return Response.json({ ok: true, tick: world.tick, agents: world.agents.size });
        if (req.method === 'POST' && pathname === '/register') {
          const { name } = await req.json();
          try {
            const a = world.register(String(name));
            await saveAgentNow(r, world, a.id);
            return Response.json({ ok: true, agentId: a.id });
          } catch (e) {
            if (e instanceof GameFail) return Response.json({ ok: false, error: { error: e.code, message: e.message, hint: e.hint } });
            throw e;
          }
        }
        if (req.method === 'POST' && pathname === '/action') return Response.json(handleAction(world, await req.json()));
        return Response.json({ error: 'not_found' }, { status: 404 });
      } catch (e) {
        console.error('[engine]', e);
        return Response.json({ error: 'engine_error' }, { status: 500 });
      }
    },
  });

  const timer = setInterval(async () => {
    try {
      const delta = world.step();
      await r.publish('tick', JSON.stringify(delta));
      await appendReplay(o.replayDir, 1, delta.events);
      if (world.tick % B.flushEveryTicks === 0) await flush(r, world);
    } catch (e) {
      console.error('[engine] tick failed', e);
    }
  }, o.tickMs ?? B.tickMs);

  return {
    world,
    port: server.port as number,
    async close(): Promise<void> {
      clearInterval(timer);
      await flush(r, world);
      await server.stop(true);
    },
  };
}
```

`engine/main.ts`:
```ts
import { connectRedis } from '../shared/redis.ts';
import { startEngine } from './server.ts';

const redis = await connectRedis();
const engine = await startEngine({
  redis,
  port: Number(process.env.PORT ?? 4000),
  seed: process.env.SEED ?? 'touchgrass-season-1',
  replayDir: process.env.REPLAY_DIR ?? 'data/replays',
});
console.log(`[engine] listening on ${engine.port}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await engine.close();
    await redis.close();
    process.exit(0);
  });
}
```

- [ ] **Step 4: Run tests and a manual smoke run**

Run: `bun run test:int && bun run typecheck`
Expected: persist and engine tests pass.

Run: `REDIS_URL=redis://localhost:6379/1 bun run engine` and, in another shell, `curl -s localhost:4000/health`.
Expected: the first start prints `generated a new 1024x1024 world`. Health shows a rising `tick`. Ctrl-C, start again: it prints `restored world at tick N`.

- [ ] **Step 5: Commit**

```bash
git add engine/server.ts engine/main.ts test/engine.test.ts
git commit -m "feat(engine): internal API, 1s tick loop, 5-tick flush, graceful shutdown" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Gateway building blocks: auth, filter, cooldown slots

**Files:**
- Create: `gateway/auth.ts`, `gateway/filter.ts`, `gateway/ratelimit.ts`
- Test: `gateway/auth.test.ts`, `gateway/filter.test.ts`, `test/ratelimit.test.ts`

**Interfaces:**
- Produces:
  - `newToken(): string` (`tg_` + 32 base64url chars), `hashToken(t): string` (sha256 hex), `agentForToken(r, header: string | undefined): Promise<string | null>`
  - `isRude(text: string): boolean`
  - `claimSlot(r, key, ms): Promise<number>`: atomically takes the slot; returns 0 on success, else ms left.
  - `startCooldown(r, key, ms): Promise<void>`: (re)sets the slot TTL when ms > 0.

- [ ] **Step 1: Write the failing tests**

`gateway/auth.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { Redis } from '../shared/redis.ts';
import { agentForToken, hashToken, newToken } from './auth.ts';

test('tokens are tg_ plus 32 url-safe chars and hash stably', () => {
  const t = newToken();
  assert.match(t, /^tg_[A-Za-z0-9_-]{32}$/);
  assert.equal(hashToken(t), hashToken(t));
  assert.notEqual(hashToken(t), hashToken(newToken()));
});

test('agentForToken only looks up well-formed bearer headers', async () => {
  const seen: string[] = [];
  const fake = { get: async (k: string) => { seen.push(k); return 'agent_7'; } } as unknown as Redis;
  const t = newToken();
  assert.equal(await agentForToken(fake, `Bearer ${t}`), 'agent_7');
  assert.equal(await agentForToken(fake, 'Bearer nope'), null);
  assert.equal(await agentForToken(fake, undefined), null);
  assert.deepEqual(seen, [`token:${hashToken(t)}`]);
});
```

`gateway/filter.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { isRude } from './filter.ts';

test('profanity is caught, normal names and model tags pass', () => {
  assert.equal(isRude('Grasslord'), false);
  assert.equal(isRude('claude-opus-5-5'), false);
  assert.equal(isRude('shit lord'), true);
});
```

`test/ratelimit.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { claimSlot, startCooldown } from '../gateway/ratelimit.ts';
import { connectRedis } from '../shared/redis.ts';
import { redisUrl, sleep } from './helpers.ts';

test('claimSlot lets exactly one of two racing callers in', async () => {
  const r = await connectRedis(redisUrl(12));
  await r.flushDb();
  const waits = await Promise.all([claimSlot(r, 'cd:x', 1000), claimSlot(r, 'cd:x', 1000)]);
  assert.equal(waits.filter((w) => w === 0).length, 1);
  const wait = Math.max(...waits);
  assert.ok(wait > 0 && wait <= 1000, `wait ${wait}`);
  await startCooldown(r, 'cd:x', 50);
  await sleep(80);
  assert.equal(await claimSlot(r, 'cd:x', 1000), 0);
  await r.close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun run test; bun run test:int`
Expected: FAIL, the gateway modules are missing.

- [ ] **Step 3: Implement the three modules**

`gateway/auth.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from '../shared/redis.ts';

export const newToken = (): string => `tg_${randomBytes(24).toString('base64url')}`;
export const hashToken = (t: string): string => createHash('sha256').update(t).digest('hex');

export async function agentForToken(r: Redis, header: string | undefined): Promise<string | null> {
  const m = /^Bearer (tg_[A-Za-z0-9_-]{32})$/.exec(header ?? '');
  return m ? r.get(`token:${hashToken(m[1])}`) : null;
}
```

`gateway/filter.ts`:
```ts
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

export const isRude = (text: string): boolean => matcher.hasMatch(text);
```

`gateway/ratelimit.ts`:
```ts
import type { Redis } from '../shared/redis.ts';

/** Atomically takes the slot for `ms`; returns 0 on success, otherwise the ms still to wait. */
export async function claimSlot(r: Redis, key: string, ms: number): Promise<number> {
  const ok = await r.sendCommand(['SET', key, '1', 'NX', 'PX', String(ms)]);
  if (ok === 'OK') return 0;
  const left = await r.pTTL(key);
  return left > 0 ? left : 1;
}

export async function startCooldown(r: Redis, key: string, ms: number): Promise<void> {
  if (ms > 0) await r.sendCommand(['SET', key, '1', 'PX', String(ms)]);
}
```

- [ ] **Step 4: Run tests**

Run: `bun run test && bun run test:int && bun run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add gateway test/ratelimit.test.ts
git commit -m "feat(gateway): tokens, profanity filter, atomic cooldown slots" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Gateway service: MCP, signup, health, static files, spectator WebSocket

**Files:**
- Create: `gateway/mcp.ts`, `gateway/server.ts`, `gateway/main.ts`
- Test: `test/e2e.test.ts`

**Interfaces:**
- Consumes: Task 8 modules, `B`, `ROLES`, engine HTTP API (Task 7).
- Produces:
  - `type Reply = { ok: true; data: unknown } | { ok: false; error: GameError }`; `type Forward = (tool, args, kind: 'do' | 'look') => Promise<Reply>`; `buildMcpServer(forward: Forward): McpServer` with tools `join_game`, `observe`, `move_to`.
  - `startGateway(o: { redis; engineUrl; port; webDir; publicUrl; signupPerIpPerDay; trustProxy }): Promise<{ port: number; close(): Promise<void> }>`
  - Routes: `POST /mcp`, `POST /signup {name}` → `{ agentId, token, mcpUrl }`, `GET /health` → `{ engine, redis }`, `GET /*` static from `webDir` (`/` = `index.html`), `WS /ws` speaking `ServerMsg`/`ClientMsg`.

- [ ] **Step 1: Write the failing end-to-end test**

`test/e2e.test.ts`:
```ts
import { afterAll, beforeAll, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startEngine } from '../engine/server.ts';
import { startGateway } from '../gateway/server.ts';
import { connectRedis, type Redis } from '../shared/redis.ts';
import { redisUrl, sleep } from './helpers.ts';

let redis: Redis;
let eng: Awaited<ReturnType<typeof startEngine>> | null;
let gw: Awaited<ReturnType<typeof startGateway>>;
let base: string;

beforeAll(async () => {
  redis = await connectRedis(redisUrl(15));
  await redis.flushDb();
  const root = await mkdtemp(join(tmpdir(), 'tg-e2e-'));
  await mkdir(join(root, 'web'));
  await writeFile(join(root, 'web', 'index.html'), '<h1>grass</h1>');
  await writeFile(join(root, 'secret.txt'), 'nope');
  eng = await startEngine({ redis, port: 0, seed: 'e2e', replayDir: join(root, 'replays'), size: 256, tickMs: 200 });
  gw = await startGateway({
    redis, engineUrl: `http://127.0.0.1:${eng.port}`, port: 0, webDir: join(root, 'web'),
    publicUrl: 'http://tg.test', signupPerIpPerDay: 3, trustProxy: true,
  });
  base = `http://127.0.0.1:${gw.port}`;
});

afterAll(async () => {
  await gw.close();
  if (eng) await eng.close();
  await redis.close();
});

async function signup(name: string, ip: string) {
  const res = await fetch(`${base}/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ name }) });
  return { status: res.status, body: await res.json() };
}

async function mcp(token: string): Promise<Client> {
  const c = new Client({ name: 'e2e', version: '1.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool({ name, arguments: args });
  return { isError: Boolean(r.isError), data: JSON.parse((r.content as { text: string }[])[0].text) };
}

test('signup checks names, uniqueness and the per-IP limit', async () => {
  assert.equal((await signup('x', '1.1.1.1')).status, 400);
  assert.equal((await signup('shit lord', '1.1.1.1')).status, 400);
  const ok = await signup('Alpha Bot', '1.1.1.1');
  assert.equal(ok.status, 200);
  assert.match(ok.body.token, /^tg_/);
  assert.equal(ok.body.mcpUrl, 'http://tg.test/mcp');
  assert.equal((await signup('alpha bot', '1.1.1.1')).status, 409);
  await signup('Beta Bot', '1.1.1.1');
  await signup('Gamma Bot', '1.1.1.1');
  assert.equal((await signup('Delta Bot', '1.1.1.1')).status, 429);
  assert.equal((await signup('Delta Bot', '9.9.9.9')).status, 200);
});

test('a bad token cannot connect', async () => {
  await assert.rejects(mcp(`tg_${'x'.repeat(32)}`));
});

test('an agent joins, cannot double-act, walks and arrives', async () => {
  const { body } = await signup('Walker', '2.2.2.2');
  const c = await mcp(body.token);
  const j = await call(c, 'join_game', { role: 'scout', model: 'e2e-model' });
  assert.equal(j.isError, false);
  assert.equal(j.data.you.name, 'Walker');

  const [o1, o2] = await Promise.all([call(c, 'observe'), call(c, 'observe')]);
  assert.deepEqual([o1.isError, o2.isError].sort(), [false, true]);
  const limited = o1.isError ? o1 : o2;
  assert.equal(limited.data.error, 'rate_limited');
  assert.ok(limited.data.retry_after_seconds > 0);

  const [cx, cy] = j.data.you.pos;
  const rows: string[][] = j.data.grid.map((r: string) => r.split(' '));
  const mid = (rows.length - 1) / 2;
  const candidates: [number, number][] = [];
  rows.forEach((row, y) => row.forEach((ch, x) => {
    if ('.:fr^#'.includes(ch) && Math.abs(x - mid) + Math.abs(y - mid) >= 2) candidates.push([cx + x - mid, cy + y - mid]);
  }));
  candidates.sort((a, b) => Math.abs(a[0] - cx) + Math.abs(a[1] - cy) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)));

  await sleep(5100); // join_game started the 5s cooldown
  let target: [number, number] | null = null;
  for (const t of candidates) {
    const m = await call(c, 'move_to', { x: t[0], y: t[1] });
    if (!m.isError) { target = t; break; }
    assert.notEqual(m.data.error, 'rate_limited');
  }
  assert.ok(target, 'no reachable tile in view');
  assert.equal((await call(c, 'move_to', { x: target[0], y: target[1] })).data.error, 'rate_limited');

  let pos: number[] = [];
  for (let i = 0; i < 10 && String(pos) !== String(target); i++) {
    await sleep(1100);
    pos = (await call(c, 'observe')).data.you.pos;
  }
  assert.deepEqual(pos, target);
  await c.close();
});

test('spectators get hello, ticks and chunks; junk is ignored', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${gw.port}/ws`);
  const msgs: any[] = [];
  ws.addEventListener('message', (e) => msgs.push(JSON.parse(String(e.data))));
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  ws.send('not json');
  ws.send(JSON.stringify({ type: 'chunks', list: [[-1, -1], 'x', [0, 0]] }));
  await sleep(700);
  assert.equal(msgs[0].type, 'hello');
  const chunk = msgs.find((m) => m.type === 'chunk');
  assert.deepEqual([chunk.cx, chunk.cy, Buffer.from(chunk.data, 'base64').length], [0, 0, 1024]);
  assert.ok(msgs.some((m) => m.type === 'tick' && Array.isArray(m.agents)));
  ws.close();
});

test('static files are served but never from outside the web folder', async () => {
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type')!, /text\/html/);
  assert.equal((await fetch(`${base}/..%2fsecret.txt`)).status, 404);
  assert.equal((await fetch(`${base}/nope.js`)).status, 404);
});

test('health reports engine and redis', async () => {
  const res = await fetch(`${base}/health`);
  assert.deepEqual([res.status, await res.json()], [200, { engine: true, redis: true }]);
});

// Keep last: it stops the engine.
test('when the engine is down agents get a retryable error, not a crash', async () => {
  const { body } = await signup('Patient', '3.3.3.3');
  const c = await mcp(body.token);
  await eng!.close();
  eng = null;
  const r = await call(c, 'observe');
  assert.deepEqual([r.data.error, r.data.retry_after_seconds], ['engine_unavailable', 5]);
  assert.equal((await fetch(`${base}/health`)).status, 503);
  await c.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun run test:int`
Expected: FAIL, cannot find module `../gateway/server.ts`.

- [ ] **Step 3: Implement gateway/mcp.ts**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { B } from '../shared/balance.ts';
import { ROLES, type GameError } from '../shared/types.ts';

export type Reply = { ok: true; data: unknown } | { ok: false; error: GameError };
export type Forward = (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => Promise<Reply>;

export function buildMcpServer(forward: Forward): McpServer {
  const s = new McpServer({ name: 'touchgrass', version: '0.0.1-1' });
  const reply = async (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => {
    const res = await forward(tool, args, kind);
    return { content: [{ type: 'text' as const, text: JSON.stringify(res.ok ? res.data : res.error, null, 1) }], isError: !res.ok };
  };

  s.registerTool('join_game', {
    description: `Enter the Touch Grass world, or reconnect. Pick a job (${ROLES.join(', ')}). "model" is an optional free-text tag shown on your name tag, e.g. "claude-opus-5-5". Costs a ${B.doCooldownMs / 1000}s action cooldown.`,
    inputSchema: { role: z.enum(ROLES), model: z.string().max(40).optional() },
  }, (args) => reply('join_game', args, 'do'));

  s.registerTool('observe', {
    description: 'Look around: your status, an ASCII map of your surroundings (see legend), nearby agents with distance and direction, and your inbox of events since your last call. Free, max 1 call per second.',
    inputSchema: {},
  }, () => reply('observe', {}, 'look'));

  s.registerTool('move_to', {
    description: `Start walking to tile (x, y). Your robot pathfinds and keeps walking between your calls: 2 tiles/s on land, 1 in shallow water, never through deep water. Target must be within ${B.pathRadius} tiles. Costs a ${B.doCooldownMs / 1000}s action cooldown; observe is free meanwhile.`,
    inputSchema: { x: z.number().int().min(0).max(B.mapSize - 1), y: z.number().int().min(0).max(B.mapSize - 1) },
  }, (args) => reply('move_to', args, 'do'));

  return s;
}
```

- [ ] **Step 4: Implement gateway/server.ts**

```ts
import { resolve, sep } from 'node:path';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { B } from '../shared/balance.ts';
import type { Redis } from '../shared/redis.ts';
import type { ActionResult, ClientMsg, GameError } from '../shared/types.ts';
import { agentForToken, hashToken, newToken } from './auth.ts';
import { isRude } from './filter.ts';
import { buildMcpServer, type Forward } from './mcp.ts';
import { claimSlot, startCooldown } from './ratelimit.ts';

export interface GatewayOpts {
  redis: Redis;
  engineUrl: string;
  port: number;
  webDir: string;
  publicUrl: string;
  signupPerIpPerDay: number;
  trustProxy: boolean;
}

const RATE_MSGS = [
  'Slow down. This is survival, not a typing contest.',
  'You must wait. The grass demands patience.',
  'Cooldown active. Use this time to reflect on your life choices.',
];
const ENGINE_DOWN: GameError = { error: 'engine_unavailable', message: 'The world is rebooting. Stand still and think about grass.', hint: 'Retry in a few seconds.', retry_after_seconds: 5 };
const NAME_RE = /^[A-Za-z0-9 _-]{3,24}$/;
const json = (status: number, body: unknown) => Response.json(body, { status });

export async function startGateway(o: GatewayOpts) {
  const r = o.redis;
  const webRoot = resolve(o.webDir);

  async function callEngine(path: string, body: unknown): Promise<any> {
    const res = await fetch(o.engineUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`engine answered ${res.status}`);
    return res.json();
  }

  const forwardFor = (agentId: string): Forward => async (tool, args, kind) => {
    if (tool === 'join_game' && typeof args.model === 'string' && isRude(args.model)) {
      return { ok: false, error: { error: 'rude_model', message: 'That model tag made the grass blush.', hint: 'Use your real model name.' } };
    }
    const key = `${kind === 'do' ? 'cd' : 'cdlook'}:${agentId}`;
    const wait = await claimSlot(r, key, kind === 'do' ? B.doCooldownMs : B.lookCooldownMs);
    if (wait > 0) {
      return { ok: false, error: {
        error: 'rate_limited', message: RATE_MSGS[Math.floor(Math.random() * RATE_MSGS.length)],
        hint: 'Your current task keeps running while you wait.', retry_after_seconds: Math.ceil(wait / 100) / 10,
      } };
    }
    let res: ActionResult;
    try {
      res = await callEngine('/action', { agentId, tool, args });
    } catch {
      if (kind === 'do') await r.del(key);
      return { ok: false, error: ENGINE_DOWN };
    }
    if (kind === 'do') await (res.cooldownMs > 0 ? startCooldown(r, key, res.cooldownMs) : r.del(key));
    return res;
  };

  async function handleMcp(req: Request): Promise<Response> {
    if (req.method !== 'POST') return json(405, { jsonrpc: '2.0', error: { code: -32000, message: 'This MCP server is stateless: POST only.' }, id: null });
    const agentId = await agentForToken(r, req.headers.get('authorization') ?? undefined);
    if (!agentId) return json(401, { jsonrpc: '2.0', error: { code: -32001, message: `Missing or invalid token. Get one at ${o.publicUrl}` }, id: null });
    const server = buildMcpServer(forwardFor(agentId));
    // JSON (not SSE) responses: the reply is complete when handleRequest resolves, so closing right after is safe.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  }

  async function handleSignup(req: Request, ip: string): Promise<Response> {
    const body = await req.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!NAME_RE.test(name)) return json(400, { error: 'bad_name', message: 'Names are 3-24 characters: letters, numbers, spaces, _ or -.' });
    if (isRude(name)) return json(400, { error: 'rude_name', message: 'The grass blushes. Pick another name.' });
    const key = `signup:${ip}:${new Date().toISOString().slice(0, 10)}`;
    if (Number(await r.get(key)) >= o.signupPerIpPerDay) {
      return json(429, { error: 'signup_limit', message: `Max ${o.signupPerIpPerDay} agents per day from one place. Touch some real grass and come back tomorrow.` });
    }
    let reg: { ok: boolean; agentId?: string; error?: GameError };
    try {
      reg = await callEngine('/register', { name });
    } catch {
      return json(503, ENGINE_DOWN);
    }
    if (!reg.ok || !reg.agentId) return json(409, reg.error);
    const token = newToken();
    await r.multi().set(`token:${hashToken(token)}`, reg.agentId).incr(key).expire(key, 86400).exec();
    return json(200, { agentId: reg.agentId, token, mcpUrl: `${o.publicUrl}/mcp` });
  }

  async function handleHealth(): Promise<Response> {
    const [engine, redis] = await Promise.all([
      fetch(`${o.engineUrl}/health`, { signal: AbortSignal.timeout(2000) }).then((x) => x.ok, () => false),
      r.ping().then(() => true, () => false),
    ]);
    return json(engine && redis ? 200 : 503, { engine, redis });
  }

  async function serveStatic(pathname: string): Promise<Response> {
    let rel: string;
    try {
      rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    } catch {
      return json(404, { error: 'not_found' });
    }
    const path = resolve(webRoot, rel);
    if (!path.startsWith(webRoot + sep)) return json(404, { error: 'not_found' });
    const file = Bun.file(path);
    return (await file.exists()) ? new Response(file) : json(404, { error: 'not_found' });
  }

  let lastTick = 0;
  const server = Bun.serve({
    port: o.port,
    maxRequestBodySize: 64 * 1024,
    async fetch(req, srv) {
      const { pathname } = new URL(req.url);
      try {
        if (pathname === '/ws') return srv.upgrade(req) ? undefined : json(400, { error: 'expected_websocket' });
        if (pathname === '/mcp') return await handleMcp(req);
        if (req.method === 'POST' && pathname === '/signup') {
          const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
          return await handleSignup(req, (o.trustProxy && fwd) || srv.requestIP(req)?.address || 'unknown');
        }
        if (req.method === 'GET' && pathname === '/health') return await handleHealth();
        if (req.method === 'GET') return await serveStatic(pathname);
        return json(404, { error: 'not_found' });
      } catch (e) {
        if (e instanceof SyntaxError) return json(400, { error: 'bad_json', message: 'That was not JSON the grass understands.' });
        console.error('[gateway]', e);
        return json(500, { error: 'gateway_error' });
      }
    },
    websocket: {
      open(ws) {
        ws.subscribe('tick');
        ws.send(JSON.stringify({ type: 'hello', mapSize: B.mapSize, chunkSize: B.chunkSize, plaza: [B.mapSize / 2, B.mapSize / 2], tick: lastTick }));
      },
      async message(ws, raw) {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg?.type !== 'chunks' || !Array.isArray(msg.list)) return;
        for (const item of msg.list.slice(0, 64)) {
          const [cx, cy] = Array.isArray(item) ? item : [];
          if (!Number.isInteger(cx) || !Number.isInteger(cy)) continue;
          const data = await r.hGet('terrain', `${cx},${cy}`);
          if (data) ws.send(JSON.stringify({ type: 'chunk', cx, cy, data }));
        }
      },
    },
  });

  const sub = r.duplicate();
  await sub.connect();
  await sub.subscribe('tick', (msg) => {
    const delta = JSON.parse(msg);
    lastTick = delta.tick;
    server.publish('tick', JSON.stringify({ type: 'tick', ...delta }));
  });

  return {
    port: server.port as number,
    async close(): Promise<void> {
      await sub.close();
      await server.stop(true);
    },
  };
}
```

`gateway/main.ts`:
```ts
import { connectRedis } from '../shared/redis.ts';
import { startGateway } from './server.ts';

const port = Number(process.env.PORT ?? 3000);
const redis = await connectRedis();
const gw = await startGateway({
  redis,
  port,
  engineUrl: process.env.ENGINE_URL ?? 'http://localhost:4000',
  webDir: process.env.WEB_DIR ?? 'web',
  publicUrl: process.env.PUBLIC_URL ?? `http://localhost:${port}`,
  signupPerIpPerDay: Number(process.env.SIGNUP_PER_IP_PER_DAY ?? 3),
  trustProxy: process.env.TRUST_PROXY === '1',
});
console.log(`[gateway] listening on ${gw.port}`);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await gw.close();
    await redis.close();
    process.exit(0);
  });
}
```

- [ ] **Step 5: Run the tests**

Run: `bun run test:int && bun run test && bun run typecheck`
Expected: all integration tests pass (e2e takes ~15 s because of the real 5 s cooldown). If the MCP SDK rejects the stateless setup or the `registerTool` signature, fix `gateway/mcp.ts` / `handleMcp` against the installed SDK's `dist/esm/server/webStandardStreamableHttp.d.ts` and `mcp.d.ts` rather than changing the tests. If `Bun.serve` type inference complains about the `websocket` handlers, add an explicit generic (`Bun.serve<undefined, {}>`) matching the installed `@types/bun`.

- [ ] **Step 6: Commit**

```bash
git add gateway test/e2e.test.ts
git commit -m "feat(gateway): stateless MCP, signup, health, static files and spectator websocket" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Scripted bot

**Files:**
- Create: `examples/scripted-bot.ts`

**Interfaces:**
- Consumes: `POST /signup`, MCP tools `join_game`, `observe`, `move_to`.
- Produces: `bun run bots` runs `BOTS` (default 10) wandering agents against `TG_URL` (default `http://localhost:3000`). Tokens are saved to `examples/.bots.json` so the same robots return after restarts.

- [ ] **Step 1: Implement examples/scripted-bot.ts**

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = process.env.TG_URL ?? 'http://localhost:3000';
const COUNT = Number(process.env.BOTS ?? 10);
const FILE = 'examples/.bots.json';
const ROLES = ['gatherer', 'hunter', 'builder', 'medic', 'scout'];
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function tokens(): Promise<string[]> {
  const saved: string[] = JSON.parse(await readFile(FILE, 'utf8').catch(() => '[]'));
  while (saved.length < COUNT) {
    const res = await fetch(`${BASE}/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Bot ${Math.random().toString(36).slice(2, 7)}` }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`signup failed: ${body.message}`);
    saved.push(body.token);
    await writeFile(FILE, JSON.stringify(saved));
  }
  return saved.slice(0, COUNT);
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool({ name, arguments: args });
  return { error: Boolean(r.isError), data: JSON.parse((r.content as { text: string }[])[0]?.text ?? '{}') };
}

async function runBot(token: string, i: number): Promise<never> {
  for (;;) {
    try {
      const c = new Client({ name: `scripted-bot-${i}`, version: '0.0.1' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      await call(c, 'join_game', { role: ROLES[i % ROLES.length], model: 'scripted-bot' });
      for (;;) {
        await sleep(5500 + Math.random() * 2000);
        const o = await call(c, 'observe');
        if (o.error || o.data.task) continue;
        const [x, y] = o.data.you.pos;
        const clamp = (v: number) => Math.max(0, Math.min(1023, v));
        const tx = clamp(x + Math.round((Math.random() - 0.5) * 60)), ty = clamp(y + Math.round((Math.random() - 0.5) * 60));
        const m = await call(c, 'move_to', { x: tx, y: ty });
        console.log(`bot ${i}: move_to (${tx}, ${ty}) -> ${m.error ? m.data.error : 'ok'}`);
      }
    } catch (e) {
      console.log(`bot ${i}: ${(e as Error).message}; reconnecting in 5s`);
      await sleep(5000);
    }
  }
}

await Promise.all((await tokens()).map((t, i) => runBot(t, i)));
```

- [ ] **Step 2: Run it against local services**

Run (four shells, Redis from Task 6 still running):
```bash
REDIS_URL=redis://localhost:6379/1 bun run engine
REDIS_URL=redis://localhost:6379/1 SIGNUP_PER_IP_PER_DAY=100 bun run gateway
BOTS=5 bun run bots
curl -s localhost:3000/health
```
Expected: bot logs show `move_to (...) -> ok`, with occasional `blocked` / `no_path` (fine, they retry). Health is `{"engine":true,"redis":true}`. `examples/.bots.json` holds 5 tokens.

- [ ] **Step 3: Type-check and commit**

```bash
bun run typecheck
git add examples/scripted-bot.ts
git commit -m "feat: scripted wandering bot for demos and load" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: CC0 assets

**Files:**
- Create: `web/assets/RobotExpressive.glb`, `web/assets/{tree_default,tree_oak,tree_pineRoundA,plant_bush,grass_large,stone_largeA}.glb`, `web/assets/CREDITS.md`

**Interfaces:**
- Produces: models served at `/assets/<name>.glb`, used by Task 12. RobotExpressive has materials `Grey`/`Main`/`Black` (`Main` is the tinted body), clips `Idle`, `Walking`, `Running`, `Dance`, `Death`, `Jump`, `No`, `Punch`, `Sitting`, `Standing`, `ThumbsUp`, `WalkJump`, `Wave`, `Yes`, and Head morph targets `Angry`, `Surprised`, `Sad`. Kenney models are ~1 unit tall with their base at y=0.

- [ ] **Step 1: Download and extract**

Run:
```bash
mkdir -p web/assets
curl -sSL -o web/assets/RobotExpressive.glb https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb
curl -sSL -o "$TMPDIR/kenney_nature.zip" https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip
for f in tree_default tree_oak tree_pineRoundA plant_bush grass_large stone_largeA; do
  unzip -o -q -j "$TMPDIR/kenney_nature.zip" "Models/GLTF format/$f.glb" -d web/assets
done
unzip -p "$TMPDIR/kenney_nature.zip" License.txt | head -12
ls -la web/assets
```
Expected: 7 `.glb` files (robot ~464 KB, the others 4–19 KB). The printed license says `Creative Commons Zero, CC0`.

- [ ] **Step 2: Write web/assets/CREDITS.md**

```markdown
# Asset credits

All assets are CC0 (public domain). Credit is not required but given with thanks.

| File | Source | Author | License |
|---|---|---|---|
| RobotExpressive.glb | three.js examples (`examples/models/gltf/RobotExpressive`) | Tomás Laulhé, modified by Don McCurdy | CC0 1.0 |
| tree_default.glb, tree_oak.glb, tree_pineRoundA.glb, plant_bush.glb, grass_large.glb, stone_largeA.glb | Nature Kit 2.1, https://kenney.nl/assets/nature-kit | Kenney (www.kenney.nl) | CC0 1.0 |
```

- [ ] **Step 3: Commit**

```bash
git add web/assets
git commit -m "chore(web): vendor CC0 robot and nature models" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 3D spectator client

**Files:**
- Create: `web/index.html`, `web/src/tiles.ts`, `web/src/props.ts`, `web/src/terrain.ts`, `web/src/robots.ts`, `web/src/net.ts`, `web/src/ui.ts`, `web/src/main.ts`

**Interfaces:**
- Consumes: `ServerMsg`/`ClientMsg`, `AgentView`, `B`, `TERRAIN`, Task 11 assets, gateway `/ws` + `/signup`.
- Produces: `bun run build:web` → `web/dist/main.js`, loaded by `web/index.html`. Keys: `F` free cam, `WASD`/drag to pan, right-drag to rotate, wheel to zoom, `Tab` follow next robot, `H` hide UI.

- [ ] **Step 1: Create web/index.html**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Touch Grass</title>
<style>
  :root { --bg: #0e1a12; --panel: rgba(12, 20, 14, 0.82); --line: #2c4a2a; --ink: #eef6e8; --muted: #9fb59a; --accent: #8be36b; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink); font: 14px/1.4 ui-monospace, Menlo, monospace; overflow: hidden; }
  #view { position: fixed; inset: 0; }
  .panel { position: fixed; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; backdrop-filter: blur(4px); }
  #title { top: 12px; left: 12px; }
  #title h1 { margin: 0; font-size: 18px; color: var(--accent); letter-spacing: 0.5px; }
  #status { color: var(--muted); }
  #agents { top: 12px; right: 12px; max-height: 60vh; overflow: auto; min-width: 190px; }
  #agents button { display: block; width: 100%; text-align: left; background: none; border: 0; color: var(--ink); font: inherit; padding: 3px 4px; border-radius: 4px; cursor: pointer; }
  #agents button.on, #agents button:hover { background: var(--line); }
  #signup { bottom: 12px; left: 12px; max-width: min(440px, calc(100vw - 50px)); }
  #signup input { background: #08110a; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: 6px; font: inherit; }
  #signup button { background: var(--accent); color: #08110a; border: 0; border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; }
  #signup pre { white-space: pre-wrap; word-break: break-all; background: #08110a; padding: 8px; border-radius: 6px; font-size: 12px; max-height: 30vh; overflow: auto; }
  #keys { bottom: 12px; right: 12px; color: var(--muted); font-size: 12px; }
  .tag { font: 12px ui-monospace, Menlo, monospace; color: #fff; background: rgba(0, 0, 0, 0.55); padding: 1px 6px; border-radius: 8px; white-space: nowrap; }
  body.clean .panel { display: none; }
</style>
</head>
<body>
<div id="view"></div>
<div id="title" class="panel"><h1>Touch Grass: Panic Edition</h1><div id="status">connecting…</div></div>
<div id="agents" class="panel"><b>Robots</b><div id="agent-list"></div></div>
<div id="signup" class="panel">
  <b>Send your AI outside</b>
  <form id="signup-form"><input name="name" placeholder="agent name" minlength="3" maxlength="24" required> <button>Get token</button></form>
  <pre id="signup-out" hidden></pre>
</div>
<div id="keys" class="panel">WASD/drag pan · right-drag rotate · wheel zoom · Tab follow · F free cam · H hide UI</div>
<script type="module" src="/dist/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create web/src/tiles.ts and web/src/props.ts**

`web/src/tiles.ts`:
```ts
import { TERRAIN as T } from '../../shared/types.ts';

const HEIGHT: Record<number, number> = { [T.DEEP]: 0.2, [T.SHALLOW]: 0.55, [T.SAND]: 0.9, [T.MEADOW]: 1, [T.FOREST]: 1, [T.RUINS]: 1.05, [T.PLAZA]: 1.1, [T.HILLS]: 1.6 };
export const COLOR: Record<number, string> = { [T.DEEP]: '#1d4e89', [T.SHALLOW]: '#3a7ca5', [T.SAND]: '#e3d59f', [T.MEADOW]: '#7cc36b', [T.FOREST]: '#4f9a4a', [T.RUINS]: '#b9a88a', [T.PLAZA]: '#d8c9a3', [T.HILLS]: '#9a9a8f' };
export const WATER_LEVEL = 0.7;
export const heightOf = (t: number): number => HEIGHT[t] ?? 1;
```

`web/src/props.ts`:
```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TERRAIN as T } from '../../shared/types.ts';
import { heightOf } from './tiles.ts';

export type Models = Map<string, THREE.Mesh[]>;
const NAMES = ['tree_default', 'tree_oak', 'tree_pineRoundA', 'plant_bush', 'grass_large', 'stone_largeA'];

export async function loadProps(): Promise<Models> {
  const loader = new GLTFLoader(), out: Models = new Map();
  await Promise.all(NAMES.map(async (n) => {
    const g = await loader.loadAsync(`/assets/${n}.glb`);
    g.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    g.scene.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
    out.set(n, meshes);
  }));
  return out;
}

export function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ponytail: decoration only; 0.0.1-2 replaces trees/rocks with real resource nodes from the engine
export function propFor(t: number, x: number, y: number): string | null {
  const r = hash01(x, y);
  if (t === T.FOREST) return r < 0.15 ? 'tree_pineRoundA' : r < 0.3 ? 'tree_default' : r < 0.45 ? 'tree_oak' : r > 0.93 ? 'plant_bush' : null;
  if (t === T.MEADOW) return r < 0.02 ? 'tree_default' : r < 0.07 ? 'grass_large' : r > 0.985 ? 'plant_bush' : null;
  if (t === T.HILLS) return r < 0.12 ? 'stone_largeA' : null;
  return null;
}

/** One InstancedMesh per model part per chunk keeps draw calls low. */
export function buildProps(models: Models, tiles: Uint8Array, n: number, x0: number, y0: number): THREE.Group {
  const byKind = new Map<string, THREE.Matrix4[]>();
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const t = tiles[j * n + i], x = x0 + i, y = y0 + j, kind = propFor(t, x, y);
      if (!kind) continue;
      const r = hash01(y, x), s = 0.85 + r * 0.3;
      q.setFromAxisAngle(up, r * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, heightOf(t), y + 0.5), q, new THREE.Vector3(s, s, s));
      (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push(m);
    }
  }
  const group = new THREE.Group(), tmp = new THREE.Matrix4();
  for (const [kind, mats] of byKind) {
    for (const mesh of models.get(kind) ?? []) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
      mats.forEach((m, k) => inst.setMatrixAt(k, tmp.multiplyMatrices(m, mesh.matrixWorld)));
      group.add(inst);
    }
  }
  return group;
}
```

- [ ] **Step 3: Create web/src/terrain.ts**

```ts
import * as THREE from 'three';
import { B } from '../../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../../shared/types.ts';
import { buildProps, type Models } from './props.ts';
import { COLOR, heightOf } from './tiles.ts';

const VIEW = 5; // chunks around the camera that get meshes
const BUILDS_PER_FRAME = 4;
const material = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Merged chunk mesh: a top quad per tile plus side walls where the neighbour is lower. */
export function buildChunkGeometry(tiles: Uint8Array, n: number, x0: number, y0: number, at: (x: number, y: number) => number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  const quad = (v: number[][], shade: number) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...v[k]);
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const t = tiles[j * n + i], h = heightOf(t), x = x0 + i, z = y0 + j;
      c.set(COLOR[t] ?? '#ff00ff');
      quad([[x, h, z], [x, h, z + 1], [x + 1, h, z + 1], [x + 1, h, z]], 0.94 + (((x * 73856093) ^ (z * 19349663)) & 15) / 150);
      const lo = (nx: number, nz: number) => Math.min(h, heightOf(at(nx, nz)));
      let l = lo(x, z - 1);
      if (l < h) quad([[x + 1, h, z], [x + 1, l, z], [x, l, z], [x, h, z]], 0.8);
      l = lo(x, z + 1);
      if (l < h) quad([[x, h, z + 1], [x, l, z + 1], [x + 1, l, z + 1], [x + 1, h, z + 1]], 0.8);
      l = lo(x - 1, z);
      if (l < h) quad([[x, h, z], [x, l, z], [x, l, z + 1], [x, h, z + 1]], 0.7);
      l = lo(x + 1, z);
      if (l < h) quad([[x + 1, h, z + 1], [x + 1, l, z + 1], [x + 1, l, z], [x + 1, h, z]], 0.7);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class ChunkView {
  scene: THREE.Scene;
  models: Models;
  request: (list: Vec[]) => void;
  n = B.chunkSize;
  count = B.mapSize / B.chunkSize;
  tiles = new Map<string, Uint8Array>();
  meshes = new Map<string, THREE.Group>();
  asked = new Set<string>();

  constructor(scene: THREE.Scene, models: Models, request: (list: Vec[]) => void) {
    this.scene = scene;
    this.models = models;
    this.request = request;
  }

  reset(): void {
    this.asked.clear();
  }

  add(cx: number, cy: number, b64: string): void {
    this.tiles.set(`${cx},${cy}`, Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
  }

  tileAt(x: number, y: number): number {
    const t = this.tiles.get(`${Math.floor(x / this.n)},${Math.floor(y / this.n)}`);
    return t ? t[(y % this.n) * this.n + (x % this.n)] : T.DEEP;
  }

  heightAt(x: number, y: number): number {
    return heightOf(this.tileAt(x, y));
  }

  update(center: THREE.Vector3): void {
    const ccx = Math.floor(center.x / this.n), ccy = Math.floor(center.z / this.n), want: Vec[] = [];
    let built = 0;
    for (let cy = ccy - VIEW; cy <= ccy + VIEW; cy++) {
      for (let cx = ccx - VIEW; cx <= ccx + VIEW; cx++) {
        if (cx < 0 || cy < 0 || cx >= this.count || cy >= this.count) continue;
        const key = `${cx},${cy}`;
        if (this.meshes.has(key)) continue;
        const tiles = this.tiles.get(key);
        if (tiles && built < BUILDS_PER_FRAME) {
          this.build(key, cx, cy, tiles);
          built++;
        } else if (!tiles && !this.asked.has(key)) {
          this.asked.add(key);
          want.push([cx, cy]);
        }
      }
    }
    if (want.length) this.request(want);
    for (const [key, g] of this.meshes) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - ccx) > VIEW + 2 || Math.abs(cy - ccy) > VIEW + 2) this.drop(key, g);
    }
  }

  build(key: string, cx: number, cy: number, tiles: Uint8Array): void {
    const x0 = cx * this.n, y0 = cy * this.n, g = new THREE.Group();
    g.add(new THREE.Mesh(buildChunkGeometry(tiles, this.n, x0, y0, (x, y) => this.tileAt(x, y)), material));
    g.add(buildProps(this.models, tiles, this.n, x0, y0));
    this.scene.add(g);
    this.meshes.set(key, g);
  }

  drop(key: string, g: THREE.Group): void {
    this.scene.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose(); // shared model geometry stays alive
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.meshes.delete(key);
  }
}
```

- [ ] **Step 4: Create web/src/robots.ts**

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { AgentView } from '../../shared/types.ts';

const HEIGHT = 0.9; // robot height in tiles

export interface Bot {
  view: AgentView;
  root: THREE.Object3D;
  tag: HTMLDivElement;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  clip: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

export class Robots {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  tickMs: number;
  bots = new Map<string, Bot>();
  template: THREE.Object3D = new THREE.Group();
  clips: THREE.AnimationClip[] = [];
  scale = 1;

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number, tickMs: number) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.tickMs = tickMs;
  }

  async load(): Promise<void> {
    const g = await new GLTFLoader().loadAsync('/assets/RobotExpressive.glb');
    this.template = g.scene;
    this.clips = g.animations;
    this.scale = HEIGHT / new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3()).y;
  }

  sync(views: AgentView[]): void {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      const b = this.bots.get(v.id) ?? this.spawn(v);
      b.view = v;
      b.from.copy(b.root.position);
      b.to.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
      b.t = 0;
      this.play(b, v.moving || b.from.distanceToSquared(b.to) > 1e-4 ? 'Walking' : 'Idle');
    }
    for (const [id, b] of this.bots) {
      if (seen.has(id)) continue;
      this.scene.remove(b.root);
      b.tag.remove();
      this.bots.delete(id);
    }
  }

  update(dt: number): void {
    for (const b of this.bots.values()) {
      b.t = Math.min(1, b.t + (dt * 1000) / this.tickMs);
      b.root.position.lerpVectors(b.from, b.to, b.t);
      const dx = b.to.x - b.from.x, dz = b.to.z - b.from.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-3) b.root.rotation.y = Math.atan2(dx, dz);
      b.mixer.update(dt);
    }
  }

  spawn(v: AgentView): Bot {
    const root = SkeletonUtils.clone(this.template);
    root.scale.setScalar(this.scale);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      if (m.name === 'Main') m.color.set(v.color);
      o.material = m;
    });
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = v.model ? `${v.name} · ${v.model}` : v.name;
    const label = new CSS2DObject(tag);
    label.position.y = (HEIGHT + 0.3) / this.scale;
    root.add(label);
    root.position.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const b: Bot = {
      view: v, root, tag, mixer, clip: '', t: 1,
      actions: new Map(this.clips.map((c) => [c.name, mixer.clipAction(c)])),
      from: root.position.clone(), to: root.position.clone(),
    };
    this.play(b, 'Idle');
    this.bots.set(v.id, b);
    return b;
  }

  play(b: Bot, name: string): void {
    if (b.clip === name) return;
    b.actions.get(b.clip)?.fadeOut(0.2);
    b.actions.get(name)?.reset().fadeIn(0.2).play();
    b.clip = name;
  }
}
```

- [ ] **Step 5: Create web/src/net.ts and web/src/ui.ts**

`web/src/net.ts`:
```ts
import type { ClientMsg, ServerMsg } from '../../shared/types.ts';

export function connect(onMsg: (m: ServerMsg) => void, onStatus: (s: string) => void): (m: ClientMsg) => void {
  let ws: WebSocket;
  const open = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => onStatus('live');
    ws.onmessage = (e) => onMsg(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus('reconnecting…');
      setTimeout(open, 2000);
    };
  };
  open();
  return (m) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
}
```

`web/src/ui.ts`:
```ts
import type { AgentView } from '../../shared/types.ts';

export function setupUi(onFollow: (id: string) => void) {
  const $ = (id: string) => document.getElementById(id)!;
  const list = $('agent-list');
  let following: string | null = null, lastKey = '', lastViews: AgentView[] = [];

  const render = () => {
    list.replaceChildren(...lastViews.map((v) => {
      const b = document.createElement('button');
      const dot = document.createElement('span');
      dot.textContent = '● ';
      dot.style.color = v.color;
      b.append(dot, v.name);
      b.className = v.id === following ? 'on' : '';
      b.onclick = () => onFollow(v.id);
      return b;
    }));
  };

  $('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = String(new FormData(e.target as HTMLFormElement).get('name') ?? '').trim();
    const out = $('signup-out');
    out.hidden = false;
    out.textContent = 'asking the grass…';
    const res = await fetch('/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const j = await res.json().catch(() => ({}));
    out.textContent = res.ok
      ? `Token (shown once, keep it secret):\n${j.token}\n\nClaude Code:\nclaude mcp add --transport http touchgrass ${j.mcpUrl} --header "Authorization: Bearer ${j.token}"`
      : (j.message ?? 'Something went wrong. The grass is confused.');
  });

  return {
    status: (s: string) => { $('status').textContent = s; },
    agents: (views: AgentView[]) => {
      lastViews = views;
      const key = `${views.map((v) => v.id).join()}|${following}`;
      if (key !== lastKey) {
        lastKey = key;
        render();
      }
    },
    following: (id: string | null) => {
      following = id;
      lastKey = '';
      render();
    },
  };
}
```

- [ ] **Step 6: Create web/src/main.ts**

```ts
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { B } from '../../shared/balance.ts';
import type { ClientMsg, ServerMsg } from '../../shared/types.ts';
import { connect } from './net.ts';
import { loadProps } from './props.ts';
import { Robots } from './robots.ts';
import { ChunkView } from './terrain.ts';
import { WATER_LEVEL } from './tiles.ts';
import { setupUi } from './ui.ts';

const host = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd3ff');
scene.fog = new THREE.Fog('#9fd3ff', 70, 180);
scene.add(new THREE.HemisphereLight('#e4f4ff', '#4a6b3a', 1.3));
const sun = new THREE.DirectionalLight('#fff1d0', 1.8);
sun.position.set(-0.4, 1, -0.25);
scene.add(sun);
const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: '#2f7fc1', transparent: true, opacity: 0.78 }));
water.rotation.x = -Math.PI / 2;
scene.add(water);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 5;
controls.maxDistance = 140;
const mid = B.mapSize / 2;
controls.target.set(mid, 1, mid);
camera.position.set(mid - 22, 30, mid + 28);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

let follow: string | null = null;
let send: (m: ClientMsg) => void = () => {};
const ui = setupUi((id) => setFollow(id));
const robots = new Robots(scene, (x, y) => chunks.heightAt(x, y), B.tickMs);
const [models] = await Promise.all([loadProps(), robots.load()]);
const chunks = new ChunkView(scene, models, (list) => send({ type: 'chunks', list }));

function setFollow(id: string | null) {
  follow = id;
  ui.following(id);
}

send = connect((m: ServerMsg) => {
  if (m.type === 'hello') chunks.reset();
  else if (m.type === 'chunk') chunks.add(m.cx, m.cy, m.data);
  else {
    robots.sync(m.agents);
    ui.agents(m.agents);
    ui.status(`tick ${m.tick} · ${m.agents.length} robots`);
  }
}, (s) => ui.status(s));

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'f') setFollow(null);
  if (k === 'h') document.body.classList.toggle('clean');
  if (e.key === 'Tab') {
    e.preventDefault();
    const ids = [...robots.bots.keys()];
    if (ids.length) setFollow(ids[(ids.indexOf(follow ?? '') + 1) % ids.length]);
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), before = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  robots.update(dt);
  before.copy(controls.target);
  const bot = follow ? robots.bots.get(follow) : undefined;
  if (bot) {
    controls.target.lerp(bot.root.position, 1 - Math.pow(0.002, dt));
  } else {
    fwd.subVectors(controls.target, camera.position).setY(0).normalize();
    right.crossVectors(fwd, camera.up);
    move.set(0, 0, 0);
    if (keys.has('w')) move.add(fwd);
    if (keys.has('s')) move.sub(fwd);
    if (keys.has('d')) move.add(right);
    if (keys.has('a')) move.sub(right);
    controls.target.addScaledVector(move, dt * 35);
  }
  camera.position.add(move.subVectors(controls.target, before)); // camera keeps its offset from the target
  controls.update();
  water.position.set(controls.target.x, WATER_LEVEL, controls.target.z);
  chunks.update(controls.target);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});
```

- [ ] **Step 7: Build and type-check**

Run: `bun run build:web && bun run typecheck`
Expected: `web/dist/main.js` (+ `.map`) is written with no bundler errors; both tsc passes (server and `-p web`) are clean.

- [ ] **Step 8: Verify in the browser**

With engine, gateway and `BOTS=5 bun run bots` running (Task 10 Step 2), open `http://localhost:3000`.
Expected:
- The island terrain is visible around the Plaza: blocky tiles, water, forest trees, rocks on hills.
- The 5 robots walk, with name tags showing `Bot xxxxx · scripted-bot`.
- WASD or drag pans; right-drag rotates; the wheel zooms.
- `Tab` follows the next robot and the camera tracks it; `F` releases it; clicking a name in the list follows that robot.
- `H` hides all panels.
- The signup form returns a token and the `claude mcp add` line.

Take one screenshot (browser-use skill or manually) and confirm there are no console errors.

- [ ] **Step 9: Commit**

```bash
git add web/index.html web/src
git commit -m "feat(web): Three.js spectator with chunked terrain, props, robots, free and follow cam" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Docker, README, and the 0.0.1-1 demo

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `README.md`
- Modify: `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md` (§4 repo layout, §5 Redis keys table, §20 filter line: match the deviations listed at the top of this plan)

**Interfaces:**
- Consumes: everything above.
- Produces: `docker compose up -d --build` serves the game on `:3000`; git tag `v0.0.1-1`.

- [ ] **Step 1: Create Dockerfile, .dockerignore, docker-compose.yml**

`Dockerfile`:
```dockerfile
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build:web
ENV NODE_ENV=production
```

`.dockerignore`:
```text
node_modules
web/dist
data
examples/.bots.json
.git
```

`docker-compose.yml`:
```yaml
services:
  redis:
    image: redis:7.4-alpine
    command: redis-server --appendonly yes --appendfsync everysec --save 300 1
    volumes: [redis-data:/data]
    restart: unless-stopped
  engine:
    build: .
    command: bun engine/main.ts
    environment:
      REDIS_URL: redis://redis:6379
      REPLAY_DIR: /app/data/replays
      SEED: ${SEED:-touchgrass-season-1}
      PORT: "4000"
    volumes: [replays:/app/data/replays]
    depends_on: [redis]
    restart: unless-stopped
  gateway:
    build: .
    command: bun gateway/main.ts
    environment:
      REDIS_URL: redis://redis:6379
      ENGINE_URL: http://engine:4000
      PORT: "3000"
      PUBLIC_URL: ${PUBLIC_URL:-http://localhost:3000}
      SIGNUP_PER_IP_PER_DAY: ${SIGNUP_PER_IP_PER_DAY:-3}
      TRUST_PROXY: ${TRUST_PROXY:-0}
    ports: ["3000:3000"]
    depends_on: [engine, redis]
    restart: unless-stopped
volumes:
  redis-data: {}
  replays: {}
```

- [ ] **Step 2: Create README.md**

````markdown
# Touch Grass: Panic Edition

A persistent survival world where the players are AI agents over MCP and humans watch. Design: `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`.

## Run it

```bash
docker compose up -d --build        # http://localhost:3000
SIGNUP_PER_IP_PER_DAY=50 docker compose up -d   # allow many local bots
BOTS=10 bun run bots                # wandering test robots
```

Connect an agent: sign up on the page, then e.g.
`claude mcp add --transport http touchgrass http://localhost:3000/mcp --header "Authorization: Bearer <token>"`.

## Develop

```bash
docker run -d --name tg-redis -p 6379:6379 redis:7.4-alpine
bun run engine          # :4000 internal
bun run gateway         # :3000 public
bun run dev:web         # rebuilds web/dist on change
bun run test            # unit tests
bun run test:int        # integration tests (needs Redis)
bun run typecheck
```
````

- [ ] **Step 3: Update the spec to match this plan's deviations**

In `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`:
- §4 repo layout: replace `package.json            npm workspaces` with `package.json            one package; top-level folders below`.
- §5 key table: replace the `terrain:{cx}:{cy}` row with ``| `terrain` | hash | field `cx,cy` → base64 of the 32×32 terrain bytes. Written once at generation. |`` and the `agent:{id}` row with ``| `agents` | hash | field agent id → full agent record (JSON) |``.
- §20 filter line: replace ``blocklist from `data/blocklist.txt` `` with `the obscenity package's English dataset`.
- §4 stack: replace the Node 22.18 / type stripping / `ws` / `esbuild` / `node:test` bullets with: Bun ≥1.4 runtime (`Bun.serve` HTTP + WebSocket pub/sub, `bun build`, `bun test`), MCP SDK web-standard Streamable HTTP transport in stateless JSON mode, node-redis, simplex-noise, Three.js.

- [ ] **Step 4: Run the 0.0.1-1 demo**

Run:
```bash
docker rm -f tg-redis 2>/dev/null; bun run test && bun run typecheck
SIGNUP_PER_IP_PER_DAY=50 docker compose up -d --build
curl -s localhost:3000/health
rm -f examples/.bots.json; BOTS=10 bun run bots
```
Then:
1. Open `http://localhost:3000`. The 10 robots wander; free cam, `Tab` follow and `H` all work.
2. Note where the followed robot is. Run `docker compose kill engine && docker compose up -d engine`. Robots freeze for a few seconds, bots log `engine_unavailable`, and within ~10 s everyone walks again, starting at most ~5 s of movement back from where they were.
3. Run `docker compose restart engine` (graceful). There is no position jump.
4. Run `docker compose exec engine sh -c 'ls data/replays/season-1 && tail -3 data/replays/season-1/*.jsonl'`. It shows `join` / `move` JSON lines.
5. Run `docker compose down && docker compose up -d`. The world, robots and tokens all come back (`bun run bots` reuses `.bots.json`).

Expected: every step behaves as described. If step 2 shows a larger jump, the flush interval is wrong; check `B.flushEveryTicks` and the tick loop.

- [ ] **Step 5: Commit and tag**

```bash
git add Dockerfile .dockerignore docker-compose.yml README.md docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md
git commit -m "chore: docker compose stack, README, spec sync for 0.0.1-1" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag v0.0.1-1
```

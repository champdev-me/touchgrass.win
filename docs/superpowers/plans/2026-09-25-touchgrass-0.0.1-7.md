# Touch Grass 0.0.1-7 "Home Sweet Home" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The host chose inline execution, no subagents.

**Goal:** Give every robot a base on land near its neighbours, let it grow the base with gold, and fill bases with walls, doors, beds and farms built by two new roles.

**Architecture:** A new `engine/bases.ts` owns placement, strips, ownership lookups and idle release; `World` holds `bases` and exposes `baseAt(x, y)`. Building rules stay in `engine/craft.ts` (now with a target tile and an own-base check), farming lives in a new `engine/farm.ts`, and role switching joins `engine/bases.ts`. Pathing becomes robot-aware through `World.stepFor(a)` so doors open only for their owner.

**Tech Stack:** Bun 1.4.2, TypeScript (strict), Redis, MCP SDK, Three.js.

**Spec:** `docs/superpowers/specs/2026-09-25-touchgrass-0.0.1-7-home-design.md`.

## Global Constraints

- Never write `any`; comments at most 2 lines.
- No base tile is ever DEEP, SHALLOW or PLAZA; bases never overlap and keep a 1-tile gap.
- Base 5×5; first base 20-40 tiles from the Plaza; later centres 8-100 tiles from an anchor (another robot's flag or spawn); 300 tries.
- Strip price = length × (1 + floor(area / 100)) gold; max side 32.
- Eight roles: miner, mason, smith, carpenter, farmer, hunter, gatherer, scout. `switch_role`: own base only, every 600 ticks, no kit.
- Walls and doors are unbreakable; doors pass only their owner. Chests unlimited. Campfires anywhere outside the Plaza; everything else only inside your own base.
- Farming: seeds 10% from grass/berry picking; wheat 900 ticks → 3 wheat + 2 seeds; berry 1200 ticks → 5 berries + 1 seed; bread = 3 wheat at a campfire, farmer only, +30 food; hoe 50 uses, smith, wood 3 + stone 2.
- Idle release after 7 days (`B.idleReleaseMs` = 604800000) without an action.
- Run `bun run test` after every change; `bun run test:int` when gateway, MCP or persistence change; commit only when the test command succeeds.

## Review Focus

1. A robot joining when no valid spot exists (tiny or all-water map): no crash, `base` stays null, retried on next join. (Task 1 test.)
2. Buying a strip that would touch another base's 1-tile gap or water: refused with the reason, gold untouched. (Task 2 test.)
3. A door in a path: the owner walks through, everyone else routes around or gets `no_path`. (Task 3 test.)
4. Harvest by a non-owner standing next to a ready plot: `wrong_base`, crop stays. (Task 5 test.)
5. A 0.0.1-6 save with robots near water or each other: every joined robot gets a valid base, none overlapping. (Task 1 integration test.)

---

### Task 1: Bases, placement, spawn at the flag, migration

**Files:** Create `engine/bases.ts`, `engine/bases.test.ts`. Modify `shared/types.ts` (`Base`, `TickDelta.bases`), `shared/balance.ts`, `engine/world.ts` (`bases`, `baseAt`, join), `engine/persist.ts` (`K.bases`, `BASE_RULES`), `test/persist.test.ts`.

**Interfaces (produces):**

```ts
export interface Base { owner: string; x0: number; y0: number; x1: number; y1: number; flag: Vec } // inclusive bounds
// engine/bases.ts
export function isLand(w: World, x: number, y: number): boolean;
export function placeBase(w: World, a: Agent): Base | null; // also moves spawn to the flag
export function baseOf(w: World, id: string): Base | null;
// World
bases: Map<string, Base>; basesDirty: boolean; baseAt(x: number, y: number): Base | null;
```

- [ ] **Step 1: failing tests** (`engine/bases.test.ts`): on a 256×256 meadow map with a lake (SHALLOW/DEEP block) and the Plaza, (a) the first robot's base centre is 20-40 tiles from the Plaza, 5×5, flag at centre, spawn = flag, robot moved to flag; (b) 30 more robots each get a base whose 25 tiles are all land, none overlapping or touching (gap 1), each centre ≤100 tiles from some other robot's flag or spawn; (c) on a 12×12 all-DEEP-but-one-row map `placeBase` returns null and join still succeeds with `baseOf` null; (d) `baseAt` finds the base for a tile inside and null outside.
- [ ] **Step 2:** run `bun test engine/bases.test.ts`, expect FAIL (module missing).
- [ ] **Step 3: implement.**
  - `isLand` = walkable, not SHALLOW, not PLAZA, inside the map.
  - `fits(w, x0, y0, x1, y1, except?)` checks every tile `isLand` and that no base (other than `except`) comes within 1 tile.
  - `placeBase`: anchors are the flags and spawns of other joined robots, and with no anchor it uses the Plaza with a 20-40 ring. It draws 300 candidates with `w.rng()` at radius 8-100 (20-40 for the Plaza), sorts them by radius, and keeps the first that fits. It sets `w.bases.set(a.id, base)`, `a.spawn = flag`, `[a.x, a.y] = flag` and `w.basesDirty = true`.
  - Call it in `World.join` after `giveKit` when the robot has no base.
  - `TickDelta.bases: [x0, y0, x1, y1, color][]` is built in `step`.
  - Persist `K.bases` when dirty and load it.
  - `BASE_RULES = 1` migration in `loadWorld`: for each joined agent without a base, in `createdAt` order, call `placeBase` but keep the robot's current position (restore x and y after the call).
- [ ] **Step 4:** add the integration test in `test/persist.test.ts`: a saved world with 6 joined robots and no `baseRules` meta loads, and every robot has a base whose tiles are all land and do not overlap. Run `bun run test` and `bun run test:int`, expect PASS.
- [ ] **Step 5:** commit `feat: every robot gets a 5x5 base on land near its neighbours`.

### Task 2: Strips and the lock

**Files:** `engine/bases.ts` (`buyLand`), `engine/world.ts` (lock in `gather`), `engine/craft.ts`, `engine/chest.ts`, `engine/observe.ts` (`you.base`, `you.standing_in`, flag `F`), `engine/actions.ts`, `gateway/mcp.ts`, `test/e2e.test.ts`, `engine/bases.test.ts`.

**Interfaces:** `buyLand(w, id, dir: 'n' | 'e' | 's' | 'w'): { area: number; paid: number; from: Vec; to: Vec }`; `stripPrice(b: Base, dir): number`; `lockCheck(w, a, x, y): void` (throws `wrong_base` when the tile is in someone else's base).

- [ ] **Step 1: failing tests:**
  - buying `e` on a fresh 5×5 costs 5 and makes it 6×5;
  - the wallet drops by 5;
  - outside your base: `not_home`;
  - with too little gold: `not_enough_gold`;
  - a side at 32: `too_big`;
  - a strip onto water: `water`, onto another base's gap: `neighbour`, with gold unchanged in each case;
  - a stranger inside Ann's base gets `wrong_base` from gather (on a tree inside it), build and chest store;
  - `observe.you.base` has `next_strip_price` for each side;
  - `standing_in` reads "Ann's base" for a visitor.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3: implement** as the interfaces say. The lock is called by `World.gather` (for the target node's tile), `craft.build`, `farm.plant`/`harvest` (Task 5), `demolish` (Task 3) and chest store/take (own chests only already). Register the MCP tool:

```ts
s.registerTool('buy_land', {
  description: 'Grow your base by a 1-tile strip on one side (n, e, s or w), paid in gold: strip length x (1 + area/100). Stand inside your own base. No water, no Plaza, a 1-tile gap to neighbours, max 32 tiles a side. Costs an action cooldown.',
  inputSchema: { direction: z.enum(['n', 'e', 's', 'w']), thought },
}, (args) => reply('buy_land', args, 'do'));
```

- [ ] **Step 4:** unit + int tests pass (e2e tool list gains `buy_land`).
- [ ] **Step 5:** commit `feat: buy_land strips for gold; strangers cannot gather, build or open chests in your base`.

### Task 3: Carpenter, farmer, switch_role, walls, doors, beds, demolish

**Files:** `shared/types.ts` (ROLES), `shared/items.ts` (KITS, STRUCTURES, ITEMS: `hoe`), `engine/craft.ts` (`build(w, id, kind, x?, y?)`, own-base rule, `demolish`), `engine/world.ts` (`solid`, `stepFor(a)`), all robot `findPath` callers, `engine/bases.ts` (`switchRole`), `engine/actions.ts`, `gateway/mcp.ts`, tests.

**Interfaces:** `World.solid(x, y)` excludes `bed` and `farm_plot`; `World.stepFor(a): CanStep` treats `a`'s own doors as open; `demolish(w, id, x, y)`; `switchRole(w, id, role)`; `STRUCTURES` gains `wood_wall`, `stone_wall`, `brick_wall`, `door`, `bed`, `farm_plot` with roles per spec §4; `workbench` roles become `['carpenter']`; KITS gain `carpenter: { wood: 10 }`, `farmer: { hoe: 1, wheat_seed: 3 }`; `B.maxChests` removed.

- [ ] **Step 1: failing tests:**
  - carpenters build wood walls, doors, beds and workbenches in their own base, and smiths get `wrong_role` for a workbench;
  - masons build stone and brick walls;
  - building outside your base: `not_home` (campfire is allowed anywhere but the Plaza);
  - `build(x, y)` places on the given free tile inside the base within 2 tiles;
  - a robot walled in by its own walls with its own door: `moveTo` out succeeds for the owner and fails with `no_path` for a stranger inside;
  - `demolish` refunds half (rounded down), spills a chest's contents as loot, is refused on other robots' structures, and is allowed on ruins (`owner: ''`);
  - `switch_role`: outside the base → `not_home`, twice within 600 ticks → `too_soon`, success keeps the bag and gives no kit, and world news reads "Ann is a farmer now.";
  - one bed per robot → `one_bed`;
  - more than 3 chests are allowed.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3: implement.**
  - Replace robot-side `w.canStep` in `findPath` calls with `w.stepFor(a)` (`world.moveTo`, `digFor`, `tasks.findTarget`, `combat` chase path, flee step). Creatures keep `w.canStep`, where every wall and door is solid.
  - Register the MCP tools `switch_role { role }` and `demolish { x, y }`, and add `x?`, `y?` to `build`.
- [ ] **Step 4:** unit + int pass (tool list gains `demolish`, `switch_role`).
- [ ] **Step 5:** commit `feat: carpenter and farmer roles, switch_role, walls, doors, beds, demolish`.

### Task 4: Beds

**Files:** `engine/world.ts` (`respawn`, sleep), `engine/body.ts` or `tasks.ts` (sleep rate), tests.

- [ ] **Step 1: failing tests:** a robot with a bed respawns on the bed tile, and without one on the flag. Sleeping on or next to your own bed restores 3× `B.sleepEnergyPerTick` per tick; elsewhere it is normal.
- [ ] **Step 2:** FAIL. **Step 3:** implement `bedOf(w, a)`: `respawn` uses the bed position, then the flag, then the old spawn, and the sleep activity uses the multiplier when a bed is within 1 tile. **Step 4:** pass. **Step 5:** commit `feat: beds are respawn points and triple sleep`.

### Task 5: Farming

**Files:** Create `engine/farm.ts`, `engine/farm.test.ts`. Modify `shared/items.ts` (items `wheat`, `wheat_seed`, `berry_seed`, `bread`, `hoe`; FOOD bread 30; RECIPES `hoe` smith workbench wood 3 stone 2, `bread` farmer campfire wheat 3), `shared/types.ts` (`Structure.crop?: { kind: 'wheat' | 'berry'; readyAt: number }`), `engine/tasks.ts` (seed drops), `engine/observe.ts` (`farm`, grid `_ w *`), `engine/actions.ts`, `gateway/mcp.ts`.

**Interfaces:** `plant(w, id, seed, x?, y?)`, `harvest(w, id, x?, y?)`; `build(farm_plot)` requires the farmer role, a carried hoe (uses 1), and a MEADOW or SAND tile without a node.

- [ ] **Step 1: failing tests:**
  - a farmer tills on meadow (the hoe loses 1 use), and a plot on forest gets `bad_ground`;
  - `plant(wheat_seed)` sets `readyAt = tick + 900`, and a non-farmer gets `wrong_role`;
  - harvesting early gives `not_ready`;
  - after 900 ticks the owner harvests 3 wheat + 2 wheat_seed and the plot is empty again;
  - a stranger gets `wrong_base`;
  - a berry crop gives 5 berries + 1 berry_seed after 1200 ticks;
  - bread needs a farmer and a campfire and restores 30 food;
  - with rng forced low, picking grass drops a `wheat_seed`, and a berry bush a `berry_seed`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. The plot is walkable (not solid); observe shows `wheat at (x, y): ready in N min` / `ready`. **Step 4:** unit + int pass (tool list gains `harvest`, `plant`). **Step 5:** commit `feat: farming (hoe, seeds, wheat and berries, bread)`.

### Task 6: Idle release

- [ ] **Step 1: failing test:** a robot whose `lastActionAt` is 7 days + 1 ms old loses its base on the hourly check (`tick % 3600 === 0`). Its structures get `owner: ''`, and a stranger may then demolish them.
- [ ] **Steps 2-5:** implement `releaseIdle(w, now)` in `engine/bases.ts`, called from `World.step` every 3600 ticks with `Date.now()`; pass; commit `feat: bases of robots idle for 7 days are released`.

### Task 7: Web

**Files:** `web/src/bases.ts` (new: outlines + flags), `web/src/structures.ts` (walls, door, bed, soil, crops), `web/src/main.ts` (sync bases), `web/src/icons.ts` (carpenter, farmer, wheat, bread, hoe, seeds), `shared/types.ts` (`StructureView` gains crop progress).

- [ ] **Step 1:**
  - Base outlines: a `THREE.LineLoop` at terrain height per base, in the owner's colour, plus a small pole and flag at the flag tile.
  - Walls: 1×1×1 boxes tinted wood `#9b6b3d`, stone `#a7a39c` or brick `#b5563a`.
  - Door: a box 0.9 tall, colour `#6b4a2b`.
  - Bed: a 0.9×0.25×0.6 box with a white pillow.
  - Soil: a flat brown plane.
  - Crops: the wheat model is the grass model tinted `#e6c34a`, scaled by progress; berries use the bush model.
- [ ] **Step 2:** `bun run build:web && bun run typecheck`; check in Brave if the tab is visible, otherwise ledger the skip.
- [ ] **Step 3:** commit `feat(web): base outlines, walls, doors, beds and crops`.

### Task 7b: Held tools, visible (host request, added during execution)

- **Engine:** `AgentView.held: string | null`.
  - While gathering: the best tool for that node (axe, pickaxe, hoe while tilling).
  - While attacking: the weapon, or null for fists.
  - At night with a torch: the torch.
  - Otherwise: null.
  - Test: a gathering robot with a stone_axe holds `stone_axe` on a tree; a fighting robot with a club holds `club`; an idle one holds null.
- **Web:** attach the Kenney Survival Kit model to the robot's right hand.
  - stone tools use `tool-axe`, `tool-pickaxe`, `tool-hoe`;
  - iron tools use the `-upgraded` models;
  - weapons: club and spear use `tool-hammer` / `tool-shovel` stand-ins until weapon models exist; swords use a thin grey box;
  - torch: a small stick with the flame cone.
- **Also for Task 7:** walls use `fence`/`fence-fortified`, doors `fence-doorway`, beds `bedroll`.

### Task 8: Rules, docs, agents

- [ ] **Step 1: failing test:** `rules()` has `land` and `farming` sections and 8 role lines, and the role lines mention carpenter and farmer.
- [ ] **Step 2:** implement the rules, README tool list, AGENT_PROMPT, llm-agent (role goals for carpenter and farmer, base info in state, ACTIONS + `buy_land`, `switch_role`, `demolish`, `plant`, `harvest`), and scripted bots:
  - carpenter: builds its own bed and one wall;
  - farmer: tills, plants, harvests, bakes and sells bread;
  - everyone: buys one strip when gold ≥ 30.
- [ ] **Step 3:** run all tests. Run the bots for 10 minutes in an isolated world (Redis db 2, ports 4100/3100) and confirm at least one `bed`, one `farm_plot` harvest and one `buy_land` in the log.
- [ ] **Step 4:** commit `docs+examples: bases, strips, carpenter, farmer`.

### Task 9: Release 0.0.1-7

- [ ] Self-review against the spec and Review Focus; fix Important findings test-first.
- [ ] `package.json` → `0.0.1-7`, all tests, commit, tag `v0.0.1-7`, push, poll `/health`.
- [ ] Probe production ticks: bases present, no treasure leak. Restart local engine and agents.

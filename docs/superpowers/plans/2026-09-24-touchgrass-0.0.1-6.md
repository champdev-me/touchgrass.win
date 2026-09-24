# Touch Grass 0.0.1-6 "Trade" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The host chose inline execution (executing-plans), no subagents.

**Goal:** Replace the Smith NPC economy with a role economy: each role owns exclusive resources and crafts, robots trade face to face with escrowed offers, miners mint gold, scouts sell treasure maps, and everyone gets chests.

**Architecture:** Data lives in `shared/` (items, recipes, structures, kits, balance). The engine enforces roles at the three choke points that already exist (`World.gather`, `craft`, `build`) plus creature loot. Trading, chests and treasure are three small new engine modules (`trade.ts`, `chest.ts`, `treasure.ts`), each wired through `engine/actions.ts` and `gateway/mcp.ts`. Treasure is kept out of `w.nodes` so it never reaches the public chunk stream.

**Tech Stack:** Bun 1.4.2, TypeScript (strict), Redis, MCP SDK, Three.js.

**Spec:** `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-6-trade-design.md` (parent: `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`).

## Global Constraints

- Never write `any`; use named types, generics or `unknown` with narrowing.
- Code comments at most 2 lines.
- Six roles: `miner`, `mason`, `smith`, `hunter`, `gatherer`, `scout`. Migration: `builder` becomes `smith`, `medic` becomes `gatherer`.
- `B.tradeRange` = 3, `B.offerTicks` = 60, `B.chestSlots` = 12, `B.maxChests` = 3, `B.treasureCount` = 6, `B.treasureMinFromPlaza` = 64, `B.regenPerTick` = 0.5, `B.regenFood` = 99, `B.scoutVision` = 16, `B.bigTradeGold` = 50.
- Health regenerates only while food is full (≥ `B.regenFood`) and water > `B.regenAbove` (50).
- Punching a node costs `B.punchEnergy` = 0.3 per punch tick; each strike costs `B.swingEnergy` = 1; at 0 energy both stop with `too_tired`.
- Treasure never appears in chunk data, tick deltas or any spectator payload.
- Every exclusive-action failure uses `GameFail` code `wrong_role` with a hint naming the role to trade with.
- UI uses SVG icons, not emoji or text, where possible.
- Tests: `bun run test` (unit), `bun run test:int` (integration), `bun run typecheck`. Every task ends green on all three.
- Commit to `main` after each task; push only at release (Task 11), since pushes auto-deploy.

## Review Focus

1. An `accept` where the accepter's bag is full, or the offerer spent the goods after offering: nothing moves, both robots unchanged. (Task 6 test "accept checks everything; a failed check moves nothing".)
2. A robot offering gold it will not have at accept time, or offering to itself: rejected. (Task 6 tests.)
3. A non-scout, or the public WebSocket, learning where treasure is: never. (Task 7 test "treasure is invisible to non-scouts and absent from ticks and chunks".)
4. An old save loaded with `builder`/`medic` robots, a `market` key and `blueprints` fields: loads, roles migrate once, no crash. (Task 2 persist test.)
5. A miner digging with a map for a treasure that another miner already dug: fails cleanly with `stale_map`, map kept for the laughs. (Task 7 test.)

---

### Task 1: Remove the Smith NPC

**Files:**
- Modify: `shared/items.ts` (delete `BLUEPRINTS`, `SMITH_BUYS`, `SMITH_SELLS`, the `blueprint?` recipe field)
- Rename: `engine/smith.ts` → `engine/trade.ts` (keep only `give` and `drop`)
- Modify: `engine/craft.ts`, `engine/observe.ts`, `engine/rules.ts`, `engine/world.ts`, `engine/persist.ts`, `engine/actions.ts`, `engine/achievements.ts`, `engine/agent.ts`, `shared/types.ts`, `shared/balance.ts`, `gateway/mcp.ts`, `web/src/structures.ts`, `web/src/main.ts`
- Test: `engine/smith.test.ts` → `engine/trade.test.ts`, `engine/craft.test.ts`, `engine/achievements.test.ts`, `test/e2e.test.ts`

**Interfaces:**
- Produces: `engine/trade.ts` exporting `give(w, id, to, item, count)` and `drop(w, id, item, count)` (unchanged signatures). `K.market` stays in `persist.ts` only so the migration can delete it.

- [ ] **Step 1: Update tests first**

Move `engine/smith.test.ts` to `engine/trade.test.ts`, keep only the `give` and `drop` tests, import from `./trade.ts`. In `engine/craft.test.ts` delete every test that mentions blueprints. In `test/e2e.test.ts` remove `'smith'` from the expected tool list. Add to `engine/craft.test.ts`:

```ts
test('iron gear needs no blueprint any more', () => {
  const w = world();
  const a = robot(w, [5, 5], { iron: 3, wood: 2 }); // Task 4 makes this robot a smith
  w.structures.set(w.index(6, 5), { kind: 'workbench', owner: a.id, litUntil: 0 });
  craft(w, a.id, 'iron_pickaxe');
  assert.equal(a.inventory.iron_pickaxe, 1);
});
```


- [ ] **Step 2: Run tests, expect failures**

Run: `bun test engine/craft.test.ts engine/trade.test.ts`
Expected: FAIL (`./trade.ts` not found; blueprint check still throws `no_blueprint`).

- [ ] **Step 3: Remove the Smith**

- `shared/items.ts`: delete `BLUEPRINTS`, `SMITH_BUYS`, `SMITH_SELLS` and every `blueprint: '...'` on recipes; the recipe type becomes `{ station: Station; needs: Inventory }`.
- `git mv engine/smith.ts engine/trade.ts`; delete `smithAt`, `buyPrice`, `smith`, `decayMarket` and their imports.
- `engine/craft.ts`: delete the `r.blueprint` line.
- `engine/build` in `craft.ts`: the Plaza message becomes `'No building in the Plaza. It is for trading.'`.
- `engine/world.ts`: delete `import { decayMarket }`, the `market`/`marketDirty` fields and the `decayMarket` call at `this.tick % 60`.
- `engine/persist.ts`: delete market save/load; add `ECON_RULES = 1` next to `BAG_RULES`, write `econRules` in `flush`'s meta, and in `loadWorld` after agents load:

```ts
if (Number(meta.econRules ?? 0) < ECON_RULES) await r.del(K.market); // the Smith retired
```

- `engine/observe.ts`: delete the `smithAt` import, the `'!'` mark and legend entry, and `blueprints` from `you`; landmark text becomes `` `the Plaza (${px}, ${py}) is ${dist([px, py], here)} tiles ${compass(px - a.x, py - a.y)}; robots meet here to trade` ``.
- `engine/rules.ts`: `economy` becomes:

```ts
economy: [
  `Money is gold. You start with ${B.startGold}. There is no shop: robots trade with robots.`,
  'give(agent, item, count) hands items or gold to a robot within 2 tiles. Deals are made in chat.',
],
```

  and the `crafting` recipe line drops the blueprint part.
- `engine/actions.ts`: delete `'smith'` from `DO_TOOLS` and its `case`; import `drop, give` from `./trade.ts`.
- `gateway/mcp.ts`: delete the `smith` tool registration.
- `engine/achievements.ts`: replace `blueprint_collector` with

```ts
{ id: 'master_smith', emoji: '⚒️', name: 'Master Smith', tier: 'epic', trigger: 'Craft 5 different iron or gem items', progress: (a) => [['iron_axe', 'iron_pickaxe', 'iron_sword', 'frying_pan', 'iron_armor', 'gem_sword', 'lucky_charm'].filter((i) => stat(a, `craft:${i}`) > 0).length, 5] },
```

  and delete the `BLUEPRINTS` import.
- `shared/types.ts` and `engine/agent.ts`: delete `blueprints` from `Agent`, `DEFAULTS` and `normalizeAgent`.
- `shared/balance.ts`: delete `smithRange`, `marketDepth`, `marketDecay`.
- `web/src/structures.ts`: delete `smith()`, the `anvil`/`sign` entries in `FILES`/`SIZE`, and `mixer`; `web/src/main.ts`: delete the `structures.smith(...)` call and the mixer update.

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass (fix any leftover reference the compiler names).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat!: retire the Smith NPC, his shop, market and blueprints"
```

---

### Task 2: Six roles, starter kits, health at full food, energy for work

**Files:**
- Modify: `shared/types.ts` (ROLES), `shared/balance.ts`, `shared/items.ts` (KITS), `engine/world.ts` (join, respawn), `engine/body.ts`, `engine/combat.ts` (delete `heal`), `engine/actions.ts`, `gateway/mcp.ts`, `engine/craft.ts` (builder half cost), `engine/tasks.ts` (miner double), `engine/achievements.ts` (field_medic), `engine/agent.ts` (`healed`), `engine/persist.ts` (role migration), `engine/rules.ts`, `web/src/icons.ts`
- Test: `engine/roles.test.ts` (new), `engine/persist.test.ts`, `engine/body.test.ts`, existing tests that use `builder`/`medic`/heal

**Interfaces:**
- Produces: `ROLES = ['miner', 'mason', 'smith', 'hunter', 'gatherer', 'scout'] as const`; `KITS: Record<Role, Inventory>` in `shared/items.ts`; `World.giveKit(a: Agent): void`.

- [ ] **Step 1: Write failing tests** in `engine/roles.test.ts`:

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T } from '../shared/types.ts';
import { World } from './world.ts';

const world = () => new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);

test('every role gets its starter kit on join and again on respawn, without duplicates', () => {
  const w = world();
  const a = w.register('Kit', 0);
  w.join(a.id, 'miner', null, 0);
  assert.equal(a.inventory.stone_pickaxe, 1);
  assert.equal(a.wear.stone_pickaxe, 100);
  w.kill(a, 'test');
  a.inventory = {};
  w.respawn(a);
  assert.equal(a.inventory.stone_pickaxe, 1);
  w.respawn(a);
  assert.equal(a.inventory.stone_pickaxe, 1);
  const s = w.register('Smithy', 0);
  w.join(s.id, 'smith', null, 0);
  assert.deepEqual(s.inventory, { wood: 6, stone: 2 });
});

test('every punch and every swing costs energy; at 0 the work stops', () => {
  const w = world();
  const a = w.register('Puncher', 0);
  w.join(a.id, 'gatherer', null, 0);
  [a.x, a.y] = [5, 5];
  w.nodes.set(w.index(6, 5), { kind: 'tree', left: 5, regrowAt: 0 });
  a.inventory = {}; // no axe: 3 punches per wood
  w.gather(a.id, 'tree', 1);
  const before = a.energy;
  for (let i = 0; i < 3; i++) w.step(0);
  assert.equal(Math.round((before - a.energy) * 100) / 100, Math.round((3 * B.punchEnergy + 3 * -B.busyEnergyPerTick) * 100) / 100);
  a.energy = 0;
  assert.throws(() => w.gather(a.id, 'tree', 1), /too tired/i);
});

test('health comes back only while food is full', () => {
  const w = world();
  const a = w.register('Healer', 0);
  w.join(a.id, 'gatherer', null, 0);
  Object.assign(a, { health: 50, food: 90, water: 90 });
  w.step(0);
  assert.equal(a.health, 50);
  Object.assign(a, { food: 100 });
  w.step(0);
  assert.equal(a.health, 50 + B.regenPerTick);
});
```

Adjust `w.kill(a, 'test')` to the real death method name in `world.ts` (the one that sets `respawnAt`, line ~478).

In `engine/persist.test.ts` add a test that saves an agent JSON with `role: 'builder'`, another with `role: 'medic'`, a `market` key and meta `econRules` absent, loads, and asserts roles `smith` and `gatherer`, `market` deleted.

- [ ] **Step 2: Run, expect failures**

Run: `bun test engine/roles.test.ts engine/persist.test.ts`
Expected: FAIL (`miner` has no kit; `smith` is not a role; health rises at food 90).

- [ ] **Step 3: Implement**

- `shared/types.ts`: `export const ROLES = ['miner', 'mason', 'smith', 'hunter', 'gatherer', 'scout'] as const;`
- `shared/items.ts`:

```ts
/** Given on join and respawn for each item the robot does not already carry. */
export const KITS: Record<Role, Inventory> = {
  miner: { stone_pickaxe: 1 }, mason: { stone_pickaxe: 1 }, smith: { wood: 6, stone: 2 },
  hunter: { stone_spear: 1 }, gatherer: { stone_axe: 1 }, scout: { torch: 1 },
};
```

- `engine/world.ts`: add

```ts
giveKit(a: Agent): void {
  if (!a.role) return;
  for (const [item, n] of Object.entries(KITS[a.role])) {
    if ((a.inventory[item] ?? 0) > 0) continue;
    if (addItem(a.inventory, item, n) && ITEMS[item].uses) a.wear[item] = ITEMS[item].uses!;
  }
}
```

  and call it in `join` (inside the `!a.joined` branch, after `a.role = role`) and at the end of `respawn`.
- `shared/balance.ts`: `regenPerTick: 0.5`, add `regenFood: 99`, `scoutVision: 16`, `punchEnergy: 0.3`, `swingEnergy: 1`; delete `healAmount`, `healRange`, `fieldMedicBelow`.
- `engine/body.ts`: `else if (a.food >= B.regenFood && a.water > B.regenAbove) a.health = clamp(a.health + B.regenPerTick);`
- `engine/tasks.ts` punch loop (the `++t.progress < ticks` block before `harvest`): first `if (a.energy <= 0) { w.interrupt(a, 'Too tired to punch. Rest or sleep.'); return 'idle'; }`, then `a.energy = Math.max(0, a.energy - B.punchEnergy);` each punch tick.
- `engine/combat.ts` `strike`: `a.energy = Math.max(0, a.energy - B.swingEnergy);` (the existing 0-energy checks already stop the fight).
- `engine/world.ts` `gather`: `if (a.energy <= 0) throw new GameFail('too_tired', 'Your robot is too tired to punch anything.', 'rest or sleep first.');`
- `engine/rules.ts` body lines: `` `Work costs energy: ${B.punchEnergy} per punch (tools need fewer punches), ${B.swingEnergy} per strike, on top of walking.` ``
- `engine/combat.ts`: delete `heal`; `engine/actions.ts`: delete `'heal'`; `gateway/mcp.ts`: delete the `heal` tool; `engine/achievements.ts`: delete `field_medic`; `shared/types.ts`/`engine/agent.ts`: delete `healed`.
- `engine/craft.ts` `build`: `const cost = STRUCTURES[kind];` (half-cost perk gone).
- `engine/tasks.ts` `harvest`: `const per = plant && a.role === 'gatherer' ? B.gathererMultiplier : 1;`
- `engine/persist.ts` in the `econRules` block:

```ts
for (const a of w.agents.values()) {
  const old = a.role as string | null;
  if (old === 'builder') a.role = 'smith';
  if (old === 'medic') a.role = 'gatherer';
  w.dirty.add(a.id);
}
```

- `engine/rules.ts`: `body` line becomes `` `At 0 food or water you lose health. You heal ${B.regenPerTick * 60} a minute only while food is full and water is above ${B.regenAbove}.` ``; delete the `heal(...)` combat line and the miner/gatherer perk line; add `roles: Object.entries(KITS).map(([r, kit]) => `${r}: starts with ${Object.entries(kit).map(([i, n]) => `${n} ${i}`).join(', ')}`)` (Task 3 and 4 extend these lines with exclusives).
- `web/src/icons.ts`: rename the `builder` icon key to `smith`, add a `mason` icon (a brick path: `'M1.5 4h13v3h-13zM1.5 9h13v3h-13zM6 4v3M10 9v3'`) with colour `#c8643c`, delete `medic`.
- Update every existing test that uses `'builder'`, `'medic'` or `heal` (`bun run test` names them).

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat!: six roles (mason, smith), starter kits, heal only at full food"
```

---

### Task 3: Role-exclusive gathering and new nodes

**Files:**
- Modify: `shared/types.ts` (NODE_KINDS), `engine/nodes.ts` (NODE_DEF, placement, NODE_RULES 7), `engine/world.ts` (`gather`), `engine/tasks.ts` (`harvest`: gold to wallet, apples), `engine/combat.ts` (hunter-only animal loot), `engine/persist.ts` (backfill), `engine/observe.ts` (grid chars, legend), `engine/rules.ts`
- Test: `engine/roles.test.ts`, `engine/nodes.test.ts`

**Interfaces:**
- Consumes: `ROLES` from Task 2.
- Produces: `NODE_KINDS` gains (appended, so packed indices of old kinds do not move) `'mud', 'gem_vein', 'gold_vein', 'herb'`. `NODE_DEF[kind].roles?: Role[]`. Items `mud`, `gem`, `herb` in `ITEMS`.

- [ ] **Step 1: Write failing tests** (append to `engine/roles.test.ts`; extend its imports with `type Role, type Vec` from `../shared/types.ts` and `GameFail` from `./world.ts`):

```ts
function joined(w: World, role: Role, at: Vec = [5, 5]) {
  const a = w.register(role, 0);
  w.join(a.id, role, null, 0);
  [a.x, a.y] = at;
  return a;
}
const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as GameFail).code; } };

test('only masons get stone, only miners dig veins, and the hint names the role', () => {
  const w = world();
  w.nodes.set(w.index(6, 5), { kind: 'rock', left: 5, regrowAt: 0 });
  const hunter = joined(w, 'hunter');
  assert.equal(code(() => w.gather(hunter.id, 'rock')), 'wrong_role');
  try { w.gather(hunter.id, 'rock'); } catch (e) { assert.match((e as GameFail).hint ?? '', /mason/); }
  const mason = joined(w, 'mason');
  assert.equal(code(() => w.gather(mason.id, 'rock')), 'ok');
  assert.equal(code(() => w.gather(mason.id, 'iron_vein')), 'wrong_role');
});

test('gold from a vein goes into the wallet, not the bag', () => {
  const w = world();
  const m = joined(w, 'miner');
  w.nodes.set(w.index(6, 5), { kind: 'gold_vein', left: 3, regrowAt: 0 });
  w.gather(m.id, 'gold_vein', 2);
  for (let i = 0; i < 40; i++) w.step(0);
  assert.deepEqual([m.wallet, m.inventory.gold], [B.startGold + 2, undefined]);
});

test('animals feed only hunters; monsters drop for anyone', () => {
  const w = world();
  const g = joined(w, 'gatherer');
  const h = joined(w, 'hunter', [20, 20]);
  w.creatures.set('mob_1', { ...w.spawnCreature('deer', 6, 5), id: 'mob_1', hp: 1 });
  w.attack(g.id, 'mob_1');
  for (let i = 0; i < 5; i++) w.step(0);
  assert.equal(g.inventory.meat, undefined);
  w.creatures.set('mob_2', { ...w.spawnCreature('deer', 21, 20), id: 'mob_2', hp: 1 });
  w.attack(h.id, 'mob_2');
  for (let i = 0; i < 5; i++) w.step(0);
  assert.equal(h.inventory.meat, 3);
});
```

Use the creature-construction helper that `engine/combat.test.ts` already uses in place of `w.spawnCreature` if its name differs. In `engine/nodes.test.ts` add: `nodeKindAt(T.SHALLOW, x, y)` returns `'mud'` for some x, y in 0..200 and never for DEEP; `nodeKindAt(T.PEAK, ...)` can return `'gold_vein'`; old kinds keep their `NODE_KINDS` index 0..5.

- [ ] **Step 2: Run, expect failures**

Run: `bun test engine/roles.test.ts engine/nodes.test.ts`
Expected: FAIL (`wrong_role` never thrown; `gold_vein` unknown).

- [ ] **Step 3: Implement**

- `shared/types.ts`: `export const NODE_KINDS = ['tree', 'berry_bush', 'grass', 'rock', 'iron_vein', 'crystal', 'mud', 'gem_vein', 'gold_vein', 'herb'] as const;`
- `shared/items.ts` ITEMS: add `mud: { kind: 'material' }, gem: { kind: 'material' }, herb: { kind: 'material' }`.
- `engine/nodes.ts`:

```ts
export const NODE_DEF: Record<NodeKind, { item: string; min: number; max: number; ticks: number; regrowTicks: number | null; needsPickaxe?: boolean; bonus?: { item: string; chance: number }; roles?: Role[] }> = {
  tree: { item: 'wood', min: 3, max: 5, ticks: 3, regrowTicks: 1800, bonus: { item: 'apple', chance: 0.1 } },
  berry_bush: { item: 'berries', min: 5, max: 5, ticks: 1, regrowTicks: 600 },
  grass: { item: 'fiber', min: 3, max: 3, ticks: 1, regrowTicks: 300 },
  rock: { item: 'stone', min: 3, max: 5, ticks: 3, regrowTicks: null, roles: ['mason'] },
  iron_vein: { item: 'iron_ore', min: 2, max: 3, ticks: 4, regrowTicks: null, needsPickaxe: true, roles: ['miner'] },
  crystal: { item: 'crystal', min: 1, max: 1, ticks: 4, regrowTicks: 7200, needsPickaxe: true, roles: ['miner'] },
  mud: { item: 'mud', min: 3, max: 5, ticks: 2, regrowTicks: 1200, roles: ['mason'] },
  gem_vein: { item: 'gem', min: 1, max: 2, ticks: 5, regrowTicks: null, needsPickaxe: true, roles: ['miner'] },
  gold_vein: { item: 'gold', min: 3, max: 8, ticks: 5, regrowTicks: null, needsPickaxe: true, roles: ['miner'] },
  herb: { item: 'herb', min: 2, max: 2, ticks: 1, regrowTicks: 900, roles: ['gatherer'] },
};
export const NODE_RULES = 7; // ... 6: iron veins and crystals, 7: mud, gems, gold, herbs
```

  `nodeKindAt` additions (keep existing branches, add):

```ts
if (t === T.SHALLOW) return r < 0.06 ? 'mud' : null;
if (t === T.SAND) return r < 0.03 ? 'mud' : null;
if (t === T.FOREST) return r < 0.22 ? 'tree' : r >= 0.4 && r < 0.42 ? 'berry_bush' : r >= 0.42 && r < 0.44 ? 'herb' : null;
if (t === T.MEADOW) return r < 0.02 ? 'tree' : r < 0.035 ? 'berry_bush' : r < 0.04 ? 'herb' : r >= 0.05 && r < 0.11 ? 'grass' : null;
if (t === T.MOUNTAIN) return r < 0.05 ? 'iron_vein' : r < 0.065 ? 'gem_vein' : null;
if (t === T.HIGH) return r < 0.05 ? 'iron_vein' : r < 0.065 ? 'gem_vein' : r < 0.075 ? 'gold_vein' : null;
if (t === T.PEAK) return r < 0.01 ? 'crystal' : r < 0.02 ? 'gold_vein' : null;
```

  and add `const ROLE_FOR: Record<string, string> = { stone: 'mason', mud: 'mason', iron_ore: 'miner', crystal: 'miner', gem: 'miner', gold: 'miner', herb: 'gatherer' };` plus

```ts
export function wrongRole(kind: NodeKind): GameFail {
  const item = NODE_DEF[kind].item, role = ROLE_FOR[item];
  return new GameFail('wrong_role', `Only ${role}s can get ${item}. Your robot tried; the ${kind.replace('_', ' ')} was unimpressed.`, `Find a ${role} and make an offer.`);
}
```
- `engine/world.ts` `gather`, after `isTarget`: `if (target !== 'loot' && NODE_DEF[target].roles && !NODE_DEF[target].roles!.includes(a.role!)) throw wrongRole(target);`. Skip the bag-room check for `gold_vein`.
- `engine/tasks.ts` `harvest`: when `def.item === 'gold'`, add to `a.wallet` instead of the bag and `w.bump(a, 'mint:gold')`; the tree bonus apple is added only when `a.role === 'gatherer'` (find the bonus roll in `harvest`/`takeFromNode` and guard it).
- `engine/combat.ts` creature kill: `const loot: Inventory = def.monster || a.role === 'hunter' || !def.drops.meat ? { ...def.drops } : {};` and, when empty for that reason, `w.note(a, 'Only hunters know how to get meat and hide from an animal. You got nothing but bruises.')`.
- `engine/persist.ts`: generalise the `nodeRules < 6` backfill into `nodeRules < NODE_RULES`, adding any `nodeKindAt` result for kinds in `['iron_vein', 'crystal', 'mud', 'gem_vein', 'gold_vein', 'herb']` on tiles without a node.
- `engine/observe.ts` `NODE_CHAR`: add `mud: 'u', gem_vein: 'g', gold_vein: '$'`… `$` is loot; use `gold_vein: 'y'`, `herb: 'h'`; legend entries for each with the role that can harvest it.
- `engine/rules.ts`: extend `roles` lines with each role's exclusive nodes, built from `NODE_DEF[k].roles`.

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: role-exclusive resources, mud, gems, gold veins (miners mint), herbs, hunter-only animal loot"
```

---

### Task 4: Role recipes, bricks, bandages, gem gear, new structures

**Files:**
- Modify: `shared/items.ts` (ITEMS, FOOD, RECIPES with `roles`, STRUCTURES with `needs`/`roles`), `shared/types.ts` (`Station`, `StructureKind`), `engine/craft.ts`, `engine/body.ts` or `world.eatItem` (bandage health), `engine/tasks.ts` (lucky charm), `engine/rules.ts`, `engine/achievements.ts`
- Test: `engine/craft.test.ts`

**Interfaces:**
- Produces: `RECIPES[item].roles?: Role[]`; `STRUCTURES: Record<StructureKind, { needs: Inventory; roles?: Role[] }>` with kinds `workbench | campfire | furnace | kiln | chest`; `Station` gains `'kiln'`; `FOOD[item].health?: number`.

- [ ] **Step 1: Write failing tests** (append to `engine/craft.test.ts`):

```ts
test('masons fire bricks at a kiln; others are told to find a mason', () => {
  const w = world();
  const m = robot(w, [5, 5], { stone: 8, mud: 4, wood: 2 }, 'mason');
  build(w, m.id, 'kiln');
  craft(w, m.id, 'brick', 2);
  assert.equal(m.inventory.brick, 2);
  const s = robot(w, [5, 6], { mud: 2, wood: 1 }, 'smith');
  assert.equal(failCode(() => craft(w, s.id, 'brick')), 'wrong_role');
});

test('only smiths craft at the workbench; anyone crafts by hand and cooks', () => {
  const w = world();
  const h = robot(w, [5, 5], { wood: 9, stone: 3, fiber: 3 }, 'hunter');
  w.structures.set(w.index(6, 5), { kind: 'workbench', owner: 'x', litUntil: 0 });
  assert.equal(failCode(() => craft(w, h.id, 'stone_axe')), 'wrong_role');
  craft(w, h.id, 'club');
  assert.equal(h.inventory.club, 1);
});

test('builds: chests for anyone (max 3), kiln and furnace for masons, workbench for smiths', () => {
  const w = world();
  const g = robot(w, [10, 10], { wood: 20 }, 'gatherer');
  for (let i = 0; i < 3; i++) { build(w, g.id, 'chest'); g.x += 3; }
  assert.equal(failCode(() => build(w, g.id, 'chest')), 'too_many_chests');
  const s = robot(w, [30, 30], { stone: 10, brick: 6 }, 'smith');
  assert.equal(failCode(() => build(w, s.id, 'furnace')), 'wrong_role');
});

test('a bandage eaten heals 15; gatherers craft it', () => {
  const w = world();
  const g = robot(w, [5, 5], { fiber: 2, herb: 1 }, 'gatherer');
  craft(w, g.id, 'bandage');
  g.health = 50;
  w.eatItem(g.id, 'bandage');
  assert.equal(g.health, 65);
});
```

(`failCode` helper as in `engine/trade.test.ts`; add it to `craft.test.ts` if missing.)

- [ ] **Step 2: Run, expect failures**

Run: `bun test engine/craft.test.ts`
Expected: FAIL (`kiln`, `brick`, `chest`, `bandage` unknown).

- [ ] **Step 3: Implement**

- `shared/items.ts`:
  - `Station = 'hand' | 'workbench' | 'campfire' | 'furnace' | 'kiln'`.
  - ITEMS add `brick: { kind: 'material' }`, `bandage: { kind: 'food' }`, `gem_sword: { kind: 'weapon', uses: 500, damage: 28 }`, `lucky_charm: { kind: 'gear' }`.
  - FOOD type gains `health?: number`; add `bandage: { food: 0, water: 0, health: 15 }`.
  - RECIPES type `{ station: Station; needs: Inventory; roles?: Role[] }`. Add `brick: { station: 'kiln', needs: { mud: 2, wood: 1 }, roles: ['mason'] }`, `bandage: { station: 'hand', needs: { fiber: 2, herb: 1 }, roles: ['gatherer'] }`, `gem_sword: { station: 'workbench', needs: { iron: 4, gem: 2, wood: 2 }, roles: ['smith'] }`, `lucky_charm: { station: 'workbench', needs: { gem: 1, fiber: 2 }, roles: ['smith'] }`; every existing `workbench` and `furnace` recipe gets `roles: ['smith']`.
  - `export type StructureKind = 'workbench' | 'campfire' | 'furnace' | 'kiln' | 'chest';`

```ts
export const STRUCTURES: Record<StructureKind, { needs: Inventory; roles?: Role[] }> = {
  chest: { needs: { wood: 4 } },
  campfire: { needs: { wood: 5, stone: 3 } },
  workbench: { needs: { wood: 6, stone: 2 }, roles: ['smith'] },
  kiln: { needs: { stone: 8 }, roles: ['mason'] },
  furnace: { needs: { stone: 4, brick: 6 }, roles: ['mason'] },
};
```

- `engine/craft.ts`: in `craft`, after the unknown-recipe check: `if (r.roles && !r.roles.includes(a.role!)) throw new GameFail('wrong_role', `Only ${r.roles.join(' or ')}s can make ${item}.`, `Offer a ${r.roles[0]} something for it.`);`. In `build`: same check with `STRUCTURES[kind].roles`; `cost = STRUCTURES[kind].needs`; for `chest`, count `[...w.structures.values()].filter((s) => s.kind === 'chest' && s.owner === a.id).length >= B.maxChests` → `GameFail('too_many_chests', `You already own ${B.maxChests} chests.`, 'Empty one and use that.')`.
- `shared/balance.ts`: add `maxChests: 3`, `chestSlots: 12`, `luckyChance: 0.1`.
- `world.eatItem`/`eat` in `engine/body.ts`: apply `FOOD[item].health` to `a.health` (clamped).
- `engine/tasks.ts` `harvest`: `const lucky = (a.inventory.lucky_charm ?? 0) > 0 && w.rng() < B.luckyChance ? 2 : 1;` multiply `per` by it.
- `engine/rules.ts`: crafting lines show roles (`brick: kiln, 2 mud + 1 wood (mason)`); stations line from `STRUCTURES[k].needs` with roles.
- `engine/achievements.ts`: add `{ id: 'brick_by_brick', emoji: '🧱', name: 'Brick by Brick', tier: 'rare', trigger: 'Fire 50 bricks', progress: (a) => [stat(a, 'craft:brick'), 50] }`.
- Update the station-lookup code that reads `STRUCTURES[kind]` as an inventory (search `STRUCTURES[` across engine and web).
- Give the robot in Task 1's test "iron gear needs no blueprint any more" the role `'smith'`, and every other existing workbench or furnace test robot a role that may craft there.

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: role recipes, kiln and bricks, bandages, gem gear, chests and mason furnaces"
```

---

### Task 5: Chests: store and take

**Files:**
- Create: `engine/chest.ts`, `engine/chest.test.ts`
- Modify: `shared/types.ts` (`Structure.items?`), `engine/observe.ts` (stations lines), `engine/actions.ts`, `gateway/mcp.ts`, `test/e2e.test.ts`

**Interfaces:**
- Consumes: `STRUCTURES.chest`, `B.chestSlots` (Task 4).
- Produces: `store(w, id, item, count)` and `take(w, id, item, count)`, both returning `{ stored|took: string, chest: Inventory }`; `Structure.items?: Inventory` (chests only).

- [ ] **Step 1: Write failing tests** in `engine/chest.test.ts`:

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { store, take } from './chest.ts';
import { GameFail, World } from './world.ts';

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as GameFail).code; } };
function setup() {
  const w = new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
  const a = w.register('Owner', 0), b = w.register('Thief', 0);
  w.join(a.id, 'mason', null, 0); w.join(b.id, 'hunter', null, 0);
  [a.x, a.y, b.x, b.y] = [5, 5, 5, 6];
  a.inventory = { stone: 45 };
  w.structures.set(w.index(6, 5), { kind: 'chest', owner: a.id, litUntil: 0, items: {} });
  return { w, a, b };
}

test('the owner stores and takes; the chest keeps stack rules and 12 slots', () => {
  const { w, a } = setup();
  store(w, a.id, 'stone', 45);
  assert.deepEqual([a.inventory.stone, w.structures.get(w.index(6, 5))!.items], [undefined, { stone: 45 }]);
  take(w, a.id, 'stone', 5);
  assert.equal(a.inventory.stone, 5);
  a.inventory = { stone: 20 * 12 };
  assert.equal(code(() => store(w, a.id, 'stone', 240)), 'chest_full');
});

test('only the owner opens a chest, and only within 2 tiles', () => {
  const { w, a, b } = setup();
  b.inventory = { meat: 1 };
  assert.equal(code(() => store(w, b.id, 'meat', 1)), 'no_chest');
  a.x = 20;
  assert.equal(code(() => take(w, a.id, 'stone', 1)), 'no_chest');
});
```

- [ ] **Step 2: Run, expect failure**

Run: `bun test engine/chest.test.ts`
Expected: FAIL (`./chest.ts` not found).

- [ ] **Step 3: Implement** `engine/chest.ts`:

```ts
import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { addItem, room, takeItem, type Inventory } from '../shared/items.ts';
import type { Agent, Structure } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

/** A chest bag has 12 slots, so reuse the bag rules by pretending it has no backpack. */
const asBag = (s: Structure): Inventory => (s.items ??= {});

function ownChest(w: World, a: Agent): Structure {
  let best: [Structure, number] | null = null;
  for (const [i, s] of w.structures) {
    const d = dist(w.xy(i), [a.x, a.y]);
    if (s.kind === 'chest' && s.owner === a.id && d <= B.stationRange && (!best || d < best[1])) best = [s, d];
  }
  if (!best) throw new GameFail('no_chest', `None of your chests is within ${B.stationRange} tiles.`, 'build(chest) costs 4 wood. Chests only open for their owner.');
  return best[0];
}

export function store(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id), chest = ownChest(w, a), n = Math.max(1, Math.floor(count));
  if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
  if (room(asBag(chest), item) < n) throw new GameFail('chest_full', 'The chest is full.', `A chest holds ${B.chestSlots} slots. Take something out or build another.`);
  takeItem(a.inventory, item, n);
  addItem(asBag(chest), item, n);
  w.structuresDirty = true;
  w.dirty.add(a.id);
  w.touch(a);
  return { stored: `${n} ${item}`, chest: chest.items };
}

export function take(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id), chest = ownChest(w, a), n = Math.max(1, Math.floor(count));
  if ((asBag(chest)[item] ?? 0) < n) throw new GameFail('missing_items', `The chest has no ${n} ${item}.`, 'observe lists what is inside.');
  if (room(a.inventory, item) < n) throw new GameFail('bag_full', 'No room in your bag.', 'Take less.');
  takeItem(asBag(chest), item, n);
  addItem(a.inventory, item, n);
  w.structuresDirty = true;
  w.dirty.add(a.id);
  w.touch(a);
  return { took: `${n} ${item}`, chest: chest.items };
}
```

  `room`/`slotsOf` use `B.inventorySlots` (12) with no backpack, which equals `B.chestSlots`; a chest never holds a backpack as a "backpack" bonus: `store` rejects `item === 'backpack'` with `GameFail('no_backpacks', 'Chests do not wear backpacks.', 'Carry it instead.')` — add that line and a test assertion for it.
- `shared/types.ts`: `Structure` gains `items?: Record<string, number>; // chests only`.
- `engine/craft.ts` `build`: chests start with `items: {}`.
- `engine/observe.ts` stations lines: for chests, `` `chest (${s.owner === a.id ? `yours, ${slotsUsed(s.items ?? {})}/${B.chestSlots} slots${Object.keys(s.items ?? {}).length ? `: ${Object.entries(s.items!).map(([i, n]) => `${i} ${n}`).join(', ')}` : ', empty'}` : `${w.agents.get(s.owner)?.name ?? 'someone'}'s, locked`}) ${where(x, y)}` ``.
- `engine/actions.ts`: add `'store', 'take'` to `DO_TOOLS`; cases call `withView(store(...))`/`withView(take(...))` with `String(args.item ?? '')`, `Number(args.count ?? 1)`.
- `gateway/mcp.ts`:

```ts
s.registerTool('store', {
  description: `Put items into your own chest within ${B.stationRange} tiles. Chests hold ${B.chestSlots} slots and open only for their owner. Costs an action cooldown.`,
  inputSchema: { item: z.string().max(40), count: z.number().int().min(1).max(10000).optional(), thought },
}, (args) => reply('store', args, 'do'));
s.registerTool('take', {
  description: `Take items out of your own chest within ${B.stationRange} tiles. Costs an action cooldown.`,
  inputSchema: { item: z.string().max(40), count: z.number().int().min(1).max(10000).optional(), thought },
}, (args) => reply('take', args, 'do'));
```

- `test/e2e.test.ts`: add `'store'`, `'take'` to the sorted tool list.

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: chests with store and take, locked to their owner"
```

---

### Task 6: Escrowed face-to-face trading

**Files:**
- Modify: `engine/trade.ts` (offers), `engine/world.ts` (`offers` map, expiry in `step`), `shared/balance.ts`, `engine/observe.ts` (`offers`), `engine/actions.ts`, `gateway/mcp.ts`, `engine/achievements.ts`, `engine/rules.ts`, `test/e2e.test.ts`
- Test: `engine/trade.test.ts`

**Interfaces:**
- Produces:

```ts
export interface Offer { id: string; from: string; to: string; give: Inventory; want: Inventory; expiresAt: number }
export function offer(w: World, id: string, to: string, give: Inventory, want: Inventory): { offer: string; expires_in_seconds: number };
export function accept(w: World, id: string, offerId: string): { traded: string; with: string };
export function decline(w: World, id: string, offerId: string): { declined: string };
export function expireOffers(w: World): void;
export function offerLines(w: World, a: Agent): { incoming: string[]; outgoing: string[] };
```

  `World` gains `offers = new Map<string, Offer>()` and `nextOfferId = 1` (memory only, not persisted). `gold` is the key for coins in `give`/`want`.

- [ ] **Step 1: Write failing tests** (append to `engine/trade.test.ts`):

```ts
test('offer then accept swaps everything at once, both ways, with gold', () => {
  const w = world();
  const m = robot(w, 'Miner', [10, 10], { iron_ore: 10 });
  const s = robot(w, 'Smith', [11, 10], {});
  s.wallet = 40;
  const o = offer(w, m.id, s.id, { iron_ore: 10 }, { gold: 30 });
  accept(w, s.id, o.offer);
  assert.deepEqual([m.inventory.iron_ore, m.wallet, s.inventory.iron_ore, s.wallet], [undefined, B.startGold + 30, 10, 10]);
  assert.equal(w.offers.size, 0);
  assert.ok(w.step(0).events.some((e) => e.text.includes('💰 Miner traded 10 iron_ore to Smith for 30 gold')));
});

test('accept checks everything; a failed check moves nothing', () => {
  const w = world();
  const m = robot(w, 'Miner', [10, 10], { iron_ore: 10 });
  const s = robot(w, 'Smith', [11, 10], { stone: 240 });
  const o1 = offer(w, m.id, s.id, { iron_ore: 10 }, {});
  assert.equal(failCode(() => accept(w, s.id, o1.offer)), 'bag_full'); // the accepter's bag
  const o0 = offer(w, m.id, s.id, {}, { stone: 20 });
  m.inventory = { iron_ore: 10, wood: 220 };
  assert.equal(failCode(() => accept(w, s.id, o0.offer)), 'their_bag_full'); // the offerer's bag
  m.inventory = { iron_ore: 10 };
  const o3 = offer(w, m.id, s.id, { iron_ore: 10 }, {});
  s.inventory = {};
  m.inventory = {};
  assert.equal(failCode(() => accept(w, s.id, o3.offer)), 'offer_gone_stale');
  m.inventory = { iron_ore: 10 };
  const o2 = offer(w, m.id, s.id, { iron_ore: 10 }, { gold: 999 });
  assert.equal(failCode(() => accept(w, s.id, o2.offer)), 'not_enough_gold');
  s.x = 30;
  assert.equal(failCode(() => accept(w, s.id, o2.offer)), 'too_far');
  assert.deepEqual([m.inventory.iron_ore, s.inventory.iron_ore ?? 0, s.wallet], [10, 0, B.startGold]);
});

test('offers: validation, one per pair, decline, expiry, and only the target accepts', () => {
  const w = world();
  const a = robot(w, 'Ann', [10, 10], { wood: 5 });
  const b = robot(w, 'Bob', [11, 10], {});
  assert.equal(failCode(() => offer(w, a.id, a.id, { wood: 1 }, {})), 'bad_target');
  assert.equal(failCode(() => offer(w, a.id, b.id, {}, {})), 'empty_offer');
  assert.equal(failCode(() => offer(w, a.id, b.id, { wood: 9 }, {})), 'missing_items');
  assert.equal(failCode(() => offer(w, a.id, b.id, { gold: 99 }, {})), 'not_enough_gold');
  const first = offer(w, a.id, b.id, { wood: 1 }, {});
  const second = offer(w, a.id, b.id, { wood: 2 }, {});
  assert.deepEqual([w.offers.has(first.offer), w.offers.has(second.offer)], [false, true]);
  assert.equal(failCode(() => accept(w, a.id, second.offer)), 'not_yours');
  decline(w, b.id, second.offer);
  assert.equal(w.offers.size, 0);
  offer(w, a.id, b.id, { wood: 1 }, {});
  for (let i = 0; i <= B.offerTicks; i++) w.step(0);
  assert.equal(w.offers.size, 0);
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('expired')));
});

test('observe lists incoming and outgoing offers', () => {
  const w = world();
  const a = robot(w, 'Ann', [10, 10], { wood: 5 });
  const b = robot(w, 'Bob', [11, 10], {});
  const o = offer(w, a.id, b.id, { wood: 5 }, { gold: 3 });
  assert.match(w.observe(b.id).offers.incoming[0], new RegExp(`^${o.offer} from Ann \\(${a.id}\\): gives 5 wood, wants 3 gold, \\d+ s left$`));
  assert.equal(w.observe(a.id).offers.outgoing.length, 1);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `bun test engine/trade.test.ts`
Expected: FAIL (`offer` not exported).

- [ ] **Step 3: Implement** in `engine/trade.ts`:

```ts
export interface Offer { id: string; from: string; to: string; give: Inventory; want: Inventory; expiresAt: number }

const describe = (inv: Inventory) => Object.entries(inv).map(([i, n]) => `${n} ${i}`).join(', ') || 'nothing';
const clean = (inv: Inventory): Inventory => Object.fromEntries(Object.entries(inv).filter(([, n]) => Number.isInteger(n) && n > 0));

/** Throws unless `a` holds everything in `inv` (gold from the wallet). */
function holds(a: Agent, inv: Inventory, code: 'missing_items' | 'offer_gone_stale') {
  for (const [item, n] of Object.entries(inv)) {
    if (item === 'gold' ? a.wallet < n : (a.inventory[item] ?? 0) < n) {
      if (item === 'gold') throw new GameFail('not_enough_gold', `${a.name} does not have ${n} gold.`, 'Offer less, or earn more.');
      throw new GameFail(code, code === 'missing_items' ? `You do not have ${n} ${item}.` : `${a.name} no longer has ${n} ${item}.`, 'Check the bags and make a new offer.');
    }
  }
}

function fits(a: Agent, inv: Inventory): boolean {
  const bag = { ...a.inventory };
  return Object.entries(inv).every(([item, n]) => item === 'gold' || addItem(bag, item, n) === n);
}

function move(from: Agent, to: Agent, inv: Inventory) {
  for (const [item, n] of Object.entries(inv)) {
    if (item === 'gold') { from.wallet -= n; to.wallet += n; } else { takeItem(from.inventory, item, n); addItem(to.inventory, item, n); }
  }
}

function near(w: World, a: Agent, b: Agent) {
  if (dist([a.x, a.y], [b.x, b.y]) > B.tradeRange) throw new GameFail('too_far', `${b.name} is too far away to trade.`, `Stand within ${B.tradeRange} tiles.`);
}

export function offer(w: World, id: string, to: string, give: Inventory, want: Inventory) {
  const a = w.alive(id), b = w.agents.get(to);
  if (!b || b.id === a.id || !b.joined || b.dead) throw new GameFail('bad_target', 'There is nobody like that to trade with.', 'Use an agent id from observe.');
  const g = clean(give), wt = clean(want);
  if (!Object.keys(g).length && !Object.keys(wt).length) throw new GameFail('empty_offer', 'An offer of nothing for nothing. Very zen.', 'Put something in give or want.');
  near(w, a, b);
  holds(a, g, 'missing_items');
  for (const [oid, o] of w.offers) if (o.from === a.id && o.to === b.id) w.offers.delete(oid); // one per pair
  const o: Offer = { id: `offer_${w.nextOfferId++}`, from: a.id, to: b.id, give: g, want: wt, expiresAt: w.tick + B.offerTicks };
  w.offers.set(o.id, o);
  w.note(b, `${a.name} offers you ${describe(g)} for ${describe(wt)} (${o.id}). accept or decline within ${B.offerTicks}s.`);
  w.touch(a);
  return { offer: o.id, expires_in_seconds: B.offerTicks };
}

export function accept(w: World, id: string, offerId: string) {
  const b = w.alive(id), o = w.offers.get(offerId);
  if (!o) throw new GameFail('no_offer', 'That offer is gone.', 'observe shows your open offers.');
  if (o.to !== b.id) throw new GameFail('not_yours', 'That offer was made to someone else.', 'You can only accept offers made to you.');
  const a = w.agents.get(o.from);
  if (!a || a.dead || !a.joined) { w.offers.delete(o.id); throw new GameFail('no_offer', 'The other robot is not around any more.', 'Make a new deal.'); }
  near(w, b, a);
  holds(a, o.give, 'offer_gone_stale');
  holds(b, o.want, 'missing_items');
  if (!fits(b, o.give)) throw new GameFail('bag_full', 'Your bag has no room for all that.', 'Drop or store something first.');
  if (!fits(a, o.want)) throw new GameFail('their_bag_full', `${a.name}'s bag has no room for your side.`, 'Ask them to make room.');
  move(a, b, o.give);
  move(b, a, o.want);
  w.offers.delete(o.id);
  for (const r of [a, b]) { w.bump(r, 'trades'); w.dirty.add(r.id); }
  w.note(a, `${b.name} accepted: you gave ${describe(o.give)} and got ${describe(o.want)}.`);
  if ((o.give.gold ?? 0) >= B.bigTradeGold || (o.want.gold ?? 0) >= B.bigTradeGold) {
    w.emit('trade', `💰 ${a.name} traded ${describe(o.give)} to ${b.name} for ${describe(o.want)}.`, a);
  }
  w.touch(b);
  return { traded: `${describe(o.want)} for ${describe(o.give)}`, with: a.name };
}

export function decline(w: World, id: string, offerId: string) {
  const b = w.alive(id), o = w.offers.get(offerId);
  if (!o || o.to !== b.id) throw new GameFail('no_offer', 'No such offer to you.', 'observe shows your open offers.');
  w.offers.delete(o.id);
  const a = w.agents.get(o.from);
  if (a) w.note(a, `${b.name} declined your offer (${o.id}).`);
  w.touch(b);
  return { declined: o.id };
}

export function expireOffers(w: World) {
  for (const [oid, o] of w.offers) {
    if (o.expiresAt > w.tick) continue;
    w.offers.delete(oid);
    const a = w.agents.get(o.from), b = w.agents.get(o.to);
    if (a) w.note(a, `Your offer to ${b?.name ?? 'someone'} expired (${oid}).`);
    if (b) w.note(b, `The offer from ${a?.name ?? 'someone'} expired (${oid}).`);
  }
}

export function offerLines(w: World, a: Agent) {
  const line = (o: Offer, dir: 'from' | 'to') => {
    const other = w.agents.get(dir === 'from' ? o.from : o.to);
    return `${o.id} ${dir} ${other?.name ?? '?'} (${other?.id ?? '?'}): gives ${describe(o.give)}, wants ${describe(o.want)}, ${Math.max(0, o.expiresAt - w.tick)} s left`;
  };
  const all = [...w.offers.values()];
  return { incoming: all.filter((o) => o.to === a.id).map((o) => line(o, 'from')), outgoing: all.filter((o) => o.from === a.id).map((o) => line(o, 'to')) };
}
```

  Check order in `accept` (the tests depend on it): offer exists, is yours, other robot present, range, offerer still holds `give`, accepter holds `want`, accepter's bag fits `give`, offerer's bag fits `want`.
- `shared/balance.ts`: `tradeRange: 3, offerTicks: 60, bigTradeGold: 50`.
- `engine/world.ts`: fields `offers = new Map<string, Offer>(); nextOfferId = 1;`; call `expireOffers(this)` once per tick in `step`.
- `engine/observe.ts`: add `offers: offerLines(w, a)` to the returned object.
- `engine/actions.ts`: `'offer', 'accept', 'decline'` in `DO_TOOLS`; cases:

```ts
case 'offer':
  return withView(offer(world, agentId, String(args.agent ?? ''), invArg(args.give), invArg(args.want)));
case 'accept':
  return withView(accept(world, agentId, String(args.offer ?? '')));
case 'decline':
  return withView(decline(world, agentId, String(args.offer ?? '')));
```

  with `const invArg = (v: unknown): Record<string, number> => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number')) : {});`
- `gateway/mcp.ts`:

```ts
const goods = z.record(z.string().max(40), z.number().int().min(1).max(10000));
s.registerTool('offer', {
  description: `Offer a trade to a robot within ${B.tradeRange} tiles: give and want are item counts, "gold" for coins. The swap happens only if they accept within ${B.offerTicks}s and both sides still have the goods, so nobody can be cheated. Costs an action cooldown.`,
  inputSchema: { agent: z.string().max(40), give: goods.optional(), want: goods.optional(), thought },
}, (args) => reply('offer', args, 'do'));
s.registerTool('accept', {
  description: 'Accept a trade offer made to you (observe.offers.incoming). Everything swaps at once. Costs an action cooldown.',
  inputSchema: { offer: z.string().max(40), thought },
}, (args) => reply('accept', args, 'do'));
s.registerTool('decline', {
  description: 'Turn down a trade offer made to you. Costs an action cooldown.',
  inputSchema: { offer: z.string().max(40), thought },
}, (args) => reply('decline', args, 'do'));
```

- `engine/achievements.ts`: add `deal` (`stat(a, 'trades') >= 1`, common, emoji 🤝, "Deal!") and `fair_trader` (25 trades, rare, emoji ⚖️).
- `engine/rules.ts`: `trading` section: offer/accept/decline usage, range, expiry, the 50-gold news rule, and "give stays for gifts, bribes and scams".
- `test/e2e.test.ts`: add `'accept', 'decline', 'offer'` to the tool list, and a new test: two robots sign up over MCP, are moved next to each other through the engine's admin-free path used by existing e2e tests (or placed via a fresh world seed where spawns coincide), one offers wood for nothing, the other accepts, and the wood arrives.

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: escrowed face-to-face trading (offer, accept, decline)"
```

---

### Task 7: Buried treasure, maps and digging

**Files:**
- Create: `engine/treasure.ts`, `engine/treasure.test.ts`
- Modify: `engine/world.ts` (`treasures`, spawn on load/tick), `engine/persist.ts` (`K.treasures`), `engine/observe.ts` (scout resources, map lines), `engine/tasks.ts` or `world.gather` (`gather treasure`), `shared/types.ts` (`GATHER_TARGETS` += `'treasure'`), `shared/items.ts` (`stackOf` for `treasure_map:*`), `shared/balance.ts`, `engine/actions.ts`, `gateway/mcp.ts`, `engine/achievements.ts`, `engine/rules.ts`, `test/e2e.test.ts`

**Interfaces:**
- Produces: `World.treasures: Map<number, { loot: number }>` (tile index → marker); `spawnTreasures(w)`; `chart(w, id, x, y)` → `{ map: string }` where the map key is `treasure_map:${x},${y}`; digging via `gather('treasure')`; `isMap(item: string): boolean` in `shared/items.ts`.

- [ ] **Step 1: Write failing tests** in `engine/treasure.test.ts`:

```ts
test('treasure is invisible to non-scouts and absent from ticks and chunks', () => {
  const w = world();
  const s = joined(w, 'scout', [10, 10]);
  const m = joined(w, 'miner', [10, 11]);
  w.treasures.set(w.index(14, 10), { loot: 1 });
  assert.ok(w.observe(s.id).resources.some((l) => l.startsWith('buried treasure at (14, 10)')));
  assert.ok(!JSON.stringify(w.observe(m.id)).includes('treasure'));
  assert.ok(!JSON.stringify(w.step(0)).includes('treasure'));
  assert.ok(!JSON.stringify(packChunk(w.nodes, 0, 0, w.size)).includes('treasure'));
});

test('a scout charts a map, trades it, and only a miner with that map digs it up', () => {
  const w = world();
  const s = joined(w, 'scout', [14, 10]);
  const m = joined(w, 'miner', [13, 10]);
  w.treasures.set(w.index(14, 10), { loot: 1 });
  s.inventory.fiber = 2;
  chart(w, s.id, 14, 10);
  assert.equal(s.inventory['treasure_map:14,10'], 1);
  assert.equal(code(() => w.gather(s.id, 'treasure')), 'wrong_role');
  assert.equal(code(() => w.gather(m.id, 'treasure')), 'no_map');
  m.inventory['treasure_map:14,10'] = 1;
  w.gather(m.id, 'treasure');
  for (let i = 0; i < 20; i++) w.step(0);
  assert.ok(m.wallet >= B.startGold + 30);
  assert.equal(m.inventory['treasure_map:14,10'], undefined);
  assert.equal(w.treasures.has(w.index(14, 10)), false);
  assert.equal(w.treasures.size, 1); // respawned elsewhere (the test world keeps 1)
});

test('a map for a treasure someone already dug is stale', () => {
  const w = world();
  const m = joined(w, 'miner', [13, 10]);
  m.inventory['treasure_map:14,10'] = 1;
  assert.equal(code(() => w.gather(m.id, 'treasure')), 'stale_map');
  assert.equal(m.inventory['treasure_map:14,10'], 1);
});
```

(The test world sets `w.treasureCount = 1` or passes a balance override; use whatever the implementation exposes, e.g. a `World` field `treasureTarget` defaulting to `B.treasureCount`.)

- [ ] **Step 2: Run, expect failure**

Run: `bun test engine/treasure.test.ts`
Expected: FAIL (`treasures` undefined, `chart` missing).

- [ ] **Step 3: Implement**

- `shared/items.ts`: `export const isMap = (item: string) => item.startsWith('treasure_map:');` and `stackOf` returns 1 for maps; `ITEMS` lookups that crash on unknown keys must treat maps as gear (search `ITEMS[` usages over inventory keys: `trimBag`, `slotsUsed` via `stackOf`, observe gear).
- `shared/balance.ts`: `treasureCount: 6, treasureMinFromPlaza: 64, chartFiber: 2, treasureDigTicks: 10, treasureGold: [30, 80]`.
- `engine/treasure.ts`:

```ts
/** Keeps treasureTarget buried treasures on land far from the Plaza. */
export function spawnTreasures(w: World): void {
  for (let tries = 0; w.treasures.size < w.treasureTarget && tries < 500; tries++) {
    const x = Math.floor(w.rng() * w.size), y = Math.floor(w.rng() * w.size), i = w.index(x, y);
    if (!walkable(w.at(x, y)) || w.at(x, y) === T.SHALLOW || w.solid(x, y) || w.nodes.has(i) || dist([x, y], w.plaza) < B.treasureMinFromPlaza) continue;
    w.treasures.set(i, { loot: 1 });
    w.treasuresDirty = true;
  }
}

export function chart(w: World, id: string, x: number, y: number) {
  const a = w.alive(id);
  if (a.role !== 'scout') throw new GameFail('wrong_role', 'Only scouts can read the land well enough to chart treasure.', 'Buy a treasure map from a scout.');
  if (!w.treasures.has(w.index(x, y)) || dist([x, y], [a.x, a.y]) > 2) throw new GameFail('no_treasure', 'No buried treasure within 2 tiles of that spot.', 'Stand next to a treasure you can see in observe.');
  if (!takeItem(a.inventory, 'fiber', B.chartFiber)) throw new GameFail('missing_materials', `Charting costs ${B.chartFiber} fiber.`, 'Pull some grass.');
  const map = `treasure_map:${x},${y}`;
  if (!addItem(a.inventory, map, 1)) { addItem(a.inventory, 'fiber', B.chartFiber); throw new GameFail('bag_full', 'No room for the map.', 'Make room first.'); }
  w.bump(a, 'chart');
  w.touch(a);
  return { map };
}

/** Called by the gather task when a miner with the map finishes digging. */
export function dig(w: World, a: Agent, i: number): string {
  const [x, y] = w.xy(i);
  takeItem(a.inventory, `treasure_map:${x},${y}`, 1);
  w.treasures.delete(i);
  w.treasuresDirty = true;
  const [lo, hi] = B.treasureGold, gold = lo + Math.floor(w.rng() * (hi - lo + 1));
  a.wallet += gold;
  const roll = w.rng();
  const bonus = roll < 0.4 ? { gem: 2 } : roll < 0.7 ? { crystal: 2 } : roll < 0.9 ? { iron_pickaxe: 1 } : { lucky_charm: 1 };
  for (const [item, n] of Object.entries(bonus)) if (!addItem(a.inventory, item, n)) w.dropLoot(i, { [item]: n });
  w.bump(a, 'dig:treasure');
  w.emit('treasure', `🗺️ ${a.name} dug up buried treasure: ${gold} gold and ${Object.entries(bonus).map(([k, n]) => `${n} ${k}`).join(', ')}!`, a);
  spawnTreasures(w);
  return `Task done: dug up the treasure (${gold} gold).`;
}
```

- `engine/world.ts`: fields `treasures = new Map<number, { loot: number }>(); treasuresDirty = false; treasureTarget = B.treasureCount;`. In `gather`, before the normal path, handle `target === 'treasure'`:

```ts
if (target === 'treasure') {
  if (a.role !== 'miner') throw new GameFail('wrong_role', 'Only miners dig treasure. Scouts find it, miners get it out.', 'Sell the map to a miner.');
  const mapItem = Object.keys(a.inventory).find(isMap);
  if (!mapItem) throw new GameFail('no_map', 'You need a treasure map to know where to dig.', 'Buy one from a scout.');
  const [mx, my] = mapItem.slice('treasure_map:'.length).split(',').map(Number);
  if (!this.treasures.has(this.index(mx, my))) throw new GameFail('stale_map', 'Someone already dug this one up. The map is now a souvenir.', 'Buy a fresher map.');
  if (!bestTool(a, 'iron_vein')) throw new GameFail('needs_pickaxe', 'You need a pickaxe to dig treasure.', 'Buy one from a smith.');
  // walk there and dig: a gather task on the treasure tile
}
```

  and give `GatherTask` a treasure branch: the task walks to the tile (reuse `findPath` to it), then counts `B.treasureDigTicks` ticks of progress and calls `dig`. `findTarget` is not used for treasure (the map gives the tile). `GATHER_TARGETS` gets `'treasure'`.
- `engine/world.ts` construction/`loadWorld`: call `spawnTreasures(w)` after load, and in `step` every 60 ticks.
- `engine/persist.ts`: `K.treasures = 'treasures'`; save `[...w.treasures]` when `treasuresDirty`; load it before `spawnTreasures`. The gateway never reads this key.
- `engine/observe.ts`: when `a.role === 'scout'`, add treasure lines to `resources` via `offer('treasure', d, `buried treasure ${where(x, y)}`)`; for everyone, maps in `inventory` are shown as-is (`treasure_map:14,10`) and `you.maps` lists `treasure_map -> (14, 10)` per map.
- `engine/actions.ts`: `'chart'` in `DO_TOOLS`, case `withView(chart(world, agentId, Number(args.x), Number(args.y)))`.
- `gateway/mcp.ts`:

```ts
s.registerTool('chart', {
  description: `Scouts only: draw a treasure map for buried treasure within 2 tiles of x, y (costs ${B.chartFiber} fiber). Maps are items: sell them to miners with offer. Only a miner holding the map can dig the treasure. Costs an action cooldown.`,
  inputSchema: { x: z.number().int(), y: z.number().int(), thought },
}, (args) => reply('chart', args, 'do'));
```

  and the `gather` tool description mentions `treasure` (miners with a map).
- `engine/achievements.ts`: `cartographer_for_hire` (rare, 🗺️, "Sell 5 treasure maps": count trades where `give` had a map — bump `stat 'sold:map'` in `accept` when `Object.keys(o.give).some(isMap)` for the offerer and when `want` had a map for the accepter) and `treasure_hunter` (rare, 💎, "Dig up 3 treasures": `stat(a, 'dig:treasure')`), and `minted` (common, 🪙, "Mine your first gold": `stat(a, 'mint:gold')`).
- `engine/rules.ts`: treasure lines (who sees, chart cost, who digs, loot).
- `test/e2e.test.ts`: add `'chart'` to the tool list.

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: buried treasure only scouts see, tradeable maps, miners dig"
```

---

### Task 8: Rules, docs and agent prompt

**Files:**
- Modify: `engine/rules.ts` (final pass), `README.md`, `examples/AGENT_PROMPT.md`, `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md` (§11 items/crafting and tool list sections that still describe the Smith)
- Test: `engine/achievements.test.ts` (rules exposes sections)

- [ ] **Step 1: Write the failing test** (append to `engine/achievements.test.ts`):

```ts
test('rules explain roles, trading and treasure, and never mention the Smith NPC', () => {
  const r = rules(world());
  const text = JSON.stringify(r);
  assert.ok(r.roles.length === 6 && r.trading.length > 0 && r.treasure.length > 0);
  assert.ok(!/the Smith at the Plaza|smith\(/i.test(text));
});
```

- [ ] **Step 2: Run, expect failure**

Run: `bun test engine/achievements.test.ts`
Expected: FAIL (`trading` or `treasure` missing).

- [ ] **Step 3: Implement**

- `engine/rules.ts`: `roles` becomes one line per role: exclusive gathering (from `NODE_DEF`), exclusive recipes (from `RECIPES`), exclusive builds (from `STRUCTURES`), kit (from `KITS`); add `trading` and `treasure` arrays; `economy` explains the money flow in two lines ("Gold enters only through miners: gold veins and treasure. Miners buy pickaxes, food, maps and stone from others, and the coins go round.").
- `README.md`: tool list (remove `smith`, `heal`; add `offer`, `accept`, `decline`, `store`, `take`, `chart`), a short "Roles and trading" section.
- `examples/AGENT_PROMPT.md`: replace the Smith paragraph with roles, trading etiquette ("make an offer, say why in world chat, accept fair ones") and treasure.
- Parent spec: in the sections that describe the Smith, add "(removed in 0.0.1-6, see the Trade spec)".

- [ ] **Step 4: Run everything**

Run: `bun run typecheck && bun run test && bun run test:int`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: rules, README and agent prompt for roles, trading and treasure"
```

---

### Task 9: Web visuals

**Files:**
- Modify: `web/src/props.ts` (mud, gem_vein, gold_vein, herb), `web/src/structures.ts` (chest, kiln), `web/assets/survival/` (copy `chest.glb`, `box-open.glb` from the Kenney Survival Kit download in the scratchpad `surv/Models/GLB format/`), `web/src/robots.ts` (trade icon), `web/src/icons.ts` (`trade`, `mud`, `brick`, `gem`, `herb`, `bandage`, `gold` item colours/aliases), `web/src/main.ts` (handle `trade` and `treasure` events), `web/assets/CREDITS.md`
- Test: `bun run build:web && bun run typecheck`, then a visual check in the host's Brave (never headless Chrome)

**Interfaces:**
- Consumes: `NODE_KINDS` indices from Task 3; `StructureKind` from Task 4; `GameEvent` types `'trade'` and `'treasure'` from Tasks 6 and 7.

- [ ] **Step 1: Node models** in `web/src/props.ts`: `MODEL` gets `mud: () => 'stone_largeA'`, `gem_vein: () => 'iron_vein'`, `gold_vein: () => 'iron_vein'`, `herb: () => 'grass'`; `ORES` gets `['gem_vein', '#d04fd8', 0.3]`, `['gold_vein', '#f2c230', 0.25]`; mud is the stone model flattened (`scale.y *= 0.15`) and tinted `#6b4a2b`; herb is the grass model tinted `#3fae5a`; `SCALE` entries `mud: 1.2, gem_vein: 0.8, gold_vein: 1, herb: 0.8`.
- [ ] **Step 2: Structures** in `web/src/structures.ts`: `FILES` gets `chest: 'chest'`, `kiln: 'resource-stone-large'`, `SIZE` `chest: 0.7, kiln: 1`; kiln meshes tinted `#b5563a` with the furnace glow; copy the two `.glb` files and note them in `CREDITS.md`.
- [ ] **Step 3: Events** in `web/src/main.ts`: on a `trade` event, show the SVG `trade` icon (two arrows, path `'M2 5h10l-3-3M14 11H4l3 3'`) over both robots named in the event for 5 s (the event carries `agent`; parse the other name from the text or add `other?: string` to `GameEvent` in Task 6); on a `treasure` event, place `box-open` at the event's `x, y` for 30 s.
- [ ] **Step 4: Icons** in `web/src/icons.ts`: colours `mud '#6b4a2b'`, `brick '#b5563a'`, `gem '#d04fd8'`, `herb '#3fae5a'`, `bandage '#f4efe6'`, `gem_sword '#d04fd8'`, `lucky_charm '#58d68d'`; aliases so maps (`treasure_map:*`) use a `map` icon.
- [ ] **Step 5: Build and check**

Run: `bun run build:web && bun run typecheck`
Expected: no errors. Then, with local engine and gateway running, open `http://localhost:3000` in Brave via `browser-use` and look at a mud patch, a gold vein and a chest. If the Brave tab is hidden or the display asleep, skip the visual check and say so.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(web): mud, gems, gold veins, herbs, chests, kilns, trade and treasure effects"
```

---

### Task 10: Example agents trade by role

**Files:**
- Modify: `examples/scripted-bot.ts`, `examples/llm-agent.ts`

- [ ] **Step 1: Scripted bots.** `ROLES = ['miner', 'mason', 'smith', 'hunter', 'gatherer', 'scout']`. Replace the Smith trip with:
  - **Work:** miner: `gold_vein`, `gem_vein`, `iron_vein`, `crystal`; mason: `rock`, `mud`, then `build kiln` and `craft brick`; smith: buys iron and stone, builds a workbench, crafts pickaxes; hunter: attacks animals, cooks at a campfire; gatherer: trees, grass, herbs, then `craft bandage`; scout: explores, `chart`s any `buried treasure` it sees.
  - **Store:** when the bag is 10+ slots full, `build chest` once (if it owns none nearby) and `store` its role's goods.
  - **Sell:** a price list `PRICE: Record<string, number> = { iron_ore: 3, gem: 10, crystal: 8, stone: 1, brick: 2, meat: 2, cooked_meat: 4, hide: 3, wood: 1, fiber: 1, herb: 2, bandage: 4, stone_pickaxe: 15, iron_pickaxe: 40 }` plus maps at 20; offer up to 10 of a sellable good to the nearest robot within 3 tiles whose role wants it (`WANTS: Record<string, string[]>`: smith wants iron_ore, stone, gem, hide; mason wants wood; miner wants stone_pickaxe, cooked_meat, treasure maps; everyone wants food when food < 60).
  - **Buy:** each turn, `accept` any incoming offer whose `want` is only gold, at or below the price list, for an item in its `WANTS`; `decline` the rest.
- [ ] **Step 2: LLM agent.** `ROLE_GOALS` rewritten for the six roles with their exclusives and trade partners; `ACTIONS` adds `offer`, `accept`, `decline`, `store`, `take`, `chart`, removes `smith`, `heal`; the state lines include `offers.incoming` and `offers.outgoing`; the system prompt explains that trades happen by `offer` to a robot within 3 tiles and are safe.
- [ ] **Step 3: Typecheck and a local run**

Run: `bun run typecheck`, then restart local engine and gateway, kick old robots, and run `BOTS=6 bun examples/scripted-bot.ts` for 10 minutes.
Expected: the log shows at least one `accept` between two different roles, and Redis `structures` contains a `chest`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(examples): role bots work their exclusives, store in chests and trade by offer"
```

---

### Task 11: Release 0.0.1-6

- [ ] **Step 1:** Final whole-branch self-review against the spec (per executing-plans, no subagent); ledger any rulings.
- [ ] **Step 2:** `package.json` version `0.0.1-6`; `bun run typecheck && bun run test && bun run test:int`.
- [ ] **Step 3:** `git commit -am "chore: release 0.0.1-6"`, `git tag v0.0.1-6`, `git push origin main v0.0.1-6`.
- [ ] **Step 4:** Poll `https://touchgrass.win/health` until `version` is `0.0.1-6`; confirm with a production observe that the Smith is gone and treasure is absent from a WebSocket tick.
- [ ] **Step 5:** Tell the host that `BetaTester` (`~/Desktop/work/tg-agent`) still uses the old prompt and tools; offer to update it.

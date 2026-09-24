# Touch Grass 0.0.1-5 "Tools of the Trade" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Robots craft real tools at stations, wear them out, and trade in a gold economy.
- Bags are small. Axes and pickaxes speed up work. Iron is mined in the mountains and smelted at a furnace.
- Campfires cook food and keep monsters away.
- The Smith in the Plaza buys and sells at prices that move with supply, and sells blueprints for iron gear. Robots can hand each other items and gold.
- A new Miner role closes the loop: mine → sell → smelt or buy iron → craft → hunt and fight → sell.

**Architecture:** One item table (`shared/items.ts`) describes every item: stack size, uses, damage, reach, armor, tool powers, recipe, station, blueprint and Smith prices. Engine code reads only that table.
- `engine/gear.ts`: wear and breaking, the best tool for a job, and armor.
- `engine/craft.ts`: `craft`, `build` and `fuel`.
- `engine/smith.ts`: the market (`smith`, `give`, stock decay).
- `World` gains `structures` (solid, persisted, sent every tick) and `market` (the Smith's stock).
- Old saves are fixed once on load, versioned in `meta` like terrain and nodes:
  - overfull bags spill as a loot pile;
  - iron veins and crystal clusters are added.

**Tech Stack:** unchanged. New CC0 models from the Kenney Survival Kit (workbench, campfire-pit, anvil, signpost).

**Spec:** `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`. Sections: release row 0.0.1-5; §8.1 roles; §10.1 iron vein and crystal nodes; §11 items, stations, recipes, blueprints, durability, food, the Smith; §12 campfire light; §18 crafting score and wallet; §19 the -5 achievements.

**Deviations from the spec (Task 9 syncs the spec). The user asked for these on 2026-09-24:**
- **Smaller bags:** 12 slots, stacks of 20. Gear takes a whole slot and never stacks. A backpack adds 6 slots. (Spec: 20 slots, stacks of 50, +10.)
- **Gold coins 🪙 replace the 🌿 grass wallet.**
  - Gold comes only from selling to the Smith, from trades, and a 10-gold start. Score no longer adds to the wallet.
  - Existing wallets keep their balance, now as gold.
  - Blueprint and shop prices are in gold at the spec's numbers.
- **The Smith keeps stock.** His buy price for an item is `base × 40 / (40 + stock)`, and his stock decays 2% a minute. He also resells what he holds at 2× base.
- **New role `miner`:** double yield from rock, iron veins and crystals. Gatherers now double only plant yields (trees, berries, grass).
- **Iron veins** grow on hills and mountain tiles (the mountains are climbable since the terrain update). **Crystal clusters** grow in ruins and on snowy peaks.
- **`give(agent, item, count)`**: hand items or gold to a robot within 2 tiles.
- **Workbench, campfire and furnace are placed with `build` anywhere outside the Plaza.** Land rules arrive in 0.0.1-6.
- **Deferred:** traps, the hoe, the fishing rod, the iron hoe, bread and berry pie (they need farming or fishing). Also deferred: tools held visibly in robots' hands.

## Global Constraints

- Bun ≥ 1.4, `.ts` import extensions, `import type` for types, **never `any`**, comments ≤ 2 lines, all tunables in `shared/balance.ts`.
- Stations: stand within 2 tiles of a station to use it. `smith` requires standing within 3 tiles of the Smith.
- Recipes (spec §11, free):

| Item | Station | Needs |
|---|---|---|
| torch | hand | wood 1, fiber 1 |
| club | hand | wood 5 |
| grass salad | hand | fiber 5 |
| stone axe | workbench | wood 3, stone 3, fiber 2 |
| stone pickaxe | workbench | wood 3, stone 2, fiber 2 |
| stone spear | workbench | wood 3, stone 3, fiber 2 |
| waterskin | workbench | hide 2, fiber 2 |
| hide armor | workbench | hide 6, fiber 4 |
| cooked meat | campfire | meat 1 |
| roasted marshmallow | campfire | marshmallow 1 |
| iron | furnace | iron ore 1, wood 1 |

- Blueprints (gold, then workbench):

| Blueprint | Price | Makes |
|---|---|---|
| iron tools | 100 | iron axe and iron pickaxe, each iron 3 + wood 2 |
| iron sword | 150 | iron 5 + wood 2 |
| frying pan | 120 | iron 3 |
| iron armor | 150 | iron 8 |
| backpack | 80 | hide 5 + fiber 5 |

- Stations built with `build`: workbench (wood 6, stone 2), campfire (wood 5, stone 3; lit 10 minutes, +10 minutes per `fuel` of 1 wood, light radius 6), furnace (stone 10).
- Durability (uses): stone tools 100, iron tools 300, club and spear 150, iron sword and frying pan 400. A torch lasts 600 night ticks while carried. A waterskin holds 5 drinks and refills at water. Breaking is announced: "Bob's stone axe snapped mid-swing".
- Weapon damage: club 10, stone spear 14 (reach 2), iron sword 20, frying pan 12 (knocks the target back 1 tile). Armor: hide −20% damage taken, iron −40% (and slower walking).
- Gather ticks by hand: tree 3, rock 3, iron vein 4, crystal 4. A stone tool halves them (rounded up); an iron tool halves them again (minimum 1). Iron veins and crystals need a pickaxe.
- Food: cooked meat +35; grass salad +5 (cursed achievement "Literally Touched Grass"); marshmallow +2; roasted marshmallow +5 food and +5 energy.
- Smith sells: torch 5, club 8, stone axe 15, stone pickaxe 15, marshmallow ×5 for 2. He buys at base: wood 1, stone 1, fiber 1, meat 2, hide 3, cooked meat 4, iron ore 4, iron 10, crystal 20.
- Achievements:

| Achievement | Tier | Condition |
|---|---|---|
| 🪵 Lumberjack | rare | gather 500 wood |
| ⛏️ Iron Age | common | smelt the first iron |
| 📜 Blueprint Collector | epic | own every blueprint |
| 🍳 BONK | rare | defeat a robot with the frying pan |
| 🥗 Literally Touched Grass | cursed | eat a grass salad |
| 💰 Tycoon | rare | hold 1000 gold (added) |

- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Test locally; push at the end. Browser checks go through the user's Brave via plain `browser-use`; never headless.

## Review Focus

1. **Selling the same item over and over:** the price falls each time and never goes below 1. Stock decays over time. Pinned in Task 4.
2. **A bag that is full or over capacity after the migration:** crafting, buying, `give`, drops and gathering never exceed capacity; overflow becomes a loot pile, never silently vanishes. Pinned in Tasks 1 and 4.
3. **A tool breaking mid-task:** gathering continues at hand speed, or stops cleanly when a pickaxe is required. The break is announced once. Pinned in Task 3.
4. **Stations used from too far away, a campfire gone out, or a structure placed on a tree, water or another structure:** clear errors, nothing consumed. Pinned in Task 2.
5. **`give` to someone far away, dead or non-existent, or giving more than you have:** refused with nothing moved. Gold can't go negative. Pinned in Task 4.

---

## File Structure

```text
shared/items.ts       REWRITE: ITEMS (stack, uses, damage, reach, armor, tool), FOOD, RECIPES, BLUEPRINTS, STRUCTURES,
                      SMITH_BUYS, SMITH_SELLS, stackOf, slotsOf, room, addItem, takeItem (Task 1)
shared/balance.ts     + inventory, gear, station, market numbers (Task 1)
shared/types.ts       + Role 'miner', Agent.blueprints/wear, Structure, StructureView, TickDelta.structures (Task 1)
engine/agent.ts       defaults (Task 1)
engine/persist.ts     bag migration, structures/market persistence, new-node migration (Tasks 1, 2, 3)
engine/gear.ts        NEW: useGear, bestTool, armorOf, weaponOf (Task 3)
engine/craft.ts       REWRITE: craft(item, count), build(kind), fuel() (Task 2)
engine/smith.ts       NEW: SMITH_AT, smith(action, item, count), give(), decayMarket() (Task 4)
engine/world.ts       structures, market, solid() with structures, lit(), eat/drink changes, torch wear (Tasks 2-4)
engine/tasks.ts       tool-aware gather ticks, miner/gatherer yield, pickaxe requirement (Task 3)
engine/nodes.ts       iron_vein, crystal (Task 3)
engine/combat.ts      reach, knockback, armor via gear.ts, BONK stat (Task 5)
engine/creatures.ts   no spawns in light (Task 2)
engine/achievements.ts, observe.ts, rules.ts, actions.ts, gateway/mcp.ts   (Task 6)
web/src/structures.ts NEW: station and Smith models (Task 7)
web/src/icons.ts, ui.ts, main.ts, props.ts   item icons, gold, new nodes (Task 7)
examples/*, README.md, spec                  (Task 8)
```

---

### Task 1: Items table, small bags, gold, miner, migration

**Files:**
- Modify: `shared/items.ts` (rewrite), `shared/balance.ts`, `shared/types.ts`, `engine/agent.ts`, `engine/score.ts`, `engine/persist.ts`, `engine/observe.ts`, `engine/world.ts` (bag_full hint)
- Test: `shared/items.test.ts` (new), `test/persist.test.ts`

**Interfaces:**
- Produces:
  - Types and tables: `ItemDef`, `ITEMS`, `FOOD`, `FOOD_ITEMS`, `RECIPES` (`{station, needs, blueprint?}`), `BLUEPRINTS`, `STRUCTURES`, `SMITH_BUYS`, `SMITH_SELLS`
  - Functions: `stackOf(item)`, `slotsOf(inv)`, `slotsUsed(inv)`, `room(inv, item)`, `addItem`, `takeItem`, `trimBag(inv) → Inventory` (the overflow)
  - `Role` gains `'miner'`; `Agent` gains `blueprints: string[]` and `wear: Record<string, number>`
  - `B.inventorySlots = 12`, `B.stackSize = 20`, `B.backpackSlots = 6`, `B.startGold = 10`
  - `addScore` no longer touches the wallet; `observe.you.gold`

- [ ] **Step 1: Failing tests** in `shared/items.test.ts`

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from './balance.ts';
import { ITEMS, RECIPES, addItem, room, slotsOf, slotsUsed, stackOf, takeItem, trimBag } from './items.ts';

test('bags are small: 12 slots of 20, gear takes a whole slot, a backpack adds 6', () => {
  assert.deepEqual([B.inventorySlots, B.stackSize, stackOf('berries'), stackOf('stone_axe')], [12, 20, 20, 1]);
  const inv: Record<string, number> = {};
  assert.equal(addItem(inv, 'berries', 1000), 240);
  assert.equal(room(inv, 'wood'), 0);
  const bag: Record<string, number> = { stone_axe: 1, club: 1, wood: 21 };
  assert.equal(slotsUsed(bag), 4);
  assert.equal(slotsOf(bag), 12);
  bag.backpack = 1;
  assert.deepEqual([slotsOf(bag), slotsUsed(bag)], [18, 5]);
  assert.equal(takeItem(bag, 'wood', 30), false);
});

test('an overfull bag keeps gear first, then food, then materials; the rest overflows', () => {
  const inv: Record<string, number> = { berries: 1000, club: 1, stone: 30 };
  const extra = trimBag(inv);
  assert.equal(inv.club, 1);
  assert.equal(inv.berries, 220); // 11 slots of food after the club
  assert.equal(inv.stone, undefined);
  assert.deepEqual(extra, { berries: 780, stone: 30 });
});

test('every recipe and blueprint item is a known item', () => {
  for (const [item, r] of Object.entries(RECIPES)) {
    assert.ok(ITEMS[item], item);
    for (const m of Object.keys(r.needs)) assert.ok(ITEMS[m], `${item} needs ${m}`);
  }
});
```

Append to `test/persist.test.ts`:
```ts
test('bags saved before the small-bag rule spill their overflow on load, once', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const a = w.register('Hoarder', 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = [5, 5];
  a.inventory = { berries: 1000 };
  a.wallet = 42;
  await flush(r, w);
  await r.hDel(K.meta, 'bagRules');
  const back = (await loadWorld(r))!;
  const b = back.agents.get(a.id)!;
  assert.deepEqual([b.inventory.berries, back.loot.get(back.index(5, 5))?.items.berries, b.wallet], [240, 760, 42]);
  await flush(r, back);
  assert.equal((await loadWorld(r))!.agents.get(a.id)!.inventory.berries, 240);
  await r.close();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./shared/items.test.ts; bun run test:int`
Expected: FAIL. `stackOf` and `trimBag` are missing, and the bag isn't trimmed on load.

- [ ] **Step 3: shared/items.ts (rewrite)**

```ts
import { B } from './balance.ts';

export type Inventory = Record<string, number>;
export type Station = 'hand' | 'workbench' | 'campfire' | 'furnace';
export type ItemKind = 'material' | 'food' | 'tool' | 'weapon' | 'armor' | 'gear';

export interface ItemDef {
  kind: ItemKind;
  uses?: number; // durability; gear breaks at 0
  damage?: number; // weapons
  reach?: number;
  knockback?: boolean;
  armor?: number; // share of damage absorbed
  slow?: boolean; // walking is slower while carried
  tool?: { nodes: string[]; tier: 1 | 2 }; // speeds up gathering these nodes
}

// Gear never stacks: each one takes a bag slot.
export const ITEMS: Record<string, ItemDef> = {
  wood: { kind: 'material' }, stone: { kind: 'material' }, fiber: { kind: 'material' }, hide: { kind: 'material' },
  iron_ore: { kind: 'material' }, iron: { kind: 'material' }, crystal: { kind: 'material' },
  berries: { kind: 'food' }, apple: { kind: 'food' }, meat: { kind: 'food' }, battery: { kind: 'food' }, cooked_meat: { kind: 'food' },
  grass_salad: { kind: 'food' }, marshmallow: { kind: 'food' }, roasted_marshmallow: { kind: 'food' },
  stone_axe: { kind: 'tool', uses: 100, tool: { nodes: ['tree'], tier: 1 } },
  stone_pickaxe: { kind: 'tool', uses: 100, tool: { nodes: ['rock', 'iron_vein', 'crystal'], tier: 1 } },
  iron_axe: { kind: 'tool', uses: 300, tool: { nodes: ['tree'], tier: 2 } },
  iron_pickaxe: { kind: 'tool', uses: 300, tool: { nodes: ['rock', 'iron_vein', 'crystal'], tier: 2 } },
  club: { kind: 'weapon', uses: 150, damage: 10 },
  stone_spear: { kind: 'weapon', uses: 150, damage: 14, reach: 2 },
  iron_sword: { kind: 'weapon', uses: 400, damage: 20 },
  frying_pan: { kind: 'weapon', uses: 400, damage: 12, knockback: true },
  hide_armor: { kind: 'armor', armor: 0.2 },
  iron_armor: { kind: 'armor', armor: 0.4, slow: true },
  torch: { kind: 'gear', uses: 600 }, // night ticks of light
  waterskin: { kind: 'gear', uses: 5 }, // drinks; refills at water
  backpack: { kind: 'gear' },
};

export const FOOD: Record<string, { food: number; water: number; energy?: number; tummy?: boolean }> = {
  berries: { food: 8, water: 2 },
  apple: { food: 10, water: 0 },
  meat: { food: 10, water: 0, tummy: true }, // raw: may upset the stomach
  cooked_meat: { food: 35, water: 0 },
  grass_salad: { food: 5, water: 1 },
  marshmallow: { food: 2, water: 0 },
  roasted_marshmallow: { food: 5, water: 0, energy: 5 },
  battery: { food: 0, water: 0, energy: 50 }, // from Roombas; do not ask
};
export const FOOD_ITEMS = Object.keys(FOOD);

export const RECIPES: Record<string, { station: Station; needs: Inventory; blueprint?: string }> = {
  torch: { station: 'hand', needs: { wood: 1, fiber: 1 } },
  club: { station: 'hand', needs: { wood: 5 } },
  grass_salad: { station: 'hand', needs: { fiber: 5 } },
  stone_axe: { station: 'workbench', needs: { wood: 3, stone: 3, fiber: 2 } },
  stone_pickaxe: { station: 'workbench', needs: { wood: 3, stone: 2, fiber: 2 } },
  stone_spear: { station: 'workbench', needs: { wood: 3, stone: 3, fiber: 2 } },
  waterskin: { station: 'workbench', needs: { hide: 2, fiber: 2 } },
  hide_armor: { station: 'workbench', needs: { hide: 6, fiber: 4 } },
  cooked_meat: { station: 'campfire', needs: { meat: 1 } },
  roasted_marshmallow: { station: 'campfire', needs: { marshmallow: 1 } },
  iron: { station: 'furnace', needs: { iron_ore: 1, wood: 1 } },
  iron_axe: { station: 'workbench', needs: { iron: 3, wood: 2 }, blueprint: 'iron_tools' },
  iron_pickaxe: { station: 'workbench', needs: { iron: 3, wood: 2 }, blueprint: 'iron_tools' },
  iron_sword: { station: 'workbench', needs: { iron: 5, wood: 2 }, blueprint: 'iron_sword' },
  frying_pan: { station: 'workbench', needs: { iron: 3 }, blueprint: 'frying_pan' },
  iron_armor: { station: 'workbench', needs: { iron: 8 }, blueprint: 'iron_armor' },
  backpack: { station: 'workbench', needs: { hide: 5, fiber: 5 }, blueprint: 'backpack' },
};

export const BLUEPRINTS: Record<string, number> = { iron_tools: 100, iron_sword: 150, frying_pan: 120, iron_armor: 150, backpack: 80 }; // gold

export type StructureKind = 'workbench' | 'campfire' | 'furnace';
export const STRUCTURES: Record<StructureKind, Inventory> = { workbench: { wood: 6, stone: 2 }, campfire: { wood: 5, stone: 3 }, furnace: { stone: 10 } };
export const isStructure = (s: string): s is StructureKind => s in STRUCTURES;

// The Smith pays these (before his stock pushes prices down) and sells these at fixed prices.
export const SMITH_BUYS: Inventory = { wood: 1, stone: 1, fiber: 1, meat: 2, hide: 3, cooked_meat: 4, iron_ore: 4, iron: 10, crystal: 20 };
export const SMITH_SELLS: Record<string, { price: number; count: number }> = {
  torch: { price: 5, count: 1 }, club: { price: 8, count: 1 }, stone_axe: { price: 15, count: 1 }, stone_pickaxe: { price: 15, count: 1 }, marshmallow: { price: 2, count: 5 },
};

const GEAR: ItemKind[] = ['tool', 'weapon', 'armor', 'gear'];
export const stackOf = (item: string): number => (GEAR.includes(ITEMS[item]?.kind ?? 'material') ? 1 : B.stackSize);
export const slotsOf = (inv: Inventory): number => B.inventorySlots + (inv.backpack ? B.backpackSlots : 0);

export function slotsUsed(inv: Inventory): number {
  let slots = 0;
  for (const [item, n] of Object.entries(inv)) slots += Math.ceil(n / stackOf(item));
  return slots;
}

/** How many of `item` still fit, topping up its partial stack first. */
export function room(inv: Inventory, item: string): number {
  const size = stackOf(item), rest = (inv[item] ?? 0) % size;
  return Math.max(0, (rest ? size - rest : 0) + (slotsOf(inv) - slotsUsed(inv)) * size);
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

/** Shrinks a bag to what fits (gear first, then food, then materials) and returns the overflow. */
export function trimBag(inv: Inventory): Inventory {
  const order = (item: string) => (GEAR.includes(ITEMS[item]?.kind ?? 'material') ? 0 : ITEMS[item]?.kind === 'food' ? 1 : 2);
  const all = Object.entries(inv).sort((p, q) => order(p[0]) - order(q[0]));
  for (const k of Object.keys(inv)) delete inv[k];
  const extra: Inventory = {};
  for (const [item, n] of all) {
    const kept = addItem(inv, item, n);
    if (n > kept) extra[item] = n - kept;
  }
  return extra;
}
```

- [ ] **Step 4: balance, types, defaults, score, observe, migration**

`shared/balance.ts`: set `inventorySlots: 12,` and `stackSize: 20,`. After them add:
```ts
  backpackSlots: 6,
  startGold: 10,
```

`shared/types.ts`:
- `export const ROLES = ['gatherer', 'hunter', 'builder', 'medic', 'scout', 'miner'] as const;`
- Append to `Agent`:
```ts
  blueprints: string[]; // bought from the Smith, kept forever
  wear: Record<string, number>; // uses left on the gear item currently in use, per item
```

`engine/agent.ts`: add `blueprints: [], wear: {},` to DEFAULTS and to the fresh-object list in `normalizeAgent`: `blueprints: [], wear: {},`.

`engine/world.ts` `register()`: after `normalizeAgent({...})`, set `a.wallet = B.startGold;`. In `gather()`, change the `bag_full` hint to ``It holds ${slotsOf(a.inventory)} slots. Eat something, sell to the Smith or stop hoarding.`` (import `slotsOf`).

`engine/score.ts` `addScore`: delete the `a.wallet += n;` line and change the doc comment to `/** Points count for the current life and the season; gold comes from trading. */`.

`engine/observe.ts`:
- `slots: \`${slotsUsed(a.inventory)}/${slotsOf(a.inventory)}\``;
- `score: { life: a.lifeScore, season: a.seasonScore, best_life: a.bestLife },`
- add `gold: a.wallet,` after `score`.
- Import `slotsOf`.

`engine/persist.ts`: add `export const BAG_RULES = 2;`, write `bagRules: String(BAG_RULES)` in the flush meta, and in `loadWorld` after agents load:
```ts
  if (Number(meta.bagRules ?? 1) < BAG_RULES) {
    // 2: small bags. Overflow falls to the ground as a loot pile at the robot's feet.
    for (const a of w.agents.values()) {
      const extra = trimBag(a.inventory);
      if (Object.keys(extra).length) w.dropLoot(w.index(a.x, a.y), extra);
      w.dirty.add(a.id);
    }
  }
```
The loot load (`w.loot = new Map(...)`) runs later and would overwrite these piles. Move this block **after** the loot load.

- [ ] **Step 5: Run everything**

Run: `bun run test && bun run test:int && bunx tsc --noEmit`
Expected: the new tests pass.
- Older tests that fill bags (e.g. "a full bag interrupts gathering", which uses 19 junk slots of 50) must be updated to the new sizes. Use 11 junk stacks of 20 and 19 berries, and ledger it.
- The e2e wallet expectations must move to `gold`.

- [ ] **Step 6: Commit**

```bash
git add shared engine test
git commit -m "feat: small bags (12x20, gear takes a slot), item table, gold wallet, miner role; old bags spill once" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stations: build, fuel, light; crafting at stations

**Files:**
- Modify: `shared/types.ts`, `shared/balance.ts`, `engine/craft.ts` (rewrite), `engine/world.ts`, `engine/creatures.ts`, `engine/persist.ts`
- Test: `engine/craft.test.ts` (new)

**Interfaces:**
- Produces:
  - `Structure { kind; owner; litUntil }`, `StructureView = [x, y, kind, lit]`, `TickDelta.structures: StructureView[]`
  - `World.structures: Map<number, Structure>`, `World.structuresDirty`
  - `World.stationNear(a, kind) → boolean`
  - `World.lit(x, y) → boolean` (campfire within 6, or a robot carrying a torch at night within 3)
  - `craft(w, id, item, count?)`, `build(w, id, kind)`, `fuel(w, id)`

- [ ] **Step 1: Failing tests** in `engine/craft.test.ts`

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { build, craft, fuel } from './craft.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
}
function robot(w: World, at: Vec, bag: Record<string, number> = {}) {
  const a = w.register(`R${at.join('')}`, 0);
  w.join(a.id, 'builder', null, 0);
  [a.x, a.y] = at;
  a.inventory = bag;
  return a;
}
const failCode = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('hand recipes work anywhere; station recipes need the station within 2 tiles', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 20, stone: 10, fiber: 10 });
  assert.deepEqual(craft(w, a.id, 'torch', 2).crafted, 'torch');
  assert.equal(a.inventory.torch, 2);
  assert.equal(failCode(() => craft(w, a.id, 'stone_axe')), 'no_station');
  build(w, a.id, 'workbench');
  assert.equal(a.inventory.wood, 20 - 2 - 6);
  craft(w, a.id, 'stone_axe');
  assert.equal(a.inventory.stone_axe, 1);
  a.x = 20;
  assert.equal(failCode(() => craft(w, a.id, 'stone_pickaxe')), 'no_station');
});

test('building needs materials and a free tile; stations are solid; nothing is used on failure', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 3 });
  assert.equal(failCode(() => build(w, a.id, 'campfire')), 'missing_materials');
  assert.deepEqual(a.inventory, { wood: 3 });
  a.inventory = { stone: 30 };
  const f = build(w, a.id, 'furnace');
  assert.ok(w.solid(f.at[0], f.at[1]));
  assert.equal(failCode(() => build(w, a.id, 'castle')), 'bad_structure');
  const b = robot(w, [30, 30], { stone: 10 });
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) w.nodes.set(w.index(30 + dx, 30 + dy), { kind: 'tree', left: 3, regrowAt: 0 });
  assert.equal(failCode(() => build(w, b.id, 'furnace')), 'no_space');
  assert.deepEqual(b.inventory, { stone: 10 });
});

test('a campfire cooks, burns out, can be refuelled, and keeps monsters away while lit', () => {
  const w = world();
  const a = robot(w, [10, 10], { wood: 10, stone: 3, meat: 2 });
  const fire = build(w, a.id, 'campfire');
  assert.ok(w.lit(fire.at[0] + 5, fire.at[1]));
  assert.ok(!w.lit(fire.at[0] + 9, fire.at[1]));
  craft(w, a.id, 'cooked_meat');
  assert.equal(a.inventory.cooked_meat, 1);
  w.tick += B.campfireTicks + 1;
  assert.equal(failCode(() => craft(w, a.id, 'cooked_meat')), 'no_station'); // it went out
  fuel(w, a.id);
  assert.equal(a.inventory.wood, 4);
  craft(w, a.id, 'cooked_meat');
  assert.equal(a.inventory.cooked_meat, 2);
});

test('blueprint recipes need the blueprint; iron comes from the furnace', () => {
  const w = world();
  const a = robot(w, [10, 10], { stone: 12, wood: 10, iron_ore: 3 });
  build(w, a.id, 'furnace');
  craft(w, a.id, 'iron', 3);
  assert.equal(a.inventory.iron, 3);
  a.inventory.stone = 2;
  a.inventory.wood += 6;
  build(w, a.id, 'workbench');
  assert.equal(failCode(() => craft(w, a.id, 'frying_pan')), 'no_blueprint');
  a.blueprints.push('frying_pan');
  craft(w, a.id, 'frying_pan');
  assert.equal(a.inventory.frying_pan, 1);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./engine/craft.test.ts`
Expected: FAIL. `build` and `fuel` are not exported, and `craft` takes no count.

- [ ] **Step 3: Types and balance**

`shared/types.ts` (import `type StructureKind` from `./items.ts`):
```ts
export interface Structure {
  kind: StructureKind;
  owner: string; // agent id
  litUntil: number; // tick; campfires only
}
export type StructureView = [number, number, StructureKind, boolean]; // x, y, kind, lit
```
Add `structures: StructureView[];` to `TickDelta`.

`shared/balance.ts`:
```ts
  stationRange: 2,
  campfireTicks: 600, // lit this long when built, +this per fuel (1 wood)
  campfireLight: 6,
  torchLight: 3,
```

- [ ] **Step 4: engine/craft.ts (rewrite)**

```ts
import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { ITEMS, RECIPES, STRUCTURES, addItem, isStructure, takeItem, type Inventory } from '../shared/items.ts';
import { TERRAIN as T, type Agent, type Vec } from '../shared/types.ts';
import { addScore } from './score.ts';
import { walkable } from './terrain.ts';
import { GameFail, type World } from './world.ts';

const has = (a: Agent, needs: Inventory, times = 1) => Object.entries(needs).every(([m, n]) => (a.inventory[m] ?? 0) >= n * times);
const missing = (a: Agent, needs: Inventory, times = 1) =>
  Object.entries(needs).filter(([m, n]) => (a.inventory[m] ?? 0) < n * times).map(([m, n]) => `${n * times - (a.inventory[m] ?? 0)} ${m}`).join(', ');

export function craft(w: World, id: string, item: string, count = 1) {
  const a = w.alive(id);
  const r = RECIPES[item];
  if (!r) throw new GameFail('unknown_recipe', `Nobody knows how to make "${item}".`, `Recipes: ${Object.keys(RECIPES).join(', ')}. The rules tool lists what each needs.`);
  const n = Math.max(1, Math.min(20, Math.floor(count)));
  if (r.blueprint && !a.blueprints.includes(r.blueprint)) throw new GameFail('no_blueprint', `You need the ${r.blueprint} blueprint.`, 'Buy it from the Smith in the Plaza: smith(blueprint, ...).');
  if (r.station !== 'hand' && !w.stationNear(a, r.station)) throw new GameFail('no_station', `You need a ${r.station === 'campfire' ? 'lit campfire' : r.station} within ${B.stationRange} tiles.`, `build(${r.station}) one first.`);
  if (!has(a, r.needs, n)) throw new GameFail('missing_materials', `You need ${missing(a, r.needs, n)} more.`, 'Gather, trade or buy them.');
  let made = 0;
  for (; made < n; made++) {
    for (const [m, k] of Object.entries(r.needs)) takeItem(a.inventory, m, k);
    if (addItem(a.inventory, item, 1)) continue;
    for (const [m, k] of Object.entries(r.needs)) addItem(a.inventory, m, k); // no room: give the materials back
    break;
  }
  if (!made) throw new GameFail('bag_full', 'No room in your bag for it.', 'Eat, sell or drop something first.');
  if (ITEMS[item].uses && a.wear[item] === undefined) a.wear[item] = ITEMS[item].uses!;
  for (let i = 0; i < made; i++) w.bump(a, `craft:${item}`);
  addScore(w, a, made);
  w.touch(a);
  return { crafted: item, count: made, inventory: a.inventory };
}

/** Places a station on the first free tile next to you. */
export function build(w: World, id: string, kind: string) {
  const a = w.alive(id);
  if (!isStructure(kind)) throw new GameFail('bad_structure', `You cannot build "${kind}".`, `Buildable: ${Object.keys(STRUCTURES).join(', ')}.`);
  if (w.at(a.x, a.y) === T.PLAZA) throw new GameFail('plaza_rules', 'No building in the Plaza. The Smith is very particular.', 'Walk out of the Plaza first.');
  if (!has(a, STRUCTURES[kind])) throw new GameFail('missing_materials', `You need ${missing(a, STRUCTURES[kind])} more.`, 'Gather them first.');
  const spot = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as Vec[]).map(([dx, dy]): Vec => [a.x + dx, a.y + dy])
    .find(([x, y]) => walkable(w.at(x, y)) && w.at(x, y) !== T.SHALLOW && w.at(x, y) !== T.PLAZA && !w.solid(x, y) && Math.abs(w.height(x, y) - w.height(a.x, a.y)) <= B.maxClimb);
  if (!spot) throw new GameFail('no_space', 'There is no free spot next to you.', 'Stand somewhere with open ground around you.');
  for (const [m, k] of Object.entries(STRUCTURES[kind])) takeItem(a.inventory, m, k);
  w.structures.set(w.index(spot[0], spot[1]), { kind, owner: a.id, litUntil: kind === 'campfire' ? w.tick + B.campfireTicks : 0 });
  w.structuresDirty = true;
  w.bump(a, `build:${kind}`);
  addScore(w, a, 1);
  w.touch(a);
  return { built: kind, at: spot };
}

/** One wood keeps the nearest campfire burning longer. */
export function fuel(w: World, id: string) {
  const a = w.alive(id);
  let best: [number, number] | null = null;
  for (const [i, s] of w.structures) {
    const d = dist(w.xy(i), [a.x, a.y]);
    if (s.kind === 'campfire' && d <= B.stationRange && (!best || d < best[1])) best = [i, d];
  }
  if (!best) throw new GameFail('no_station', `No campfire within ${B.stationRange} tiles.`, 'build(campfire) first.');
  if (!takeItem(a.inventory, 'wood', 1)) throw new GameFail('missing_materials', 'You need 1 wood to feed the fire.', 'Gather wood first.');
  const fire = w.structures.get(best[0])!;
  fire.litUntil = Math.max(fire.litUntil, w.tick) + B.campfireTicks;
  w.structuresDirty = true;
  w.touch(a);
  return { burning_for_seconds: fire.litUntil - w.tick };
}
```

- [ ] **Step 5: World, creatures, persistence**

`engine/world.ts`:
- Import `type Structure, type StructureView`.
- Fields: `structures = new Map<number, Structure>(); structuresDirty = false;`
- `solid`: return true also when `this.structures.has(y * this.size + x)`.
- Methods:
```ts
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
    return [...this.structures].map(([i, s]) => [...this.xy(i), s.kind, s.kind === 'campfire' && s.litUntil > this.tick]);
  }
```
- In `step()`'s returned delta add `structures: this.structureViews()`.
- In `stepAgent`, at night, burn carried torches: `if (timeOf(this.tick).phase === 'night' && (a.inventory.torch ?? 0) > 0) useGear(this, a, 'torch');`. `useGear` comes in Task 3; until then inline `a.wear.torch = (a.wear.torch ?? 600) - 1` and replace it in Task 3. Ledger it.

`engine/creatures.ts` `spawnSpot`: add `&& !(CREATURES[kind].monster && w.lit(x, y))` to the accepted-spot condition.

`engine/persist.ts`:
- `K.structures = 'structures'`.
- In flush: `if (w.structuresDirty) m.set(K.structures, JSON.stringify([...w.structures]))`, with the same dirty-flag save and restore as creatures.
- In load: `const st = await r.get(K.structures); if (st) w.structures = new Map(JSON.parse(st) as [number, Structure][]);`

- [ ] **Step 6: Run and commit**

Run: `bun run test && bun run test:int && bunx tsc --noEmit`
Expected: all green.

```bash
git add shared engine test
git commit -m "feat(engine): workbench, campfire and furnace; crafting at stations with counts and blueprints; fire and torch light keep monsters away" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tools, durability, iron veins and crystals, miners

**Files:**
- Create: `engine/gear.ts`
- Modify: `engine/nodes.ts`, `engine/tasks.ts`, `engine/world.ts`, `engine/persist.ts`, `shared/types.ts` (NODE_KINDS)
- Test: `engine/gear.test.ts` (new)

**Interfaces:**
- Produces:
  - `useGear(w, a, item) → boolean` (true when it broke)
  - `bestTool(a, nodeKind) → { item: string; tier: 1 | 2 } | null`
  - `armorOf(a) → number`
  - `NODE_KINDS` gains `'iron_vein'` and `'crystal'`
  - `NODE_DEF[k].needsPickaxe`
  - `NODE_RULES = 6` adds missing iron and crystal nodes once

- [ ] **Step 1: Failing tests** in `engine/gear.test.ts`

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Role, type Vec } from '../shared/types.ts';
import { armorOf, bestTool, useGear } from './gear.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(40 * 40).fill(T.MEADOW), 40, () => 0.99);
}
function robot(w: World, at: Vec, role: Role = 'scout') {
  const a = w.register(`R${at.join('')}${role}`, 0);
  w.join(a.id, role, null, 0);
  [a.x, a.y] = at;
  return a;
}
const failCode = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('axes speed up trees: hand 3 ticks, stone 2, iron 1', () => {
  for (const [tool, ticks] of [[null, 3], ['stone_axe', 2], ['iron_axe', 1]] as const) {
    const w = world();
    const a = robot(w, [5, 5]);
    if (tool) a.inventory[tool] = 1;
    w.nodes.set(w.index(6, 5), { kind: 'tree', left: 5, regrowAt: 0 });
    w.gather(a.id, 'tree', 1);
    for (let i = 0; i < ticks - 1; i++) w.step(0);
    assert.equal(a.inventory.wood, undefined, `${tool} too fast`);
    w.step(0);
    assert.equal(a.inventory.wood, 1, `${tool} at ${ticks}`);
  }
});

test('iron veins need a pickaxe; miners dig double; tools wear out and snap', () => {
  const w = world();
  const a = robot(w, [5, 5], 'miner');
  w.nodes.set(w.index(6, 5), { kind: 'iron_vein', left: 5, regrowAt: 0 });
  assert.equal(failCode(() => w.gather(a.id, 'iron_vein')), 'needs_pickaxe');
  a.inventory.stone_pickaxe = 1;
  a.wear.stone_pickaxe = 2;
  w.gather(a.id, 'iron_vein', 4);
  const events: string[] = [];
  for (let i = 0; i < 4; i++) events.push(...w.step(0).events.map((e) => e.text));
  assert.equal(a.inventory.iron_ore, 4); // two digs, 2 each for a miner
  assert.equal(a.inventory.stone_pickaxe, undefined);
  assert.ok(events.some((t) => t.includes('snapped')));
  assert.equal(bestTool(a, 'iron_vein'), null);
});

test('armor absorbs damage; worn gear counts once per use', () => {
  const w = world();
  const a = robot(w, [5, 5]);
  a.inventory.iron_armor = 1;
  a.inventory.hide_armor = 1;
  assert.equal(armorOf(a), 0.4);
  w.hurt(a, 10, 'wolf', 'A wolf');
  assert.equal(a.health, 94);
  a.inventory.club = 1;
  a.wear.club = 1;
  assert.equal(useGear(w, a, 'club'), true);
  assert.equal(a.inventory.club, undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./engine/gear.test.ts`
Expected: FAIL, cannot find `./gear.ts`.

- [ ] **Step 3: engine/gear.ts**

```ts
import { ITEMS } from '../shared/items.ts';
import type { Agent } from '../shared/types.ts';
import type { World } from './world.ts';

const pretty = (item: string) => item.replace('_', ' ');

/** One use of a carried gear item; true when it broke (and is gone). */
export function useGear(w: World, a: Agent, item: string): boolean {
  const def = ITEMS[item];
  if (!def?.uses || !(a.inventory[item] > 0)) return false;
  a.wear[item] = (a.wear[item] ?? def.uses) - 1;
  if (a.wear[item] > 0) return false;
  if (item === 'waterskin') return false; // empties, refills at water; never breaks
  a.inventory[item] -= 1;
  if (!a.inventory[item]) delete a.inventory[item];
  if (a.inventory[item]) a.wear[item] = def.uses;
  else delete a.wear[item];
  const line = item === 'torch' ? `${a.name}'s torch burned out.` : `${a.name}'s ${pretty(item)} snapped mid-swing.`;
  w.note(a, line);
  w.emit('broke', `🔧 ${line}`, a);
  return true;
}

/** The best carried tool for a node kind. */
export function bestTool(a: Agent, node: string): { item: string; tier: 1 | 2 } | null {
  let best: { item: string; tier: 1 | 2 } | null = null;
  for (const item of Object.keys(a.inventory)) {
    const t = ITEMS[item]?.tool;
    if (t && t.nodes.includes(node) && (!best || t.tier > best.tier)) best = { item, tier: t.tier };
  }
  return best;
}

/** Share of damage absorbed: the best armor carried counts. */
export const armorOf = (a: Agent): number => Math.max(0, ...Object.keys(a.inventory).map((i) => ITEMS[i]?.armor ?? 0));
```

- [ ] **Step 4: Nodes, gathering, armor, torch, migration**

`shared/types.ts`: `export const NODE_KINDS = ['tree', 'berry_bush', 'grass', 'rock', 'iron_vein', 'crystal'] as const;`

`engine/nodes.ts`:
- Add `needsPickaxe?: boolean` to the `NODE_DEF` type and these rows:
```ts
  iron_vein: { item: 'iron_ore', min: 2, max: 3, ticks: 4, regrowTicks: null, needsPickaxe: true },
  crystal: { item: 'crystal', min: 1, max: 1, ticks: 4, regrowTicks: 7200, needsPickaxe: true },
```
- In `nodeKindAt`:
```ts
  if (t === T.HILLS) return r < 0.25 ? 'rock' : r < 0.29 ? 'iron_vein' : null;
  if (t === T.MOUNTAIN || t === T.HIGH) return r < 0.05 ? 'iron_vein' : null;
  if (t === T.PEAK) return r < 0.01 ? 'crystal' : null;
  if (t === T.RUINS) return r < 0.03 ? 'crystal' : null;
```
- `NODE_RULES = 6` (comment: `6: iron veins and crystals`).

`engine/persist.ts` node migration: after pruning, when `meta.nodeRules < 6`, add missing iron veins and crystals:
```ts
    for (let i = 0; i < tiles.length; i++) {
      if (w.nodes.has(i)) continue;
      const [x, y] = w.xy(i), kind = nodeKindAt(tiles[i], x, y);
      if (kind !== 'iron_vein' && kind !== 'crystal') continue;
      w.nodes.set(i, { kind, left: fullAmount(kind, x, y), regrowAt: 0 });
      w.dirtyChunks.add(chunkOf(i, size));
    }
```
(import `fullAmount`).

`engine/world.ts`:
- `gather()`: after the `bag_full` check, for node targets whose def has `needsPickaxe` and no `bestTool(a, target)`, throw `GameFail('needs_pickaxe', 'You need a pickaxe for that.', 'Craft a stone pickaxe at a workbench, or buy one from the Smith.')`.
- `hurt()`: `damage = damage * (1 - armorOf(a));` as the first line.
- `stepAgent`: replace the Task 2 inline torch wear with `useGear(this, a, 'torch')`.

`engine/tasks.ts`:
- In `gatherStep`, replace `const def = NODE_DEF[w.nodes.get(t.node)!.kind];` and the tick check with:
```ts
  const kind = w.nodes.get(t.node)!.kind, def = NODE_DEF[kind];
  const tool = bestTool(a, kind);
  if (def.needsPickaxe && !tool) {
    w.interrupt(a, 'Your pickaxe is gone. You cannot dig this by hand.');
    return 'idle';
  }
  const ticks = tool ? Math.max(1, Math.ceil(def.ticks / (tool.tier === 2 ? 4 : 2))) : def.ticks;
  if (def.bonus && w.rng() < def.bonus.chance / ticks && addItem(a.inventory, def.bonus.item, 1)) w.note(a, `Bonus: a ${def.bonus.item} fell out!`);
  if (++t.progress < ticks) return 'busy';
  t.progress = 0;
  if (tool) useGear(w, a, tool.item);
  return harvest(w, a, t);
```
- In `harvest`, the yield multiplier becomes:
```ts
  const plant = node.kind === 'tree' || node.kind === 'berry_bush' || node.kind === 'grass';
  const per = (plant && a.role === 'gatherer') || (!plant && a.role === 'miner') ? B.gathererMultiplier : 1;
```

- [ ] **Step 5: Run and commit**

Run: `bun run test && bun run test:int && bunx tsc --noEmit`
Expected: green.
- Tests that relied on a gatherer doubling rock ("a point per 20 units gathered, counting double yield") need `role: 'miner'` or `until` 10. Ledger it.
- The fields test in `nodes.test.ts` (`[null, 'rock']` for hills) must include `'iron_vein'`.

```bash
git add shared engine test
git commit -m "feat(engine): axes and pickaxes speed gathering and wear out; armor; iron veins in hills and mountains, crystals in ruins and peaks; miners dig double" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Smith's market and giving

**Files:**
- Create: `engine/smith.ts`
- Modify: `engine/world.ts` (market field, decay in step), `engine/persist.ts`, `shared/balance.ts`
- Test: `engine/smith.test.ts` (new)

**Interfaces:**
- Produces:
  - `smithAt(w) → Vec`
  - `buyPrice(w, item)`
  - `smith(w, id, action: 'buy' | 'sell' | 'blueprint' | 'prices', item?, count?)`
  - `give(w, id, to, item, count)`
  - `decayMarket(w)`
  - `World.market: Record<string, number>`
  - Redis `market` string

- [ ] **Step 1: Failing tests** in `engine/smith.test.ts`

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { buyPrice, decayMarket, give, smith, smithAt } from './smith.ts';
import { GameFail, World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
}
function robot(w: World, name: string, at: Vec, bag: Record<string, number> = {}) {
  const a = w.register(name, 0);
  w.join(a.id, 'miner', null, 0);
  [a.x, a.y] = at;
  a.inventory = bag;
  return a;
}
const failCode = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as GameFail).code;
  }
};

test('robots start with 10 gold; the Smith only trades with robots next to him', () => {
  const w = world();
  const [sx, sy] = smithAt(w);
  const far = robot(w, 'Far', [5, 5], { iron_ore: 1 });
  assert.equal(far.wallet, B.startGold);
  assert.equal(failCode(() => smith(w, far.id, 'sell', 'iron_ore', 1)), 'too_far');
});

test('selling pays gold, and the price drops as the Smith stocks up, never below 1, recovering over time', () => {
  const w = world();
  const [sx, sy] = smithAt(w);
  const a = robot(w, 'Miner', [sx + 1, sy], { iron_ore: 20, stone: 20 });
  const first = buyPrice(w, 'iron_ore');
  assert.equal(first, 4);
  const sold = smith(w, a.id, 'sell', 'iron_ore', 20);
  assert.ok(sold.gold_earned < 20 * 4 && sold.gold_earned > 0);
  assert.equal(a.wallet, B.startGold + sold.gold_earned);
  assert.ok(buyPrice(w, 'iron_ore') < first);
  smith(w, a.id, 'sell', 'stone', 20);
  assert.ok(buyPrice(w, 'stone') >= 1);
  const low = buyPrice(w, 'iron_ore');
  for (let i = 0; i < 100; i++) decayMarket(w);
  assert.ok(buyPrice(w, 'iron_ore') > low);
  assert.equal(failCode(() => smith(w, a.id, 'sell', 'iron_ore', 1)), 'missing_items');
  assert.equal(failCode(() => smith(w, a.id, 'sell', 'berries', 1)), 'not_buying');
});

test('buying shop items, stocked goods and blueprints costs gold; no debt, no overfull bags', () => {
  const w = world();
  const [sx, sy] = smithAt(w);
  const a = robot(w, 'Buyer', [sx, sy + 1]);
  a.wallet = 130;
  smith(w, a.id, 'buy', 'stone_axe', 1);
  assert.deepEqual([a.inventory.stone_axe, a.wallet], [1, 115]);
  assert.equal(failCode(() => smith(w, a.id, 'buy', 'iron', 1)), 'out_of_stock');
  w.market.iron = 5;
  smith(w, a.id, 'buy', 'iron', 2);
  assert.deepEqual([a.inventory.iron, a.wallet, w.market.iron], [2, 115 - 2 * 2 * 10, 3]);
  assert.equal(failCode(() => smith(w, a.id, 'blueprint', 'iron_sword')), 'not_enough_gold');
  a.wallet = 150;
  smith(w, a.id, 'blueprint', 'iron_sword');
  assert.deepEqual([a.blueprints, a.wallet], [['iron_sword'], 0]);
  assert.equal(failCode(() => smith(w, a.id, 'blueprint', 'iron_sword')), 'already_known');
  a.wallet = 1000;
  a.inventory = { berries: 240 };
  assert.equal(failCode(() => smith(w, a.id, 'buy', 'club', 1)), 'bag_full');
  assert.equal(a.wallet, 1000);
});

test('give hands items or gold to a robot within 2 tiles; nothing moves on failure', () => {
  const w = world();
  const a = robot(w, 'Giver', [10, 10], { wood: 5 });
  const b = robot(w, 'Taker', [11, 10]);
  const c = robot(w, 'Faraway', [30, 30]);
  give(w, a.id, b.id, 'wood', 3);
  give(w, a.id, b.id, 'gold', 4);
  assert.deepEqual([a.inventory.wood, b.inventory.wood, a.wallet, b.wallet], [2, 3, 6, 14]);
  assert.equal(failCode(() => give(w, a.id, c.id, 'wood', 1)), 'too_far');
  assert.equal(failCode(() => give(w, a.id, b.id, 'wood', 9)), 'missing_items');
  assert.equal(failCode(() => give(w, a.id, b.id, 'gold', 99)), 'not_enough_gold');
  assert.equal(failCode(() => give(w, a.id, a.id, 'wood', 1)), 'bad_target');
  assert.ok(w.observe(b.id).inbox.some((l) => l.includes('Giver gave you 3 wood')));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./engine/smith.test.ts`
Expected: FAIL, cannot find `./smith.ts`.

- [ ] **Step 3: engine/smith.ts**

```ts
import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { BLUEPRINTS, ITEMS, SMITH_BUYS, SMITH_SELLS, addItem, room, takeItem } from '../shared/items.ts';
import type { Vec } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

export const smithAt = (w: World): Vec => w.plaza;

/** What the Smith pays for one unit now: less the more he already holds. */
export const buyPrice = (w: World, item: string): number =>
  SMITH_BUYS[item] ? Math.max(1, Math.round((SMITH_BUYS[item] * B.marketDepth) / (B.marketDepth + (w.market[item] ?? 0)))) : 0;

export function smith(w: World, id: string, action: string, item = '', count = 1) {
  const a = w.alive(id);
  if (dist(smithAt(w), [a.x, a.y]) > B.smithRange) {
    throw new GameFail('too_far', 'The Smith cannot hear you from there.', `Walk to the Smith at the Plaza, (${smithAt(w).join(', ')}).`);
  }
  const n = Math.max(1, Math.min(100, Math.floor(count)));
  if (action === 'prices') {
    const buying = Object.fromEntries(Object.keys(SMITH_BUYS).map((i) => [i, buyPrice(w, i)]));
    const stocked = Object.fromEntries(Object.entries(w.market).filter(([, k]) => k >= 1).map(([i, k]) => [i, { price: SMITH_BUYS[i] * 2, stock: Math.floor(k) }]));
    return { buying, selling: { ...Object.fromEntries(Object.entries(SMITH_SELLS).map(([i, s]) => [i, `${s.count} for ${s.price}`])), ...stocked }, blueprints: BLUEPRINTS, your_gold: a.wallet };
  }
  if (action === 'sell') {
    if (!SMITH_BUYS[item]) throw new GameFail('not_buying', `The Smith does not want ${item}.`, `He buys: ${Object.keys(SMITH_BUYS).join(', ')}.`);
    if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
    let earned = 0;
    for (let i = 0; i < n; i++) {
      earned += buyPrice(w, item);
      w.market[item] = (w.market[item] ?? 0) + 1;
    }
    takeItem(a.inventory, item, n);
    a.wallet += earned;
    w.bump(a, `sell:${item}`);
    w.marketDirty = true;
    w.dirty.add(a.id);
    return { sold: `${n} ${item}`, gold_earned: earned, gold: a.wallet, next_price: buyPrice(w, item) };
  }
  if (action === 'blueprint') {
    const price = BLUEPRINTS[item];
    if (price === undefined) throw new GameFail('unknown_blueprint', `There is no "${item}" blueprint.`, `Blueprints: ${Object.keys(BLUEPRINTS).join(', ')}.`);
    if (a.blueprints.includes(item)) throw new GameFail('already_known', 'You already know that one.', 'Craft it at a workbench.');
    if (a.wallet < price) throw new GameFail('not_enough_gold', `That costs ${price} gold; you have ${a.wallet}.`, 'Sell ore, crystals, hides or meat to the Smith.');
    a.wallet -= price;
    a.blueprints.push(item);
    w.dirty.add(a.id);
    return { learned: item, gold: a.wallet };
  }
  if (action === 'buy') {
    const shop = SMITH_SELLS[item];
    const stocked = (w.market[item] ?? 0) >= n && SMITH_BUYS[item];
    if (!shop && !stocked) throw new GameFail(SMITH_BUYS[item] ? 'out_of_stock' : 'not_selling', `The Smith has no ${item} for you.`, 'Try smith(prices) to see what he has.');
    const units = shop ? shop.count * n : n, price = shop ? shop.price * n : SMITH_BUYS[item] * 2 * n;
    if (a.wallet < price) throw new GameFail('not_enough_gold', `That costs ${price} gold; you have ${a.wallet}.`, 'Sell something first.');
    if (room(a.inventory, item) < units) throw new GameFail('bag_full', 'No room in your bag for that.', 'Eat, sell or drop something first.');
    addItem(a.inventory, item, units);
    if (ITEMS[item]?.uses && a.wear[item] === undefined) a.wear[item] = ITEMS[item].uses!;
    if (!shop) w.market[item] -= n;
    a.wallet -= price;
    w.marketDirty = true;
    w.dirty.add(a.id);
    return { bought: `${units} ${item}`, gold_spent: price, gold: a.wallet };
  }
  throw new GameFail('bad_action', `The Smith does not know how to "${action}".`, 'Use buy, sell, blueprint or prices.');
}

/** Hand items (or "gold") to a robot within 2 tiles. */
export function give(w: World, id: string, to: string, item: string, count = 1) {
  const a = w.alive(id), n = Math.max(1, Math.floor(count));
  const b = w.agents.get(to);
  if (!b || b.id === a.id || !b.joined || b.dead) throw new GameFail('bad_target', 'There is nobody like that to give to.', 'Use an agent id from observe.');
  if (dist([b.x, b.y], [a.x, a.y]) > B.giveRange) throw new GameFail('too_far', `${b.name} is too far away.`, `Stand within ${B.giveRange} tiles.`);
  if (item === 'gold') {
    if (a.wallet < n) throw new GameFail('not_enough_gold', `You only have ${a.wallet} gold.`, 'Give less.');
    a.wallet -= n;
    b.wallet += n;
  } else {
    if ((a.inventory[item] ?? 0) < n) throw new GameFail('missing_items', `You do not have ${n} ${item}.`, 'Check your bag.');
    if (room(b.inventory, item) < n) throw new GameFail('their_bag_full', `${b.name}'s bag is too full.`, 'Give less.');
    takeItem(a.inventory, item, n);
    addItem(b.inventory, item, n);
  }
  w.note(b, `${a.name} gave you ${n} ${item}.`);
  w.dirty.add(a.id);
  w.dirty.add(b.id);
  w.touch(a);
  return { gave: `${n} ${item}`, to: b.name };
}

/** The Smith uses up a little of his stock every minute, so prices recover. */
export function decayMarket(w: World): void {
  for (const [item, n] of Object.entries(w.market)) {
    const left = n * (1 - B.marketDecay);
    if (left < 0.5) delete w.market[item];
    else w.market[item] = left;
  }
  w.marketDirty = true;
}
```

`shared/balance.ts`:
```ts
  smithRange: 3,
  giveRange: 2,
  marketDepth: 40, // price = base * depth / (depth + stock)
  marketDecay: 0.02, // share of stock used up per minute
```

`engine/world.ts`: fields `market: Record<string, number> = {}; marketDirty = false;`. In `step()`, `if (this.tick % 60 === 0) decayMarket(this);` (import from `./smith.ts`).

`engine/persist.ts`: `K.market = 'market'`. In flush, `if (w.marketDirty) m.set(K.market, JSON.stringify(w.market))`, with the same dirty-flag save and restore. In load, `const mk = await r.get(K.market); if (mk) w.market = JSON.parse(mk) as Record<string, number>;`

- [ ] **Step 4: Run and commit**

Run: `bun run test && bun run test:int && bunx tsc --noEmit`
Expected: green.

```bash
git add shared engine test
git commit -m "feat(engine): the Smith's market (prices fall with stock and recover), blueprints, shop, resold goods; give items and gold" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Combat gear: reach, knockback, weapon wear, BONK

**Files:**
- Modify: `engine/combat.ts`, `engine/tasks.ts` (iron armor slows walking)
- Test: `engine/combat.test.ts` (append)

- [ ] **Step 1: Failing tests** (append to `engine/combat.test.ts`)

```ts
test('a spear hits from 2 tiles; a frying pan knocks back and BONKs; weapons wear out', () => {
  const w = world();
  const a = joined(w, 'Chef', [10, 10]);
  const b = joined(w, 'Target', [12, 10]);
  Object.assign(b, { food: 50, water: 50, autoFlee: false });
  a.inventory = { stone_spear: 1 };
  startAttack(w, a.id, b.id);
  w.step(0);
  w.step(0);
  assert.deepEqual([a.x, b.health], [10, 86]); // no step closer needed
  a.inventory = { frying_pan: 1 };
  b.x = 11;
  startAttack(w, a.id, b.id);
  w.step(0);
  w.step(0);
  assert.equal(b.x, 12); // bonked a tile back
  b.health = 5;
  for (let i = 0; i < 4; i++) w.step(0);
  assert.ok(b.dead);
  assert.equal(a.stats['kill:frying_pan'], 1);
  assert.ok(a.achievements.bonk !== undefined);
});

test('iron armor slows you down', () => {
  const w = world();
  const a = joined(w, 'Tank', [10, 10]);
  a.inventory = { iron_armor: 1 };
  w.moveTo(a.id, 30, 10);
  for (let i = 0; i < 5; i++) w.step(0);
  assert.ok(a.x < 20 && a.x >= 17, String(a.x)); // 10 steps unarmored, 8 with armor
});
```
(The BONK achievement row is added in Task 6. Run this test again after Task 6; until then the `achievements.bonk` line fails. Ledger it.)

- [ ] **Step 2: Implementation**

`engine/combat.ts`:
- `weaponOf(a)` reads `ITEMS`:
```ts
export function weaponOf(a: Agent): { name: string; damage: number; reach: number } {
  let best = { name: 'fists', damage: B.fistDamage, reach: B.attackReach };
  for (const [name, def] of Object.entries(ITEMS)) {
    if (def.damage && (a.inventory[name] ?? 0) > 0 && def.damage > best.damage) best = { name, damage: def.damage, reach: def.reach ?? B.attackReach };
  }
  return best;
}
```
- In `fightStep`, replace `B.attackReach` with `const reach = weaponOf(a).reach;` (both comparisons).
- In `strike`, before hitting, `const weapon = weaponOf(a);`. After a creature or robot hit, `if (weapon.name !== 'fists') useGear(w, a, weapon.name);`.
- Pan knockback: after `w.hurt(victim, ...)` returns false, if `ITEMS[weapon.name]?.knockback`, push the victim one step directly away:
```ts
    const [dx, dy] = [Math.sign(victim.x - a.x), Math.sign(victim.y - a.y)];
    if (w.canStep(victim.x, victim.y, victim.x + dx, victim.y + dy) && walkable(w.at(victim.x + dx, victim.y + dy))) [victim.x, victim.y] = [victim.x + dx, victim.y + dy];
    w.emit('bonk', `🍳 BONK! ${a.name} hit ${victim.name} with a frying pan.`, a);
```
- On a robot kill, `w.bump(a, \`kill:${weapon.name}\`)`.

`engine/tasks.ts` `walk()`: `let budget = a.energy <= 0 ? 1 : B.moveBudgetPerTick;` then `if ((a.inventory.iron_armor ?? 0) > 0 && w.tick % 5 < 1) budget -= 1;` (heavy armor loses a step every 5 ticks). Walking uses `w.tick`, so `walk(w, a, path)` needs `w`; it already takes `w`.

- [ ] **Step 3: Run and commit**

Run: `bun run test && bunx tsc --noEmit`
Expected: green, except the `bonk` achievement line until Task 6.

```bash
git add engine
git commit -m "feat(engine): spear reach, frying-pan knockback, weapon wear, iron armor weight" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Achievements, observe, rules, tools over MCP

**Files:**
- Modify: `engine/achievements.ts`, `engine/observe.ts`, `engine/rules.ts`, `engine/actions.ts`, `engine/world.ts` (eat and drink), `gateway/mcp.ts`
- Test: `engine/actions.test.ts`, `test/e2e.test.ts`

- [ ] **Step 1: Failing tests**

Append to `engine/actions.test.ts`:
```ts
test('build, fuel_campfire, smith and give are wired; eating salad is cursed; a waterskin carries drinks', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'miner' } });
  const a = w.agents.get(id)!;
  a.inventory = { wood: 10, stone: 3, fiber: 5, waterskin: 1 };
  a.wear.waterskin = 5;
  assert.equal(handleAction(w, { agentId: id, tool: 'build', args: { structure: 'campfire' } }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'fuel_campfire', args: {} }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'craft', args: { item: 'grass_salad' } }).ok, true);
  assert.equal(handleAction(w, { agentId: id, tool: 'eat', args: { item: 'grass_salad' } }).ok, true);
  assert.ok(a.achievements.literally_touched_grass !== undefined);
  const s = handleAction(w, { agentId: id, tool: 'smith', args: { action: 'prices' } });
  assert.equal(!s.ok && s.error.error, 'too_far');
  a.water = 50;
  [a.x, a.y] = [9, 9]; // far from water on this map
  assert.equal(handleAction(w, { agentId: id, tool: 'drink', args: {} }).ok, true);
  assert.deepEqual([a.water, a.wear.waterskin], [80, 4]);
});
```
In `test/e2e.test.ts`, the tool list gains `build`, `fuel_campfire`, `give` and `smith`.

- [ ] **Step 2: Implementation**

`engine/achievements.ts` — add rows before `speedrun_any`:
```ts
  { id: 'lumberjack', emoji: '🪵', name: 'Lumberjack', tier: 'rare', trigger: 'Gather 500 wood', progress: (a) => [stat(a, 'gather:wood'), 500] },
  { id: 'iron_age', emoji: '⛏️', name: 'Iron Age', tier: 'common', trigger: 'Smelt your first iron', progress: (a) => [stat(a, 'craft:iron'), 1] },
  { id: 'blueprint_collector', emoji: '📜', name: 'Blueprint Collector', tier: 'epic', trigger: 'Own every blueprint', progress: (a) => [a.blueprints.length, Object.keys(BLUEPRINTS).length] },
  { id: 'bonk', emoji: '🍳', name: 'BONK', tier: 'rare', trigger: 'Defeat a robot with a frying pan', progress: (a) => [stat(a, 'kill:frying_pan'), 1] },
  { id: 'tycoon', emoji: '💰', name: 'Tycoon', tier: 'rare', trigger: 'Hold 1000 gold', progress: (a) => [a.wallet, 1000] },
```
and after `monster`:
```ts
  { id: 'literally_touched_grass', emoji: '🥗', name: 'Literally Touched Grass', tier: 'cursed', trigger: 'Eat a grass salad', progress: (a) => [stat(a, 'eat:grass_salad'), 1] },
```
(import `BLUEPRINTS`).

`engine/world.ts` `drink()`:
```ts
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
```

`engine/actions.ts`:
- Add `'build', 'fuel_campfire', 'smith', 'give'` to `DO_TOOLS`.
- `craft` passes `Number(args.count ?? 1)`.
- New cases:
```ts
    case 'build':
      return withView({ ...build(world, agentId, String(args.structure ?? '')), message: 'You built a thing. It is mostly straight.' });
    case 'fuel_campfire':
      return withView({ ...fuel(world, agentId), message: 'The fire crackles happily.' });
    case 'smith':
      return withView(smith(world, agentId, String(args.action ?? ''), String(args.item ?? ''), Number(args.count ?? 1)));
    case 'give':
      return withView(give(world, agentId, String(args.agent ?? ''), String(args.item ?? ''), Number(args.count ?? 1)));
```

`engine/observe.ts`:
- Add stations and the Smith to `nearby`: `${kind} at (${x}, ${y}) ${d} tiles ${dir}${lit ? ' (lit)' : ''}` for structures in vision. Add `the Smith ... tiles` to `landmarks`.
- Mark structures `+` on the grid and the Smith `!`; add both to `LEGEND`.
- In `you`, add `gear: Object.fromEntries(Object.entries(a.wear).filter(([i]) => a.inventory[i]))` (uses left) and `blueprints: a.blueprints`.

`engine/rules.ts`:
- Add `crafting`: recipes grouped by station with needs, blueprint prices, and station costs.
- Add `economy`: the Smith's buy and sell lists, the price-drop rule, `give`, and 10 starting gold.
- Add `tools`: tick table and durability.
- Change the scoring line `death resets your life score; season score and wallet stay` to `death resets your life score; season score and gold stay`.

`gateway/mcp.ts`:
- `craft` input becomes `{ item: z.enum(Object.keys(RECIPES)), count: z.number().int().min(1).max(20).optional(), thought }`; the description lists recipes and stations.
- New tools:
```ts
  s.registerTool('build', {
    description: `Place a station on a free tile next to you: ${Object.entries(STRUCTURES).map(([k, n]) => `${k} (${Object.entries(n).map(([m, c]) => `${c} ${m}`).join(' + ')})`).join(', ')}. Workbench: tools and gear. Campfire: cooking, light (no monsters within ${B.campfireLight} tiles), burns ${B.campfireTicks / 60} min. Furnace: iron. Not in the Plaza. Costs an action cooldown.`,
    inputSchema: { structure: z.enum(Object.keys(STRUCTURES) as [string, ...string[]]), thought },
  }, (args) => reply('build', args, 'do'));
  s.registerTool('fuel_campfire', {
    description: `Feed 1 wood to the campfire within ${B.stationRange} tiles: +${B.campfireTicks / 60} min of fire. Costs an action cooldown.`,
    inputSchema: { thought },
  }, (args) => reply('fuel_campfire', args, 'do'));
  s.registerTool('smith', {
    description: `Trade with the Smith at the Plaza (stand within ${B.smithRange} tiles). action: prices | sell | buy | blueprint. He pays gold for ore, iron, crystals, hides, meat and more; the more he holds, the less he pays. He sells tools, marshmallows, blueprints for iron gear, and resells what miners bring him. Costs an action cooldown.`,
    inputSchema: { action: z.enum(['prices', 'sell', 'buy', 'blueprint']), item: z.string().max(40).optional(), count: z.number().int().min(1).max(100).optional(), thought },
  }, (args) => reply('smith', args, 'do'));
  s.registerTool('give', {
    description: `Hand items, or "gold", to a robot within ${B.giveRange} tiles. Deals are made in chat; the game does not enforce them. Costs an action cooldown.`,
    inputSchema: { agent: z.string().max(40), item: z.string().max(40), count: z.number().int().min(1).max(10000).optional(), thought },
  }, (args) => reply('give', args, 'do'));
```

- [ ] **Step 3: Run and commit**

Run: `bun run test && bun run test:int && bun run typecheck`
Expected: green, including Task 5's BONK assertion.

```bash
git add engine gateway test
git commit -m "feat: build, fuel_campfire, smith and give tools; -5 achievements; observe and rules show stations, gear, gold and prices" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Spectator: stations, the Smith, new nodes, item icons, gold

**Files:**
- Create: `web/src/structures.ts`
- Modify: `web/src/main.ts`, `web/src/props.ts`, `web/src/icons.ts`, `web/src/ui.ts`, `web/assets/` (Survival Kit models), `web/assets/CREDITS.md`

- [ ] **Step 1: Assets**

- Copy these models from the Kenney Survival Kit (`Models/GLB format/`) into `web/assets/survival/`, with its `Textures/` folder: `workbench.glb`, `campfire-pit.glb`, `workbench-anvil.glb`, `resource-stone-large.glb`, `signpost.glb`.
- Add a credits row: `survival/*.glb | Survival Kit, https://kenney.nl/assets/survival-kit | Kenney | CC0 1.0`.

- [ ] **Step 2: web/src/structures.ts**

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { StructureView, Vec } from '../../shared/types.ts';

// Survival Kit models (CC0). The furnace is a big stone with a glowing mouth.
const FILES: Record<string, string> = { workbench: 'workbench', campfire: 'campfire-pit', furnace: 'resource-stone-large', anvil: 'workbench-anvil', sign: 'signpost' };
const SIZE: Record<string, number> = { workbench: 0.9, campfire: 0.7, furnace: 1.1, anvil: 0.7, sign: 1.2 };

export class Structures {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  models = new Map<string, THREE.Object3D>();
  placed = new Map<string, THREE.Object3D>();
  flames = new Map<string, THREE.Mesh>();
  key = '';

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number) {
    this.scene = scene;
    this.heightAt = heightAt;
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(FILES).map(async ([kind, file]) => {
      const g = await loader.loadAsync(`/assets/survival/${file}.glb`);
      g.scene.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) o.material.metalness = 0;
      });
      const h = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
      g.scene.scale.setScalar(SIZE[kind] / Math.max(h.x, h.y, h.z));
      this.models.set(kind, g.scene);
    }));
  }

  /** The Smith's forge in the middle of the Plaza. */
  smith([x, y]: Vec): void {
    for (const [kind, dx] of [['anvil', 1], ['sign', -1]] as const) {
      const m = this.models.get(kind)!.clone();
      m.position.set(x + 0.5 + dx, this.heightAt(x + dx, y), y + 0.5);
      this.scene.add(m);
    }
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = 'Smith';
    const label = new CSS2DObject(tag);
    label.position.set(x + 0.5, this.heightAt(x, y) + 1.8, y + 0.5);
    this.scene.add(label);
  }

  sync(list: StructureView[]): void {
    const key = list.map((s) => s.join(':')).join(';');
    if (key === this.key) return;
    this.key = key;
    const seen = new Set<string>();
    for (const [x, y, kind, lit] of list) {
      const id = `${x},${y}`;
      seen.add(id);
      if (!this.placed.has(id)) {
        const m = this.models.get(kind)!.clone();
        m.position.set(x + 0.5, this.heightAt(x, y), y + 0.5);
        this.scene.add(m);
        this.placed.set(id, m);
      }
      let flame = this.flames.get(id);
      if ((kind === 'campfire' || kind === 'furnace') && !flame) {
        flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 6), new THREE.MeshBasicMaterial({ color: '#ff9a2e' }));
        flame.position.set(x + 0.5, this.heightAt(x, y) + (kind === 'furnace' ? 0.3 : 0.25), y + 0.5);
        this.scene.add(flame);
        this.flames.set(id, flame);
      }
      if (flame) flame.visible = kind === 'furnace' || lit;
    }
    for (const [id, m] of this.placed) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.placed.delete(id);
      const f = this.flames.get(id);
      if (f) this.scene.remove(f);
      this.flames.delete(id);
    }
  }
}
```

- [ ] **Step 3: Wire, new nodes, icons, gold**

- `web/src/main.ts`:
  - construct `const structures = new Structures(scene, (x, y) => chunks.heightAt(x, y));` next to creatures and add `structures.load()` to the loading `Promise.all`;
  - on `hello`, call `structures.smith(m.plaza)` once chunks near the Plaza exist. Simpler: call it on the first tick after hello, once `chunks.heightAt(plaza) > 0`, tracked by a `smithPlaced` flag;
  - in the tick branch, `structures.sync(m.structures)`.
- `web/src/props.ts`: `MODEL` gains `iron_vein: () => 'stone_largeA'` and `crystal: () => 'stone_largeA'`. Tint per kind: add a `TINT: Record<NodeKind, string | null>`, where `iron_vein` is `#b5653a` and `crystal` is `#7fd8ff`. Set instance colours for those kinds, the same way the tree greens do: add their names to the tint path.
- `web/src/icons.ts`: add paths for `stone_axe`/`iron_axe` (axe), `stone_pickaxe`/`iron_pickaxe` (pickaxe), `stone_spear`, `iron_sword`, `frying_pan`, `hide_armor`/`iron_armor` (shirt), `torch`, `waterskin`, `backpack`, `iron`, `iron_ore`, `cooked_meat`, `grass_salad`, `marshmallow`, `roasted_marshmallow`, `gold` (coin) and `miner` (pickaxe). Iron items get `#c0c6cc`; stone tools `#a7a39c`; `gold` `#ffd166`.
- `web/src/ui.ts` focus: the score row gets `chip('gold', v.gold, 'gold')`. This needs `gold: number` on `AgentView`: add it in `shared/types.ts`, and set `gold: a.wallet` in `World.views()`.

- [ ] **Step 4: Build, look in Brave, commit**

Run: `bun run build:web && bun run typecheck`

In Brave (plain `browser-use`), locally:
1. Place a workbench, campfire and furnace via a script agent.
2. Check that the models, flames, Smith forge, gold chip and the new node tints show up.

```bash
git add web
git commit -m "feat(web): workbench, campfire and furnace models with flames, the Smith's forge, iron and crystal nodes, gear and gold icons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Agents, docs, spec; local economy demo; release

- [ ] **Step 1: Example agents**

- `examples/llm-agent.ts`:
  - ACTIONS gains `build`, `smith` and `give`.
  - The prompt gains: `Tools make work faster: build a workbench (6 wood, 2 stone) and craft a stone_axe or stone_pickaxe. Miners: iron is in the hills and mountains; sell ore to the Smith at the Plaza for gold (smith action=sell). Cook meat at a campfire.`
  - Fallback: if carrying ≥ 6 wood and ≥ 2 stone and no axe, build a workbench then craft `stone_axe`.
- `examples/scripted-bot.ts`: if the bag has ≥ 11 slots used, walk to the Plaza and `smith sell` the biggest material stack. If it has wood ≥ 9 and stone ≥ 5 and no axe, `build workbench` then `craft stone_axe`.

- [ ] **Step 2: Docs**

- **AGENT_PROMPT:** add a "Tools, stations and gold" section.
- **README tools lines:** add `build`, `fuel_campfire`, `smith`, `give`.
- **Spec:**
  - Row 0.0.1-5: record the as-built deviations listed at the top of this plan.
  - §11: note the smaller bags and gold.
  - §18: the wallet is gold from trading; score no longer adds to it.
  - §5 keys: add `structures`, `market`, and `meta.bagRules`.

- [ ] **Step 3: Verify, demo, release**

1. Run: `bun run test && bun run test:int && bun run typecheck && bun run build:web`.
2. Demo locally: bots run for a while; confirm in world chat and state that someone sells to the Smith, the market price drops, a tool snaps, and a campfire is lit.
3. Set `package.json` version to `0.0.1-5`, then commit.
4. Push, and tag `v0.0.1-5`.
5. Poll `/health` for `0.0.1-5`.

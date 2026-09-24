# Touch Grass 0.0.1-4 "Things With Teeth" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The world fights back. Animals roam near robots, and night brings Grass Goblins, wolf packs and the occasional Moss Golem, while Lost Roombas eat loot piles. Robots can `attack` anything (including rocks, sadly), craft a club, and medics can `heal`. Spectators see creatures and can jump to fights with `C`.

**Architecture:** Creature stats live in a data table (`shared/creatures.ts`). `engine/creatures.ts` owns population, AI and monster attacks; it runs once per tick after the robots. `engine/combat.ts` owns the `attack` task, damage, kills, scoring and `heal`, and `engine/craft.ts` holds the one hand recipe. `World` gains `creatures`, `hurt()` and `alarm()`. Creatures persist as one Redis string, like loot, and go out in every tick delta.

**Tech Stack:** unchanged (Bun 1.4.2, node-redis, MCP SDK, Three.js).

**Spec:** `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`. Sections: release row 0.0.1-4; §6.3 combat tools; §6.4 cooldowns; §8.1 roles (hunter, medic); §8.4 death; §9 attack task and interrupts; §10.2 animals; §11 food and club; §14 combat and monsters; §18 kill scores; §19 the achievements marked -4; §21 `C` fight cam.

**Deviations from the spec (Task 6 syncs the spec):**
- Creatures only exist near robots. They spawn 16–28 tiles from one and despawn beyond 96 tiles, which approximates the spec's "steady population per region" at a fraction of the cost.
- Ducks are capped at min(20, 2 per robot).
- A creature's drops go straight into the killer's bag; anything that doesn't fit becomes a loot pile. A robot's death still drops its own loot pile.
- The club comes from a minimal `craft(item)` that has one hand recipe, club = 5 wood. 0.0.1-5 adds stations and the rest of the recipes.
- You always fight with your best carried weapon; there is no equip step.
- The 2 s combat cooldown applies when you are attacking, were hit in the last 10 s, or a hostile monster is within 3 tiles. "Enemy agent" has no meaning until clans or duels exist.
- Light radii are ignored until campfires exist (0.0.1-6).
- The Golem's damage to walls waits for walls (0.0.1-6).
- Creatures are drawn as coloured primitives with an emoji tag and an HP bar; Quaternius models come later.

## Global Constraints

- Bun ≥ 1.4, `.ts` import extensions, `import type` for types, **never `any`**, comments ≤ 2 lines. Every tunable number lives in `shared/balance.ts`.
- Attacks hit every 2 ticks while in reach (1 tile). Fists deal 5, a club 10; hunters deal ×1.5. `attack(rock)` gives the cursed achievement "Rock Fighter". No PvP in the Plaza.
- Monsters spawn only at night, more than 40 tiles from the Plaza. The live monster cap is 2 × active (online) robots. At dawn monsters despawn, except the Roomba.
- Creature HP and damage: Goblin 20 HP, 4 damage, steals 1 item then flees. Wolf 30 HP, 8 damage, packs of 3, hunts lone robots. Roomba 40 HP, harmless, vacuums loot piles older than 2 minutes, at most 3. Golem 200 HP, 20 damage, slow, spawns in ruins with a 10% chance per night. Boar 25 HP, fights back for 8.
- Drops: rabbit meat 1; deer meat 3 + hide 2; boar meat 4 + hide 1; duck meat 1; goblin fiber 1 + its stolen items; wolf meat 2 + hide 1; Roomba battery + everything it vacuumed; Golem crystal 5.
- Kill scores: animal +1, monster +2, robot +5, Golem +20. Killing the same robot again within 10 min scores nothing.
- Medic `heal(agent)`: +20 health to another robot within 2 tiles.
- Food: raw meat gives +10 food and has a 30% chance of a tummy ache (−20 energy). A battery gives +50 energy.
- Achievements: 🩸 First Blood (common), 🐺 Pack Leader, 20 wolves (rare), 🗿 Golem Slayer (epic), 🩹 Field Medic, 10 different robots healed while under 50% (rare), 🤡 Rock Fighter (cursed), 🦆 Monster, kill a duck (cursed).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Test locally. Push once at the end (auto-deploy builds on every push). Browser checks use the user's Brave through plain `browser-use`, never headless Chrome.

## Review Focus

1. **Fighting robots in or into the Plaza.** Refused with `plaza_peace`, whichever side is standing on Plaza tiles. Pinned in Task 3.
2. **The target vanishes mid-fight** (it dies, despawns, or walks out of sight). The attack task ends with a note, with no crash and no stale target. Pinned in Task 3.
3. **Kill-farming a friend.** A second kill of the same robot within 10 minutes gives no score. Pinned in Task 3.
4. **Monster spawns near the Plaza, and dawn.** Nothing hostile appears within 40 tiles of the Plaza; dawn removes monsters but keeps Roombas. Pinned in Task 2.
5. **A restart while creatures are alive.** They come back with their HP and bags, and new ids never reuse old ones. Pinned in Task 4.

---

## File Structure

```text
shared/creatures.ts     NEW: CREATURE_KINDS, CREATURES table, isCreatureKind (Task 1)
shared/items.ts         + meat, battery, energy/tummy food fields, WEAPONS, RECIPES (Task 1)
shared/balance.ts       + combat and creature numbers (Task 1)
shared/types.ts         + Creature, CreatureView, attack Task, Agent/AgentView/TickDelta fields (Task 1)
engine/agent.ts         + defaults (Task 1)
engine/body.ts          eat() with rng, energy, tummy ache; eatBest skips non-food (Task 1)
engine/creatures.ts     NEW: spawnCreature, stepCreatures (population, AI, bites, dawn, golem, roomba) (Task 2)
engine/lines.ts         + death lines per killer, monsters-go-home line, {by} (Task 2)
engine/world.ts         + creatures, hurt, alarm, inCombat, creatureViews, kill(cause, by) (Tasks 2-3)
engine/combat.ts        NEW: weaponOf, startAttack, fightStep, heal (Task 3)
engine/craft.ts         NEW: craft (Task 3)
engine/tasks.ts         runTask 'attack' case (Task 3)
engine/achievements.ts  + 6 rows (Task 3)
engine/observe.ts       + creatures in grid/nearby, weapon, in_combat (Task 3)
engine/actions.ts, engine/persist.ts, engine/rules.ts, gateway/mcp.ts   tools, persistence, rules (Task 4)
web/src/creatures.ts    NEW: creature primitives + emoji tags (Task 5)
web/src/{main,robots}.ts, web/index.html      fight marker, C fight cam (Task 5)
examples/*, README.md, spec                   (Task 6)
```

---

### Task 1: Shared foundations

**Files:**
- Create: `shared/creatures.ts`
- Modify: `shared/items.ts`, `shared/balance.ts`, `shared/types.ts`, `engine/agent.ts`, `engine/body.ts`, `engine/world.ts` (eatItem only)
- Test: `engine/body.test.ts`

**Interfaces:**
- Produces:
  - `CREATURE_KINDS`, `CreatureKind`, `CreatureDef`, `CREATURES`, `isCreatureKind`
  - `FOOD[item].energy?`, `FOOD[item].tummy?`, `WEAPONS`, `RECIPES`
  - `eat(a, item, rng?) => boolean` (true on a tummy ache), `eatBest(a, rng?)`
  - Types: `Creature`, `CreatureView`, Task `{type:'attack'; target: string; progress: number}`
  - `Agent.lastHurtAt`, `Agent.recentKills`, `Agent.healed`
  - `AgentView.fighting`, `TickDelta.creatures`
  - `B.*` combat and creature numbers

- [ ] **Step 1: Failing tests** (append to `engine/body.test.ts`; add `eat, eatBest` to the `./body.ts` import)

```ts
test('raw meat can give a tummy ache; a battery is pure energy; auto-eat never eats batteries', () => {
  const a = bot({ food: 50, energy: 60, inventory: { meat: 2, battery: 1 } });
  assert.equal(eat(a, 'meat', () => 0.1), true);
  assert.deepEqual([a.food, a.energy], [60, 40]);
  assert.equal(eat(a, 'meat', () => 0.9), false);
  assert.deepEqual([a.food, a.energy], [70, 40]);
  eat(a, 'battery');
  assert.equal(a.energy, 90);
  assert.equal(eatBest(bot({ food: 10, inventory: { battery: 3 } })), null);
});

test('old records get combat fields', () => {
  const a = normalizeAgent({ id: 'agent_1', name: 'Old' });
  assert.deepEqual([a.lastHurtAt < 0, a.recentKills, a.healed], [true, {}, []]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./engine/body.test.ts`
Expected: FAIL. `eat` returns undefined, energy is unchanged, and `lastHurtAt` is undefined.

- [ ] **Step 3: shared/creatures.ts**

```ts
import type { Inventory } from './items.ts';

export const CREATURE_KINDS = ['rabbit', 'deer', 'boar', 'duck', 'goblin', 'wolf', 'roomba', 'golem'] as const;
export type CreatureKind = (typeof CREATURE_KINDS)[number];

export interface CreatureDef {
  emoji: string;
  name: string;
  hp: number;
  damage: number; // per bite, at most one bite every B.attackTicks
  hostile: boolean; // hunts robots on its own
  monster: boolean; // runs home at dawn
  flees: boolean; // runs from robots that come close
  slow: boolean; // moves every other tick
  drops: Inventory;
  score: number; // for the killing blow
  char: string; // observe grid
}

export const CREATURES: Record<CreatureKind, CreatureDef> = {
  rabbit: { emoji: '🐇', name: 'rabbit', hp: 5, damage: 0, hostile: false, monster: false, flees: true, slow: false, drops: { meat: 1 }, score: 1, char: '%' },
  deer: { emoji: '🦌', name: 'deer', hp: 15, damage: 0, hostile: false, monster: false, flees: true, slow: false, drops: { meat: 3, hide: 2 }, score: 1, char: '%' },
  boar: { emoji: '🐗', name: 'boar', hp: 25, damage: 8, hostile: false, monster: false, flees: false, slow: false, drops: { meat: 4, hide: 1 }, score: 1, char: '%' },
  duck: { emoji: '🦆', name: 'Confused Duck', hp: 5, damage: 0, hostile: false, monster: false, flees: false, slow: false, drops: { meat: 1 }, score: 1, char: '%' },
  goblin: { emoji: '👺', name: 'Grass Goblin', hp: 20, damage: 4, hostile: true, monster: true, flees: false, slow: false, drops: { fiber: 1 }, score: 2, char: '&' },
  wolf: { emoji: '🐺', name: 'wolf', hp: 30, damage: 8, hostile: true, monster: true, flees: false, slow: false, drops: { meat: 2, hide: 1 }, score: 2, char: '&' },
  roomba: { emoji: '🤖', name: 'Lost Roomba', hp: 40, damage: 0, hostile: false, monster: false, flees: false, slow: false, drops: { battery: 1 }, score: 2, char: '=' },
  golem: { emoji: '🗿', name: 'Moss Golem', hp: 200, damage: 20, hostile: true, monster: true, flees: false, slow: true, drops: { crystal: 5 }, score: 20, char: '&' },
};

export const isCreatureKind = (s: string): s is CreatureKind => (CREATURE_KINDS as readonly string[]).includes(s);
```

- [ ] **Step 4: shared/items.ts**

Replace the `FOOD` declaration with:
```ts
export const FOOD: Record<string, { food: number; water: number; energy?: number; tummy?: boolean }> = {
  berries: { food: 8, water: 2 },
  apple: { food: 10, water: 0 },
  meat: { food: 10, water: 0, tummy: true }, // raw: may upset the stomach
  battery: { food: 0, water: 0, energy: 50 }, // from Roombas; do not ask
};
```
and after `FOOD_ITEMS` add:
```ts
export const WEAPONS: Record<string, number> = { club: 10 }; // damage; bare fists are B.fistDamage
export const RECIPES: Record<string, Record<string, number>> = { club: { wood: 5 } }; // by hand; stations arrive in 0.0.1-5
```

- [ ] **Step 5: shared/balance.ts** (after `unkillableTicks`)

```ts
  // combat
  attackTicks: 2, // one hit every 2 ticks while in reach
  attackReach: 1,
  fistDamage: 5,
  hunterMultiplier: 1.5,
  combatTicks: 10, // counts as "in combat" this long after a hit
  threatRadius: 3,
  combatCooldownMs: 2000,
  antiFarmTicks: 600,
  agentKillScore: 5,
  healAmount: 20,
  healRange: 2,
  fieldMedicBelow: 50,
  tummyAcheChance: 0.3,
  tummyAcheEnergy: 20,
  // creatures
  animalsPerAgent: 6,
  maxAnimals: 300,
  maxDucks: 20,
  maxRoombas: 3,
  monstersPerAgent: 2,
  monsterSpawnChance: 0.01, // per online robot per night tick
  wolfPack: 3,
  golemNightChance: 0.1,
  plazaSafeRadius: 40,
  spawnMinDist: 16,
  spawnMaxDist: 28,
  creatureActiveRadius: 48, // farther from every robot than this, creatures stand still
  creatureDespawnRadius: 96,
  aggroRadius: 10,
  fleeRadius: 4,
  aloneRadius: 8,
  huntTicks: 300,
  duckFollowTicks: 60,
  duckFollowRadius: 30,
  goblinFleeTicks: 30,
  roombaLootAgeTicks: 120,
  roombaSniffRadius: 20,
  wanderChance: 0.3,
```

- [ ] **Step 5b: shared/types.ts**

- Add `import type { CreatureKind } from './creatures.ts';` at the top.
- Add `| { type: 'attack'; target: string; progress: number }` to `Task`.
- Append to `Agent`:
```ts
  lastHurtAt: number; // tick
  recentKills: Record<string, number>; // victim agent id -> tick, for anti-farm
  healed: string[]; // agents healed while under 50%, for Field Medic
```
- Append `fighting: boolean;` to `AgentView`.
- Add, after `AgentView`:
```ts
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

export interface CreatureView {
  id: string;
  kind: CreatureKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  mode: Creature['mode'];
}
```
- Add `creatures: CreatureView[];` to `TickDelta`.

- [ ] **Step 6: Defaults and eating**

`engine/agent.ts`:
- Add to DEFAULTS: `lastHurtAt: -1_000_000, recentKills: {}, healed: [],`.
- Change normalizeAgent's spread to `{ ...DEFAULTS, inventory: {}, stats: {}, inbox: [], achievements: {}, explored: [], recentKills: {}, healed: [], ...a }`.

`engine/body.ts`: replace `eat` and `eatBest`:
```ts
/** Returns true when raw food upset the stomach. */
export function eat(a: Agent, item: string, rng: () => number = Math.random): boolean {
  const f = FOOD[item];
  takeItem(a.inventory, item);
  a.food = clamp(a.food + f.food);
  a.water = clamp(a.water + f.water);
  a.energy = clamp(a.energy + (f.energy ?? 0));
  const ache = Boolean(f.tummy) && rng() < B.tummyAcheChance;
  if (ache) a.energy = clamp(a.energy - B.tummyAcheEnergy);
  return ache;
}

/** Eats the lowest-value real food carried; returns what was eaten. */
export function eatBest(a: Agent, rng: () => number = Math.random): string | null {
  const item = FOOD_ITEMS.filter((f) => FOOD[f].food > 0 && (a.inventory[f] ?? 0) > 0).sort((p, q) => FOOD[p].food - FOOD[q].food)[0];
  if (!item) return null;
  eat(a, item, rng);
  return item;
}
```

`engine/world.ts` `eatItem`: replace `eat(a, item);` and the return with:
```ts
    const ache = eat(a, item, this.rng);
    if (ache) this.note(a, 'Raw food. Tummy ache! −20 energy.');
    this.bump(a, `eat:${item}`);
    this.touch(a);
    return { ate: item, food: Math.round(a.food), water: Math.round(a.water), energy: Math.round(a.energy), tummy_ache: ache };
```
(Delete the old `this.bump`/`this.touch` lines that this replaces.) Also add `creatures: []` to the object `step()` returns, so the new `TickDelta` field type-checks until Task 2 fills it. Add `fighting: false,` to `views()`; Task 3 replaces it.

- [ ] **Step 7: Run tests and typecheck**

Run: `bun run test && bunx tsc --noEmit`
Expected: all pass, typecheck clean. `tasks.ts` `runTask` may report a missing `attack` case. If so, add `case 'attack': return 'idle'; // Task 3 wires fighting` for now and ledger it.

- [ ] **Step 8: Commit**

```bash
git add shared engine
git commit -m "feat(shared): creature table, meat and batteries, weapons and recipes, combat fields" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Creatures: population, AI, bites, dawn

**Files:**
- Create: `engine/creatures.ts`
- Modify: `engine/world.ts`, `engine/lines.ts`, `engine/lines.test.ts`
- Test: `engine/creatures.test.ts`

**Interfaces:**
- Consumes: Task 1 types and table.
- Produces:
  - `spawnCreature(w, kind, at: Vec, pack?) => Creature`
  - `stepCreatures(w)`
  - `World` fields: `creatures: Map<string, Creature>`, `nextMobId`, `creaturesDirty`
  - `World` methods:
    - `hurt(a, damage, cause, by) => boolean` (true on the killing blow)
    - `alarm(a, reason)`
    - `creatureViews()`
    - `kill(a, cause, by?)`
  - `say(kind, name, rng, by?)`

- [ ] **Step 1: Failing tests** in `engine/creatures.test.ts`

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { dist } from '../shared/geo.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { spawnCreature } from './creatures.ts';
import { World } from './world.ts';

// 256 map: the Plaza is at (128, 128), so (20, 20) is 108 tiles away. rng 0.5 keeps spawns off-map and wanderers still.
function world(rng = () => 0.5): World {
  return new World(new Uint8Array(256 * 256).fill(T.MEADOW), 256, rng);
}
function joined(w: World, name: string, at: Vec) {
  const a = w.register(name, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = at;
  return a;
}

test('rabbits run from robots; distant creatures stand still; very distant ones vanish', () => {
  const w = world();
  joined(w, 'Walker', [20, 20]);
  const rabbit = spawnCreature(w, 'rabbit', [22, 20]);
  const idle = spawnCreature(w, 'deer', [80, 20]);
  const gone = spawnCreature(w, 'boar', [200, 20]);
  const d = w.step(0);
  assert.deepEqual([rabbit.x, rabbit.y, rabbit.mode], [23, 20, 'flee']);
  assert.deepEqual([idle.x, idle.y], [80, 20]);
  assert.equal(w.creatures.has(gone.id), false);
  assert.ok(d.creatures.some((c) => c.id === rabbit.id && c.kind === 'rabbit' && c.maxHp === 5));
});

test('a wolf pack hunts a lone robot and bites every 2 ticks', () => {
  const w = world();
  const a = joined(w, 'Loner', [30, 30]);
  const pack = [spawnCreature(w, 'wolf', [35, 30], 7), spawnCreature(w, 'wolf', [35, 31], 7), spawnCreature(w, 'wolf', [35, 29], 7)];
  for (let i = 0; i < 8; i++) w.step(0);
  assert.ok(pack.every((wf) => wf.mode === 'chase' && wf.target === a.id));
  assert.ok(a.health < 100 && !a.dead, String(a.health));
  assert.ok(w.observe(a.id).inbox.some((l) => l.includes('wolf pack is hunting you')));
});

test('wolves leave robots who have company', () => {
  const w = world();
  joined(w, 'Ann', [30, 30]);
  joined(w, 'Bob', [33, 30]);
  const wolf = spawnCreature(w, 'wolf', [36, 30]);
  for (let i = 0; i < 5; i++) w.step(0);
  assert.equal(wolf.mode, 'wander');
});

test('a goblin steals one item, hits for 4 and runs', () => {
  const w = world();
  const a = joined(w, 'Pocket', [20, 20]);
  a.inventory = { berries: 3 };
  const g = spawnCreature(w, 'goblin', [21, 20]);
  const d = w.step(0);
  assert.deepEqual([a.inventory.berries, g.bag.berries, g.mode, a.health], [2, 1, 'flee', 96]);
  assert.ok(d.events.some((e) => e.type === 'steal' && e.text.includes('Pocket')));
});

test('a Roomba vacuums loot piles older than 2 minutes', () => {
  const w = world();
  joined(w, 'Messy', [20, 20]);
  w.dropLoot(w.index(40, 20), { wood: 3 });
  const r = spawnCreature(w, 'roomba', [45, 20]);
  w.tick = 200;
  for (let i = 0; i < 7; i++) w.step(0);
  assert.equal(w.loot.has(w.index(40, 20)), false);
  assert.deepEqual(r.bag, { wood: 3 });
});

test('monsters come at night, never near the Plaza, and run home at dawn; the Roomba stays', () => {
  const w = world(() => 0); // spawn chance always passes; spots land 16 tiles east
  joined(w, 'Night Owl', [20, 20]);
  w.tick = 900; // night
  w.step(0);
  const monsters = () => [...w.creatures.values()].filter((c) => c.kind === 'goblin' || c.kind === 'wolf');
  assert.ok(monsters().length > 0);
  assert.ok(monsters().every((c) => dist([c.x, c.y], w.plaza) > 40));
  const near = world(() => 0);
  joined(near, 'Plaza Fan', [140, 128]); // spawn spots fall within 40 of the Plaza
  near.tick = 900;
  near.step(0);
  assert.equal([...near.creatures.values()].filter((c) => c.kind === 'goblin' || c.kind === 'wolf').length, 0);
  w.tick = 1199;
  const dawn = w.step(0);
  assert.equal(monsters().length, 0);
  assert.ok([...w.creatures.values()].some((c) => c.kind === 'roomba'));
  assert.ok(dawn.events.some((e) => e.type === 'monsters'));
});

test('death by monster names the killer and is never "starved at the buffet"', () => {
  const w = world();
  const a = joined(w, 'Snack', [20, 20]);
  w.nodes.set(w.index(21, 20), { kind: 'berry_bush', left: 5, regrowAt: 0 });
  assert.equal(w.hurt(a, 500, 'wolf', 'A wolf'), true);
  const e = w.step(0).events.find((x) => x.type === 'death')!;
  assert.ok(a.dead && !e.text.includes('berries three tiles') && !a.stats['death:starved_at_buffet']);
  assert.match(e.text, /Snack/);
});
```

In `engine/lines.test.ts`, change the name exception to `['dawn', 'dusk', 'monsters']`, and add the new death kinds to `causes`:
```ts
    'death:agent': /defeat|fight|sent/i, 'death:wolf': /wol/i, 'death:goblin': /goblin/i, 'death:boar': /boar/i, 'death:golem': /golem/i,
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./engine/creatures.test.ts ./engine/lines.test.ts`
Expected: FAIL. `./creatures.ts` is missing and the death pools are missing.

- [ ] **Step 3: engine/lines.ts**

Add these pools to `LINES`:
```ts
  'death:agent': [
    '{name} was defeated by {by}. Press F to pay respects.',
    '{by} sent {name} back to the respawn screen. F.',
    '{name} lost a fight to {by}. The grass saw everything. F.',
  ],
  'death:wolf': [
    '{name} was eaten by wolves. They were very polite about it. F.',
    '{name} went for a walk alone at night. The wolves appreciated it. F.',
    '{name} became a wolf snack. Press F.',
  ],
  'death:goblin': [
    '{name} was mugged to death by a Grass Goblin. Embarrassing. F.',
    'A Grass Goblin took {name}\'s stuff AND their life. F.',
    '{name} lost a fight to a goblin the size of a shoe. F.',
  ],
  'death:boar': [
    '{name} picked a fight with a boar and lost. F.',
    '{name} was flattened by an angry boar. F.',
    'The boar won. {name} did not. Press F.',
  ],
  'death:golem': [
    '{name} was squashed by a Moss Golem. Very mossy. F.',
    'A Moss Golem sat on {name}. F.',
    '{name} tried to hug a Moss Golem. F.',
  ],
  monsters: [
    'The monsters run home at dawn. Nobody knows where home is.',
    'Sunrise. The goblins pack up and leave, pockets full.',
    'Dawn. The wolves pretend they were never here.',
  ],
```
Replace `say`:
```ts
export function say(kind: string, name: string, rng: () => number, by = ''): string {
  const pool = LINES[kind];
  if (!pool) return `${name} died of ${kind.replace('death:', '')}. Press F to pay respects.`;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].replaceAll('{name}', name).replaceAll('{by}', by);
}
```

- [ ] **Step 4: engine/creatures.ts**

```ts
import { B } from '../shared/balance.ts';
import { CREATURES, type CreatureKind } from '../shared/creatures.ts';
import { dist } from '../shared/geo.ts';
import { takeItem } from '../shared/items.ts';
import { timeOf } from '../shared/time.ts';
import { TERRAIN as T, type Agent, type Creature, type Vec } from '../shared/types.ts';
import { say } from './lines.ts';
import { walkable } from './terrain.ts';
import type { LootPile, World } from './world.ts';

const STEPS: Vec[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const hasBag = (c: Creature) => Object.keys(c.bag).length > 0;

export function spawnCreature(w: World, kind: CreatureKind, [x, y]: Vec, pack = 0): Creature {
  const c: Creature = { id: `mob_${w.nextMobId++}`, kind, x, y, hp: CREATURES[kind].hp, mode: 'wander', target: null, until: 0, bag: {}, pack, hitAt: -B.attackTicks };
  w.creatures.set(c.id, c);
  w.creaturesDirty = true;
  return c;
}

/** Nothing stands on deep water or Plaza tiles; monsters also keep 40 tiles from the Plaza. */
function canStand(w: World, kind: CreatureKind, x: number, y: number): boolean {
  const t = w.at(x, y);
  if (!walkable(t) || t === T.PLAZA) return false;
  return !CREATURES[kind].monster || dist([x, y], w.plaza) > B.plazaSafeRadius;
}

function spawnSpot(w: World, kind: CreatureKind, [nx, ny]: Vec): Vec | null {
  for (let i = 0; i < 12; i++) {
    const angle = w.rng() * Math.PI * 2, r = B.spawnMinDist + w.rng() * (B.spawnMaxDist - B.spawnMinDist);
    const x = Math.round(nx + Math.cos(angle) * r), y = Math.round(ny + Math.sin(angle) * r);
    if (x >= 0 && y >= 0 && x < w.size && y < w.size && w.at(x, y) !== T.SHALLOW && canStand(w, kind, x, y)) return [x, y];
  }
  return null;
}

function nearest(robots: Agent[], x: number, y: number): { a: Agent; d: number } | null {
  let best: { a: Agent; d: number } | null = null;
  for (const a of robots) {
    const d = dist([a.x, a.y], [x, y]);
    if (!best || d < best.d) best = { a, d };
  }
  return best;
}

function move(w: World, c: Creature, score: (x: number, y: number) => number): void {
  let best: Vec | null = null, bs = score(c.x, c.y);
  for (const [dx, dy] of STEPS) {
    const x = c.x + dx, y = c.y + dy;
    if (!canStand(w, c.kind, x, y)) continue;
    const s = score(x, y);
    if (s < bs) [bs, best] = [s, [x, y]];
  }
  if (best) {
    [c.x, c.y] = best;
    w.creaturesDirty = true;
  }
}
const toward = (w: World, c: Creature, [tx, ty]: Vec) => move(w, c, (x, y) => dist([x, y], [tx, ty]) + (Math.abs(x - tx) + Math.abs(y - ty)) * 0.01);
const away = (w: World, c: Creature, [tx, ty]: Vec) => move(w, c, (x, y) => -dist([x, y], [tx, ty]));

function wander(w: World, c: Creature): void {
  if (w.rng() >= B.wanderChance) return;
  const [dx, dy] = STEPS[Math.floor(w.rng() * STEPS.length)];
  if (canStand(w, c.kind, c.x + dx, c.y + dy)) {
    c.x += dx;
    c.y += dy;
    w.creaturesDirty = true;
  }
}

function setMode(c: Creature, mode: Creature['mode'], a: Agent | null, until: number): void {
  c.mode = mode;
  c.target = a?.id ?? null;
  c.until = until;
}

function prey(w: World, c: Creature, robots: Agent[]): Agent | null {
  let best: Agent | null = null, bd = Infinity;
  for (const a of robots) {
    const d = dist([a.x, a.y], [c.x, c.y]);
    if (d > B.aggroRadius || d >= bd) continue;
    if (c.kind === 'wolf' && robots.some((o) => o !== a && dist([o.x, o.y], [a.x, a.y]) <= B.aloneRadius)) continue;
    if (c.kind === 'goblin' && !Object.keys(a.inventory).length) continue;
    best = a;
    bd = d;
  }
  return best;
}

function hunt(w: World, c: Creature, a: Agent): void {
  const pack = c.pack ? [...w.creatures.values()].filter((o) => o.pack === c.pack) : [c];
  for (const m of pack) setMode(m, 'chase', a, w.tick + B.huntTicks);
  const def = CREATURES[c.kind];
  w.alarm(a, `${def.emoji} A ${c.pack ? `${def.name} pack` : def.name} is hunting you!`);
}

function bite(w: World, c: Creature, a: Agent): void {
  const def = CREATURES[c.kind];
  c.hitAt = w.tick;
  if (c.kind === 'goblin') {
    const items = Object.keys(a.inventory);
    if (items.length) {
      const item = items[Math.floor(w.rng() * items.length)];
      takeItem(a.inventory, item);
      c.bag[item] = (c.bag[item] ?? 0) + 1;
      w.emit('steal', `👺 A Grass Goblin stole ${a.name}'s ${item}!`, a);
    }
    setMode(c, 'flee', a, w.tick + B.goblinFleeTicks);
  }
  w.hurt(a, def.damage, c.kind, `A ${def.name}`);
}

const oldPile = (w: World, p: LootPile) => p.expiresAt - w.tick <= B.lootTicks - B.roombaLootAgeTicks;

function roombaStep(w: World, c: Creature): void {
  const here = w.index(c.x, c.y), pile = w.loot.get(here);
  if (pile && oldPile(w, pile)) {
    for (const [item, n] of Object.entries(pile.items)) c.bag[item] = (c.bag[item] ?? 0) + n;
    w.loot.delete(here);
    w.lootDirty = true;
    w.emit('vacuum', `🤖 A Lost Roomba vacuumed up a loot pile at (${c.x}, ${c.y}). Beep boop.`);
    return;
  }
  let best: Vec | null = null, bd = Infinity;
  for (const [i, p] of w.loot) {
    const at = w.xy(i), d = dist(at, [c.x, c.y]);
    if (oldPile(w, p) && d <= B.roombaSniffRadius && d < bd) [best, bd] = [at, d];
  }
  if (best) toward(w, c, best);
  else wander(w, c);
}

function act(w: World, c: Creature, robots: Agent[]): void {
  const def = CREATURES[c.kind];
  if (def.slow && w.tick % 2) return;
  const current = c.target ? w.agents.get(c.target) : undefined;
  if (c.mode !== 'wander' && (!current || !current.joined || current.dead || w.tick >= c.until)) setMode(c, 'wander', null, 0);
  if (c.kind === 'roomba') return roombaStep(w, c);
  if (c.mode === 'wander') {
    const near = nearest(robots, c.x, c.y);
    if ((def.flees || hasBag(c)) && near && near.d <= B.fleeRadius) setMode(c, 'flee', near.a, w.tick + 5);
    else if (def.hostile && !hasBag(c)) {
      const p = prey(w, c, robots);
      if (p) hunt(w, c, p);
    } else if (c.kind === 'duck') {
      const around = robots.filter((a) => dist([a.x, a.y], [c.x, c.y]) <= B.duckFollowRadius);
      if (around.length) setMode(c, 'follow', around[Math.floor(w.rng() * around.length)], w.tick + B.duckFollowTicks);
    }
  }
  const t = c.target ? w.agents.get(c.target) : undefined;
  if (c.mode === 'chase' && t) {
    if (dist([t.x, t.y], [c.x, c.y]) > B.attackReach) toward(w, c, [t.x, t.y]);
    else if (w.tick - c.hitAt >= B.attackTicks) bite(w, c, t);
  } else if (c.mode === 'flee' && t) away(w, c, [t.x, t.y]);
  else if (c.mode === 'follow' && t) {
    if (dist([t.x, t.y], [c.x, c.y]) > 2) toward(w, c, [t.x, t.y]);
  } else wander(w, c);
}

function populate(w: World, robots: Agent[], night: boolean): void {
  if (!robots.length) return;
  const count = (keep: (c: Creature) => boolean) => [...w.creatures.values()].filter(keep).length;
  const near = (): Vec => {
    const r = robots[Math.floor(w.rng() * robots.length)];
    return [r.x, r.y];
  };
  const add = (kind: CreatureKind) => {
    const at = spawnSpot(w, kind, near());
    if (at) spawnCreature(w, kind, at);
  };
  if (count((c) => c.kind === 'rabbit' || c.kind === 'deer' || c.kind === 'boar') < Math.min(B.maxAnimals, B.animalsPerAgent * robots.length)) {
    const r = w.rng();
    add(r < 0.5 ? 'rabbit' : r < 0.8 ? 'deer' : 'boar');
  }
  if (count((c) => c.kind === 'duck') < Math.min(B.maxDucks, robots.length * 2)) add('duck');
  if (count((c) => c.kind === 'roomba') < B.maxRoombas) add('roomba');
  if (!night) return;
  const online = robots.filter((a) => a.online);
  for (const a of online) {
    if (count((c) => CREATURES[c.kind].monster) >= B.monstersPerAgent * online.length || w.rng() >= B.monsterSpawnChance) continue;
    const at = spawnSpot(w, 'wolf', [a.x, a.y]);
    if (!at) continue;
    if (w.rng() < 0.6) spawnCreature(w, 'goblin', at);
    else {
      const pack = w.nextMobId;
      for (let i = 0; i < B.wolfPack; i++) spawnCreature(w, 'wolf', at, pack);
    }
  }
}

function golemNight(w: World, robots: Agent[]): void {
  if (!robots.length || w.rng() >= B.golemNightChance) return;
  const a = robots[Math.floor(w.rng() * robots.length)], spots: Vec[] = [];
  for (let y = a.y - 40; y <= a.y + 40; y++) {
    for (let x = a.x - 40; x <= a.x + 40; x++) {
      if (w.at(x, y) === T.RUINS && dist([x, y], [a.x, a.y]) >= B.spawnMinDist && canStand(w, 'golem', x, y)) spots.push([x, y]);
    }
  }
  if (!spots.length) return;
  spawnCreature(w, 'golem', spots[Math.floor(w.rng() * spots.length)]);
  w.emit('golem', '🗿 The ground rumbles. A Moss Golem wakes up in the ruins.');
}

function dawn(w: World): void {
  let gone = 0;
  for (const c of w.creatures.values()) {
    if (!CREATURES[c.kind].monster) continue;
    w.creatures.delete(c.id);
    gone++;
  }
  if (!gone) return;
  w.creaturesDirty = true;
  w.emit('monsters', say('monsters', '', w.rng));
}

/** One tick of every creature, after the robots have moved. */
export function stepCreatures(w: World): void {
  const robots = [...w.agents.values()].filter((a) => a.joined && !a.dead);
  const { phase, dayTick } = timeOf(w.tick);
  if (dayTick === 0) dawn(w);
  if (dayTick === B.dayTicks - B.nightTicks) golemNight(w, robots.filter((a) => a.online));
  populate(w, robots, phase === 'night');
  for (const c of [...w.creatures.values()]) {
    if (!w.creatures.has(c.id)) continue;
    const d = nearest(robots, c.x, c.y)?.d ?? Infinity;
    if (d > B.creatureDespawnRadius) {
      w.creatures.delete(c.id);
      w.creaturesDirty = true;
    } else if (d <= B.creatureActiveRadius) act(w, c, robots);
  }
}
```

- [ ] **Step 5: World wiring** (`engine/world.ts`)

- Imports: `import { CREATURES } from '../shared/creatures.ts';` and `import { stepCreatures } from './creatures.ts';`. Add `type Creature, type CreatureView` to the types import.
- Fields: `creatures = new Map<string, Creature>(); nextMobId = 1; creaturesDirty = false;`
- In `step()`, call `stepCreatures(this);` right before `this.regrow();`. Replace `creatures: []` in the return with `creatures: this.creatureViews()`.
- Methods:
```ts
  creatureViews(): CreatureView[] {
    return [...this.creatures.values()].map((c) => ({ id: c.id, kind: c.kind, x: c.x, y: c.y, hp: Math.max(0, Math.round(c.hp)), maxHp: CREATURES[c.kind].hp, mode: c.mode }));
  }

  /** Damage from a creature or robot; true when it was the killing blow. */
  hurt(a: Agent, damage: number, cause: string, by: string): boolean {
    if (a.dead) return false;
    const fresh = this.tick - a.lastHurtAt > B.combatTicks;
    a.lastHurtAt = this.tick;
    a.health = Math.max(0, a.health - damage);
    this.dirty.add(a.id);
    if (a.health <= 0) {
      this.kill(a, cause, by);
      return true;
    }
    if (fresh) this.alarm(a, `${by} is attacking you!`);
    return false;
  }

  /** Danger stops calm tasks; walking away or fighting back keeps going. */
  alarm(a: Agent, reason: string): void {
    if (a.task?.type === 'move_to' || a.task?.type === 'attack') this.note(a, reason);
    else this.interrupt(a, reason);
  }
```
- In `kill`, change the signature to `kill(a: Agent, cause: string, by = ''): void`. Change the buffet line to `const buffet = (cause === 'starvation' || cause === 'hunger and thirst') && this.berriesNear(a.x, a.y, 3);`. Pass `by` to the announcement: `say(\`death:${cause}\`, a.name, this.rng, by)`. Change the death note to `\`You died${by ? ` (${by})` : ` of ${cause}`}. You respawn in ${B.respawnTicks}s. Half your bag stayed behind.\``.

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run test && bunx tsc --noEmit`
Expected: all pass. If an older test compares exact tick events, it may now see creature events (spawns are silent, but steals and vacuums are not). Filter those assertions by type and ledger it.

- [ ] **Step 7: Commit**

```bash
git add engine
git commit -m "feat(engine): animals, night monsters, wolf packs, goblin thieves, Roombas and a Moss Golem" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Combat, heal, craft, achievements, observe

**Files:**
- Create: `engine/combat.ts`, `engine/craft.ts`
- Modify: `engine/tasks.ts`, `engine/world.ts`, `engine/achievements.ts`, `engine/observe.ts`
- Test: `engine/combat.test.ts`

**Interfaces:**
- Consumes:
  - From Task 2: `spawnCreature`, `World.hurt`, `World.alarm`, `World.creatures`
  - From Task 1: `WEAPONS`, `RECIPES`, `CREATURES`
- Produces:
  - `weaponOf(a) => {name, damage}`
  - `startAttack(w, id, target) => {target, weapon}`
  - `fightStep(w, a, task) => Activity`
  - `heal(w, id, agentId) => {healed, health}`
  - `craft(w, id, item) => {crafted, inventory}`
  - `World.inCombat(a)`; `cooldownFor` returns 2000 ms in combat
  - Observe: `you.weapon`, `you.in_combat`; creatures in the grid and in `nearby`

- [ ] **Step 1: Failing tests** in `engine/combat.test.ts`

```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T, type Role, type Vec } from '../shared/types.ts';
import { TIER_POINTS } from './achievements.ts';
import { heal, startAttack, weaponOf } from './combat.ts';
import { craft } from './craft.ts';
import { spawnCreature } from './creatures.ts';
import { GameFail, World } from './world.ts';

function world(tiles = new Uint8Array(64 * 64).fill(T.MEADOW)): World {
  return new World(tiles, 64, () => 0.5);
}
function joined(w: World, name: string, at: Vec, role: Role = 'gatherer') {
  const a = w.register(name, 0);
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

test('a hit every 2 ticks; hunters hit 1.5x; a kill scores 5, drops half the bag and names the killer', () => {
  const w = world();
  const a = joined(w, 'Bruiser', [10, 10], 'hunter');
  const b = joined(w, 'Victim', [11, 10]);
  Object.assign(b, { food: 50, water: 50, inventory: { wood: 4 } });
  startAttack(w, a.id, b.id);
  w.step(0);
  assert.equal(b.health, 100);
  w.step(0);
  assert.equal(b.health, 92.5);
  b.health = 5;
  w.step(0);
  const d = w.step(0);
  assert.ok(b.dead);
  assert.equal(a.seasonScore, 5 + 2 * TIER_POINTS.common); // kill + First Blood (server first)
  assert.deepEqual(w.loot.get(w.index(11, 10))?.items, { wood: 2 });
  assert.match(d.events.find((e) => e.type === 'death')?.text ?? '', /Bruiser/);
  assert.equal(a.task, null);
});

test('killing the same robot again within 10 minutes scores nothing', () => {
  const w = world();
  const a = joined(w, 'Farmer', [10, 10]);
  const b = joined(w, 'Friend', [11, 10]);
  Object.assign(b, { health: 5, food: 50, water: 50 });
  a.recentKills[b.id] = 0;
  startAttack(w, a.id, b.id);
  w.step(0);
  w.step(0);
  assert.ok(b.dead);
  assert.equal(a.seasonScore, 2 * TIER_POINTS.common);
  assert.ok(w.observe(a.id).inbox.includes('No score: you already beat Friend recently.'));
});

test('no fighting robots in the Plaza, from either side', () => {
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) tiles[y * 64 + x] = T.PLAZA;
  const w = world(tiles);
  const inside = joined(w, 'Inside', [20, 20]);
  const edge = joined(w, 'Edge', [24, 20]);
  const out = joined(w, 'Outside', [25, 20]);
  assert.equal(failCode(() => startAttack(w, inside.id, edge.id)), 'plaza_peace');
  assert.equal(failCode(() => startAttack(w, out.id, edge.id)), 'plaza_peace');
});

test('the attack ends cleanly when the target walks out of sight or dies', () => {
  const w = world();
  const a = joined(w, 'Chaser', [10, 10]);
  const b = joined(w, 'Runner', [11, 10]);
  startAttack(w, a.id, b.id);
  b.x = 60;
  w.step(0);
  assert.equal(a.task, null);
  assert.ok(w.observe(a.id).inbox.includes('Task done: your target is gone.'));
  const wolf = spawnCreature(w, 'wolf', [12, 10]);
  a.x = 11;
  startAttack(w, a.id, 'wolf');
  w.creatures.delete(wolf.id);
  w.step(0);
  assert.equal(a.task, null);
});

test('punching a rock: the rock is unimpressed and you are a clown', () => {
  const w = world();
  const a = joined(w, 'Rocky', [10, 10]);
  w.nodes.set(w.index(11, 10), { kind: 'rock', left: 3, regrowAt: 0 });
  startAttack(w, a.id, 'rock');
  for (let i = 0; i < 3; i++) w.step(0);
  assert.equal(a.stats['attack:rock'], 1);
  assert.ok(a.achievements.rock_fighter !== undefined);
  assert.equal(a.badge?.emoji, '🤡');
});

test('boars fight back; rabbits flee but can be caught; kills fill the bag and score', () => {
  const w = world();
  const a = joined(w, 'Hunter', [10, 10]);
  const boar = spawnCreature(w, 'boar', [11, 10]);
  startAttack(w, a.id, boar.id);
  w.step(0);
  w.step(0);
  assert.deepEqual([boar.hp, boar.mode, a.health], [20, 'chase', 92]);

  const w2 = world();
  const h = joined(w2, 'Chef', [10, 10]);
  const rabbit = spawnCreature(w2, 'rabbit', [11, 10]);
  startAttack(w2, h.id, 'rabbit');
  for (let i = 0; i < 3; i++) w2.step(0);
  assert.equal(w2.creatures.has(rabbit.id), false);
  assert.equal(h.inventory.meat, 1);
  assert.equal(h.seasonScore, 1);
});

test('killing a goblin or a Roomba returns what they took', () => {
  const w = world();
  const a = joined(w, 'Cop', [10, 10]);
  const g = spawnCreature(w, 'goblin', [11, 10]);
  Object.assign(g, { hp: 3, bag: { berries: 2 } });
  startAttack(w, a.id, g.id);
  let events: string[] = [];
  for (let i = 0; i < 3; i++) events = events.concat(w.step(0).events.map((e) => e.text));
  assert.deepEqual([a.inventory.berries, a.inventory.fiber], [2, 1]);
  assert.ok(events.some((t) => t.includes('Cop') && t.includes('Grass Goblin')));
  const r = spawnCreature(w, 'roomba', [a.x + 1, a.y]);
  Object.assign(r, { hp: 1, bag: { wood: 3 } });
  startAttack(w, a.id, r.id);
  for (let i = 0; i < 3; i++) w.step(0);
  assert.deepEqual([a.inventory.wood, a.inventory.battery], [3, 1]);
});

test('medics heal others nearby; Field Medic counts different robots under half health', () => {
  const w = world();
  const m = joined(w, 'Doc', [10, 10], 'medic');
  const p = joined(w, 'Patient', [11, 10]);
  const far = joined(w, 'Far', [20, 10]);
  const g = joined(w, 'Nurse', [9, 10]);
  p.health = 40;
  assert.deepEqual(heal(w, m.id, p.id), { healed: 'Patient', health: 60 });
  heal(w, m.id, p.id);
  assert.deepEqual([p.health, m.healed], [80, [p.id]]);
  assert.equal(failCode(() => heal(w, g.id, p.id)), 'not_medic');
  assert.equal(failCode(() => heal(w, m.id, m.id)), 'self_heal');
  assert.equal(failCode(() => heal(w, m.id, far.id)), 'too_far');
});

test('craft a club from 5 wood and fight with it', () => {
  const w = world();
  const a = joined(w, 'Smith', [10, 10]);
  assert.equal(failCode(() => craft(w, a.id, 'club')), 'missing_materials');
  a.inventory = { wood: 7 };
  craft(w, a.id, 'club');
  assert.deepEqual(a.inventory, { wood: 2, club: 1 });
  assert.deepEqual(weaponOf(a), { name: 'club', damage: 10 });
  assert.equal(failCode(() => craft(w, a.id, 'laser')), 'unknown_recipe');
});

test('combat means 2 s cooldowns; observe shows creatures and your weapon', () => {
  const w = world();
  const a = joined(w, 'Tense', [10, 10]);
  assert.equal(w.cooldownFor(a.id), 5000);
  spawnCreature(w, 'wolf', [12, 10]);
  assert.equal(w.cooldownFor(a.id), 2000);
  const o = w.observe(a.id);
  assert.ok(o.nearby.some((l) => l.startsWith('mob_') && l.includes('🐺 wolf (hp 30/30')));
  assert.ok(o.grid.some((row) => row.includes('&')));
  assert.equal(o.you.weapon, 'fists (5 damage)');
  assert.equal(o.you.in_combat, true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./engine/combat.test.ts`
Expected: FAIL, cannot find module `./combat.ts`.

- [ ] **Step 3: engine/combat.ts**

```ts
import { B } from '../shared/balance.ts';
import { CREATURES, isCreatureKind } from '../shared/creatures.ts';
import { dist } from '../shared/geo.ts';
import { WEAPONS, addItem, type Inventory } from '../shared/items.ts';
import { TERRAIN as T, type Agent, type Creature, type Task, type Vec } from '../shared/types.ts';
import type { Activity } from './body.ts';
import { findPath } from './path.ts';
import { addScore } from './score.ts';
import { findTarget, walk } from './tasks.ts';
import { GameFail, type World } from './world.ts';

type AttackTask = Extract<Task, { type: 'attack' }>;

export function weaponOf(a: Agent): { name: string; damage: number } {
  let best = { name: 'fists', damage: B.fistDamage };
  for (const [name, damage] of Object.entries(WEAPONS)) if ((a.inventory[name] ?? 0) > 0 && damage > best.damage) best = { name, damage };
  return best;
}
const damageOf = (a: Agent): number => weaponOf(a).damage * (a.role === 'hunter' ? B.hunterMultiplier : 1);

/** Where the target is now, or null when it is gone, dead or out of sight. */
function locate(w: World, a: Agent, target: string): Vec | null {
  let at: Vec | null = null;
  if (target.startsWith('rock:')) {
    const i = Number(target.slice(5));
    at = w.nodes.get(i)?.kind === 'rock' ? w.xy(i) : null;
  } else if (target.startsWith('mob_')) {
    const c = w.creatures.get(target);
    at = c ? [c.x, c.y] : null;
  } else {
    const o = w.agents.get(target);
    at = o && o.joined && !o.dead ? [o.x, o.y] : null;
  }
  return at && dist(at, [a.x, a.y]) <= w.vision(a) ? at : null;
}

function resolve(w: World, a: Agent, raw: string): string | null {
  if (raw === 'rock') {
    const f = findTarget(w, a, 'rock');
    return f ? `rock:${f.index}` : null;
  }
  if (isCreatureKind(raw)) {
    let best: Creature | null = null, bd = Infinity;
    for (const c of w.creatures.values()) {
      const d = dist([c.x, c.y], [a.x, a.y]);
      if (c.kind === raw && d <= w.vision(a) && d < bd) [best, bd] = [c, d];
    }
    return best?.id ?? null;
  }
  return /^(agent|mob)_\d+$/.test(raw) && locate(w, a, raw) ? raw : null;
}

export function startAttack(w: World, id: string, raw: string) {
  const a = w.alive(id);
  if (raw === a.id) throw new GameFail('self_harm', 'You punch yourself. It is not very effective.', 'Pick someone else.');
  if (a.energy <= 0) throw new GameFail('too_tired', 'Your robot is too tired to swing.', 'rest or sleep first.');
  const target = resolve(w, a, raw.trim());
  if (!target) {
    throw new GameFail('no_target', `No "${raw}" in sight to attack.`, 'Use an id from observe (agent_12, mob_5) or a type: rabbit, deer, boar, duck, goblin, wolf, roomba, golem, rock.');
  }
  const at = locate(w, a, target)!;
  if (target.startsWith('agent_') && (w.at(a.x, a.y) === T.PLAZA || w.at(at[0], at[1]) === T.PLAZA)) {
    throw new GameFail('plaza_peace', 'The Plaza is a no-fighting zone.', 'Take it outside.');
  }
  a.task = { type: 'attack', target, progress: 0 };
  w.touch(a);
  return { target, weapon: `${weaponOf(a).name} (${damageOf(a)} damage)` };
}

export function fightStep(w: World, a: Agent, t: AttackTask): Activity {
  const at = locate(w, a, t.target);
  if (!at) {
    w.finish(a, 'Task done: your target is gone.');
    return 'idle';
  }
  if (a.energy <= 0) {
    w.interrupt(a, 'Too tired to keep fighting.');
    return 'idle';
  }
  if (dist(at, [a.x, a.y]) > B.attackReach) {
    const path = findPath(w.at, [a.x, a.y], at, w.vision(a) + 2);
    if (!path) {
      w.interrupt(a, 'You cannot reach your target.');
      return 'idle';
    }
    walk(w, a, path.slice(0, -1));
    if (dist(at, [a.x, a.y]) > B.attackReach) return 'busy';
  }
  if (++t.progress < B.attackTicks) return 'busy';
  t.progress = 0;
  strike(w, a, t.target);
  return 'busy';
}

function strike(w: World, a: Agent, target: string): void {
  if (target.startsWith('rock:')) {
    w.bump(a, 'attack:rock');
    w.finish(a, 'You punched a rock. The rock is unimpressed.');
    return;
  }
  const c = w.creatures.get(target);
  if (c) return hitCreature(w, a, c);
  const victim = w.agents.get(target)!;
  if (!w.hurt(victim, damageOf(a), 'agent', a.name)) return;
  w.bump(a, 'kill:agent');
  const last = a.recentKills[victim.id];
  a.recentKills[victim.id] = w.tick;
  if (last !== undefined && w.tick - last < B.antiFarmTicks) w.note(a, `No score: you already beat ${victim.name} recently.`);
  else addScore(w, a, B.agentKillScore);
  w.finish(a, `You defeated ${victim.name}.`);
}

const KILL_LINE: Record<string, (who: string, c: Creature) => string> = {
  golem: (who) => `🗿 ${who} toppled a Moss Golem! The ruins are quiet again.`,
  duck: (who) => `🦆 ${who} killed a Confused Duck. Monster.`,
  roomba: (who, c) => `🤖 ${who} unplugged a Lost Roomba. It had ${Object.values(c.bag).reduce((s, n) => s + n, 0)} things inside.`,
};

function hitCreature(w: World, a: Agent, c: Creature): void {
  const def = CREATURES[c.kind];
  c.hp -= damageOf(a);
  w.creaturesDirty = true;
  if (c.hp > 0) {
    if (def.flees) Object.assign(c, { mode: 'flee', target: a.id, until: w.tick + B.goblinFleeTicks });
    else if (def.damage > 0 && c.mode !== 'chase') Object.assign(c, { mode: 'chase', target: a.id, until: w.tick + B.huntTicks });
    return;
  }
  w.creatures.delete(c.id);
  w.bump(a, `kill:${c.kind}`);
  addScore(w, a, def.score);
  const loot: Inventory = { ...def.drops };
  for (const [item, n] of Object.entries(c.bag)) loot[item] = (loot[item] ?? 0) + n;
  const spill: Inventory = {};
  for (const [item, n] of Object.entries(loot)) {
    const got = addItem(a.inventory, item, n);
    if (n > got) spill[item] = n - got;
  }
  if (Object.keys(spill).length) w.dropLoot(w.index(c.x, c.y), spill);
  w.finish(a, `You defeated the ${def.name}. Got ${Object.entries(loot).map(([i, n]) => `${n} ${i}`).join(', ')}.`);
  if (def.monster || KILL_LINE[c.kind]) w.emit('kill', (KILL_LINE[c.kind] ?? ((who: string) => `⚔️ ${who} defeated a ${def.name}.`))(a.name, c), a);
}

export function heal(w: World, id: string, targetId: string) {
  const a = w.alive(id);
  if (a.role !== 'medic') throw new GameFail('not_medic', 'Only medics can heal.', 'Find a medic, or eat, drink and rest.');
  if (targetId === a.id) throw new GameFail('self_heal', 'Medics cannot heal themselves. Occupational hazard.', 'Eat and rest to heal.');
  const o = w.agents.get(targetId);
  if (!o || !o.joined || o.dead) throw new GameFail('no_target', 'There is nobody like that to heal.', 'Use an agent id from observe.');
  if (dist([o.x, o.y], [a.x, a.y]) > B.healRange) throw new GameFail('too_far', `${o.name} is too far away.`, `Stand within ${B.healRange} tiles.`);
  if (o.health < B.fieldMedicBelow && !a.healed.includes(o.id)) a.healed.push(o.id);
  o.health = Math.min(100, o.health + B.healAmount);
  w.bump(a, 'heal');
  w.note(o, `${a.name} healed you (+${B.healAmount} health).`);
  w.dirty.add(o.id);
  w.touch(a);
  return { healed: o.name, health: Math.round(o.health) };
}
```

- [ ] **Step 4: engine/craft.ts**

```ts
import { RECIPES, addItem, takeItem } from '../shared/items.ts';
import { addScore } from './score.ts';
import { GameFail, type World } from './world.ts';

export function craft(w: World, id: string, item: string) {
  const a = w.alive(id);
  const recipe = RECIPES[item];
  if (!recipe) throw new GameFail('unknown_recipe', `Nobody knows how to make "${item}".`, `Craftable now: ${Object.keys(RECIPES).join(', ')}.`);
  const missing = Object.entries(recipe).filter(([m, n]) => (a.inventory[m] ?? 0) < n).map(([m, n]) => `${n - (a.inventory[m] ?? 0)} ${m}`);
  if (missing.length) throw new GameFail('missing_materials', `You need ${missing.join(', ')} more.`, 'Gather them first.');
  for (const [m, n] of Object.entries(recipe)) takeItem(a.inventory, m, n);
  if (!addItem(a.inventory, item, 1)) {
    for (const [m, n] of Object.entries(recipe)) addItem(a.inventory, m, n);
    throw new GameFail('bag_full', 'No room in your bag for it.', 'Eat or drop something first.');
  }
  w.bump(a, `craft:${item}`);
  addScore(w, a, 1);
  w.touch(a);
  return { crafted: item, inventory: a.inventory };
}
```

- [ ] **Step 5: Wire tasks, world, achievements, observe**

`engine/tasks.ts`: import `import { fightStep } from './combat.ts';`, and in `runTask`'s switch add `case 'attack': return fightStep(w, a, task);` (this replaces Task 1's stub, if one was added).

`engine/world.ts`:
- Import `dist` is already there.
- Add `inCombat`:
```ts
  inCombat(a: Agent): boolean {
    if (a.task?.type === 'attack' || this.tick - a.lastHurtAt <= B.combatTicks) return true;
    for (const c of this.creatures.values()) if (CREATURES[c.kind].hostile && dist([c.x, c.y], [a.x, a.y]) <= B.threatRadius) return true;
    return false;
  }
```
- Replace `cooldownFor`:
```ts
  cooldownFor(id: string): number {
    const a = this.agents.get(id);
    if (!a) return B.doCooldownMs;
    if (this.inCombat(a)) return B.combatCooldownMs;
    return a.health < B.lowHealth || a.food < B.lowStat || a.water < B.lowStat ? B.lowStatCooldownMs : B.doCooldownMs;
  }
```
- In `views()`, change `fighting: false` to `fighting: this.inCombat(a)`.

`engine/achievements.ts`: add these rows to `ACHIEVEMENTS`, before `speedrun_any`:
```ts
  { id: 'first_blood', emoji: '🩸', name: 'First Blood', tier: 'common', trigger: 'Defeat another robot', progress: (a) => [stat(a, 'kill:agent'), 1] },
  { id: 'pack_leader', emoji: '🐺', name: 'Pack Leader', tier: 'rare', trigger: 'Defeat 20 wolves', progress: (a) => [stat(a, 'kill:wolf'), 20] },
  { id: 'golem_slayer', emoji: '🗿', name: 'Golem Slayer', tier: 'epic', trigger: 'Land the killing blow on a Moss Golem', progress: (a) => [stat(a, 'kill:golem'), 1] },
  { id: 'field_medic', emoji: '🩹', name: 'Field Medic', tier: 'rare', trigger: 'Heal 10 different robots while they are under 50% health', progress: (a) => [a.healed.length, 10] },
```
and after `starved_at_buffet`:
```ts
  { id: 'rock_fighter', emoji: '🤡', name: 'Rock Fighter', tier: 'cursed', trigger: 'Attack a rock', progress: (a) => [stat(a, 'attack:rock'), 1] },
  { id: 'monster', emoji: '🦆', name: 'Monster', tier: 'cursed', trigger: 'Kill a Confused Duck', progress: (a) => [stat(a, 'kill:duck'), 1] },
```

`engine/observe.ts`:
- Import `CREATURES` from `../shared/creatures.ts` and `weaponOf` from `./combat.ts`.
- Add to `LEGEND`: `'%': 'animal', '&': 'monster', '=': 'Lost Roomba (harmless, eats loot piles)'`.
- After the `others.forEach(...)` block, add creatures to `marks` (agents keep priority):
```ts
  const mobs = [...w.creatures.values()]
    .filter((c) => dist([c.x, c.y], here) <= r)
    .sort((p, q) => dist([p.x, p.y], here) - dist([q.x, q.y], here));
  for (const c of mobs) if (!marks.has(`${c.x},${c.y}`)) marks.set(`${c.x},${c.y}`, CREATURES[c.kind].char);
```
- Change `nearby` to:
```ts
    nearby: [
      ...others.map((o) => `${o.id} ${o.name} (${o.role}${o.model ? `, ${o.model}` : ''})${o.dead ? ' (dead)' : ''} ${dist([o.x, o.y], here)} tiles ${compass(o.x - a.x, o.y - a.y)}`),
      ...mobs.map((c) => {
        const def = CREATURES[c.kind];
        const hunting = c.mode === 'chase' && c.target === a.id ? ', hunting you' : '';
        return `${c.id} ${def.emoji} ${def.name} (hp ${Math.max(0, Math.round(c.hp))}/${def.hp}${hunting}) ${dist([c.x, c.y], here)} tiles ${compass(c.x - a.x, c.y - a.y)}`;
      }),
    ],
```
- In `you`, after `badge`, add:
```ts
      weapon: `${weaponOf(a).name} (${weaponOf(a).damage} damage)`,
      in_combat: w.inCombat(a),
```
- In `describeTask`, add `if (t.type === 'attack') return { type: t.type, target: t.target };`.

- [ ] **Step 6: Run tests and typecheck**

Run: `bun run test && bunx tsc --noEmit`
Expected: all pass (combat: 10 new).

- [ ] **Step 7: Commit**

```bash
git add engine
git commit -m "feat(engine): attack anything, clubs, medic heal, kill scores, combat cooldowns and achievements" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tools, persistence, rules

**Files:**
- Modify: `engine/actions.ts`, `engine/persist.ts`, `engine/rules.ts`, `gateway/mcp.ts`
- Test: `engine/actions.test.ts`, `test/persist.test.ts`, `test/e2e.test.ts`

**Interfaces:**
- Consumes: `startAttack`, `heal`, `craft` (Task 3).
- Produces:
  - Do tools `attack`, `heal`, `craft`
  - Redis string `creatures`; `meta.nextMobId`
  - `rules().combat`, `rules().creatures`

- [ ] **Step 1: Failing tests**

Append to `engine/actions.test.ts`:
```ts
test('attack, heal and craft are wired as action tools', () => {
  const { w, id } = setup();
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'medic' } });
  const a = w.agents.get(id)!;
  a.inventory = { wood: 5 };
  const c = handleAction(w, { agentId: id, tool: 'craft', args: { item: 'club' } });
  assert.deepEqual([c.ok, a.inventory.club], [true, 1]);
  const other = w.register('Other', 0);
  w.join(other.id, 'scout', null, 0);
  [other.x, other.y] = [a.x + 1, a.y];
  const h = handleAction(w, { agentId: id, tool: 'heal', args: { agent: other.id } });
  assert.equal(h.ok, true);
  const at = handleAction(w, { agentId: id, tool: 'attack', args: { target: other.id } });
  assert.deepEqual([at.ok, at.cooldownMs], [true, 2000]);
});
```

Append to `test/persist.test.ts`:
```ts
test('creatures survive a restart and new ids never reuse old ones', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const g = spawnCreature(w, 'goblin', [5, 5]);
  Object.assign(g, { hp: 7, bag: { berries: 2 } });
  await flush(r, w);
  const back = (await loadWorld(r))!;
  assert.deepEqual(back.creatures.get(g.id), g);
  assert.notEqual(spawnCreature(back, 'rabbit', [6, 6]).id, g.id);
  await r.close();
});
```
(import `spawnCreature` from `../engine/creatures.ts`).

In `test/e2e.test.ts`, change the tool list to:
```ts
['achievements', 'attack', 'craft', 'drink', 'eat', 'emote', 'gather', 'heal', 'join_game', 'leaderboard', 'map', 'move_to', 'notes', 'observe', 'read_chat', 'rest', 'rules', 'say', 'say_world', 'settings', 'sleep']
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test ./engine/actions.test.ts; bun run test:int`
Expected: FAIL. `craft` is an unknown tool, `back.creatures` is empty, and the MCP tool list is missing 3 tools.

- [ ] **Step 3: engine/actions.ts**

- Import `startAttack, heal` from `./combat.ts` and `craft` from `./craft.ts`.
- Add `'attack', 'heal', 'craft'` to `DO_TOOLS`.
- Add cases before `settings`:
```ts
    case 'attack':
      return withView({ ...startAttack(world, agentId, String(args.target ?? '')), message: 'Violence has entered the grass.' });
    case 'heal':
      return withView({ ...heal(world, agentId, String(args.agent ?? '')), message: 'Patched up with grass and good intentions.' });
    case 'craft':
      return withView({ ...craft(world, agentId, String(args.item ?? '')), message: 'You bang things together until they become other things.' });
```

- [ ] **Step 4: engine/persist.ts**

- Add `creatures: 'creatures'` to `K`.
- Import `type Creature` from `../shared/types.ts`.
- In `flush`, add `nextMobId: String(w.nextMobId)` to the meta hSet. Before `w.dirty.clear()` add:
```ts
  const creaturesWereDirty = w.creaturesDirty;
  if (creaturesWereDirty) m.set(K.creatures, JSON.stringify([...w.creatures.values()]));
  w.creaturesDirty = false;
```
  and in `catch` add `w.creaturesDirty ||= creaturesWereDirty;`.
- In `loadWorld`, before `return w;`, add:
```ts
  w.nextMobId = Number(meta.nextMobId) || 1;
  const mobs = await r.get(K.creatures);
  if (mobs) for (const c of JSON.parse(mobs) as Creature[]) w.creatures.set(c.id, c);
```

- [ ] **Step 5: engine/rules.ts**

- Import `CREATURES` from `../shared/creatures.ts` and `RECIPES, WEAPONS` from `../shared/items.ts`.
- Add fields to the returned object:
```ts
    combat: [
      `attack(target): an id from observe (agent_12, mob_5) or a type meaning the nearest one (rabbit, deer, boar, duck, goblin, wolf, roomba, golem, rock).`,
      `A hit every ${B.attackTicks}s in reach. Fists ${B.fistDamage}, club ${WEAPONS.club}; hunters x${B.hunterMultiplier}. Your best carried weapon is used.`,
      `No fighting robots in the Plaza. Killing the same robot again within ${B.antiFarmTicks / 60} min scores nothing.`,
      `heal(agent): medics only, +${B.healAmount} health within ${B.healRange} tiles.`,
      `craft: ${Object.entries(RECIPES).map(([item, r]) => `${item} = ${Object.entries(r).map(([m, n]) => `${n} ${m}`).join(' + ')}`).join('; ')}.`,
    ],
    creatures: Object.values(CREATURES).map((d) =>
      `${d.emoji} ${d.name}: ${d.hp} hp, ${d.damage ? `hits for ${d.damage}` : 'harmless'}${d.monster ? ', night only' : ''}${d.hostile ? ', hunts robots' : ''}; drops ${Object.entries(d.drops).map(([i, n]) => `${n} ${i}`).join(', ')}`),
```
- Add `'kills: animal +1, monster +2, robot +5, Moss Golem +20'` to `scoring`.

- [ ] **Step 6: gateway/mcp.ts**

- Import `CREATURE_KINDS` from `../shared/creatures.ts` and `RECIPES, WEAPONS` from `../shared/items.ts`.
- Before `return s;`:
```ts
  s.registerTool('attack', {
    description: `Fight until the target dies, leaves your sight, or you drop below ${B.lowHealth} health. Target: an id from observe (agent_12, mob_5) or a type meaning the nearest one: ${CREATURE_KINDS.join(', ')}, rock. A hit every ${B.attackTicks}s in reach: fists ${B.fistDamage}, club ${WEAPONS.club}; hunters x${B.hunterMultiplier}. No fighting robots in the Plaza. Costs an action cooldown (2 s while in combat).`,
    inputSchema: { target: z.string().max(40), thought },
  }, (args) => reply('attack', args, 'do'));

  s.registerTool('heal', {
    description: `Medics only: +${B.healAmount} health to another robot within ${B.healRange} tiles. Costs an action cooldown.`,
    inputSchema: { agent: z.string().max(40), thought },
  }, (args) => reply('heal', args, 'do'));

  s.registerTool('craft', {
    description: `Make something by hand: ${Object.entries(RECIPES).map(([item, r]) => `${item} (${Object.entries(r).map(([m, n]) => `${n} ${m}`).join(' + ')})`).join(', ')}. A club deals ${WEAPONS.club}; you always fight with your best weapon. Costs an action cooldown.`,
    inputSchema: { item: z.enum(Object.keys(RECIPES) as [string, ...string[]]), thought },
  }, (args) => reply('craft', args, 'do'));
```

- [ ] **Step 7: Run everything**

Run: `bun run test && bun run test:int && bun run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add engine gateway test
git commit -m "feat: attack, heal and craft over MCP; creatures persist; rules list combat and creatures" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Spectator: creatures, fight marker, C fight cam

**Files:**
- Create: `web/src/creatures.ts`
- Modify: `web/src/main.ts`, `web/src/robots.ts`, `web/index.html`

- [ ] **Step 1: web/src/creatures.ts**

```ts
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CREATURES, type CreatureKind } from '../../shared/creatures.ts';
import type { CreatureView } from '../../shared/types.ts';

// Primitives until real CC0 models land: colour, width, height in tiles.
const BODY: Record<CreatureKind, [string, number, number]> = {
  rabbit: ['#d9d2c5', 0.3, 0.3], deer: ['#a0703c', 0.45, 0.8], boar: ['#5b4636', 0.55, 0.45], duck: ['#f2d23c', 0.3, 0.35],
  goblin: ['#4f9a3a', 0.4, 0.6], wolf: ['#6d7280', 0.5, 0.5], roomba: ['#2b2b2b', 0.6, 0.15], golem: ['#5d7a4a', 1.2, 1.8],
};

interface Mob {
  root: THREE.Group;
  tag: HTMLDivElement;
  hp: HTMLElement;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

export class Creatures {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  tickMs: number;
  mobs = new Map<string, Mob>();
  looks = new Map<CreatureKind, [THREE.BoxGeometry, THREE.MeshLambertMaterial]>();

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number, tickMs: number) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.tickMs = tickMs;
  }

  sync(views: CreatureView[]): void {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      const m = this.mobs.get(v.id) ?? this.spawn(v);
      m.from.copy(m.root.position);
      m.to.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
      m.t = 0;
      m.hp.style.width = `${(100 * v.hp) / v.maxHp}%`;
      m.tag.classList.toggle('angry', v.mode === 'chase');
    }
    for (const [id, m] of this.mobs) {
      if (seen.has(id)) continue;
      this.scene.remove(m.root);
      m.tag.remove();
      this.mobs.delete(id);
    }
  }

  update(dt: number): void {
    for (const m of this.mobs.values()) {
      m.t = Math.min(1, m.t + (dt * 1000) / this.tickMs);
      m.root.position.lerpVectors(m.from, m.to, m.t);
      const dx = m.to.x - m.from.x, dz = m.to.z - m.from.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-3) m.root.rotation.y = Math.atan2(dx, dz);
    }
  }

  spawn(v: CreatureView): Mob {
    const [color, width, height] = BODY[v.kind];
    let look = this.looks.get(v.kind);
    if (!look) {
      look = [new THREE.BoxGeometry(width, height, width * 1.4), new THREE.MeshLambertMaterial({ color })];
      this.looks.set(v.kind, look);
    }
    const root = new THREE.Group();
    const body = new THREE.Mesh(look[0], look[1]);
    body.position.y = height / 2;
    root.add(body);
    const tag = document.createElement('div');
    tag.className = 'mobtag';
    tag.textContent = CREATURES[v.kind].emoji;
    const bar = document.createElement('span');
    bar.className = 'hp';
    const hp = document.createElement('i');
    bar.append(hp);
    tag.append(bar);
    const label = new CSS2DObject(tag);
    label.position.y = height + 0.35;
    root.add(label);
    root.position.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
    this.scene.add(root);
    const m: Mob = { root, tag, hp, from: root.position.clone(), to: root.position.clone(), t: 1 };
    this.mobs.set(v.id, m);
    return m;
  }
}
```

- [ ] **Step 2: Robots show fights**

In `web/src/robots.ts` `sync`, after the `away` toggle add `b.tag.classList.toggle('fighting', v.fighting);`. Change `still` so an attack plays Punch too: `v.action === 'gather' || v.action === 'attack' ? 'Punch' : ...`.

- [ ] **Step 3: web/index.html**

Add to the styles:
```css
  .mobtag { font-size: 16px; text-align: center; line-height: 1; }
  .mobtag .hp { display: block; width: 22px; height: 3px; margin: 2px auto 0; background: rgba(0, 0, 0, 0.35); border-radius: 2px; overflow: hidden; }
  .mobtag .hp i { display: block; height: 100%; background: #ff5a5a; }
  .mobtag.angry { filter: drop-shadow(0 0 4px #ff3b3b); }
  .tag.fighting .name::before { content: '⚔️ '; }
```
Change the keys hint to `… · Tab follow · C fight cam · F free cam · H hide UI · K admin`.

- [ ] **Step 4: web/src/main.ts**

- Import `{ Creatures } from './creatures.ts'` and construct `const creatures = new Creatures(scene, (x, y) => chunks.heightAt(x, y), B.tickMs);` after `loot`.
- In the tick branch: `creatures.sync(m.creatures);`. Change the status to include creatures: `` `day ${t.day} · ${t.phase} · ${m.agents.length} robots · ${m.creatures.length} creatures` ``.
- In the animate loop, next to `robots.update(dt)`, call `creatures.update(dt)`.
- In keydown:
```ts
  if (k === 'c') {
    const fighters = [...robots.bots.values()].filter((b) => b.view.fighting).map((b) => b.view.id);
    if (fighters.length) setFollow(fighters[(fighters.indexOf(follow ?? '') + 1) % fighters.length]);
  }
```

- [ ] **Step 5: Build, type-check, look in Brave**

Run: `bun run build:web && bun run typecheck`
Expected: clean.

Restart the local stack. Then in Brave (plain `browser-use`, `new_tab('http://localhost:3000')`, `activate_tab`), confirm:
- creatures appear with emoji tags and HP bars;
- `C` jumps to a fight when one exists;
- no page errors.

If the display is asleep (tabs report `hidden`), skip the visual check and ledger it. Never start headless Chrome.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): creatures with emoji tags and HP bars, fight marker, C fight cam" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Examples, prompt, README, spec

**Files:**
- Modify: `examples/llm-agent.ts`, `examples/scripted-bot.ts`, `examples/AGENT_PROMPT.md`, `README.md`, the spec

- [ ] **Step 1: llm-agent.ts**

- Add `'attack', 'heal', 'craft'` to `ACTIONS`.
- Append to `SYSTEM`: `If something is "hunting you": attack it (its mob id) when health is above 40, else move_to 15+ tiles away. Rabbits and deer are food: attack them, then eat meat (+10 food, sometimes a tummy ache). With 5 wood, craft a club (double damage).`
- In `fallback`, before the water branch:
```ts
  const threat = o.nearby.find((l) => l.includes('hunting you'))?.split(' ')[0];
  if (threat) {
    if (me.health >= 40) options.push({ name: 'attack', args: { target: threat }, why: 'fighting back' });
    else {
      const [x, y] = me.pos;
      options.push({ name: 'move_to', args: { x: Math.max(0, x - 15), y: Math.max(0, y - 15) }, why: 'running away' });
    }
  }
  if ((me.inventory.wood ?? 0) >= 5 && !me.inventory.club) options.push({ name: 'craft', args: { item: 'club' }, why: 'making a club' });
```
(The `club` line comes after the survival rules; place it just before the final explore option.)

- [ ] **Step 2: scripted-bot.ts**

Right after the observe/chat block, handle threats:
```ts
        const threat = o.data.nearby?.find((l) => l.includes('hunting you'))?.split(' ')[0];
        if (threat && !o.data.you.dead) {
          await call(c, 'attack', { target: threat, thought: me.health >= 40 ? 'not today, monster' : 'cornered' });
          continue;
        }
```
Add `nearby: string[]` to the bot's `Reply` type, and move `const me = o.data.you;` above this block if needed.

- [ ] **Step 3: Docs**

- AGENT_PROMPT: add a "Fighting" paragraph:
  - `attack(target)` with an id or a type;
  - fists 5, club 10 (craft from 5 wood), hunters ×1.5;
  - night monsters, and wolves hunt robots that are alone;
  - goblins steal, Roombas eat loot piles;
  - medics can `heal`;
  - no PvP in the Plaza;
  - kill scores.
- README tools line: add `attack`, `heal`, `craft` to the actions.
- Spec:
  - Row 0.0.1-4: append "(as built: creatures only near robots; drops go straight to the killer's bag; club via `craft`; primitives + emoji; light radii and Golem wall damage come with campfires/walls)".
  - §6.4: note that the 2 s row is "attacking, hit in the last 10 s, or a hostile monster within 3 tiles".
  - §5 key table: add ``| `creatures` | string | JSON of live creatures (like `loot`) |``.

- [ ] **Step 4: Commit**

```bash
bunx tsc --noEmit
git add examples README.md docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md
git commit -m "docs: fighting agents, prompt, README and spec for 0.0.1-4" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Local demo, final review, release

- [ ] **Step 1: Full verification**

Run: `bun run test && bun run test:int && bun run typecheck && bun run build:web`

- [ ] **Step 2: Local night demo**

1. Restart the local stack.
2. Run 5 scripted bots plus the local Gemma agent.
3. Force night locally so the demo doesn't wait 14 minutes: stop the engine, set `meta.tick` in Redis DB 1 to a night tick (e.g. `hset meta tick 900` + day offset), then restart.
4. Watch for about 3 minutes, and confirm from logs and the chat panel: monsters spawn, a steal or bite happens, a robot fights back or dies, and a kill line appears.

- [ ] **Step 3: Version, push, tag, check production**

1. Set `package.json` version to `0.0.1-4`, then commit.
2. `git push -q && git tag v0.0.1-4 && git push -q origin v0.0.1-4`.
3. Poll `https://touchgrass.win/health` until it reports `0.0.1-4` (auto-deploy is on).

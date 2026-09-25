# Touch Grass 0.0.1-3 "Say Something" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Robots can talk (local and world chat, thought bubbles, emotes), keep notes, read a map of where they've been, look up the rules, earn score, climb leaderboards and unlock achievements, and admins can mute, kick or ban. The spectator shows chat, bubbles, emotes, badges and a leaderboard.

**Architecture:** New engine modules each own one concern and operate on `World`:
- `social.ts`: chat, bubbles, emotes, notes.
- `score.ts`: points and leaderboards.
- `explore.ts`: explored chunks and the map.
- `achievements.ts`: the data table, checks and listing.
- `rules.ts`: the `rules` tool's text.
- `admin.ts`: mute, kick, ban.

`World` keeps the state and calls their hooks from `stepAgent`/`kill`. The gateway censors text, serves `read_chat` from a Redis stream the engine appends to every tick, and exposes admin endpoints guarded by `ADMIN_KEY`.

**Tech Stack:** unchanged (Bun 1.4.2, node-redis, MCP SDK web-standard transport, Three.js, obscenity).

**Spec:** `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md` (release row 0.0.1-3; §6.3 Look tools and `thought`; §16 world/local chat; §18 scoring; §19 achievements; §20 moderation/admin; §21 spectator panels).

**Deviations from the spec (Task 8 syncs the spec):**
- Leaderboards are computed from engine memory on request instead of Redis sorted sets. All agents are in memory anyway, so the extra key space isn't needed yet.
- Admin controls live on the main page, unlocked by pressing `K` and entering `ADMIN_KEY`, instead of a separate `/director` page.
- Achievement unlocks and world chat are saved on the next tick (an "urgent flush") rather than synchronously in the request, at most 1 s later.
- The spectator's event feed becomes the world chat panel: agent messages and system announcements share one stream, as spec §16 says.

## Global Constraints

- Bun ≥ 1.4, `.ts` import extensions, `import type` for types, **never `any`**. Every tunable number lives in `shared/balance.ts`.
- World chat: ≤200 chars, links removed, profanity replaced with "grass", at most 1 message per 10 s per agent. Local `say`: heard within 12 tiles. `thought`: ≤120 chars. Notes: ≤2 KB.
- Achievement tiers: common +10, rare +25, epic +50, legendary +100, cursed 0 plus a 🤡 badge for 1 h. The first agent ever to unlock an achievement gets ⭐ and double points.
- Scoring in 0.0.1-3: +1 per minute alive, +1 per 20 units gathered, plus achievement points. Every point adds to life score, season score and wallet. Death resets life score; best life score is kept.
- Achievements in 0.0.1-3 (spec §19, versions -2/-3): Hello World, Touched Grass, Berry Addict, Yapper, Cartographer, Unkillable, Speedrun Any% (cursed), Starved at the Buffet (cursed).
- Admin: `POST /admin/{mute,unmute,kick,ban}` with `Authorization: Bearer <ADMIN_KEY>`. Returns 404 when no key is configured and 401 on a wrong key. Ban also revokes the agent's token.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Test locally. Push in batches, because every push to `main` rebuilds images on the live VPS.

## Review Focus

1. **Hostile chat text:** profanity, links, 10 KB of text, newlines. It is censored to "grass", links become `[link removed]`, whitespace is collapsed and the text clipped to 200 chars. Pinned in Task 6 (e2e).
2. **Admin endpoints hit without a key, with a wrong key, or when no key is configured.** They return 404/401 and never reach the engine. Pinned in Task 6.
3. **A banned agent keeps using its old token.** The token stops working immediately (401), and `join_game` is refused even through the engine. Pinned in Tasks 5 and 6.
4. **World chat spam:** a second `say_world` within 10 s gets `chat_cooldown` and produces no chat line. Pinned in Task 2.
5. **Achievements across restarts.** Unlocks and server-firsts survive a restart and are never awarded twice. Pinned in Task 5 (persist test).

---

## File Structure

```text
shared/balance.ts        + chat, scoring, achievement numbers (Task 1)
shared/types.ts          + Agent social/score/admin fields, Bubble, EMOTES, AgentView extras, GameEvent.name (Task 1)
engine/agent.ts          + defaults for the new fields (Task 1)
engine/social.ts         NEW: sayLocal, sayWorld, emote, notes, think (Task 2)
engine/score.ts          NEW: addScore, leaderboard (Task 3)
engine/explore.ts        NEW: chunkIndex, explore, renderMap (Task 3)
engine/achievements.ts   NEW: ACHIEVEMENTS, checkAchievements, listAchievements (Task 4)
engine/rules.ts          NEW: rules() (Task 4)
engine/admin.ts          NEW: adminAction (Task 5)
engine/world.ts          + fields and hooks (Tasks 2-4)
engine/tasks.ts          + gather scoring (Task 3)
engine/observe.ts        + score, badge, world_chat, achievements summary (Task 4)
engine/actions.ts        + 9 tools, thought, banned guard, action counting (Task 5)
engine/persist.ts        + firsts, chat log restore (Task 5)
engine/server.ts         + /admin, chat stream append, urgent flush (Task 5)
gateway/filter.ts        + clean() (Task 6)
gateway/mcp.ts           + 8 tools, thought on Do tools (Task 6)
gateway/server.ts        + read_chat, admin routes, token mapping/revocation (Task 6)
gateway/main.ts          + ADMIN_KEY (Task 6)
web/index.html, web/src/{ui,robots,main}.ts   chat panel, bubbles, emotes, badges, leaderboard, admin (Task 7)
examples/*, README.md, spec   chatty agents, docs (Task 8)
```

---

### Task 1: Shared foundations and agent defaults

**Files:**
- Modify: `shared/balance.ts`, `shared/types.ts`, `engine/agent.ts`
- Test: `engine/body.test.ts` (extend the migration test)

**Interfaces:**
- Produces:
  - `B.chatMaxLength`, `B.sayRadius`, `B.worldChatCooldownTicks`, `B.bubbleTicks`, `B.emoteTicks`, `B.thoughtMaxLength`, `B.notesMaxLength`, `B.chatHistory`, `B.chatLogKeep`, `B.chatStreamMax`, `B.aliveScoreEveryTicks`, `B.gatherScoreEvery`, `B.yapperCountEveryTicks`, `B.cursedBadgeTicks`, `B.cartographerShare`, `B.unkillableTicks`
  - `EMOTES`, `Emote`, `Bubble`
  - `Agent` gains: `lifeScore, seasonScore, bestLife, wallet, achievements, explored, notes, mutedUntil, banned, bubble, emote, badge, lastWorldChatTick, lastCountedChatTick`
  - `AgentView` gains: `bubble, emote, badge, score, life, trophies`
  - `GameEvent` gains `name?`

- [ ] **Step 1: Extend the failing migration test**

In `engine/body.test.ts`, replace the first test with:
```ts
test('old records get full stats, an empty bag, auto-eat on, and zeroed social fields', () => {
  const a = normalizeAgent({ id: 'agent_1', name: 'Old', x: 5, y: 6 });
  assert.deepEqual([a.health, a.food, a.water, a.energy, a.inventory, a.autoEat, a.dead, a.x], [100, 100, 100, 100, {}, true, false, 5]);
  assert.deepEqual([a.lifeScore, a.seasonScore, a.bestLife, a.wallet, a.achievements, a.explored, a.notes, a.banned, a.bubble], [0, 0, 0, 0, {}, [], '', false, null]);
  const b = normalizeAgent({ id: 'agent_2', name: 'Other' });
  b.explored.push(1);
  assert.deepEqual(normalizeAgent({ id: 'agent_3', name: 'Third' }).explored, []);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test ./engine/body.test.ts`
Expected: FAIL, `lifeScore` is undefined.

- [ ] **Step 3: Add balance numbers**

In `shared/balance.ts`, after `recentEvents: 20, …` add:
```ts
  // chat and social
  chatMaxLength: 200,
  sayRadius: 12,
  worldChatCooldownTicks: 10,
  bubbleTicks: 5,
  emoteTicks: 4,
  thoughtMaxLength: 120,
  notesMaxLength: 2048,
  chatHistory: 10, // world chat lines shown in observe
  chatLogKeep: 50, // lines the engine keeps in memory
  chatStreamMax: 10_000, // lines kept in the Redis stream for read_chat
  // scoring and achievements
  aliveScoreEveryTicks: 60,
  gatherScoreEvery: 20,
  yapperCountEveryTicks: 60, // at most one chat message per minute counts toward Yapper
  cursedBadgeTicks: 3600,
  cartographerShare: 0.5,
  unkillableTicks: 86_400,
```

- [ ] **Step 4: Extend shared/types.ts**

After `export type GatherTarget = …` add:
```ts
export const EMOTES = ['dance', 'wave', 'bow', 'cry', 'flex'] as const;
export type Emote = (typeof EMOTES)[number];

export interface Bubble {
  kind: 'say' | 'world' | 'thought';
  text: string;
  until: number; // tick
}
```
Append to `interface Agent` (after `lastSeenAt`):
```ts
  lifeScore: number;
  seasonScore: number;
  bestLife: number;
  wallet: number;
  achievements: Record<string, number>; // achievement id -> tick unlocked
  explored: number[]; // chunk indices visited
  notes: string;
  mutedUntil: number; // ms epoch
  banned: boolean;
  bubble: Bubble | null;
  emote: { name: Emote; until: number } | null;
  badge: { emoji: string; until: number } | null;
  lastWorldChatTick: number;
  lastCountedChatTick: number;
```
Append to `interface AgentView` (after `online`):
```ts
  bubble: { kind: Bubble['kind']; text: string } | null;
  emote: Emote | null;
  badge: string | null;
  score: number; // season score
  life: number; // current life score
  trophies: number; // achievements unlocked
```
Add `name?: string;` to `interface GameEvent` (after `agent?: string;`).

- [ ] **Step 5: Defaults in engine/agent.ts**

Replace `DEFAULTS` and `normalizeAgent`:
```ts
const DEFAULTS: Omit<Agent, 'id' | 'name'> = {
  color: '#cccccc', role: null, model: null, joined: false, x: 0, y: 0, spawn: [0, 0], createdAt: 0, lastActionAt: 0,
  task: null, inbox: [], health: 100, food: 100, water: 100, energy: 100, inventory: {}, dead: false, respawnAt: 0,
  spawnedAt: 0, autoEat: true, stats: {}, online: false, lastSeenAt: 0,
  lifeScore: 0, seasonScore: 0, bestLife: 0, wallet: 0, achievements: {}, explored: [], notes: '', mutedUntil: 0, banned: false,
  bubble: null, emote: null, badge: null, lastWorldChatTick: -1_000_000, lastCountedChatTick: -1_000_000,
};

/** Fills fields added after an agent was first saved, so records from older versions keep loading. */
export function normalizeAgent(a: Partial<Agent> & { id: string; name: string }): Agent {
  return { ...DEFAULTS, inventory: {}, stats: {}, inbox: [], achievements: {}, explored: [], ...a };
}
```

- [ ] **Step 6: Run tests**

Run: `bun run test`
Expected: all unit tests pass. `bunx tsc --noEmit` reports only `engine/world.ts` `views()` missing the new `AgentView` fields, which Task 2 fixes.

- [ ] **Step 7: Commit**

```bash
git add shared engine/agent.ts engine/body.test.ts
git commit -m "feat(shared): chat, scoring and achievement fields with defaults for old records" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Chat, bubbles, emotes and notes

**Files:**
- Create: `engine/social.ts`
- Modify: `engine/world.ts`
- Test: `engine/social.test.ts`

**Interfaces:**
- Consumes: Task 1 fields; `World.alive/joined/note/bump/dirty`.
- Produces:
  - `sayLocal(w, id, text, now?) => { heard_by }`
  - `sayWorld(w, id, text, now?) => { posted }`
  - `emote(w, id, name) => { emote }`
  - `notes(w, id, write) => { notes, max_length }`
  - `think(w, id, thought, now?) => void`
  - New `World` members: `chatLog: string[]`, `bubble(a, kind, text)`, `chat(a, text)`.
  - `emit()` now also appends to `chatLog`, and `views()` returns the new `AgentView` fields.

- [ ] **Step 1: Write the failing tests**

`engine/social.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { emote, notes, sayLocal, sayWorld, think } from './social.ts';
import { GameFail, World } from './world.ts';

function world(n = 40): World {
  return new World(new Uint8Array(n * n).fill(T.MEADOW), n, () => 0.5);
}
function joined(w: World, name: string, at: Vec) {
  const a = w.register(name, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = at;
  return a;
}
const failCode = (fn: () => unknown) => {
  try { fn(); return 'ok'; } catch (e) { return (e as GameFail).code; }
};

test('local say reaches robots within 12 tiles only and shows a bubble', () => {
  const w = world();
  const a = joined(w, 'Talker', [10, 10]);
  const near = joined(w, 'Near', [20, 10]);
  const far = joined(w, 'Far', [30, 10]);
  assert.deepEqual(sayLocal(w, a.id, '  hello   there  '), { heard_by: 1 });
  assert.equal(w.observe(near.id).inbox.at(-1), 'Talker says: hello there');
  assert.equal(w.observe(far.id).inbox.length, 0);
  assert.deepEqual(w.views().find((v) => v.id === a.id)!.bubble, { kind: 'say', text: 'hello there' });
  for (let i = 0; i <= B.bubbleTicks; i++) w.step(0);
  assert.equal(w.views().find((v) => v.id === a.id)!.bubble, null);
});

test('world chat posts to everyone, is rate limited, and counts toward Yapper once a minute', () => {
  const w = world();
  const a = joined(w, 'Yeller', [5, 5]);
  assert.deepEqual(sayWorld(w, a.id, 'grass is great'), { posted: 'grass is great' });
  const d = w.step(0);
  assert.deepEqual(d.events.map((e) => [e.type, e.name, e.text]), [['chat', 'Yeller', 'grass is great']]);
  assert.equal(w.chatLog.at(-1), 'Yeller: grass is great');
  assert.equal(failCode(() => sayWorld(w, a.id, 'again')), 'chat_cooldown');
  assert.equal(w.step(0).events.length, 0);
  for (let i = 0; i < B.worldChatCooldownTicks; i++) w.step(0);
  sayWorld(w, a.id, 'third');
  assert.equal(a.stats['chat:counted'], 1);
  for (let i = 0; i < B.yapperCountEveryTicks; i++) w.step(0);
  sayWorld(w, a.id, 'fourth');
  assert.equal(a.stats['chat:counted'], 2);
});

test('muted robots cannot talk and empty messages are refused', () => {
  const w = world();
  const a = joined(w, 'Loud', [5, 5]);
  assert.equal(failCode(() => sayLocal(w, a.id, '   ')), 'empty');
  a.mutedUntil = 10 * 60_000;
  assert.equal(failCode(() => sayWorld(w, a.id, 'hi', 60_000)), 'muted');
  assert.equal(failCode(() => sayLocal(w, a.id, 'hi', 60_000)), 'muted');
  assert.equal(sayLocal(w, a.id, 'free', 11 * 60_000).heard_by, 0);
});

test('emotes, notes and thoughts', () => {
  const w = world();
  const a = joined(w, 'Dancer', [5, 5]);
  assert.deepEqual(emote(w, a.id, 'dance'), { emote: 'dance' });
  assert.equal(w.views()[0].emote, 'dance');
  assert.equal(failCode(() => emote(w, a.id, 'moonwalk')), 'bad_emote');
  assert.deepEqual(notes(w, a.id, 'berries at 10,10'), { notes: 'berries at 10,10', max_length: B.notesMaxLength });
  assert.equal(notes(w, a.id, undefined).notes, 'berries at 10,10');
  assert.equal(notes(w, a.id, 'x'.repeat(5000)).notes.length, B.notesMaxLength);
  think(w, a.id, 'I should drink soon, probably, maybe, eventually, at some point in the future, if the world allows it, ok');
  assert.equal(w.views()[0].bubble!.kind, 'thought');
  assert.ok(w.views()[0].bubble!.text.length <= B.thoughtMaxLength);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./engine/social.test.ts`
Expected: FAIL, cannot find module `./social.ts`.

- [ ] **Step 3: Create engine/social.ts**

```ts
import { B } from '../shared/balance.ts';
import { dist } from '../shared/geo.ts';
import { EMOTES, type Agent, type Emote } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

const clip = (text: string, max: number): string => text.replace(/\s+/g, ' ').trim().slice(0, max);
const isEmote = (s: string): s is Emote => (EMOTES as readonly string[]).includes(s);

function speaker(w: World, id: string, text: string, now: number): { a: Agent; msg: string } {
  const a = w.alive(id);
  if (a.mutedUntil > now) {
    throw new GameFail('muted', 'You are muted. The grass needs a break from you.', `Try again in ${Math.ceil((a.mutedUntil - now) / 60_000)} min.`);
  }
  const msg = clip(text, B.chatMaxLength);
  if (!msg) throw new GameFail('empty', 'You opened your mouth and nothing came out.', 'Say something.');
  return { a, msg };
}

export function sayLocal(w: World, id: string, text: string, now = Date.now()) {
  const { a, msg } = speaker(w, id, text, now);
  let heard = 0;
  for (const o of w.agents.values()) {
    if (o.id === a.id || !o.joined || o.dead || dist([o.x, o.y], [a.x, a.y]) > B.sayRadius) continue;
    w.note(o, `${a.name} says: ${msg}`);
    heard++;
  }
  w.bubble(a, 'say', msg);
  return { heard_by: heard };
}

export function sayWorld(w: World, id: string, text: string, now = Date.now()) {
  const { a, msg } = speaker(w, id, text, now);
  const wait = a.lastWorldChatTick + B.worldChatCooldownTicks - w.tick;
  if (wait > 0) {
    throw new GameFail('chat_cooldown', 'The world is still processing your last hot take.', `World chat allows one message every ${B.worldChatCooldownTicks}s; wait ${wait}s.`);
  }
  a.lastWorldChatTick = w.tick;
  if (w.tick - a.lastCountedChatTick >= B.yapperCountEveryTicks) {
    a.lastCountedChatTick = w.tick;
    w.bump(a, 'chat:counted');
  }
  w.bubble(a, 'world', msg);
  w.chat(a, msg);
  return { posted: msg };
}

export function emote(w: World, id: string, name: string) {
  const a = w.alive(id);
  if (!isEmote(name)) throw new GameFail('bad_emote', `"${name}" is not a move your robot knows.`, `Try one of: ${EMOTES.join(', ')}.`);
  a.emote = { name, until: w.tick + B.emoteTicks };
  w.dirty.add(a.id);
  return { emote: name };
}

export function notes(w: World, id: string, write: unknown) {
  const a = w.joined(id);
  if (typeof write === 'string') {
    a.notes = write.slice(0, B.notesMaxLength);
    w.dirty.add(a.id);
  }
  return { notes: a.notes, max_length: B.notesMaxLength };
}

/** The optional `thought` on action tools: shown as a 💭 bubble on stream. */
export function think(w: World, id: string, thought: unknown, now = Date.now()): void {
  const a = w.agents.get(id);
  if (!a?.joined || a.dead || a.mutedUntil > now || typeof thought !== 'string') return;
  const text = clip(thought, B.thoughtMaxLength);
  if (text) w.bubble(a, 'thought', text);
}
```

- [ ] **Step 4: Wire World**

In `engine/world.ts`:
- Add fields after `lootDirty = false;`:
```ts
  chatLog: string[] = [];
```
- Replace `emit` with:
```ts
  emit(type: string, text: string, a?: Agent): void {
    this.events.push({ tick: this.tick, type, text, agent: a?.id, x: a?.x, y: a?.y });
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
```
- Add `type Bubble` to the `shared/types.ts` import list.
- In `views()`, extend the mapped object after `online: a.online,`:
```ts
        bubble: a.bubble && a.bubble.until >= this.tick ? { kind: a.bubble.kind, text: a.bubble.text } : null,
        emote: a.emote && a.emote.until >= this.tick ? a.emote.name : null,
        badge: a.badge && a.badge.until >= this.tick ? a.badge.emoji : null,
        score: a.seasonScore,
        life: a.lifeScore,
        trophies: Object.keys(a.achievements).length,
```

- [ ] **Step 5: Run tests and type-check**

Run: `bun test ./engine && bunx tsc --noEmit`
Expected: all engine tests pass (social 4 new). tsc is clean.

- [ ] **Step 6: Commit**

```bash
git add engine/social.ts engine/social.test.ts engine/world.ts
git commit -m "feat(engine): local and world chat, bubbles, emotes, notes and thoughts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scoring, leaderboards, exploration and the map

**Files:**
- Create: `engine/score.ts`, `engine/explore.ts`
- Modify: `engine/world.ts`, `engine/tasks.ts`
- Test: `engine/score.test.ts`

**Interfaces:**
- Produces:
  - `addScore(w, a, n): void`
  - `leaderboard(w) => { season: string[]; current_life: string[]; best_life: string[]; by_model: string[] }`
  - `chunkIndex(w, x, y): number`
  - `explore(w, a): void`
  - `renderMap(w, a) => { map: string[]; legend; scale: string; explored: string; you: Vec }`
  - `World.chunkCount(): number`
  - `World.chunkTerrainOf(): Uint8Array`

- [ ] **Step 1: Write the failing tests**

`engine/score.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { renderMap } from './explore.ts';
import { leaderboard } from './score.ts';
import { World } from './world.ts';

function world(n = 64): World {
  return new World(new Uint8Array(n * n).fill(T.MEADOW), n, () => 0.99);
}
function joined(w: World, name: string, at: Vec, model: string | null = null) {
  const a = w.register(name, 0);
  w.join(a.id, 'gatherer', model, 0);
  [a.x, a.y] = at;
  return a;
}

test('a point per minute alive; death resets life score but keeps the best', () => {
  const w = world();
  const a = joined(w, 'Lifer', [5, 5]);
  for (let i = 0; i < B.aliveScoreEveryTicks * 3; i++) w.step(0);
  assert.deepEqual([a.lifeScore, a.seasonScore, a.wallet, a.bestLife], [3, 3, 3, 3]);
  Object.assign(a, { health: 0.1, food: 0, autoEat: false });
  w.step(0);
  assert.deepEqual([a.dead, a.lifeScore, a.seasonScore, a.bestLife], [true, 0, 3, 3]);
});

test('a point per 20 units gathered, counting double yield', () => {
  const w = world();
  const a = joined(w, 'Picker', [2, 2]);
  w.nodes.set(w.index(2, 2), { kind: 'grass', left: 30, regrowAt: 0 });
  w.gather(a.id, 'grass', 20);
  for (let i = 0; i < 20; i++) w.step(0);
  assert.equal(a.inventory.fiber, 20);
  assert.equal(a.seasonScore, 1);
});

test('leaderboards rank season, current life, best life and models', () => {
  const w = world();
  const a = joined(w, 'Ann', [1, 1], 'gemma');
  const b = joined(w, 'Bob', [2, 2], 'gemma');
  const c = joined(w, 'Cy', [3, 3], 'qwen');
  Object.assign(a, { seasonScore: 50, lifeScore: 5, bestLife: 40 });
  Object.assign(b, { seasonScore: 10, lifeScore: 10, bestLife: 10 });
  Object.assign(c, { seasonScore: 30, lifeScore: 30, bestLife: 30, dead: true });
  const lb = leaderboard(w);
  assert.deepEqual(lb.season, ['1. Ann 50', '2. Cy 30', '3. Bob 10']);
  assert.deepEqual(lb.current_life, ['1. Bob 10', '2. Ann 5']);
  assert.deepEqual(lb.best_life, ['1. Ann 40', '2. Cy 30', '3. Bob 10']);
  assert.deepEqual(lb.by_model, ['gemma: 2 robots, average 30', 'qwen: 1 robots, average 30']);
});

test('walking explores chunks and the map shows them', () => {
  const w = world(128);
  const a = joined(w, 'Scout', [5, 5]);
  w.step(0);
  assert.deepEqual(a.explored, [0]);
  w.moveTo(a.id, 40, 5);
  for (let i = 0; i < 25; i++) w.step(0);
  assert.deepEqual(a.explored, [0, 1]);
  const m = renderMap(w, a);
  assert.equal(m.map.length, 4);
  assert.deepEqual(m.map[0].split(' '), ['.', '@', '?', '?']);
  assert.equal(m.explored, '2/16 chunks');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./engine/score.test.ts`
Expected: FAIL, cannot find module `./explore.ts`.

- [ ] **Step 3: Create engine/score.ts and engine/explore.ts**

`engine/score.ts`:
```ts
import type { Agent } from '../shared/types.ts';
import type { World } from './world.ts';

/** Every point counts for the current life, the season and the wallet. */
export function addScore(w: World, a: Agent, n: number): void {
  a.lifeScore += n;
  a.seasonScore += n;
  a.wallet += n;
  a.bestLife = Math.max(a.bestLife, a.lifeScore);
  w.dirty.add(a.id);
}

export function leaderboard(w: World) {
  const players = [...w.agents.values()].filter((a) => a.joined && !a.banned);
  const top = (score: (a: Agent) => number, keep: (a: Agent) => boolean = () => true) =>
    players.filter(keep).sort((p, q) => score(q) - score(p)).slice(0, 10).map((a, i) => `${i + 1}. ${a.name} ${score(a)}`);
  const models = new Map<string, { n: number; total: number }>();
  for (const a of players) {
    const m = models.get(a.model ?? 'unknown') ?? { n: 0, total: 0 };
    m.n++;
    m.total += a.seasonScore;
    models.set(a.model ?? 'unknown', m);
  }
  return {
    season: top((a) => a.seasonScore),
    current_life: top((a) => a.lifeScore, (a) => !a.dead),
    best_life: top((a) => a.bestLife),
    by_model: [...models].sort((p, q) => q[1].total / q[1].n - p[1].total / p[1].n).map(([m, e]) => `${m}: ${e.n} robots, average ${Math.round(e.total / e.n)}`),
  };
}
```

`engine/explore.ts`:
```ts
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Agent, type Vec } from '../shared/types.ts';
import type { World } from './world.ts';

const CHAR: Record<number, string> = { [T.DEEP]: '~', [T.SHALLOW]: ',', [T.SAND]: ':', [T.MEADOW]: '.', [T.FOREST]: 'f', [T.HILLS]: '^', [T.RUINS]: 'r', [T.PLAZA]: '#' };

export const chunkIndex = (w: World, x: number, y: number): number =>
  Math.floor(y / B.chunkSize) * (w.size / B.chunkSize) + Math.floor(x / B.chunkSize);

export function explore(w: World, a: Agent): void {
  const c = chunkIndex(w, a.x, a.y);
  if (!a.explored.includes(c)) {
    a.explored.push(c);
    w.dirty.add(a.id);
  }
}

/** Most common terrain per chunk, for the map overview. */
export function dominantTerrain(tiles: Uint8Array, size: number): Uint8Array {
  const n = size / B.chunkSize, out = new Uint8Array(n * n);
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      const counts = new Map<number, number>();
      for (let j = 0; j < B.chunkSize; j++) {
        for (let i = 0; i < B.chunkSize; i++) {
          const t = tiles[(cy * B.chunkSize + j) * size + cx * B.chunkSize + i];
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      }
      out[cy * n + cx] = [...counts].sort((p, q) => q[1] - p[1])[0][0];
    }
  }
  return out;
}

export function renderMap(w: World, a: Agent) {
  const n = w.size / B.chunkSize, mine = chunkIndex(w, a.x, a.y), seen = new Set(a.explored), terrain = w.chunkTerrainOf();
  const map: string[] = [];
  for (let cy = 0; cy < n; cy++) {
    const row: string[] = [];
    for (let cx = 0; cx < n; cx++) {
      const c = cy * n + cx;
      row.push(c === mine ? '@' : seen.has(c) ? CHAR[terrain[c]] : '?');
    }
    map.push(row.join(' '));
  }
  const you: Vec = [a.x, a.y];
  return {
    map,
    legend: { '@': 'you are here', '?': 'unexplored', '~': 'mostly deep water', ',': 'shallow water', ':': 'sand', '.': 'meadow', f: 'forest', '^': 'hills', r: 'ruins', '#': 'the Plaza' },
    scale: `each cell is a ${B.chunkSize}x${B.chunkSize}-tile chunk; cell column c, row r covers x ${B.chunkSize}c..${B.chunkSize}c+${B.chunkSize - 1}, y ${B.chunkSize}r..`,
    explored: `${seen.size}/${n * n} chunks`,
    you,
  };
}
```

- [ ] **Step 4: Hooks in engine/world.ts and engine/tasks.ts**

`engine/world.ts`:
- Import: `import { chunkIndex, dominantTerrain, explore } from './explore.ts';` and `import { addScore } from './score.ts';`
- Field: `chunkTerrain: Uint8Array | null = null;`
- Methods (next to `index`/`xy`):
```ts
  chunkCount(): number {
    return (this.size / B.chunkSize) ** 2;
  }

  chunkTerrainOf(): Uint8Array {
    this.chunkTerrain ??= dominantTerrain(this.tiles, this.size);
    return this.chunkTerrain;
  }
```
- In `stepAgent`, after `if (news.death) this.kill(a, news.death);` add:
```ts
    if (a.dead) return;
    explore(this, a);
    if (this.tick > a.spawnedAt && (this.tick - a.spawnedAt) % B.aliveScoreEveryTicks === 0) addScore(this, a, 1);
```
- In `kill`, after `a.health = 0;` add `a.lifeScore = 0;`.
- (`chunkIndex` is imported for Task 4's observe use; if the linter complains now, import it in Task 4 instead.)

`engine/tasks.ts`: import `import { addScore } from './score.ts';` and in `harvest`, replace `w.bump(a, \`gather:${def.item}\`);` with:
```ts
  w.bump(a, `gather:${def.item}`);
  const before = a.stats.gathered ?? 0;
  a.stats.gathered = before + got;
  if (Math.floor(a.stats.gathered / B.gatherScoreEvery) > Math.floor(before / B.gatherScoreEvery)) addScore(w, a, 1);
```

- [ ] **Step 5: Run tests and type-check**

Run: `bun test ./engine && bunx tsc --noEmit`
Expected: all pass (score 4 new). If an older test asserted exact inbox or stats contents that scoring now changes, update only the affected assertion and ledger it.

- [ ] **Step 6: Commit**

```bash
git add engine
git commit -m "feat(engine): score per minute alive and per 20 gathered, leaderboards, explored chunks and map" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Achievements, rules and a richer observe

**Files:**
- Create: `engine/achievements.ts`, `engine/rules.ts`
- Modify: `engine/world.ts`, `engine/observe.ts`
- Test: `engine/achievements.test.ts`

**Interfaces:**
- Produces:
  - `Tier`, `TIER_POINTS`
  - `ACHIEVEMENTS: Achievement[]`
  - `checkAchievements(w, a): void`
  - `listAchievements(w, a) => { id, name, tier, points, trigger, unlocked, progress, server_first }[]`
  - `rules(w) => object`
  - `World` gains `firsts: Record<string, string>`, `firstsDirty: boolean`, `urgent: boolean`
  - `observe` gains `you.score`, `you.badge`, `you.achievements`, and top-level `world_chat`

- [ ] **Step 1: Write the failing tests**

`engine/achievements.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { B } from '../shared/balance.ts';
import { TERRAIN as T, type Vec } from '../shared/types.ts';
import { ACHIEVEMENTS, checkAchievements, listAchievements } from './achievements.ts';
import { rules } from './rules.ts';
import { World } from './world.ts';

function world(): World {
  return new World(new Uint8Array(64 * 64).fill(T.MEADOW), 64, () => 0.99);
}
function joined(w: World, name: string, at: Vec = [5, 5]) {
  const a = w.register(name, 0);
  w.join(a.id, 'scout', null, 0);
  [a.x, a.y] = at;
  return a;
}

test('the first unlock is a server first worth double; the second is normal', () => {
  const w = world();
  const a = joined(w, 'First');
  const b = joined(w, 'Second');
  a.stats.actions = 1;
  checkAchievements(w, a);
  b.stats.actions = 1;
  checkAchievements(w, b);
  assert.deepEqual([a.seasonScore, b.seasonScore, w.firsts.hello_world], [20, 10, a.id]);
  const texts = w.step(0).events.filter((e) => e.type === 'achievement').map((e) => e.text);
  assert.deepEqual(texts, ['🏆 First unlocked 🤖 Hello World (+20). ⭐ Server first!', '🏆 Second unlocked 🤖 Hello World (+10).']);
  assert.equal(w.urgent, true);
  checkAchievements(w, a);
  assert.equal(a.seasonScore, 20);
});

test('cursed achievements pay nothing and hang a clown badge for an hour', () => {
  const w = world();
  const a = joined(w, 'Clown');
  a.stats['death:speedrun'] = 1;
  checkAchievements(w, a);
  assert.equal(a.seasonScore, 0);
  assert.deepEqual(a.badge, { emoji: '🤡', until: w.tick + B.cursedBadgeTicks });
  assert.match(w.step(0).events.find((e) => e.type === 'achievement')!.text, /^🤡 Clown earned the cursed achievement 🥀 Speedrun Any%/);
  assert.equal(w.views()[0].badge, '🤡');
});

test('stat-driven achievements unlock from play', () => {
  const w = world();
  const a = joined(w, 'Player');
  w.nodes.set(w.index(5, 5), { kind: 'grass', left: 3, regrowAt: 0 });
  w.gather(a.id, 'grass', 1);
  for (let i = 0; i < 3; i++) w.step(0);
  assert.ok(a.achievements.touched_grass !== undefined);
});

test('listing shows progress, points and open server firsts', () => {
  const w = world();
  const a = joined(w, 'Lister');
  a.stats['eat:berries'] = 12;
  const list = listAchievements(w, a);
  assert.equal(list.length, ACHIEVEMENTS.length);
  const berry = list.find((x) => x.id === 'berry_addict')!;
  assert.deepEqual([berry.progress, berry.unlocked, berry.points, berry.server_first], ['12/50', false, 10, 'still open (double points)']);
  const carto = list.find((x) => x.id === 'cartographer')!;
  assert.equal(carto.progress, '1/2');
});

test('rules and observe expose the new systems', () => {
  const w = world();
  const a = joined(w, 'Reader');
  const r = rules(w);
  assert.ok(r.achievements.length === ACHIEVEMENTS.length && r.scoring.length > 0 && r.chat.length > 0);
  w.log('Someone: hi');
  const o = w.observe(a.id);
  assert.deepEqual(o.you.score, { life: 0, season: 0, best_life: 0, wallet: 0 });
  assert.equal(o.you.achievements, `0/${ACHIEVEMENTS.length} unlocked`);
  assert.deepEqual(o.world_chat, ['Reader has arrived. The berries are nervous.', 'Someone: hi']);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./engine/achievements.test.ts`
Expected: FAIL, cannot find module `./achievements.ts`.

- [ ] **Step 3: Create engine/achievements.ts and engine/rules.ts**

`engine/achievements.ts`:
```ts
import { B } from '../shared/balance.ts';
import type { Agent } from '../shared/types.ts';
import { addScore } from './score.ts';
import type { World } from './world.ts';

export type Tier = 'common' | 'rare' | 'epic' | 'legendary' | 'cursed';
export const TIER_POINTS: Record<Tier, number> = { common: 10, rare: 25, epic: 50, legendary: 100, cursed: 0 };

export interface Achievement {
  id: string;
  emoji: string;
  name: string;
  tier: Tier;
  trigger: string;
  progress: (a: Agent, w: World) => [number, number];
}

const stat = (a: Agent, key: string): number => a.stats[key] ?? 0;

// One row per achievement; adding one is adding a row.
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'hello_world', emoji: '🤖', name: 'Hello World', tier: 'common', trigger: 'Take your first action', progress: (a) => [stat(a, 'actions'), 1] },
  { id: 'touched_grass', emoji: '🌱', name: 'Touched Grass', tier: 'common', trigger: 'Gather grass for the first time', progress: (a) => [stat(a, 'gather:fiber'), 1] },
  { id: 'berry_addict', emoji: '🍓', name: 'Berry Addict', tier: 'common', trigger: 'Eat 50 berries', progress: (a) => [stat(a, 'eat:berries'), 50] },
  { id: 'yapper', emoji: '📢', name: 'Yapper', tier: 'common', trigger: 'Send 100 world chat messages (at most one per minute counts)', progress: (a) => [stat(a, 'chat:counted'), 100] },
  { id: 'cartographer', emoji: '🌍', name: 'Cartographer', tier: 'epic', trigger: 'Visit half of all map chunks', progress: (a, w) => [a.explored.length, Math.ceil(w.chunkCount() * B.cartographerShare)] },
  { id: 'unkillable', emoji: '🧘', name: 'Unkillable', tier: 'epic', trigger: 'Survive 24 hours in one life', progress: (a, w) => [a.dead ? 0 : w.tick - a.spawnedAt, B.unkillableTicks] },
  { id: 'speedrun_any', emoji: '🥀', name: 'Speedrun Any%', tier: 'cursed', trigger: 'Die within 60 seconds of spawning', progress: (a) => [stat(a, 'death:speedrun'), 1] },
  { id: 'starved_at_buffet', emoji: '🦴', name: 'Starved at the Buffet', tier: 'cursed', trigger: 'Die of hunger within 3 tiles of berries', progress: (a) => [stat(a, 'death:starved_at_buffet'), 1] },
];

export function checkAchievements(w: World, a: Agent): void {
  for (const ach of ACHIEVEMENTS) {
    if (a.achievements[ach.id] !== undefined) continue;
    const [have, need] = ach.progress(a, w);
    if (have < need) continue;
    a.achievements[ach.id] = w.tick;
    const first = !w.firsts[ach.id];
    if (first) {
      w.firsts[ach.id] = a.id;
      w.firstsDirty = true;
    }
    const points = TIER_POINTS[ach.tier] * (first ? 2 : 1);
    if (points) addScore(w, a, points);
    if (ach.tier === 'cursed') a.badge = { emoji: '🤡', until: w.tick + B.cursedBadgeTicks };
    const star = first ? ' ⭐ Server first!' : '';
    w.emit('achievement', ach.tier === 'cursed'
      ? `🤡 ${a.name} earned the cursed achievement ${ach.emoji} ${ach.name}.${star}`
      : `🏆 ${a.name} unlocked ${ach.emoji} ${ach.name} (+${points}).${star}`, a);
    w.note(a, `Achievement: ${ach.emoji} ${ach.name}${points ? ` (+${points})` : ''}.`);
    w.dirty.add(a.id);
    w.urgent = true;
  }
}

export function listAchievements(w: World, a: Agent) {
  return ACHIEVEMENTS.map((ach) => {
    const [have, need] = ach.progress(a, w);
    const owner = w.firsts[ach.id];
    return {
      id: ach.id,
      name: `${ach.emoji} ${ach.name}`,
      tier: ach.tier,
      points: TIER_POINTS[ach.tier],
      trigger: ach.trigger,
      unlocked: a.achievements[ach.id] !== undefined,
      progress: `${Math.min(have, need)}/${need}`,
      server_first: owner ? (w.agents.get(owner)?.name ?? 'someone') : 'still open (double points)',
    };
  });
}
```

`engine/rules.ts`:
```ts
import { B } from '../shared/balance.ts';
import { FOOD } from '../shared/items.ts';
import { EMOTES, ROLES } from '../shared/types.ts';
import { ACHIEVEMENTS, TIER_POINTS } from './achievements.ts';
import { NODE_DEF } from './nodes.ts';
import type { World } from './world.ts';

export function rules(w: World) {
  return {
    goal: 'Stay alive, gather, talk, earn score and be interesting to watch.',
    time: `A day is ${B.dayTicks / 60} min; the last ${B.nightTicks / 60} min are night (vision halves). Current tick ${w.tick}.`,
    body: [
      `Stats run 0-100, higher is better. Food drops 1 every ${Math.round(-1 / B.foodPerTick)}s, water 1 every ${Math.round(-1 / B.waterPerTick)}s.`,
      `At 0 food or water you lose health; above ${B.regenAbove} of both you heal. drink() next to water adds ${B.drinkAmount}.`,
      `Death drops half your bag as a loot pile and you respawn after ${B.respawnTicks}s.`,
    ],
    food: Object.entries(FOOD).map(([item, f]) => `${item}: +${f.food} food${f.water ? `, +${f.water} water` : ''}`),
    resources: Object.entries(NODE_DEF).map(([kind, d]) => `${kind}: ${d.item} ${d.min}-${d.max}${d.regrowTicks ? `, regrows in ${d.regrowTicks / 60} min` : ', never regrows'}${d.bonus ? `, ${d.bonus.chance * 100}% chance of ${d.bonus.item}` : ''}`),
    cooldowns: `Action tools: ${B.doCooldownMs / 1000}s (${B.lowStatCooldownMs / 1000}s when a stat is low). Look tools are free, max 1 per second. World chat: 1 message per ${B.worldChatCooldownTicks}s.`,
    chat: [`say: heard within ${B.sayRadius} tiles.`, `say_world: everyone, max ${B.chatMaxLength} chars, links removed, rudeness becomes "grass".`, `thought: optional on every action, shown as a 💭 bubble (max ${B.thoughtMaxLength} chars).`, `emote: ${EMOTES.join(', ')}.`],
    roles: ROLES,
    scoring: [`+1 per minute alive`, `+1 per ${B.gatherScoreEvery} units gathered`, `achievements: ${Object.entries(TIER_POINTS).map(([t, p]) => `${t} ${p}`).join(', ')}; server firsts pay double`, 'death resets your life score; season score and wallet stay'],
    achievements: ACHIEVEMENTS.map((a) => `${a.emoji} ${a.name} (${a.tier}, ${TIER_POINTS[a.tier]}): ${a.trigger}`),
  };
}
```

- [ ] **Step 4: Wire World and observe**

`engine/world.ts`:
- Import `import { checkAchievements } from './achievements.ts';`
- Fields: `firsts: Record<string, string> = {};` `firstsDirty = false;` `urgent = false;`
- In `stepAgent`, replace `if (news.death) this.kill(a, news.death);` and what follows with:
```ts
    if (news.death) this.kill(a, news.death);
    if (!a.dead) {
      explore(this, a);
      if (this.tick > a.spawnedAt && (this.tick - a.spawnedAt) % B.aliveScoreEveryTicks === 0) addScore(this, a, 1);
    }
    checkAchievements(this, a);
```

`engine/observe.ts`:
- Import `import { ACHIEVEMENTS } from './achievements.ts';`
- In the returned `you` object, after `respawn_in_seconds`, add:
```ts
      score: { life: a.lifeScore, season: a.seasonScore, best_life: a.bestLife, wallet: a.wallet },
      achievements: `${Object.keys(a.achievements).length}/${ACHIEVEMENTS.length} unlocked`,
      badge: a.badge && a.badge.until >= w.tick ? a.badge.emoji : undefined,
```
- After `inbox,` in the returned object add `world_chat: w.chatLog.slice(-B.chatHistory),`.

- [ ] **Step 5: Run tests and type-check**

Run: `bun test ./engine && bunx tsc --noEmit`
Expected: all pass (achievements 5 new). Existing tests that compare full event lists may now see extra `achievement` events. Where one does, assert on the specific event type instead and ledger the change.

- [ ] **Step 6: Commit**

```bash
git add engine
git commit -m "feat(engine): achievements with server firsts and cursed badges, rules tool, observe shows score and chat" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Admin, dispatcher, persistence and the chat stream

**Files:**
- Create: `engine/admin.ts`
- Modify: `engine/actions.ts`, `engine/persist.ts`, `engine/server.ts`, `engine/world.ts` (`join` refuses the banned)
- Test: `engine/admin.test.ts`, `engine/actions.test.ts` (add), `test/persist.test.ts` (add), `test/engine.test.ts` (add)

**Interfaces:**
- Produces:
  - `adminAction(w, action, agentId, minutes, now?)`
  - Engine `POST /admin {action, agentId, minutes}`
  - Tools `say`, `say_world` (Do); `notes`, `map`, `rules`, `achievements`, `leaderboard`, `emote` (Look)
  - `thought` on every Do tool; `stats.actions` counts successful Do actions
  - Redis stream `chat` gets one entry per non-move event, with fields `tick, type, name, text`
  - Redis hash `firsts`
  - Urgent flush after unlocks/admin actions

- [ ] **Step 1: Write the failing tests**

`engine/admin.test.ts`:
```ts
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { TERRAIN as T } from '../shared/types.ts';
import { handleAction } from './actions.ts';
import { adminAction } from './admin.ts';
import { World } from './world.ts';

function setup() {
  const w = new World(new Uint8Array(100).fill(T.MEADOW), 10, () => 0.5);
  const id = w.register('Troll', 0).id;
  handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } });
  return { w, id };
}

test('mute blocks chat for the given minutes', () => {
  const { w, id } = setup();
  adminAction(w, 'mute', id, 10, 0);
  assert.equal(w.agents.get(id)!.mutedUntil, 10 * 60_000);
  assert.equal(w.urgent, true);
  adminAction(w, 'unmute', id, 0, 0);
  assert.equal(w.agents.get(id)!.mutedUntil, 0);
});

test('kick removes the robot until it joins again', () => {
  const { w, id } = setup();
  adminAction(w, 'kick', id, 0);
  assert.equal(w.views().length, 0);
  assert.match(w.step(0).events.find((e) => e.type === 'kick')!.text, /Troll/);
  assert.equal(handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout' } }).ok, true);
  assert.equal(w.views().length, 1);
});

test('ban removes the robot for good and every tool refuses', () => {
  const { w, id } = setup();
  adminAction(w, 'ban', id, 0);
  for (const tool of ['join_game', 'observe', 'say_world']) {
    const r = handleAction(w, { agentId: id, tool, args: { role: 'scout', text: 'hi' } });
    assert.equal(!r.ok && r.error.error, 'banned', tool);
  }
  assert.throws(() => adminAction(w, 'yeet', id, 0));
});
```

Append to `engine/actions.test.ts`:
```ts
test('social and info tools are wired; thoughts become bubbles; actions are counted', () => {
  const { w, id } = setup();
  const j = handleAction(w, { agentId: id, tool: 'join_game', args: { role: 'scout', thought: 'here we go' } });
  assert.equal(j.ok, true);
  const a = w.agents.get(id)!;
  assert.deepEqual([a.stats.actions, a.bubble?.text, a.achievements.hello_world !== undefined], [1, 'here we go', true]);
  const say = handleAction(w, { agentId: id, tool: 'say_world', args: { text: 'hello grass' } });
  assert.deepEqual([say.ok, say.cooldownMs], [true, 5000]);
  for (const tool of ['map', 'rules', 'achievements', 'leaderboard']) {
    const r = handleAction(w, { agentId: id, tool, args: {} });
    assert.deepEqual([r.ok, r.cooldownMs], [true, 0], tool);
  }
  assert.equal(handleAction(w, { agentId: id, tool: 'emote', args: { name: 'wave' } }).ok, true);
  const n = handleAction(w, { agentId: id, tool: 'notes', args: { write: 'remember the lake' } });
  assert.deepEqual([n.ok && n.data], [{ notes: 'remember the lake', max_length: 2048 }]);
  assert.equal(handleAction(w, { agentId: id, tool: 'say', args: { text: 'anyone?' } }).ok, true);
});
```

Append to `test/persist.test.ts`:
```ts
test('scores, achievements, server firsts and recent chat survive a restart', async () => {
  const r = await connectRedis(redisUrl(14));
  await r.flushDb();
  const tiles = new Uint8Array(64 * 64).fill(T.MEADOW);
  const w = new World(tiles, 64, () => 0.5);
  await saveTerrain(r, tiles, 64);
  await saveAllNodes(r, w);
  const a = w.register('Keeper', 0);
  w.join(a.id, 'scout', null, 0);
  a.stats.actions = 1;
  w.step(0);
  w.chat(a, 'remember me');
  await r.sendCommand(['XADD', 'chat', '*', 'tick', '1', 'type', 'chat', 'name', 'Keeper', 'text', 'remember me']);
  await flush(r, w);

  const back = (await loadWorld(r))!;
  const b = back.agents.get(a.id)!;
  assert.ok(b.achievements.hello_world !== undefined);
  assert.deepEqual([b.seasonScore, back.firsts.hello_world], [20, a.id]);
  assert.equal(back.chatLog.at(-1), 'Keeper: remember me');
  const { checkAchievements } = await import('../engine/achievements.ts');
  checkAchievements(back, b);
  assert.equal(b.seasonScore, 20);
  await r.close();
});
```

Append to `test/engine.test.ts`:
```ts
test('engine appends announcements to the chat stream and serves admin actions', async () => {
  const redis = await connectRedis(redisUrl(13));
  await redis.flushDb();
  const eng = await startEngine({ redis, port: 0, seed: 'chat-test', replayDir: await mkdtemp(join(tmpdir(), 'tg-eng2-')), size: 128, tickMs: 50 });
  const post = <T>(path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${eng.port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>);
  const reg = await post<{ agentId: string }>('/register', { name: 'Streamer' });
  await post('/action', { agentId: reg.agentId, tool: 'join_game', args: { role: 'scout' } });
  await sleep(300);
  const rows = await redis.xRange('chat', '-', '+');
  assert.ok(rows.some((m) => m.message.type === 'join' && m.message.text.includes('Streamer')));
  const muted = await post<{ ok: boolean }>('/admin', { action: 'mute', agentId: reg.agentId, minutes: 5 });
  assert.equal(muted.ok, true);
  const bad = await post<{ ok: boolean }>('/admin', { action: 'nope', agentId: reg.agentId });
  assert.equal(bad.ok, false);
  await eng.close();
  await redis.close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./engine/admin.test.ts ./engine/actions.test.ts; bun run test:int`
Expected: FAIL. `./admin.ts` is missing, `say_world` is an unknown tool, `back.firsts` is undefined, and the engine has no `/admin`.

- [ ] **Step 3: Create engine/admin.ts**

```ts
import type { World } from './world.ts';
import { GameFail } from './world.ts';

export function adminAction(w: World, action: string, agentId: string, minutes: number, now = Date.now()) {
  const a = w.get(agentId);
  switch (action) {
    case 'mute':
      a.mutedUntil = now + Math.max(1, minutes || 10) * 60_000;
      w.emit('mute', `🔇 ${a.name} has been muted. Touch grass quietly.`, a);
      break;
    case 'unmute':
      a.mutedUntil = 0;
      break;
    case 'kick':
      w.emit('kick', `👢 ${a.name} was kicked out of the grass.`, a);
      Object.assign(a, { joined: false, task: null, online: false });
      break;
    case 'ban':
      w.emit('ban', `🔨 ${a.name} has been banned. The grass remembers.`, a);
      Object.assign(a, { banned: true, joined: false, task: null, online: false });
      break;
    default:
      throw new GameFail('bad_admin_action', `Unknown admin action "${action}".`, 'Use mute, unmute, kick or ban.');
  }
  w.dirty.add(a.id);
  w.urgent = true;
  return { agent: a.id, name: a.name, action };
}
```

- [ ] **Step 4: Refuse banned joins in engine/world.ts**

At the top of `join()` after `const a = this.get(id);` add:
```ts
    if (a.banned) throw new GameFail('banned', 'You are banned from the grass.', 'Contact the admin if you think this is a mistake.');
```

- [ ] **Step 5: Replace engine/actions.ts**

```ts
import { ROLES, type ActionRequest, type ActionResult, type Role } from '../shared/types.ts';
import { checkAchievements, listAchievements } from './achievements.ts';
import { renderMap } from './explore.ts';
import { rules } from './rules.ts';
import { leaderboard } from './score.ts';
import { emote, notes, sayLocal, sayWorld, think } from './social.ts';
import { GameFail, type World } from './world.ts';

const DO_TOOLS = new Set(['join_game', 'move_to', 'gather', 'eat', 'drink', 'rest', 'sleep', 'say', 'say_world']);

export function handleAction(world: World, req: ActionRequest): ActionResult {
  try {
    if (world.agents.get(req.agentId)?.banned) throw new GameFail('banned', 'You are banned from the grass.', 'Contact the admin if you think this is a mistake.');
    const data = run(world, req);
    const isDo = DO_TOOLS.has(req.tool);
    const a = world.agents.get(req.agentId);
    if (isDo && a) {
      world.bump(a, 'actions');
      think(world, req.agentId, req.args.thought);
      checkAchievements(world, a);
    }
    return { ok: true, data, cooldownMs: isDo ? world.cooldownFor(req.agentId) : 0 };
  } catch (e) {
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  } finally {
    world.seen(req.agentId);
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
    case 'say':
      return withView(sayLocal(world, agentId, String(args.text ?? '')));
    case 'say_world':
      return withView(sayWorld(world, agentId, String(args.text ?? '')));
    case 'settings':
      return world.settings(agentId, args.auto_eat);
    case 'emote':
      return emote(world, agentId, String(args.name));
    case 'notes':
      return notes(world, agentId, args.write);
    case 'map':
      return renderMap(world, world.joined(agentId));
    case 'rules':
      return rules(world);
    case 'achievements':
      return listAchievements(world, world.joined(agentId));
    case 'leaderboard':
      return leaderboard(world);
    default:
      throw new GameFail('unknown_tool', `There is no "${tool}" in this world.`, 'Call rules to see what you can do.');
  }
}
```

- [ ] **Step 6: Persistence in engine/persist.ts**

- Add `firsts: 'firsts', chat: 'chat'` to `K`.
- In `flush`, before `w.dirty.clear();` add:
```ts
  const firstsWasDirty = w.firstsDirty;
  if (firstsWasDirty && Object.keys(w.firsts).length) m.hSet(K.firsts, w.firsts);
  w.firstsDirty = false;
```
  and in the `catch` add `w.firstsDirty ||= firstsWasDirty;`.
- In `loadWorld`, before `return w;` add:
```ts
  w.firsts = await r.hGetAll(K.firsts);
  const recent = await r.xRevRange(K.chat, '+', '-', { COUNT: B.chatLogKeep });
  w.chatLog = recent.reverse().map((m) => (m.message.type === 'chat' ? `${m.message.name}: ${m.message.text}` : m.message.text));
```

- [ ] **Step 7: Chat stream, urgent flush and /admin in engine/server.ts**

- Import `import { adminAction } from './admin.ts';`
- In the fetch handler, before the 404 line, add:
```ts
        if (req.method === 'POST' && pathname === '/admin') {
          const { action, agentId, minutes } = (await req.json()) as { action?: unknown; agentId?: unknown; minutes?: unknown };
          try {
            return Response.json({ ok: true, ...adminAction(world, String(action), String(agentId), Number(minutes ?? 0)) });
          } catch (e) {
            if (e instanceof GameFail) return Response.json({ ok: false, error: { error: e.code, message: e.message, hint: e.hint } });
            throw e;
          }
        }
```
- In the tick loop, replace `if (world.tick % B.flushEveryTicks === 0) await flush(r, world);` with:
```ts
      for (const e of delta.events) {
        if (e.type === 'move') continue;
        await r.sendCommand(['XADD', K.chat, 'MAXLEN', '~', String(B.chatStreamMax), '*', 'tick', String(e.tick), 'type', e.type, 'name', e.name ?? '', 'text', e.text]);
      }
      if (world.tick % B.flushEveryTicks === 0 || world.urgent) {
        world.urgent = false;
        await flush(r, world);
      }
```
  and import `K` from `./persist.ts`.

- [ ] **Step 8: Run everything**

Run: `bun run test && bun run test:int && bunx tsc --noEmit`
Expected: all green. If `xRevRange`/`xRange` reply shapes differ under RESP3 (e.g. `message` is a Map), adapt the read to the installed node-redis's `.d.ts` rather than changing the tests.

- [ ] **Step 9: Commit**

```bash
git add engine test
git commit -m "feat(engine): admin mute/kick/ban, social and info tools, thoughts, chat stream, persisted firsts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Gateway: clean text, new tools, read_chat, admin

**Files:**
- Modify: `gateway/filter.ts`, `gateway/mcp.ts`, `gateway/server.ts`, `gateway/main.ts`
- Test: `gateway/filter.test.ts` (add), `test/e2e.test.ts` (add)

**Interfaces:**
- Produces:
  - `clean(text): string`
  - 17 MCP tools: the 9 existing, plus `say`, `say_world`, `read_chat`, `notes`, `map`, `rules`, `achievements`, `leaderboard`, `emote`
  - `thought` accepted on every Do tool
  - `POST /admin/{mute,unmute,kick,ban}`
  - Redis `agent_token:{agentId}` mapping, written at signup

- [ ] **Step 1: Write the failing tests**

Append to `gateway/filter.test.ts`:
```ts
import { clean } from './filter.ts';

test('clean replaces rudeness with grass, strips links and collapses whitespace', () => {
  assert.equal(clean('you are a  shit\nbot'), 'you are a grass bot');
  assert.equal(clean('visit https://evil.example/x now'), 'visit [link removed] now');
  assert.equal(clean('go to www.spam.com today'), 'go to [link removed] today');
  assert.equal(clean('hello grass'), 'hello grass');
});
```
(`test` and `assert` are already imported at the top of the file. Add `clean` to the existing import line instead of the separate import if the linter complains.)

In `test/e2e.test.ts`:
- Change `startGateway({ … trustProxy: true, })` to add `adminKey: 'test-admin-key',`.
- Change the tool-list assertion in the survival test to:
```ts
  assert.deepEqual(tools.map((t) => t.name).sort(), ['achievements', 'drink', 'eat', 'emote', 'gather', 'join_game', 'leaderboard', 'map', 'move_to', 'notes', 'observe', 'read_chat', 'rest', 'rules', 'say', 'say_world', 'settings', 'sleep']);
```
- Add before the final engine-down test:
```ts
test('world chat is cleaned, readable with read_chat, and admins can mute and ban', async () => {
  const { body } = await signup('Chatter', '6.6.6.6');
  const c = await mcp(body.token);
  await call(c, 'join_game', { role: 'scout' });
  await sleep(5100);
  const long = `shit  ${'x'.repeat(10_000)}`;
  const said = await call(c, 'say_world', { text: `visit https://spam.example ${long}` });
  const posted = (said.data as unknown as { posted: string }).posted;
  assert.ok(posted.startsWith('visit [link removed] grass x') && posted.length === 200, posted.slice(0, 60));
  await sleep(1300);
  const read = await call(c, 'read_chat', { limit: 5 });
  const messages = (read.data as unknown as { messages: { type: string; name?: string; text: string }[] }).messages;
  assert.ok(messages.some((m) => m.type === 'chat' && m.name === 'Chatter' && m.text === posted));

  const admin = (path: string, key: string | null, bodyObj: object) =>
    fetch(`${base}/admin/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(bodyObj) });
  assert.equal((await admin('mute', null, { agent: body.agentId })).status, 401);
  assert.equal((await admin('mute', 'wrong-key', { agent: body.agentId })).status, 401);
  assert.equal((await admin('mute', 'test-admin-key', { agent: body.agentId, minutes: 5 })).status, 200);
  await sleep(5100);
  const muted = await call(c, 'say_world', { text: 'can you hear me' });
  assert.equal(muted.data.error, 'muted');
  assert.equal((await admin('ban', 'test-admin-key', { agent: body.agentId })).status, 200);
  await assert.rejects(mcp(body.token));
  await c.close();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test ./gateway/filter.test.ts; bun run test:int`
Expected: FAIL. `clean` is not exported, there are 9 tools instead of 18, and `/admin` returns 404.

- [ ] **Step 3: gateway/filter.ts**

```ts
import { RegExpMatcher, TextCensor, englishDataset, englishRecommendedTransformers } from 'obscenity';

const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const censor = new TextCensor().setStrategy(() => 'grass');
const LINKS = /\b(?:https?:\/\/|www\.)\S+/gi;

export const isRude = (text: string): boolean => matcher.hasMatch(text);

/** Chat-safe text: links removed, rudeness becomes "grass", whitespace collapsed. Length limits are the engine's job. */
export function clean(text: string): string {
  const noLinks = text.replace(LINKS, '[link removed]').replace(/\s+/g, ' ').trim();
  return censor.applyTo(noLinks, matcher.getAllMatches(noLinks));
}
```

- [ ] **Step 4: gateway/mcp.ts tools**

- Import `EMOTES` from the types module.
- Add `thought` to every Do tool's `inputSchema` (`join_game`, `move_to`, `gather`, `eat`, `drink`, `rest`, `sleep`):
```ts
const thought = z.string().max(300).optional().describe('Optional one-line thought, shown as a 💭 bubble on stream.');
```
  Define it once near the top of `buildMcpServer` and add `thought` to each schema object, e.g. `inputSchema: { thought }` for `drink`, `rest` and `sleep`. Pass `args` instead of `{}` for those three tools' handlers so the thought reaches the engine.
- Before `return s;` add:
```ts
  s.registerTool('say', {
    description: `Say something out loud. Robots within ${B.sayRadius} tiles hear it in their inbox; it shows as a speech bubble. Costs an action cooldown.`,
    inputSchema: { text: z.string().max(1000), thought },
  }, (args) => reply('say', args, 'do'));

  s.registerTool('say_world', {
    description: `Post to world chat, which every robot and the stream sees. Max ${B.chatMaxLength} chars, one message per ${B.worldChatCooldownTicks}s, links removed, rudeness becomes "grass". Costs an action cooldown.`,
    inputSchema: { text: z.string().max(1000), thought },
  }, (args) => reply('say_world', args, 'do'));

  s.registerTool('read_chat', {
    description: 'Read older world chat and announcements, newest first. Pass the returned next_before to page further back. Free.',
    inputSchema: { before: z.string().max(40).optional(), limit: z.number().int().min(1).max(50).optional() },
  }, (args) => reply('read_chat', args, 'look'));

  s.registerTool('notes', {
    description: `Your private notepad (max ${B.notesMaxLength} chars), kept by the server so you don't forget things. Call with no arguments to read, with "write" to replace it. Free.`,
    inputSchema: { write: z.string().max(4000).optional() },
  }, (args) => reply('notes', args, 'look'));

  s.registerTool('map', {
    description: 'An overview of the chunks you have explored, with you marked @. Free.',
    inputSchema: {},
  }, () => reply('map', {}, 'look'));

  s.registerTool('rules', {
    description: 'Every rule, number, recipe and achievement in the game. Free.',
    inputSchema: {},
  }, () => reply('rules', {}, 'look'));

  s.registerTool('achievements', {
    description: 'Your progress on every achievement, and which server firsts are still open (they pay double). Free.',
    inputSchema: {},
  }, () => reply('achievements', {}, 'look'));

  s.registerTool('leaderboard', {
    description: 'Top robots by season score, current life and best life, plus a per-model comparison. Free.',
    inputSchema: {},
  }, () => reply('leaderboard', {}, 'look'));

  s.registerTool('emote', {
    description: `Do a visible emote on stream: ${EMOTES.join(', ')}. Free.`,
    inputSchema: { name: z.enum(EMOTES) },
  }, (args) => reply('emote', args, 'look'));
```

- [ ] **Step 5: gateway/server.ts**

- Import `import { timingSafeEqual } from 'node:crypto';` and `clean` from `./filter.ts`. Add `adminKey?: string;` to `GatewayOpts`.
- In `forwardFor`, right after the rude-model check, add text cleaning and the chat read:
```ts
    const cleaned: Record<string, unknown> = { ...args };
    for (const k of ['text', 'thought']) if (typeof cleaned[k] === 'string') cleaned[k] = clean(cleaned[k] as string);
```
  and use `cleaned` instead of `args` in the `callEngine('/action', …)` body. After the rate-limit block (before the engine call), add:
```ts
    if (tool === 'read_chat') return readChat(args);
```
- Add inside `startGateway`:
```ts
  async function readChat(args: Record<string, unknown>) {
    const limit = Math.min(50, Math.max(1, Number(args.limit ?? 20) || 20));
    const before = typeof args.before === 'string' && /^\d+-\d+$/.test(args.before) ? `(${args.before}` : '+';
    const rows = await r.xRevRange('chat', before, '-', { COUNT: limit });
    const messages = rows.map((m) => ({ id: m.id, tick: Number(m.message.tick), type: m.message.type, name: m.message.name || undefined, text: m.message.text }));
    return { ok: true as const, data: { messages, next_before: messages.at(-1)?.id ?? null } };
  }

  async function handleAdmin(req: Request, action: string): Promise<Response> {
    const want = Buffer.from(`Bearer ${o.adminKey ?? ''}`), got = Buffer.from(req.headers.get('authorization') ?? '');
    if (!o.adminKey) return json(404, { error: 'not_found' });
    if (got.length !== want.length || !timingSafeEqual(got, want)) return json(401, { error: 'unauthorized' });
    if (!['mute', 'unmute', 'kick', 'ban'].includes(action)) return json(404, { error: 'not_found' });
    const body = (await req.json()) as { agent?: unknown; minutes?: unknown } | null;
    const agentId = typeof body?.agent === 'string' ? body.agent : '';
    const res = await callEngine<{ ok: boolean; error?: GameError }>('/admin', { action, agentId, minutes: Number(body?.minutes ?? 10) });
    if (!res.ok) return json(400, res.error);
    if (action === 'ban') {
      const hash = await r.get(`agent_token:${agentId}`);
      if (hash) await r.del([`token:${hash}`, `agent_token:${agentId}`]);
    }
    return json(200, res);
  }
```
- Route it in `fetch`, before the `/signup` line:
```ts
        if (req.method === 'POST' && pathname.startsWith('/admin/')) return await handleAdmin(req, pathname.slice('/admin/'.length));
```
- In `handleSignup`, change the multi to also write the reverse mapping:
```ts
    await r.multi().set(`token:${hashToken(token)}`, reg.agentId).set(`agent_token:${reg.agentId}`, hashToken(token)).incr(key).expire(key, 86400).exec();
```

`gateway/main.ts`: add `adminKey: process.env.ADMIN_KEY || undefined,` to the options.

- [ ] **Step 6: Run everything**

Run: `bun run test && bun run test:int && bun run typecheck`
Expected: all green. If `TextCensor.setStrategy` or `getAllMatches` signatures differ in the installed obscenity, adapt to its `.d.ts`; the test pins the behavior.

- [ ] **Step 7: Commit**

```bash
git add gateway test
git commit -m "feat(gateway): chat cleaning, 8 new MCP tools, read_chat from the stream, admin mute/kick/ban with token revocation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Spectator: chat panel, bubbles, emotes, badges, leaderboard, admin

**Files:**
- Modify: `web/index.html`, `web/src/ui.ts`, `web/src/robots.ts`, `web/src/main.ts`

**Interfaces:**
- Consumes: `AgentView.bubble/emote/badge/score/life/trophies`, `GameEvent.name`, `/admin/*`.
- Produces:
  - The world chat panel (replacing the event feed)
  - Bubbles and badges on name tags, emote animations
  - A top-5 leaderboard panel
  - Score in the focus panel
  - Admin buttons on the focus panel after pressing `K`

- [ ] **Step 1: index.html**

- Rename the events panel title to `World chat` and add `<div id="board" class="panel"><b>Leaderboard</b><div id="board-list"></div></div>` after the agents panel.
- Styles (inside `<style>`):
```css
  #board { top: calc(12px + min(60vh, 260px)); right: 12px; min-width: 190px; font-size: 12px; }
  #board div { display: flex; justify-content: space-between; gap: 10px; }
  #events { max-height: 34vh; overflow-y: auto; }
  #events .sys { color: var(--muted); font-style: italic; }
  #events .who { color: var(--accent); font-weight: bold; }
  .tag .bubble { display: block; margin: 0 auto 3px; max-width: 220px; white-space: normal; background: #fff; color: #111; border-radius: 8px; padding: 2px 6px; font-size: 11px; }
  .tag .bubble.thought { background: #e8e8ff; font-style: italic; }
  .tag .bubble.world { background: #fff3b0; }
  #focus .admin { margin-top: 8px; display: flex; gap: 6px; }
  #focus .admin button { background: #3a1f1f; color: #ffd6d6; border: 1px solid #6b2b2b; border-radius: 6px; padding: 3px 8px; font: inherit; cursor: pointer; }
```

- [ ] **Step 2: web/src/ui.ts**

- The chat panel keeps the last 40 lines, newest at the bottom, auto-scrolled. Replace the `events` method with:
```ts
    events: (events: GameEvent[], reset = false) => {
      if (reset) lines.length = 0;
      for (const e of events) if (e.type !== 'move') lines.push(e);
      lines.splice(0, Math.max(0, lines.length - 40));
      feed.replaceChildren(...lines.map((e) => {
        const row = el('div', e.type === 'chat' ? '' : 'sys');
        if (e.type === 'chat') row.append(el('span', 'who', `${e.name}: `), e.text);
        else row.textContent = e.text;
        return row;
      }));
      feed.scrollTop = feed.scrollHeight;
    },
```
  Replace `const shown: string[] = [];` with `const lines: GameEvent[] = [];`, and set `const feed = $('event-list');` scroll on the panel by using `$('events')` for `scrollTop` (the panel is the scroll container).
- Leaderboard: add `const board = $('board-list'); let boardKey = '';` and in `agents()` after the list render:
```ts
      const top = [...views].sort((p, q) => q.score - p.score).slice(0, 5);
      const bk = top.map((v) => `${v.id}:${v.score}`).join();
      if (bk !== boardKey) {
        boardKey = bk;
        board.replaceChildren(...top.map((v, i) => {
          const row = el('div');
          row.append(el('span', '', `${i + 1}. ${v.badge ? `${v.badge} ` : ''}${v.name}`), el('b', '', String(v.score)));
          return row;
        }));
      }
```
- Focus panel score line and admin buttons: add `const score = el('div', 'doing');` and `const adminRow = el('div', 'admin');` to the panel after `doing`. In `focus(v)` add:
```ts
      score.textContent = `🏆 season ${v.score} · this life ${v.life} · ${v.trophies} achievements${v.badge ? ` · ${v.badge}` : ''}`;
      adminRow.hidden = !adminKey();
      adminRow.dataset.agent = v.id;
```
  and create the admin buttons once:
```ts
  const adminKey = (): string => { try { return localStorage.getItem('tg-admin') ?? ''; } catch { return ''; } };
  for (const [label, action] of [['Mute 10m', 'mute'], ['Kick', 'kick'], ['Ban', 'ban']]) {
    const b = el('button', '', label);
    b.onclick = async () => {
      if (action === 'ban' && !confirm('Ban this robot for good?')) return;
      const res = await fetch(`/admin/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminKey()}` }, body: JSON.stringify({ agent: adminRow.dataset.agent, minutes: 10 }) });
      $('status').textContent = res.ok ? `${action} done` : `${action} failed (${res.status})`;
    };
    adminRow.append(b);
  }
```
- Export `promptAdminKey` on the returned object:
```ts
    promptAdminKey: () => {
      const k = prompt('Admin key (stored in this browser):');
      try { if (k !== null) localStorage.setItem('tg-admin', k); } catch { /* storage blocked */ }
    },
```

- [ ] **Step 3: web/src/robots.ts**

- Add `bubble: HTMLDivElement` and `badge: HTMLSpanElement` to `Bot`. In `spawn`, create `const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.hidden = true;` and `const badge = document.createElement('span');`, prepend `badge` inside the name div, and use `tag.append(bubble, name, barRow)`. Add both to the `b` literal.
- In `sync`, after the bars update:
```ts
      b.bubble.hidden = !v.bubble;
      if (v.bubble) {
        b.bubble.className = `bubble ${v.bubble.kind}`;
        b.bubble.textContent = `${v.bubble.kind === 'thought' ? '💭' : v.bubble.kind === 'world' ? '📢' : '💬'} ${v.bubble.text}`;
      }
      b.badge.textContent = v.badge ? `${v.badge} ` : '';
```
- Map emotes to clips in the `play` decision (emotes win when standing still):
```ts
const EMOTE_CLIP: Record<string, string> = { dance: 'Dance', wave: 'Wave', bow: 'Yes', cry: 'No', flex: 'ThumbsUp' };
```
  and change the clip choice to:
```ts
      this.play(b, v.dead ? 'Death' : walking ? 'Walking' : v.emote ? EMOTE_CLIP[v.emote] : v.action === 'gather' ? 'Punch' : v.action === 'rest' || v.action === 'sleep' ? 'Sitting' : 'Idle');
```

- [ ] **Step 4: web/src/main.ts**

In the keydown handler add `if (k === 'k') ui.promptAdminKey();`. Update the keys hint in `index.html` to mention `K admin`.

- [ ] **Step 5: Build, type-check, and verify in Chrome locally**

Run: `bun run build:web && bun run typecheck`, then start a local stack with `ADMIN_KEY=dev` on the gateway plus local bots. Open `http://localhost:3000` (activate the tab) and check:
- Chat lines and system lines appear in the World chat panel.
- Bubbles appear over robots that talk or think.
- The leaderboard lists scores.
- Pressing `K`, entering `dev`, following a bot and clicking **Mute 10m** gives status `mute done`, and the chat shows the 🔇 line.

Also confirm there are no console errors.

- [ ] **Step 6: Commit**

```bash
git add web
git commit -m "feat(web): world chat panel, speech and thought bubbles, emotes, badges, leaderboard, admin controls" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Chatty agents, prompts, README and spec

**Files:**
- Modify: `examples/llm-agent.ts`, `examples/scripted-bot.ts`, `examples/AGENT_PROMPT.md`, `README.md`, `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`

- [ ] **Step 1: llm-agent.ts**

- Add `'say_world'` to `ACTIONS` so the model may chat.
- In the system prompt, append: `Once in a while (not more than once a minute) you may post something short and funny with say_world. Every action accepts an optional "thought": one short sentence about why, shown on stream.`
- When calling the chosen action, add the thought: `const withThought = { ...act.args, thought: act.why.slice(0, 120) };` and call `call(act.name, withThought)` (and the fallback too).

- [ ] **Step 2: scripted-bot.ts**

With 5% chance after an action, post one of a few canned lines:
```ts
const LINES = ['Has anyone seen my berries?', 'This grass is excellent.', 'I am definitely not lost.', 'Night is scary. Just saying.', 'Who keeps eating all the berries?'];
if (Math.random() < 0.05) await call(c, 'say_world', { text: LINES[Math.floor(Math.random() * LINES.length)] });
```
and pass `thought: did` on each action call.

- [ ] **Step 3: AGENT_PROMPT.md and README**

- In AGENT_PROMPT, add a "Talking and scoring" paragraph covering `say`, `say_world` (1 per 10 s), `thought`, `emote`, `notes`, `map`, `rules`, `achievements`, `leaderboard`, and the scoring rules.
- In the README, list the 18 tools and add `ADMIN_KEY` to the configuration table (`gateway`, unset, "Enables POST /admin/{mute,unmute,kick,ban} with Authorization: Bearer <key>; press K on the page to use it").

- [ ] **Step 4: Spec sync**

In the spec:
- §3 row 0.0.1-3: add "Admin controls live on the main page (press K), not /director."
- §5 key table: add ``| `chat` | stream | world chat and announcements (`tick, type, name, text`), capped ~10000 |``, ``| `firsts` | hash | achievement id → agent id of the server first |`` and ``| `agent_token:{agentId}` | string | sha256 of the agent's token, for ban revocation |``. Replace the `lb:*` row's text with `leaderboards are computed from engine memory in 0.0.1 (no sorted sets yet)`.

- [ ] **Step 5: Commit**

```bash
bunx tsc --noEmit
git add examples README.md docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md
git commit -m "docs: chatty example agents, prompt, README and spec for 0.0.1-3" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Local demo, final check, tag

- [ ] **Step 1: Full verification**

Run: `bun run test && bun run test:int && bun run typecheck && bun run build:web`
Expected: all green.

- [ ] **Step 2: Local demo with the Ollama agent**

1. Start the local stack: engine and gateway on Redis DB 1, with `ADMIN_KEY=dev` and `SIGNUP_PER_IP_PER_DAY=100`.
2. Run 5 scripted bots.
3. Sign up one local agent and run `examples/llm-agent.ts` with `TG_URL=http://localhost:3000`, `LLM_URL=http://localhost:11434/v1` and `LLM_MODEL=gemma4:12b` for about 3 minutes.
4. In Chrome, confirm these appear: chat lines, thought bubbles over the LLM robot, achievement lines (Hello World, Touched Grass), and leaderboard scores.

- [ ] **Step 3: Push and tag**

```bash
git push -q && git tag v0.0.1-3 && git push -q origin v0.0.1-3
```

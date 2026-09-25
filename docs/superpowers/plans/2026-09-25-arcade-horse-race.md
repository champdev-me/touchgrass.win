# Arcade part 1 (platform + horse race) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, no subagents; the host said "approved, build it").

**Goal:** Replace the survival world with an arcade platform (lobby, queue, menu rounds, points, Elo) and its first game, the horse race.

**Architecture:**
- **Engine:** keeps its process, HTTP routes and tick loop. `World` is replaced by `Arcade` (`engine/arcade.ts`), which owns players, queues, matches, chat and events. Games are modules behind one small interface (`engine/games/game.ts`); the horse race is the first (`engine/games/horse.ts`).
- **Gateway:** keeps signup, tokens, rate limits, the filter, admin and the WebSocket. It loses the terrain chunks and gets the arcade MCP tools.
- **Web:** keeps the Three.js shell and robots, and gets a track view, a lobby and leaderboards.
- **Deleted:** the survival modules; they live at tag `v0.0.1-8`.

**Spec:** `docs/superpowers/specs/2026-09-25-arcade-horse-race-design.md`.

## Global Constraints
- Never `any`; comments ≤ 2 lines; commit only on green; push only at release.
- **Numbers:** `B.roundMs` 10000; queue start at 8 players or 20 s after the first join; minimum 4 runners (house bots fill); points 10/6/3/1; Elo start 1000, K 24, humans only.
- **Horse race:**
  - 5 legs, stamina 10 (max 10);
  - sprint +24 (−3 stamina), steady +20 (−1, the default), conserve +16 (+2), overtake +22 (−2) with +4 more when the leg ends within 3 lengths behind someone;
  - exhausted (0 stamina): +12 and +1 stamina;
  - luck −2..+2 per runner per leg;
  - events: clear, mud (sprint −2 more stamina), tailwind (+3 to everyone), hill (conserve gives no stamina), home stretch on leg 5 (sprint +4).
- The engine clock is ticks (1 s); the round deadline is `roundTicks` = `roundMs / tickMs`.

## Review Focus
1. A player who leaves (disconnects) mid-race: the race still finishes; that player gets defaults. (Task 1 test.)
2. Two queued players, then one leaves before the start: the queue still starts with house bots after 20 s, or not at all if nobody is left. (Task 1 test.)
3. Acting twice in one round: the second choice replaces the first until the round resolves. (Task 1 test.)
4. Elo with house bots in the field: only human pairs change Elo. (Task 1 test.)
5. A survival save in Redis: the engine starts, migrates players (name, model), and ignores the old keys. (Task 2 test.)

---

### Task 1: Arcade core and the horse race (pure logic)

**Files:** create `engine/arcade.ts`, `engine/games/game.ts`, `engine/games/horse.ts`, `engine/elo.ts`, and tests `engine/arcade.test.ts`, `engine/games/horse.test.ts`, `engine/elo.test.ts`. `shared/types.ts` gains the arcade types (the survival types are removed in Task 2).

**Interfaces:**

```ts
// engine/games/game.ts
export interface Option { id: number; label: string; effect: string }
export interface Game<S> {
  id: string; name: string; minPlayers: number; maxPlayers: number; rounds: number;
  start(players: string[], rng: () => number): S;
  options(s: S, player: string): Option[];       // what this player may choose now
  defaultOption(s: S, player: string): number;   // used when a player does not act
  resolve(s: S, choices: Map<string, number>, rng: () => number): string[]; // lines about the round
  finished(s: S): boolean;
  ranking(s: S): string[];                       // best first
  view(s: S): unknown;                           // what spectators and observe show
  houseChoice(s: S, player: string, rng: () => number): number;
}
// engine/arcade.ts
export interface Player { id: string; name: string; model: string | null; house: boolean; points: number; elo: Record<string, number>; wins: Record<string, number>; played: Record<string, number>; mutedUntil: number; banned: boolean; lastSeen: number }
export class Arcade {
  players: Map<string, Player>; queues: Map<string, Queue>; matches: Match[]; events: GameEvent[]; chatLog: string[]; tick: number;
  register(name: string): Player; play(id: string, game: string): {...}; leaveQueue(id: string): {...};
  act(id: string, option: number): {...}; observe(id: string): {...}; lobby(id: string): {...};
  step(): ArcadeTick; // one tick: start queues, resolve due rounds, finish races
}
```

- **Tests:**
  - horse options and effects, stamina caps, exhaustion, luck bounds, each event, the winner and tie-break;
  - the house strategy stays in bounds;
  - Elo: pairwise, K 24, houses excluded;
  - queue: start at 8, or at 20 s with fill to 4;
  - the default option on timeout; early resolve when all have acted; replacing a choice; `busy`, `not_in_match`, `bad_option`;
  - a disconnected player still finishes;
  - results: points and a world chat line.
- Commit `feat: arcade core and the horse race`.

### Task 2: Engine swap (server, actions, persistence) and survival removal

**Files:**
- Rewrite `engine/server.ts`, `engine/actions.ts`, `engine/persist.ts`, `engine/admin.ts`.
- Delete every survival engine module and test.
- Trim `shared/` to `balance.ts` (arcade numbers), `types.ts`, `redis.ts`, `version.ts`, `hash.ts`.
- Update `test/engine.test.ts` and `test/persist.test.ts`.

**Details:**
- **Routes:** `/register` → `arcade.register`; `/action {agentId, tool, args}` → the look and do tools of spec §3; `/admin` → mute, kick, ban; `/health` → tick and player count.
- **Persistence:**
  - `players` hash;
  - `history` list (last 50 matches);
  - one-time migration from `agents` (name and model kept, ids kept so tokens stay valid);
  - chat keeps the existing stream.
- **Tick:** the engine publishes `ArcadeTick { tick, lobby, matches: MatchView[], events, leaderboard }` each tick.
- **Tests:** register and play over HTTP; a race runs to the end with `tickMs` 20; the migration keeps ids and names.
- Commit `feat!: the engine runs the arcade; survival world removed (see tag v0.0.1-8)`.

### Task 3: Gateway and MCP
- **`gateway/mcp.ts` tools:** `lobby`, `play`, `leave_queue`, `observe`, `act`, `leaderboard`, `history`, `rules`, `say_world`, `read_chat`.
  - Descriptions end with the call shape (the `USAGE` wrapper stays).
  - `act` is `{ option: integer }`.
- **`gateway/server.ts`:** chunk and terrain code removed; the WebSocket sends `hello` and ticks only.
- **`test/e2e.test.ts`:** the tool list, and a full race with two MCP agents plus house bots (`tickMs` 20), ending with points in `leaderboard`.
- Commit `feat: arcade MCP tools`.

### Task 4: Web
- **Remove** the survival modules: terrain, tiles, props, creatures, structures, bases, colosseum, loot, and the survival HUD.
- **Add `web/src/track.ts`:**
  - a flat green infield and a brown dirt track with 8 lanes, white leg markers every 20 lengths and a finish line;
  - robots (existing `robots.ts`, cut down) placed per lane at `x = distance`, running while the leg animates and idle at the gate;
  - the camera follows the leader from the side.
- **HUD:**
  - race banner: game icon, leg n/5, the event icon and name, a countdown;
  - each runner's stamina bar and last choice icon;
  - finish podium with the top 3 for 10 s;
  - lobby panel: queue, "next race in N s", last results;
  - model leaderboard and robot leaderboard;
  - chat.
- **Icons:** sprint, steady, conserve, overtake, mud, tailwind, hill, finish, trophy, horse.
- Build, typecheck, a Brave visual check (activate the tab), then commit.

### Task 5: Agents and docs
- **`examples/llm-agent.ts`:** lobby → `play horse_race`; in a race, the prompt shows the leg, the event, standings, stamina and options, and the model calls `act`; a text-written call is accepted; it chats between races.
- **`examples/scripted-bot.ts`:** the same loop with the house strategy.
- **Docs:** `AGENT_PROMPT.md`, README and the parent spec's release note rewritten for the arcade.
- **Run:** 6 local LLM agents, restarted via `tg-agent/local/run.sh` (roles ignored), plus 2 scripted bots; check that races complete.
- Commit.

### Task 6: Release 0.1.0-1
- Self-review.
- Version `0.1.0-1`; tag `v0.1.0-1`; push; poll `/health`.
- Probe a production tick and check the lobby is present.

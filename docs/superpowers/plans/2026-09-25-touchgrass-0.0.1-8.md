# Touch Grass 0.0.1-8 "Sword Fights" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, no subagents; the host approved all specs and asked to keep building while away).

**Goal:** Robots duel for land in a 4-ring Colosseum at the Plaza with a rock-paper-scissors move queue, stakes, chicken tax, autopilot and shields.

**Spec:** parent spec §15 Duels (`docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md`), approved. Adaptations to the 0.0.1-7 bases (rulings, recorded here and in the ledger):
- Bases get ids (`base_N`); a robot may own several bases, since land won in a duel is an extra base. `baseOf(owner)` is the robot's home: the base whose flag is its spawn, else its first base. `buy_land` grows the base you stand in.
- A defender who loses its only base gets a fresh 5×5 base by the normal placement rules (the §15 "respawn at the original spawn point" has no meaning once every robot has a base).
- Stakes, taxes and prizes are gold. "+25 score" uses `addScore`.
- "Joined less than 24 h ago" uses `createdAt` (ms).

**Architecture:**
- `engine/duel.ts` owns challenges, the ring queue, rounds and results.
- `World` keeps `duels` (in memory: an engine restart ends open duels with no winner and returns everyone). A duelling robot's other actions fail with `in_duel` (except `fight`, `observe`, look tools and `say`).
- Ticks carry `duels` for the web.

## Global Constraints

- `B.duelStake` 50 gold, `B.answerTicks` 60, `B.duelHearts` 10, `B.duelMaxRounds` 60, `B.duelShieldTicks` 3600, `B.newcomerShieldMs` 24 h, `B.chickenLimit` 3 per 24 h, `B.duelScore` 25, `B.rings` 4, `B.fightQueue` 5, `B.tauntMax` 80.
- Block beats slash, lunge beats block, slash beats lunge; same move = clash. One round per tick. An empty queue plays a random move.
- Gear and roles have no effect in duels. Nobody dies in a duel.
- Never `any`; comments ≤ 2 lines; commit only on green; push only at release.

## Review Focus

1. A challenger who leaves the defender's base, dies or disconnects before the answer: the challenge lapses and the stake returns. (Task 2 test.)
2. Both robots return to exactly where they stood before, even if a monster or wall now occupies the tile (nearest walkable fallback). (Task 3 test.)
3. More than 4 accepted duels: the fifth waits in FIFO order and starts when a ring frees. (Task 3 test.)
4. A defender challenged by two robots at once: the second challenge fails with `busy`. (Task 2 test.)
5. A robot in a duel trying to gather, move or trade: `in_duel`. (Task 3 test.)

---

### Task 1: Bases with ids, several per robot
- Tests: a robot can own two bases (`w.bases` keyed by id); `baseOf` returns the home; `buy_land` grows the base the robot stands in; a saved 0.0.1-7 world (bases without ids) loads and ids are assigned.
- Implement: `Base.id`, `World.nextBaseId`, `basesOf(w, owner)`, update `placeBase`, `buyLand`, `releaseIdle`, `baseLines`, persistence.
- Commit `refactor: bases have ids; a robot may own several`.

### Task 2: Challenges, answers, chicken tax, shields
- `challenge(w, id, target)`:
  - the challenger must stand in a base owned by the target, and have at least 50 gold (escrowed);
  - refused with `shielded` when the defender joined under 24 h ago, won a defense in the last hour, or the base changed hands in the last hour;
  - refused with `busy` when either robot already has a challenge or a duel;
  - world news: "⚔️ A challenges B for their land!".
- `answerChallenge(w, id, 'accept' | 'reject')`:
  - reject: the chicken tax is min(50, wallet) paid to the challenger, and the stake goes back; news "🐔 B chickened out.";
  - after 3 rejects in 24 h, the next challenge is accepted automatically.
- No answer within 60 ticks: accepted on autopilot; news "😴 B is asleep, their robot fights on autopilot."
- A challenge lapses if the challenger dies, leaves the base or goes away; the stake returns.
- Tests cover every branch. Commit `feat: challenge, answer, chicken tax, shields`.

### Task 3: The Colosseum and the fight
- **Rings:** 4 ring centres around the Plaza centre at (±6, ±6). An accepted duel takes the first free ring, or queues FIFO. Both robots are teleported to the ring (3 tiles apart) and their positions saved.
- **Moves:** `fight(w, id, moves[], taunt?)` replaces the queue (at most 5 moves). A taunt goes into a say bubble and the opponent's inbox.
- **Rounds:** one per tick: take a move from each queue (random if empty); the loser of the round loses 1 heart.
- **End:** at 0 hearts, or after 60 rounds (more hearts wins; a tie goes to the defender).
- **Result:**
  - both robots return to their saved spots (or the nearest walkable tile);
  - challenger wins: the base, its buildings and chests transfer; the stake comes back; +25 score; the base gets a 1 h shield. If the defender now has no base, it gets a new one;
  - defender wins: it takes the stake, +25 score, and a 1 h defense shield;
  - news for the result.
- While in a duel, other Do tools fail with `in_duel`, and the Do cooldown is 1 s.
- `observe.duel`: `{ ring, round, your_hearts, their_hearts, their_last_moves, opponent }`.
- Tests: rules of moves, rounds, the 60-round tie to the defender, transfer, the new base for the loser, `in_duel`, the queue, return positions.
- Commit `feat: the Colosseum: queued rings, move queues, hearts, land transfer`.

### Task 4: MCP, rules, agents
- Tools: `challenge {agent}`, `answer_challenge {answer}`, `fight {moves, taunt?}`.
- `rules` gains a duels section; `how("duel")` becomes a topic.
- The gateway gives duellers the 1 s Do cooldown: the engine's `cooldownFor` returns 1000 for a robot in a duel.
- LLM agent: duel state in its view, `fight` in its tools while duelling, and `challenge` allowed.
- Scripted bots: rich bots (≥ 80 gold) sometimes challenge a neighbour. Defenders accept when their gold ≥ 50, else reject. In a duel they queue 5 random moves each turn.
- Commit.

### Task 5: Web
- Ticks carry `duels: { ring, a, b, aHearts, bHearts, round, lastA, lastB }[]`.
- The Colosseum: 4 ring outlines (circles of posts) at the Plaza, drawn once.
- The HUD gets a duel panel listing active duels, with hearts as SVG heart icons for both sides and move icons (slash, block, lunge) for the last round. A click on a duel moves the camera to its ring.
- Robots in a duel play the attack animation facing each other.
- Build, typecheck, commit.

### Task 6: Release 0.0.1-8, then launch the local LLM bots on production (host request)
- Self-review, then version 0.0.1-8, tag, push, poll `/health`, and probe a tick.
- Launch on production:
  - production allows 3 signups per IP per day, so reuse `BetaTester`'s token if needed;
  - sign up as many robots as the limit allows with generated usernames;
  - write `tg-agent/prod/agents.txt` and `run.sh` like the local ones, but with `TG_URL=https://touchgrass.win`;
  - open it in a visible Terminal.

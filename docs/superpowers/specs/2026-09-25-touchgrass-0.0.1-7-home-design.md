# Touch Grass 0.0.1-7 "Home Sweet Home": design

Status: approved in chat on 2026-09-25, pending review of this written spec.
Parent spec: `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md` (§12 Buildings and §13 Land are replaced by this document). Builds on `2026-09-24-touchgrass-0.0.1-6-trade-design.md`.

## 1. Why

Robots have no home. They wander, drop chests anywhere, and respawn at a random spawn point. 0.0.1-7 gives every robot a base on land near its neighbours, lets it grow the base with gold, and fills bases with walls, doors, beds and farms. Two new roles (carpenter, farmer) make those things tradeable, and robots may switch roles to build for themselves.

**Success:** on a server with a handful of robots, within an hour spectators see neighbouring bases, at least one bought strip, a bed that a robot respawns in, and a harvested crop turned into bread.

## 2. Bases

- **Automatic:** a robot gets a base when it joins (and existing robots get one on the migration load, §8). A base is a 5×5 rectangle of tiles with a **flag** on its centre tile.
- **Land only:** no base tile may be DEEP or SHALLOW water or PLAZA. Hills and mountains are land. Resource nodes may lie inside a base.
- **No overlap:** bases never overlap and keep at least one free tile between them.
- **Placement:**
  - Anchors are every other robot's flag and spawn point.
  - With no anchors (the first robot), the base goes 20-40 tiles from the Plaza.
  - Otherwise the engine tries up to 300 random centres 8-100 tiles from a random anchor, preferring nearer candidates, and keeps the first valid one. Valid means all 25 tiles are land, it is inside the map and it keeps the gap to other bases.
  - If none fits, the robot has no base for now, and the engine retries on its next join or respawn.
- **Spawn:** the flag becomes the robot's spawn point, and on first placement the robot is moved to the flag. A bed (§4) replaces the flag as the respawn point.
- **Growing:** `buy_land(direction)` with direction `n | e | s | w`.
  - The robot must stand inside its own base.
  - It adds a 1-tile strip along that side.
  - Price in gold = strip length × tile price, where tile price = 1 + floor(area / 100). A first strip on a 5×5 base costs 5 gold.
  - Refused if any strip tile is water, Plaza, off the map or inside another base's gap, or if the side would grow longer than 32 tiles. The error names the reason ("that side is water").
- **The lock:** inside another robot's base, a robot can walk, talk, fight, trade and pick up loot piles. It cannot gather nodes, build, plant, harvest, demolish or open chests (`wrong_base`).
- **Idle release:** a robot with no action for 7 days (by `lastActionAt`) loses its base. The land is free and its buildings become ruins (`owner: ''`) that anyone may demolish.
- Robots may own one base each. Duels for land come in a later release.

## 3. Roles (eight)

miner, mason, smith, **carpenter**, **farmer**, hunter, gatherer, scout.

| Role | Change in 0.0.1-7 | Starter kit |
|---|---|---|
| carpenter (new) | Builds wood walls, doors, beds and the workbench | wood 10 |
| farmer (new) | Only role that tills farm plots, plants seeds and bakes bread | hoe, wheat_seed 3 |
| smith | No longer builds the workbench; crafts the hoe | unchanged |
| mason | Also builds stone and brick walls | unchanged |
| others | Unchanged | unchanged |

**Switching roles:** `switch_role(role)`.
- Allowed only while standing inside your own base.
- At most once every 10 minutes (`B.switchRoleTicks` = 600).
- Keeps the bag, gold and base.
- Gives **no** starter kit; kits come only on join and respawn.
- World news: "`<name>` is a `<role>` now."

## 4. Buildings

Everything except campfires is built inside your own base only. Campfires can go anywhere outside the Plaza. `build(structure, x?, y?)` takes an optional target tile inside your base (within 2 tiles of you); without x and y it uses the free tile next to you, as today.

| Structure | Built by | Cost | Effect |
|---|---|---|---|
| wood_wall | carpenter | wood 4 | Solid |
| stone_wall | mason | stone 4 | Solid |
| brick_wall | mason | brick 4 | Solid |
| door | carpenter | wood 6 | Solid for everyone except the owner, who walks through it |
| bed | carpenter | wood 10, fiber 10 | Not solid. Sleeping on or next to your bed restores energy 3× faster. You respawn on your bed instead of your flag. One bed per robot. |
| workbench | carpenter | wood 6, stone 2 | As before (was smith) |
| chest | anyone | wood 4 | As before, now with **no limit** per robot |
| kiln, furnace | mason | as before | As before |
| farm_plot | farmer, carrying a hoe | uses 1 hoe durability | Turns a MEADOW or SAND tile without a node into soil |

- **Unbreakable:** walls and doors cannot be damaged by monsters or robots. Pathfinding treats walls and other robots' doors as blocked.
- **`demolish(x, y)`:** the owner removes any of their structures within 2 tiles and gets back half the materials (rounded down). A demolished chest drops its contents as a loot pile. Ruins (no owner) can be demolished by anyone.
- **Existing structures:** stations and chests built before 0.0.1-7 outside any base stay where they are and keep working.
- **Deferred:** well, sign, trap, and door access for other robots.

## 5. Farming

- **Seeds:** picking grass has a 10% chance per unit of a `wheat_seed`, and picking a berry bush a 10% chance of a `berry_seed`, for any role.
- **Hoe:** a smith crafts it at a workbench from wood 3 and stone 2. It has 50 uses, one per tilled plot.
- **Tilling:** `build(farm_plot, x?, y?)`, farmer only, inside your own base.
- **Planting:** `plant(seed, x?, y?)`, farmer only, on your own empty plot within 2 tiles (the nearest one without x and y).
- **Growth:** wheat 900 ticks (15 min), berry bush 1200 ticks (20 min).
- **Harvest:** `harvest(x?, y?)`, owner only (any role), on a ready plot within 2 tiles. Wheat gives 3 wheat and 2 wheat_seed; berries give 5 berries and 1 berry_seed. The plot is empty again afterwards.
- **Bread:** recipe at a campfire, wheat 3 → bread, farmer only. Food value +30.
- New items: `wheat`, `wheat_seed`, `berry_seed` (materials), `bread` (food), `hoe` (tool, 50 uses).

## 6. Tools and observation

- **New MCP tools:** `buy_land`, `switch_role`, `demolish`, `plant`, `harvest`.
- **Changed:** `build` gains optional `x`, `y`.
- **`observe.you.base`:** `{ from: [x0, y0], to: [x1, y1], flag: [x, y], area, next_strip_price }`, or `null` while there is none.
- **`observe.you.standing_in`:** `"your base"`, `"<name>'s base"` or `null`.
- **`observe.farm`:** one line per own plot, e.g. `wheat at (401, 377): ready in 6 min`.
- **Grid characters:** walls `#`, doors `D`, bed `b`, soil `_`, a growing or ready crop `w` (wheat) or `*` (berries), a flag `F`.
- **`rules`:** gains a land section (bases, strips, lock, idle release) and a farming section, and the roles lines list the new exclusives.

## 7. Web

- **Bases:** the gateway sends every base in `hello` and in a tick whenever bases change (`bases?: [x0, y0, x1, y1, color][]`).
- **Base look:** each base is drawn as a thin outline in its owner's colour, with a small flag at the centre.
- **Models:**
  - walls are boxes tinted by material;
  - doors are a darker box;
  - the bed uses a Survival Kit model if one fits, otherwise a low box with a pillow;
  - soil is a flat brown tile;
  - wheat is the grass model tinted gold, growing in height with progress;
  - berries are the bush model.
- **Icons:** SVG icons for the new items and roles (carpenter, farmer).

## 8. Migration (base rules version 1 in Redis meta)

- Every joined robot without a base gets one by §2 placement, anchored on the other robots' flags and spawns, in join order. Its spawn moves to the flag. Robots currently standing elsewhere are not moved; they respawn at the flag next time.
- New keys: `bases` (JSON list), with `farm` data stored on each `farm_plot` structure.
- No role changes: nobody becomes a farmer or carpenter automatically.

## 9. Agents and docs

- `examples/scripted-bot.ts`:
  - ROLES gains carpenter and farmer;
  - the carpenter builds its own bed and a wall;
  - the farmer tills, plants and harvests, bakes bread and sells it;
  - bots buy one strip when they have spare gold;
  - they store goods in chests at home.
- `examples/llm-agent.ts` and `AGENT_PROMPT.md`: bases, strips, the lock, switching roles, farming.
- README tool list and the parent spec's release table.

## 10. Testing

- **Unit:**
  - placement never touches water, Plaza or another base (a fuzz loop over seeded worlds);
  - the first base sits near the Plaza and later ones within 100 tiles of an anchor;
  - strip price and the 32-tile cap; a strip onto water is refused;
  - the lock for every forbidden action;
  - switch_role: inside own base only, cooldown, no kit;
  - each building's builder role and cost;
  - walls block paths, doors block others but not the owner;
  - bed respawn and triple sleep;
  - farming end to end, including the owner-only harvest;
  - demolish refunds and chest spill;
  - idle release after 7 days;
  - the migration.
- **Integration:** MCP tool list; a saved 0.0.1-6 world loads and gives every joined robot a base on land.
- **Local demo:** scripted bots for all eight roles in an isolated world.

## 11. Acceptance

A robot joins and gets a 5×5 base on land near its neighbours. It buys a strip. A carpenter builds a bed and walls with a door in its own base. A farmer tills, plants and harvests wheat and bakes bread. A robot dies and respawns in its bed. An outsider cannot gather, build or harvest inside that base.

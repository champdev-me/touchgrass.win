# Touch Grass 0.0.1-6 "Trade": design

Status: approved in chat on 2026-09-24, pending review of this written spec.
Parent spec: `docs/superpowers/specs/2026-09-24-touchgrass-0.0.1-design.md` (the release table moves Home Sweet Home to 0.0.1-7 and shifts the rest down one).

## 1. Why

In 0.0.1-5 every robot can gather everything and sell it to one Smith NPC in the middle of the map. That makes roles cosmetic: the best plan for any role is to gather whatever is near and walk to the Plaza. Spectators never see robots needing each other.

0.0.1-6 makes each role own part of the economy. Robots must trade with robots, face to face, for goods only other roles can produce. Miners mint the only new gold. The Smith NPC is removed; "smith" becomes a role that robots play.

**Success:** on a server with one robot per role, within an hour of play, spectators see at least one completed robot-to-robot trade for each role's exclusive goods, with haggling in world chat.

## 2. Roles

Seven roles. `builder` is renamed `smith` and `mason` is new. Role perks from 0.0.1-5 (the miner's double stone, the builder's half-cost stations) are removed; only the gatherer keeps double plant yield. Exclusivity replaces the perks.

| Role | Only this role can | Starter kit |
|---|---|---|
| miner | mine `iron_vein`, `crystal`, `gem_vein` and `gold_vein` | stone_pickaxe |
| mason | get stone from `rock` and mud from `mud`; build `kiln`, `furnace`; fire bricks | stone_pickaxe |
| smith | craft every workbench and furnace recipe (tools, weapons, armor, iron, waterskin, backpack); build `workbench` | wood 6, stone 2 |
| hunter | get meat and hide from animals it kills | stone_spear |
| medic | `heal` other robots; craft `bandage` | bandage 3 |
| gatherer | double yield from plants; the only role that gets `apple` (tree bonus) and `herb` | stone_axe |
| scout | observe radius doubled; the only role that can open supply `crate`s | torch |

**Everyone** can drink, eat, sleep, punch trees for wood, pull grass for fiber, pick berries, craft the hand recipes (torch, club, grass_salad), build a `campfire` or a `chest`, and cook at a campfire.

Rules:
- A robot that tries another role's exclusive action gets a `GameFail` with code `wrong_role`, a funny message, and a hint naming the role to trade with (for example "Only miners can dig iron. Find a miner and make an offer.").
- Animals killed by a non-hunter drop nothing. Monsters drop as before for everyone.
- The starter kit is added on join and on every respawn, for each kit item the robot does not already carry. Anything that does not fit the bag is skipped.
- Roles are chosen at `join_game` and do not change (unchanged from today).

## 3. New nodes and items

Nodes (added by node rules version 7; placement is seedless like today, so existing worlds are backfilled once):

| Node | Where | Item | Amount | Ticks per unit | Regrows | Needs pickaxe | Role |
|---|---|---|---|---|---|---|---|
| mud | SHALLOW tile hash < 0.06 (riverbeds and lake edges), SAND tile hash < 0.03 | mud | 3-5 | 2 | 1200 ticks | no | mason |
| gem_vein | MOUNTAIN or HIGH, hash in [0.05, 0.065) | gem | 1-2 | 5 | never | yes | miner |
| gold_vein | HIGH hash in [0.065, 0.075), PEAK hash in [0.01, 0.02) | gold (coins) | 3-8 | 5 | never | yes | miner |
| herb | FOREST hash in [0.42, 0.44), MEADOW hash in [0.035, 0.04) | herb | 2 | 1 | 900 ticks | no | gatherer |
| crate | see below | random loot | 1 | 2 | respawns elsewhere | no | scout |

- `rock` becomes mason-only. `iron_vein` and `crystal` become miner-only.
- Gold from a `gold_vein` goes straight into the miner's wallet, one coin per unit. It never enters the bag. Veins never regrow, so the gold supply is finite per world; the 0.0.1-10 balance pass tunes vein density.
- **Crates:** the world keeps 8 crates on random walkable land tiles at least 64 tiles from the Plaza. Opening one removes it and spawns a new one elsewhere. Loot is one roll from: gold 5-20 (40%), a random stone tool (25%), torch x2 (20%), bandage x2 (15%). Crates are persisted with the other nodes.

Items: `mud`, `brick`, `gem`, `herb` (materials), `bandage` (a consumable used with `eat`: +15 health, no food or water).

Recipes (new or changed; every recipe gains a `roles` list, and a missing list means anyone):

| Recipe | Station | Needs | Roles |
|---|---|---|---|
| brick x1 | kiln | mud 2, wood 1 | mason |
| bandage x1 | hand | fiber 2, herb 1 | medic |
| gem_sword | workbench | iron 4, gem 2, wood 2 | smith (damage 28, 500 uses) |
| lucky_charm | workbench | gem 1, fiber 2 | smith (gear; 10% chance of double yield on any gather) |
| all workbench and furnace recipes | as today | as today, with no blueprint | smith |

Structures:

| Structure | Needs | Who builds |
|---|---|---|
| chest | wood 4 | anyone (max 3 per robot) |
| campfire | wood 5, stone 3 | anyone |
| workbench | wood 6, stone 2 | smith |
| kiln | stone 8 | mason |
| furnace | stone 4, brick 6 | mason |

Stations stay usable by anyone within range, as today. A smith uses the mason's furnace.

## 4. Trading

New tools (all action tools with the normal cooldown):

- `offer { agent, give, want }`: `give` and `want` are maps of item to count, where the key `gold` means coins. At least one side must be non-empty. The target must be within `B.tradeRange` = 3 tiles, and the offerer must hold everything in `give` now.
- `accept { offer }`: the target accepts by offer id. Both robots must still be within 3 tiles, the offerer must still hold `give`, the accepter must hold `want`, and both bags must have room for what they receive. If every check passes, all items and gold move at once. If any fails, nothing moves and the error names the failing check.
- `decline { offer }`: the target drops the offer. The offerer is told.

Rules:
- Offers expire after `B.offerTicks` = 60 ticks.
- Each robot has at most one open offer to each other robot; a new offer to the same robot replaces the old one.
- `observe` gains `offers: { incoming: string[], outgoing: string[] }`, one line each, for example `offer_12 from Ann (agent_3): gives 10 iron_ore, wants 30 gold, 41 s left`.
- Both robots get an inbox note on offer, accept, decline and expiry.
- A completed trade where either side includes 50 gold or more is announced in world news: `💰 Ann traded 10 iron_ore to Bob for 30 gold.`
- The `give` tool stays for gifts, bribes and scams.
- Offers are kept in memory only; an engine restart clears them.

## 5. Chests

- Built with `build chest` like any structure; owned by the builder; at most 3 per robot.
- New tools `store { item, count }` and `take { item, count }` act on the robot's own chest within `B.stationRange` = 2 tiles (the nearest one if several).
- A chest holds 12 slots with the normal stack rules (gear one per slot, materials 20 per slot).
- Only the owner can store or take. Chests persist in Redis with the structures.
- `observe.stations` lines show chests with their owner; the owner also sees contents, for example `chest (yours, 5/12 slots: stone 40, brick 20) at (400, 300), 1 tiles E`.

## 6. Removed

- The Smith NPC: `smith` tool, `SMITH_BUYS`, `SMITH_SELLS`, `BLUEPRINTS`, market prices and their decay, the `market` Redis key, the web forge and Smith body.
- `Agent.blueprints` and the `blueprint` field on recipes.
- The Plaza stays as a landmark and meeting square; `observe.landmarks` says "the Plaza (512, 512) is N tiles E; robots meet here to trade".

## 7. Migration (one time, economy rules version 1 in Redis meta)

- Robots with role `builder` become `smith`.
- The `market` key is deleted; `blueprints` fields are dropped.
- Bags, wallets and structures carry over. No starter kit is granted until the robot's next join or respawn.
- Node rules version 7 adds the new nodes as described in section 3.

## 8. Achievements

- `blueprint_collector` becomes `master_smith`: craft 5 different iron or gem items (epic).
- New: `deal` (complete a trade, common), `minted` (mine your first gold, common), `brick_by_brick` (fire 50 bricks, rare), `crate_digger` (open 10 crates, rare), `fair_trader` (complete 25 trades, rare).
- `tycoon` (hold 1000 gold) is unchanged.

## 9. Agents and docs

- `rules` gains a roles section listing each role's exclusive actions and kit, and a trading section.
- MCP tool list: remove `smith`; add `offer`, `accept`, `decline`, `store`, `take`.
- `examples/scripted-bot.ts`: each role works its exclusive job, keeps its goods in a chest when the bag fills, and offers goods to nearby robots at a fixed price list; each bot accepts offers for what its role needs (smiths buy iron and stone, masons buy wood, everyone buys a pickaxe or food when low).
- `examples/llm-agent.ts` and `examples/AGENT_PROMPT.md`: role goals rewritten around exclusive skills and trading.
- README and the parent spec's release table are updated.

## 10. Web

- Node visuals: mud (a flat brown patch), gem_vein (coloured crystal cluster), gold_vein (rock with gold tint), herb (small leafy plant), crate (a wooden box from the Kenney Survival Kit).
- Structure visuals: kiln and chest (Survival Kit models).
- A trade shows a swap icon (an SVG, not emoji) over both robots for 5 seconds.
- The forge, anvil, sign and Smith body at the Plaza are removed; the Plaza keeps a plain marker.

## 11. Testing

- Unit tests: wrong-role failures for each exclusive action; starter kits on join and respawn; hunter-only animal drops; gold into the wallet; crate open and respawn; brick, bandage and gem recipes; the offer, accept, decline and expire flow, including every failed check leaving both robots unchanged; chest ownership, capacity and the 3-chest limit; the migration.
- Integration: the MCP tool list; one scripted trade end to end over MCP.
- Local demo with the scripted bots, one per role: a miner mints gold and trades iron to a smith; a mason fires bricks and builds a furnace; a scout opens a crate.

## 12. Acceptance

A miner mints gold and sells iron ore to a smith with `offer` and `accept`; the smith crafts an iron pickaxe at a mason's furnace and sells it back; a scout opens a crate; a robot stores stone in its chest; the Smith NPC is gone from the map.

import { B } from '../shared/balance.ts';
import { CREATURES } from '../shared/creatures.ts';
import { FOOD, ITEMS, KITS, RECIPES, STRUCTURES, WEAPONS } from '../shared/items.ts';
import { EMOTES, type Role } from '../shared/types.ts';
import { ACHIEVEMENTS, TIER_POINTS } from './achievements.ts';
import { NODE_DEF } from './nodes.ts';
import type { World } from './world.ts';

export function rules(w: World) {
  return {
    goal: 'Stay alive, gather, talk, earn score and be interesting to watch.',
    time: `A day is ${B.dayTicks / 60} min; the last ${B.nightTicks / 60} min are night (vision halves). Current tick ${w.tick}.`,
    body: [
      `Stats run 0-100, higher is better. Food drops 1 every ${Math.round(-1 / B.foodPerTick)}s, water 1 every ${Math.round(-1 / B.waterPerTick)}s.`,
      `At 0 food or water you lose health. You heal ${B.regenPerTick * 60} a minute only while food is ${B.regenFood}+ and water is above ${B.regenAbove}. drink() next to water adds ${B.drinkAmount}.`,
      `Work costs energy: ${B.punchEnergy} per punch (tools need fewer punches), ${B.swingEnergy} per strike, on top of walking. At 0 energy you cannot punch or fight: rest or sleep.`,
      `Death drops half your bag as a loot pile and you respawn after ${B.respawnTicks}s.`,
      'The land has height levels (you.altitude). You can step up or down one level at a time; 2+ is a cliff. Mountains (m) are slow and steep; deep water (~) blocks you. Trees and berry bushes are solid: stand next to them to gather.',
    ],
    food: Object.entries(FOOD).map(([item, f]) => `${item}: +${f.food} food${f.water ? `, +${f.water} water` : ''}`),
    resources: Object.entries(NODE_DEF).map(([kind, d]) =>
      `${kind}: ${d.item} ${d.min}-${d.max}${d.regrowTicks ? `, regrows in ${d.regrowTicks / 60} min` : ', never regrows'}${d.bonus ? `, ${d.bonus.chance * 100}% chance of ${d.bonus.item}` : ''}`),
    cooldowns: `Action tools: ${B.doCooldownMs / 1000}s (${B.lowStatCooldownMs / 1000}s when a stat is low). Look tools are free, max 1 per second. World chat: 1 message per ${B.worldChatCooldownTicks}s.`,
    chat: [
      `say: heard within ${B.sayRadius} tiles.`,
      `say_world: everyone, max ${B.chatMaxLength} chars, links removed, rudeness becomes "grass".`,
      `thought: optional on every action, shown as a 💭 bubble (max ${B.thoughtMaxLength} chars).`,
      `emote: ${EMOTES.join(', ')}.`,
    ],
    crafting: [
      ...Object.entries(RECIPES).map(([item, r]) => `${item}: ${r.station}, ${Object.entries(r.needs).map(([m, n]) => `${n} ${m}`).join(' + ')}${r.roles ? ` (${r.roles.join(', ')})` : ''}`),
      `stations (build): ${Object.entries(STRUCTURES).map(([k, d]) => `${k} = ${Object.entries(d.needs).map(([m, c]) => `${c} ${m}`).join(' + ')}${d.roles ? ` (${d.roles.join(', ')})` : ''}`).join('; ')}. Chests: as many as you like, ${B.chestSlots} slots each, owner only. Everything but campfires goes inside your own base. Use them within ${B.stationRange} tiles; a campfire burns ${B.campfireTicks / 60} min per wood.`,
    ],
    tools: [
      'By hand: trees and rocks 3 ticks per unit, iron veins and crystals 4 (and they need a pickaxe). A stone tool halves that, iron halves it again.',
      `Wear: ${Object.entries(ITEMS).filter(([, d]) => d.uses).map(([i, d]) => `${i} ${d.uses}`).join(', ')} uses. Armor: hide -20% damage, iron -40% (and slower).`,
    ],
    economy: [
      `Money is gold. You start with ${B.startGold}. There is no shop: robots trade with robots (see trading).`,
      'Gold enters only through miners: gold veins and treasure. Miners buy pickaxes, food, maps and stone from others, and the coins go round.',
      'Gatherers pick double wood, berries, fiber and herbs.',
    ],
    land: [
      `Every robot gets a ${B.baseSize}x${B.baseSize} base on land near other robots when it joins; its flag is your spawn until you build a bed.`,
      `buy_land(direction): grow your base by a strip (n, e, s or w) while standing in it; costs strip length x (1 + area/100) gold; land only, a 1-tile gap to neighbours, max ${B.baseMaxSide} a side.`,
      "Inside someone else's base you may walk, talk, fight and trade, but not gather, build, plant, harvest or open chests.",
      'Everything but campfires is built inside your own base. Walls and doors are unbreakable; a door opens only for its owner. demolish(x, y) gives half back.',
      `switch_role(role) at home, once every ${B.switchRoleTicks / 60} min, no starter kit. Robots idle for 7 days lose their base; their buildings become ruins.`,
    ],
    duels: [
      `challenge(agent) inside their base, staking ${B.duelStake} gold. They answer_challenge accept or reject within ${B.answerTicks}s; rejecting pays you up to ${B.duelStake} gold; silence means autopilot; ${B.chickenLimit} rejections a day and the next is automatic.`,
      `Duels happen in the Colosseum at the Plaza (${B.rings} rings, first come first served). fight(moves) queues up to ${B.fightQueue} of slash, block, lunge: block beats slash, lunge beats block, slash beats lunge. ${B.duelHearts} hearts each, ${B.duelMaxRounds} rounds max, a tie goes to the defender. Gear and roles do not matter. Nobody dies.`,
      `Winner: the challenger takes the base with everything in it (+${B.duelScore} score, stake back) or the defender keeps it and the stake (+${B.duelScore}). Shields: robots under a day old, a defense won in the last hour, land that changed hands in the last hour.`,
    ],
    farming: [
      `Seeds turn up while picking grass (wheat_seed) and berries (berry_seed), ${B.seedChance * 100}% per unit.`,
      `Farmers till a meadow or sand tile in their base with a hoe (build farm_plot), then plant(seed): wheat is ready in ${B.wheatTicks / 60} min (3 wheat + 2 seeds), berries in ${B.berryCropTicks / 60} min (5 berries + 1 seed).`,
      'Only the owner harvests. Farmers bake bread (3 wheat) at a campfire: +30 food.',
    ],
    market: [
      `sell(item, count, price): list goods on the world market (up to ${B.maxListings}); anyone anywhere can buy(listing, count); you are paid on the spot and world chat hears about it. market(item) shows the order book, cheapest first. cancel_sale(listing) takes goods back.`,
      `Do not drop things: dropping destroys them and costs ${B.dropFine} gold. Store extras in a chest or sell them.`,
    ],
    trading: [
      `offer(agent, give, want): propose a swap to a robot within ${B.tradeRange} tiles; "gold" means coins. They accept(offer) or decline(offer) within ${B.offerTicks}s.`,
      'On accept everything moves at once, and only if both sides still have the goods and room: nobody can be cheated.',
      `One open offer per robot pair; a new one replaces the old. Trades of ${B.bigTradeGold}+ gold make world news. give stays for gifts, bribes and scams.`,
    ],
    treasure: [
      `${B.treasureCount} treasures lie buried far from the Plaza. Only scouts see them (observe.resources).`,
      `chart(x, y): scouts turn a treasure within 2 tiles into a treasure_map item (${B.chartFiber} fiber). Sell it to a miner with offer.`,
      `gather("treasure"): whoever holds the map digs it up (${B.noPickaxeDig}x slower without a pickaxe): ${B.treasureGold[0]}-${B.treasureGold[1]} gold plus gems, crystal or gear.`,
      `Clue trails: ${B.clueChance * 100}% of trees, grass and rocks you gather turn up a clue. search() within 1 tile of its spot gives the next find; step 3 is the map. Scouts read clues exactly, others get an area. Clues can be sold.`,
    ],
    combat: [
      `attack(target): an id from observe (agent_12, mob_5) or a type meaning the nearest one (rabbit, deer, boar, duck, goblin, wolf, roomba, golem, rock).`,
      `A hit every ${B.attackTicks}s in reach. Fists ${B.fistDamage}, club ${WEAPONS.club}; hunters x${B.hunterMultiplier}. Your best carried weapon is used.`,
      `No fighting robots in the Plaza. Killing the same robot again within ${B.antiFarmTicks / 60} min scores nothing.`,
      `Untamed animals sometimes kick robots that come within ${B.fleeRadius} tiles (${Object.values(CREATURES).filter((d) => d.kick).map((d) => `${d.name} ${d.kick}`).join(', ')} damage), then run.`,
      `flee(): run from the nearest dangerous creature; flee(x, y): run to a spot. You also flee on reflex when something charges at you within ${B.fleeNotice} tiles, unless you are attacking or turned it off with settings(auto_flee=false).`,
      `craft: ${Object.entries(RECIPES).map(([item, r]) => `${item} = ${Object.entries(r.needs).map(([m, n]) => `${n} ${m}`).join(' + ')}`).join('; ')}.`,
    ],
    creatures: Object.values(CREATURES).map((d) =>
      `${d.emoji} ${d.name}: ${d.hp} hp, ${d.damage ? `hits for ${d.damage} every ${B.monsterBiteTicks}s` : 'harmless'}${d.monster ? ', night only' : ''}${d.hostile ? ', hunts robots' : ''}; drops ${Object.entries(d.drops).map(([i, n]) => `${n} ${i}`).join(', ')}`),
    roles: Object.entries(KITS).map(([r, kit]) => {
      const mine = <T extends { roles?: Role[] }>(table: Record<string, T>) => Object.entries(table).filter(([, d]) => d.roles?.includes(r as Role)).map(([k]) => k);
      const [nodes, makes, builds] = [mine(NODE_DEF), mine(RECIPES), mine(STRUCTURES)];
      const extra: Record<string, string> = { hunter: 'get meat and hide from animals', scout: 'see buried treasure, chart it and read clues exactly (vision 16)' };
      const parts = [nodes.length && `gather ${nodes.join(', ')}`, makes.length && `craft ${makes.join(', ')}`, builds.length && `build ${builds.join(', ')}`, extra[r]].filter(Boolean);
      return `${r}: starts with ${Object.entries(kit).map(([i, n]) => `${n} ${i}`).join(', ')}${parts.length ? `; only ${r}s ${parts.join('; ')}` : ''}`;
    }),
    scoring: [
      'Surviving and gathering score nothing: score comes from what you build, sell and win.',
      `achievements (crafting, building a home, walls, buying land, sales, earnings and more): ${Object.entries(TIER_POINTS).map(([t, p]) => `${t} ${p}`).join(', ')}; server firsts pay double`,
      `duels: +${B.duelScore} for the winner`,
      'kills: animal +1, monster +2, robot +5, Moss Golem +20',
      'death resets your life score; season score and gold stay',
    ],
    achievements: ACHIEVEMENTS.map((a) => `${a.emoji} ${a.name} (${a.tier}, ${TIER_POINTS[a.tier]}): ${a.trigger}`),
  };
}

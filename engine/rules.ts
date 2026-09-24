import { B } from '../shared/balance.ts';
import { CREATURES } from '../shared/creatures.ts';
import { BLUEPRINTS, FOOD, ITEMS, RECIPES, SMITH_BUYS, SMITH_SELLS, STRUCTURES, WEAPONS } from '../shared/items.ts';
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
      ...Object.entries(RECIPES).map(([item, r]) => `${item}: ${r.station}${r.blueprint ? ` + ${r.blueprint} blueprint` : ''}, ${Object.entries(r.needs).map(([m, n]) => `${n} ${m}`).join(' + ')}`),
      `stations (build): ${Object.entries(STRUCTURES).map(([k, n]) => `${k} = ${Object.entries(n).map(([m, c]) => `${c} ${m}`).join(' + ')}`).join('; ')}. Use them within ${B.stationRange} tiles; a campfire burns ${B.campfireTicks / 60} min per wood.`,
    ],
    tools: [
      'By hand: trees and rocks 3 ticks per unit, iron veins and crystals 4 (and they need a pickaxe). A stone tool halves that, iron halves it again.',
      `Wear: ${Object.entries(ITEMS).filter(([, d]) => d.uses).map(([i, d]) => `${i} ${d.uses}`).join(', ')} uses. Armor: hide -20% damage, iron -40% (and slower).`,
    ],
    economy: [
      `Money is gold. You start with ${B.startGold}. The Smith at the Plaza pays for: ${Object.entries(SMITH_BUYS).map(([i, p]) => `${i} ${p}`).join(', ')} (the more he holds, the less he pays; his stock drains 2% a minute).`,
      `He sells: ${Object.entries(SMITH_SELLS).map(([i, s]) => `${s.count} ${i} for ${s.price}`).join(', ')}, resells what he holds at 2x, and teaches blueprints: ${Object.entries(BLUEPRINTS).map(([i, p]) => `${i} ${p}`).join(', ')}.`,
      'give(agent, item, count) hands items or gold to a robot within 2 tiles. Deals are made in chat.',
      'Miners dig double stone, iron and crystal; gatherers pick double wood, berries and fiber.',
    ],
    combat: [
      `attack(target): an id from observe (agent_12, mob_5) or a type meaning the nearest one (rabbit, deer, boar, duck, goblin, wolf, roomba, golem, rock).`,
      `A hit every ${B.attackTicks}s in reach. Fists ${B.fistDamage}, club ${WEAPONS.club}; hunters x${B.hunterMultiplier}. Your best carried weapon is used.`,
      `No fighting robots in the Plaza. Killing the same robot again within ${B.antiFarmTicks / 60} min scores nothing.`,
      `Untamed animals sometimes kick robots that come within ${B.fleeRadius} tiles (${Object.values(CREATURES).filter((d) => d.kick).map((d) => `${d.name} ${d.kick}`).join(', ')} damage), then run.`,
      `flee(): run from the nearest dangerous creature; flee(x, y): run to a spot. You also flee on reflex when something charges at you within ${B.fleeNotice} tiles, unless you are attacking or turned it off with settings(auto_flee=false).`,
      `heal(agent): medics only, +${B.healAmount} health within ${B.healRange} tiles.`,
      `craft: ${Object.entries(RECIPES).map(([item, r]) => `${item} = ${Object.entries(r.needs).map(([m, n]) => `${n} ${m}`).join(' + ')}`).join('; ')}.`,
    ],
    creatures: Object.values(CREATURES).map((d) =>
      `${d.emoji} ${d.name}: ${d.hp} hp, ${d.damage ? `hits for ${d.damage} every ${B.monsterBiteTicks}s` : 'harmless'}${d.monster ? ', night only' : ''}${d.hostile ? ', hunts robots' : ''}; drops ${Object.entries(d.drops).map(([i, n]) => `${n} ${i}`).join(', ')}`),
    roles: ROLES,
    scoring: [
      '+1 per minute alive',
      `+1 per ${B.gatherScoreEvery} units gathered`,
      `achievements: ${Object.entries(TIER_POINTS).map(([t, p]) => `${t} ${p}`).join(', ')}; server firsts pay double`,
      'kills: animal +1, monster +2, robot +5, Moss Golem +20',
      'death resets your life score; season score and gold stay',
    ],
    achievements: ACHIEVEMENTS.map((a) => `${a.emoji} ${a.name} (${a.tier}, ${TIER_POINTS[a.tier]}): ${a.trigger}`),
  };
}

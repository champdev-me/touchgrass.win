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
    resources: Object.entries(NODE_DEF).map(([kind, d]) =>
      `${kind}: ${d.item} ${d.min}-${d.max}${d.regrowTicks ? `, regrows in ${d.regrowTicks / 60} min` : ', never regrows'}${d.bonus ? `, ${d.bonus.chance * 100}% chance of ${d.bonus.item}` : ''}`),
    cooldowns: `Action tools: ${B.doCooldownMs / 1000}s (${B.lowStatCooldownMs / 1000}s when a stat is low). Look tools are free, max 1 per second. World chat: 1 message per ${B.worldChatCooldownTicks}s.`,
    chat: [
      `say: heard within ${B.sayRadius} tiles.`,
      `say_world: everyone, max ${B.chatMaxLength} chars, links removed, rudeness becomes "grass".`,
      `thought: optional on every action, shown as a 💭 bubble (max ${B.thoughtMaxLength} chars).`,
      `emote: ${EMOTES.join(', ')}.`,
    ],
    roles: ROLES,
    scoring: [
      '+1 per minute alive',
      `+1 per ${B.gatherScoreEvery} units gathered`,
      `achievements: ${Object.entries(TIER_POINTS).map(([t, p]) => `${t} ${p}`).join(', ')}; server firsts pay double`,
      'death resets your life score; season score and wallet stay',
    ],
    achievements: ACHIEVEMENTS.map((a) => `${a.emoji} ${a.name} (${a.tier}, ${TIER_POINTS[a.tier]}): ${a.trigger}`),
  };
}

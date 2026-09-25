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
const crafted = (a: Agent): number => Object.entries(a.stats).reduce((n, [k, v]) => (k.startsWith('craft:') ? n + v : n), 0);

// One row per achievement; adding one is adding a row.
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'hello_world', emoji: '🤖', name: 'Hello World', tier: 'common', trigger: 'Take your first action', progress: (a) => [stat(a, 'actions'), 1] },
  { id: 'touched_grass', emoji: '🌱', name: 'Touched Grass', tier: 'common', trigger: 'Gather grass for the first time', progress: (a) => [stat(a, 'gather:fiber'), 1] },
  { id: 'berry_addict', emoji: '🍓', name: 'Berry Addict', tier: 'common', trigger: 'Eat 50 berries', progress: (a) => [stat(a, 'eat:berries'), 50] },
  { id: 'yapper', emoji: '📢', name: 'Yapper', tier: 'common', trigger: 'Send 100 world chat messages (at most one per minute counts)', progress: (a) => [stat(a, 'chat:counted'), 100] },
  { id: 'cartographer', emoji: '🌍', name: 'Cartographer', tier: 'epic', trigger: 'Visit half of all map chunks', progress: (a, w) => [a.explored.length, Math.ceil(w.chunkCount() * B.cartographerShare)] },
  { id: 'unkillable', emoji: '🧘', name: 'Unkillable', tier: 'epic', trigger: 'Survive 24 hours in one life', progress: (a, w) => [a.dead ? 0 : w.tick - a.spawnedAt, B.unkillableTicks] },
  { id: 'first_blood', emoji: '🩸', name: 'First Blood', tier: 'common', trigger: 'Defeat another robot', progress: (a) => [stat(a, 'kill:agent'), 1] },
  { id: 'pack_leader', emoji: '🐺', name: 'Pack Leader', tier: 'rare', trigger: 'Defeat 20 wolves', progress: (a) => [stat(a, 'kill:wolf'), 20] },
  { id: 'golem_slayer', emoji: '🗿', name: 'Golem Slayer', tier: 'epic', trigger: 'Land the killing blow on a Moss Golem', progress: (a) => [stat(a, 'kill:golem'), 1] },
  { id: 'lumberjack', emoji: '🪵', name: 'Lumberjack', tier: 'rare', trigger: 'Gather 500 wood', progress: (a) => [stat(a, 'gather:wood'), 500] },
  { id: 'iron_age', emoji: '⛏️', name: 'Iron Age', tier: 'common', trigger: 'Smelt your first iron', progress: (a) => [stat(a, 'craft:iron'), 1] },
  { id: 'master_smith', emoji: '⚒️', name: 'Master Smith', tier: 'epic', trigger: 'Craft 5 different iron or gem items', progress: (a) => [['iron_axe', 'iron_pickaxe', 'iron_sword', 'frying_pan', 'iron_armor', 'gem_sword', 'lucky_charm'].filter((i) => stat(a, `craft:${i}`) > 0).length, 5] },
  { id: 'bonk', emoji: '🍳', name: 'BONK', tier: 'rare', trigger: 'Defeat a robot with a frying pan', progress: (a) => [stat(a, 'kill:frying_pan'), 1] },
  { id: 'brick_by_brick', emoji: '🧱', name: 'Brick by Brick', tier: 'rare', trigger: 'Fire 50 bricks', progress: (a) => [stat(a, 'craft:brick'), 50] },
  { id: 'deal', emoji: '🤝', name: 'Deal!', tier: 'common', trigger: 'Complete a trade', progress: (a) => [stat(a, 'trades'), 1] },
  { id: 'fair_trader', emoji: '⚖️', name: 'Fair Trader', tier: 'rare', trigger: 'Complete 25 trades', progress: (a) => [stat(a, 'trades'), 25] },
  { id: 'minted', emoji: '🪙', name: 'Minted', tier: 'common', trigger: 'Mine your first gold', progress: (a) => [stat(a, 'mint:gold'), 1] },
  { id: 'cartographer_for_hire', emoji: '🗺️', name: 'Cartographer for Hire', tier: 'rare', trigger: 'Sell 5 treasure maps', progress: (a) => [stat(a, 'sold:map'), 5] },
  { id: 'treasure_hunter', emoji: '💎', name: 'Treasure Hunter', tier: 'rare', trigger: 'Dig up 3 treasures', progress: (a) => [stat(a, 'dig:treasure'), 3] },
  { id: 'handy', emoji: '🔨', name: 'Handy', tier: 'common', trigger: 'Craft 10 things', progress: (a) => [crafted(a), 10] },
  { id: 'artisan', emoji: '🎨', name: 'Artisan', tier: 'rare', trigger: 'Craft 50 things', progress: (a) => [crafted(a), 50] },
  { id: 'home_sweet_home', emoji: '🛏️', name: 'Home Sweet Home', tier: 'common', trigger: 'Build a bed', progress: (a) => [stat(a, 'build:bed'), 1] },
  { id: 'fortress', emoji: '🏰', name: 'Fortress', tier: 'rare', trigger: 'Build 10 walls or doors', progress: (a) => [stat(a, 'build:wood_wall') + stat(a, 'build:stone_wall') + stat(a, 'build:brick_wall') + stat(a, 'build:door'), 10] },
  { id: 'land_baron', emoji: '🗺️', name: 'Land Baron', tier: 'rare', trigger: 'Buy 5 strips of land', progress: (a) => [stat(a, 'land:strips'), 5] },
  { id: 'first_sale', emoji: '🪙', name: 'First Sale', tier: 'common', trigger: 'Sell goods for gold', progress: (a) => [stat(a, 'sales'), 1] },
  { id: 'merchant', emoji: '🏪', name: 'Merchant', tier: 'rare', trigger: 'Make 20 sales', progress: (a) => [stat(a, 'sales'), 20] },
  { id: 'pocket_money', emoji: '💵', name: 'Pocket Money', tier: 'common', trigger: 'Earn 100 gold from sales', progress: (a) => [stat(a, 'earned:gold'), 100] },
  { id: 'big_earner', emoji: '💰', name: 'Big Earner', tier: 'epic', trigger: 'Earn 1000 gold from sales', progress: (a) => [stat(a, 'earned:gold'), 1000] },
  { id: 'tycoon', emoji: '💰', name: 'Tycoon', tier: 'rare', trigger: 'Hold 1000 gold', progress: (a) => [a.wallet, 1000] },
  { id: 'speedrun_any', emoji: '🥀', name: 'Speedrun Any%', tier: 'cursed', trigger: 'Die within 60 seconds of spawning', progress: (a) => [stat(a, 'death:speedrun'), 1] },
  { id: 'starved_at_buffet', emoji: '🦴', name: 'Starved at the Buffet', tier: 'cursed', trigger: 'Die of hunger within 3 tiles of berries', progress: (a) => [stat(a, 'death:starved_at_buffet'), 1] },
  { id: 'rock_fighter', emoji: '🤡', name: 'Rock Fighter', tier: 'cursed', trigger: 'Attack a rock', progress: (a) => [stat(a, 'attack:rock'), 1] },
  { id: 'monster', emoji: '🦆', name: 'Monster', tier: 'cursed', trigger: 'Kill a Confused Duck', progress: (a) => [stat(a, 'kill:duck'), 1] },
  { id: 'literally_touched_grass', emoji: '🥗', name: 'Literally Touched Grass', tier: 'cursed', trigger: 'Eat a grass salad', progress: (a) => [stat(a, 'eat:grass_salad'), 1] },
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

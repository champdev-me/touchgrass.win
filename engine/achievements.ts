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

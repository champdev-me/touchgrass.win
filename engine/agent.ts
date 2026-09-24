import type { Agent } from '../shared/types.ts';

export const AGENT_COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#800000', '#aaffc3'];

const DEFAULTS: Omit<Agent, 'id' | 'name'> = {
  color: '#cccccc', role: null, model: null, joined: false, x: 0, y: 0, spawn: [0, 0], createdAt: 0, lastActionAt: 0,
  task: null, inbox: [], health: 100, food: 100, water: 100, energy: 100, inventory: {}, dead: false, respawnAt: 0,
  spawnedAt: 0, autoEat: true, stats: {}, online: false, lastSeenAt: 0,
};

/** Fills fields added after an agent was first saved, so records from older versions keep loading. */
export function normalizeAgent(a: Partial<Agent> & { id: string; name: string }): Agent {
  return { ...DEFAULTS, inventory: {}, stats: {}, inbox: [], ...a };
}

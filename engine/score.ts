import type { Agent } from '../shared/types.ts';
import type { World } from './world.ts';

/** Points count for the current life and the season; gold comes from trading. */
export function addScore(w: World, a: Agent, n: number): void {
  a.lifeScore += n;
  a.seasonScore += n;
  a.bestLife = Math.max(a.bestLife, a.lifeScore);
  w.dirty.add(a.id);
}

export function leaderboard(w: World) {
  const players = [...w.agents.values()].filter((a) => a.joined && !a.banned);
  const top = (score: (a: Agent) => number, keep: (a: Agent) => boolean = () => true) =>
    players.filter(keep).sort((p, q) => score(q) - score(p)).slice(0, 10).map((a, i) => `${i + 1}. ${a.name} ${score(a)}`);
  const models = new Map<string, { n: number; total: number }>();
  for (const a of players) {
    const m = models.get(a.model ?? 'unknown') ?? { n: 0, total: 0 };
    m.n++;
    m.total += a.seasonScore;
    models.set(a.model ?? 'unknown', m);
  }
  return {
    season: top((a) => a.seasonScore),
    current_life: top((a) => a.lifeScore, (a) => !a.dead),
    best_life: top((a) => a.bestLife),
    by_model: [...models]
      .sort((p, q) => q[1].total / q[1].n - p[1].total / p[1].n)
      .map(([m, e]) => `${m}: ${e.n} robots, average ${Math.round(e.total / e.n)}`),
  };
}

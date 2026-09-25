/** Multi-player Elo: every pair in the ranking plays one game, the higher-ranked player winning. Returns new ratings. */
export function eloUpdate(ranking: string[], rating: (id: string) => number, k: number): Map<string, number> {
  const delta = new Map(ranking.map((id) => [id, 0]));
  for (let i = 0; i < ranking.length; i++) {
    for (let j = i + 1; j < ranking.length; j++) {
      const a = ranking[i], b = ranking[j];
      const expected = 1 / (1 + 10 ** ((rating(b) - rating(a)) / 400));
      delta.set(a, delta.get(a)! + k * (1 - expected));
      delta.set(b, delta.get(b)! - k * (1 - expected));
    }
  }
  return new Map(ranking.map((id) => [id, Math.round(rating(id) + delta.get(id)!)]));
}

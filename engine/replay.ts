import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameEvent } from '../shared/types.ts';

export async function appendReplay(dir: string, season: number, events: GameEvent[], now = new Date()): Promise<void> {
  if (!events.length) return;
  const folder = join(dir, `season-${season}`);
  await mkdir(folder, { recursive: true });
  const ts = now.toISOString();
  await appendFile(join(folder, `${ts.slice(0, 10)}.jsonl`), events.map((e) => JSON.stringify({ ...e, ts })).join('\n') + '\n');
}

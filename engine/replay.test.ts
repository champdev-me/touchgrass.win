import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendReplay } from './replay.ts';

test('events are appended as JSON lines per season and day', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tg-replay-'));
  const now = new Date('2026-09-24T10:00:00Z');
  await appendReplay(dir, 1, [{ tick: 1, type: 'join', text: 'A joined' }], now);
  await appendReplay(dir, 1, [], now);
  await appendReplay(dir, 1, [{ tick: 2, type: 'move', text: 'A walks' }], now);
  const lines = (await readFile(join(dir, 'season-1', '2026-09-24.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.tick), [1, 2]);
  assert.equal(lines[0].ts, '2026-09-24T10:00:00.000Z');
});

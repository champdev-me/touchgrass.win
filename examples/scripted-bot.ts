import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { HorseView } from '../shared/types.ts';
import { username } from './names.ts';

const BASE = process.env.TG_URL ?? 'http://localhost:3000';
const COUNT = Number(process.env.BOTS ?? 2);
const FILE = process.env.BOTS_FILE ?? 'examples/.bots.json';
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const CHEERS = ['RUN!', 'Come on, come on!', 'Oh no.', 'Go go go!', 'Not like this.'];

interface Observe {
  status: 'lobby' | 'queued' | 'in_match';
  round?: number;
  chosen?: number | null;
  options?: { id: number; label: string }[];
  state?: HorseView;
  you: string;
}

async function tokens(): Promise<string[]> {
  const saved = JSON.parse(await readFile(FILE, 'utf8').catch(() => '[]')) as string[];
  while (saved.length < COUNT) {
    const res = await fetch(`${BASE}/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: username() }) });
    const body = (await res.json()) as { token: string; message?: string };
    if (!res.ok) throw new Error(`signup failed: ${body.message}`);
    saved.push(body.token);
    await writeFile(FILE, JSON.stringify(saved));
  }
  return saved.slice(0, COUNT);
}

async function call<T>(c: Client, name: string, args: Record<string, unknown> = {}): Promise<{ error: boolean; data: T }> {
  const r = await c.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]?.text ?? '{}';
  try {
    return { error: Boolean(r.isError), data: JSON.parse(text) as T };
  } catch {
    return { error: true, data: { message: text } as T }; // SDK validation errors are plain text
  }
}

/** The house strategy: conserve early, steady in the middle, sprint late while there is stamina. */
function pick(o: Observe): number {
  const s = o.state!, me = s.runners.find((r) => r.id === o.you), id = (label: string) => o.options!.find((x) => x.label === label)?.id ?? o.options![0].id;
  if (!me) return id('steady');
  if (s.leg === 0) return id('conserve');
  if (s.leg >= s.legs - 2 && me.stamina >= 3) return id(Math.random() < 0.3 ? 'overtake' : 'sprint');
  return id(Math.random() < 0.2 ? 'overtake' : 'steady');
}

async function run(token: string, n: number): Promise<void> {
  const c = new Client({ name: `scripted-${n}`, version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  let acted = -1;
  for (;;) {
    const o = (await call<Observe>(c, 'observe')).data;
    if (o.status === 'lobby') {
      const r = await call<{ message?: string }>(c, 'play', { game: 'horse_race', model: 'scripted' });
      console.log(`[${o.you}] play: ${r.error ? r.data.message : 'queued'}`);
    } else if (o.status === 'in_match' && o.options?.length && o.round !== acted) {
      const option = pick(o);
      await call(c, 'act', { option });
      acted = o.round ?? -1;
      console.log(`[${o.you}] leg ${(o.state?.leg ?? 0) + 1}: ${o.options.find((x) => x.id === option)?.label}`);
      if (Math.random() < 0.15) await call(c, 'say_world', { text: CHEERS[Math.floor(Math.random() * CHEERS.length)] });
    }
    await sleep(2000);
  }
}

const list = await tokens();
await Promise.all(list.map((t, i) => run(t, i).catch((e) => console.error(`bot ${i}:`, e))));

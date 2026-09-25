import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { HorseView, JoustView } from '../shared/types.ts';
import { username } from './names.ts';

const BASE = process.env.TG_URL ?? 'http://localhost:3000';
const COUNT = Number(process.env.BOTS ?? 2);
const FILE = process.env.BOTS_FILE ?? 'examples/.bots.json';
const GAMES = (process.env.GAMES ?? 'horse_race,joust,tavern,roulette').split(','); // played in turn
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const CHEERS = ['RUN!', 'Come on, come on!', 'Oh no.', 'Go go go!', 'Not like this.'];

interface Observe {
  status: 'lobby' | 'queued' | 'in_match';
  game?: string;
  round?: number;
  chosen?: number | null;
  options?: { id: number; label: string }[];
  state?: HorseView | JoustView;
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
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six'];
const faceOf = (label: string) => WORDS.findIndex((w) => label.endsWith(` ${w}`) || label.endsWith(` ${w === 'six' ? 'sixes' : `${w}s`}`)) + 1;

function pick(o: Observe): number {
  if (o.game === 'roulette') {
    const v = o.state as unknown as { clicks: number; players: { id: string; chips: number }[] }, left = 6 - v.clicks, chips = v.players.find((p) => p.id === o.you)?.chips ?? 0;
    const label = left <= 2 && chips > 0 ? 'pass the gun' : left <= 4 ? 'spin and pull' : 'pull the trigger';
    return o.options!.find((x) => x.label === label)?.id ?? 2;
  }
  if (o.game === 'tavern') {
    const v = o.state as unknown as { bid: { count: number; face: number } | null; dice_on_table: number; seats: { id: string; dice: number[] | null }[] };
    const mine = v.seats.find((x) => x.id === o.you)?.dice ?? [], others = v.dice_on_table - mine.length;
    const expect = (f: number) => mine.filter((d) => d === f).length + others / 6;
    if (v.bid && v.bid.count > expect(v.bid.face) + 0.8) return 1; // call liar
    const best = Math.random() < 0.2 ? 1 + Math.floor(Math.random() * 6) : [1, 2, 3, 4, 5, 6].sort((a, b) => expect(b) - expect(a) || b - a)[0];
    return o.options!.find((x) => x.label.startsWith('bid') && faceOf(x.label) === best)?.id ?? o.options![o.options!.length > 1 ? 1 : 0].id;
  }
  if (o.game === 'joust') {
    const theirs = (o.state as JoustView).riders.find((r) => r.id !== o.you)?.aims.at(-1), r = Math.random();
    const label = theirs && theirs !== 'shield' && r < 0.5 ? theirs : r < 0.75 ? 'shield' : r < 0.88 ? 'helm' : 'body';
    return o.options!.find((x) => x.label === label)?.id ?? 2;
  }
  const s = o.state as HorseView, me = s.runners.find((r) => r.id === o.you), id = (label: string) => o.options!.find((x) => x.label === label)?.id ?? o.options![0].id;
  if (!me) return id('steady');
  if (s.event === 'hurdle') return id(me.stamina >= 2 ? 'jump' : 'conserve');
  if (s.leg === 0) return id('conserve');
  if (s.leg >= s.legs - 3 && s.event !== 'turn' && me.stamina >= 3) return id(Math.random() < 0.3 ? 'overtake' : 'sprint');
  return id(Math.random() < 0.2 ? 'overtake' : 'steady');
}

async function run(token: string, n: number): Promise<void> {
  const c = new Client({ name: `scripted-${n}`, version: '1' });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  let acted = -1, turn = n;
  for (;;) {
    const o = (await call<Observe>(c, 'observe')).data;
    if (o.status === 'lobby') {
      const game = GAMES[turn++ % GAMES.length];
      const r = await call<{ message?: string }>(c, 'play', { game, model: 'scripted' });
      console.log(`[${o.you}] play ${game}: ${r.error ? r.data.message : 'queued'}`);
    } else if (o.status === 'in_match' && o.options?.length && o.round !== acted) {
      const option = pick(o);
      await call(c, 'act', { option });
      acted = o.round ?? -1;
      console.log(`[${o.you}] ${o.game} round ${(o.round ?? 0) + 1}: ${o.options.find((x) => x.id === option)?.label}`);
      if (Math.random() < 0.15) await call(c, 'say_world', { text: CHEERS[Math.floor(Math.random() * CHEERS.length)] });
    }
    await sleep(2000);
  }
}

const list = await tokens();
await Promise.all(list.map((t, i) => run(t, i).catch((e) => console.error(`bot ${i}:`, e))));

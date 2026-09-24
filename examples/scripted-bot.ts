import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { GameError, Vec } from '../shared/types.ts';

const BASE = process.env.TG_URL ?? 'http://localhost:3000';
const COUNT = Number(process.env.BOTS ?? 10);
const FILE = 'examples/.bots.json';
const ROLES = ['gatherer', 'hunter', 'builder', 'medic', 'scout'];
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const LINES = ['Has anyone seen my berries?', 'This grass is excellent.', 'I am definitely not lost.', 'Night is scary. Just saying.', 'Who keeps eating all the berries?'];

type Reply = {
  you: { pos: Vec; health: number; food: number; water: number; energy: number; dead: boolean; inventory: Record<string, number> };
  task: { type: string } | null;
  nearby: string[];
  time: { phase: string };
  resources: string[];
} & GameError;

async function tokens(): Promise<string[]> {
  const saved = JSON.parse(await readFile(FILE, 'utf8').catch(() => '[]')) as string[];
  while (saved.length < COUNT) {
    const res = await fetch(`${BASE}/signup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `Bot ${Math.random().toString(36).slice(2, 7)}` }),
    });
    const body = (await res.json()) as { token: string; message?: string };
    if (!res.ok) throw new Error(`signup failed: ${body.message}`);
    saved.push(body.token);
    await writeFile(FILE, JSON.stringify(saved));
  }
  return saved.slice(0, COUNT);
}

async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = await c.callTool({ name, arguments: args });
  return { error: Boolean(r.isError), data: JSON.parse((r.content as { text: string }[])[0]?.text ?? '{}') as Reply };
}

async function runBot(token: string, i: number): Promise<never> {
  for (;;) {
    try {
      const c = new Client({ name: `scripted-bot-${i}`, version: '0.0.1' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      await call(c, 'join_game', { role: ROLES[i % ROLES.length], model: 'scripted-bot' });
      for (;;) {
        await sleep(5500 + Math.random() * 2000);
        const o = await call(c, 'observe');
        if (!o.error && !o.data.you.dead && Math.random() < 0.05) {
          await call(c, 'say_world', { text: LINES[Math.floor(Math.random() * LINES.length)] });
          continue;
        }
        const threat = o.error || o.data.you.dead ? undefined : o.data.nearby.find((l) => l.includes('hunting you'))?.split(' ')[0];
        if (threat && o.data.task?.type !== 'attack') {
          const [x, y] = o.data.you.pos;
          if (o.data.you.health >= 40) await call(c, 'attack', { target: threat, thought: 'not today, monster' });
          else await call(c, 'move_to', { x: Math.max(0, x - 15), y: Math.max(0, y - 15), thought: 'nope nope nope' });
          continue;
        }
        if (o.error || o.data.you.dead || o.data.task) continue;
        const me = o.data.you;
        const spot = (kind: string) => {
          const m = o.data.resources.find((r) => r.startsWith(kind))?.match(/at \((\d+), (\d+)\)/);
          return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
        };
        let did = '';
        if (me.water < 50) {
          const d = await call(c, 'drink', { thought: 'so thirsty' });
          did = d.error ? '' : 'drink';
          const place = spot('drink spot');
          if (!did && place) did = (await call(c, 'move_to', { ...place, thought: 'walking to water' })).error ? '' : 'walk to water';
        } else if (me.food < 60 && (me.inventory.berries ?? 0) > 0) {
          did = (await call(c, 'eat', { item: 'berries', thought: 'snack time' })).error ? '' : 'eat';
        } else if (me.food < 70) {
          did = (await call(c, 'gather', { target: 'berry_bush', until: 6, thought: 'stocking up on berries' })).error ? '' : 'gather berries';
        } else if (o.data.time.phase === 'night' && me.energy < 90) {
          did = (await call(c, 'sleep', { thought: 'too dark, going to bed' })).error ? '' : 'sleep';
        } else if ((me.inventory.wood ?? 0) >= 5 && !me.inventory.club) {
          did = (await call(c, 'craft', { item: 'club', thought: 'a stick, but angrier' })).error ? '' : 'craft club';
        } else if (Math.random() < 0.4) {
          const target = ['tree', 'grass', 'rock'][Math.floor(Math.random() * 3)];
          did = (await call(c, 'gather', { target, until: 5, thought: `I need ${target} for reasons` })).error ? '' : `gather ${target}`;
        }
        if (!did) {
          const [x, y] = me.pos;
          const clamp = (v: number) => Math.max(0, Math.min(1023, v));
          const m = await call(c, 'move_to', { x: clamp(x + Math.round((Math.random() - 0.5) * 60)), y: clamp(y + Math.round((Math.random() - 0.5) * 60)), thought: 'exploring' });
          did = m.error ? `wander failed (${m.data.error})` : 'wander';
        }
        console.log(`bot ${i}: ${did} | food ${Math.round(me.food)} water ${Math.round(me.water)} energy ${Math.round(me.energy)}`);
      }
    } catch (e) {
      console.log(`bot ${i}: ${(e as Error).message}; reconnecting in 5s`);
      await sleep(5000);
    }
  }
}

await Promise.all((await tokens()).map((t, i) => runBot(t, i)));

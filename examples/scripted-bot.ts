import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { GameError, Vec } from '../shared/types.ts';

const BASE = process.env.TG_URL ?? 'http://localhost:3000';
const COUNT = Number(process.env.BOTS ?? 10);
const FILE = 'examples/.bots.json';
const ROLES = ['gatherer', 'hunter', 'builder', 'medic', 'scout'];
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

type Reply = { you: { pos: Vec }; task: unknown } & GameError;

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
        if (o.error || o.data.task) continue;
        const [x, y] = o.data.you.pos;
        const clamp = (v: number) => Math.max(0, Math.min(1023, v));
        const tx = clamp(x + Math.round((Math.random() - 0.5) * 60)), ty = clamp(y + Math.round((Math.random() - 0.5) * 60));
        const m = await call(c, 'move_to', { x: tx, y: ty });
        console.log(`bot ${i}: move_to (${tx}, ${ty}) -> ${m.error ? m.data.error : 'ok'}`);
      }
    } catch (e) {
      console.log(`bot ${i}: ${(e as Error).message}; reconnecting in 5s`);
      await sleep(5000);
    }
  }
}

await Promise.all((await tokens()).map((t, i) => runBot(t, i)));

import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { GameError, Vec } from '../shared/types.ts';

const BASE = process.env.TG_URL ?? 'http://localhost:3000';
const COUNT = Number(process.env.BOTS ?? 10);
const FILE = 'examples/.bots.json';
const ROLES = ['gatherer', 'hunter', 'builder', 'medic', 'scout', 'miner'];
const PLAZA: Vec = [512, 512]; // the Smith
const SELLS = ['iron_ore', 'crystal', 'hide', 'stone', 'wood', 'fiber'];
// Sellable units that send each role to the Smith.
const TRIP_AT: Record<string, number> = { gatherer: 30, hunter: 4, builder: 30, medic: 20, scout: 15, miner: 20 };
const ANIMALS = ['rabbit', 'deer', 'boar', 'cow', 'chicken'];
const FOODS = ['berries', 'cooked_meat', 'apple', 'meat'];
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const LINES = ['Has anyone seen my berries?', 'This grass is excellent.', 'I am definitely not lost.', 'Night is scary. Just saying.', 'Who keeps eating all the berries?'];

type Reply = {
  you: { pos: Vec; role: string; health: number; food: number; water: number; energy: number; dead: boolean; inventory: Record<string, number>; slots?: string; gold?: number };
  stations?: string[];
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

const clamp = (v: number) => Math.max(0, Math.min(1023, v));
const dist = (a: Vec, b: Vec) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
/** Far targets are reached in hops the pathfinder can handle. */
const hop = ([x, y]: Vec, [tx, ty]: Vec): { x: number; y: number } => ({ x: clamp(x + Math.max(-100, Math.min(100, tx - x))), y: clamp(y + Math.max(-100, Math.min(100, ty - y))) });

/** One decision: survive first, then do the role's job, then trade with the Smith. */
async function act(c: Client, o: Reply, trip: boolean): Promise<{ what: string; trip: boolean }> {
  const me = o.you, inv = me.inventory;
  const ok = async (tool: string, args: Record<string, unknown>, what: string) => ((await call(c, tool, args)).error ? '' : what);
  const spot = (kind: string) => {
    const m = o.resources.find((r) => r.startsWith(kind))?.match(/at \((\d+), (\d+)\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const seen = (kind: string) => o.resources.some((r) => r.startsWith(kind));
  const station = (kind: string) => (o.stations ?? []).some((l) => l.startsWith(kind) && !l.includes('(out)') && /, [0-2] tiles/.test(l));
  let what = '';
  // 1. Survive.
  const food = FOODS.find((f) => (inv[f] ?? 0) > 0);
  if (me.water < 50) {
    what = await ok('drink', { thought: 'so thirsty' }, 'drink');
    const place = spot('drink spot');
    if (!what && place) what = await ok('move_to', { ...place, thought: 'walking to water' }, 'walk to water');
  } else if (me.food < 60 && food) what = await ok('eat', { item: food, thought: 'snack time' }, `eat ${food}`);
  else if (me.food < 60 && seen('berry_bush')) what = await ok('gather', { target: 'berry_bush', until: 10, thought: 'need food' }, 'gather berries');
  else if (o.time.phase === 'night' && me.energy < 40) what = await ok('sleep', { thought: 'too tired' }, 'sleep');
  if (what) return { what, trip };
  // A full bag blocks all work: dump the biggest pile of anything unsellable.
  const [used, total] = (me.slots ?? '0/12').split('/').map(Number);
  const junk = Object.entries(inv).filter(([k]) => !SELLS.includes(k)).sort((p, q) => q[1] - p[1])[0];
  if (used >= total && junk && junk[1] > 20) return { what: await ok('drop', { item: junk[0], count: junk[1] - 20, thought: 'travelling light' }, `drop ${junk[1] - 20} ${junk[0]}`), trip };
  // 2. Trade: sell at the Smith once the bag has enough goods.
  const goods = SELLS.reduce((n, item) => n + (inv[item] ?? 0), 0);
  if (goods >= (TRIP_AT[me.role] ?? 20)) trip = true;
  const atSmith = dist(me.pos, PLAZA) <= 3;
  const needPick = me.role === 'miner' && !inv.stone_pickaxe && !inv.iron_pickaxe;
  if (atSmith && needPick && (me.gold ?? 0) >= 15) return { what: await ok('smith', { action: 'buy', item: 'stone_pickaxe', thought: 'a pickaxe, at last' }, 'buy pickaxe'), trip };
  if (trip) {
    const item = SELLS.find((it) => (inv[it] ?? 0) > 0);
    if (!item) return { what: 'trip done', trip: false };
    if (atSmith) return { what: await ok('smith', { action: 'sell', item, count: inv[item], thought: 'cash money' }, `sell ${inv[item]} ${item}`), trip };
    return { what: await ok('move_to', { ...hop(me.pos, [PLAZA[0] + 2, PLAZA[1]]), thought: 'off to the Smith' }, 'walk to the Smith'), trip };
  }
  // 3. Work the role.
  const gatherAny = async (kinds: string[], until = 10) => {
    for (const k of kinds) if (seen(k)) return ok('gather', { target: k, until, thought: `${me.role} work: ${k}` }, `gather ${k}`);
    return '';
  };
  switch (me.role) {
    case 'miner':
      what = needPick ? await gatherAny(['rock']) : await gatherAny(['iron_vein', 'crystal', 'rock']);
      if (!what && needPick && (me.gold ?? 0) >= 15) return { what: await ok('move_to', { ...hop(me.pos, [PLAZA[0] + 2, PLAZA[1]]), thought: 'buying a pickaxe' }, 'walk to buy a pickaxe'), trip };
      break;
    case 'hunter': {
      const prey = o.nearby.find((l) => l.startsWith('mob_') && ANIMALS.some((a) => l.includes(` ${a} `)));
      if (prey) what = await ok('attack', { target: prey.split(' ')[0], thought: 'dinner' }, `hunt ${prey.split(' ')[2]}`);
      break;
    }
    case 'builder':
      if (!station('workbench') && (inv.wood ?? 0) >= 3 && (inv.stone ?? 0) >= 1) what = await ok('build', { structure: 'workbench', thought: 'a workshop' }, 'build workbench');
      else if (station('workbench') && !inv.stone_axe && (inv.wood ?? 0) >= 3 && (inv.stone ?? 0) >= 3 && (inv.fiber ?? 0) >= 2) what = await ok('craft', { item: 'stone_axe', thought: 'a proper axe' }, 'craft stone axe');
      else if (o.time.phase === 'night' && !station('campfire') && (inv.wood ?? 0) >= 3 && (inv.stone ?? 0) >= 2) what = await ok('build', { structure: 'campfire', thought: 'light against the dark' }, 'build campfire');
      else what = await gatherAny((inv.stone ?? 0) < 6 ? ['rock', 'tree', 'grass'] : ['tree', 'grass', 'rock']);
      break;
    case 'medic': {
      const hurt = o.nearby.find((l) => l.startsWith('agent_') && !l.includes('(dead)') && Number(l.match(/health (\d+)/)?.[1] ?? 100) < 70);
      const far = hurt?.match(/\) (\d+) tiles (\w+)/);
      if (hurt && far && Number(far[1]) <= 2) what = await ok('heal', { agent: hurt.split(' ')[0], thought: 'hold still' }, 'heal');
      else if (far) {
        // walk the compass bearing towards the patient
        const d = Number(far[1]), [x, y] = me.pos;
        const dx = far[2].includes('E') ? 1 : far[2].includes('W') ? -1 : 0, dy = far[2].includes('S') ? 1 : far[2].includes('N') ? -1 : 0;
        what = await ok('move_to', { x: clamp(x + dx * (d - 1)), y: clamp(y + dy * (d - 1)), thought: 'medic on the way' }, 'run to patient');
      } else what = await gatherAny(['grass', 'tree']);
      break;
    }
    case 'scout':
      if (Math.random() < 0.6) {
        const [x, y] = me.pos;
        what = await ok('move_to', { x: clamp(x + Math.round((Math.random() - 0.5) * 120)), y: clamp(y + Math.round((Math.random() - 0.5) * 120)), thought: 'what is over there?' }, 'scout ahead');
      } else what = await gatherAny(['grass', 'tree']);
      break;
    default:
      what = await gatherAny(['tree', 'berry_bush', 'grass']);
  }
  if (!what && (inv.wood ?? 0) >= 5 && !inv.club) what = await ok('craft', { item: 'club', thought: 'a stick, but angrier' }, 'craft club');
  if (!what) {
    const [x, y] = me.pos;
    what = await ok('move_to', { x: clamp(x + Math.round((Math.random() - 0.5) * 60)), y: clamp(y + Math.round((Math.random() - 0.5) * 60)), thought: 'looking around' }, 'wander');
  }
  return { what: what || 'stuck', trip };
}

async function runBot(token: string, i: number): Promise<never> {
  for (;;) {
    try {
      const c = new Client({ name: `scripted-bot-${i}`, version: '0.0.1' });
      await c.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      await call(c, 'join_game', { role: ROLES[i % ROLES.length], model: 'scripted-bot' });
      let trip = false; // walking to the Smith to sell
      for (;;) {
        await sleep(5500 + Math.random() * 2000);
        const o = await call(c, 'observe');
        if (!o.error && !o.data.you.dead && Math.random() < 0.05) {
          await call(c, 'say_world', { text: LINES[Math.floor(Math.random() * LINES.length)] });
          continue;
        }
        const threat = o.error || o.data.you.dead ? undefined : o.data.nearby.find((l) => l.includes('hunting you'))?.split(' ')[0];
        if (threat && o.data.task?.type !== 'attack') {
          if (o.data.you.health >= 40) await call(c, 'attack', { target: threat, thought: 'not today, monster' });
          else await call(c, 'flee', { thought: 'nope nope nope' });
          continue;
        }
        if (o.error || o.data.you.dead || o.data.task) continue;
        const did = await act(c, o.data, trip);
        trip = did.trip;
        const me = o.data.you;
        console.log(`bot ${i} (${me.role}): ${did.what} | food ${Math.round(me.food)} water ${Math.round(me.water)} gold ${me.gold ?? 0}`);
      }
    } catch (e) {
      console.log(`bot ${i}: ${(e as Error).message}; reconnecting in 5s`);
      await sleep(5000);
    }
  }
}

// ONLY=miner,hunter runs just the saved bots with those roles.
const only = process.env.ONLY?.split(',');
await Promise.all((await tokens()).map((t, i) => (!only || only.includes(ROLES[i % ROLES.length]) ? runBot(t, i) : null)));

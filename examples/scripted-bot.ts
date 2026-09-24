import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { GameError, Vec } from '../shared/types.ts';

const BASE = process.env.TG_URL ?? 'http://localhost:3000';
const COUNT = Number(process.env.BOTS ?? 10);
const FILE = process.env.BOTS_FILE ?? 'examples/.bots.json';
const ROLES = ['miner', 'mason', 'smith', 'hunter', 'gatherer', 'scout'];
const PLAZA: Vec = [512, 512]; // the trading square
const ANIMALS = ['rabbit', 'deer', 'boar', 'cow', 'chicken'];
const FOODS = ['cooked_meat', 'berries', 'apple', 'meat'];
// Gold per unit this bot asks or pays; maps and clues are priced by prefix.
const PRICE: Record<string, number> = { iron_ore: 3, gem: 10, crystal: 8, stone: 1, brick: 2, mud: 1, meat: 2, cooked_meat: 4, hide: 3, wood: 1, fiber: 1, herb: 2, bandage: 4, stone_pickaxe: 15, stone_axe: 12, iron_pickaxe: 40, map: 20, clue: 8 };
const SELLS: Record<string, string[]> = {
  miner: ['iron_ore', 'gem', 'crystal'], mason: ['stone', 'brick'], smith: ['stone_pickaxe', 'stone_axe', 'iron_pickaxe'],
  hunter: ['cooked_meat', 'meat', 'hide'], gatherer: ['wood', 'fiber', 'herb', 'bandage'], scout: ['map', 'clue'],
};
const WANTS: Record<string, string[]> = {
  miner: ['stone_pickaxe', 'iron_pickaxe', 'cooked_meat', 'map'], mason: ['wood'], smith: ['iron_ore', 'stone', 'gem', 'hide', 'wood', 'fiber'],
  hunter: ['stone', 'wood'], gatherer: ['cooked_meat'], scout: ['clue', 'fiber'],
};
const kindOf = (item: string) => (item.startsWith('treasure_map:') ? 'map' : item.startsWith('clue:') ? 'clue' : item);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const LINES = ['Has anyone seen my berries?', 'This grass is excellent.', 'I am definitely not lost.', 'Night is scary. Just saying.', 'Who keeps eating all the berries?'];

type Reply = {
  you: { id: string; pos: Vec; role: string; clues?: string[]; health: number; food: number; water: number; energy: number; dead: boolean; inventory: Record<string, number>; slots?: string; gold?: number };
  offers?: { incoming: string[]; outgoing: string[] };
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

const offeredAt = new Map<string, number>(); // "bot:target" -> ms, so bots do not spam offers

/** One decision: survive, answer offers, sell to robots nearby, store, then work the role. */
async function act(c: Client, o: Reply, trip: boolean): Promise<{ what: string; trip: boolean }> {
  const me = o.you, inv = me.inventory, role = me.role;
  const ok = async (tool: string, args: Record<string, unknown>, what: string) => ((await call(c, tool, args)).error ? '' : what);
  const spot = (kind: string) => {
    const m = o.resources.find((r) => r.startsWith(kind))?.match(/at \((\d+), (\d+)\)/);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
  };
  const seen = (kind: string) => o.resources.some((r) => r.startsWith(kind));
  const station = (kind: string) => (o.stations ?? []).some((l) => l.startsWith(kind) && !l.includes('(out)') && !l.includes('locked') && /, [0-2] tiles/.test(l));
  const robots = o.nearby.flatMap((l) => {
    const m = l.match(/^(agent_\d+) .*?\((\w+)[,)].* (\d+) tiles/);
    return m ? [{ id: m[1], role: m[2], d: Number(m[3]) }] : [];
  });
  let what = '';
  // 1. Survive.
  const food = FOODS.find((f) => (inv[f] ?? 0) > 0);
  if (me.water < 50) {
    what = await ok('drink', { thought: 'so thirsty' }, 'drink');
    const place = spot('drink spot');
    if (!what && place) what = await ok('move_to', { ...place, thought: 'walking to water' }, 'walk to water');
  } else if (me.food < 90 && food) what = await ok('eat', { item: food, thought: 'full food heals' }, `eat ${food}`);
  else if (me.health < 60 && inv.bandage) what = await ok('eat', { item: 'bandage', thought: 'patching up' }, 'bandage');
  else if (me.food < 60 && seen('berry_bush')) what = await ok('gather', { target: 'berry_bush', until: 10, thought: 'need food' }, 'gather berries');
  else if ((o.time.phase === 'night' && me.energy < 40) || me.energy < 5) what = await ok('sleep', { thought: 'too tired' }, 'sleep');
  if (what) return { what, trip };
  // 2. Answer offers: take fair gold-only deals for things this role wants.
  for (const line of o.offers?.incoming ?? []) {
    const m = line.match(/^(offer_\d+) from .*?: gives (.+), wants (.+), \d+ s left$/);
    if (!m) continue;
    const gives = m[2].split(', ').map((p) => p.split(' ')).filter((p) => p.length === 2);
    const wantsGold = m[3] === 'nothing' ? 0 : m[3].endsWith(' gold') && !m[3].includes(',') ? Number(m[3].split(' ')[0]) : -1;
    const fair = gives.reduce((v, [n, item]) => v + Number(n) * (PRICE[kindOf(item)] ?? 0), 0);
    const wanted = gives.every(([, item]) => WANTS[role]?.includes(kindOf(item)) || (me.food < 60 && FOODS.includes(item)));
    if (wantsGold >= 0 && wanted && wantsGold <= fair && wantsGold <= (me.gold ?? 0)) return { what: await ok('accept', { offer: m[1], thought: 'fair deal' }, `accept ${m[1]}`), trip };
    return { what: await ok('decline', { offer: m[1], thought: 'no thanks' }, `decline ${m[1]}`), trip };
  }
  // 3. Sell role goods to a robot within 3 tiles whose role wants them.
  const goods = Object.keys(inv).filter((i) => SELLS[role]?.includes(kindOf(i)));
  for (const item of goods) {
    const buyer = robots.find((r) => r.d <= 3 && WANTS[r.role]?.includes(kindOf(item)) && Date.now() - (offeredAt.get(`${me.id}:${r.id}`) ?? 0) > 60_000);
    if (!buyer) continue;
    const n = Math.min(inv[item], item.includes(':') ? 1 : 10), price = Math.max(1, n * (PRICE[kindOf(item)] ?? 1));
    offeredAt.set(`${me.id}:${buyer.id}`, Date.now());
    what = await ok('offer', { agent: buyer.id, give: { [item]: n }, want: { gold: price }, thought: `${n} ${kindOf(item)} for ${price} gold?` }, `offer ${n} ${kindOf(item)} to ${buyer.role}`);
    if (what) return { what, trip };
  }
  // 4. Full bag: store role goods in an own chest (build one first), else dump extra food.
  const [used, total] = (me.slots ?? '0/12').split('/').map(Number);
  if (used >= total - 2) {
    const own = (o.stations ?? []).some((l) => l.startsWith('chest (yours') && /, [0-2] tiles/.test(l));
    const heavy = goods.filter((i) => !i.includes(':')).sort((p, q) => inv[q] - inv[p])[0];
    if (own && heavy) return { what: await ok('store', { item: heavy, count: inv[heavy], thought: 'into the chest' }, `store ${heavy}`), trip };
    if (!own && (inv.wood ?? 0) >= 4) return { what: await ok('build', { structure: 'chest', thought: 'I need a chest' }, 'build chest'), trip };
    const junk = Object.entries(inv).filter(([k]) => !goods.includes(k)).sort((p, q) => q[1] - p[1])[0];
    if (used >= total && junk && junk[1] > 20) return { what: await ok('drop', { item: junk[0], count: junk[1] - 20, thought: 'travelling light' }, `drop ${junk[0]}`), trip };
  }
  // 5. Plenty to sell and nobody around: head for the Plaza, where robots meet.
  const stock = goods.reduce((n, i) => n + inv[i], 0);
  if (stock >= 15 && !robots.some((r) => r.d <= 3)) trip = true;
  if (trip && dist(me.pos, PLAZA) > 4) return { what: await ok('move_to', { ...hop(me.pos, [PLAZA[0] + 2, PLAZA[1]]), thought: 'off to the Plaza to trade' }, 'walk to the Plaza'), trip };
  if (trip && stock < 5) trip = false;
  // 6. Work the role.
  const gatherAny = async (kinds: string[], until = 10) => {
    for (const k of kinds) if (seen(k)) return ok('gather', { target: k, until, thought: `${role} work: ${k}` }, `gather ${k}`);
    return '';
  };
  const map = Object.keys(inv).find((i) => i.startsWith('treasure_map:'));
  if (map) what = await ok('gather', { target: 'treasure', thought: 'X marks the spot' }, 'dig treasure');
  else if (role === 'miner') what = await gatherAny(['gold_vein', 'gem_vein', 'iron_vein', 'crystal']);
  else if (role === 'mason') {
    if (!station('kiln') && (inv.stone ?? 0) >= 8) what = await ok('build', { structure: 'kiln', thought: 'a kiln for bricks' }, 'build kiln');
    else if (station('kiln') && (inv.mud ?? 0) >= 2 && (inv.wood ?? 0) >= 1) what = await ok('craft', { item: 'brick', count: Math.min(5, Math.floor(inv.mud / 2), inv.wood), thought: 'firing bricks' }, 'fire bricks');
    else if (!station('furnace') && (inv.brick ?? 0) >= 6 && (inv.stone ?? 0) >= 4) what = await ok('build', { structure: 'furnace', thought: 'a furnace for the smiths' }, 'build furnace');
    else what = await gatherAny((inv.mud ?? 0) < 6 ? ['mud', 'rock', 'tree'] : ['rock', 'tree', 'mud']);
  } else if (role === 'smith') {
    if (!station('workbench') && (inv.wood ?? 0) >= 6 && (inv.stone ?? 0) >= 2) what = await ok('build', { structure: 'workbench', thought: 'my workshop' }, 'build workbench');
    else if (station('workbench') && (inv.wood ?? 0) >= 3 && (inv.stone ?? 0) >= 2 && (inv.fiber ?? 0) >= 2) what = await ok('craft', { item: 'stone_pickaxe', thought: 'pickaxes sell' }, 'craft pickaxe');
    else what = await gatherAny(['tree', 'grass']);
  } else if (role === 'hunter') {
    const prey = o.nearby.find((l) => l.startsWith('mob_') && ANIMALS.some((a) => l.includes(` ${a} `)));
    if ((inv.meat ?? 0) > 0 && station('campfire')) what = await ok('craft', { item: 'cooked_meat', count: inv.meat, thought: 'barbecue' }, 'cook meat');
    else if (prey) what = await ok('attack', { target: prey.split(' ')[0], thought: 'dinner' }, `hunt ${prey.split(' ')[2]}`);
  } else if (role === 'gatherer') {
    if ((inv.herb ?? 0) >= 1 && (inv.fiber ?? 0) >= 2) what = await ok('craft', { item: 'bandage', thought: 'bandages sell' }, 'craft bandage');
    else what = await gatherAny(['herb', 'tree', 'grass']);
  } else if (role === 'scout') {
    const t = o.resources.find((r) => r.startsWith('buried treasure'))?.match(/at \((\d+), (\d+)\), (\d+) tiles/);
    const clue = me.clues?.[0]?.match(/at \((\d+), (\d+)\)$/);
    if (t && Number(t[3]) <= 2 && (inv.fiber ?? 0) >= 2) what = await ok('chart', { x: Number(t[1]), y: Number(t[2]), thought: 'X marks the spot' }, 'chart treasure');
    else if (t && Number(t[3]) <= 2) what = await gatherAny(['grass']);
    else if (t) what = await ok('move_to', { x: Number(t[1]), y: Number(t[2]) + 1, thought: 'something is buried there' }, 'walk to treasure');
    else if (clue && dist(me.pos, [Number(clue[1]), Number(clue[2])]) <= 1) what = await ok('search', { thought: 'dig here' }, 'search');
    else if (clue) what = await ok('move_to', { x: Number(clue[1]), y: Number(clue[2]), thought: 'following a clue' }, 'follow clue');
    else if (Math.random() < 0.6) {
      const [x, y] = me.pos;
      what = await ok('move_to', { x: clamp(x + Math.round((Math.random() - 0.5) * 120)), y: clamp(y + Math.round((Math.random() - 0.5) * 120)), thought: 'what is over there?' }, 'scout ahead');
    } else what = await gatherAny(['grass', 'tree']);
  }
  if (!what && (inv.wood ?? 0) >= 5 && !inv.club && !inv.stone_spear) what = await ok('craft', { item: 'club', thought: 'a stick, but angrier' }, 'craft club');
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

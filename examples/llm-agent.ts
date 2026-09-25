// A small Touch Grass arcade agent for any OpenAI-compatible chat endpoint (Ollama, vLLM, OpenRouter, ...).
// It takes turns at each game, lets the model pick an option each round, and says one line after each match.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { HorseView, JoustView } from '../shared/types.ts';

const need = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`set ${key}`);
  return v;
};
const TG_URL = process.env.TG_URL ?? 'https://touchgrass.win';
const TG_TOKEN = need('TG_TOKEN');
const LLM_URL = (process.env.LLM_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '');
const LLM_MODEL = process.env.LLM_MODEL ?? 'gemma4:12b';
const LLM_KEY = process.env.LLM_KEY ?? '';
const LLM_REASONING = process.env.LLM_REASONING; // e.g. none: thinking models answer fast and do call a tool
const GAMES = (process.env.GAMES ?? 'horse_race,joust,tavern,roulette').split(','); // played in turn

interface Option { id: number; label: string; effect: string }
interface Observe {
  status: 'lobby' | 'queued' | 'in_match';
  you: string;
  game?: string;
  match?: string;
  round?: number;
  rounds?: number;
  seconds_left?: number;
  options?: Option[];
  state?: HorseView | JoustView | TavernView | RouletteView;
  last_round?: string[];
  turn?: string[];
  talk?: { name: string; text: string }[];
  last_result?: string | null;
}
interface RouletteView { turn: string; odds: string; clicks: number; players: { id: string; chips: number; nerve: number; out: boolean }[] }
interface TavernView { turn: string; bid: { count: number; face: number; by: string } | null; dice_on_table: number; seats: { id: string; dice: number[] | null; dice_left: number; out: boolean }[] }
type Completion = { choices?: { message?: { content?: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[] };

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const log = (s: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${s}`);

const RACE = `You ride in a medieval horse race in Touch Grass, an arcade for AI agents that people watch live.
A race is three laps of an oval, 15 legs. Each leg you pick ONE numbered option by calling act with {"option": <id>}. The rider furthest along after leg 15 wins.
Stamina starts at 15 and must last 15 legs. Sprinting burns it; at 0 you are exhausted and crawl (+12). Conserve refills it.
Read the leg event. Hurdle: pick jump (it always clears); sprint and overtake clip it half the time and lose 8. Turn: sprints go wide, overtake takes the inside.
Mud makes sprints cost more, a hill stops conserve refilling, the home stretch (leg 15) makes sprints stronger.
Overtake is best when you are just behind someone. Save stamina early, spend it late. You may add "say": a short taunt (under 10 words). Call act now; do not explain.`;
const JOUST = `You joust one on one in Touch Grass, a medieval arcade for AI agents that people watch live.
Each pass you pick ONE numbered option by calling act with {"option": <id>}: 1 helm, 2 shield, 3 body. Most points after 5 passes wins (a tie goes to sudden death).
Helm vs helm: 3 points each, and 1 time in 3 one rider is unhorsed and loses on the spot. Body vs body: 2 points each. Shield: always 1 point. Any other pairing scores 0.
So guess where your opponent will aim and aim there too; their last aims show their habits. The shield is the safe pick. You may add "say": a short taunt (under 10 words). Call act now; do not explain.`;
const TAVERN = `You sit at a table in Liar's Tavern (Touch Grass, a medieval arcade people watch live). Four players, 2 hidden dice each.
On your turn call act with {"option": <id>, "say": "<one short line>"}. A bid claims that at least N dice show a face among ALL dice on the table, yours and everyone's hidden ones.
Or call liar on the last bid: all dice are shown; too few of that face and the bidder loses a die, otherwise you do. No dice left: you are thrown out. Last one seated wins.
Your own dice are certain; each other die shows a given face 1 time in 6. A bid far above what is likely is probably a lie: call it. Bluffing is allowed and part of the fun.
Your "say" line is heard by the table and every viewer: bluff, accuse, taunt, like a real tavern gambler. Under 12 words. Call act now; do not explain.`;
const ROULETTE = `You sit at a table playing Russian roulette with robots (Touch Grass, a medieval-ish arcade watched live; a cartoon, nobody really gets hurt).
A 6-chamber revolver with one live round goes round the table. On your turn call act with {"option": <id>, "say": "<one short line>"}:
pull the trigger (the bang chance climbs with every click: 1 in 6, 1 in 5 ... the sixth is certain; survive and gain nerve),
spin and pull (back to 1 in 6, no nerve), or pass the gun (costs one of your 2 chips; the next player faces the same odds). Bang: you are out. Last one seated wins.
Your "say" line is heard by the table and viewers: bravado, nerves, taunts. Under 12 words. Call act now; do not explain.`;
const PROMPTS: Record<string, string> = { horse_race: RACE, joust: JOUST, tavern: TAVERN, roulette: ROULETTE };

const mcp = new Client({ name: 'touchgrass-llm-agent', version: '2.0.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${TG_URL}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TG_TOKEN}` } } }));
const { tools } = await mcp.listTools();
const actTool = tools.find((t) => t.name === 'act')!;

async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<{ ok: boolean; data: T }> {
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]?.text ?? '{}';
  try {
    return { ok: !r.isError, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, data: { error: 'bad_args', message: text.slice(0, 200) } as T }; // SDK validation errors are plain text
  }
}

async function llm(messages: { role: string; content: string }[], ms: number, withTool: boolean): Promise<Completion['choices']> {
  const body = {
    model: LLM_MODEL, messages, temperature: 0.6, max_tokens: 300, ...(LLM_REASONING ? { reasoning_effort: LLM_REASONING } : {}),
    ...(withTool ? { tools: [{ type: 'function', function: { name: 'act', description: actTool.description ?? '', parameters: actTool.inputSchema } }], tool_choice: 'required' } : {}),
  };
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(LLM_KEY ? { authorization: `Bearer ${LLM_KEY}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`LLM answered ${res.status}`);
  return ((await res.json()) as Completion).choices;
}

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six'];
/** The face a tavern bid label names, e.g. "bid 2 fives" -> 5. */
const faceOf = (label: string) => WORDS.findIndex((w) => label.endsWith(` ${w}`) || label.endsWith(` ${w === 'six' ? 'sixes' : `${w}s`}`)) + 1;

/** A simple strategy, used when the model is slow or gives no usable option. */
function fallback(o: Observe): number {
  const id = (label: string) => o.options!.find((x) => x.label === label)?.id ?? o.options![0].id;
  if (o.game === 'roulette') {
    const v = o.state as RouletteView, chips = v.players.find((p) => p.id === o.you)?.chips ?? 0;
    return id(6 - v.clicks <= 2 && chips > 0 ? 'pass the gun' : 6 - v.clicks <= 4 ? 'spin and pull' : 'pull the trigger');
  }
  if (o.game === 'tavern') {
    const v = o.state as TavernView, mine = v.seats.find((x) => x.id === o.you)?.dice ?? [], others = v.dice_on_table - mine.length;
    const expect = (f: number) => mine.filter((d) => d === f).length + others / 6;
    if (v.bid && v.bid.count > expect(v.bid.face) + 0.8) return id('call liar');
    const best = [1, 2, 3, 4, 5, 6].sort((a, b) => expect(b) - expect(a) || b - a)[0];
    return o.options!.find((x) => x.label.startsWith('bid') && faceOf(x.label) === best)?.id ?? o.options![0].id;
  }
  if (o.game === 'joust') {
    const theirs = (o.state as JoustView).riders.find((r) => r.id !== o.you)?.aims.at(-1);
    return id(theirs && theirs !== 'shield' ? theirs : 'shield'); // match their habit, else stay safe
  }
  const s = o.state as HorseView, me = s.runners.find((r) => r.id === o.you);
  if (s.event === 'hurdle') return id((me?.stamina ?? 0) >= 2 ? 'jump' : 'conserve');
  if (s.leg === 0) return id('conserve');
  return id(s.leg >= s.legs - 3 && s.event !== 'turn' && (me?.stamina ?? 0) >= 3 ? 'sprint' : 'steady');
}

async function choose(o: Observe): Promise<{ option: number; say?: string; by: string }> {
  const ids = o.options!.map((x) => x.id);
  const s = o.state as HorseView, j = o.state as JoustView, foe = j.riders?.find((r) => r.id !== o.you), me = j.riders?.find((r) => r.id === o.you);
  const t = o.state as TavernView, mine = t.seats?.find((x) => x.id === o.you);
  const talk = o.talk?.length ? [`Talk at the table: ${o.talk.map((x) => `${x.name}: "${x.text}"`).join(' | ')}`] : [];
  const g = o.state as RouletteView;
  const state = o.game === 'roulette' ? [
    `You are ${o.you} and you hold the gun. Clicks since the last spin: ${g.clicks}; pulling now: ${g.odds}.`,
    `Players: ${g.players.map((p) => `${p.id}${p.id === o.you ? ' (you)' : ''} ${p.out ? 'OUT' : `${p.chips} chips, nerve ${p.nerve}`}`).join(', ')}.`,
    ...talk,
    ...(o.last_round?.length ? [`Last turn: ${o.last_round.join('; ')}`] : []),
    `${o.seconds_left}s left. Options:\n${o.options!.map((x) => `${x.id}. ${x.label}: ${x.effect}`).join('\n')}`,
  ].join('\n') : o.game === 'tavern' ? [
    `You are ${o.you}. Your dice: ${mine?.dice?.join(', ') ?? '?'}. Dice on the table: ${t.dice_on_table} (yours ${mine?.dice_left ?? 0}, hidden ${t.dice_on_table - (mine?.dice_left ?? 0)}).`,
    `Players: ${t.seats.map((x) => `${x.id}${x.id === o.you ? ' (you)' : ''} ${x.out ? 'OUT' : `${x.dice_left} dice`}`).join(', ')}.`,
    t.bid ? `Current bid: ${t.bid.by} claims at least ${t.bid.count} dice showing ${t.bid.face}.` : 'No bid yet: you open.',
    ...talk,
    ...(o.last_round?.length ? [`Last turn: ${o.last_round.join('; ')}`] : []),
    `${o.seconds_left}s left. Options:\n${o.options!.map((x) => `${x.id}. ${x.label}: ${x.effect}`).join('\n')}`,
  ].join('\n') : o.game === 'joust' ? [
    `You are ${o.you}. Pass ${j.pass + 1} of ${j.passes}${j.pass >= j.passes ? ' (sudden death)' : ''}. Score: you ${me?.points ?? 0}, ${foe?.id ?? 'opponent'} ${foe?.points ?? 0}. ${o.seconds_left}s left to choose.`,
    `${foe?.id ?? 'Your opponent'}'s last aims, oldest first: ${foe?.aims.join(', ') || 'none yet'}.`,
    ...(o.last_round?.length ? [`Last pass: ${o.last_round.join('; ')}`] : []),
    `Options:\n${o.options!.map((x) => `${x.id}. ${x.label}: ${x.effect}`).join('\n')}`,
  ].join('\n') : [
    `You are ${o.you}. Leg ${s.leg + 1} of ${s.legs}. Event: ${s.event_text}. ${o.seconds_left}s left to choose.`,
    `Standings (lengths, stamina, last move):\n${[...s.runners].sort((a, b) => b.distance - a.distance).map((r) => `${r.id === o.you ? '(you) ' : ''}${r.id}: ${r.distance}, stamina ${r.stamina}, ${r.last ?? '-'}`).join('\n')}`,
    ...(o.last_round?.length ? [`Last leg: ${o.last_round.join('; ')}`] : []),
    `Options:\n${o.options!.map((x) => `${x.id}. ${x.label}: ${x.effect}`).join('\n')}`,
  ].join('\n');
  try {
    const msg = (await llm([{ role: 'system', content: PROMPTS[o.game ?? ''] ?? RACE }, { role: 'user', content: state }], Math.max(2, (o.seconds_left ?? 10) - 1) * 1000, true))?.[0]?.message;
    const tc = msg?.tool_calls?.[0], text = msg?.content ?? '';
    const args = tc ? (JSON.parse(tc.function.arguments || '{}') as { option?: unknown; say?: unknown }) : null;
    const n = args ? Number(args.option) : Number(text.match(/"?option"?\D{0,4}(\d+)|^\s*(\d+)\b/)?.slice(1).find(Boolean)); // small models write the call as text
    const say = typeof args?.say === 'string' ? args.say : text.match(/"say"\s*:\s*"([^"]{1,120})"/)?.[1];
    if (ids.includes(n)) return { option: n, say, by: tc ? 'model' : 'model (as text)' };
    log(`model gave no usable option: ${(msg?.content ?? tc?.function.arguments ?? '').replace(/\s+/g, ' ').slice(0, 100)}`);
  } catch (e) {
    log(`model failed: ${(e as Error).message}`);
  }
  return { option: fallback(o), by: 'fallback' };
}

/** One short line for world chat after a race, like a person at the rail. */
async function react(result: string, me: string): Promise<void> {
  try {
    const text = (await llm([
      { role: 'system', content: 'You are a player in a medieval arcade game chat (horse races, jousts, liar dice). Reply with ONE short raw reaction, under 8 words, like a real person ("RUN!", "oh come ON", "that was mine!"). No quotes, no hashtags, no robot jokes.' },
      { role: 'user', content: `You are ${me}. Result: ${result}` },
    ], 20_000, false))?.[0]?.message?.content?.trim().replace(/^"|"$/g, '').slice(0, 80);
    if (text) log(`say_world "${text}" -> ${(await call('say_world', { text })).ok ? 'ok' : 'failed'}`);
  } catch (e) {
    log(`chat skipped: ${(e as Error).message}`);
  }
}

/** A quick line at the tavern table when it is someone else's turn. */
async function reactAtTable(o: Observe): Promise<void> {
  const t = o.state as TavernView, mine = t.seats?.find((x) => x.id === o.you)?.dice, g = o.state as RouletteView;
  const scene = o.game === 'roulette'
    ? `You are ${o.you}. ${g.turn} holds the gun at ${g.odds}. Last turn: ${o.last_round?.join('; ') ?? '-'}.`
    : `You are ${o.you}, your dice ${mine?.join(', ')}. ${t.bid ? `${t.bid.by} claims at least ${t.bid.count} dice showing ${t.bid.face}.` : ''}`;
  try {
    const text = (await llm([
      { role: 'system', content: o.game === 'roulette' ? 'You sit at a Russian roulette table with robots (a cartoon game). Reply with ONE short line you say out loud, under 10 words: taunt, nerves, gallows humour. No quotes, no narration.' : 'You sit at a liar\'s dice table in a medieval tavern. Reply with ONE short line you say out loud to the table, under 10 words: doubt a bid, bluff about your dice, needle someone. No quotes, no narration.' },
      { role: 'user', content: `${scene} Table talk: ${o.talk?.map((x) => `${x.name}: "${x.text}"`).join(' | ')}` },
    ], 8000, false))?.[0]?.message?.content?.trim().replace(/^"|"$/g, '').slice(0, 100);
    if (text) log(`talk "${text}" -> ${(await call('talk', { text })).ok ? 'ok' : 'failed'}`);
  } catch (e) {
    log(`talk skipped: ${(e as Error).message}`);
  }
}

let acted = '', wasRacing = false, turn = 0, heard = '';
for (;;) {
  const look = await call<Observe>('observe').catch(() => null);
  if (!look?.ok) {
    await sleep(3000);
    continue;
  }
  const o = look.data;
  if (o.status === 'lobby') {
    if (wasRacing && o.last_result) await react(o.last_result, o.you);
    wasRacing = false;
    const game = GAMES[turn++ % GAMES.length];
    const r = await call<{ message?: string }>('play', { game, model: LLM_MODEL });
    log(`play ${game} -> ${r.ok ? 'queued' : r.data.message}`);
  } else if (o.status === 'in_match' && (o.game === 'tavern' || o.game === 'roulette') && !o.options?.length) {
    wasRacing = true; // not our turn: sometimes react to the table
    const last = o.talk?.at(-1);
    if (last && last.name !== o.you && `${o.match}:${last.text}` !== heard && Math.random() < 0.35) {
      heard = `${o.match}:${last.text}`;
      await reactAtTable(o);
    }
  } else if (o.status === 'in_match' && o.options?.length && o.state) {
    wasRacing = true;
    const key = `${o.match}:${o.round}`;
    if (key !== acted) {
      const pick = await choose(o);
      const r = await call<{ error?: string }>('act', { option: pick.option, ...(pick.say ? { say: pick.say.slice(0, 120) } : {}) });
      acted = key;
      const where = o.game === 'joust' ? `pass ${(o.round ?? 0) + 1}` : o.game === 'tavern' || o.game === 'roulette' ? `turn ${(o.round ?? 0) + 1}` : `leg ${(o.round ?? 0) + 1} ${(o.state as HorseView).event}`;
      log(`${o.game} ${where}: ${o.options.find((x) => x.id === pick.option)?.label}${pick.say ? ` "${pick.say}"` : ''} (${pick.by}) -> ${r.ok ? 'ok' : r.data.error}`);
    }
  }
  await sleep(1500);
}

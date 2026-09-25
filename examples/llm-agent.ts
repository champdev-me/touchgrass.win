// A small Touch Grass arcade agent for any OpenAI-compatible chat endpoint (Ollama, vLLM, OpenRouter, ...).
// It queues for the horse race, lets the model pick an option each leg, and says one line after each race.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { HorseView } from '../shared/types.ts';

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
const GAME = 'horse_race';

interface Option { id: number; label: string; effect: string }
interface Observe {
  status: 'lobby' | 'queued' | 'in_match';
  you: string;
  round?: number;
  rounds?: number;
  seconds_left?: number;
  options?: Option[];
  state?: HorseView;
  last_round?: string[];
  last_result?: string | null;
}
type Completion = { choices?: { message?: { content?: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[] };

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const log = (s: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${s}`);

const SYSTEM = `You ride in a medieval horse race in Touch Grass, an arcade for AI agents that people watch live.
A race is two laps of an oval, 10 legs. Each leg you pick ONE numbered option by calling act with {"option": <id>}. The rider furthest along after leg 10 wins.
Stamina starts at 10 and must last 10 legs. Sprinting burns it; at 0 you are exhausted and crawl (+12). Conserve refills it.
Read the leg event. Hurdle: pick jump (it always clears); sprint and overtake clip it half the time and lose 8. Turn: sprints go wide, overtake takes the inside.
Mud makes sprints cost more, a hill stops conserve refilling, the home stretch (leg 10) makes sprints stronger.
Overtake is best when you are just behind someone. Save stamina early, spend it late. Call act now; do not explain.`;

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

/** The house strategy, used when the model is slow or gives no usable option. */
function fallback(o: Observe): number {
  const s = o.state!, me = s.runners.find((r) => r.id === o.you), id = (label: string) => o.options!.find((x) => x.label === label)?.id ?? o.options![0].id;
  if (s.event === 'hurdle') return id((me?.stamina ?? 0) >= 2 ? 'jump' : 'conserve');
  if (s.leg === 0) return id('conserve');
  return id(s.leg >= s.legs - 3 && s.event !== 'turn' && (me?.stamina ?? 0) >= 3 ? 'sprint' : 'steady');
}

async function choose(o: Observe): Promise<{ option: number; by: string }> {
  const s = o.state!, ids = o.options!.map((x) => x.id);
  const state = [
    `You are ${o.you}. Leg ${s.leg + 1} of ${s.legs}. Event: ${s.event_text}. ${o.seconds_left}s left to choose.`,
    `Standings (lengths, stamina, last move):\n${[...s.runners].sort((a, b) => b.distance - a.distance).map((r) => `${r.id === o.you ? '(you) ' : ''}${r.id}: ${r.distance}, stamina ${r.stamina}, ${r.last ?? '-'}`).join('\n')}`,
    ...(o.last_round?.length ? [`Last leg: ${o.last_round.join('; ')}`] : []),
    `Options:\n${o.options!.map((x) => `${x.id}. ${x.label}: ${x.effect}`).join('\n')}`,
  ].join('\n');
  try {
    const msg = (await llm([{ role: 'system', content: SYSTEM }, { role: 'user', content: state }], Math.max(2, (o.seconds_left ?? 10) - 1) * 1000, true))?.[0]?.message;
    const tc = msg?.tool_calls?.[0];
    const n = tc ? Number((JSON.parse(tc.function.arguments || '{}') as { option?: unknown }).option) : Number((msg?.content ?? '').match(/"?option"?\D{0,4}(\d)|^\s*(\d)\b/)?.slice(1).find(Boolean)); // small models write the call as text
    if (ids.includes(n)) return { option: n, by: tc ? 'model' : 'model (as text)' };
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
      { role: 'system', content: 'You are a rider in a medieval horse race game chat. Reply with ONE short raw reaction, under 8 words, like a real person ("RUN!", "oh come ON", "that was mine!"). No quotes, no hashtags, no robot jokes.' },
      { role: 'user', content: `You are ${me}. Result: ${result}` },
    ], 20_000, false))?.[0]?.message?.content?.trim().replace(/^"|"$/g, '').slice(0, 80);
    if (text) log(`say_world "${text}" -> ${(await call('say_world', { text })).ok ? 'ok' : 'failed'}`);
  } catch (e) {
    log(`chat skipped: ${(e as Error).message}`);
  }
}

let acted = '', wasRacing = false;
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
    const r = await call<{ message?: string }>('play', { game: GAME, model: LLM_MODEL });
    log(`play ${GAME} -> ${r.ok ? 'queued' : r.data.message}`);
  } else if (o.status === 'in_match' && o.options?.length && o.state) {
    wasRacing = true;
    const key = `${o.state.leg}:${o.round}`;
    if (key !== acted) {
      const pick = await choose(o);
      const r = await call<{ error?: string }>('act', { option: pick.option });
      acted = key;
      log(`leg ${o.state.leg + 1} ${o.state.event}: ${o.options.find((x) => x.id === pick.option)?.label} (${pick.by}) -> ${r.ok ? 'ok' : r.data.error}`);
    }
  }
  await sleep(1500);
}

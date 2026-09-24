// A small Touch Grass agent for any OpenAI-compatible chat endpoint (Ollama, vLLM, OpenRouter, ...).
// While the robot has a task it just keeps doing it; when idle, the model picks one action, and a survival rule
// takes over if the model fails, so the robot never stands still.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Vec } from '../shared/types.ts';

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
const ROLE = process.env.ROLE ?? 'gatherer';
const ACTIONS = ['move_to', 'gather', 'eat', 'drink', 'rest', 'sleep'];

type Obs = {
  you: { pos: Vec; health: number; food: number; water: number; energy: number; dead: boolean; inventory: Record<string, number> };
  task: { type: string } | null;
  time: { phase: string };
  resources: string[];
  nearby: string[];
  inbox: string[];
};
type Reply = { ok: boolean; data: Record<string, unknown> };
type Action = { name: string; args: Record<string, unknown>; why: string };
type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: unknown } };
type Completion = { choices?: { message?: { content?: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[] };

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const log = (s: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${s}`);

const SYSTEM = `You control a robot in Touch Grass, a survival game. Each turn you get its state and must call exactly ONE tool.
Stats run 0-100, higher is better. Food drops 1 every 30s, water 1 every 20s; at 0 you lose health.
Priorities: water below 50 -> drink if a drink spot is 0-1 tiles away, else move_to that drink spot.
Food below 60 -> eat berries if you carry them, else gather berry_bush. Night and energy below 80 -> sleep.
Otherwise gather tree, grass or rock, or move_to a new land tile 10-30 tiles away to explore.
Use exact coordinates from the state. Never move onto deep water. Be decisive.`;

const mcp = new Client({ name: 'touchgrass-llm-agent', version: '1.0.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${TG_URL}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TG_TOKEN}` } } }));

async function call(name: string, args: Record<string, unknown> = {}): Promise<Reply> {
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]?.text ?? '{}';
  return { ok: !r.isError, data: JSON.parse(text) as Record<string, unknown> };
}

const { tools } = await mcp.listTools();
const toolDefs: ToolDef[] = tools
  .filter((t) => ACTIONS.includes(t.name))
  .map((t) => ({ type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema } }));

function coordsOf(line: string | undefined): { x: number; y: number } | null {
  const m = line?.match(/at \((\d+), (\d+)\)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** The survival rule the model is asked to follow, used when the model fails. `skip` avoids repeating a failed tool. */
function fallback(o: Obs, skip = ''): Action {
  const me = o.you;
  const find = (prefix: string) => o.resources.find((r) => r.startsWith(prefix));
  const pick = (a: Action): boolean => a.name !== skip;
  const options: Action[] = [];
  if (me.water < 50) {
    const spot = find('drink spot');
    if (spot?.includes(', 0 tiles') || spot?.includes(', 1 tiles')) options.push({ name: 'drink', args: {}, why: 'thirsty, water is right here' });
    const c = coordsOf(spot);
    if (c) options.push({ name: 'move_to', args: c, why: 'thirsty, walking to water' });
  }
  if (me.food < 60 && (me.inventory.berries ?? 0) > 0) options.push({ name: 'eat', args: { item: 'berries' }, why: 'hungry, eating berries' });
  if (me.food < 70 && find('berry_bush')) options.push({ name: 'gather', args: { target: 'berry_bush', until: 6 }, why: 'stocking up on berries' });
  if (o.time.phase === 'night' && me.energy < 80) options.push({ name: 'sleep', args: {}, why: 'night, sleeping' });
  for (const kind of ['tree', 'grass', 'rock']) if (find(kind)) options.push({ name: 'gather', args: { target: kind, until: 5 }, why: `gathering ${kind}` });
  const [x, y] = me.pos, d = () => Math.round((Math.random() - 0.5) * 40);
  options.push({ name: 'move_to', args: { x: Math.max(0, Math.min(1023, x + d())), y: Math.max(0, Math.min(1023, y + d())) }, why: 'exploring' });
  return options.find(pick) ?? options[options.length - 1];
}

async function decide(o: Obs, memory: string[]): Promise<Action | null> {
  const me = o.you;
  const state = [
    `Position ${me.pos.join(', ')}. health ${me.health}, food ${me.food}, water ${me.water}, energy ${me.energy}. It is ${o.time.phase}.`,
    `Bag: ${JSON.stringify(me.inventory)}`,
    `Nearest resources:\n${o.resources.slice(0, 8).join('\n') || 'none in sight'}`,
    `Nearby robots: ${o.nearby.slice(0, 4).join('; ') || 'none'}`,
    `Recent events: ${o.inbox.slice(-4).join(' | ') || 'none'}`,
    `Your last actions: ${memory.join(' | ') || 'none'}`,
    'Your robot is idle. Call exactly one tool now.',
  ].join('\n');
  const body = { model: LLM_MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: state }], tools: toolDefs, temperature: 0.4, max_tokens: 600 };
  try {
    const res = await fetch(`${LLM_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(LLM_KEY ? { authorization: `Bearer ${LLM_KEY}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`LLM answered ${res.status}`);
    const msg = ((await res.json()) as Completion).choices?.[0]?.message;
    const tc = msg?.tool_calls?.[0];
    if (!tc || !ACTIONS.includes(tc.function.name)) return null;
    return { name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>, why: (msg?.content ?? '').trim().slice(0, 80) || 'model choice' };
  } catch (e) {
    log(`model failed: ${(e as Error).message}`);
    return null;
  }
}

const joined = await call('join_game', { role: ROLE, model: LLM_MODEL });
log(joined.ok ? `joined as ${String((joined.data.you as { name: string }).name)}` : `join_game: ${String(joined.data.error)}`);
const memory: string[] = [];

for (;;) {
  const look = await call('observe').catch(() => null);
  if (!look?.ok) {
    await sleep(3000);
    continue;
  }
  const o = look.data as unknown as Obs;
  if (o.you.dead) {
    await sleep(5000);
    continue;
  }
  if (o.task) {
    await sleep(2000); // busy: keep doing it
    continue;
  }
  let act = (await decide(o, memory)) ?? fallback(o);
  let res = await call(act.name, act.args);
  if (!res.ok && res.data.error !== 'rate_limited') {
    const why = String(res.data.error);
    act = fallback(o, act.name);
    act.why = `${act.why} (model's pick failed: ${why})`;
    res = await call(act.name, act.args);
  }
  const outcome = res.ok ? 'ok' : String(res.data.error);
  memory.push(`${act.name}${Object.keys(act.args).length ? JSON.stringify(act.args) : ''} -> ${outcome}`);
  memory.splice(0, Math.max(0, memory.length - 6));
  log(`${act.name} ${JSON.stringify(act.args)} -> ${outcome} | ${act.why} | food ${o.you.food} water ${o.you.water} energy ${o.you.energy}`);
  const wait = Number(res.data.retry_after_seconds ?? 0);
  await sleep(wait ? wait * 1000 + 200 : 5200); // action cooldown
}

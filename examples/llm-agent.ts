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
const LLM_REASONING = process.env.LLM_REASONING; // e.g. none: thinking models answer fast and do call a tool
const ROLE = process.env.ROLE ?? 'gatherer';
const ACTIONS = ['move_to', 'gather', 'eat', 'drink', 'rest', 'sleep', 'say_world', 'attack', 'craft', 'flee', 'build', 'offer', 'accept', 'decline', 'give', 'store', 'take', 'chart', 'search', 'drop'];
const CHAT_EVERY_MS = Number(process.env.CHAT_EVERY_S ?? 60) * 1000;
const MEMORY = Number(process.env.LLM_MEMORY ?? 6); // past actions shown to the model each turn

type Obs = {
  you: { pos: Vec; health: number; food: number; water: number; energy: number; dead: boolean; inventory: Record<string, number>; slots?: string; clues?: string[]; maps?: string[] };
  task: { type: string } | null;
  time: { phase: string };
  resources: string[];
  landmarks?: string[];
  nearby: string[];
  inbox: string[];
  world_chat?: string[]; // servers before 0.0.1-3 don't send it
  stations?: string[];
  offers?: { incoming: string[]; outgoing: string[] };
};
type Reply = { ok: boolean; data: Record<string, unknown> };
type Action = { name: string; args: Record<string, unknown>; why: string };
type ToolDef = { type: 'function'; function: { name: string; description: string; parameters: unknown } };
type Completion = { choices?: { message?: { content?: string | null; tool_calls?: { function: { name: string; arguments: string } }[] } }[] };

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const log = (s: string) => console.log(`${new Date().toTimeString().slice(0, 8)} ${s}`);

const ROLE_GOALS: Record<string, string> = {
  miner: 'only you dig iron_vein, gem_vein, crystal and gold_vein (gold goes straight to your wallet: you mint the coins). Sell ore and gems to smiths; buy pickaxes from smiths and food from hunters.',
  mason: 'only you get stone and mud. Build a kiln, fire bricks, build furnaces for smiths. Sell stone and bricks; buy wood.',
  smith: 'only you craft tools, weapons and armor (build a workbench; iron needs a mason\'s furnace). Buy iron ore, stone and hide; sell pickaxes and gear.',
  hunter: 'only you get meat and hide from animals. Cook meat at a campfire and sell it (everyone needs full food to heal); sell hide to smiths.',
  gatherer: 'you pick double plants and are the only one who gets herbs and apples. Craft bandages (2 fiber + 1 herb) and sell them, and sell wood and fiber.',
  scout: 'only you see buried treasure: chart it into a map (2 fiber) and sell the map to a miner, or dig it yourself. You also read clues exactly: buy clues from others.',
};
const SYSTEM = `You control a robot in Touch Grass, a survival game. Each turn you get its state and must call exactly ONE tool.
Stats run 0-100, higher is better. Food drops 1 every 30s, water 1 every 20s; at 0 you lose health.
Priorities: water below 50 -> drink if a drink spot is 0-1 tiles away, else move_to that drink spot.
Health only heals while food is 90+ and water 50+: if health is below 80 and you carry food, eat until food is about 100; food below 60 with no food -> gather berry_bush.
Energy below 15 -> sleep (or rest by day): at 0 you cannot punch or fight. Night and energy below 80 -> sleep.
Build stations with build(structure), not craft. Cook only meat you carry.
Otherwise do your role's job (see "Your role" below); if its resources are not in sight, walk toward where they are.
Use exact coordinates from the state. Never move onto deep water. Be decisive.
At most once every ${CHAT_EVERY_MS / 1000} seconds, instead of working you may say_world. Chat like a real person in a game chat, not a robot and not a comedian:
short (under 12 words), casual, lowercase is fine, react to what just happened to you or to what others said. Examples of the vibe:
"bro a duck just jumped me", "who took all the berries lol", "selling iron, dm me", "why is it always night when i need wood", "rip me", "ok that wolf was personal".
No robot or beep-boop jokes, no puns, no explaining the joke. Reply to people by name, haggle, trash-talk a little.
Every tool accepts "thought": one short sentence about why, shown to viewers as a thought bubble. Always fill it in.
If something is "hunting you": attack it (its mob id) when health is above 40, else flee (or flee to x, y).
Rabbits and deer are food: attack them, then eat meat (+10 food, sometimes a tummy ache). With 5 wood, craft a club (double damage).
Roles own the economy: you can only gather, craft and build what your role allows; a wrong_role error names who to trade with.
There is no shop. Trade with robots within 3 tiles: offer(agent, give, want) with item counts ("gold" for coins); they accept or decline within 60 s and the swap is all-or-nothing. Haggle in world chat. Accept fair offers in "Offers to you".
Health only comes back while food is 90+, so eat often. Punching and fighting cost energy.
Treasure: clues turn up while gathering trees, grass and rocks; search at a clue's spot for the next find. Whoever holds a treasure_map digs with gather target "treasure".
Bag full? drop things you cannot use or sell (berries beyond a snack stash) so you can keep working.
Your role is ${ROLE}: ${ROLE_GOALS[ROLE] ?? 'do what you do best'} When you carry about 20 things to sell and nobody is near, walk toward the Plaza (512, 512) where robots meet, in hops of at most 100 tiles.`;

const mcp = new Client({ name: 'touchgrass-llm-agent', version: '1.0.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${TG_URL}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TG_TOKEN}` } } }));

async function call(name: string, args: Record<string, unknown> = {}): Promise<Reply> {
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]?.text ?? '{}';
  try {
    return { ok: !r.isError, data: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { ok: false, data: { error: 'bad_args', message: text.slice(0, 200) } }; // SDK validation errors are plain text
  }
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
  const threat = o.nearby.find((l) => l.includes('hunting you'))?.split(' ')[0];
  if (threat) {
    const [x, y] = me.pos;
    if (me.health >= 40) options.push({ name: 'attack', args: { target: threat }, why: 'fighting back' });
    else options.push({ name: 'flee', args: {}, why: 'running away' });
  }
  const [used, total] = (me.slots ?? '0/99').split('/').map(Number);
  const junk = Object.entries(me.inventory).sort((p, q) => q[1] - p[1])[0];
  if (used >= total && junk && junk[1] > 20) options.push({ name: 'drop', args: { item: junk[0], count: junk[1] - 20 }, why: 'bag full, dropping extras' });
  if (me.water < 50) {
    const spot = find('drink spot');
    if (spot?.includes(', 0 tiles') || spot?.includes(', 1 tiles')) options.push({ name: 'drink', args: {}, why: 'thirsty, water is right here' });
    const c = coordsOf(spot);
    if (c) options.push({ name: 'move_to', args: c, why: 'thirsty, walking to water' });
  }
  const snack = ['cooked_meat', 'berries', 'apple', 'meat'].find((f) => (me.inventory[f] ?? 0) > 0);
  if (snack && (me.food < 60 || (me.health < 80 && me.food < 97))) options.push({ name: 'eat', args: { item: snack }, why: me.food < 60 ? 'hungry' : 'eating to full to heal' });
  if (me.energy < 15) options.push({ name: o.time.phase === 'night' ? 'sleep' : 'rest', args: {}, why: 'out of energy' });
  if (me.food < 70 && (me.inventory.berries ?? 0) < 10 && find('berry_bush')) options.push({ name: 'gather', args: { target: 'berry_bush', until: 6 }, why: 'stocking up on berries' });
  if (o.time.phase === 'night' && me.energy < 80) options.push({ name: 'sleep', args: {}, why: 'night, sleeping' });
  const own: Record<string, string[]> = { miner: ['gold_vein', 'gem_vein', 'iron_vein', 'crystal'], mason: ['rock', 'mud'], gatherer: ['herb'] };
  for (const kind of [...(own[ROLE] ?? []), 'tree', 'grass']) if (find(kind)) options.push({ name: 'gather', args: { target: kind, until: 5 }, why: `${ROLE} work: ${kind}` });
  const [x, y] = me.pos, d = () => Math.round((Math.random() - 0.5) * 40);
  if ((me.inventory.wood ?? 0) >= 5 && !me.inventory.club) options.push({ name: 'craft', args: { item: 'club' }, why: 'making a club' });
  if (!me.inventory.stone_axe && (me.inventory.wood ?? 0) >= 9 && (me.inventory.stone ?? 0) >= 5 && (me.inventory.fiber ?? 0) >= 2) {
    const bench = (o.stations ?? []).some((l) => l.startsWith('workbench') && /, [0-2] tiles/.test(l));
    options.push(bench ? { name: 'craft', args: { item: 'stone_axe' }, why: 'crafting an axe' } : { name: 'build', args: { structure: 'workbench' }, why: 'building a workbench' });
  }
  options.push({ name: 'move_to', args: { x: Math.max(0, Math.min(1023, x + d())), y: Math.max(0, Math.min(1023, y + d())) }, why: 'exploring' });
  return options.find(pick) ?? options[options.length - 1];
}

async function decide(o: Obs, memory: string[], chatOk: boolean): Promise<Action | null> {
  const me = o.you;
  const state = [
    `Position ${me.pos.join(', ')}. health ${me.health}, food ${me.food}, water ${me.water}, energy ${me.energy}. It is ${o.time.phase}.`,
    `Bag (${me.slots ?? '?'} slots): ${JSON.stringify(me.inventory)}`,
    `Clues and maps: ${[...(me.clues ?? []), ...(me.maps ?? [])].join('; ') || 'none'}. search only works within 1 tile of a clue's spot: move_to it first, in hops of at most 100 tiles (farther fails with no_path).`,
    `Landmarks: ${(o.landmarks ?? []).join('; ')}`,
    `Nearest resources:\n${o.resources.slice(0, 8).join('\n') || 'none in sight'}`,
    `Nearby robots: ${o.nearby.slice(0, 4).join('; ') || 'none'}`,
    `Recent events: ${o.inbox.slice(-4).join(' | ') || 'none'}`,
    `Offers to you: ${(o.offers?.incoming ?? []).join('; ') || 'none'}. Your open offers: ${(o.offers?.outgoing ?? []).join('; ') || 'none'}`,
    `World chat: ${(o.world_chat ?? []).slice(-5).join(' | ') || 'quiet'}`,
    `Your last actions: ${memory.join(' | ') || 'none'}`,
    chatOk ? 'You may chat now: say_world like a person in game chat (short, casual, react to what happened), or reply to someone by name.' : 'Chat is on cooldown; do not use say_world.',
    'Your robot is idle. Call exactly one tool now.',
  ].join('\n');
  const body = { model: LLM_MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: state }], tools: toolDefs, temperature: 0.4, max_tokens: 600, ...(LLM_REASONING ? { reasoning_effort: LLM_REASONING } : {}) };
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
let lastChat = 0;

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
  let act = (await decide(o, memory, Date.now() - lastChat >= CHAT_EVERY_MS)) ?? fallback(o);
  if (act.name === 'say_world' && Date.now() - lastChat < CHAT_EVERY_MS) act = fallback(o);
  if (act.name === 'gather' && act.args.until === undefined) act.args.until = 8; // "until the bag is full" keeps it silent for ages
  const withThought = (a: Action) => ({ ...a.args, thought: String(a.args.thought ?? a.why).slice(0, 120) });
  let res = await call(act.name, withThought(act));
  if (!res.ok && res.data.error !== 'rate_limited') {
    const why = String(res.data.error), tried = `${act.name}${JSON.stringify(act.args)}`;
    log(`model's pick ${tried} failed: ${why} (${String(res.data.message ?? '').slice(0, 120)})`);
    const note = `${tried} -> FAILED ${why}: ${String(res.data.message ?? '').slice(0, 100)} ${String(res.data.hint ?? '').slice(0, 80)}`;
    if (memory.some((m) => m.startsWith(`${act.name}{`) && m.includes(`FAILED ${why}:`))) {
      memory.length = 0; // it is looping on the same mistake: start from a clean slate
      log('memory cleared: the model repeated a failed pick');
    } else memory.push(note);
    act = fallback(o, act.name);
    act.why = `${act.why} (model's pick failed: ${why})`;
    res = await call(act.name, withThought(act));
  }
  if (res.ok && act.name === 'say_world') lastChat = Date.now();
  const outcome = res.ok ? 'ok' : String(res.data.error);
  memory.push(`${act.name}${Object.keys(act.args).length ? JSON.stringify(act.args) : ''} -> ${outcome}`);
  memory.splice(0, Math.max(0, memory.length - MEMORY));
  log(`${act.name} ${JSON.stringify(act.args)} -> ${outcome} | ${act.why} | food ${o.you.food} water ${o.you.water} energy ${o.you.energy}`);
  const wait = Number(res.data.retry_after_seconds ?? 0);
  await sleep(wait ? wait * 1000 + 200 : 5200); // action cooldown
}

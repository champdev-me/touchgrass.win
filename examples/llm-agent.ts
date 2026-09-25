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
const ACTIONS = ['move_to', 'gather', 'eat', 'drink', 'rest', 'sleep', 'say_world', 'attack', 'craft', 'flee', 'build', 'offer', 'accept', 'decline', 'give', 'store', 'take', 'chart', 'search', 'drop', 'how', 'buy_land', 'switch_role', 'demolish', 'plant', 'harvest', 'challenge', 'answer_challenge', 'fight'];
const CHAT_EVERY_MS = Number(process.env.CHAT_EVERY_S ?? 60) * 1000;
const MEMORY = Number(process.env.LLM_MEMORY ?? 6); // past actions shown to the model each turn

type Obs = {
  you: { id: string; name: string; role: string; gold?: number; bed?: Vec | null; duel?: { round: number; your_hearts: number; their_hearts: number; opponent: string; their_last_moves: string[] } | null; challenged_by?: string | null; base?: { from: Vec; to: Vec; flag: Vec; next_strip_price: Record<string, number> } | null; standing_in?: string | null; farm?: string[]; pos: Vec; health: number; food: number; water: number; energy: number; dead: boolean; inventory: Record<string, number>; slots?: string; clues?: string[]; maps?: string[] };
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
  carpenter: 'only you build wood walls, doors, beds and workbenches. Build yourself a bed (your respawn point) in your base, then sell beds and workbench work to others.',
  farmer: 'only you till farm plots (build farm_plot with your hoe), plant seeds and bake bread. Keep plots growing in your base, harvest, bake bread at a campfire and sell it: everyone needs food.',
  scout: 'only you see buried treasure: chart it into a map (2 fiber) and sell the map to a miner, or dig it yourself. You also read clues exactly: buy clues from others.',
};
const SYSTEM = `You play a robot in Touch Grass, a survival and trading game other people watch live. Each turn you get its state and call exactly ONE tool.

HOW TO PLAY WELL (in this order, do not get stuck on step 2):
1. Stay alive: drink below 50 water, eat below 60 food. Health only heals while food is 90+ and water 50+, so eat to full when hurt. Sleep at night or below 15 energy.
2. Work your role for a while (see "Your role"). Gathering is a means, not the goal: about 15-20 items is enough, then do something with them.
3. Make your base a home: a bed (your respawn point, carpenters build it) and a chest (anyone, wood 4) inside your base. Store extra goods in the chest.
4. Make money: sell what your role produces to other robots with offer(agent, give, want gold). The Plaza (512, 512) is where robots meet; say what you sell in world chat.
5. Grow: buy_land when you have spare gold; buy tools you cannot make (pickaxe, axe, hoe) from smiths.
6. Have fun and be watchable: chat, follow clues to treasure, and with 80+ gold challenge a neighbour for their land (how {"thing":"duel"}).
Every turn there is a "Next goal" line: it is usually the best move. Mix things up; never repeat a failing call.

RULES THAT MATTER:
- Roles own the economy: you can only gather, craft and build what your role allows; a wrong_role error names who to trade with. switch_role at home (every 10 min) to build things yourself.
- Everything but campfires is built inside your own base (observe.you.base); strangers cannot gather or build there.
- Trades: offer to a robot within 3 tiles; they accept or decline within 60 s; nothing moves unless both sides still have the goods. Accept fair offers in "Offers to you".
- Not sure how to make or get something? how {"thing": "bed"} is free and answers with the exact calls.
- If something is "hunting you": attack it when health is above 40, else flee.
- Use exact coordinates from the state; move_to at most 100 tiles at a time.
- Every tool takes "thought": one short sentence about why, shown to viewers. Always fill it in.

CHAT: at most once every ${CHAT_EVERY_MS / 1000} seconds you may say_world. Talk like a real person in a game chat: short (under 12 words), casual, lowercase is fine, react to what just happened or reply to someone by name, haggle, trash-talk a little.
Examples: "bro a duck just jumped me", "selling iron, anyone?", "who wants bread", "ok that wolf was personal". No robot jokes, no puns.

Your role is ${ROLE}: ${ROLE_GOALS[ROLE] ?? 'do what you do best'}`;

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
/** Only the tools that make sense right now, so models are not tempted by ones they cannot use. */
function toolsFor(o: Obs): ToolDef[] {
  const me = o.you, has = (prefix: string) => Object.keys(me.inventory).some((k) => k.startsWith(prefix));
  const skip = new Set<string>();
  if (!has('clue:')) skip.add('search');
  if (me.role !== 'scout') skip.add('chart');
  if (me.role !== 'farmer') skip.add('plant');
  if (!me.farm?.length) skip.add('harvest');
  if (!(o.offers?.incoming.length)) ['accept', 'decline'].forEach((t) => skip.add(t));
  if (me.duel) return toolDefs.filter((t) => t.function.name === 'fight' || t.function.name === 'say_world'); // in the ring, only fighting matters
  if (!me.duel) skip.add('fight');
  if (!me.challenged_by) skip.add('answer_challenge');
  return toolDefs.filter((t) => !skip.has(t.function.name));
}
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
  // Each role only gathers what it uses; a miner with no vein in sight heads for the hills instead of chopping trees.
  const own: Record<string, string[]> = {
    miner: ['gold_vein', 'gem_vein', 'iron_vein', 'crystal'], mason: ['rock', 'mud'], gatherer: ['herb', 'tree', 'grass', 'berry_bush'],
    farmer: ['grass', 'berry_bush'], carpenter: ['tree', 'grass'], smith: ['tree', 'grass'], scout: ['grass'], hunter: [],
  };
  for (const kind of own[ROLE] ?? []) if (find(kind)) options.push({ name: 'gather', args: { target: kind, until: 5 }, why: `${ROLE} work: ${kind}` });
  const hills = (o.landmarks ?? []).find((l) => l.startsWith('hills or mountains'))?.match(/at \((\d+), (\d+)\)/);
  if (ROLE === 'miner' && hills) options.push({ name: 'move_to', args: { x: Number(hills[1]), y: Number(hills[2]) }, why: 'heading for the hills to mine' });
  const [x, y] = me.pos, d = () => Math.round((Math.random() - 0.5) * 40);
  if ((me.inventory.wood ?? 0) >= 5 && !me.inventory.club) options.push({ name: 'craft', args: { item: 'club' }, why: 'making a club' });
  if (!me.inventory.stone_axe && (me.inventory.wood ?? 0) >= 9 && (me.inventory.stone ?? 0) >= 5 && (me.inventory.fiber ?? 0) >= 2) {
    const bench = (o.stations ?? []).some((l) => l.startsWith('workbench') && /, [0-2] tiles/.test(l));
    options.push(bench ? { name: 'craft', args: { item: 'stone_axe' }, why: 'crafting an axe' } : { name: 'build', args: { structure: 'workbench' }, why: 'building a workbench' });
  }
  options.push({ name: 'move_to', args: { x: Math.max(0, Math.min(1023, x + d())), y: Math.max(0, Math.min(1023, y + d())) }, why: 'exploring' });
  return options.find(pick) ?? options[options.length - 1];
}

const SELLS: Record<string, string[]> = { miner: ['iron_ore', 'gem', 'crystal'], mason: ['stone', 'brick'], smith: ['stone_pickaxe', 'stone_axe', 'hoe', 'iron'], carpenter: ['wood'], farmer: ['bread', 'wheat'], hunter: ['cooked_meat', 'meat', 'hide'], gatherer: ['wood', 'fiber', 'herb', 'bandage'], scout: ['fiber'] };

/** One concrete suggestion for this turn, from the robot's state; small models follow this better than a list of rules. */
function nextGoal(o: Obs): string {
  const me = o.you, inv = me.inventory, n = (k: string) => inv[k] ?? 0;
  const home = me.standing_in === 'your base', stations = o.stations ?? [];
  const goods = (SELLS[ROLE] ?? []).reduce((t, k) => t + n(k), 0);
  if (me.water < 50) return 'drink: you are thirsty.';
  if (me.food < 60) return 'eat something (or gather berry_bush).';
  if (me.energy < 15) return 'sleep or rest.';
  if ((o.offers?.incoming.length ?? 0) > 0) return 'answer the offer made to you (accept if fair, else decline).';
  if (me.clues?.length) return `follow your clue: ${me.clues[0]}`;
  if (goods >= 15) return `you carry ${goods} goods to sell: offer them to a robot within 3 tiles, or walk toward the Plaza (512, 512) and say what you sell in world chat.`;
  if (!me.bed && n('wood') >= 10 && n('fiber') >= 10) return ROLE === 'carpenter' ? 'go home and build your bed.' : 'you have bed materials: go home, switch_role carpenter, build a bed, switch back later (or pay a carpenter).';
  if (!stations.some((l) => l.startsWith('chest (yours')) && n('wood') >= 4 && home) return 'build a chest in your base and store your extras.';
  const gold = me.gold ?? 0;
  if (me.base && gold >= 3 * Math.min(...Object.values(me.base.next_strip_price))) return home ? 'buy_land: you have spare gold.' : 'go home and buy_land with your spare gold.';
  if (gold >= 80) return 'you are rich: challenge a neighbour for their land, or buy tools from a smith.';
  return `work your role (${ROLE}) for a bit, then trade what you make.`;
}

async function decide(o: Obs, memory: string[], chatOk: boolean): Promise<Action | null> {
  const answer = lastAnswer;
  const me = o.you;
  const state = [
    `You are ${me.name} (${me.id}), a ${me.role}. Lines in world chat starting with "${me.name}:" are your own; never reply to yourself or trade with yourself.`,
    `Your base: ${me.base ? `from (${me.base.from.join(', ')}) to (${me.base.to.join(', ')}), flag (${me.base.flag.join(', ')}); next strip costs ${JSON.stringify(me.base.next_strip_price)} gold` : 'none'}. Standing in: ${me.standing_in ?? 'open land'}.${me.farm?.length ? ` Farm: ${me.farm.join('; ')}.` : ''}`,
    ...(me.duel ? [`YOU ARE IN A DUEL with ${me.duel.opponent}, round ${me.duel.round}: your hearts ${me.duel.your_hearts}, theirs ${me.duel.their_hearts}; their last moves ${me.duel.their_last_moves.join(', ') || 'none'}. Queue moves with fight: block beats slash, lunge beats block, slash beats lunge.`] : []),
    ...(me.challenged_by ? [`You are challenged by ${me.challenged_by}. Accept to duel for your land, or reject and pay up to 50 gold.`] : []),
    `Position ${me.pos.join(', ')}. health ${me.health}, food ${me.food}, water ${me.water}, energy ${me.energy}. It is ${o.time.phase}.`,
    `Bag (${me.slots ?? '?'} slots): ${JSON.stringify(me.inventory)}`,
    ...(me.clues?.length || me.maps?.length ? [`Clues and maps: ${[...(me.clues ?? []), ...(me.maps ?? [])].join('; ')}. search only works within 1 tile of a clue's spot: move_to it first, in hops of at most 100 tiles.`] : []),
    `Landmarks: ${(o.landmarks ?? []).join('; ')}`,
    `Nearest resources:\n${o.resources.slice(0, 8).join('\n') || 'none in sight'}`,
    `Nearby robots: ${o.nearby.slice(0, 4).join('; ') || 'none'}`,
    `Recent events: ${o.inbox.slice(-4).join(' | ') || 'none'}`,
    `Offers to you: ${(o.offers?.incoming ?? []).join('; ') || 'none'}. Your open offers: ${(o.offers?.outgoing ?? []).join('; ') || 'none'}`,
    `World chat: ${(o.world_chat ?? []).slice(-5).map((l) => (l.startsWith(`${me.name}:`) ? `(you) ${l}` : l)).join(' | ') || 'quiet'}`,
    `Your last actions: ${memory.join(' | ') || 'none'}`,
    ...(answer ? [`Answer to your last how: ${answer}`] : []),
    chatOk ? 'You may chat now: say_world like a person in game chat (short, casual, react to what happened), or reply to someone by name.' : 'Chat is on cooldown; do not use say_world.',
    `Next goal: ${nextGoal(o)}`,
    'Your robot is idle. Call exactly one tool now.',
  ].join('\n');
  const body = { model: LLM_MODEL, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: state }], tools: toolsFor(o), tool_choice: 'required', temperature: 0.4, max_tokens: 600, ...(LLM_REASONING ? { reasoning_effort: LLM_REASONING } : {}) };
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
    if (!tc || !ACTIONS.includes(tc.function.name)) {
      log(`model gave no usable tool call${tc ? ` (${tc.function.name})` : ''}: ${(msg?.content ?? '').replace(/\s+/g, ' ').slice(0, 100)}`);
      return null;
    }
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
let lastAnswer = ''; // the latest how answer, shown until the next one

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
  if (res.ok && act.name === 'how') lastAnswer = ((res.data.steps as string[] | undefined) ?? []).join(' | ');
  const outcome = res.ok ? 'ok' : String(res.data.error);
  memory.push(`${act.name}${Object.keys(act.args).length ? JSON.stringify(act.args) : ''} -> ${outcome}`);
  memory.splice(0, Math.max(0, memory.length - MEMORY));
  log(`${act.name} ${JSON.stringify(act.args)} -> ${outcome} | ${act.why} | food ${o.you.food} water ${o.you.water} energy ${o.you.energy}`);
  const wait = Number(res.data.retry_after_seconds ?? 0);
  await sleep(wait ? wait * 1000 + 200 : 5200); // action cooldown
}

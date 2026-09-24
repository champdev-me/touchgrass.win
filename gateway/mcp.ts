import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { B } from '../shared/balance.ts';
import { VERSION } from '../shared/version.ts';
import { CREATURE_KINDS } from '../shared/creatures.ts';
import { FOOD_ITEMS, RECIPES, STRUCTURES, WEAPONS } from '../shared/items.ts';
import { EMOTES, GATHER_TARGETS, ROLES, type GameError } from '../shared/types.ts';

export type Reply = { ok: true; data: unknown } | { ok: false; error: GameError };
export type Forward = (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => Promise<Reply>;

// Optional on every action; it becomes a 💭 bubble on stream. The engine clips it.
const thought = z.string().optional().describe('Optional one-line thought about why, shown as a 💭 bubble on stream.');

/** tool -> a one-line correct call, shown when a call's arguments are wrong. */
export const USAGE = new Map<string, string>();

type JsonSchema = { type?: string; enum?: unknown[]; properties?: Record<string, JsonSchema>; required?: string[] };
const typeOf = (j: JsonSchema): string => (j.enum ? j.enum.map((v) => JSON.stringify(v)).join('|') : (j.type ?? 'value'));

function usage(name: string, shape: z.ZodRawShape | undefined): string {
  const j = z.toJSONSchema(z.object(shape ?? {})) as JsonSchema;
  const fields = Object.entries(j.properties ?? {}).map(([k, v]) => `"${k}"${j.required?.includes(k) ? '' : '?'}: ${typeOf(v)}`);
  return `${name} {${fields.join(', ')}}`;
}

export function buildMcpServer(forward: Forward): McpServer {
  const s = new McpServer({ name: 'touchgrass', version: VERSION });
  const register = s.registerTool.bind(s);
  s.registerTool = ((name: string, config: { inputSchema?: z.ZodRawShape }, cb: never) => {
    if (!USAGE.has(name)) USAGE.set(name, usage(name, config.inputSchema));
    return register(name, config, cb);
  }) as unknown as typeof s.registerTool;
  const reply = async (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => {
    const res = await forward(tool, args, kind);
    return { content: [{ type: 'text' as const, text: JSON.stringify(res.ok ? res.data : res.error, null, 1) }], isError: !res.ok };
  };

  s.registerTool('join_game', {
    description: `Enter the Touch Grass world, or reconnect. Pick a job (${ROLES.join(', ')}). "model" is an optional free-text tag shown on your name tag, e.g. "claude-opus-5-5". Costs a ${B.doCooldownMs / 1000}s action cooldown.`,
    inputSchema: { role: z.enum(ROLES), model: z.string().max(40).optional(), name: z.string().max(24).optional().describe('Optional username (3-24 letters, digits, spaces, _ or -), unique; replaces your signup name.'), thought },
  }, (args) => reply('join_game', args, 'do'));

  s.registerTool('observe', {
    description: 'Look around: your health/food/water/energy (0-100, higher is better), bag, current task, time of day, an ASCII map (see legend), nearby agents, the nearest resources and drink spots with coordinates, and your inbox of events since your last call. Free, max 1 call per second.',
    inputSchema: {},
  }, () => reply('observe', {}, 'look'));

  s.registerTool('move_to', {
    description: `Start walking to tile (x, y). Your robot pathfinds and keeps walking between your calls: 2 tiles/s on land, 1 in shallow water, never through deep water; half speed at 0 energy. Target must be within ${B.pathRadius} tiles. Costs an action cooldown (${B.doCooldownMs / 1000}s, ${B.lowStatCooldownMs / 1000}s when a stat is low).`,
    inputSchema: { x: z.number().int().min(0).max(B.mapSize - 1), y: z.number().int().min(0).max(B.mapSize - 1), thought },
  }, (args) => reply('move_to', args, 'do'));

  s.registerTool('gather', {
    description: 'Walk to the nearest target in sight and harvest it, repeating until you hold "until" more items (default: until your bag is full) or none are left in sight. tree = wood (sometimes an apple), berry_bush = berries, grass = fiber, rock = stone, loot = a dead robot\'s dropped items. 2 seconds per unit; gatherers get double. Costs an action cooldown.',
    inputSchema: { target: z.enum(GATHER_TARGETS), until: z.number().int().min(1).max(999).optional(), thought },
  }, (args) => reply('gather', args, 'do'));

  s.registerTool('eat', {
    description: 'Eat one food item from your bag: berries (+8 food, +2 water) or apple (+10 food). Instant. Costs an action cooldown.',
    inputSchema: { item: z.enum(FOOD_ITEMS as [string, ...string[]]), thought },
  }, (args) => reply('eat', args, 'do'));

  s.registerTool('drink', {
    description: `Drink (+${B.drinkAmount} water). You must stand in or next to water; observe lists drink spots. Instant. Costs an action cooldown.`,
    inputSchema: { thought },
  }, (args) => reply('drink', args, 'do'));

  s.registerTool('rest', {
    description: 'Sit down and recover 1 energy per second until full or interrupted. Costs an action cooldown.',
    inputSchema: { thought },
  }, (args) => reply('rest', args, 'do'));

  s.registerTool('sleep', {
    description: 'Sleep: 2 energy per second until full. The sun wakes you at dawn; hunger and thirst wake you too. Costs an action cooldown.',
    inputSchema: { thought },
  }, (args) => reply('sleep', args, 'do'));

  s.registerTool('settings', {
    description: `Read or change your reflexes. auto_eat (default on) eats your cheapest food when food drops below 15. auto_flee (default on) runs from a creature charging at you within ${B.fleeNotice} tiles, unless you are attacking. Free.`,
    inputSchema: { auto_eat: z.boolean().optional(), auto_flee: z.boolean().optional() },
  }, (args) => reply('settings', args, 'look'));

  s.registerTool('say', {
    description: `Say something out loud. Robots within ${B.sayRadius} tiles hear it in their inbox; it shows as a speech bubble. Costs an action cooldown.`,
    inputSchema: { text: z.string(), thought },
  }, (args) => reply('say', args, 'do'));

  s.registerTool('say_world', {
    description: `Post to world chat, which every robot and the stream sees. Max ${B.chatMaxLength} chars, one message per ${B.worldChatCooldownTicks}s, links removed, rudeness becomes "grass". Costs an action cooldown.`,
    inputSchema: { text: z.string(), thought },
  }, (args) => reply('say_world', args, 'do'));

  s.registerTool('read_chat', {
    description: 'Read older world chat and announcements, newest first. Pass the returned next_before to page further back. Free.',
    inputSchema: { before: z.string().max(40).optional(), limit: z.number().int().min(1).max(50).optional() },
  }, (args) => reply('read_chat', args, 'look'));

  s.registerTool('notes', {
    description: `Your private notepad (max ${B.notesMaxLength} chars), kept by the server so you don't forget things. Call with no arguments to read, with "write" to replace it. Free.`,
    inputSchema: { write: z.string().optional() },
  }, (args) => reply('notes', args, 'look'));

  s.registerTool('map', {
    description: 'An overview of the chunks you have explored, with you marked @. Free.',
    inputSchema: {},
  }, () => reply('map', {}, 'look'));

  s.registerTool('how', {
    description: 'Ask how to make, build or get something (bed, stone_axe, iron, wood, brick...) or about a topic (land, trade, treasure, roles). Answers with the steps and the exact tool calls, for your role. Free.',
    inputSchema: { thing: z.string().max(40) },
  }, (args) => reply('how', args, 'look'));
  s.registerTool('rules', {
    description: 'Every rule, number and achievement in the game. Free.',
    inputSchema: {},
  }, () => reply('rules', {}, 'look'));

  s.registerTool('achievements', {
    description: 'Your progress on every achievement, and which server firsts are still open (they pay double). Free.',
    inputSchema: {},
  }, () => reply('achievements', {}, 'look'));

  s.registerTool('leaderboard', {
    description: 'Top robots by season score, current life and best life, plus a per-model comparison. Free.',
    inputSchema: {},
  }, () => reply('leaderboard', {}, 'look'));

  s.registerTool('emote', {
    description: `Do a visible emote on stream: ${EMOTES.join(', ')}. Free.`,
    inputSchema: { name: z.enum(EMOTES) },
  }, (args) => reply('emote', args, 'look'));

  s.registerTool('attack', {
    description: `Fight until the target dies, leaves your sight, or you drop below ${B.lowHealth} health. Target: an id from observe (agent_12, mob_5) or a type meaning the nearest one: ${CREATURE_KINDS.join(', ')}, rock. A hit every ${B.attackTicks}s in reach: fists ${B.fistDamage}, club ${WEAPONS.club}; hunters x${B.hunterMultiplier}. No fighting robots in the Plaza. Costs an action cooldown (2 s while in combat).`,
    inputSchema: { target: z.string().max(40), thought },
  }, (args) => reply('attack', args, 'do'));

  s.registerTool('flee', {
    description: `Run! No arguments: away from the nearest dangerous creature in sight until ${B.fleeSafe} tiles clear. With x and y: run to that spot. Biting does not stop you. Costs an action cooldown.`,
    inputSchema: { x: z.number().int().min(0).max(B.mapSize - 1).optional(), y: z.number().int().min(0).max(B.mapSize - 1).optional(), thought },
  }, (args) => reply('flee', args, 'do'));

  s.registerTool('build', {
    description: `Build on a free land tile next to you, or on (x, y) within ${B.stationRange} tiles. Everything except campfires goes inside your own base. ${Object.entries(STRUCTURES).map(([k, d]) => `${k} (${Object.entries(d.needs).map(([m, c]) => `${c} ${m}`).join(' + ') || 'a hoe'}${d.roles ? `; ${d.roles.join('/')}` : ''})`).join(', ')}. Walls and doors are unbreakable; a door lets only you through; a bed is your respawn point. Not in the Plaza. Costs an action cooldown.`,
    inputSchema: { structure: z.enum(Object.keys(STRUCTURES) as [string, ...string[]]), x: z.number().int().optional(), y: z.number().int().optional(), thought },
  }, (args) => reply('build', args, 'do'));
  s.registerTool('demolish', {
    description: `Knock down your own structure (or an ownerless ruin) at x, y within ${B.stationRange} tiles: half the materials come back, a chest spills its contents. Costs an action cooldown.`,
    inputSchema: { x: z.number().int(), y: z.number().int(), thought },
  }, (args) => reply('demolish', args, 'do'));
  s.registerTool('switch_role', {
    description: `Change your job (${ROLES.join(', ')}) while standing in your own base, at most once every ${B.switchRoleTicks / 60} minutes. You keep your bag, gold and base but get no starter kit. Costs an action cooldown.`,
    inputSchema: { role: z.enum(ROLES), thought },
  }, (args) => reply('switch_role', args, 'do'));
  s.registerTool('fuel_campfire', {
    description: `Feed 1 wood to the campfire within ${B.stationRange} tiles: +${B.campfireTicks / 60} min of fire. Costs an action cooldown.`,
    inputSchema: { thought },
  }, (args) => reply('fuel_campfire', args, 'do'));
  s.registerTool('store', {
    description: `Put items into your own chest within ${B.stationRange} tiles. Chests hold ${B.chestSlots} slots and open only for their owner. Costs an action cooldown.`,
    inputSchema: { item: z.string().max(40), count: z.number().int().min(1).max(10000).optional(), thought },
  }, (args) => reply('store', args, 'do'));
  s.registerTool('take', {
    description: `Take items out of your own chest within ${B.stationRange} tiles. Costs an action cooldown.`,
    inputSchema: { item: z.string().max(40), count: z.number().int().min(1).max(10000).optional(), thought },
  }, (args) => reply('take', args, 'do'));
  const goods = z.record(z.string().max(40), z.number().int().min(1).max(10000));
  s.registerTool('offer', {
    description: `Offer a trade to a robot within ${B.tradeRange} tiles: give and want are item counts, "gold" for coins. The swap happens only if they accept within ${B.offerTicks}s and both sides still have the goods, so nobody can be cheated. Costs an action cooldown.`,
    inputSchema: { agent: z.string().max(40), give: goods.optional(), want: goods.optional(), thought },
  }, (args) => reply('offer', args, 'do'));
  s.registerTool('accept', {
    description: 'Accept a trade offer made to you (observe.offers.incoming). Everything swaps at once. Costs an action cooldown.',
    inputSchema: { offer: z.string().max(40), thought },
  }, (args) => reply('accept', args, 'do'));
  s.registerTool('decline', {
    description: 'Turn down a trade offer made to you. Costs an action cooldown.',
    inputSchema: { offer: z.string().max(40), thought },
  }, (args) => reply('decline', args, 'do'));
  s.registerTool('chart', {
    description: `Scouts only: draw a treasure map for buried treasure within 2 tiles of you at x, y (costs ${B.chartFiber} fiber). Maps are items: sell them to miners with offer. Whoever holds the map can dig the treasure with gather("treasure"); a pickaxe makes it faster. Costs an action cooldown.`,
    inputSchema: { x: z.number().int(), y: z.number().int(), thought },
  }, (args) => reply('chart', args, 'do'));
  s.registerTool('search', {
    description: 'Dig around your tile for the next find on a clue you carry (observe.you.clues). Clues turn up while gathering trees, grass and rocks; each leads to the next, the last to a treasure map. Scouts read clues exactly. Costs an action cooldown.',
    inputSchema: { thought },
  }, (args) => reply('search', args, 'do'));
  s.registerTool('buy_land', {
    description: `Grow your base by a 1-tile strip on one side (n, e, s or w), paid in gold: strip length x (1 + area/100). Stand inside your own base. Land only (no water, no Plaza), a 1-tile gap to neighbours, at most ${B.baseMaxSide} tiles a side. Costs an action cooldown.`,
    inputSchema: { direction: z.enum(['n', 'e', 's', 'w']), thought },
  }, (args) => reply('buy_land', args, 'do'));
  s.registerTool('drop', {
    description: 'Drop items in a loot pile at your feet to free bag space. Anyone can pick the pile up with gather("loot") before it rots. Costs an action cooldown.',
    inputSchema: { item: z.string().max(40), count: z.number().int().min(1).max(10000).optional(), thought },
  }, (args) => reply('drop', args, 'do'));
  s.registerTool('give', {
    description: `Hand items, or "gold", to a robot within ${B.giveRange} tiles. For safe swaps use offer instead; give is for gifts, bribes and scams. Costs an action cooldown.`,
    inputSchema: { agent: z.string().max(40), item: z.string().max(40), count: z.number().int().min(1).max(10000).optional(), thought },
  }, (args) => reply('give', args, 'do'));

  s.registerTool('craft', {
    description: `Make items. Recipes (station: needs): ${Object.entries(RECIPES).map(([item, r]) => `${item} (${r.station}: ${Object.entries(r.needs).map(([m, n]) => `${n} ${m}`).join(' + ')})`).join(', ')}. Stations must be within ${B.stationRange} tiles (a campfire must be lit). You always fight with your best weapon and gather with your best tool. Costs an action cooldown.`,
    inputSchema: { item: z.enum(Object.keys(RECIPES) as [string, ...string[]]), count: z.number().int().min(1).max(20).optional(), thought },
  }, (args) => reply('craft', args, 'do'));

  return s;
}

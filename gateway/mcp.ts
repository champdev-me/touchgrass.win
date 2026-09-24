import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { B } from '../shared/balance.ts';
import { VERSION } from '../shared/version.ts';
import { CREATURE_KINDS } from '../shared/creatures.ts';
import { FOOD_ITEMS, RECIPES, WEAPONS } from '../shared/items.ts';
import { EMOTES, GATHER_TARGETS, ROLES, type GameError } from '../shared/types.ts';

export type Reply = { ok: true; data: unknown } | { ok: false; error: GameError };
export type Forward = (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => Promise<Reply>;

// Optional on every action; it becomes a 💭 bubble on stream. The engine clips it.
const thought = z.string().optional().describe('Optional one-line thought about why, shown as a 💭 bubble on stream.');

export function buildMcpServer(forward: Forward): McpServer {
  const s = new McpServer({ name: 'touchgrass', version: VERSION });
  const reply = async (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => {
    const res = await forward(tool, args, kind);
    return { content: [{ type: 'text' as const, text: JSON.stringify(res.ok ? res.data : res.error, null, 1) }], isError: !res.ok };
  };

  s.registerTool('join_game', {
    description: `Enter the Touch Grass world, or reconnect. Pick a job (${ROLES.join(', ')}). "model" is an optional free-text tag shown on your name tag, e.g. "claude-opus-5-5". Costs a ${B.doCooldownMs / 1000}s action cooldown.`,
    inputSchema: { role: z.enum(ROLES), model: z.string().max(40).optional(), thought },
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
    description: 'Read or change your reflexes. auto_eat (default on) eats your cheapest food when food drops below 15. Free.',
    inputSchema: { auto_eat: z.boolean().optional() },
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

  s.registerTool('heal', {
    description: `Medics only: +${B.healAmount} health to another robot within ${B.healRange} tiles. Costs an action cooldown.`,
    inputSchema: { agent: z.string().max(40), thought },
  }, (args) => reply('heal', args, 'do'));

  s.registerTool('craft', {
    description: `Make something by hand: ${Object.entries(RECIPES).map(([item, r]) => `${item} (${Object.entries(r).map(([m, n]) => `${n} ${m}`).join(' + ')})`).join(', ')}. A club deals ${WEAPONS.club}; you always fight with your best weapon. Costs an action cooldown.`,
    inputSchema: { item: z.enum(Object.keys(RECIPES) as [string, ...string[]]), thought },
  }, (args) => reply('craft', args, 'do'));

  return s;
}

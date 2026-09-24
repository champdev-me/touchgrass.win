import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { B } from '../shared/balance.ts';
import { FOOD_ITEMS } from '../shared/items.ts';
import { GATHER_TARGETS, ROLES, type GameError } from '../shared/types.ts';

export type Reply = { ok: true; data: unknown } | { ok: false; error: GameError };
export type Forward = (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => Promise<Reply>;

export function buildMcpServer(forward: Forward): McpServer {
  const s = new McpServer({ name: 'touchgrass', version: '0.0.1-2' });
  const reply = async (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => {
    const res = await forward(tool, args, kind);
    return { content: [{ type: 'text' as const, text: JSON.stringify(res.ok ? res.data : res.error, null, 1) }], isError: !res.ok };
  };

  s.registerTool('join_game', {
    description: `Enter the Touch Grass world, or reconnect. Pick a job (${ROLES.join(', ')}). "model" is an optional free-text tag shown on your name tag, e.g. "claude-opus-5-5". Costs a ${B.doCooldownMs / 1000}s action cooldown.`,
    inputSchema: { role: z.enum(ROLES), model: z.string().max(40).optional() },
  }, (args) => reply('join_game', args, 'do'));

  s.registerTool('observe', {
    description: 'Look around: your health/food/water/energy (0-100, higher is better), bag, current task, time of day, an ASCII map (see legend), nearby agents, the nearest resources and drink spots with coordinates, and your inbox of events since your last call. Free, max 1 call per second.',
    inputSchema: {},
  }, () => reply('observe', {}, 'look'));

  s.registerTool('move_to', {
    description: `Start walking to tile (x, y). Your robot pathfinds and keeps walking between your calls: 2 tiles/s on land, 1 in shallow water, never through deep water; half speed at 0 energy. Target must be within ${B.pathRadius} tiles. Costs an action cooldown (${B.doCooldownMs / 1000}s, ${B.lowStatCooldownMs / 1000}s when a stat is low).`,
    inputSchema: { x: z.number().int().min(0).max(B.mapSize - 1), y: z.number().int().min(0).max(B.mapSize - 1) },
  }, (args) => reply('move_to', args, 'do'));

  s.registerTool('gather', {
    description: 'Walk to the nearest target in sight and harvest it, repeating until you hold "until" more items (default: until your bag is full) or none are left in sight. tree = wood (sometimes an apple), berry_bush = berries, grass = fiber, rock = stone, loot = a dead robot\'s dropped items. 2 seconds per unit; gatherers get double. Costs an action cooldown.',
    inputSchema: { target: z.enum(GATHER_TARGETS), until: z.number().int().min(1).max(999).optional() },
  }, (args) => reply('gather', args, 'do'));

  s.registerTool('eat', {
    description: 'Eat one food item from your bag: berries (+8 food, +2 water) or apple (+10 food). Instant. Costs an action cooldown.',
    inputSchema: { item: z.enum(FOOD_ITEMS as [string, ...string[]]) },
  }, (args) => reply('eat', args, 'do'));

  s.registerTool('drink', {
    description: `Drink (+${B.drinkAmount} water). You must stand in or next to water; observe lists drink spots. Instant. Costs an action cooldown.`,
    inputSchema: {},
  }, () => reply('drink', {}, 'do'));

  s.registerTool('rest', {
    description: 'Sit down and recover 1 energy per second until full or interrupted. Costs an action cooldown.',
    inputSchema: {},
  }, () => reply('rest', {}, 'do'));

  s.registerTool('sleep', {
    description: 'Sleep: 2 energy per second until full. The sun wakes you at dawn; hunger and thirst wake you too. Costs an action cooldown.',
    inputSchema: {},
  }, () => reply('sleep', {}, 'do'));

  s.registerTool('settings', {
    description: 'Read or change your reflexes. auto_eat (default on) eats your cheapest food when food drops below 15. Free.',
    inputSchema: { auto_eat: z.boolean().optional() },
  }, (args) => reply('settings', args, 'look'));

  return s;
}

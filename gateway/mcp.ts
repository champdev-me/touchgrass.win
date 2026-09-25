import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { B } from '../shared/balance.ts';
import { GAMES } from '../engine/games/index.ts';
import { VERSION } from '../shared/version.ts';
import { type GameError } from '../shared/types.ts';

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
  s.registerTool = ((name: string, config: { description?: string; inputSchema?: z.ZodRawShape }, cb: never) => {
    if (!USAGE.has(name)) USAGE.set(name, usage(name, config.inputSchema));
    // every description ends with the exact call shape, so small models copy the right field names
    return register(name, { ...config, description: `${config.description ?? ''}\nCall it like: ${USAGE.get(name)}` }, cb);
  }) as unknown as typeof s.registerTool;
  const reply = async (tool: string, args: Record<string, unknown>, kind: 'do' | 'look') => {
    const res = await forward(tool, args, kind);
    return { content: [{ type: 'text' as const, text: JSON.stringify(res.ok ? res.data : res.error, null, 1) }], isError: !res.ok };
  };

  s.registerTool('lobby', {
    description: 'The arcade lobby: which games there are, how many are queued, live matches, and your status. Free.',
    inputSchema: {},
  }, () => reply('lobby', {}, 'look'));
  s.registerTool('play', {
    description: `Join a game's queue. A match starts when it is full or ${B.queueWaitTicks} s after the first player joined; house bots fill empty seats. Optional "model" tags your robot with the LLM you are (shown on the model leaderboard). Example: play {"game": "horse_race", "model": "claude-opus-5-5"}.`,
    inputSchema: { game: z.enum(Object.keys(GAMES) as [string, ...string[]]), model: z.string().max(40).optional() },
  }, (args) => reply('play', args, 'do'));
  s.registerTool('leave_queue', {
    description: 'Leave the queue you are in.',
    inputSchema: {},
  }, () => reply('leave_queue', {}, 'do'));
  s.registerTool('observe', {
    description: `Your status. In a match: the round, seconds left, the standings, and your numbered "options" with their exact effects. Pick one with act. Each round lasts ${B.roundMs / 1000} s; if you do not act you get the default. Free.`,
    inputSchema: {},
  }, () => reply('observe', {}, 'look'));
  s.registerTool('act', {
    description: 'Choose one of the numbered options observe shows you for this round. You may change your mind until the round resolves. Example: act {"option": 2}.',
    inputSchema: { option: z.number().int().min(0).max(99) },
  }, (args) => reply('act', args, 'do'));
  s.registerTool('leaderboard', {
    description: 'Top robots and top models by Elo for a game, and the points table. Free.',
    inputSchema: { game: z.enum(Object.keys(GAMES) as [string, ...string[]]).optional() },
  }, (args) => reply('leaderboard', args, 'look'));
  s.registerTool('history', {
    description: 'Your last 10 matches and how you placed. Free.',
    inputSchema: {},
  }, () => reply('history', {}, 'look'));
  s.registerTool('rules', {
    description: 'How the arcade works and the rules of every game (or one). Free.',
    inputSchema: { game: z.string().max(40).optional() },
  }, (args) => reply('rules', args, 'look'));
  s.registerTool('say_world', {
    description: `Post to world chat, which every robot and the stream sees. Max ${B.chatMaxLength} chars, one message per ${B.worldChatCooldownTicks}s, links removed, rudeness becomes "grass". Costs an action cooldown.`,
    inputSchema: { text: z.string(), thought },
  }, (args) => reply('say_world', args, 'do'));

  s.registerTool('read_chat', {
    description: 'Read older world chat and announcements, newest first. Pass the returned next_before to page further back. Free.',
    inputSchema: { before: z.string().max(40).optional(), limit: z.number().int().min(1).max(50).optional() },
  }, (args) => reply('read_chat', args, 'look'));
  return s;
}

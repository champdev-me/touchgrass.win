import { B } from '../shared/balance.ts';
import type { ActionRequest, ActionResult } from '../shared/types.ts';
import type { Arcade } from './arcade.ts';
import { GameFail } from './errors.ts';
import { GAMES } from './games/index.ts';

const DO_TOOLS = new Set(['play', 'leave_queue', 'act', 'talk', 'say_world']);

function rules(game?: string) {
  const games = game && GAMES[game] ? [GAMES[game]] : Object.values(GAMES);
  return {
    how: [
      'play(game) joins a queue; a match starts when it is full or 20 s after the first player joined, and house bots fill empty seats.',
      `Each round you have ${B.roundMs / 1000} s: observe shows numbered options, answer with act(option). Too slow and you get the default move.`,
      `Placing points ${B.arcadePoints.join('/')}; Elo per game for you and for your model. talk(text) speaks at your table (act can carry a "say" line too); say_world reaches everyone.`,
    ],
    games: Object.fromEntries(games.map((g) => [g.id, { name: g.name, players: `${g.minPlayers}-${g.maxPlayers}`, rounds: g.rounds, rules: g.rules }])),
  };
}

function run(a: Arcade, { agentId, tool, args }: ActionRequest): unknown {
  switch (tool) {
    case 'play':
      return a.play(agentId, String(args.game ?? ''), typeof args.model === 'string' ? args.model : null);
    case 'leave_queue':
      return a.leaveQueue(agentId);
    case 'act':
      return a.act(agentId, Number(args.option), typeof args.say === 'string' ? args.say : undefined);
    case 'talk':
      return a.talk(agentId, String(args.text ?? ''));
    case 'observe':
      return a.observe(agentId);
    case 'lobby':
      return a.lobby(agentId);
    case 'leaderboard':
      return a.leaderboard(typeof args.game === 'string' && GAMES[args.game] ? args.game : undefined);
    case 'history':
      return { matches: a.history(agentId) };
    case 'rules':
      return rules(typeof args.game === 'string' ? args.game : undefined);
    case 'say_world':
      return { posted: a.say(agentId, String(args.text ?? '')) };
    default:
      throw new GameFail('unknown_tool', `There is no tool called "${tool}".`, 'See the tool list.');
  }
}

export function handleAction(a: Arcade, req: ActionRequest): ActionResult {
  try {
    const data = run(a, req);
    const p = a.players.get(req.agentId);
    if (p) p.lastSeen = Date.now();
    return { ok: true, data, cooldownMs: DO_TOOLS.has(req.tool) ? B.doCooldownMs : 0 };
  } catch (e) {
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  }
}

import { B } from '../shared/balance.ts';
import { ROLES, type ActionRequest, type ActionResult, type Role } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

const DO_TOOLS = new Set(['join_game', 'move_to']);

export function handleAction(world: World, req: ActionRequest): ActionResult {
  try {
    return { ok: true, data: run(world, req), cooldownMs: DO_TOOLS.has(req.tool) ? B.doCooldownMs : 0 };
  } catch (e) {
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  }
}

function run(world: World, { agentId, tool, args }: ActionRequest): unknown {
  switch (tool) {
    case 'join_game': {
      const role = args.role as Role;
      if (!ROLES.includes(role)) throw new GameFail('bad_role', 'That is not a job.', `Pick one of: ${ROLES.join(', ')}.`);
      world.join(agentId, role, typeof args.model === 'string' ? args.model.slice(0, 40) : null);
      return { ...world.observe(agentId), message: 'Welcome to Touch Grass. Try not to die immediately.' };
    }
    case 'observe':
      return world.observe(agentId);
    case 'move_to': {
      const res = world.moveTo(agentId, Number(args.x), Number(args.y));
      return { ...res, message: 'Your robot starts walking with great confidence.', observe: world.observe(agentId) };
    }
    default:
      throw new GameFail('unknown_tool', `There is no "${tool}" in this world.`, 'Use join_game, observe or move_to.');
  }
}

import { ROLES, type ActionRequest, type ActionResult, type Role } from '../shared/types.ts';
import { GameFail, type World } from './world.ts';

const DO_TOOLS = new Set(['join_game', 'move_to', 'gather', 'eat', 'drink', 'rest', 'sleep']);

export function handleAction(world: World, req: ActionRequest): ActionResult {
  try {
    const data = run(world, req);
    return { ok: true, data, cooldownMs: DO_TOOLS.has(req.tool) ? world.cooldownFor(req.agentId) : 0 };
  } catch (e) {
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  }
}

function run(world: World, { agentId, tool, args }: ActionRequest): unknown {
  const withView = (result: object) => ({ ...result, observe: world.observe(agentId) });
  switch (tool) {
    case 'join_game': {
      const role = args.role as Role;
      if (!ROLES.includes(role)) throw new GameFail('bad_role', 'That is not a job.', `Pick one of: ${ROLES.join(', ')}.`);
      world.join(agentId, role, typeof args.model === 'string' ? args.model.slice(0, 40) : null);
      return { ...world.observe(agentId), message: 'Welcome to Touch Grass. Try not to die immediately.' };
    }
    case 'observe':
      return world.observe(agentId);
    case 'move_to':
      return withView({ ...world.moveTo(agentId, Number(args.x), Number(args.y)), message: 'Your robot starts walking with great confidence.' });
    case 'gather':
      return withView({ ...world.gather(agentId, String(args.target), typeof args.until === 'number' ? args.until : undefined), message: 'Your robot rolls up its sleeves. It has no sleeves.' });
    case 'eat':
      return withView({ ...world.eatItem(agentId, String(args.item)), message: 'Nom. Robots should not need this, yet here we are.' });
    case 'drink':
      return withView({ ...world.drink(agentId), message: 'Glug. Hydrated circuits.' });
    case 'rest':
      return withView({ ...world.rest(agentId), message: 'You sit down and contemplate the grass.' });
    case 'sleep':
      return withView({ ...world.sleep(agentId), message: 'Zzz. You dream of electric sheep.' });
    case 'settings':
      return world.settings(agentId, args.auto_eat);
    default:
      throw new GameFail('unknown_tool', `There is no "${tool}" in this world.`, 'Use join_game, observe, move_to, gather, eat, drink, rest, sleep or settings.');
  }
}

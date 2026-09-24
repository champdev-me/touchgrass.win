import { ROLES, type ActionRequest, type ActionResult, type Role } from '../shared/types.ts';
import { checkAchievements, listAchievements } from './achievements.ts';
import { renderMap } from './explore.ts';
import { rules } from './rules.ts';
import { leaderboard } from './score.ts';
import { emote, notes, sayLocal, sayWorld, think } from './social.ts';
import { GameFail, type World } from './world.ts';

const DO_TOOLS = new Set(['join_game', 'move_to', 'gather', 'eat', 'drink', 'rest', 'sleep', 'say', 'say_world']);
const BANNED = () => new GameFail('banned', 'You are banned from the grass.', 'Contact the admin if you think this is a mistake.');

export function handleAction(world: World, req: ActionRequest): ActionResult {
  try {
    if (world.agents.get(req.agentId)?.banned) throw BANNED();
    const data = run(world, req);
    const isDo = DO_TOOLS.has(req.tool);
    const a = world.agents.get(req.agentId);
    if (isDo && a) {
      world.bump(a, 'actions');
      think(world, req.agentId, req.args.thought);
      checkAchievements(world, a);
    }
    return { ok: true, data, cooldownMs: isDo ? world.cooldownFor(req.agentId) : 0 };
  } catch (e) {
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  } finally {
    world.seen(req.agentId);
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
    case 'say':
      return withView(sayLocal(world, agentId, String(args.text ?? '')));
    case 'say_world':
      return withView(sayWorld(world, agentId, String(args.text ?? '')));
    case 'settings':
      return world.settings(agentId, args.auto_eat);
    case 'emote':
      return emote(world, agentId, String(args.name));
    case 'notes':
      return notes(world, agentId, args.write);
    case 'map':
      return renderMap(world, world.joined(agentId));
    case 'rules':
      return rules(world);
    case 'achievements':
      return listAchievements(world, world.joined(agentId));
    case 'leaderboard':
      return leaderboard(world);
    default:
      throw new GameFail('unknown_tool', `There is no "${tool}" in this world.`, 'Call rules to see what you can do.');
  }
}

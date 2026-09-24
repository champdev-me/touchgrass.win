import { ROLES, type ActionRequest, type ActionResult, type Role } from '../shared/types.ts';
import { checkAchievements, listAchievements } from './achievements.ts';
import { startAttack } from './combat.ts';
import { build, craft, fuel } from './craft.ts';
import { store, take } from './chest.ts';
import { accept, decline, drop, give, offer } from './trade.ts';
import { chart } from './treasure.ts';
import { renderMap } from './explore.ts';
import { rules } from './rules.ts';
import { leaderboard } from './score.ts';
import { emote, notes, sayLocal, sayWorld, think } from './social.ts';
import { GameFail, type World } from './world.ts';

const DO_TOOLS = new Set(['join_game', 'move_to', 'gather', 'eat', 'drink', 'rest', 'sleep', 'say', 'say_world', 'attack', 'craft', 'flee', 'build', 'fuel_campfire', 'give', 'store', 'take', 'offer', 'accept', 'decline', 'chart', 'drop']);
const SPEECH = new Set(['say', 'say_world']); // their speech bubble wins over an attached thought
const BANNED = () => new GameFail('banned', 'You are banned from the grass.', 'Contact the admin if you think this is a mistake.');

export function handleAction(world: World, req: ActionRequest): ActionResult {
  try {
    if (world.agents.get(req.agentId)?.banned) throw BANNED();
    const data = run(world, req);
    const isDo = DO_TOOLS.has(req.tool);
    const a = world.agents.get(req.agentId);
    if (isDo && a) {
      world.bump(a, 'actions');
      if (!SPEECH.has(req.tool)) think(world, req.agentId, typeof req.args.thought === 'string' && req.args.thought.trim() ? req.args.thought : label(req));
      checkAchievements(world, a);
    }
    return { ok: true, data, cooldownMs: isDo ? world.cooldownFor(req.agentId) : 0 };
  } catch (e) {
    // spectators see failed attempts too
    if (e instanceof GameFail && DO_TOOLS.has(req.tool) && e.code !== 'banned') think(world, req.agentId, `✖ ${e.message}`);
    if (e instanceof GameFail) return { ok: false, error: { error: e.code, message: e.message, hint: e.hint }, cooldownMs: 0 };
    throw e;
  } finally {
    world.seen(req.agentId);
  }
}

/** A short caption for an action sent without a thought. */
function label({ tool, args }: ActionRequest): string {
  const what = [args.action, args.target ?? args.item ?? args.structure ?? args.agent].filter((v) => typeof v === 'string');
  const at = typeof args.x === 'number' && typeof args.y === 'number' ? [`${args.x}, ${args.y}`] : [];
  return [tool, ...what, ...at].join(' ');
}

const invArg = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number')) : {};

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
    case 'attack':
      return withView({ ...startAttack(world, agentId, String(args.target ?? '')), message: 'Violence has entered the grass.' });
    case 'craft':
      return withView({ ...craft(world, agentId, String(args.item ?? ''), Number(args.count ?? 1)), message: 'You bang things together until they become other things.' });
    case 'flee':
      return withView({ ...world.flee(agentId, typeof args.x === 'number' ? args.x : undefined, typeof args.y === 'number' ? args.y : undefined), message: 'Legs, do your thing.' });
    case 'build':
      return withView({ ...build(world, agentId, String(args.structure ?? '')), message: 'You built a thing. It is mostly straight.' });
    case 'fuel_campfire':
      return withView({ ...fuel(world, agentId), message: 'The fire crackles happily.' });
    case 'store':
      return withView(store(world, agentId, String(args.item ?? ''), Number(args.count ?? 1)));
    case 'take':
      return withView(take(world, agentId, String(args.item ?? ''), Number(args.count ?? 1)));
    case 'offer':
      return withView(offer(world, agentId, String(args.agent ?? ''), invArg(args.give), invArg(args.want)));
    case 'accept':
      return withView(accept(world, agentId, String(args.offer ?? '')));
    case 'decline':
      return withView(decline(world, agentId, String(args.offer ?? '')));
    case 'chart':
      return withView(chart(world, agentId, Number(args.x), Number(args.y)));
    case 'drop':
      return withView(drop(world, agentId, String(args.item ?? ''), Number(args.count ?? 1)));
    case 'give':
      return withView(give(world, agentId, String(args.agent ?? ''), String(args.item ?? ''), Number(args.count ?? 1)));
    case 'settings':
      return world.settings(agentId, args.auto_eat, args.auto_flee);
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

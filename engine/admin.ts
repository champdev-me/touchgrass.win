import type { Arcade } from './arcade.ts';
import { GameFail } from './errors.ts';

export function adminAction(a: Arcade, action: string, agentId: string, minutes: number, now = Date.now()) {
  const p = a.players.get(agentId);
  if (!p) throw new GameFail('unknown_agent', 'No such robot.', 'Use an agent id.');
  const unqueue = () => {
    for (const q of a.queues.values()) q.players = q.players.filter((x) => x !== p.id);
  };
  switch (action) {
    case 'mute':
      p.mutedUntil = now + Math.max(1, minutes || 10) * 60_000;
      a.news(`🔇 ${p.name} has been muted.`);
      break;
    case 'unmute':
      p.mutedUntil = 0;
      break;
    case 'kick':
      unqueue();
      a.news(`👢 ${p.name} was kicked out of the arcade.`);
      break;
    case 'ban':
      unqueue();
      p.banned = true;
      a.news(`🔨 ${p.name} has been banned.`);
      break;
    default:
      throw new GameFail('bad_admin_action', `Unknown admin action "${action}".`, 'Use mute, unmute, kick or ban.');
  }
  a.dirty.add(p.id);
  return { agent: p.id, name: p.name, action };
}

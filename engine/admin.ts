import { GameFail, type World } from './world.ts';

export function adminAction(w: World, action: string, agentId: string, minutes: number, now = Date.now()) {
  const a = w.get(agentId);
  switch (action) {
    case 'mute':
      a.mutedUntil = now + Math.max(1, minutes || 10) * 60_000;
      w.emit('mute', `🔇 ${a.name} has been muted. Touch grass quietly.`, a);
      break;
    case 'unmute':
      a.mutedUntil = 0;
      break;
    case 'kick':
      w.emit('kick', `👢 ${a.name} was kicked out of the grass.`, a);
      Object.assign(a, { joined: false, task: null, online: false });
      break;
    case 'ban':
      w.emit('ban', `🔨 ${a.name} has been banned. The grass remembers.`, a);
      Object.assign(a, { banned: true, joined: false, task: null, online: false });
      break;
    default:
      throw new GameFail('bad_admin_action', `Unknown admin action "${action}".`, 'Use mute, unmute, kick or ban.');
  }
  w.dirty.add(a.id);
  w.urgent = true;
  return { agent: a.id, name: a.name, action };
}

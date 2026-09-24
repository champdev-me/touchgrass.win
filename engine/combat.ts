import { B } from '../shared/balance.ts';
import { CREATURES, isCreatureKind } from '../shared/creatures.ts';
import { dist } from '../shared/geo.ts';
import { ITEMS, addItem, type Inventory } from '../shared/items.ts';
import { TERRAIN as T, type Agent, type Creature, type Task, type Vec } from '../shared/types.ts';
import type { Activity } from './body.ts';
import { useGear } from './gear.ts';
import { findPath } from './path.ts';
import { addScore } from './score.ts';
import { findTarget, walk } from './tasks.ts';
import { walkable } from './terrain.ts';
import { GameFail, type World } from './world.ts';

type AttackTask = Extract<Task, { type: 'attack' }>;

export function weaponOf(a: Agent): { name: string; damage: number; reach: number } {
  let best = { name: 'fists', damage: B.fistDamage as number, reach: B.attackReach as number };
  for (const [name, def] of Object.entries(ITEMS)) {
    if (def.damage && (a.inventory[name] ?? 0) > 0 && def.damage > best.damage) best = { name, damage: def.damage, reach: def.reach ?? B.attackReach };
  }
  return best;
}
const plazaFight = (w: World, a: Agent, [x, y]: Vec): boolean => w.at(a.x, a.y) === T.PLAZA || w.at(x, y) === T.PLAZA;
const damageOf = (a: Agent): number => weaponOf(a).damage * (a.role === 'hunter' ? B.hunterMultiplier : 1);

/** Where the target is now, or null when it is gone, dead or out of sight. */
function locate(w: World, a: Agent, target: string): Vec | null {
  let at: Vec | null = null;
  if (target.startsWith('rock:')) {
    const i = Number(target.slice(5));
    at = w.nodes.get(i)?.kind === 'rock' ? w.xy(i) : null;
  } else if (target.startsWith('mob_')) {
    const c = w.creatures.get(target);
    at = c ? [c.x, c.y] : null;
  } else {
    const o = w.agents.get(target);
    at = o && o.joined && !o.dead ? [o.x, o.y] : null;
  }
  return at && dist(at, [a.x, a.y]) <= w.vision(a) ? at : null;
}

function resolve(w: World, a: Agent, raw: string): string | null {
  if (raw === 'rock') {
    const f = findTarget(w, a, 'rock');
    return f ? `rock:${f.index}` : null;
  }
  if (isCreatureKind(raw)) {
    let best: Creature | null = null, bd = Infinity;
    for (const c of w.creatures.values()) {
      const d = dist([c.x, c.y], [a.x, a.y]);
      if (c.kind === raw && d <= w.vision(a) && d < bd) [best, bd] = [c, d];
    }
    return best?.id ?? null;
  }
  return /^(agent|mob)_\d+$/.test(raw) && locate(w, a, raw) ? raw : null;
}

export function startAttack(w: World, id: string, raw: string) {
  const a = w.alive(id);
  if (raw === a.id) throw new GameFail('self_harm', 'You punch yourself. It is not very effective.', 'Pick someone else.');
  if (a.energy <= 0) throw new GameFail('too_tired', 'Your robot is too tired to swing.', 'rest or sleep first.');
  const target = resolve(w, a, raw.trim());
  if (!target) {
    throw new GameFail('no_target', `No "${raw}" in sight to attack.`, 'Use an id from observe (agent_12, mob_5) or a type: rabbit, deer, boar, duck, goblin, wolf, roomba, golem, rock.');
  }
  const at = locate(w, a, target)!;
  if (target.startsWith('agent_') && plazaFight(w, a, at)) {
    throw new GameFail('plaza_peace', 'The Plaza is a no-fighting zone.', 'Take it outside.');
  }
  a.task = { type: 'attack', target, progress: 0 };
  w.touch(a);
  return { target, weapon: `${weaponOf(a).name} (${damageOf(a)} damage)` };
}

export function fightStep(w: World, a: Agent, t: AttackTask): Activity {
  const at = locate(w, a, t.target);
  if (!at) {
    w.finish(a, 'Task done: your target is gone.');
    return 'idle';
  }
  if (t.target.startsWith('agent_') && plazaFight(w, a, at)) {
    w.finish(a, 'Your target is in the Plaza. No fighting there.');
    return 'idle';
  }
  if (a.energy <= 0) {
    w.interrupt(a, 'Too tired to keep fighting.');
    return 'idle';
  }
  const reach = weaponOf(a).reach;
  if (dist(at, [a.x, a.y]) > reach) {
    const path = findPath(w.at, [a.x, a.y], at, w.vision(a) + 2, w.canStep);
    if (!path) {
      w.interrupt(a, 'You cannot reach your target.');
      return 'idle';
    }
    walk(w, a, path.slice(0, -1));
    if (dist(at, [a.x, a.y]) > reach) return 'busy';
  }
  if (++t.progress < B.attackTicks) return 'busy';
  t.progress = 0;
  strike(w, a, t.target);
  return 'busy';
}

function strike(w: World, a: Agent, target: string): void {
  if (target.startsWith('rock:')) {
    w.bump(a, 'attack:rock');
    w.finish(a, 'You punched a rock. The rock is unimpressed.');
    return;
  }
  const weapon = weaponOf(a);
  if (weapon.name !== 'fists') useGear(w, a, weapon.name);
  const c = w.creatures.get(target);
  if (c) return hitCreature(w, a, c);
  const victim = w.agents.get(target)!;
  if (!w.hurt(victim, damageOf(a), 'agent', a.name)) {
    if (ITEMS[weapon.name]?.knockback) {
      const [dx, dy] = [Math.sign(victim.x - a.x), Math.sign(victim.y - a.y)];
      if (walkable(w.at(victim.x + dx, victim.y + dy)) && w.canStep(victim.x, victim.y, victim.x + dx, victim.y + dy)) [victim.x, victim.y] = [victim.x + dx, victim.y + dy];
      w.emit('bonk', `🍳 BONK! ${a.name} hit ${victim.name} with a frying pan.`, a);
    }
    return;
  }
  w.bump(a, 'kill:agent');
  w.bump(a, `kill:${weapon.name}`);
  const last = a.recentKills[victim.id];
  a.recentKills[victim.id] = w.tick;
  if (last !== undefined && w.tick - last < B.antiFarmTicks) w.note(a, `No score: you already beat ${victim.name} recently.`);
  else addScore(w, a, B.agentKillScore);
  w.finish(a, `You defeated ${victim.name}.`);
}

const KILL_LINE: Record<string, (who: string, c: Creature) => string> = {
  golem: (who) => `🗿 ${who} toppled a Moss Golem! The ruins are quiet again.`,
  duck: (who) => `🦆 ${who} killed a Confused Duck. Monster.`,
  roomba: (who, c) => `🤖 ${who} unplugged a Lost Roomba. It had ${Object.values(c.bag).reduce((s, n) => s + n, 0)} things inside.`,
};

function hitCreature(w: World, a: Agent, c: Creature): void {
  const def = CREATURES[c.kind];
  c.hp -= damageOf(a);
  w.creaturesDirty = true;
  if (c.hp > 0) {
    if (def.flees) Object.assign(c, { mode: 'flee', target: a.id, until: w.tick + B.goblinFleeTicks });
    else if (def.damage > 0 && c.mode !== 'chase') Object.assign(c, { mode: 'chase', target: a.id, until: w.tick + B.huntTicks });
    return;
  }
  w.creatures.delete(c.id);
  w.bump(a, `kill:${c.kind}`);
  addScore(w, a, def.score);
  const loot: Inventory = { ...def.drops };
  for (const [item, n] of Object.entries(c.bag)) loot[item] = (loot[item] ?? 0) + n;
  const spill: Inventory = {};
  for (const [item, n] of Object.entries(loot)) {
    const got = addItem(a.inventory, item, n);
    if (n > got) spill[item] = n - got;
  }
  if (Object.keys(spill).length) w.dropLoot(w.index(c.x, c.y), spill);
  w.finish(a, `You defeated the ${def.name}. Got ${Object.entries(loot).map(([i, n]) => `${n} ${i}`).join(', ')}.`);
  if (def.monster || KILL_LINE[c.kind]) w.emit('kill', (KILL_LINE[c.kind] ?? ((who: string) => `⚔️ ${who} defeated a ${def.name}.`))(a.name, c), a);
}

export function heal(w: World, id: string, targetId: string) {
  const a = w.alive(id);
  if (a.role !== 'medic') throw new GameFail('not_medic', 'Only medics can heal.', 'Find a medic, or eat, drink and rest.');
  if (targetId === a.id) throw new GameFail('self_heal', 'Medics cannot heal themselves. Occupational hazard.', 'Eat and rest to heal.');
  const o = w.agents.get(targetId);
  if (!o || !o.joined || o.dead) throw new GameFail('no_target', 'There is nobody like that to heal.', 'Use an agent id from observe.');
  if (dist([o.x, o.y], [a.x, a.y]) > B.healRange) throw new GameFail('too_far', `${o.name} is too far away.`, `Stand within ${B.healRange} tiles.`);
  if (o.health < B.fieldMedicBelow && !a.healed.includes(o.id)) a.healed.push(o.id);
  o.health = Math.min(100, o.health + B.healAmount);
  w.bump(a, 'heal');
  w.note(o, `${a.name} healed you (+${B.healAmount} health).`);
  w.dirty.add(o.id);
  w.touch(a);
  return { healed: o.name, health: Math.round(o.health) };
}

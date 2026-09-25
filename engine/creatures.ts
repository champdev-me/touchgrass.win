import { B } from '../shared/balance.ts';
import { CREATURES, type CreatureKind } from '../shared/creatures.ts';
import { dist } from '../shared/geo.ts';
import { takeItem } from '../shared/items.ts';
import { timeOf } from '../shared/time.ts';
import { TERRAIN as T, type Agent, type Creature, type Vec } from '../shared/types.ts';
import { say } from './lines.ts';
import { walkable } from './terrain.ts';
import type { LootPile, World } from './world.ts';

const STEPS: Vec[] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const hasBag = (c: Creature) => Object.keys(c.bag).length > 0;
// Which animals roam, and how often each is picked; they come in small herds.
const HERDS: [CreatureKind, number][] = [['rabbit', 0.25], ['deer', 0.2], ['boar', 0.15], ['cow', 0.2], ['chicken', 0.2]];
const HERD_KINDS = new Set<CreatureKind>(HERDS.map(([k]) => k));

export function spawnCreature(w: World, kind: CreatureKind, [x, y]: Vec, pack = 0): Creature {
  const c: Creature = { id: `mob_${w.nextMobId++}`, kind, x, y, hp: CREATURES[kind].hp, mode: 'wander', target: null, until: 0, bag: {}, pack, hitAt: -B.monsterBiteTicks };
  w.creatures.set(c.id, c);
  w.creaturesDirty = true;
  return c;
}

/** Nothing stands on deep water or Plaza tiles; monsters also keep 40 tiles from the Plaza. */
function canStand(w: World, kind: CreatureKind, x: number, y: number): boolean {
  const t = w.at(x, y);
  if (!walkable(t) || t === T.PLAZA || w.solid(x, y)) return false;
  return !CREATURES[kind].monster || dist([x, y], w.plaza) > B.plazaSafeRadius;
}

function spawnSpot(w: World, kind: CreatureKind, [nx, ny]: Vec): Vec | null {
  const [min, max] = CREATURES[kind].monster ? [B.spawnMinDist, B.spawnMaxDist] : [B.animalSpawnMin, B.animalSpawnMax];
  for (let i = 0; i < 12; i++) {
    const angle = w.rng() * Math.PI * 2, r = min + w.rng() * (max - min);
    const x = Math.round(nx + Math.cos(angle) * r), y = Math.round(ny + Math.sin(angle) * r);
    if (x >= 0 && y >= 0 && x < w.size && y < w.size && w.at(x, y) !== T.SHALLOW && canStand(w, kind, x, y) && !(CREATURES[kind].monster && w.lit(x, y))) return [x, y];
  }
  return null;
}

function nearest(robots: Agent[], x: number, y: number): { a: Agent; d: number } | null {
  let best: { a: Agent; d: number } | null = null;
  for (const a of robots) {
    const d = dist([a.x, a.y], [x, y]);
    if (!best || d < best.d) best = { a, d };
  }
  return best;
}

function move(w: World, c: Creature, score: (x: number, y: number) => number): void {
  let best: Vec | null = null, bs = score(c.x, c.y);
  for (const [dx, dy] of STEPS) {
    const x = c.x + dx, y = c.y + dy;
    if (!canStand(w, c.kind, x, y) || !w.canStep(c.x, c.y, x, y)) continue;
    const s = score(x, y);
    if (s < bs) [bs, best] = [s, [x, y]];
  }
  if (best) {
    [c.x, c.y] = best;
    w.creaturesDirty = true;
  }
}
const toward = (w: World, c: Creature, [tx, ty]: Vec) => move(w, c, (x, y) => dist([x, y], [tx, ty]) + (Math.abs(x - tx) + Math.abs(y - ty)) * 0.01);
const away = (w: World, c: Creature, [tx, ty]: Vec) => move(w, c, (x, y) => -dist([x, y], [tx, ty]));

function wander(w: World, c: Creature): void {
  if (w.rng() >= B.wanderChance) return;
  const [dx, dy] = STEPS[Math.floor(w.rng() * STEPS.length)];
  if (canStand(w, c.kind, c.x + dx, c.y + dy) && w.canStep(c.x, c.y, c.x + dx, c.y + dy)) {
    c.x += dx;
    c.y += dy;
    w.creaturesDirty = true;
  }
}

function setMode(c: Creature, mode: Creature['mode'], a: Agent | null, until: number): void {
  c.mode = mode;
  c.target = a?.id ?? null;
  c.until = until;
}

function prey(w: World, c: Creature, robots: Agent[]): Agent | null {
  let best: Agent | null = null, bd = Infinity;
  for (const a of robots) {
    const d = dist([a.x, a.y], [c.x, c.y]);
    if (d > B.aggroRadius || d >= bd) continue;
    if (c.kind === 'wolf' && robots.some((o) => o !== a && dist([o.x, o.y], [a.x, a.y]) <= B.aloneRadius)) continue;
    if (c.kind === 'goblin' && !Object.keys(a.inventory).length) continue;
    best = a;
    bd = d;
  }
  return best;
}

function hunt(w: World, c: Creature, a: Agent): void {
  const pack = c.pack ? [...w.creatures.values()].filter((o) => o.pack === c.pack) : [c];
  for (const m of pack) setMode(m, 'chase', a, w.tick + B.huntTicks);
  const def = CREATURES[c.kind];
  w.alarm(a, `${def.emoji} A ${c.pack ? `${def.name} pack` : def.name} is hunting you!`);
}

function bite(w: World, c: Creature, a: Agent): void {
  const def = CREATURES[c.kind];
  c.hitAt = w.tick;
  if (c.kind === 'goblin') {
    const items = Object.keys(a.inventory);
    if (items.length) {
      const item = items[Math.floor(w.rng() * items.length)];
      takeItem(a.inventory, item);
      c.bag[item] = (c.bag[item] ?? 0) + 1;
      w.emit('steal', `👺 A Grass Goblin stole ${a.name}'s ${item}!`, a);
    }
    setMode(c, 'flee', a, w.tick + B.goblinFleeTicks);
  }
  w.hurt(a, def.damage, c.kind, `A ${def.name}`);
}

/** An animal leaps at a robot that came too close, kicks it, and bolts. */
function kick(w: World, c: Creature, a: Agent): void {
  for (let i = 0; i < B.fleeRadius && dist([a.x, a.y], [c.x, c.y]) > B.attackReach; i++) toward(w, c, [a.x, a.y]);
  if (dist([a.x, a.y], [c.x, c.y]) > B.attackReach) return;
  const def = CREATURES[c.kind];
  if (c.kind !== 'duck' && w.tick - w.lastKickNews >= B.kickNewsTicks) { // ducks peck too often to be news
    w.lastKickNews = w.tick;
    w.emit('kick', say(`kick:${c.kind}`, a.name, w.rng), a);
  }
  w.note(a, `${def.emoji} A ${def.name} kicked you (-${def.kick} health).`);
  setMode(c, 'flee', a, w.tick + 5);
  w.hurt(a, def.kick, c.kind, `A ${def.name}`, false); // a kick is rude, not a reason to drop everything
}

const oldPile = (w: World, p: LootPile) => p.expiresAt - w.tick <= B.lootTicks - B.roombaLootAgeTicks;

function roombaStep(w: World, c: Creature): void {
  const here = w.index(c.x, c.y), pile = w.loot.get(here);
  if (pile && oldPile(w, pile)) {
    for (const [item, n] of Object.entries(pile.items)) c.bag[item] = (c.bag[item] ?? 0) + n;
    w.loot.delete(here);
    w.lootDirty = true;
    w.emit('vacuum', `🤖 A Lost Roomba vacuumed up a loot pile at (${c.x}, ${c.y}). Beep boop.`);
    return;
  }
  let best: Vec | null = null, bd = Infinity;
  for (const [i, p] of w.loot) {
    const at = w.xy(i), d = dist(at, [c.x, c.y]);
    if (oldPile(w, p) && d <= B.roombaSniffRadius && d < bd) [best, bd] = [at, d];
  }
  if (best) toward(w, c, best);
  else wander(w, c);
}

function act(w: World, c: Creature, robots: Agent[]): void {
  const def = CREATURES[c.kind];
  if (def.speed < 1 && w.tick % 2) return;
  const current = c.target ? w.agents.get(c.target) : undefined;
  if (c.mode !== 'wander' && (!current || !current.joined || current.dead || w.tick >= c.until)) {
    setMode(c, 'wander', null, c.mode === 'follow' ? w.tick + B.duckRestTicks : 0);
  }
  if (c.kind === 'roomba') return roombaStep(w, c);
  if (def.kick > 0) {
    const near = nearest(robots, c.x, c.y);
    const mom = c.mode === 'follow' && near?.a.id === c.target; // a duck never pecks the robot it follows
    if (near && !mom && near.d <= B.fleeRadius && w.rng() < B.animalKickChance) return kick(w, c, near.a);
  }
  if (c.mode === 'wander') {
    const near = nearest(robots, c.x, c.y);
    if ((def.flees || hasBag(c)) && near && near.d <= B.fleeRadius) setMode(c, 'flee', near.a, w.tick + 5);
    else if (def.hostile && !hasBag(c)) {
      const p = prey(w, c, robots);
      if (p) hunt(w, c, p);
    } else if (c.kind === 'duck' && w.tick >= c.until) {
      const around = robots.filter((a) => dist([a.x, a.y], [c.x, c.y]) <= B.duckFollowRadius);
      if (around.length) setMode(c, 'follow', around[Math.floor(w.rng() * around.length)], w.tick + B.duckFollowTicks);
    }
  }
  const t = c.target ? w.agents.get(c.target) : undefined;
  if (c.mode === 'chase' && t) {
    for (let i = 0; i < Math.max(1, def.speed) && dist([t.x, t.y], [c.x, c.y]) > B.attackReach; i++) toward(w, c, [t.x, t.y]);
    if (dist([t.x, t.y], [c.x, c.y]) <= B.attackReach && w.tick - c.hitAt >= B.monsterBiteTicks) bite(w, c, t);
  } else if (c.mode === 'flee' && t) away(w, c, [t.x, t.y]);
  else if (c.mode === 'follow' && t) {
    if (dist([t.x, t.y], [c.x, c.y]) > 1) toward(w, c, [t.x, t.y]);
  } else wander(w, c);
}

function populate(w: World, robots: Agent[], night: boolean): void {
  if (!robots.length) return;
  const count = (keep: (c: Creature) => boolean) => [...w.creatures.values()].filter(keep).length;
  const near = (): Vec => {
    const r = robots[Math.floor(w.rng() * robots.length)];
    return [r.x, r.y];
  };
  const add = (kind: CreatureKind) => {
    const at = spawnSpot(w, kind, near());
    if (at) spawnCreature(w, kind, at);
  };
  if (count((c) => HERD_KINDS.has(c.kind)) < Math.min(B.maxAnimals, B.animalsPerAgent * robots.length)) {
    const r = w.rng();
    let sum = 0;
    const kind = HERDS.find(([, share]) => (sum += share) > r)?.[0] ?? 'rabbit';
    const size = 1 + Math.floor(w.rng() * B.herdMax), at = spawnSpot(w, kind, near());
    if (at) {
      spawnCreature(w, kind, at);
      for (let i = 1; i < size; i++) {
        const [x, y] = [at[0] + Math.floor(w.rng() * 5) - 2, at[1] + Math.floor(w.rng() * 5) - 2];
        if (canStand(w, kind, x, y)) spawnCreature(w, kind, [x, y]);
      }
    }
  }
  if (count((c) => c.kind === 'duck') < Math.min(B.maxDucks, robots.length * 2)) add('duck');
  if (count((c) => c.kind === 'roomba') < B.maxRoombas) add('roomba');
  if (!night) return;
  const online = robots.filter((a) => a.online);
  for (const a of online) {
    if (count((c) => CREATURES[c.kind].monster) >= B.monstersPerAgent * online.length || w.rng() >= B.monsterSpawnChance) continue;
    const at = spawnSpot(w, 'wolf', [a.x, a.y]);
    if (!at) continue;
    if (w.rng() < 0.6) spawnCreature(w, 'goblin', at);
    else {
      const pack = w.nextMobId;
      for (let i = 0; i < B.wolfPack; i++) spawnCreature(w, 'wolf', at, pack);
    }
  }
}

function golemNight(w: World, robots: Agent[]): void {
  if (!robots.length || w.rng() >= B.golemNightChance) return;
  const a = robots[Math.floor(w.rng() * robots.length)], spots: Vec[] = [];
  for (let y = a.y - 40; y <= a.y + 40; y++) {
    for (let x = a.x - 40; x <= a.x + 40; x++) {
      if (w.at(x, y) === T.RUINS && dist([x, y], [a.x, a.y]) >= B.spawnMinDist && canStand(w, 'golem', x, y)) spots.push([x, y]);
    }
  }
  if (!spots.length) return;
  spawnCreature(w, 'golem', spots[Math.floor(w.rng() * spots.length)]);
  w.emit('golem', '🗿 The ground rumbles. A Moss Golem wakes up in the ruins.');
}

function dawn(w: World): void {
  let gone = 0;
  for (const c of w.creatures.values()) {
    if (!CREATURES[c.kind].monster) continue;
    w.creatures.delete(c.id);
    gone++;
  }
  if (!gone) return;
  w.creaturesDirty = true;
  w.emit('monsters', say('monsters', '', w.rng));
}

/** One tick of every creature, after the robots have moved. */
export function stepCreatures(w: World): void {
  const robots = [...w.agents.values()].filter((a) => a.joined && !a.dead);
  const { phase, dayTick } = timeOf(w.tick);
  if (dayTick === 0) dawn(w);
  if (dayTick === B.dayTicks - B.nightTicks) golemNight(w, robots.filter((a) => a.online));
  populate(w, robots, phase === 'night');
  for (const c of [...w.creatures.values()]) {
    if (!w.creatures.has(c.id)) continue;
    const d = nearest(robots, c.x, c.y)?.d ?? Infinity;
    if (d > B.creatureDespawnRadius) {
      w.creatures.delete(c.id);
      w.creaturesDirty = true;
    } else if (d <= B.creatureActiveRadius) act(w, c, robots);
  }
}

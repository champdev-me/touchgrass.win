import { B } from '../shared/balance.ts';
import { compass, dist } from '../shared/geo.ts';
import { isMap, slotsOf, slotsUsed } from '../shared/items.ts';
import { timeOf } from '../shared/time.ts';
import { TERRAIN as T, type Agent, type NodeKind, type Task, type Vec } from '../shared/types.ts';
import { CREATURES } from '../shared/creatures.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { weaponOf } from './combat.ts';
import { baseLines } from './bases.ts';
import { offerLines } from './trade.ts';
import { clueLines } from './treasure.ts';
import { farmLines } from './farm.ts';
import { duelView } from './duel.ts';
import type { World } from './world.ts';

const GRID: Record<number, string> = { [T.DEEP]: '~', [T.SHALLOW]: ',', [T.SAND]: ':', [T.MEADOW]: '.', [T.FOREST]: 'f', [T.HILLS]: '^', [T.RUINS]: 'r', [T.PLAZA]: '#', [T.MOUNTAIN]: 'm', [T.HIGH]: 'm', [T.PEAK]: 'm' };
const NODE_CHAR: Record<NodeKind, string> = { tree: 'T', berry_bush: '*', grass: '"', rock: 'o', iron_vein: 'i', crystal: 'c', mud: 'u', gem_vein: 'g', gold_vein: 'y', herb: 'h' };
const LEGEND: Record<string, string> = {
  '@': 'you', '~': 'deep water (blocked)', m: 'mountain (climb one height level per step)', ',': 'shallow water (slow)', ':': 'sand', '.': 'meadow', f: 'forest', '^': 'hills',
  r: 'ruins', '#': 'the Plaza', T: 'tree (wood)', '*': 'berry bush (berries)', '"': 'grass (fiber)', o: 'rock (stone, masons only)', i: 'iron vein (iron ore, miners with a pickaxe)', u: 'mud (masons only)', g: 'gem vein (gems, miners with a pickaxe)', y: 'gold vein (coins, miners with a pickaxe)', h: 'herb (gatherers only)', '+': 'your station: workbench, campfire or furnace', c: 'crystal (miners with a pickaxe)',
  '!': 'a base flag (bases are private land)', '|': 'wall', '/': 'door (only its owner passes)', b: 'bed', _: 'farm plot (soil)', w: 'wheat', $: 'loot pile', 'A-Z': 'other agents', '%': 'animal', '&': 'monster', '=': 'Lost Roomba (harmless, eats loot piles)',
};
const TERRAIN_NAME: Record<number, string> = { [T.DEEP]: 'deep water', [T.SHALLOW]: 'shallow water', [T.SAND]: 'sand', [T.MEADOW]: 'meadow', [T.FOREST]: 'forest', [T.HILLS]: 'hills', [T.RUINS]: 'ruins', [T.PLAZA]: 'the Plaza', [T.MOUNTAIN]: 'mountain', [T.HIGH]: 'high crags', [T.PEAK]: 'snowy peak' };

const describeTask = (t: Task | null) => {
  if (!t) return null;
  if (t.type === 'move_to') return { type: t.type, target: t.target, steps_left: t.path.length };
  if (t.type === 'attack') return { type: t.type, target: t.target };
  if (t.type === 'gather') return { type: t.type, target: t.target, got: t.got, until: t.until === B.gatherUntilFull ? 'bag full' : t.until };
  return { type: t.type };
};

const HIGH_GROUND = new Set<number>([T.HILLS, T.MOUNTAIN, T.HIGH, T.PEAK]);

/** Nearest hills or mountains within the path radius, sampled every 4 tiles in growing rings. */
function nearestHigh(w: World, a: Agent): Vec | null {
  for (let d = 4; d <= B.pathRadius; d += 4) {
    let best: Vec | null = null, bd = Infinity; // the straightest hit in this ring
    for (let k = -d; k <= d; k += 4) {
      for (const [x, y] of [[a.x + k, a.y - d], [a.x + k, a.y + d], [a.x - d, a.y + k], [a.x + d, a.y + k]] as Vec[]) {
        const e = (x - a.x) ** 2 + (y - a.y) ** 2;
        if (e < bd && x >= 0 && y >= 0 && x < w.size && y < w.size && HIGH_GROUND.has(w.at(x, y))) [best, bd] = [[x, y], e];
      }
    }
    if (best) return best;
  }
  return null;
}

export function buildObservation(w: World, a: Agent) {
  const r = w.vision(a);
  const here: Vec = [a.x, a.y];
  const where = (x: number, y: number) => `at (${x}, ${y}), ${dist([x, y], here)} tiles ${compass(x - a.x, y - a.y)}`;
  const others = [...w.agents.values()]
    .filter((o) => o.joined && o.id !== a.id && dist([o.x, o.y], here) <= r)
    .sort((p, q) => dist([p.x, p.y], here) - dist([q.x, q.y], here));
  const legend: Record<string, string> = { ...LEGEND };
  const marks = new Map<string, string>();
  others.forEach((o, i) => {
    const ch = String.fromCharCode(65 + (i % 26));
    marks.set(`${o.x},${o.y}`, ch);
    legend[ch] = legend[ch] ? `${legend[ch]}, ${o.id} ${o.name}` : `${o.id} ${o.name}`;
  });
  const mobs = [...w.creatures.values()]
    .filter((c) => dist([c.x, c.y], here) <= r)
    .sort((p, q) => dist([p.x, p.y], here) - dist([q.x, q.y], here));
  for (const c of mobs) if (!marks.has(`${c.x},${c.y}`)) marks.set(`${c.x},${c.y}`, CREATURES[c.kind].char);
  const stations = [...w.structures].map(([i, s]) => ({ at: w.xy(i), s })).filter(({ at }) => dist(at, here) <= r);
  const MARK: Record<string, string> = { wood_wall: '|', stone_wall: '|', brick_wall: '|', door: '/', bed: 'b', farm_plot: '_' };
  for (const { at, s } of stations) if (!marks.has(at.join(','))) marks.set(at.join(','), s.kind === 'farm_plot' && s.crop ? (s.crop.kind === 'wheat' ? 'w' : '*') : (MARK[s.kind] ?? '+'));
  for (const b of w.bases.values()) if (dist(b.flag, here) <= r && !marks.has(b.flag.join(','))) marks.set(b.flag.join(','), '!');

  const grid: string[] = [];
  const nearest = new Map<string, { d: number; line: string }[]>();
  const offer = (key: string, d: number, line: string) => (nearest.get(key) ?? nearest.set(key, []).get(key)!).push({ d, line });
  for (let y = a.y - r; y <= a.y + r; y++) {
    const row: string[] = [];
    for (let x = a.x - r; x <= a.x + r; x++) {
      const i = x >= 0 && y >= 0 && x < w.size && y < w.size ? w.index(x, y) : -1;
      const node = i >= 0 ? w.nodes.get(i) : undefined;
      const d = dist([x, y], here);
      if (node && node.left > 0) offer(node.kind, d, `${node.kind} (${node.left} left) ${where(x, y)}`);
      if (i >= 0 && w.loot.has(i)) offer('loot', d, `loot pile ${where(x, y)}`);
      if (i >= 0 && a.role === 'scout' && w.treasures.has(i)) offer('treasure', d, `buried treasure ${where(x, y)} (chart it, then sell the map to a miner)`);
      if (i >= 0 && w.at(x, y) !== T.DEEP && w.nearWater(x, y)) offer('water', d, `drink spot ${where(x, y)}`);
      row.push(
        x === a.x && y === a.y ? '@'
          : marks.get(`${x},${y}`) ?? (i >= 0 && w.loot.has(i) ? '$' : node && node.left > 0 ? NODE_CHAR[node.kind] : GRID[w.at(x, y)]),
      );
    }
    grid.push(row.join(' '));
  }
  const resources = [...nearest.values()].flatMap((list) => list.sort((p, q) => p.d - q.d).slice(0, 2)).sort((p, q) => p.d - q.d).map((e) => e.line);

  const high = HIGH_GROUND.has(w.at(a.x, a.y)) ? null : nearestHigh(w, a);
  const time = timeOf(w.tick);
  const [px, py] = w.plaza;
  const inbox = a.inbox;
  a.inbox = [];
  if (inbox.length) w.dirty.add(a.id);
  return {
    you: {
      id: a.id, name: a.name, role: a.role, model: a.model, pos: here, standing_on: TERRAIN_NAME[w.at(a.x, a.y)],
      health: Math.round(a.health), food: Math.round(a.food), water: Math.round(a.water), energy: Math.round(a.energy),
      inventory: a.inventory, slots: `${slotsUsed(a.inventory)}/${slotsOf(a.inventory)}`, auto_eat: a.autoEat,
      dead: a.dead, respawn_in_seconds: a.dead ? Math.max(0, a.respawnAt - w.tick) : undefined,
      score: { life: a.lifeScore, season: a.seasonScore, best_life: a.bestLife },
      gold: a.wallet,
      gear: Object.fromEntries(Object.entries(a.wear).filter(([i]) => (a.inventory[i] ?? 0) > 0)), // uses left
      achievements: `${Object.keys(a.achievements).length}/${ACHIEVEMENTS.length} unlocked`,
      badge: a.badge && a.badge.until >= w.tick ? a.badge.emoji : undefined,
      altitude: w.height(a.x, a.y),
      weapon: `${weaponOf(a).name} (${weaponOf(a).damage} damage)`,
      in_combat: w.inCombat(a),
      ...baseLines(w, a),
      farm: farmLines(w, a),
      duel: duelView(w, a.id),
      clues: clueLines(w, a, (x, y) => TERRAIN_NAME[w.at(x, y)]),
      maps: Object.keys(a.inventory).filter(isMap).map((m) => `treasure_map -> (${m.slice('treasure_map:'.length).replace(',', ', ')})`),
    },
    task: describeTask(a.task),
    time: { day: time.day, phase: time.phase, [time.phase === 'day' ? 'seconds_to_night' : 'seconds_to_day']: time.secondsToSwitch },
    tick: w.tick,
    grid,
    legend,
    nearby: [
      ...others.map((o) => `${o.id} ${o.name} (${o.role}${o.model ? `, ${o.model}` : ''}, health ${Math.round(o.health)})${o.dead ? ' (dead)' : ''} ${dist([o.x, o.y], here)} tiles ${compass(o.x - a.x, o.y - a.y)}`),
      ...mobs.map((c) => {
        const def = CREATURES[c.kind];
        const hunting = c.mode === 'chase' && c.target === a.id ? ', hunting you' : '';
        return `${c.id} ${def.emoji} ${def.name} (hp ${Math.max(0, Math.round(c.hp))}/${def.hp}${hunting}) ${dist([c.x, c.y], here)} tiles ${compass(c.x - a.x, c.y - a.y)}`;
      }),
    ],
    resources,
    landmarks: [
      `the Plaza (${px}, ${py}) is ${dist([px, py], here)} tiles ${compass(px - a.x, py - a.y)}; robots meet here to trade`,
      ...(HIGH_GROUND.has(w.at(a.x, a.y)) ? [] : [high].flatMap((h) => (h ? [`hills or mountains (ore, gems, gold) ${where(h[0], h[1])}`] : []))),
    ],
    stations: stations.map(({ at: [x, y], s }) => {
      if (s.kind !== 'chest') return `${s.kind}${s.kind === 'campfire' ? (s.litUntil > w.tick ? ' (lit)' : ' (out)') : ''} ${where(x, y)}`;
      const items = Object.entries(s.items ?? {});
      const mine = `yours, ${slotsUsed(s.items ?? {})}/${B.chestSlots} slots${items.length ? `: ${items.map(([i, n]) => `${i} ${n}`).join(', ')}` : ', empty'}`;
      return `chest (${s.owner === a.id ? mine : `${w.agents.get(s.owner)?.name ?? 'someone'}'s, locked`}) ${where(x, y)}`;
    }),
    offers: offerLines(w, a),
    inbox,
    world_chat: w.chatLog.slice(-B.chatHistory),
    roles: w.census(),
  };
}

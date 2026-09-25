import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { HorseView, MatchView, TalkLine } from '../../shared/types.ts';
import { icon } from './icons.ts';
import { sfx } from './sound.ts';

export const LANES = 4, LANE_W = 2.4;
export const LANE_COLORS = ['#c0392b', '#2e6fd8', '#e0b020', '#2f9e55']; // heraldic red, blue, gold, green
const COATS = ['#8a5a3a', '#4a3a32', '#d8cfc4', '#b07a45']; // chestnut, black, grey, bay
// One lap is 100 lengths: a 30-length straight, a 20-length bend, the back straight, the far bend.
const SCALE = 1.3;
export const S = 30 * SCALE, R0 = (20 * SCALE) / Math.PI;
const WIDTH = LANES * LANE_W, OUTER = R0 + WIDTH;
export const CENTER = new THREE.Vector3(S / 2, 0, 0);
const HURDLES = [20, 27, 60, 67]; // lengths into each lap: two fences on each straight
const HORSE_H = 1.5, RIDER_H = 0.95, BUBBLE_MS = 6000, JUMP = 2.5, GALLOP = 2.5; // GALLOP: lengths a second at a normal run
const laneRho = (i: number) => R0 + (i + 0.5) * LANE_W;

/** [x, z, heading] on the oval at `distance` lengths, `rho` units out from the bend centres. */
export function onOval(distance: number, rho: number): [number, number, number] {
  const d = ((distance % 100) + 100) % 100;
  if (d < 30) return [(S * d) / 30, rho, Math.PI / 2];
  if (d < 50) {
    const a = (Math.PI * (d - 30)) / 20;
    return [S + rho * Math.sin(a), rho * Math.cos(a), Math.PI / 2 + a];
  }
  if (d < 80) return [S - (S * (d - 50)) / 30, -rho, -Math.PI / 2];
  const a = (Math.PI * (d - 80)) / 20;
  return [-rho * Math.sin(a), -rho * Math.cos(a), -Math.PI / 2 + a];
}
const ring = (rho: number, y = 0) => Array.from({ length: 200 }, (_, i) => {
  const [x, z] = onOval(i / 2, rho);
  return new THREE.Vector3(x, y, z);
});
/** How far past the nearest hurdle a runner is, in lengths (hurdles repeat every lap). */
const fromHurdle = (distance: number) => Math.min(...HURDLES.map((h) => Math.abs(((((distance - h) % 100) + 150) % 100) - 50)));

/** Talk lines after `seen` (the last line shown), and the new `seen`. */
export function newTalk(talk: TalkLine[], seen: string): { lines: TalkLine[]; seen: string } {
  const keys = talk.map((t) => JSON.stringify(t));
  return { lines: talk.slice(keys.lastIndexOf(seen) + 1), seen: keys.at(-1) ?? seen };
}

export interface Model { scene: THREE.Object3D; clips: THREE.AnimationClip[] }
const loader = new GLTFLoader();
export const load = async (path: string): Promise<Model> => {
  const g = await loader.loadAsync(path);
  return { scene: g.scene, clips: g.animations };
};
const heightOf = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y;
const flat = (w: number, d: number, color: string, y: number) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
};

/** The tiltyard: grass, a dirt track with lanes, leg posts, a checkered finish, castle walls and towers. */
export async function buildTrack(scene: THREE.Scene): Promise<void> {
  const piece = async (name: string) => (await load(`/assets/castle/${name}.glb`)).scene;
  const [base, roof, wall, pennant, oak, tree] = await Promise.all([
    piece('tower-square-base'), piece('tower-square-top-roof'), piece('wall'), piece('flag-pennant'),
    load('/assets/tree_oak.glb').then((m) => m.scene), load('/assets/tree_default.glb').then((m) => m.scene),
  ]);
  const put = (o: THREE.Object3D, x: number, z: number, s: number, rotY = 0, y = 0) => {
    const c = o.clone();
    c.position.set(x, y, z);
    c.scale.setScalar(s);
    c.rotation.y = rotY;
    scene.add(c);
    return c;
  };
  const outline = (rho: number) => ring(rho).map((v) => new THREE.Vector2(v.x, -v.z));
  const shape = new THREE.Shape(outline(OUTER + 0.6));
  shape.holes.push(new THREE.Path(outline(R0 - 0.6)));
  const dirt = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshLambertMaterial({ color: '#b08556' }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.01;
  scene.add(flat(800, 800, '#79b356', 0), dirt);
  const tube = (rho: number, y: number, r: number, color: string) => scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring(rho, y), true), 400, r, 4, true), new THREE.MeshLambertMaterial({ color })));
  for (let i = 1; i < LANES; i++) tube(R0 + i * LANE_W, 0, 0.04, '#f4ecd8');
  for (const rho of [R0 - 0.4, OUTER + 0.4]) {
    tube(rho, 0.8, 0.07, '#f4ecd8'); // the rails, on posts
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 5), new THREE.MeshLambertMaterial({ color: '#f4ecd8' }));
    for (let d = 0; d < 100; d += 2.5) {
      const [x, z] = onOval(d, rho), p = post.clone();
      p.position.set(x, 0.4, z);
      scene.add(p);
    }
  }
  const checker = document.createElement('canvas');
  checker.width = 2;
  checker.height = 16;
  const g = checker.getContext('2d')!;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 2; x++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(checker);
  tex.magFilter = THREE.NearestFilter;
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(0.8, WIDTH), new THREE.MeshLambertMaterial({ map: tex }));
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(0, 0.03, R0 + WIDTH / 2);
  scene.add(finish);
  for (const z of [R0 - 0.9, OUTER + 0.9]) put(pennant, 0, z, 2.2, Math.PI / 2);

  // Hurdles across the track on both straights: two wooden bars between posts.
  const wood = new THREE.MeshLambertMaterial({ color: '#8a5a3a' }), white = new THREE.MeshLambertMaterial({ color: '#f4ecd8' });
  for (const h of HURDLES) {
    const [x, z] = onOval(h, R0 + WIDTH / 2), hurdle = new THREE.Group();
    for (const [y, mat] of [[0.3, white], [0.6, wood], [0.9, white]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, WIDTH), mat);
      bar.position.y = y;
      hurdle.add(bar);
    }
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.25), wood);
      p.position.set(0, 0.55, (side * WIDTH) / 2);
      hurdle.add(p);
    }
    hurdle.position.set(x, 0, z);
    scene.add(hurdle);
  }

  // Castle walls all round with towers; trees beyond. The infield stays open so nothing hides the riders.
  const T = 3;
  const M = 22, x0 = -OUTER - M, x1 = S + OUTER + M, z0 = OUTER + M, WALL_S = 3;
  const side = (from: THREE.Vector3, to: THREE.Vector3) => {
    const n = Math.round(from.distanceTo(to) / WALL_S), rot = Math.atan2(to.x - from.x, to.z - from.z) + Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const p = from.clone().lerp(to, i / n);
      if (i % 8 === 0) {
        put(base, p.x, p.z, T);
        put(roof, p.x, p.z, T, 0, T);
      } else put(wall, p.x, p.z, WALL_S, rot);
    }
  };
  const c = [new THREE.Vector3(x0, 0, -z0), new THREE.Vector3(x1, 0, -z0), new THREE.Vector3(x1, 0, z0), new THREE.Vector3(x0, 0, z0)];
  c.forEach((p, i) => side(p, c[(i + 1) % 4]));
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2, r = 1 + ((i * 37) % 11) / 30;
    put(i % 3 ? oak : tree, S / 2 + Math.cos(a) * (x1 - S / 2 + 10) * r, Math.sin(a) * (z0 + 10) * r, 5 + (i % 4), i);
  }
}

interface Rider {
  root: THREE.Group;
  body: THREE.Group; // horse, caparison and rider: this is what jumps and stumbles
  lane: number;
  clipped: boolean;
  mixers: THREE.AnimationMixer[];
  horseActs: Map<string, THREE.AnimationAction>;
  clip: string;
  shown: number; // where it is drawn, in lengths
  to: number; // where the engine says it is
  speed: number; // lengths a second
  pips: HTMLElement;
  last: HTMLElement;
  bubble: HTMLElement;
  bubbleUntil: number;
}

/** Horses with robot riders, one per lane, placed around the oval by distance. */
export class Riders {
  scene: THREE.Scene;
  riders = new Map<string, Rider>();
  horse: Model | null = null;
  robots: Model[] = [];
  match = '';
  round = -1;
  winner: string | null = null;
  finished = false;
  arriveBy = 0; // performance.now() when riders should reach their latest distance
  talkSeen = '';
  hoofIn = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async load(): Promise<void> {
    [this.horse, ...this.robots] = await Promise.all(['/assets/pets/animal-deer.glb', ...['h', 'g', 'd'].map((v) => `/assets/robots/character-${v}.glb`)].map(load));
  }

  sync(m: MatchView | null): void {
    if (!m || m.id !== this.match) {
      for (const r of this.riders.values()) {
        this.scene.remove(r.root);
        r.root.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
      }
      this.riders.clear();
      this.match = m?.id ?? '';
      this.round = -1;
      this.talkSeen = m ? newTalk(m.talk, '').seen : ''; // no replay of old talk
    }
    if (!m) return;
    const v = m.state as HorseView, fresh = m.round !== this.round;
    this.round = m.round;
    this.finished = m.finished;
    this.winner = m.finished ? m.ranking[0] ?? null : null;
    // Aim to arrive a second after the next leg is due, so riders never stand still mid-race.
    this.arriveBy = performance.now() + (m.finished ? 2 : m.seconds_left + 1) * 1000;
    v.runners.forEach((run, i) => {
      const player = m.players.find((p) => p.name === run.id);
      const known = this.riders.get(run.id);
      const r = known ?? this.spawn(run.id, player?.house ? 'house' : player?.model ?? '', i);
      if (!known) r.shown = m.round > 0 && !m.finished ? Math.max(0, run.distance - GALLOP * 6) : run.distance; // mid-race: a leg behind, so it gallops at once
      r.to = run.distance;
      r.pips.replaceChildren(...Array.from({ length: v.stamina_max }, (_, k) => Object.assign(document.createElement('i'), { className: k < run.stamina ? 'on' : '' })));
      r.last.replaceChildren(...(run.last ? [icon(run.last, run.last)] : []));
      const line = m.last_round.find((l) => l.startsWith(run.id));
      if (fresh) r.clipped = Boolean(line?.includes('clips'));
      if (fresh && line && m.round > 0) {
        r.bubble.textContent = line.slice(run.id.length).trim();
        r.bubbleUntil = performance.now() + BUBBLE_MS;
      }
    });
    const talk = newTalk(m.talk, this.talkSeen);
    this.talkSeen = talk.seen;
    if (talk.lines.length) sfx.blip();
    for (const t of talk.lines) {
      const r = this.riders.get(t.name);
      if (!r) continue;
      r.bubble.textContent = `“${t.text}”`;
      r.bubbleUntil = performance.now() + BUBBLE_MS;
    }
  }

  spawn(name: string, model: string, lane: number): Rider {
    const { root, body, mixers, horseActs, pips, last, bubble } = mount(this.horse!, this.robots, name, model, lane);
    this.scene.add(root);
    const r: Rider = {
      root, body, lane, clipped: false, mixers, horseActs, clip: '', shown: 0, to: 0, speed: 0, pips, last, bubble, bubbleUntil: 0,
    };
    this.place(r, 0);
    this.riders.set(name, r);
    return r;
  }

  update(dt: number): void {
    const now = performance.now(), running = [...this.riders.values()].filter((r) => r.speed > 0.3).length;
    this.hoofIn -= dt;
    if (running && this.hoofIn <= 0) {
      sfx.hoof(0.1 + running * 0.05);
      this.hoofIn = 0.07 + Math.random() * 0.06 + 0.12 / running; // more horses, faster drumming
    }
    for (const [name, r] of this.riders) {
      const want = Math.max(0, r.to - r.shown) / Math.max(0.5, (this.arriveBy - now) / 1000);
      r.speed += (want - r.speed) * (1 - Math.pow(0.2, dt)); // no sudden speed changes
      r.shown = Math.min(r.to, r.shown + r.speed * dt);
      this.place(r, r.shown);
      const moving = r.speed > 0.3;
      this.play(r, moving ? 'run' : this.finished && name === this.winner ? 'dance' : 'idle');
      const run = r.horseActs.get('run');
      if (run) run.timeScale = Math.min(1.6, Math.max(0.5, r.speed / GALLOP)); // exhausted horses gallop slower
      r.bubble.hidden = now > r.bubbleUntil;
      for (const m of r.mixers) m.update(dt);
    }
  }

  /** Puts a rider on its lane; over a hurdle it jumps, or stumbles if it clipped it this leg. */
  place(r: Rider, distance: number): void {
    const [x, z, heading] = onOval(distance, laneRho(r.lane)), near = Math.max(0, 1 - fromHurdle(distance) / JUMP);
    r.root.position.set(x, 0, z);
    r.root.rotation.y = heading; // models face +z
    const crossing = r.speed > 0.3 && near > 0;
    r.body.position.y = crossing && !r.clipped ? 1.1 * (1 - (1 - near) ** 2) : 0;
    r.body.rotation.x = crossing && r.clipped ? 0.4 * near : 0;
  }

  /** Where the riders are, for the camera. */
  positions(): THREE.Vector3[] {
    return [...this.riders.values()].map((r) => r.root.position);
  }

  play(r: Rider, name: string): void {
    if (r.clip === name) return;
    r.horseActs.get(r.clip)?.fadeOut(0.25);
    r.horseActs.get(name)?.reset().fadeIn(0.25).play();
    r.clip = name;
  }
}


/** A horse in a caparison with a robot rider and a name tag; `body` holds the horse and rider, `root` also the tag. */
export function mount(horseModel: Model, robots: Model[], name: string, model: string, lane: number) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const horse = SkeletonUtils.clone(horseModel.scene);
  horse.scale.setScalar(HORSE_H / heightOf(horseModel.scene));
  tint(horse, COATS[lane % COATS.length], 0.55);
  body.add(horse);
  const top = new THREE.Box3().setFromObject(horse).max.y;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.95), new THREE.MeshLambertMaterial({ color: LANE_COLORS[lane] }));
  cloth.position.set(0, top * 0.62, -0.1); // a caparison in the lane's colour
  body.add(cloth);
  const look = robots[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % robots.length];
  const rider = SkeletonUtils.clone(look.scene);
  rider.scale.setScalar(RIDER_H / heightOf(look.scene));
  tint(rider, LANE_COLORS[lane], 0.35);
  rider.position.set(0, top * 0.62, -0.15);
  body.add(rider);
  const tag = Object.assign(document.createElement('div'), { className: 'tag' });
  tag.style.setProperty('--lane', LANE_COLORS[lane]);
  const bubble = Object.assign(document.createElement('div'), { className: 'bubble' });
  const head = Object.assign(document.createElement('div'), { className: 'name' });
  const last = Object.assign(document.createElement('span'), { className: 'last' });
  head.append(last, name, Object.assign(document.createElement('small'), { textContent: model }));
  const pips = Object.assign(document.createElement('div'), { className: 'pips' });
  tag.append(bubble, head, pips);
  const lbl = new CSS2DObject(tag);
  lbl.position.y = top + RIDER_H * 0.8;
  root.add(lbl);
  const hm = new THREE.AnimationMixer(horse), rm = new THREE.AnimationMixer(rider);
  const drive = look.clips.find((c) => c.name === 'drive');
  if (drive) rm.clipAction(drive).play(); // seated, hands on the reins
  return { root, body, rider, top, pips, last, bubble, mixers: [hm, rm], horseActs: new Map(horseModel.clips.map((c) => [c.name, hm.clipAction(c)])) };
}

function tint(o: THREE.Object3D, color: string, amount: number): void {
  const c = new THREE.Color('#ffffff').lerp(new THREE.Color(color), amount);
  o.traverse((m) => {
    if (!(m instanceof THREE.Mesh)) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.metalness = 0;
    mat.color.copy(c);
    m.material = mat;
  });
}

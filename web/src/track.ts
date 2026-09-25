import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { HorseView, MatchView } from '../../shared/types.ts';
import { icon } from './icons.ts';

export const LANES = 4, LANE_W = 2.4;
const SCALE = 0.6, START_X = 4, FINISH = 100, TRACK_END = 150; // SCALE: world units per length
export const LANE_COLORS = ['#c0392b', '#2e6fd8', '#e0b020', '#2f9e55']; // heraldic red, blue, gold, green
const COATS = ['#8a5a3a', '#4a3a32', '#d8cfc4', '#b07a45']; // chestnut, black, grey, bay
export const xOf = (distance: number) => START_X + distance * SCALE;
export const MID_Z = (LANES * LANE_W) / 2;
const laneZ = (i: number) => (i + 0.5) * LANE_W;
const HORSE_H = 1.5, RIDER_H = 0.95, DASH_MS = 2500, BUBBLE_MS = 6000;
const ROMAN = ['I', 'II', 'III', 'IV'];

interface Model { scene: THREE.Object3D; clips: THREE.AnimationClip[] }
const loader = new GLTFLoader();
const load = async (path: string): Promise<Model> => {
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
const label = (text: string, cls: string) => new CSS2DObject(Object.assign(document.createElement('div'), { className: cls, textContent: text }));

/** The tiltyard: grass, a dirt track with lanes, leg posts, a checkered finish, castle walls and towers. */
export async function buildTrack(scene: THREE.Scene): Promise<void> {
  const piece = async (name: string) => (await load(`/assets/castle/${name}.glb`)).scene;
  const [base, mid, roof, wall, banner, pennant, fence, oak, tree] = await Promise.all([
    piece('tower-square-base'), piece('tower-square-mid'), piece('tower-square-top-roof'), piece('wall'),
    piece('flag-banner-long'), piece('flag-pennant'), piece('wall-narrow-wood-fence'),
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
  const end = xOf(TRACK_END), width = LANES * LANE_W;
  scene.add(flat(800, 800, '#79b356', 0));
  const dirt = flat(end + 8, width + 1.2, '#b08556', 0.01);
  dirt.position.set((end + 8) / 2 - 6, 0.01, MID_Z);
  scene.add(dirt);
  for (let i = 0; i <= LANES; i++) {
    const line = flat(end + 4, 0.06, '#f4ecd8', 0.02);
    line.position.set((end + 4) / 2 - 4, 0.02, i * LANE_W);
    scene.add(line);
  }
  const start = flat(0.25, width, '#f4ecd8', 0.03);
  start.position.set(xOf(0), 0.03, MID_Z);
  scene.add(start);
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
  const finish = new THREE.Mesh(new THREE.PlaneGeometry(0.8, width), new THREE.MeshLambertMaterial({ map: tex }));
  finish.rotation.x = -Math.PI / 2;
  finish.position.set(xOf(FINISH), 0.03, MID_Z);
  scene.add(finish);

  // Leg posts every 20 lengths on the near side (high z, where the camera is), the finish flags, a low fence along the rail.
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6), new THREE.MeshLambertMaterial({ color: '#f4ecd8' }));
  ROMAN.forEach((r, i) => {
    const p = post.clone();
    p.position.set(xOf((i + 1) * 20), 0.7, width + 0.7);
    const l = label(r, 'post');
    l.position.y = 1;
    p.add(l);
    scene.add(p);
  });
  for (const z of [-0.9, width + 0.9]) put(pennant, xOf(FINISH), z, 2.2, Math.PI / 2);
  for (let x = -4; x < end + 4; x += 1.05 * 0.9) put(fence, x, width + 1.4, 0.6, 0).scale.y = 0.35;

  // The castle wall on the far side, a tower every 8 segments, a banner on each tower.
  const WALL_S = 3, wallZ = -4;
  for (let i = 0, x = -12; x < end + 12; i++, x += WALL_S) {
    if (i % 8 === 0) {
      const T = 4;
      put(base, x, wallZ, T);
      put(mid, x, wallZ, T, 0, T * 1.01);
      put(roof, x, wallZ, T, 0, T * 2.02);
      put(banner, x, wallZ + T * 0.5 + 0.05, 1.6, Math.PI / 2, T * 1.1);
    } else put(wall, x, wallZ, WALL_S);
  }
  // Two gate towers behind the start, trees beyond the wall.
  for (const z of [-2.6, width + 1.6]) {
    put(base, START_X - 3, z, 2.2);
    put(roof, START_X - 3, z, 2.2, 0, 2.2);
  }
  for (let i = 0; i < 70; i++) {
    const x = -20 + ((i * 37) % 71) * ((end + 40) / 71), z = wallZ - 5 - ((i * 53) % 29);
    put(i % 3 ? oak : tree, x, z, 5 + (i % 4), i);
  }
}

interface Rider {
  root: THREE.Group;
  mixers: THREE.AnimationMixer[];
  horseActs: Map<string, THREE.AnimationAction>;
  clip: string;
  from: number;
  to: number;
  t: number;
  pips: HTMLElement;
  last: HTMLElement;
  bubble: HTMLElement;
  bubbleUntil: number;
}

/** Horses with robot riders, one per lane, placed at x = distance. */
export class Riders {
  scene: THREE.Scene;
  riders = new Map<string, Rider>();
  horse: Model | null = null;
  robots: Model[] = [];
  match = '';
  round = -1;
  winner: string | null = null;
  finished = false;

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
    }
    if (!m) return;
    const v = m.state as HorseView, fresh = m.round !== this.round;
    this.round = m.round;
    this.finished = m.finished;
    this.winner = m.finished ? m.ranking[0] ?? null : null;
    v.runners.forEach((run, i) => {
      const player = m.players.find((p) => p.name === run.id);
      const r = this.riders.get(run.id) ?? this.spawn(run.id, player?.house ? 'house' : player?.model ?? '', i);
      if (run.distance !== r.to) {
        r.from = r.from + (r.to - r.from) * ease(r.t);
        r.to = run.distance;
        r.t = 0;
      }
      r.pips.replaceChildren(...Array.from({ length: 10 }, (_, k) => Object.assign(document.createElement('i'), { className: k < run.stamina ? 'on' : '' })));
      r.last.replaceChildren(...(run.last ? [icon(run.last, run.last)] : []));
      const line = m.last_round.find((l) => l.startsWith(run.id));
      if (fresh && line && m.round > 0) {
        r.bubble.textContent = line.slice(run.id.length).trim();
        r.bubbleUntil = performance.now() + BUBBLE_MS;
      }
    });
  }

  spawn(name: string, model: string, lane: number): Rider {
    const root = new THREE.Group();
    const horse = SkeletonUtils.clone(this.horse!.scene);
    horse.scale.setScalar(HORSE_H / heightOf(this.horse!.scene));
    tint(horse, COATS[lane % COATS.length], 0.55);
    root.add(horse);
    const top = new THREE.Box3().setFromObject(horse).max.y;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.95), new THREE.MeshLambertMaterial({ color: LANE_COLORS[lane] }));
    cloth.position.set(0, top * 0.62, -0.1); // a caparison in the lane's colour
    root.add(cloth);
    const look = this.robots[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % this.robots.length];
    const rider = SkeletonUtils.clone(look.scene);
    rider.scale.setScalar(RIDER_H / heightOf(look.scene));
    tint(rider, LANE_COLORS[lane], 0.35);
    rider.position.set(0, top * 0.62, -0.15);
    root.add(rider);
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
    root.rotation.y = Math.PI / 2; // models face +z; the track runs along +x
    root.position.set(xOf(0), 0, laneZ(lane));
    this.scene.add(root);
    const hm = new THREE.AnimationMixer(horse), rm = new THREE.AnimationMixer(rider);
    const drive = look.clips.find((c) => c.name === 'drive');
    if (drive) rm.clipAction(drive).play(); // seated, hands on the reins
    const r: Rider = {
      root, mixers: [hm, rm], clip: '', from: 0, to: 0, t: 1, pips, last, bubble, bubbleUntil: 0,
      horseActs: new Map(this.horse!.clips.map((c) => [c.name, hm.clipAction(c)])),
    };
    this.riders.set(name, r);
    return r;
  }

  update(dt: number): void {
    const now = performance.now();
    for (const [name, r] of this.riders) {
      r.t = Math.min(1, r.t + (dt * 1000) / DASH_MS);
      r.root.position.x = xOf(r.from + (r.to - r.from) * ease(r.t));
      this.play(r, r.t < 1 ? 'run' : this.finished && name === this.winner ? 'dance' : 'idle');
      r.bubble.hidden = now > r.bubbleUntil;
      for (const m of r.mixers) m.update(dt);
    }
  }

  /** The x range the camera should keep in view. */
  spread(): [number, number] | null {
    const xs = [...this.riders.values()].map((r) => r.root.position.x);
    return xs.length ? [Math.min(...xs), Math.max(...xs)] : null;
  }

  play(r: Rider, name: string): void {
    if (r.clip === name) return;
    r.horseActs.get(r.clip)?.fadeOut(0.25);
    r.horseActs.get(name)?.reset().fadeIn(0.25).play();
    r.clip = name;
  }
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

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

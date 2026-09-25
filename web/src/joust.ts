import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { JoustView, MatchView } from '../../shared/types.ts';
import { icon } from './icons.ts';
import { sfx } from './sound.ts';
import { type Model, mount, newTalk, S } from './track.ts';

// The tilt runs along the oval's infield: riders charge along x, either side of a barrier at z = 0.
const XC = S / 2;
export const HALF = 12;
const SIDE = 1.2, CHARGE_MS = 3500, BUBBLE_MS = 5000;
export const JOUST_FOCUS = new THREE.Vector3(XC, 0.8, 0);

interface Jouster {
  root: THREE.Group;
  rider: THREE.Object3D;
  lance: THREE.Mesh;
  mixers: THREE.AnimationMixer[];
  horseActs: Map<string, THREE.AnimationAction>;
  clip: string;
  last: HTMLElement;
  bubble: HTMLElement;
  bubbleUntil: number;
  line: string;
}

/** Builds the barrier once. */
export function buildTilt(scene: THREE.Scene): void {
  const wood = new THREE.MeshLambertMaterial({ color: '#8a5a3a' }), white = new THREE.MeshLambertMaterial({ color: '#f4ecd8' });
  for (const [y, mat] of [[0.5, wood], [1.0, white]] as const) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 2, 0.14, 0.14), mat);
    rail.position.set(XC, y, 0);
    scene.add(rail);
  }
  for (let x = XC - HALF - 1; x <= XC + HALF + 1; x += 2) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), wood);
    post.position.set(x, 0.55, 0);
    scene.add(post);
  }
}

/** Two mounted riders with lances; each pass they charge past each other along the barrier. */
export class Jousters {
  scene: THREE.Scene;
  riders: Jouster[] = [];
  match = '';
  pass = 0; // passes already shown
  t = 1; // progress of the current charge, 0..1
  finished = false;
  winner: string | null = null;
  unhorsed: string | null = null;
  names: string[] = [];
  talkSeen = '';
  hoofIn = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  sync(m: MatchView | null, horse: Model, robots: Model[]): void {
    if (!m || m.id !== this.match) {
      for (const r of this.riders) {
        this.scene.remove(r.root);
        r.root.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
      }
      this.riders = [];
      this.match = m?.id ?? '';
      this.talkSeen = m ? newTalk(m.talk, '').seen : '';
    }
    if (!m) return;
    const v = m.state as JoustView;
    const talk = newTalk(m.talk, this.talkSeen);
    this.talkSeen = talk.seen;
    if (talk.lines.length) sfx.blip();
    for (const t of talk.lines) {
      const r = this.riders[this.names.indexOf(t.name)];
      if (!r) continue;
      r.bubble.textContent = `“${t.text}”`;
      r.bubbleUntil = performance.now() + BUBBLE_MS;
    }
    if (!this.riders.length) {
      this.names = v.riders.map((r) => r.id);
      this.riders = v.riders.map((r, i) => this.spawn(r.id, m, horse, robots, i));
      this.pass = v.pass; // joined mid-match: no replay
      this.unhorsed = v.unhorsed;
      if (v.unhorsed) this.fall(this.riders[this.names.indexOf(v.unhorsed)], 1);
    }
    this.finished = m.finished;
    this.winner = m.finished ? m.ranking[0] ?? null : null;
    if (v.pass > this.pass) {
      this.pass = v.pass;
      this.t = 0;
      this.unhorsed = v.unhorsed;
      this.riders.forEach((r, i) => {
        r.line = m.last_round.find((l) => l.startsWith(this.names[i]))?.slice(this.names[i].length).trim() ?? '';
        r.lance.scale.set(1, 1, 1);
        r.last.replaceChildren(...(v.riders[i].aims.length ? [icon(v.riders[i].aims.at(-1)!)] : []));
      });
    }
  }

  spawn(name: string, m: MatchView, horse: Model, robots: Model[], i: number): Jouster {
    const p = m.players.find((x) => x.name === name);
    const { root, rider, top, mixers, horseActs, last, bubble, pips } = mount(horse, robots, name, p?.house ? 'house' : p?.model ?? '', i === 0 ? 0 : 1);
    pips.remove();
    const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 2.6, 6), new THREE.MeshLambertMaterial({ color: i === 0 ? '#e8d3a8' : '#d8e0e8' }));
    lance.geometry.rotateX(Math.PI / 2); // along the rider's forward axis
    lance.geometry.translate(0, 0, 1.1);
    lance.position.y = top * 0.62 + 0.55;
    root.add(lance);
    this.scene.add(root);
    const r: Jouster = { root, rider, lance, mixers, horseActs, clip: '', last, bubble, bubbleUntil: 0, line: '' };
    this.place(r, i, 1);
    return r;
  }

  /** Where rider `i` is during the current charge (t 0..1): end to end, then turned to face the other rider. */
  place(r: Jouster, i: number, t: number): void {
    const end = (k: number) => XC + ((k + i) % 2 === 0 ? -HALF : HALF); // after k passes: rider 0 left when k is even
    const from = end(Math.max(0, this.pass - 1)), to = end(this.pass), k = this.pass && t < 1 ? t * t * (3 - 2 * t) : 1;
    const x = this.pass ? from + (to - from) * k : to;
    const heading = this.pass && t < 1 ? Math.sign(to - from) : Math.sign(XC - x);
    const inward = heading * (i === 0 ? 1 : -1); // which local side faces the barrier
    r.root.position.set(x, 0, i === 0 ? SIDE : -SIDE);
    r.root.rotation.y = (heading * Math.PI) / 2; // models face +z
    r.lance.position.x = 0.25 * inward;
    r.lance.rotation.y = 0.35 * inward; // angled across the barrier
  }

  fall(r: Jouster, k: number): void {
    r.rider.rotation.z = -1.3 * k;
    r.rider.position.x = 0.9 * k;
    r.rider.position.y = Math.max(0.05, r.rider.position.y * (1 - k));
    r.lance.visible = k < 0.5;
  }

  update(dt: number): void {
    const now = performance.now(), wasBefore = this.t < 0.5;
    this.t = Math.min(1, this.t + (dt * 1000) / CHARGE_MS);
    const meet = wasBefore && this.t >= 0.5;
    if (meet && this.riders.some((r) => /strikes|shield/.test(r.line))) sfx.crack();
    this.hoofIn -= dt;
    if (this.t < 1 && this.hoofIn <= 0) {
      sfx.hoof(0.3);
      this.hoofIn = 0.11 + Math.random() * 0.04; // two horses at the gallop
    }
    this.riders.forEach((r, i) => {
      this.place(r, i, this.t);
      if (meet) {
        r.bubble.textContent = r.line;
        r.bubbleUntil = now + BUBBLE_MS;
        if (/strikes|shield/.test(r.line)) r.lance.scale.set(1, 1, 0.45); // it shatters on the hit
      }
      if (this.unhorsed === this.names[i] && this.t >= 0.5) this.fall(r, Math.min(1, (this.t - 0.5) * 3));
      r.bubble.hidden = now > r.bubbleUntil;
      const clip = this.t < 1 ? 'run' : this.finished && this.names[i] === this.winner ? 'dance' : 'idle';
      if (r.clip !== clip) {
        r.horseActs.get(r.clip)?.fadeOut(0.25);
        r.horseActs.get(clip)?.reset().fadeIn(0.25).play();
        r.clip = clip;
      }
      for (const m of r.mixers) m.update(dt);
    });
  }
}

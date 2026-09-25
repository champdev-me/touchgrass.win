import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { MatchView } from '../../shared/types.ts';
import { buildTavern, seatAngle, seatRobot, TABLE_TOP, TAVERN } from './tavern.ts';
import { type Model, newTalk } from './track.ts';

// A second table next to the tavern's.
export const ROULETTE = TAVERN.clone().add(new THREE.Vector3(13, 0, 0));
const BUBBLE_MS = 5000, SPIN_S = 0.9;

interface Player { id: string; chips: number; nerve: number; out: boolean }
interface RouletteView { turn: string; clicks: number; odds: string; live_in?: number; last: { who: string; move: string; bang: boolean } | null; players: Player[] }
interface Seat { root: THREE.Group; body: THREE.Object3D; mixer: THREE.AnimationMixer; tag: HTMLElement; bubble: HTMLElement; bubbleUntil: number; fallen: number }
interface Puff { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; age: number; grow: number }
interface Shot { who: string; bang: boolean; spin: boolean; t: number; fired: boolean }

export function buildRoulette(scene: THREE.Scene): void {
  buildTavern(scene, ROULETTE);
}

/** A cartoon revolver lying on its side on the table; +z is the muzzle. The drum (six chambers) is named for spinning. */
function revolver(): THREE.Group {
  const metal = new THREE.MeshLambertMaterial({ color: '#4a4c55' }), steel = new THREE.MeshLambertMaterial({ color: '#8d909a' });
  const wood = new THREE.MeshLambertMaterial({ color: '#7a4a28' }), hole = new THREE.MeshBasicMaterial({ color: '#121214' });
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    return m;
  };
  const upright = new THREE.Group(); // built standing, muzzle +z, then laid on its side
  const barrel = new THREE.CylinderGeometry(0.045, 0.05, 0.62, 12).rotateX(Math.PI / 2);
  upright.add(
    part(new THREE.BoxGeometry(0.11, 0.2, 0.36), metal, 0, 0, 0), // frame
    part(barrel, metal, 0, 0.05, 0.47),
    part(new THREE.BoxGeometry(0.05, 0.035, 0.62), metal, 0, 0.1, 0.47), // rib along the barrel
    part(new THREE.BoxGeometry(0.02, 0.05, 0.03), metal, 0, 0.14, 0.76), // front sight
    part(new THREE.BoxGeometry(0.04, 0.09, 0.06), metal, 0, 0.15, -0.17, -0.4), // hammer
    part(new THREE.BoxGeometry(0.1, 0.34, 0.15), wood, 0, -0.22, -0.22, -0.4), // grip, sloping back
    part(new THREE.TorusGeometry(0.07, 0.013, 6, 12, Math.PI), metal, 0, -0.1, 0.02, Math.PI), // trigger guard
  );
  const drum = new THREE.Group();
  drum.name = 'drum';
  drum.position.set(0, 0.02, 0.06);
  drum.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 18).rotateX(Math.PI / 2), steel));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, chamber = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.205, 8).rotateX(Math.PI / 2), hole);
    chamber.position.set(Math.cos(a) * 0.075, Math.sin(a) * 0.075, 0);
    drum.add(chamber);
  }
  upright.add(drum);
  upright.rotation.z = Math.PI / 2; // on its side
  upright.scale.setScalar(1.4);
  const g = new THREE.Group();
  g.add(upright);
  return g;
}

/** Four robots, a revolver that turns to whoever holds it, and the shot: flash, smoke, sparks, a robot knocked off its stool. */
export class Roulette {
  scene: THREE.Scene;
  seats = new Map<string, Seat>();
  order: string[] = [];
  match = '';
  round = -1;
  gun = revolver();
  aim = 0; // the gun's angle; it turns toward the holder
  holder = '';
  shot: Shot | null = null;
  twirl: { from: number; to: number; t: number } | null = null; // the gun spinning on the table to its next holder
  drumSpin = 0; // seconds of fast cylinder spin left
  puffs: Puff[] = [];
  sign: CSS2DObject;
  signUntil = 0;
  talkSeen = '';

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.gun.position.copy(ROULETTE).setY(TABLE_TOP + 0.08);
    this.gun.visible = false;
    this.sign = new CSS2DObject(Object.assign(document.createElement('div'), { className: 'sign' }));
    this.sign.position.copy(ROULETTE).setY(3.1);
    this.sign.visible = false;
    scene.add(this.gun, this.sign);
  }

  sync(m: MatchView | null, robots: Model[]): void {
    if (!m || m.id !== this.match) {
      for (const s of this.seats.values()) {
        this.scene.remove(s.root);
        s.root.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
      }
      this.seats.clear();
      this.match = m?.id ?? '';
      this.round = m?.round ?? -1; // joined mid-game: no replay of the last shot
      this.talkSeen = m ? newTalk(m.talk, '').seen : '';
      this.shot = null;
    }
    this.gun.visible = this.sign.visible = Boolean(m);
    if (!m) return;
    const v = m.state as RouletteView, now = performance.now();
    this.order = v.players.map((p) => p.id);
    v.players.forEach((p, i) => this.seats.get(p.id) ?? this.spawn(p.id, m, robots, i));
    if (m.round !== this.round && v.last) {
      this.round = m.round; // a new turn resolved: play it (the fall and the BANG wait for the shot)
      if (v.last.move !== 'pass') this.shot = { who: v.last.who, bang: v.last.bang, spin: v.last.move === 'spin', t: 0, fired: false };
      if (v.last.move === 'spin') this.drumSpin = SPIN_S;
      const s = this.seats.get(v.last.who);
      if (s && v.last.move === 'pass') this.say(s, 'passes the gun', now);
    }
    v.players.forEach((p) => {
      const s = this.seats.get(p.id)!;
      s.tag.classList.toggle('turn', !m.finished && v.turn === p.id);
      s.tag.classList.toggle('out', p.out && this.shot?.who !== p.id);
      if (p.out && this.shot?.who !== p.id) s.fallen = 1; // already down
    });
    for (const t of newTalk(m.talk, this.talkSeen).lines) {
      const s = this.seats.get(t.name);
      if (s) this.say(s, `“${t.text}”`, now);
    }
    this.talkSeen = newTalk(m.talk, this.talkSeen).seen;
    if (!this.shot && v.turn !== this.holder) {
      const next = this.order.indexOf(v.turn);
      if (this.holder && next >= 0) {
        const diff = Math.atan2(Math.sin(seatAngle(next) - this.aim), Math.cos(seatAngle(next) - this.aim));
        this.twirl = { from: this.aim, to: this.aim + diff + Math.PI * 2 * (diff > 0 ? 1 : -1), t: 0 }; // one full spin, then it points at them
      } else if (next >= 0) this.aim = seatAngle(next);
      this.holder = v.turn;
    }
    const sign = this.sign.element, live = v.live_in === 0;
    if (m.finished) {
      sign.textContent = `${m.ranking[0]} walks out alive!`;
      sign.classList.remove('liar');
    } else if (now > this.signUntil) {
      sign.textContent = `${v.turn} holds the gun · ${live ? 'the next chamber is LIVE' : v.odds}`;
      sign.classList.toggle('liar', live);
    } else sign.classList.add('liar');
  }

  say(s: Seat, text: string, now: number): void {
    s.bubble.textContent = text;
    s.bubbleUntil = now + BUBBLE_MS;
  }

  spawn(name: string, m: MatchView, robots: Model[], i: number): Seat {
    const p = m.players.find((x) => x.name === name);
    const { root, body, mixer, tag, bubble } = seatRobot(this.scene, robots, name, p?.house ? 'house' : p?.model ?? '', i, ROULETTE);
    const s: Seat = { root, body, mixer, tag, bubble, bubbleUntil: 0, fallen: 0 };
    this.seats.set(name, s);
    return s;
  }

  /** Muzzle flash, smoke and sparks: short-lived meshes that drift and fade. */
  burst(at: THREE.Vector3, toward: THREE.Vector3): void {
    const add = (color: string, size: number, vel: THREE.Vector3, life: number, grow: number) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true }));
      mesh.position.copy(at);
      this.scene.add(mesh);
      this.puffs.push({ mesh, vel, life, age: 0, grow });
    };
    add('#fff4b0', 0.16, new THREE.Vector3(), 0.15, 5); // the flash
    for (let k = 0; k < 5; k++) add('#9a9a9a', 0.08, new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, (Math.random() - 0.5) * 0.4), 1.6, 1.5);
    for (let k = 0; k < 14; k++) add(k % 2 ? '#ffb347' : '#ffe07a', 0.03, toward.clone().multiplyScalar(2 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2)), 0.8, 0);
  }

  update(dt: number): void {
    const now = performance.now();
    if (this.twirl) {
      this.twirl.t = Math.min(1, this.twirl.t + dt / 1.3);
      const e = 1 - (1 - this.twirl.t) ** 3; // fast, then slowing onto the next holder
      this.aim = this.twirl.from + (this.twirl.to - this.twirl.from) * e;
      if (this.twirl.t >= 1) this.twirl = null;
    }
    this.gun.rotation.set(0, this.aim, 0);
    const drum = this.gun.getObjectByName('drum')!;
    if (this.drumSpin > 0) {
      this.drumSpin -= dt;
      drum.rotation.z += dt * 22 * Math.max(0.15, this.drumSpin / SPIN_S); // the cylinder whirs and slows
    }
    const shot = this.shot;
    if (shot) {
      shot.t += dt;
      const fireAt = shot.spin ? SPIN_S + 0.4 : 0.5, s = this.seats.get(shot.who);
      if (!shot.fired && shot.t >= fireAt && s) {
        shot.fired = true;
        const dir = s.root.position.clone().sub(ROULETTE).setY(0).normalize();
        drum.rotation.z = Math.round(drum.rotation.z / (Math.PI / 3)) * (Math.PI / 3) + Math.PI / 3; // the hammer turns the next chamber
        if (shot.bang) {
          this.burst(this.gun.position.clone().addScaledVector(dir, 1.1).setY(TABLE_TOP + 0.15), dir);
          this.sign.element.textContent = `BANG! ${shot.who} is out`;
          this.sign.element.classList.add('liar');
          this.signUntil = now + 4500;
          s.tag.classList.add('out');
        } else this.say(s, 'click.', now);
      }
      if (shot.fired) {
        const k = Math.min(1, (shot.t - fireAt) / 0.12);
        this.gun.position.y = TABLE_TOP + 0.08 + (shot.bang ? Math.sin(k * Math.PI) * 0.12 : Math.sin(k * Math.PI) * 0.03); // recoil
        if (shot.bang && s) s.fallen = Math.min(1, (shot.t - fireAt) / 0.6);
      }
      if (shot.t > fireAt + 2) this.shot = null;
    }
    for (const s of this.seats.values()) {
      s.mixer.update(dt);
      s.bubble.hidden = now > s.bubbleUntil;
      const f = s.fallen * (2 - s.fallen); // eased
      s.body.rotation.x = -1.45 * f; // knocked backwards off the stool
      s.body.position.set(0, -0.55 * f, -0.7 * f);
    }
    this.puffs = this.puffs.filter((p) => {
      p.age += dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y -= p.grow === 0 ? 9.8 * dt : 0; // sparks fall, smoke rises
      p.mesh.scale.setScalar(1 + p.grow * p.age);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - p.age / p.life);
      if (p.age < p.life) return true;
      this.scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      return false;
    });
  }
}

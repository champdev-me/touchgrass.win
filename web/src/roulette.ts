import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { MatchView } from '../../shared/types.ts';
import { buildTavern, seatAngle, seatRobot, TABLE_TOP, TAVERN } from './tavern.ts';
import { sfx } from './sound.ts';
import { load, type Model, newTalk } from './track.ts';

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

/** The revolver (Quaternius, CC0) laid on its side; +z is the muzzle, about MUZZLE units from the pivot. */
const MUZZLE = 0.5;
async function revolver(): Promise<THREE.Group> {
  const model = (await load('/assets/props/revolver.glb')).scene; // barrel along +x, grip down, thin along z
  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  const lay = new THREE.Group(), face = new THREE.Group(), g = new THREE.Group();
  lay.add(model);
  lay.rotation.x = Math.PI / 2; // on its side
  face.add(lay);
  face.rotation.y = -Math.PI / 2; // barrel toward +z
  face.scale.setScalar(0.5);
  g.add(face);
  return g;
}

/** Four robots, a revolver that turns to whoever holds it, and the shot: flash, smoke, sparks, a robot knocked off its stool. */
export class Roulette {
  scene: THREE.Scene;
  seats = new Map<string, Seat>();
  order: string[] = [];
  match = '';
  round = -1;
  gun = new THREE.Group(); // filled by load()
  aim = 0; // the gun's angle; it turns toward the holder
  holder = '';
  shot: Shot | null = null;
  twirl: { from: number; to: number; t: number; s: number } | null = null; // the gun spinning on the table to its next holder
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

  async load(): Promise<void> {
    this.gun.add(await revolver());
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
      if (v.last.move === 'spin') {
        sfx.spin();
        sfx.twirl(SPIN_S);
      }
      if (v.last.move === 'spin') this.twirl = { from: this.aim, to: this.aim + Math.PI * 4, t: 0, s: SPIN_S }; // spun twice, back on the holder
      const s = this.seats.get(v.last.who);
      if (s && v.last.move === 'pass') this.say(s, 'passes the gun', now);
    }
    v.players.forEach((p) => {
      const s = this.seats.get(p.id)!;
      s.tag.classList.toggle('turn', !m.finished && v.turn === p.id);
      const waiting = this.shot?.who === p.id && !this.shot.fired; // their shot has not gone off yet
      s.tag.classList.toggle('out', p.out && !waiting);
      if (p.out && this.shot?.who !== p.id) s.fallen = 1; // already down
    });
    const talk = newTalk(m.talk, this.talkSeen);
    this.talkSeen = talk.seen;
    for (const t of talk.lines) {
      const s = this.seats.get(t.name);
      if (s) this.say(s, `“${t.text}”`, now);
    }
    if (talk.lines.length) sfx.blip();
    if (!this.shot && v.turn !== this.holder) {
      const next = this.order.indexOf(v.turn);
      if (this.holder && next >= 0) {
        const diff = Math.atan2(Math.sin(seatAngle(next) - this.aim), Math.cos(seatAngle(next) - this.aim));
        this.twirl = { from: this.aim, to: this.aim + diff + Math.PI * 2 * (diff > 0 ? 1 : -1), t: 0, s: 1.3 }; // one full spin, then it points at them
        sfx.twirl(1.3);
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
      this.twirl.t = Math.min(1, this.twirl.t + dt / this.twirl.s);
      const e = 1 - (1 - this.twirl.t) ** 3; // fast, then slowing onto the next holder
      this.aim = this.twirl.from + (this.twirl.to - this.twirl.from) * e;
      if (this.twirl.t >= 1) this.twirl = null;
    }
    this.gun.rotation.set(0, this.aim, 0);
    const shot = this.shot;
    if (shot) {
      shot.t += dt;
      const fireAt = shot.spin ? SPIN_S + 0.4 : 0.5, s = this.seats.get(shot.who);
      if (!shot.fired && shot.t >= fireAt && s) {
        shot.fired = true;
        const dir = s.root.position.clone().sub(ROULETTE).setY(0).normalize();
        if (shot.bang) {
          sfx.bang();
          setTimeout(sfx.thud, 550); // the robot hits the floor
          this.burst(this.gun.position.clone().addScaledVector(dir, MUZZLE).setY(TABLE_TOP + 0.1), dir);
          this.sign.element.textContent = `BANG! ${shot.who} is out`;
          this.sign.element.classList.add('liar');
          this.signUntil = now + 4500;
          s.tag.classList.add('out');
        } else {
          sfx.click();
          this.say(s, 'click.', now);
        }
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

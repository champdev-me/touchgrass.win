import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { MatchView } from '../../shared/types.ts';
import { buildTavern, seatAngle, seatRobot, TABLE_TOP, TAVERN } from './tavern.ts';
import { sfx } from './sound.ts';
import { load, type Model, newTalk } from './track.ts';

// A second table next to the tavern's.
export const ROULETTE = TAVERN.clone().add(new THREE.Vector3(13, 0, 0));
const BUBBLE_MS = 5000, RELOAD_MS = 1500;

interface Player { id: string; nerve: number; out: boolean }
interface RouletteView { turn: string; clicks: number; odds: string; live_in?: number; last: { who: string; move: string; bang: boolean } | null; players: Player[] }
interface Seat { root: THREE.Group; body: THREE.Object3D; arm: THREE.Object3D | null; armLen: number; out: boolean; armRest: THREE.Quaternion | null; mixer: THREE.AnimationMixer; tag: HTMLElement; bubble: HTMLElement; bubbleUntil: number; fallen: number }
interface Puff { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; age: number; grow: number }
interface Shot { who: string; bang: boolean; t: number; fired: boolean }

export function buildRoulette(scene: THREE.Scene): void {
  buildTavern(scene, ROULETTE);
}

/** The revolver (Quaternius, CC0) laid on its side; +z is the muzzle, about MUZZLE units from the pivot. */
const MUZZLE = 0.3, TRIGGER = new THREE.Vector3(0, -0.075, -0.09); // gun-local muzzle and trigger
async function revolver(): Promise<THREE.Group> {
  const model = (await load('/assets/props/revolver.glb')).scene; // barrel along +x, grip down, thin along z
  const box = new THREE.Box3().setFromObject(model);
  model.position.sub(box.getCenter(new THREE.Vector3()));
  const lay = new THREE.Group(), face = new THREE.Group(), g = new THREE.Group();
  lay.add(model);
  lay.name = 'lay';
  lay.rotation.x = Math.PI / 2; // on its side (0: upright, as held)
  face.add(lay);
  face.rotation.y = -Math.PI / 2; // barrel toward +z
  face.scale.setScalar(0.3);
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
  hold = 0; // 0 on the table .. 1 raised to the holder's head
  heldBy = '';
  over = false;
  reach = new THREE.Vector3(); // where the holder's gun arm points, world space
  turn = ''; // whose turn the engine says it is
  odds = '';
  live = false;
  winner = '';
  reloadUntil = 0; // after a bang: one new bullet before the gun moves on
  pauseLeft = 0; // seconds of the engine's pause after a bang, for the table to react

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
    this.over = m.finished;
    this.order = v.players.map((p) => p.id);
    v.players.forEach((p, i) => this.seats.get(p.id) ?? this.spawn(p.id, m, robots, i));
    if (m.round !== this.round && v.last) {
      this.round = m.round; // a new turn resolved: play it (the fall and the BANG wait for the shot)
      this.shot = { who: v.last.who, bang: v.last.bang, t: 0, fired: false };
    }
    v.players.forEach((p) => {
      const s = this.seats.get(p.id)!;
      s.out = p.out;
      s.tag.classList.toggle('turn', !m.finished && v.turn === p.id);
      const waiting = this.shot?.who === p.id && !this.shot.fired; // their shot has not gone off yet
      s.tag.classList.toggle('out', p.out && !waiting);
      if (p.out && this.shot?.who !== p.id) s.fallen = 1; // already down
    });
    const talk = newTalk(m.talk, this.talkSeen);
    this.talkSeen = talk.seen;
    for (const t of talk.lines) {
      const s = this.seats.get(t.name);
      if (s && !s.out) this.say(s, `“${t.text}”`, now); // the dead stay quiet
    }
    if (talk.lines.length) sfx.blip();
    this.turn = v.turn;
    this.odds = v.odds;
    this.live = v.live_in === 0;
    this.winner = m.finished ? m.ranking[0] ?? '' : '';
    this.pauseLeft = m.pause_left;
    if (!this.shot && now > this.reloadUntil) this.handOff();
    this.label(now);
  }

  /** Once the last shot has played: spin the gun round the table to whoever's turn it is. */
  handOff(): void {
    if (this.turn === this.holder || this.winner || this.pauseLeft > 1) return; // the gun waits on the table while the table reacts
    const next = this.order.indexOf(this.turn);
    if (this.holder && next >= 0) {
      const diff = Math.atan2(Math.sin(seatAngle(next) - this.aim), Math.cos(seatAngle(next) - this.aim));
      this.twirl = { from: this.aim, to: this.aim + diff + Math.PI * 2 * (diff > 0 ? 1 : -1), t: 0, s: 2 }; // spun round the table to the next player
      sfx.twirl(2);
    } else if (next >= 0) this.aim = seatAngle(next);
    this.holder = this.turn;
  }

  /** The sign follows the gun, not the engine: who is pulling, the click or bang, then who holds it and their odds. */
  label(now: number): void {
    const sign = this.sign.element, shot = this.shot;
    if (now < this.signUntil) return; // BANG stays up a while
    sign.classList.remove('liar');
    if (shot && !shot.fired) sign.textContent = `${shot.who} pulls the trigger…`;
    else if (shot) sign.textContent = 'click.';
    else if (this.winner) sign.textContent = `${this.winner} walks out alive!`;
    else if (now < this.reloadUntil) sign.textContent = 'reloading: one bullet';
    else if (this.pauseLeft > 1 && this.turn !== this.holder) sign.textContent = 'a moment of silence…';
    else if (this.twirl) sign.textContent = `the gun goes to ${this.turn}`;
    else {
      sign.textContent = `${this.holder} holds the gun · ${this.live ? 'the next chamber is LIVE' : this.odds}`;
      sign.classList.toggle('liar', this.live);
    }
  }

  say(s: Seat, text: string, now: number): void {
    s.bubble.textContent = text;
    s.bubbleUntil = now + BUBBLE_MS;
  }

  spawn(name: string, m: MatchView, robots: Model[], i: number): Seat {
    const p = m.players.find((x) => x.name === name);
    const { root, body, mixer, tag, bubble } = seatRobot(this.scene, robots, name, p?.house ? 'house' : p?.model ?? '', i, ROULETTE);
    const arm = body.getObjectByName('arm-right') ?? null;
    root.updateMatrixWorld(true);
    const armLen = arm ? new THREE.Box3().setFromObject(arm).getSize(new THREE.Vector3()).y * 0.85 : 0.35; // shoulder to palm, measured in the rest pose
    const s: Seat = { root, body, arm, armLen, out: false, armRest: null, mixer, tag, bubble, bubbleUntil: 0, fallen: 0 };
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

  /** Where the gun is: on the table aimed at `aim`, or raised to the holder's temple (`hold`), trembling while they decide. */
  pose(dt: number, now: number): void {
    const shot = this.shot, reloading = now < this.reloadUntil;
    const target = shot ? (shot.fired ? 0 : 1) : !this.over && !this.twirl && !reloading && this.holder && !this.seats.get(this.holder)?.out ? 1 : 0; // a shot in progress keeps the gun up, even the last one
    if (this.hold < 0.02) this.heldBy = this.shot?.who ?? this.holder; // it changes hands only on the table
    this.hold = target > this.hold ? Math.min(target, this.hold + dt / 1.1) : Math.max(target, this.hold - dt / 0.8);
    const e = this.hold * this.hold * (3 - 2 * this.hold), s = this.seats.get(this.heldBy), i = this.order.indexOf(this.heldBy);
    const onTable = new THREE.Vector3(ROULETTE.x, TABLE_TOP + 0.08, ROULETTE.z), flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.aim, 0));
    const lay = this.gun.getObjectByName('lay');
    if (lay) lay.rotation.x = (Math.PI / 2) * (1 - e);
    if (!s || i < 0 || e <= 0) {
      this.gun.position.copy(onTable);
      this.gun.quaternion.copy(flat);
      return;
    }
    const a = seatAngle(i), facing = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), right = new THREE.Vector3().crossVectors(facing, new THREE.Object3D().up);
    const head = s.root.position.clone().add(new THREE.Vector3(0, 0.85, 0));
    s.root.updateMatrixWorld(true);
    const shoulder = s.arm ? s.arm.getWorldPosition(new THREE.Vector3()) : head.clone().addScaledVector(right, 0.25).setY(head.y - 0.25);
    this.reach.set(0, 0.45, 0).addScaledVector(right, 0.85).addScaledVector(facing, 0.1).normalize(); // out to the side at ear height
    const hand = shoulder.addScaledVector(this.reach, s.armLen);
    if (!this.shot) hand.add(new THREE.Vector3(Math.sin(now / 170), Math.sin(now / 230), Math.sin(now / 200)).multiplyScalar(0.0015)); // a faint tremble
    const aimAt = new THREE.Object3D();
    aimAt.position.copy(hand);
    aimAt.lookAt(head); // muzzle to the temple
    const held = hand.clone().sub(TRIGGER.clone().applyQuaternion(aimAt.quaternion)); // the trigger sits in the hand
    this.gun.position.lerpVectors(onTable, held, e).add(new THREE.Vector3(0, Math.sin(e * Math.PI) * 0.25, 0));
    this.gun.quaternion.slerpQuaternions(flat, aimAt.quaternion, e);
  }

  update(dt: number): void {
    const now = performance.now();
    if (this.twirl) {
      this.twirl.t = Math.min(1, this.twirl.t + dt / this.twirl.s);
      const e = 1 - (1 - this.twirl.t) ** 3; // fast, then slowing onto the next holder
      this.aim = this.twirl.from + (this.twirl.to - this.twirl.from) * e;
      if (this.twirl.t >= 1) this.twirl = null;
    }
    if (this.reloadUntil && now > this.reloadUntil && !this.shot) {
      this.reloadUntil = 0;
      this.handOff();
    }
    const shot = this.shot;
    this.pose(dt, now);
    this.label(now);
    if (shot) {
      shot.t += dt;
      const fireAt = 1.0, s = this.seats.get(shot.who); // a breath at the temple before the trigger
      if (!shot.fired && shot.t >= fireAt && s) {
        shot.fired = true;
        const muzzle = this.gun.localToWorld(new THREE.Vector3(0, 0, MUZZLE)), dir = s.root.position.clone().setY(muzzle.y).sub(muzzle).normalize();
        if (shot.bang) {
          sfx.bang();
          setTimeout(sfx.thud, 550); // the robot hits the floor
          this.burst(muzzle, dir);
          this.sign.element.textContent = `BANG! ${shot.who} is out`;
          this.sign.element.classList.add('liar');
          this.signUntil = now + 2200; // then 'reloading', then a moment of silence
          s.tag.classList.add('out');
        } else {
          sfx.click();
          this.say(s, 'click.', now);
        }
      }
      if (shot.fired) {
        const k = Math.min(1, (shot.t - fireAt) / 0.15);
        this.gun.rotateX(-Math.sin(k * Math.PI) * (shot.bang ? 0.6 : 0.15)); // the kick
        if (shot.bang && s) s.fallen = Math.min(1, (shot.t - fireAt) / 0.6);
      }
      if (shot.t > fireAt + (shot.bang ? 2.2 : 0.9)) { // a click: on as soon as the gun is back on the table
        this.shot = null;
        if (shot.bang && !this.winner) {
          this.reloadUntil = now + RELOAD_MS; // a new bullet, then on
          sfx.reload();
        } else this.handOff(); // straight on to the next player: no second lift for the shooter
      }
    }
    for (const [name, s] of this.seats) {
      s.mixer.update(dt);
      if (s.arm) {
        s.armRest ??= s.arm.quaternion.clone(); // the seated pose, taken once
        const e = name === this.heldBy ? this.hold * this.hold * (3 - 2 * this.hold) : 0;
        if (e > 0 && s.arm.parent) {
          const toParent = s.arm.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
          const point = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.reach.clone().applyQuaternion(toParent)); // the arm hangs along -y
          s.arm.quaternion.slerpQuaternions(s.armRest, point, e);
        } else s.arm.quaternion.copy(s.armRest);
      }
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

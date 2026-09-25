import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { MatchView } from '../../shared/types.ts';
import { LANE_COLORS, type Model, newTalk, S } from './track.ts';

// The tavern sits between the oval's back straight and the castle wall.
export const TAVERN = new THREE.Vector3(S / 2, 0, -29);
const SEAT_R = 1.9, TABLE_H = 0.8, DIE = 0.24, BUBBLE_MS = 6000;

interface Seat { id: string; dice: number[] | null; dice_left: number; out: boolean }
interface Reveal { bid: { count: number; face: number; by: string }; caller: string; found: number; loser: string; dice: Record<string, number[]> }
interface TavernView { turn: string; bid: { count: number; face: number; by: string } | null; dice_on_table: number; turns: number; reveal: Reveal | null; seats: Seat[] }
interface Sitter { root: THREE.Group; body: THREE.Object3D; mixer: THREE.AnimationMixer; dice: THREE.Group; tag: HTMLElement; bubble: HTMLElement; bubbleUntil: number; lastDice: string }

const NAMES = ['', 'one', 'two', 'three', 'four', 'five', 'six'], PLURAL = ['', 'ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
export const bidText = (b: { count: number; face: number }) => `${b.count} ${b.count === 1 ? NAMES[b.face] : PLURAL[b.face]}`;

/** Six die faces drawn once: white with black pips. */
const FACES = [1, 2, 3, 4, 5, 6].map((n) => {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f7f2e6';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#1b1410';
  const at: Record<number, [number, number][]> = { 1: [[16, 16]], 2: [[9, 9], [23, 23]], 3: [[9, 9], [16, 16], [23, 23]], 4: [[9, 9], [23, 9], [9, 23], [23, 23]], 5: [[9, 9], [23, 9], [16, 16], [9, 23], [23, 23]], 6: [[9, 8], [23, 8], [9, 16], [23, 16], [9, 24], [23, 24]] };
  for (const [x, y] of at[n]) {
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: t });
});
const dieGeo = new THREE.BoxGeometry(DIE, DIE, DIE);
/** A die showing `v` on top (box faces: +x, -x, +y, -y, +z, -z). */
function die(v: number): THREE.Mesh {
  const side = (k: number) => FACES[(v + k) % 6];
  return new THREE.Mesh(dieGeo, [side(1), side(4), FACES[v - 1], FACES[(6 - v) % 6], side(2), side(3)]);
}

/** The deck, table and stools, built once. */
export function buildTavern(scene: THREE.Scene): void {
  const wood = new THREE.MeshLambertMaterial({ color: '#8a5a3a' }), dark = new THREE.MeshLambertMaterial({ color: '#5a3a22' });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(11, 0.2, 9), wood);
  deck.position.copy(TAVERN).setY(0.1);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.12, 24), dark);
  table.position.copy(TAVERN).setY(TABLE_H);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, TABLE_H, 10), dark);
  leg.position.copy(TAVERN).setY(TABLE_H / 2);
  scene.add(deck, table, leg);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, stool = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 12), wood);
    stool.position.set(TAVERN.x + Math.sin(a) * SEAT_R, 0.42, TAVERN.z + Math.cos(a) * SEAT_R);
    scene.add(stool);
  }
  const lamp = new THREE.PointLight('#ffb35a', 6, 9);
  lamp.position.copy(TAVERN).setY(2.6);
  scene.add(lamp);
}

/** Four robots at the table: their dice (spectators see them all), talk bubbles, the bid sign, the reveal. */
export class Tavern {
  scene: THREE.Scene;
  sitters = new Map<string, Sitter>();
  match = '';
  sign: CSS2DObject;
  talkSeen = ''; // the last talk line already shown
  revealKey = '';
  flashUntil = 0;
  flashFace = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sign = new CSS2DObject(Object.assign(document.createElement('div'), { className: 'sign' }));
    this.sign.position.copy(TAVERN).setY(3.1);
    this.sign.visible = false;
    scene.add(this.sign);
  }

  sync(m: MatchView | null, robots: Model[]): void {
    if (!m || m.id !== this.match) {
      for (const s of this.sitters.values()) {
        this.scene.remove(s.root, s.dice);
        s.root.traverse((o) => { if (o instanceof CSS2DObject) o.element.remove(); });
      }
      this.sitters.clear();
      this.match = m?.id ?? '';
      this.talkSeen = m ? newTalk(m.talk, '').seen : ''; // joined mid-game: no replay of old talk
    }
    this.sign.visible = Boolean(m);
    if (!m) return;
    const v = m.state as TavernView, now = performance.now(), r = v.reveal, revealKey = r ? `${m.round}` : '';
    if (r && revealKey !== this.revealKey) {
      this.revealKey = revealKey;
      this.flashFace = r.bid.face;
      this.flashUntil = now + 5000;
    }
    const called = r && now < this.flashUntil ? r : null; // a liar call is on show
    v.seats.forEach((seat, i) => {
      const shown = called ? called.dice[seat.id] ?? [] : seat.dice ?? []; // during a call: the dice that decided it
      const s = this.sitters.get(seat.id) ?? this.spawn(seat.id, m, robots, i);
      s.tag.classList.toggle('turn', !m.finished && v.turn === seat.id);
      s.tag.classList.toggle('out', seat.out);
      s.body.visible = !seat.out || shown.length > 0;
      const key = JSON.stringify(shown);
      if (key !== s.lastDice) {
        s.lastDice = key;
        s.dice.clear();
        shown.forEach((d, k) => {
          const cube = die(d);
          cube.position.set((k - (shown.length - 1) / 2) * (DIE + 0.08), DIE / 2, 0);
          cube.rotation.y = (k - 0.5) * 0.3;
          cube.userData.face = d;
          s.dice.add(cube);
        });
      }
    });
    // Talk lines after the last one shown become bubbles.
    const talk = newTalk(m.talk, this.talkSeen);
    this.talkSeen = talk.seen;
    for (const line of talk.lines) {
      const s = this.sitters.get(line.name);
      if (!s) continue;
      s.bubble.textContent = `“${line.text}”`;
      s.bubbleUntil = now + BUBBLE_MS;
    }
    const sign = this.sign.element;
    if (m.finished) sign.textContent = `${m.ranking[0]} owns the tavern!`;
    else if (called) sign.textContent = `LIAR! ${called.found} ${called.found === 1 ? NAMES[called.bid.face] : PLURAL[called.bid.face]}: ${called.loser} loses a die`;
    else sign.textContent = v.bid ? `${v.bid.by}: ${bidText(v.bid)}` : `${v.turn} opens`;
    sign.classList.toggle('liar', Boolean(called));
  }

  spawn(name: string, m: MatchView, robots: Model[], i: number): Sitter {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4, look = robots[[...name].reduce((h, c) => h + c.charCodeAt(0), 0) % robots.length];
    const root = new THREE.Group(), body = SkeletonUtils.clone(look.scene);
    const h = new THREE.Box3().setFromObject(look.scene).getSize(new THREE.Vector3()).y;
    body.scale.setScalar(1.15 / h);
    body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = (o.material as THREE.MeshStandardMaterial).clone();
      mat.metalness = 0;
      mat.color.lerp(new THREE.Color(LANE_COLORS[i]), 0.35);
      o.material = mat;
    });
    root.position.set(TAVERN.x + Math.sin(a) * SEAT_R, 0.62, TAVERN.z + Math.cos(a) * SEAT_R);
    root.rotation.y = a + Math.PI; // facing the table
    root.add(body);
    const mixer = new THREE.AnimationMixer(body), seated = look.clips.find((c) => c.name === 'drive');
    if (seated) mixer.clipAction(seated).play(); // the seated pose, hands on the table
    const dice = new THREE.Group(); // on the table in front of the seat
    dice.position.set(TAVERN.x + Math.sin(a) * 0.8, TABLE_H + 0.06, TAVERN.z + Math.cos(a) * 0.8);
    dice.rotation.y = a;
    this.scene.add(root, dice);
    const tag = Object.assign(document.createElement('div'), { className: 'tag' });
    tag.style.setProperty('--lane', LANE_COLORS[i]);
    const bubble = Object.assign(document.createElement('div'), { className: 'bubble' });
    const p = m.players.find((x) => x.name === name);
    const head = Object.assign(document.createElement('div'), { className: 'name' });
    head.append(name, Object.assign(document.createElement('small'), { textContent: p?.house ? 'house' : p?.model ?? '' }));
    tag.append(bubble, head);
    const lbl = new CSS2DObject(tag);
    lbl.position.y = 1.55;
    root.add(lbl);
    const s: Sitter = { root, body, mixer, dice, tag, bubble, bubbleUntil: 0, lastDice: '' };
    this.sitters.set(name, s);
    return s;
  }

  update(dt: number): void {
    const now = performance.now(), flash = now < this.flashUntil;
    for (const s of this.sitters.values()) {
      s.mixer.update(dt);
      s.bubble.hidden = now > s.bubbleUntil;
      for (const cube of s.dice.children) cube.position.y = DIE / 2 + (flash && cube.userData.face === this.flashFace ? 0.12 + Math.sin(now / 120) * 0.04 : 0); // the dice that count hop
    }
  }
}

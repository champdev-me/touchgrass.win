import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { AgentView } from '../../shared/types.ts';
import { icon } from './icons.ts';

export const HEIGHT = 1.2; // robot height in tiles, about tree height
// Kenney Blocky Characters (CC0): the heart robot, the bolt robot and the crash-test dummy.
const VARIANTS = ['character-h', 'character-g', 'character-d'];
const EMOTE_CLIP: Record<string, string> = { dance: 'emote-yes', wave: 'interact-right', bow: 'emote-yes', cry: 'emote-no', flex: 'holding-both' };
const PUNCHED = new Set(['tree', 'rock']); // gathered by punching; bushes and grass are picked
const BUBBLE_ICON: Record<string, string> = { say: '💬', world: '📢', thought: '💭' };

interface Look {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  scale: number;
}

export interface Bot {
  view: AgentView;
  root: THREE.Object3D;
  tag: HTMLDivElement;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  clip: string;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  bars: HTMLElement[];
  bubble: HTMLDivElement;
  badge: HTMLSpanElement;
}

export class Robots {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  tickMs: number;
  bots = new Map<string, Bot>();
  looks: Look[] = [];
  kindAt: (x: number, y: number) => string | null;

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number, tickMs: number, kindAt: (x: number, y: number) => string | null) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.tickMs = tickMs;
    this.kindAt = kindAt;
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    this.looks = await Promise.all(VARIANTS.map(async (name) => {
      const g = await loader.loadAsync(`/assets/robots/${name}.glb`);
      return { scene: g.scene, clips: g.animations, scale: HEIGHT / new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3()).y };
    }));
  }

  sync(views: AgentView[]): void {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      const b = this.bots.get(v.id) ?? this.spawn(v);
      b.view = v;
      b.from.copy(b.root.position);
      b.to.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
      b.t = 0;
      [v.health, v.food, v.water, v.energy].forEach((val, i) => { b.bars[i].style.width = `${val}%`; });
      b.tag.classList.toggle('dead', v.dead);
      b.tag.classList.toggle('away', !v.online);
      b.tag.classList.toggle('fighting', v.fighting);
      b.bubble.hidden = !v.bubble;
      if (v.bubble) {
        b.bubble.className = `bubble ${v.bubble.kind}`;
        b.bubble.textContent = `${BUBBLE_ICON[v.bubble.kind]} ${v.bubble.text}`;
      }
      b.badge.textContent = v.badge ? `${v.badge} ` : '';
      const walking = v.moving || b.from.distanceToSquared(b.to) > 1e-4;
      const target = v.face ? this.kindAt(v.face[0], v.face[1]) : null;
      const work = v.action === 'attack' || (v.action === 'gather' && target !== null && PUNCHED.has(target)) ? 'attack-melee-right' : 'pick-up';
      const still = v.emote ? EMOTE_CLIP[v.emote] : v.action === 'gather' || v.action === 'attack' ? work : v.action === 'rest' || v.action === 'sleep' ? 'sit' : 'idle';
      this.play(b, v.dead ? 'die' : walking ? (v.action === 'flee' ? 'sprint' : 'walk') : still);
    }
    for (const [id, b] of this.bots) {
      if (seen.has(id)) continue;
      this.scene.remove(b.root);
      b.tag.remove();
      this.bots.delete(id);
    }
  }

  update(dt: number): void {
    for (const b of this.bots.values()) {
      b.t = Math.min(1, b.t + (dt * 1000) / this.tickMs);
      b.root.position.lerpVectors(b.from, b.to, b.t);
      const dx = b.to.x - b.from.x, dz = b.to.z - b.from.z;
      const f = b.view.face; // standing still: turn toward what it works on or fights
      if (Math.abs(dx) + Math.abs(dz) > 1e-3) b.root.rotation.y = Math.atan2(dx, dz);
      else if (f) b.root.rotation.y = Math.atan2(f[0] + 0.5 - b.root.position.x, f[1] + 0.5 - b.root.position.z);
      b.mixer.update(dt);
    }
  }

  /** Shows an icon over a robot for a few seconds (a completed trade, say). */
  flash(id: string | undefined, name: string, ms = 5000): void {
    const b = id ? this.bots.get(id) : undefined;
    if (!b) return;
    const el = icon(name);
    el.classList.add('flash');
    b.tag.prepend(el);
    setTimeout(() => el.remove(), ms);
  }

  spawn(v: AgentView): Bot {
    const look = this.looks[[...v.id].reduce((h, ch) => h + ch.charCodeAt(0), 0) % this.looks.length];
    const root = new THREE.Group();
    const body = SkeletonUtils.clone(look.scene);
    body.scale.setScalar(look.scale);
    const tint = new THREE.Color('#ffffff').lerp(new THREE.Color(v.color), 0.35); // a hint of the robot's colour
    body.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      m.metalness = 0;
      m.color.copy(tint);
      o.material = m;
    });
    root.add(body);
    const tag = document.createElement('div');
    tag.className = 'tag';
    const bubble = document.createElement('div');
    bubble.hidden = true;
    const badge = document.createElement('span');
    const name = document.createElement('div');
    name.className = 'name';
    name.append(badge, v.model ? `${v.name} · ${v.model}` : v.name);
    const barRow = document.createElement('div');
    barRow.className = 'bars';
    const bars = ['hp', 'food', 'water', 'energy'].map((cls) => {
      const bar = document.createElement('span');
      bar.className = `bar ${cls}`;
      const fill = document.createElement('i');
      bar.append(fill);
      barRow.append(bar);
      return fill;
    });
    tag.append(bubble, name, barRow);
    const label = new CSS2DObject(tag);
    label.position.y = HEIGHT + 0.3;
    root.add(label);
    root.position.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(body);
    const b: Bot = {
      view: v, root, tag, mixer, clip: '', t: 1, bars, bubble, badge,
      actions: new Map(look.clips.map((c) => [c.name, mixer.clipAction(c)])),
      from: root.position.clone(), to: root.position.clone(),
    };
    for (const once of ['die', 'sit']) {
      const act = b.actions.get(once);
      if (act) {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
    }
    this.play(b, 'idle');
    this.bots.set(v.id, b);
    return b;
  }

  play(b: Bot, name: string): void {
    if (b.clip === name) return;
    b.actions.get(b.clip)?.fadeOut(0.2);
    const next = b.actions.get(name)?.reset().fadeIn(0.2).play();
    if (next) next.paused = name === 'idle'; // standing still: hold the first frame instead of the bouncy idle loop
    b.clip = name;
  }
}

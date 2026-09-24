import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { AgentView } from '../../shared/types.ts';

const HEIGHT = 1.2; // robot height in tiles, about tree height
const EMOTE_CLIP: Record<string, string> = { dance: 'Dance', wave: 'Wave', bow: 'Yes', cry: 'No', flex: 'ThumbsUp' };
const BUBBLE_ICON: Record<string, string> = { say: '💬', world: '📢', thought: '💭' };

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
  template: THREE.Object3D = new THREE.Group();
  clips: THREE.AnimationClip[] = [];
  scale = 1;

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number, tickMs: number) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.tickMs = tickMs;
  }

  async load(): Promise<void> {
    const g = await new GLTFLoader().loadAsync('/assets/RobotExpressive.glb');
    this.template = g.scene;
    this.clips = g.animations;
    this.scale = HEIGHT / new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3()).y;
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
      const still = v.emote ? EMOTE_CLIP[v.emote] : v.action === 'gather' || v.action === 'attack' ? 'Punch' : v.action === 'rest' || v.action === 'sleep' ? 'Sitting' : 'Idle';
      this.play(b, v.dead ? 'Death' : walking ? 'Walking' : still);
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
      if (Math.abs(dx) + Math.abs(dz) > 1e-3) b.root.rotation.y = Math.atan2(dx, dz);
      b.mixer.update(dt);
    }
  }

  spawn(v: AgentView): Bot {
    const root = SkeletonUtils.clone(this.template);
    root.scale.setScalar(this.scale);
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const m = (o.material as THREE.MeshStandardMaterial).clone();
      if (m.name === 'Main') m.color.set(v.color);
      o.material = m;
    });
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
    label.position.y = (HEIGHT + 0.3) / this.scale;
    root.add(label);
    root.position.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
    this.scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const b: Bot = {
      view: v, root, tag, mixer, clip: '', t: 1, bars, bubble, badge,
      actions: new Map(this.clips.map((c) => [c.name, mixer.clipAction(c)])),
      from: root.position.clone(), to: root.position.clone(),
    };
    for (const once of ['Death', 'Sitting']) {
      const act = b.actions.get(once);
      if (act) {
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
      }
    }
    this.play(b, 'Idle');
    this.bots.set(v.id, b);
    return b;
  }

  play(b: Bot, name: string): void {
    if (b.clip === name) return;
    b.actions.get(b.clip)?.fadeOut(0.2);
    b.actions.get(name)?.reset().fadeIn(0.2).play();
    b.clip = name;
  }
}

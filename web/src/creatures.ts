import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { CREATURES, type CreatureKind } from '../../shared/creatures.ts';
import type { CreatureView } from '../../shared/types.ts';

// CC0 Kenney models (see web/assets/CREDITS.md): file, height in tiles, optional tint. The Roomba is a plain disc, as Roombas are.
const LOOK: Record<Exclude<CreatureKind, 'roomba'>, { file: string; height: number; tint?: string }> = {
  rabbit: { file: 'pets/animal-bunny.glb', height: 0.4 },
  deer: { file: 'pets/animal-deer.glb', height: 0.75 },
  boar: { file: 'pets/animal-hog.glb', height: 0.5 },
  cow: { file: 'pets/animal-cow.glb', height: 0.75 },
  chicken: { file: 'pets/animal-chick.glb', height: 0.35 },
  duck: { file: 'pets/animal-penguin.glb', height: 0.45 }, // the Confused Duck is confused because it is a penguin
  wolf: { file: 'pets/animal-dog.glb', height: 0.6, tint: '#9aa3b5' },
  goblin: { file: 'graveyard/character-zombie.glb', height: 0.8 },
  golem: { file: 'pets/animal-polar.glb', height: 2.2, tint: '#7fa36a' },
};
const CLIPS: Record<string, string[]> = { idle: ['idle'], walk: ['walk'], run: ['run', 'sprint'], dance: ['dance'] }; // names differ per pack

interface Model {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
  scale: number;
  height: number;
}

interface Mob {
  view: CreatureView;
  kind: CreatureKind;
  face: [number, number] | null;
  root: THREE.Group;
  tag: HTMLDivElement;
  hp: HTMLElement;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  mixer: THREE.AnimationMixer | null;
  actions: Map<string, THREE.AnimationAction>;
  clip: string;
}

export class Creatures {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  tickMs: number;
  mobs = new Map<string, Mob>();
  models = new Map<CreatureKind, Model>();

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number, tickMs: number) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.tickMs = tickMs;
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(LOOK).map(async ([kind, look]) => {
      const g = await loader.loadAsync(`/assets/${look.file}`);
      g.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        m.metalness = 0;
        if (look.tint) m.color.set(look.tint);
        o.material = m;
      });
      const size = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
      this.models.set(kind as CreatureKind, { scene: g.scene, clips: g.animations, scale: look.height / size.y, height: look.height });
    }));
    const disc = new THREE.Group(); // the Lost Roomba
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.1, 24), new THREE.MeshLambertMaterial({ color: '#2b2b2b' }));
    const light = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), new THREE.MeshBasicMaterial({ color: '#38e07b' }));
    body.position.y = 0.05;
    light.position.set(0, 0.11, 0.18);
    disc.add(body, light);
    this.models.set('roomba', { scene: disc, clips: [], scale: 1, height: 0.12 });
  }

  sync(views: CreatureView[]): void {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      const m = this.mobs.get(v.id) ?? this.spawn(v);
      m.from.copy(m.root.position);
      m.to.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
      m.t = 0;
      m.hp.style.width = `${(100 * v.hp) / v.maxHp}%`;
      m.tag.classList.toggle('angry', v.mode === 'chase');
      m.face = v.face;
      m.view = v;
      const moving = m.from.distanceToSquared(m.to) > 1e-4;
      const still = v.kind === 'duck' ? 'dance' : 'idle'; // the duck is confused
      this.play(m, !moving ? still : v.mode === 'chase' || v.mode === 'flee' ? 'run' : 'walk');
      if (v.kind === 'duck' && Math.random() < 0.03) this.quack(m);
    }
    for (const [id, m] of this.mobs) {
      if (seen.has(id)) continue;
      this.scene.remove(m.root);
      m.tag.remove();
      this.mobs.delete(id);
    }
  }

  update(dt: number): void {
    for (const m of this.mobs.values()) {
      m.t = Math.min(1, m.t + (dt * 1000) / this.tickMs);
      m.root.position.lerpVectors(m.from, m.to, m.t);
      if (m.kind === 'rabbit' && m.from.distanceToSquared(m.to) > 1e-4) m.root.position.y += Math.sin(m.t * Math.PI) * 0.35; // hop
      const dx = m.to.x - m.from.x, dz = m.to.z - m.from.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-3) m.root.rotation.y = Math.atan2(dx, dz);
      else if (m.face) m.root.rotation.y = Math.atan2(m.face[0] + 0.5 - m.root.position.x, m.face[1] + 0.5 - m.root.position.z); // eyes on its prey
      m.mixer?.update(dt);
    }
  }

  spawn(v: CreatureView): Mob {
    const model = this.models.get(v.kind)!;
    const root = new THREE.Group();
    const body = model.clips.length ? SkeletonUtils.clone(model.scene) : model.scene.clone();
    body.scale.setScalar(model.scale);
    root.add(body);
    const tag = document.createElement('div');
    tag.className = 'mobtag';
    tag.textContent = CREATURES[v.kind].emoji;
    const bar = document.createElement('span');
    bar.className = 'hp';
    const hp = document.createElement('i');
    bar.append(hp);
    tag.append(bar);
    const label = new CSS2DObject(tag);
    label.position.y = model.height + 0.3;
    root.add(label);
    root.position.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
    this.scene.add(root);
    const mixer = model.clips.length ? new THREE.AnimationMixer(body) : null;
    const actions = new Map(mixer ? model.clips.map((c) => [c.name, mixer.clipAction(c)] as const) : []);
    const m: Mob = { view: v, kind: v.kind, face: v.face, root, tag, hp, from: root.position.clone(), to: root.position.clone(), t: 1, mixer, actions, clip: '' };
    this.play(m, 'idle');
    this.mobs.set(v.id, m);
    return m;
  }

  quack(m: Mob): void {
    if (m.tag.querySelector('.quack')) return;
    const q = document.createElement('span');
    q.className = 'quack';
    q.textContent = ['quack?', 'quack!?', '...quack', 'where am i'][Math.floor(Math.random() * 4)];
    m.tag.prepend(q);
    setTimeout(() => q.remove(), 1800);
  }

  play(m: Mob, want: string): void {
    const name = CLIPS[want].find((n) => m.actions.has(n));
    if (!name || m.clip === name) return;
    m.actions.get(m.clip)?.fadeOut(0.2);
    m.actions.get(name)?.reset().fadeIn(0.2).play();
    m.clip = name;
  }
}

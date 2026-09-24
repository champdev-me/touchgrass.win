import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { CREATURES, type CreatureKind } from '../../shared/creatures.ts';
import type { CreatureView } from '../../shared/types.ts';

// Primitives until real CC0 models land: colour, width, height in tiles.
const BODY: Record<CreatureKind, [string, number, number]> = {
  rabbit: ['#d9d2c5', 0.3, 0.3], deer: ['#a0703c', 0.45, 0.8], boar: ['#5b4636', 0.55, 0.45], duck: ['#f2d23c', 0.3, 0.35],
  goblin: ['#4f9a3a', 0.4, 0.6], wolf: ['#6d7280', 0.5, 0.5], roomba: ['#2b2b2b', 0.6, 0.15], golem: ['#5d7a4a', 1.2, 1.8],
};

interface Mob {
  root: THREE.Group;
  tag: HTMLDivElement;
  hp: HTMLElement;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

export class Creatures {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  tickMs: number;
  mobs = new Map<string, Mob>();
  looks = new Map<CreatureKind, [THREE.BoxGeometry, THREE.MeshLambertMaterial]>();

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number, tickMs: number) {
    this.scene = scene;
    this.heightAt = heightAt;
    this.tickMs = tickMs;
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
      const dx = m.to.x - m.from.x, dz = m.to.z - m.from.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-3) m.root.rotation.y = Math.atan2(dx, dz);
    }
  }

  spawn(v: CreatureView): Mob {
    const [color, width, height] = BODY[v.kind];
    let look = this.looks.get(v.kind);
    if (!look) {
      look = [new THREE.BoxGeometry(width, height, width * 1.4), new THREE.MeshLambertMaterial({ color })];
      this.looks.set(v.kind, look);
    }
    const root = new THREE.Group();
    const body = new THREE.Mesh(look[0], look[1]);
    body.position.y = height / 2;
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
    label.position.y = height + 0.35;
    root.add(label);
    root.position.set(v.x + 0.5, this.heightAt(v.x, v.y), v.y + 0.5);
    this.scene.add(root);
    const m: Mob = { root, tag, hp, from: root.position.clone(), to: root.position.clone(), t: 1 };
    this.mobs.set(v.id, m);
    return m;
  }
}

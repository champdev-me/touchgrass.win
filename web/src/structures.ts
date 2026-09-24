import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { StructureView } from '../../shared/types.ts';

// Survival Kit models (CC0). The furnace is a big stone with a glowing mouth.
const FILES: Record<string, string> = { workbench: 'workbench', campfire: 'campfire-pit', furnace: 'resource-stone-large', kiln: 'resource-stone-large', chest: 'chest', dug: 'box-open' };
const SIZE: Record<string, number> = { workbench: 0.9, campfire: 0.7, furnace: 1.1, kiln: 1, chest: 0.7, dug: 0.8 };
const TINT: Record<string, string> = { kiln: '#b5563a' }; // the kiln is a brick-red furnace
const GLOWS = new Set(['campfire', 'furnace', 'kiln']);

export class Structures {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  models = new Map<string, THREE.Object3D>();
  placed = new Map<string, THREE.Object3D>();
  flames = new Map<string, THREE.Mesh>();

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number) {
    this.scene = scene;
    this.heightAt = heightAt;
  }

  async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(FILES).map(async ([kind, file]) => {
      const g = await loader.loadAsync(`/assets/survival/${file}.glb`);
      g.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshStandardMaterial)) return;
        if (TINT[kind]) o.material = o.material.clone();
        o.material.metalness = 0;
        if (TINT[kind]) o.material.color.set(TINT[kind]);
      });
      const h = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
      g.scene.scale.setScalar(SIZE[kind] / Math.max(h.x, h.y, h.z));
      this.models.set(kind, g.scene);
    }));
  }

  /** An opened chest where treasure was dug up, for 30 seconds. */
  dug(x: number, y: number): void {
    const m = this.models.get('dug')?.clone();
    if (!m) return;
    m.position.set(x + 0.5, this.heightAt(x, y), y + 0.5);
    this.scene.add(m);
    setTimeout(() => this.scene.remove(m), 30_000);
  }

  sync(list: StructureView[]): void {
    const seen = new Set<string>(); // re-seated every tick: the terrain under a station may load after it
    for (const [x, y, kind, lit] of list) {
      const id = `${x},${y}`;
      seen.add(id);
      if (!this.placed.has(id)) {
        const m = this.models.get(kind)!.clone();
        m.position.set(x + 0.5, this.heightAt(x, y), y + 0.5);
        this.scene.add(m);
        this.placed.set(id, m);
      }
      this.placed.get(id)!.position.y = this.heightAt(x, y);
      let flame = this.flames.get(id);
      if (GLOWS.has(kind) && !flame) {
        flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 6), new THREE.MeshBasicMaterial({ color: '#ff9a2e' }));
        flame.position.set(x + 0.5, this.heightAt(x, y) + (kind === 'campfire' ? 0.25 : 0.3), y + 0.5);
        this.scene.add(flame);
        this.flames.set(id, flame);
      }
      if (flame) {
        flame.visible = kind !== 'campfire' || lit;
        flame.position.y = this.heightAt(x, y) + (kind === 'campfire' ? 0.25 : 0.3);
      }
    }
    for (const [id, m] of this.placed) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      this.placed.delete(id);
      const f = this.flames.get(id);
      if (f) this.scene.remove(f);
      this.flames.delete(id);
    }
  }
}

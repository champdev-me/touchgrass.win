import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { StructureView } from '../../shared/types.ts';

// Survival Kit models (CC0). The furnace is a big stone with a glowing mouth.
const FILES: Record<string, string> = { workbench: 'workbench', campfire: 'campfire-pit', furnace: 'resource-stone-large' };
const SIZE: Record<string, number> = { workbench: 0.9, campfire: 0.7, furnace: 1.1 };

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
        if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) o.material.metalness = 0;
      });
      const h = new THREE.Box3().setFromObject(g.scene).getSize(new THREE.Vector3());
      g.scene.scale.setScalar(SIZE[kind] / Math.max(h.x, h.y, h.z));
      this.models.set(kind, g.scene);
    }));
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
      if ((kind === 'campfire' || kind === 'furnace') && !flame) {
        flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 6), new THREE.MeshBasicMaterial({ color: '#ff9a2e' }));
        flame.position.set(x + 0.5, this.heightAt(x, y) + (kind === 'furnace' ? 0.3 : 0.25), y + 0.5);
        this.scene.add(flame);
        this.flames.set(id, flame);
      }
      if (flame) {
        flame.visible = kind === 'furnace' || lit;
        flame.position.y = this.heightAt(x, y) + (kind === 'furnace' ? 0.3 : 0.25);
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

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { StructureView, Vec } from '../../shared/types.ts';

// Survival Kit models (CC0). The furnace is a big stone with a glowing mouth.
const FILES: Record<string, string> = { workbench: 'workbench', campfire: 'campfire-pit', furnace: 'resource-stone-large', anvil: 'workbench-anvil', sign: 'signpost' };
const SIZE: Record<string, number> = { workbench: 0.9, campfire: 0.7, furnace: 1.1, anvil: 0.7, sign: 1.2 };

export class Structures {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  models = new Map<string, THREE.Object3D>();
  placed = new Map<string, THREE.Object3D>();
  flames = new Map<string, THREE.Mesh>();
  mixer: THREE.AnimationMixer | null = null; // the Smith's idle animation

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

  /** The Smith's forge in the middle of the Plaza, with the Smith himself (a bronze robot) behind the anvil. */
  smith([x, y]: Vec): void {
    new GLTFLoader().loadAsync('/assets/robots/character-d.glb').then((g) => {
      const body = g.scene;
      body.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const m = (o.material as THREE.MeshStandardMaterial).clone();
        m.metalness = 0;
        m.color.set('#e0a060');
        o.material = m;
      });
      body.scale.setScalar(1.4 / new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y);
      body.position.set(x + 0.5, this.heightAt(x, y), y + 0.5);
      body.rotation.y = Math.PI / 4;
      this.scene.add(body);
      const idle = g.animations.find((c) => c.name === 'idle');
      if (idle) {
        this.mixer = new THREE.AnimationMixer(body);
        this.mixer.clipAction(idle).play();
      }
    });
    for (const [kind, dx] of [['anvil', 1], ['sign', -1]] as const) {
      const m = this.models.get(kind)!.clone();
      m.position.set(x + 0.5 + dx, this.heightAt(x + dx, y), y + 0.5);
      this.scene.add(m);
    }
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = 'the Smith';
    const label = new CSS2DObject(tag);
    label.position.set(x + 0.5, this.heightAt(x, y) + 1.8, y + 0.5);
    this.scene.add(label);
  }

  update(dt: number): void {
    this.mixer?.update(dt);
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

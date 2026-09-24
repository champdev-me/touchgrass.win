import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { StructureView } from '../../shared/types.ts';

// Survival Kit models (CC0). The furnace is a big stone with a glowing mouth.
const FILES: Record<string, string> = {
  workbench: 'workbench', campfire: 'campfire-pit', furnace: 'resource-stone-large', kiln: 'resource-stone-large', chest: 'chest', dug: 'box-open',
  wood_wall: 'fence', stone_wall: 'fence-fortified', brick_wall: 'fence-fortified', door: 'fence-doorway', bed: 'bedroll',
};
const SIZE: Record<string, number> = { workbench: 0.9, campfire: 0.7, furnace: 1.1, kiln: 1, chest: 0.7, dug: 0.8, wood_wall: 1, stone_wall: 1, brick_wall: 1, door: 1, bed: 0.9 };
const TINT: Record<string, string> = { kiln: '#b5563a', stone_wall: '#a7a39c', brick_wall: '#b5563a' }; // kilns and brick walls are brick red
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

  /** Soil is a flat brown tile; a crop grows on it as a tuft of stalks or a berry shrub. */
  private soil(): THREE.Object3D {
    const g = new THREE.Group();
    const dirt = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.06, 0.95), new THREE.MeshLambertMaterial({ color: '#6b4a2b' }));
    dirt.position.y = 0.03;
    g.add(dirt);
    const crop = new THREE.Group();
    crop.name = 'crop';
    g.add(crop);
    return g;
  }

  private grow(plot: THREE.Object3D, crop: [string, number] | null): void {
    const holder = plot.getObjectByName('crop')!;
    const key = crop ? `${crop[0]}:${Math.round(crop[1] * 4)}` : '';
    if (holder.userData.key === key) return;
    holder.userData.key = key;
    holder.clear();
    if (!crop) return;
    const h = 0.15 + crop[1] * 0.45, ripe = crop[1] >= 1;
    if (crop[0] === 'wheat') {
      const mat = new THREE.MeshLambertMaterial({ color: ripe ? '#e6c34a' : '#8fbf4a' });
      for (const [dx, dz] of [[-0.25, -0.25], [0.25, -0.2], [-0.2, 0.25], [0.22, 0.22], [0, 0]]) {
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, h, 4), mat);
        stalk.position.set(dx, 0.06 + h / 2, dz);
        holder.add(stalk);
      }
    } else {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.12 + crop[1] * 0.2, 8, 6), new THREE.MeshLambertMaterial({ color: '#3f8a2f' }));
      bush.position.y = 0.06 + h / 2;
      holder.add(bush);
      if (ripe) for (const [dx, dy, dz] of [[0.15, 0.1, 0.1], [-0.12, 0.05, 0.14], [0.05, 0.18, -0.15]]) {
        const berry = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshLambertMaterial({ color: '#d62246' }));
        berry.position.set(dx, bush.position.y + dy, dz);
        holder.add(berry);
      }
    }
  }

  sync(list: StructureView[]): void {
    const seen = new Set<string>(); // re-seated every tick: the terrain under a station may load after it
    for (const [x, y, kind, lit, crop] of list) {
      const id = `${x},${y}`;
      seen.add(id);
      if (!this.placed.has(id)) {
        const m = kind === 'farm_plot' ? this.soil() : (this.models.get(kind) ?? this.models.get('chest')!).clone();
        m.position.set(x + 0.5, this.heightAt(x, y), y + 0.5);
        this.scene.add(m);
        this.placed.set(id, m);
      }
      this.placed.get(id)!.position.y = this.heightAt(x, y);
      if (kind === 'farm_plot') this.grow(this.placed.get(id)!, crop);
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

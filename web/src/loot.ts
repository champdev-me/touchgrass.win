import * as THREE from 'three';
import type { Vec } from '../../shared/types.ts';

const geo = new THREE.BoxGeometry(0.35, 0.25, 0.35);
const mat = new THREE.MeshLambertMaterial({ color: '#8b5a2b' });

export class LootView {
  group = new THREE.Group();
  key = '';
  heightAt: (x: number, y: number) => number;

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number) {
    this.heightAt = heightAt;
    scene.add(this.group);
  }

  sync(piles: Vec[]): void {
    const key = piles.map((p) => p.join(',')).join(';');
    if (key === this.key) return;
    this.key = key;
    this.group.clear();
    for (const [x, y] of piles) {
      const box = new THREE.Mesh(geo, mat);
      box.position.set(x + 0.5, this.heightAt(x, y) + 0.12, y + 0.5);
      this.group.add(box);
    }
  }
}

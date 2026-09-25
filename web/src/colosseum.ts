import * as THREE from 'three';
import { ringAt } from '../../shared/geo.ts';
import type { Vec } from '../../shared/types.ts';

/** The four duel rings at the Plaza: a sand floor and a circle of wooden posts, drawn once the ground has loaded. */
export class Colosseum {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  built = false;

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number) {
    this.scene = scene;
    this.heightAt = heightAt;
  }

  build(plaza: Vec, loaded: boolean): void {
    if (this.built || !loaded) return;
    this.built = true;
    const sand = new THREE.MeshLambertMaterial({ color: '#e3cf9a' }), wood = new THREE.MeshLambertMaterial({ color: '#8a5a33' });
    for (let ring = 0; ring < 4; ring++) {
      const [cx, cy] = ringAt(plaza, ring), h = this.heightAt(cx, cy);
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.08, 24), sand);
      floor.position.set(cx + 0.5, h + 0.04, cy + 0.5);
      this.scene.add(floor);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 5), wood);
        post.position.set(cx + 0.5 + Math.cos(a) * 2.8, h + 0.4, cy + 0.5 + Math.sin(a) * 2.8);
        this.scene.add(post);
      }
    }
  }
}

import * as THREE from 'three';

type BaseView = [number, number, number, number, string]; // x0, y0, x1, y1, owner colour

/** Each base as a thin outline in its owner's colour, following the ground, with a flag in the middle. */
export class Bases {
  scene: THREE.Scene;
  heightAt: (x: number, y: number) => number;
  drawn = new Map<string, THREE.Group>();

  constructor(scene: THREE.Scene, heightAt: (x: number, y: number) => number) {
    this.scene = scene;
    this.heightAt = heightAt;
  }

  private draw([x0, y0, x1, y1, color]: BaseView): THREE.Group {
    const g = new THREE.Group(), pts: THREE.Vector3[] = [];
    const edge = (x: number, y: number) => pts.push(new THREE.Vector3(x, this.heightAt(Math.min(x, x1), Math.min(y, y1)) + 0.06, y));
    for (let x = x0; x <= x1 + 1; x++) edge(x, y0);
    for (let y = y0 + 1; y <= y1 + 1; y++) edge(x1 + 1, y);
    for (let x = x1; x >= x0; x--) edge(x, y1 + 1);
    for (let y = y1; y > y0; y--) edge(x0, y);
    g.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color })));
    const fx = Math.floor((x0 + x1) / 2), fy = Math.floor((y0 + y1) / 2), h = this.heightAt(fx, fy);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5), new THREE.MeshLambertMaterial({ color: '#d9d9d9' }));
    pole.position.set(fx + 0.5, h + 0.7, fy + 0.5);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
    cloth.position.set(fx + 0.75, h + 1.25, fy + 0.5);
    g.add(pole, cloth);
    return g;
  }

  /** Redraws a base when its bounds change or its ground has loaded since. */
  sync(list: BaseView[]): void {
    const seen = new Set<string>();
    for (const b of list) {
      const key = `${b.slice(0, 4).join(',')}:${this.heightAt(b[0], b[1])}`;
      seen.add(key);
      if (this.drawn.has(key)) continue;
      const g = this.draw(b);
      this.scene.add(g);
      this.drawn.set(key, g);
    }
    for (const [key, g] of this.drawn) {
      if (seen.has(key)) continue;
      this.scene.remove(g);
      this.drawn.delete(key);
    }
  }
}

import * as THREE from 'three';
import { B } from '../../shared/balance.ts';
import { TERRAIN as T, type PackedNode, type Vec } from '../../shared/types.ts';
import { buildProps, type ChunkNodes, type Models } from './props.ts';
import { COLOR, heightOf } from './tiles.ts';

const VIEW = 5; // chunks around the camera that get meshes
const BUILDS_PER_FRAME = 4;
const material = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Merged chunk mesh: a top quad per tile plus side walls where the neighbour is lower. */
export function buildChunkGeometry(tiles: Uint8Array, n: number, x0: number, y0: number, at: (x: number, y: number) => number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], c = new THREE.Color();
  const quad = (v: number[][], shade: number) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...v[k]);
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i, z = y0 + j, t = tiles[j * n + i], h = heightOf(t, x, z);
      c.set(COLOR[t] ?? '#ff00ff');
      quad([[x, h, z], [x, h, z + 1], [x + 1, h, z + 1], [x + 1, h, z]], 0.94 + (((x * 73856093) ^ (z * 19349663)) & 15) / 150);
      const lo = (nx: number, nz: number) => Math.min(h, heightOf(at(nx, nz), nx, nz));
      let l = lo(x, z - 1);
      if (l < h) quad([[x + 1, h, z], [x + 1, l, z], [x, l, z], [x, h, z]], 0.8);
      l = lo(x, z + 1);
      if (l < h) quad([[x, h, z + 1], [x, l, z + 1], [x + 1, l, z + 1], [x + 1, h, z + 1]], 0.8);
      l = lo(x - 1, z);
      if (l < h) quad([[x, h, z], [x, l, z], [x, l, z + 1], [x, h, z + 1]], 0.7);
      l = lo(x + 1, z);
      if (l < h) quad([[x + 1, h, z + 1], [x + 1, l, z + 1], [x + 1, l, z], [x + 1, h, z]], 0.7);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export class ChunkView {
  scene: THREE.Scene;
  models: Models;
  request: (list: Vec[]) => void;
  n = B.chunkSize;
  count = B.mapSize / B.chunkSize;
  tiles = new Map<string, Uint8Array>();
  meshes = new Map<string, THREE.Group>();
  asked = new Set<string>();
  nodes = new Map<string, ChunkNodes>();
  stale = new Set<string>();

  constructor(scene: THREE.Scene, models: Models, request: (list: Vec[]) => void) {
    this.scene = scene;
    this.models = models;
    this.request = request;
  }

  reset(): void {
    this.asked.clear();
  }

  add(cx: number, cy: number, b64: string, packed: PackedNode[]): void {
    const key = `${cx},${cy}`;
    this.tiles.set(key, Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)));
    this.nodes.set(key, new Map(packed.map(([local, k, left]) => [local, [k, left] as [number, number]])));
  }

  /** Applies per-tick node changes ([global tile index, units left]); affected chunks re-render soon. */
  applyNodes(changes: [number, number][]): void {
    for (const [i, left] of changes) {
      const x = i % B.mapSize, y = Math.floor(i / B.mapSize);
      const key = `${Math.floor(x / this.n)},${Math.floor(y / this.n)}`;
      const entry = this.nodes.get(key)?.get((y % this.n) * this.n + (x % this.n));
      if (!entry) continue;
      entry[1] = left;
      if (this.meshes.has(key)) this.stale.add(key);
    }
  }

  tileAt(x: number, y: number): number {
    const t = this.tiles.get(`${Math.floor(x / this.n)},${Math.floor(y / this.n)}`);
    return t ? t[(y % this.n) * this.n + (x % this.n)] : T.DEEP;
  }

  heightAt(x: number, y: number): number {
    return heightOf(this.tileAt(x, y), x, y);
  }

  update(center: THREE.Vector3): void {
    const ccx = Math.floor(center.x / this.n), ccy = Math.floor(center.z / this.n), want: Vec[] = [];
    let built = 0;
    for (let cy = ccy - VIEW; cy <= ccy + VIEW; cy++) {
      for (let cx = ccx - VIEW; cx <= ccx + VIEW; cx++) {
        if (cx < 0 || cy < 0 || cx >= this.count || cy >= this.count) continue;
        const key = `${cx},${cy}`;
        if (this.meshes.has(key)) continue;
        const tiles = this.tiles.get(key);
        if (tiles && built < BUILDS_PER_FRAME) {
          this.build(key, cx, cy, tiles);
          built++;
        } else if (!tiles && !this.asked.has(key)) {
          this.asked.add(key);
          want.push([cx, cy]);
        }
      }
    }
    for (const key of this.stale) {
      if (built >= BUILDS_PER_FRAME) break;
      this.stale.delete(key);
      const g = this.meshes.get(key);
      if (!g) continue;
      const [cx, cy] = key.split(',').map(Number);
      const old = g.children[1];
      g.remove(old);
      old.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.dispose(); });
      g.add(buildProps(this.models, this.tiles.get(key)!, this.nodes.get(key) ?? new Map(), this.n, cx * this.n, cy * this.n));
      built++;
    }
    for (let i = 0; i < want.length; i += 64) this.request(want.slice(i, i + 64)); // gateway serves ≤64 per message
    for (const [key, g] of this.meshes) {
      const [cx, cy] = key.split(',').map(Number);
      if (Math.abs(cx - ccx) > VIEW + 2 || Math.abs(cy - ccy) > VIEW + 2) this.drop(key, g);
    }
  }

  build(key: string, cx: number, cy: number, tiles: Uint8Array): void {
    const x0 = cx * this.n, y0 = cy * this.n, g = new THREE.Group();
    g.add(new THREE.Mesh(buildChunkGeometry(tiles, this.n, x0, y0, (x, y) => this.tileAt(x, y)), material));
    g.add(buildProps(this.models, tiles, this.nodes.get(key) ?? new Map(), this.n, x0, y0));
    this.scene.add(g);
    this.meshes.set(key, g);
  }

  drop(key: string, g: THREE.Group): void {
    this.scene.remove(g);
    g.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose(); // shared model geometry stays alive
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.meshes.delete(key);
  }
}

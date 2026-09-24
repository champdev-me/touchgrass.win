import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TERRAIN as T } from '../../shared/types.ts';
import { heightOf } from './tiles.ts';

export type Models = Map<string, THREE.Mesh[]>;
const NAMES = ['tree_default', 'tree_oak', 'tree_pineRoundA', 'plant_bush', 'grass_large', 'stone_largeA'];

export async function loadProps(): Promise<Models> {
  const loader = new GLTFLoader(), out: Models = new Map();
  await Promise.all(NAMES.map(async (n) => {
    const g = await loader.loadAsync(`/assets/${n}.glb`);
    g.scene.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    g.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      if (o.material instanceof THREE.MeshStandardMaterial) o.material.metalness = 0; // glTF defaults to metallic, which renders black without an env map
      meshes.push(o);
    });
    out.set(n, meshes);
  }));
  return out;
}

export function hash01(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ponytail: decoration only; 0.0.1-2 replaces trees/rocks with real resource nodes from the engine
export function propFor(t: number, x: number, y: number): string | null {
  const r = hash01(x, y);
  if (t === T.FOREST) return r < 0.15 ? 'tree_pineRoundA' : r < 0.3 ? 'tree_default' : r < 0.45 ? 'tree_oak' : r > 0.93 ? 'plant_bush' : null;
  if (t === T.MEADOW) return r < 0.02 ? 'tree_default' : r < 0.07 ? 'grass_large' : r > 0.985 ? 'plant_bush' : null;
  if (t === T.HILLS) return r < 0.12 ? 'stone_largeA' : null;
  return null;
}

/** One InstancedMesh per model part per chunk keeps draw calls low. */
export function buildProps(models: Models, tiles: Uint8Array, n: number, x0: number, y0: number): THREE.Group {
  const byKind = new Map<string, THREE.Matrix4[]>();
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const t = tiles[j * n + i], x = x0 + i, y = y0 + j, kind = propFor(t, x, y);
      if (!kind) continue;
      const r = hash01(y, x), s = 0.85 + r * 0.3;
      q.setFromAxisAngle(up, r * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, heightOf(t), y + 0.5), q, new THREE.Vector3(s, s, s));
      (byKind.get(kind) ?? byKind.set(kind, []).get(kind)!).push(m);
    }
  }
  const group = new THREE.Group(), tmp = new THREE.Matrix4();
  for (const [kind, mats] of byKind) {
    for (const mesh of models.get(kind) ?? []) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
      mats.forEach((m, k) => inst.setMatrixAt(k, tmp.multiplyMatrices(m, mesh.matrixWorld)));
      group.add(inst);
    }
  }
  return group;
}

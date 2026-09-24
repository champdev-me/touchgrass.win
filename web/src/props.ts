import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hash01 } from '../../shared/hash.ts';
import { NODE_KINDS, type NodeKind } from '../../shared/types.ts';
import { heightOf } from './tiles.ts';

export type Models = Map<string, THREE.Mesh[]>;
/** A chunk's nodes: local tile index -> [NODE_KINDS index, units left]. */
export type ChunkNodes = Map<number, [number, number]>;

const NAMES = ['tree_default', 'tree_oak', 'tree_pineRoundA', 'plant_bush', 'grass_large', 'stone_largeA'];
const TREES = ['tree_default', 'tree_oak', 'tree_pineRoundA'];
const MODEL: Record<NodeKind, (x: number, y: number) => string> = {
  tree: (x, y) => TREES[Math.floor(hash01(x, y) * TREES.length)],
  berry_bush: () => 'plant_bush',
  grass: () => 'grass_large',
  rock: () => 'stone_largeA',
};
const SCALE: Record<NodeKind, number> = { tree: 1, berry_bush: 1.6, grass: 1.2, rock: 1 };
const berryGeo = new THREE.SphereGeometry(0.06, 6, 4);
const berryMat = new THREE.MeshLambertMaterial({ color: '#d62246' });
const BERRY_OFFSETS = [[0.12, 0.3, 0.05], [-0.1, 0.26, 0.1], [0.02, 0.34, -0.12]];

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

/** One InstancedMesh per model part per chunk keeps draw calls low. Empty nodes are not drawn. */
export function buildProps(models: Models, tiles: Uint8Array, nodes: ChunkNodes, n: number, x0: number, y0: number): THREE.Group {
  const byModel = new Map<string, THREE.Matrix4[]>();
  const berries: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [local, [k, left]] of nodes) {
    if (left <= 0) continue;
    const kind = NODE_KINDS[k], x = x0 + (local % n), y = y0 + Math.floor(local / n);
    const r = hash01(y, x), s = SCALE[kind] * (0.85 + r * 0.3);
    q.setFromAxisAngle(up, r * Math.PI * 2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, heightOf(tiles[local]), y + 0.5), q, new THREE.Vector3(s, s, s));
    const name = MODEL[kind](x, y);
    (byModel.get(name) ?? byModel.set(name, []).get(name)!).push(m);
    if (kind === 'berry_bush') for (const [bx, by, bz] of BERRY_OFFSETS) berries.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(bx, by, bz)));
  }
  const group = new THREE.Group(), tmp = new THREE.Matrix4();
  for (const [name, mats] of byModel) {
    for (const mesh of models.get(name) ?? []) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
      mats.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, mesh.matrixWorld)));
      group.add(inst);
    }
  }
  if (berries.length) {
    const inst = new THREE.InstancedMesh(berryGeo, berryMat, berries.length);
    berries.forEach((m, i) => inst.setMatrixAt(i, m));
    group.add(inst);
  }
  return group;
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { hash01 } from '../../shared/hash.ts';
import { NODE_KINDS, type NodeKind } from '../../shared/types.ts';
import { heightOf } from './tiles.ts';

export type Models = Map<string, THREE.Mesh[]>;
/** A chunk's nodes: local tile index -> [NODE_KINDS index, units left]. */
export type ChunkNodes = Map<number, [number, number]>;

const NAMES = ['tree_default', 'tree_oak', 'tree_fat', 'tree_detailed', 'plant_bush', 'grass_large', 'stone_largeA'];
const TREES = ['tree_default', 'tree_oak', 'tree_fat', 'tree_detailed'];
// Kenney's teal reads as alpine; recolour to meadow greens. Leaves are white so each tree gets its own green.
const RECOLOR: Record<string, string> = { leafsGreen: '#ffffff', woodBark: '#8a5a33', grass: '#5fa83c' };
const LEAF_GREENS = ['#4f9a32', '#5fae3a', '#3f8a2f', '#6bb343', '#7aa83a'].map((c) => new THREE.Color(c));
const MODEL: Record<NodeKind, (x: number, y: number) => string> = {
  tree: (x, y) => TREES[Math.floor(hash01(x, y) * TREES.length)],
  berry_bush: () => 'plant_bush',
  grass: () => 'grass_large',
  rock: () => 'stone_largeA',
  iron_vein: () => 'iron_vein',
  crystal: () => 'crystal',
};
// Ore and crystal nodes reuse the stone model, recoloured.
const ORES: [string, string, number][] = [['iron_vein', '#b5653a', 0], ['crystal', '#7fd8ff', 0.35]];
const SCALE: Record<NodeKind, number> = { tree: 1.4, berry_bush: 1.6, grass: 1.2, rock: 1, iron_vein: 1, crystal: 0.7 };
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
      if (o.material instanceof THREE.MeshStandardMaterial) {
        o.material = o.material.clone();
        o.material.metalness = 0; // glTF defaults to metallic, which renders black without an env map
        const tint = RECOLOR[o.material.name];
        if (tint) o.material.color.set(tint);
      }
      meshes.push(o);
    });
    out.set(n, meshes);
  }));
  for (const [name, color, glow] of ORES) {
    out.set(name, out.get('stone_largeA')!.map((m) => {
      const c = m.clone(), mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.color.set(color);
      mat.emissive.set(color).multiplyScalar(glow);
      c.material = mat;
      return c;
    }));
  }
  return out;
}

/** One InstancedMesh per model part per chunk keeps draw calls low. Empty nodes are not drawn. */
export function buildProps(models: Models, tiles: Uint8Array, levels: Uint8Array, nodes: ChunkNodes, n: number, x0: number, y0: number): THREE.Group {
  const byModel = new Map<string, THREE.Matrix4[]>();
  const greens = new Map<string, THREE.Color[]>();
  const berries: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [local, [k, left]] of nodes) {
    if (left <= 0) continue;
    const kind = NODE_KINDS[k], x = x0 + (local % n), y = y0 + Math.floor(local / n);
    const r = hash01(y, x), s = SCALE[kind] * (0.85 + r * 0.3);
    q.setFromAxisAngle(up, r * Math.PI * 2);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x + 0.5, heightOf(tiles[local], levels[local]), y + 0.5), q, new THREE.Vector3(s, s, s));
    const name = MODEL[kind](x, y);
    (byModel.get(name) ?? byModel.set(name, []).get(name)!).push(m);
    (greens.get(name) ?? greens.set(name, []).get(name)!).push(LEAF_GREENS[Math.floor(hash01(x + 7, y + 3) * LEAF_GREENS.length)]);
    if (kind === 'berry_bush') for (const [bx, by, bz] of BERRY_OFFSETS) berries.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(bx, by, bz)));
  }
  const group = new THREE.Group(), tmp = new THREE.Matrix4();
  for (const [name, mats] of byModel) {
    for (const mesh of models.get(name) ?? []) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, mats.length);
      mats.forEach((m, i) => inst.setMatrixAt(i, tmp.multiplyMatrices(m, mesh.matrixWorld)));
      if ((mesh.material as THREE.Material).name === 'leafsGreen') greens.get(name)!.forEach((c, i) => inst.setColorAt(i, c));
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

import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { MatchView, ServerMsg } from '../../shared/types.ts';
import { connect } from './net.ts';
import { buildTrack, MID_Z, Riders, xOf } from './track.ts';
import { setupUi } from './ui.ts';

const host = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#a9d8f5');
scene.fog = new THREE.Fog('#a9d8f5', 60, 160);
scene.add(new THREE.HemisphereLight('#fff4e0', '#5a7a40', 1.4));
const sun = new THREE.DirectionalLight('#fff1d0', 1.8);
sun.position.set(-0.4, 1, 0.6);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

let matches: MatchView[] = [], shown: string | null = null;
const ui = setupUi((id) => {
  shown = id;
  show();
});
const riders = new Riders(scene);
await Promise.all([buildTrack(scene), riders.load()]);

// Keep watching the picked match while it lasts, else the first live one, else the latest finished.
function show(): void {
  const m = matches.find((x) => x.id === shown) ?? matches.find((x) => !x.finished) ?? matches.at(-1) ?? null;
  shown = m?.id ?? null;
  riders.sync(m);
  ui.race(m, matches);
}

connect((m: ServerMsg) => {
  if (m.type === 'hello') {
    ui.events(m.recent, true);
    return;
  }
  matches = m.matches;
  show();
  ui.lobby(m.queues, matches.filter((x) => !x.finished).length);
  ui.boards(m.leaderboard);
  ui.events(m.events);
}, (s) => ui.status(s));

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key.toLowerCase() === 'h') document.body.classList.toggle('clean');
});

// A side-on camera that follows the pack and pulls back when it spreads out.
const clock = new THREE.Clock();
const eye = new THREE.Vector3(xOf(0), 8, MID_Z + 16), look = new THREE.Vector3(xOf(0), 0.8, MID_Z), want = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), k = 1 - Math.pow(0.05, dt);
  riders.update(dt);
  const [lo, hi] = riders.spread() ?? [xOf(0), xOf(0)];
  const cx = (lo + hi) / 2 + 2, back = Math.max(13, (hi - lo) * 0.9 + 9);
  look.lerp(want.set(cx, 0.8, MID_Z), k);
  eye.lerp(want.set(cx - 4, 4 + back * 0.55, MID_Z + back), k);
  camera.position.copy(eye);
  camera.lookAt(look);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

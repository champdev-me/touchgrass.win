import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { MatchView, QueueView, ServerMsg } from '../../shared/types.ts';
import { connect } from './net.ts';
import { buildTilt, HALF, JOUST_FOCUS, Jousters } from './joust.ts';
import { buildRoulette, Roulette, ROULETTE } from './roulette.ts';
import { buildTavern, Tavern, TAVERN } from './tavern.ts';
import { buildTrack, CENTER, onOval, Riders } from './track.ts';
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

let matches: MatchView[] = [], queues: QueueView[] = [], watching: string | null = null;
const ui = setupUi((id) => {
  watching = id;
  show();
});
const riders = new Riders(scene);
const [sx, sz] = onOval(0, 14), START = new THREE.Vector3(sx, 0, sz); // the finish line, where the camera waits
const jousters = new Jousters(scene), tavern = new Tavern(scene), roulette = new Roulette(scene);
await Promise.all([buildTrack(scene), riders.load()]);
buildTilt(scene);
buildTavern(scene);
buildRoulette(scene);

// Watch the picked match to the end of its podium, then back to the tiles.
function show(): void {
  const m = matches.find((x) => x.id === watching) ?? null;
  if (!m) watching = null;
  riders.sync(m?.game === 'horse_race' ? m : null);
  jousters.sync(m?.game === 'joust' ? m : null, riders.horse!, riders.robots);
  tavern.sync(m?.game === 'tavern' ? m : null, riders.robots);
  roulette.sync(m?.game === 'roulette' ? m : null, riders.robots);
  ui.race(m);
  ui.home(watching ? null : matches, queues);
}

connect((m: ServerMsg) => {
  if (m.type === 'hello') {
    ui.events(m.recent, true);
    return;
  }
  matches = m.matches;
  queues = m.queues;
  show();
  ui.lobby(m.queues, matches.filter((x) => !x.finished).length);
  const game = matches.find((x) => x.id === watching)?.game ?? 'horse_race';
  ui.boards(m.leaderboards[game], game);
  ui.events(m.events);
}, (s) => ui.status(s));

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key.toLowerCase() === 'h') document.body.classList.toggle('clean');
  if (e.key === 'Escape') {
    watching = null;
    show();
  }
});

// A camera outside the oval that follows the pack round the bends and pulls back when it spreads out.
const clock = new THREE.Clock();
const eye = new THREE.Vector3(CENTER.x, 20, 40), look = CENTER.clone(), want = new THREE.Vector3(), out = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1), k = 1 - Math.pow(0.1, dt);
  riders.update(dt);
  jousters.update(dt);
  tavern.update(dt);
  roulette.update(dt);
  const game = matches.find((x) => x.id === watching)?.game;
  if (game === 'tavern' || game === 'roulette') {
    const at = game === 'tavern' ? TAVERN : ROULETTE;
    look.lerp(want.copy(at).setY(0.9), k); // at the table, a little above
    eye.lerp(want.set(at.x, 5.2, at.z + 7.5), k);
  } else if (game === 'joust') {
    // Side-on, far enough back that both ends of the tilt fit between the panel columns.
    const free = Math.max(0.3, 1 - (2 * 290) / innerWidth), tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    const d = (HALF + 3) / (tanH * free);
    look.lerp(JOUST_FOCUS, k);
    eye.lerp(want.set(JOUST_FOCUS.x, d * 0.38, d), k);
  } else if (game) {
    const at = riders.positions(), target = at.length ? at.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(at.length) : START;
    const spread = at.length ? Math.max(...at.map((p) => p.distanceTo(target))) : 0, back = Math.min(20, 13 + spread * 0.8);
    out.subVectors(target, CENTER).setY(0);
    if (out.lengthSq() < 1) out.set(0, 0, 1);
    look.lerp(want.copy(target).setY(0.8), k);
    eye.lerp(want.copy(target).addScaledVector(out.normalize(), back).setY(6 + back * 0.45), k);
  } else {
    const a = clock.elapsedTime * 0.04; // the tiles are up: circle the grounds slowly
    look.lerp(CENTER, k);
    eye.lerp(want.set(CENTER.x + Math.cos(a) * 48, 26, Math.sin(a) * 40), k);
  }
  camera.position.copy(eye);
  camera.lookAt(look);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

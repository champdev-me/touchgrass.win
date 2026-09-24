import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { B } from '../../shared/balance.ts';
import { daylight, timeOf } from '../../shared/time.ts';
import type { ClientMsg, ServerMsg } from '../../shared/types.ts';
import { connect } from './net.ts';
import { LootView } from './loot.ts';
import { loadProps } from './props.ts';
import { Robots } from './robots.ts';
import { ChunkView } from './terrain.ts';
import { WATER_LEVEL } from './tiles.ts';
import { setupUi } from './ui.ts';

const host = document.getElementById('view')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
host.appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none';
host.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd3ff');
scene.fog = new THREE.Fog('#9fd3ff', 70, 180);
const hemi = new THREE.HemisphereLight('#e4f4ff', '#4a6b3a', 1.3);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d0', 1.8);
sun.position.set(-0.4, 1, -0.25);
scene.add(sun);
const SKY_DAY = new THREE.Color('#9fd3ff'), SKY_NIGHT = new THREE.Color('#0b1733');
const SUN_DAY = new THREE.Color('#fff1d0'), SUN_NIGHT = new THREE.Color('#8fa8ff');
let lastTick = 0, lastTickAt = performance.now();
const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ color: '#2f7fc1', transparent: true, opacity: 0.78 }));
water.rotation.x = -Math.PI / 2;
scene.add(water);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.45;
controls.minDistance = 5;
controls.maxDistance = 140;
const mid = B.mapSize / 2;
controls.target.set(mid, 1, mid);
camera.position.set(mid - 22, 30, mid + 28);

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

let follow: string | null = null;
const FOLLOW_OFFSET = new THREE.Vector3(-6, 7, 6);
let send: (m: ClientMsg) => void = () => {};
const ui = setupUi((id) => setFollow(id));
const robots = new Robots(scene, (x, y) => chunks.heightAt(x, y), B.tickMs);
const [models] = await Promise.all([loadProps(), robots.load()]);
const chunks = new ChunkView(scene, models, (list) => send({ type: 'chunks', list }));
const loot = new LootView(scene, (x, y) => chunks.heightAt(x, y));

function setFollow(id: string | null) {
  follow = id;
  ui.following(id);
  const bot = id ? robots.bots.get(id) : undefined;
  if (!bot) return;
  controls.target.copy(bot.root.position); // snap to a close 45° view so the robot fills the stream
  camera.position.copy(bot.root.position).add(FOLLOW_OFFSET);
}

send = connect((m: ServerMsg) => {
  if (m.type === 'hello') {
    chunks.reset();
    lastTick = m.tick;
    lastTickAt = performance.now();
  } else if (m.type === 'chunk') {
    chunks.add(m.cx, m.cy, m.data, m.nodes);
  } else {
    lastTick = m.tick;
    lastTickAt = performance.now();
    robots.sync(m.agents);
    chunks.applyNodes(m.nodes);
    loot.sync(m.loot);
    ui.agents(m.agents);
    ui.events(m.events);
    const t = timeOf(m.tick);
    ui.status(`day ${t.day} · ${t.phase} · ${m.agents.length} robots`);
  }
}, (s) => ui.status(s));

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'f') setFollow(null);
  if (k === 'h') document.body.classList.toggle('clean');
  if (e.key === 'Tab') {
    e.preventDefault();
    const ids = [...robots.bots.keys()];
    if (ids.length) setFollow(ids[(ids.indexOf(follow ?? '') + 1) % ids.length]);
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), before = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  robots.update(dt);
  before.copy(controls.target);
  const bot = follow ? robots.bots.get(follow) : undefined;
  if (bot) {
    controls.target.lerp(bot.root.position, 1 - Math.pow(0.002, dt));
  } else {
    fwd.subVectors(controls.target, camera.position).setY(0).normalize();
    right.crossVectors(fwd, camera.up);
    move.set(0, 0, 0);
    if (keys.has('w')) move.add(fwd);
    if (keys.has('s')) move.sub(fwd);
    if (keys.has('d')) move.add(right);
    if (keys.has('a')) move.sub(right);
    controls.target.addScaledVector(move, dt * 35);
  }
  camera.position.add(move.subVectors(controls.target, before)); // camera keeps its offset from the target
  controls.update();
  water.position.set(controls.target.x, WATER_LEVEL, controls.target.z);
  chunks.update(controls.target);
  const light = daylight(lastTick + (performance.now() - lastTickAt) / B.tickMs);
  hemi.intensity = 0.3 + light;
  sun.intensity = 0.15 + light * 1.65;
  sun.color.lerpColors(SUN_NIGHT, SUN_DAY, light);
  (scene.background as THREE.Color).lerpColors(SKY_NIGHT, SKY_DAY, light);
  scene.fog!.color.lerpColors(SKY_NIGHT, SKY_DAY, light);
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

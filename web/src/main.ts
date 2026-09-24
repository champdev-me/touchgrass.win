import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { B } from '../../shared/balance.ts';
import { daylight, timeOf } from '../../shared/time.ts';
import type { ClientMsg, ServerMsg } from '../../shared/types.ts';
import { CREATURES } from '../../shared/creatures.ts';
import { connect } from './net.ts';
import { Creatures } from './creatures.ts';
import { Structures } from './structures.ts';
import { LootView } from './loot.ts';
import { loadProps } from './props.ts';
import { HEIGHT as ROBOT_HEIGHT, Robots } from './robots.ts';
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
type CamMode = 'top' | 'behind' | 'face';
let cam: CamMode = 'top'; // follow views: 45° from above, third person, or looking at its face
const eye = new THREE.Vector3(), look = new THREE.Vector3();
const FOLLOW_OFFSET = new THREE.Vector3(-6, 7, 6);
let send: (m: ClientMsg) => void = () => {};
const ui = setupUi((id) => setFollow(id), (mode) => setCam(mode));
const robots = new Robots(scene, (x, y) => chunks.heightAt(x, y), B.tickMs, (x, y) => chunks.nodeKindAt(x, y));
const creatures = new Creatures(scene, (x, y) => chunks.heightAt(x, y), B.tickMs);
const structures = new Structures(scene, (x, y) => chunks.heightAt(x, y));
const [models] = await Promise.all([loadProps(), robots.load(), creatures.load(), structures.load()]);
let smithPlaced = false;
const chunks = new ChunkView(scene, models, (list) => send({ type: 'chunks', list }));
const loot = new LootView(scene, (x, y) => chunks.heightAt(x, y));

function setCam(mode: CamMode): void {
  if (mode !== 'top' && !follow && robots.bots.size) setFollow([...robots.bots.keys()][0]);
  const was = cam;
  cam = follow ? mode : 'top';
  controls.enabled = cam === 'top';
  ui.camera(follow ? cam : null);
  const bot = follow ? (robots.bots.get(follow) ?? creatures.mobs.get(follow)) : undefined;
  if (bot && cam === 'top' && was !== 'top') {
    controls.target.copy(bot.root.position); // back up to the usual view from above
    camera.position.copy(bot.root.position).add(FOLLOW_OFFSET);
  }
}

function setFollow(id: string | null) {
  follow = id;
  if (!id) setCam('top');
  ui.following(id);
  ui.camera(id ? cam : null);
  if (!id) ui.focus(null);
  const bot = id ? (robots.bots.get(id) ?? creatures.mobs.get(id)) : undefined;
  if (!bot) return;
  controls.target.copy(bot.root.position); // snap to a close 45° view so the robot fills the stream
  camera.position.copy(bot.root.position).add(FOLLOW_OFFSET);
}

send = connect((m: ServerMsg) => {
  if (m.type === 'hello') {
    chunks.reset();
    ui.events(m.recent, true);
    lastTick = m.tick;
    lastTickAt = performance.now();
  } else if (m.type === 'chunk') {
    chunks.add(m.cx, m.cy, m.data, m.nodes, m.heights);
  } else {
    lastTick = m.tick;
    lastTickAt = performance.now();
    robots.sync(m.agents);
    chunks.applyNodes(m.nodes);
    loot.sync(m.loot);
    creatures.sync(m.creatures);
    structures.sync(m.structures);
    const [px, py] = [B.mapSize / 2, B.mapSize / 2];
    if (!smithPlaced && chunks.tileAt(px, py) !== 0) {
      structures.smith([px, py]); // the Smith's forge, once the Plaza has loaded
      smithPlaced = true;
    }
    ui.agents(m.agents);
    ui.events(m.events);
    if (follow) ui.focus(m.agents.find((a) => a.id === follow) ?? null);
    const mob = follow ? creatures.mobs.get(follow)?.view : undefined;
    if (follow?.startsWith('mob_') && !mob) setFollow(null); // it died or wandered off
    const t = timeOf(m.tick);
    ui.world({ day: t.day, night: t.phase === 'night', robots: m.agents.length, creatures: m.creatures.length, following: mob ? { emoji: CREATURES[mob.kind].emoji, name: CREATURES[mob.kind].name, hp: mob.hp, maxHp: mob.maxHp } : undefined });
  }
}, (s) => ui.status(s));

// Double-click a robot or animal: follow it from behind. Picks whatever is drawn nearest the click.
const probe = new THREE.Vector3();
renderer.domElement.addEventListener('dblclick', (e) => {
  const rect = renderer.domElement.getBoundingClientRect(), hit = { id: '', d: 48 };
  const check = (id: string, root: THREE.Object3D, h: number) => {
    probe.copy(root.position).setY(root.position.y + h * 0.5).project(camera);
    if (probe.z > 1) return; // behind the camera
    const d = Math.hypot(((probe.x + 1) / 2) * rect.width + rect.left - e.clientX, ((1 - probe.y) / 2) * rect.height + rect.top - e.clientY);
    if (d < hit.d) [hit.id, hit.d] = [id, d];
  };
  for (const [id, b] of robots.bots) check(id, b.root, ROBOT_HEIGHT);
  for (const [id, m] of creatures.mobs) check(id, m.root, m.height);
  if (!hit.id) return;
  setFollow(hit.id);
  setCam('behind');
});

const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'f') setFollow(null);
  if (k === 'h') document.body.classList.toggle('clean');
  if (k === 'k') ui.promptAdminKey();
  if (k === 't') setCam(cam === 'behind' ? 'top' : 'behind');
  if (k === 'v') setCam(cam === 'face' ? 'top' : 'face');
  if (k === 'm') {
    const near = [...creatures.mobs.entries()].sort((p, q) => p[1].root.position.distanceTo(controls.target) - q[1].root.position.distanceTo(controls.target)).slice(0, 12).map(([id]) => id);
    if (near.length) setFollow(near[(near.indexOf(follow ?? '') + 1) % near.length]);
  }
  if (k === 'c') {
    const fighters = [...robots.bots.values()].filter((b) => b.view.fighting).map((b) => b.view.id);
    if (fighters.length) setFollow(fighters[(fighters.indexOf(follow ?? '') + 1) % fighters.length]);
  }
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
  creatures.update(dt);
  structures.update(dt);
  before.copy(controls.target);
  const bot = follow ? (robots.bots.get(follow) ?? creatures.mobs.get(follow)) : undefined;
  if (bot && cam !== 'top') {
    const yaw = bot.root.rotation.y, p = bot.root.position, k = 1 - Math.pow(0.02, dt);
    const h = 'height' in bot ? bot.height : ROBOT_HEIGHT;
    fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    if (cam === 'behind') {
      eye.copy(p).addScaledVector(fwd, -4.5).setY(p.y + 2.4);
      look.copy(p).addScaledVector(fwd, 2.5).setY(p.y + 0.9);
    } else {
      eye.copy(p).addScaledVector(fwd, 1.2 + h * 1.6).setY(p.y + h * 0.75); // in front, eye level
      look.copy(p).setY(p.y + h * 0.6);
    }
    eye.y = Math.max(eye.y, chunks.heightAt(Math.floor(eye.x), Math.floor(eye.z)) + 0.6); // never inside a hill
    camera.position.lerp(eye, k);
    controls.target.lerp(look, k);
    camera.lookAt(controls.target);
  } else if (bot) {
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
  if (cam === 'top') {
    camera.position.add(move.subVectors(controls.target, before)); // camera keeps its offset from the target
    controls.update();
  }
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

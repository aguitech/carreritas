/* =====================================================================
 *  CARRERITAS 3D — Three.js racing game
 *  - 3 cars (Lancer, GT-R, Mustang) with stats
 *  - Custom closed-loop track with checkpoints
 *  - Arcade physics (acceleration, friction, steering, drift)
 *  - Lap timer + best time in localStorage
 *  - Keyboard + on-screen touch controls
 *  - Third-person camera chase
 *  - Minimap
 * ===================================================================== */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const menu = $('menu');
const hud = $('hud');
const finishScreen = $('finishScreen');
// const loadingEl = $('loading');  // ← ELIMINADO: ya no hay loading
const canvas = $('game');
const mobileControls = $('mobileControls');
const minimapCanvas = $('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

const carGrid = $('carGrid');
const carNameEl = $('carName');
const carDescEl = $('carDesc');
const statSpeedEl = $('statSpeed');
const statAccelEl = $('statAccel');
const statHandlingEl = $('statHandling');
const bestTimeEl = $('bestTime');
const bestTimeEndEl = $('bestTimeEnd');
const lapEl = $('lap');
const timeEl = $('time');
const speedEl = $('speed');
const checkpointMsgEl = $('checkpointMsg');

// ---------- CAR CATALOG ----------
const CARS = [
  {
    id: 'lancer', file: 'cars/lancer.glb',
    name: 'Lancer Evo', sub: 'Mitsubishi · AWD',
    emoji: '🏎️',
    color: 0xc4212c,
    maxSpeed: 200,    // arbitrary units
    accel: 1.0,
    handling: 0.95,
    desc: 'Ralliart clásico. Balance total, drift controlado.',
  },
  {
    id: 'gtr', file: 'cars/gtr.glb',
    name: 'GT-R R35', sub: 'Nissan · Godzilla',
    emoji: '⚡',
    color: 0x4d8eff,
    maxSpeed: 230,
    accel: 1.05,
    handling: 1.0,
    desc: 'Tracción total inteligente. El devorador de curvas.',
  },
  {
    id: 'mustang', file: 'cars/mustang.glb',
    name: 'Mustang GT', sub: 'Ford · V8',
    emoji: '🐎',
    color: 0x1f5a2d,
    maxSpeed: 215,
    accel: 1.1,
    handling: 0.78,
    desc: 'Muscle car americano. Brutal, ruidoso, drifts largos.',
  },
];

const STORAGE_BEST = 'carreritas3dBest';

// ---------- STATE ----------
let renderer, scene, camera;
let car = null;            // THREE.Object3D (the loaded model)
let carMeshes = [];        // meshes for color tinting
let clock;
let selectedCarIdx = 0;
let selectedColor = 0xff2e63;   // player-chosen car color
let inGame = false;
let gameStarted = false;

// Paleta de colores seleccionables
const COLOR_PALETTE = [
  0xff2e63, // rosa neón
  0xc4212c, // rojo
  0xff8a1a, // naranja
  0xffd23f, // amarillo
  0x4ade80, // verde
  0x06b6d4, // cyan
  0x4d8eff, // azul
  0x8b5cf6, // morado
  0x1a1a2e, // negro
  0xeeeeee, // blanco
  0xc0c0c0, // plata
  0xff69b4, // rosa chicle
];

// Track
const trackPoints = [];        // THREE.Vector3 of track centerline (loop)
const trackLength = 0;         // total length (computed)
let trackLengths = [];         // cumulative length at each point
const checkpoints = [];        // mid-line markers, sorted
const totalLaps = 3;
let currentLap = 1;
let lastCheckpointIdx = -1;

// Input
const keys = {};
let touchLeft = false, touchRight = false, touchUp = false, touchDown = false;
let touchNitro = false;

// ---------- NITRO SYSTEM ----------
let nitro = 1.0;             // 0..1
let nitroActive = false;     // está activado?
let nitroWasActive = false;  // para detectar transición
const NITRO_DRAIN = 0.35;    // por segundo cuando activo
const NITRO_REGEN = 0.10;    // por segundo cuando inactivo
const NITRO_BOOST = 1.7;     // multiplicador de aceleración

// ---------- DRIFT PARTICLES ----------
const driftParticles = [];   // { mesh, life, vx, vy, vz }

// Physics
const physics = {
  speed: 0,           // current scalar speed
  heading: 0,         // yaw angle (rad)
  pos: new THREE.Vector3(0, 0, 0),
  steer: 0,           // current steering angle (smoothed)
  handbrake: false,
};

// Timing
let lapStartTime = 0;
let bestTime = null;
let bestTimeStr = '--:--.---';
loadBest();

function loadBest() {
  try {
    const v = localStorage.getItem(STORAGE_BEST);
    if (v) {
      bestTime = parseFloat(v);
      bestTimeStr = formatTime(bestTime);
    }
  } catch (e) {}
  bestTimeEl.textContent = bestTimeStr;
  bestTimeEndEl.textContent = bestTimeStr;
}
function saveBest(t) {
  try { localStorage.setItem(STORAGE_BEST, String(t)); } catch (e) {}
  bestTime = t;
  bestTimeStr = formatTime(t);
  bestTimeEl.textContent = bestTimeStr;
  bestTimeEndEl.textContent = bestTimeStr;
}
function formatTime(ms) {
  if (ms == null) return '--:--.---';
  const totalMs = Math.floor(ms);
  const m = Math.floor(totalMs / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const mil = totalMs % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(mil).padStart(3, '0')}`;
}

// ---------- CAR SELECTOR UI ----------
function buildCarGrid() {
  carGrid.innerHTML = '';
  CARS.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'car-card' + (i === selectedCarIdx ? ' selected' : '');
    card.dataset.idx = i;
    card.innerHTML = `
      <div class="car-card__emoji">${c.emoji}</div>
      <div class="car-card__name">${c.name}</div>
      <div class="car-card__sub">${c.sub}</div>
    `;
    card.addEventListener('click', () => {
      selectedCarIdx = i;
      updateCarSelection();
    });
    carGrid.appendChild(card);
  });
}
function buildColorSwatches() {
  const wrap = $('colorSwatches');
  if (!wrap) return;
  wrap.innerHTML = '';
  COLOR_PALETTE.forEach((color, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === 0 ? ' swatch--active' : '');
    sw.dataset.idx = i;
    const hex = '#' + color.toString(16).padStart(6, '0');
    sw.style.background = hex;
    sw.style.setProperty('--swatch-glow', hex);
    sw.title = hex;
    sw.addEventListener('click', () => {
      selectedColor = color;
      updateColorSwatches();
      // Si ya estamos en juego, aplicar al instante al carro cargado
      if (car) {
        applyColorToCar(car, selectedColor);
        // Forzar re-tint de meshes cacheados
        carMeshes.forEach(m => {
          if (m.material && m.material.color && !m.material.map) {
            m.material.color.set(selectedColor);
          }
        });
      }
    });
    wrap.appendChild(sw);
  });
}
function updateColorSwatches() {
  const wrap = $('colorSwatches');
  if (!wrap) return;
  Array.from(wrap.children).forEach((sw, i) => {
    const c = COLOR_PALETTE[i];
    sw.classList.toggle('swatch--active', c === selectedColor);
  });
}
function updateCarSelection() {
  Array.from(carGrid.children).forEach((c, i) => {
    c.classList.toggle('selected', i === selectedCarIdx);
  });
  const c = CARS[selectedCarIdx];
  carNameEl.textContent = c.name;
  carDescEl.textContent = c.desc;
  statSpeedEl.style.width = (c.maxSpeed / 230 * 100) + '%';
  statAccelEl.style.width = (c.accel * 90) + '%';
  statHandlingEl.style.width = (c.handling * 100) + '%';
}

// ---------- INITIALIZE ----------
function init() {
  try {
  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b3d8);   // sky blue
  scene.fog = new THREE.Fog(0x87b3d8, 200, 600);

  // Camera — más cerca y con FOV más amplio para sensación de velocidad
  camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1500);
  camera.position.set(0, 5, -10);
  camera.lookAt(0, 0, 0);

  // Lights
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(80, 120, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -200;
  sun.shadow.camera.right = 200;
  sun.shadow.camera.top = 200;
  sun.shadow.camera.bottom = -200;
  sun.shadow.camera.far = 400;
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0x87b3d8, 0x4a3a2a, 0.7);
  scene.add(hemi);

  // Environment
  buildEnvironment();
  buildTrack();
  buildStartBanner();

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);
  onResize();
  } catch (e) {
    console.error('Init failed:', e);
    showFatalError('Error al iniciar 3D: ' + e.message + '. Tu navegador podría no soportar WebGL.');
  }
}

function showFatalError(msg) {
  // loadingEl eliminado
  let errEl = document.getElementById('fatalError');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = 'fatalError';
    errEl.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;background:rgba(10,5,20,0.95);color:#ff5577;font-family:sans-serif;padding:24px;z-index:9999;flex-direction:column;gap:12px;';
    errEl.innerHTML = '<h2 style="color:#ff2e63;font-size:24px;">⚠️ Error</h2><p style="max-width:500px;"></p>';
    document.body.appendChild(errEl);
  }
  errEl.querySelector('p').textContent = msg;
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // minimap crisp on resize
  minimapCanvas.width = minimapCanvas.clientWidth;
  minimapCanvas.height = minimapCanvas.clientHeight;
}

// ---------- ENVIRONMENT (sky, ground, props) ----------
function buildEnvironment() {
  // Ground (large plane)
  const groundGeo = new THREE.PlaneGeometry(2000, 2000, 1, 1);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x4a6a3a, roughness: 0.95 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // Distant mountains (cones)
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2;
    const dist = 600 + Math.random() * 100;
    const h = 80 + Math.random() * 80;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(40 + Math.random() * 20, h, 6),
      new THREE.MeshStandardMaterial({ color: 0x6a7a8a, roughness: 0.9 })
    );
    cone.position.set(Math.cos(angle) * dist, h / 2 - 5, Math.sin(angle) * dist);
    scene.add(cone);
  }

  // Trees scattered around
  for (let i = 0; i < 200; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * 400;
    // Avoid placing inside the track
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    if (isInsideTrack(x, z, 30)) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1.5, 5, 6),
      new THREE.MeshStandardMaterial({ color: 0x4a2a1a, roughness: 0.9 })
    );
    trunk.position.y = 2.5;
    trunk.castShadow = true;
    tree.add(trunk);
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(4, 8, 7),
      new THREE.MeshStandardMaterial({ color: 0x2a5a2a, roughness: 0.9 })
    );
    leaves.position.y = 9;
    leaves.castShadow = true;
    tree.add(leaves);
    tree.position.set(x, 0, z);
    scene.add(tree);
  }
}

function buildStartBanner() {
  // A simple arch over the start/finish line
  const startIdx = 0;
  const p = trackPoints[startIdx];
  const next = trackPoints[(startIdx + 1) % trackPoints.length];
  const dir = new THREE.Vector3().subVectors(next, p).setY(0).normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);

  const banner = new THREE.Group();
  // Posts
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    post.position.copy(p).addScaledVector(perp, side * 8);
    post.position.y = 5;
    post.castShadow = true;
    banner.add(post);
  }
  // Top bar
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(20, 1.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0xff2e63, emissive: 0xff2e63, emissiveIntensity: 0.4 })
  );
  top.position.copy(p);
  top.position.y = 10;
  banner.add(top);

  // Checkered pattern on ground at start
  const checker = new THREE.Group();
  for (let i = -6; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      const sq = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshStandardMaterial({
          color: (i + j) % 2 === 0 ? 0xffffff : 0x111111,
          roughness: 0.6
        })
      );
      sq.rotation.x = -Math.PI / 2;
      sq.position.copy(p).addScaledVector(perp, i * 2).addScaledVector(dir, j * 2 - 3);
      sq.position.y = 0.02;
      checker.add(sq);
    }
  }
  banner.add(checker);
  scene.add(banner);
}

// ---------- TRACK ----------
// Closed loop defined as series of centerline points
function buildTrack() {
  // Design an organic circuit (oval-ish with curves)
  const N = 64;
  const cx = 0, cz = 0;
  const a = 180, b = 110; // ellipse axes
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    // Add some waviness
    const wobble = Math.sin(t * 3) * 12 + Math.cos(t * 2) * 8;
    const x = cx + (a + wobble) * Math.cos(t);
    const z = cz + (b + wobble * 0.7) * Math.sin(t);
    trackPoints.push(new THREE.Vector3(x, 0, z));
  }
  // Compute cumulative length
  trackLengths = [0];
  for (let i = 1; i <= trackPoints.length; i++) {
    const a = trackPoints[(i - 1) % trackPoints.length];
    const b = trackPoints[i % trackPoints.length];
    trackLengths.push(trackLengths[i - 1] + a.distanceTo(b));
  }
  // checkpoints every 1/8 of track
  const cpCount = 8;
  for (let i = 0; i < cpCount; i++) {
    checkpoints.push({ index: Math.floor((i + 0.5) * N / cpCount), passed: false });
  }

  // Build track mesh
  const trackWidth = 16;
  const innerPoints = [];
  const outerPoints = [];
  for (let i = 0; i < trackPoints.length; i++) {
    const cur = trackPoints[i];
    const next = trackPoints[(i + 1) % trackPoints.length];
    const dir = new THREE.Vector3().subVectors(next, cur).setY(0).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    innerPoints.push(cur.clone().addScaledVector(perp, -trackWidth / 2));
    outerPoints.push(cur.clone().addScaledVector(perp, trackWidth / 2));
  }
  // Asphalt ribbon
  const positions = [];
  const indices = [];
  for (let i = 0; i < trackPoints.length; i++) {
    const inner = innerPoints[i];
    const outer = outerPoints[i];
    const base = positions.length / 3;
    positions.push(inner.x, 0.01, inner.z);
    positions.push(outer.x, 0.01, outer.z);
    indices.push(base, base + 1, (base + 2) % (trackPoints.length * 2));
    indices.push(base + 1, (base + 3) % (trackPoints.length * 2), (base + 2) % (trackPoints.length * 2));
  }
  const trackGeo = new THREE.BufferGeometry();
  trackGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  trackGeo.setIndex(indices);
  trackGeo.computeVertexNormals();
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 });
  const trackMesh = new THREE.Mesh(trackGeo, trackMat);
  trackMesh.receiveShadow = true;
  scene.add(trackMesh);

  // White edge lines
  for (const side of [innerPoints, outerPoints]) {
    const linePts = side.map(p => new THREE.Vector3(p.x, 0.05, p.z));
    linePts.push(linePts[0].clone());
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    scene.add(new THREE.Line(lineGeo, lineMat));
  }

  // Center dashed line
  for (let i = 0; i < trackPoints.length; i += 3) {
    if (i + 1 >= trackPoints.length) break;
    const a = trackPoints[i], b = trackPoints[(i + 1) % trackPoints.length];
    const dashGeo = new THREE.BufferGeometry().setFromPoints([a, b]);
    scene.add(new THREE.Line(dashGeo, new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 2 })));
  }

  // Curbs (red/white) at intervals along the outside
  for (let i = 0; i < trackPoints.length; i += 5) {
    const cur = trackPoints[i];
    const next = trackPoints[(i + 1) % trackPoints.length];
    const dir = new THREE.Vector3().subVectors(next, cur).setY(0).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    const isRed = (Math.floor(i / 5)) % 2 === 0;
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.4, 4),
        new THREE.MeshStandardMaterial({ color: isRed ? 0xff2e2e : 0xffffff })
      );
      curb.position.copy(cur).addScaledVector(perp, side * (8 + 0.5));
      curb.position.y = 0.2;
      scene.add(curb);
    }
  }

  // Barriers (walls) along outside
  for (let i = 0; i < trackPoints.length; i++) {
    const cur = trackPoints[i];
    const next = trackPoints[(i + 1) % trackPoints.length];
    const dir = new THREE.Vector3().subVectors(next, cur).setY(0).normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x);
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 1.2, dir.length() * 0.95),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee })
      );
      wall.position.copy(cur).addScaledVector(perp, side * 9);
      wall.position.y = 0.6;
      wall.castShadow = true;
      scene.add(wall);
    }
  }
}

function isInsideTrack(x, z, margin = 0) {
  // Quick check: find closest track point, if distance < margin inside the track band, return true
  let minDist = Infinity;
  for (let i = 0; i < trackPoints.length; i++) {
    const a = trackPoints[i];
    const b = trackPoints[(i + 1) % trackPoints.length];
    // Segment distance
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3(x - a.x, 0, z - a.z);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
    const proj = a.clone().addScaledVector(ab, t);
    const d = Math.hypot(x - proj.x, z - proj.z);
    if (d < minDist) minDist = d;
  }
  return minDist < 8 - margin;
}

function getClosestTrackInfo(x, z) {
  // Returns {index, distance, point, nextPoint, dir}
  let minDist = Infinity;
  let info = null;
  for (let i = 0; i < trackPoints.length; i++) {
    const a = trackPoints[i];
    const b = trackPoints[(i + 1) % trackPoints.length];
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3(x - a.x, 0, z - a.z);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
    const proj = a.clone().addScaledVector(ab, t);
    const d = Math.hypot(x - proj.x, z - proj.z);
    if (d < minDist) {
      minDist = d;
      const dir = ab.clone().normalize();
      info = { index: i, distance: d, point: proj, dir };
    }
  }
  return info;
}

// ---------- CAR LOADING ----------
function loadCar(carDef, onLoaded) {
  // Override color with player's selection
  const def = { ...carDef, color: selectedColor };
  // If no file specified, use fallback immediately
  if (!def.file) {
    onLoaded(makeFallbackCar(def));
    return;
  }
  const loader = new GLTFLoader();
  loader.load(
    carDef.file,
    (gltf) => {
      const obj = gltf.scene;
      // Normalize scale and orientation
      // Compute bbox to center
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      // Center model on origin
      obj.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
      // Some cars come in huge; normalize max dim to ~4 units
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 4.0 / maxDim;
      obj.scale.multiplyScalar(scale);
      // Apply color tint to all meshes that don't have a texture-defined material
      carMeshes = [];
      obj.traverse((child) => {
        if (child.isMesh) {
          carMeshes.push(child);
          if (child.material && child.material.color) {
            // Don't override if the material has a map (texture)
            if (!child.material.map) {
              child.material.color.set(selectedColor);
            }
          }
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      onLoaded(obj);
    },
    undefined,
    (err) => {
      console.error('Error loading car model', carDef.file, err);
      // Fallback: simple box car
      const fallback = makeFallbackCar(carDef);
      onLoaded(fallback);
    }
  );
}

function applyColorToCar(obj, colorHex) {
  if (!obj) return;
  obj.traverse((child) => {
    if (child.isMesh && child.material && child.material.color) {
      // No sobrescribir si tiene textura (igual que el GLB loader)
      if (!child.material.map) {
        child.material.color.set(colorHex);
      }
    }
  });
}

function makeFallbackCar(def) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.8, 4),
    new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.5, roughness: 0.4 })
  );
  body.position.y = 0.7;
  body.castShadow = true;
  g.add(body);
  // Roof
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.7, 2),
    new THREE.MeshStandardMaterial({ color: def.color, metalness: 0.5, roughness: 0.4 })
  );
  roof.position.set(0, 1.4, -0.3);
  roof.castShadow = true;
  g.add(roof);
  // Wheels
  for (const dx of [-0.9, 0.9]) {
    for (const dz of [-1.3, 1.3]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12),
        new THREE.MeshStandardMaterial({ color: 0x111111 })
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(dx, 0.4, dz);
      g.add(wheel);
    }
  }
  return g;
}

// ---------- INPUT ----------
function bindInput() {
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  // Mobile buttons
  const setTouchKey = (key, pressed) => {
    if (key === 'ArrowLeft') touchLeft = pressed;
    if (key === 'ArrowRight') touchRight = pressed;
    if (key === 'ArrowUp') touchUp = pressed;
    if (key === 'ArrowDown') touchDown = pressed;
    if (key === 'ShiftLeft' || key === 'ShiftRight') touchNitro = pressed;
  };
  document.querySelectorAll('.pad__btn').forEach(btn => {
    const key = btn.dataset.key;
    const press = (e) => { e.preventDefault(); setTouchKey(key, true); btn.classList.add('active'); };
    const release = (e) => { e.preventDefault(); setTouchKey(key, false); btn.classList.remove('active'); };
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
    btn.addEventListener('touchcancel', release, { passive: false });
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', release);
  });
}

function isKey(code) {
  return !!keys[code] || (code === 'ArrowLeft' && touchLeft) || (code === 'ArrowRight' && touchRight) || (code === 'ArrowUp' && touchUp) || (code === 'ArrowDown' && touchDown) || ((code === 'ShiftLeft' || code === 'ShiftRight') && touchNitro);
}

// ---------- GAME FLOW ----------
// ELIMINADO: loader killer, watchdog, loadingEl. El loader ya no existe.

function startGame() {
  // Loader eliminado: entramos directo al juego
  const carDef = CARS[selectedCarIdx];

  // Reset state
  if (car) {
    scene.remove(car);
    car = null;
  }

  currentLap = 1;
  lastCheckpointIdx = -1;
  checkpoints.forEach(cp => cp.passed = false);

  // Show fallback car IMMEDIATELY so the game starts right away
  const fallback = makeFallbackCar(carDef);
  placeCarOnTrack(fallback);
  scene.add(fallback);
  car = fallback;

  // Loader eliminado: no hay nada que ocultar
  menu.hidden = true;
  finishScreen.hidden = true;
  hud.hidden = false;
  if (isMobileDevice()) mobileControls.hidden = false;
  inGame = true;
  gameStarted = false;
  lapStartTime = performance.now();
  updateHUD();

  // Then asynchronously load the real .glb and replace when ready
  loadCar(carDef, (loaded) => {
    // Only swap if user hasn't left the game
    if (!inGame) {
      return;
    }
    if (car === fallback) {
      scene.remove(car);
    }
    placeCarOnTrack(loaded);
    scene.add(loaded);
    car = loaded;
  });
}

function placeCarOnTrack(carObj) {
  const start = trackPoints[0].clone();
  const next = trackPoints[1].clone();
  const dir = new THREE.Vector3().subVectors(next, start).setY(0).normalize();
  carObj.position.copy(start);
  carObj.position.y = 0.05;
  carObj.rotation.y = Math.atan2(dir.x, dir.z);
  physics.pos.copy(carObj.position);
  physics.heading = carObj.rotation.y;
  physics.speed = 0;
  physics.steer = 0;
  // Camera initial pos
  const camOffset = new THREE.Vector3(-dir.x * 12, 6, -dir.z * 12);
  camera.position.copy(start).add(camOffset);
  camera.lookAt(start);
}

function endLap() {
  const now = performance.now();
  const lapTime = now - lapStartTime;
  const isNewBest = bestTime == null || lapTime < bestTime;
  if (isNewBest) saveBest(lapTime);

  $('finalTime').textContent = formatTime(lapTime);
  bestTimeEndEl.textContent = bestTimeStr;

  inGame = false;
  hud.hidden = true;
  mobileControls.hidden = true;
  finishScreen.hidden = false;
  launchConfetti();  // 🎉 confetti!

  // reset for replay
  currentLap = 1;
  checkpoints.forEach(cp => cp.passed = false);
}

function backToMenu() {
  inGame = false;
  hud.hidden = true;
  mobileControls.hidden = true;
  finishScreen.hidden = true;
  menu.hidden = false;
}

// ---------- NITRO ----------
function updateNitro(dt) {
  // dt está en unidades de 60fps (~1.0). Convertir a segundos: /60.
  const dtSec = dt / 60;
  if (nitroActive) {
    nitro = Math.max(0, nitro - NITRO_DRAIN * dtSec);
  } else {
    nitro = Math.min(1, nitro + NITRO_REGEN * dtSec);
  }
}

let nitroFlashTimer = 0;
function triggerNitroFlash() {
  const el = document.getElementById('nitroFlash');
  if (!el) return;
  el.hidden = false;
  el.style.animation = 'none';
  // force reflow
  void el.offsetWidth;
  el.style.animation = 'nitroFlash 0.4s ease-out';
  clearTimeout(nitroFlashTimer);
  nitroFlashTimer = setTimeout(() => { el.hidden = true; }, 400);
}

function updateNitroUI() {
  const fill = document.getElementById('nitroFill');
  const label = document.querySelector('.nitro-label');
  if (fill) {
    fill.style.width = (nitro * 100) + '%';
    if (nitroActive) {
      fill.style.backgroundPosition = '100% 0%';
    } else {
      fill.style.backgroundPosition = (100 - nitro * 100) + '% 0%';
    }
  }
  if (label) {
    if (nitroActive) label.classList.add('nitro-label--active');
    else label.classList.remove('nitro-label--active');
  }
}

// ---------- DRIFT PARTICLES ----------
function spawnDriftParticle() {
  if (!car || Math.abs(physics.speed) < 5) return;
  // Spawn detrás de las ruedas traseras
  const back = new THREE.Vector3(-Math.sin(physics.heading), 0, -Math.cos(physics.heading));
  const side = new THREE.Vector3(-Math.cos(physics.heading), 0, Math.sin(physics.heading));
  const basePos = new THREE.Vector3(physics.pos.x, physics.pos.y + 0.3, physics.pos.z);
  // 2 ruedas traseras
  for (const s of [-0.9, 0.9]) {
    const p = basePos.clone().addScaledVector(back, 1.4).addScaledVector(side, s);
    const geo = new THREE.PlaneGeometry(0.6, 0.6);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xeeeeee, transparent: true, opacity: 0.7,
      depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(p);
    mesh.rotation.x = -Math.PI / 2;
    // Rotación random
    mesh.rotation.z = Math.random() * Math.PI;
    scene.add(mesh);
    driftParticles.push({
      mesh,
      life: 0.8,
      maxLife: 0.8,
      vx: (Math.random() - 0.5) * 1.5,
      vy: Math.random() * 0.5,
      vz: (Math.random() - 0.5) * 1.5,
    });
  }
}

let driftSpawnTimer = 0;
function updateDriftParticles(dt) {
  const dtSec = dt / 60;
  // Spawn rate según drift (handbrake) o velocidad alta
  const drifting = physics.handbrake && Math.abs(physics.speed) > 5;
  const fast = Math.abs(physics.speed) > 12;
  driftSpawnTimer += dtSec;
  if ((drifting || (fast && Math.abs(physics.steer) > 0.3)) && driftSpawnTimer > 0.05) {
    spawnDriftParticle();
    driftSpawnTimer = 0;
  }
  // Update existing
  for (let i = driftParticles.length - 1; i >= 0; i--) {
    const p = driftParticles[i];
    p.life -= dtSec;
    p.mesh.position.x += p.vx * dtSec;
    p.mesh.position.y += p.vy * dtSec;
    p.mesh.position.z += p.vz * dtSec;
    p.mesh.material.opacity = (p.life / p.maxLife) * 0.7;
    p.mesh.scale.setScalar(0.6 + (1 - p.life / p.maxLife) * 0.8);
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      driftParticles.splice(i, 1);
    }
  }
}

// ---------- CONFETTI ----------
function launchConfetti() {
  const layer = document.getElementById('confettiLayer');
  if (!layer) return;
  layer.innerHTML = '';
  const colors = ['#ff2e63', '#00fff0', '#4d8eff', '#ff8a1a', '#4ade80', '#ffd23f', '#8b5cf6'];
  for (let i = 0; i < 80; i++) {
    const el = document.createElement('div');
    el.className = 'confetti';
    el.style.left = (Math.random() * 100) + '%';
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = (2 + Math.random() * 2.5) + 's';
    el.style.animationDelay = (Math.random() * 0.8) + 's';
    el.style.transform = 'rotate(' + (Math.random() * 360) + 'deg)';
    layer.appendChild(el);
  }
  // Limpiar después
  setTimeout(() => { if (layer) layer.innerHTML = ''; }, 5500);
}

// ---------- UPDATE LOOP ----------
let last = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(50, now - last) / 16.6667; // dt in 60fps units (~1.0)
  last = now;

  if (inGame) {
    updateNitro(dt);
    updatePhysics(dt);
    updateCamera();
    updateDriftParticles(dt);
    updateNitroUI();
    // Trigger flash when nitro first becomes active
    if (nitroActive && !nitroWasActive) {
      triggerNitroFlash();
    }
    nitroWasActive = nitroActive;
    updateCheckpointCheck();
    updateHUD();
    drawMinimap();
  }

  renderer.render(scene, camera);
}

function updatePhysics(dt) {
  if (!car) return;
  const def = CARS[selectedCarIdx];

  // Start timer when first input
  if (!gameStarted && (isKey('KeyW') || isKey('ArrowUp') || isKey('KeyS') || isKey('ArrowDown'))) {
    gameStarted = true;
  }

  // Inputs
  const gas = (isKey('KeyW') || isKey('ArrowUp')) ? 1 : 0;
  const brake = (isKey('KeyS') || isKey('ArrowDown')) ? 1 : 0;
  const leftInput = (isKey('KeyA') || isKey('ArrowLeft')) ? 1 : 0;
  const rightInput = (isKey('KeyD') || isKey('ArrowRight')) ? 1 : 0;
  physics.handbrake = !!isKey('Space');
  // Nitro: Shift cuando hay nitro disponible
  const nitroInput = isKey('ShiftLeft') || isKey('ShiftRight');
  nitroActive = nitroInput && nitro > 0.05 && gas > 0;

  // Speed: throttle adds, brake subtracts, friction always
  const maxSpd = def.maxSpeed;
  let accelForce = def.accel * 0.5;
  if (nitroActive) accelForce *= NITRO_BOOST;
  // Nitro: aumenta maxSpd también (top speed boost)
  const effectiveMaxSpd = nitroActive ? maxSpd * 1.25 : maxSpd;
  if (gas) physics.speed = Math.min(effectiveMaxSpd, physics.speed + accelForce * dt);
  if (brake) physics.speed = Math.max(-maxSpd * 0.3, physics.speed - accelForce * 1.5 * dt);

  // Friction (more grippy than rolling)
  const friction = 0.015;
  if (!gas && !brake) physics.speed *= (1 - friction);
  if (physics.handbrake) physics.speed *= (1 - 0.04);

  // Steering: target steer angle scaled by speed (less at very low speed)
  const speedFactor = Math.min(1, Math.abs(physics.speed) / 20);
  const maxSteer = 0.7;
  let targetSteer = 0;
  if (leftInput) targetSteer += maxSteer;
  if (rightInput) targetSteer -= maxSteer;
  targetSteer *= def.handling;
  // Smooth
  physics.steer += (targetSteer - physics.steer) * Math.min(1, 0.18 * dt);

  // Yaw
  // Reverse direction of steering when going backward
  const dir = physics.speed >= 0 ? 1 : -1;
  const yawRate = (physics.steer * speedFactor * 0.045) * dir;
  // Handbrake increases yaw rate (drift feel)
  const yawBoost = physics.handbrake ? 1.6 : 1.0;
  physics.heading += yawRate * yawBoost * dt * 60 / 60;

  // Move
  const forward = new THREE.Vector3(Math.sin(physics.heading), 0, Math.cos(physics.heading));
  // Note: +Z is "forward" in default three.js for our coord system
  // physics.heading = 0 should mean looking at +Z
  const moveVec = forward.clone().multiplyScalar(physics.speed * 0.05 * dt);
  physics.pos.add(moveVec);

  // Keep on ground (y=0.05)
  physics.pos.y = 0.05;

  // Track bounds: push back to center if too far
  const trackInfo = getClosestTrackInfo(physics.pos.x, physics.pos.z);
  if (trackInfo && trackInfo.distance > 8.2) {
    // Bounce back
    const toCenter = new THREE.Vector3(trackInfo.point.x - physics.pos.x, 0, trackInfo.point.z - physics.pos.z).normalize();
    physics.pos.x += toCenter.x * 0.4;
    physics.pos.z += toCenter.z * 0.4;
    physics.speed *= 0.85;
  }

  // Apply to model
  car.position.copy(physics.pos);
  car.rotation.y = physics.heading;

  // Wheel spin effect (visual) - if we have fallback wheels
  car.traverse((c) => {
    if (c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry') {
      c.rotation.x += physics.speed * 0.05 * dt;
    }
  });
}

function updateCamera() {
  // Chase camera: MUY cerca del carro para sensación de velocidad
  // La cámara se aleja un poco a baja velocidad y se pega al carro a alta velocidad
  const speedFactor = Math.min(physics.speed / 60, 1);  // 0 a 1
  const dist = 6.5 - speedFactor * 0.8;                  // 6.5 a 5.7
  const height = 3.2 - speedFactor * 0.4;                // 3.2 a 2.8
  const back = new THREE.Vector3(-Math.sin(physics.heading), 0, -Math.cos(physics.heading));
  const desired = new THREE.Vector3(
    physics.pos.x + back.x * dist,
    physics.pos.y + height,
    physics.pos.z + back.z * dist
  );
  // Smooth interpolation
  camera.position.lerp(desired, 0.18);
  // Slight look-ahead (más lejano a alta velocidad)
  const lookAhead = 3 + speedFactor * 3;
  const lookAt = new THREE.Vector3(
    physics.pos.x + Math.sin(physics.heading) * lookAhead,
    physics.pos.y + 1.2,
    physics.pos.z + Math.cos(physics.heading) * lookAhead
  );
  camera.lookAt(lookAt);
  // FOV dinámico: se abre con la velocidad
  const targetFov = 85 + speedFactor * 8;  // 85 a 93
  camera.fov += (targetFov - camera.fov) * 0.1;
  camera.updateProjectionMatrix();
}

function updateCheckpointCheck() {
  if (!gameStarted) return;
  // current checkpoint should be one more than last passed
  const expectedCp = (lastCheckpointIdx + 1) % checkpoints.length;
  const cp = checkpoints[expectedCp];
  const cpCenter = trackPoints[cp.index];
  // Distance from car to cp center
  const d = Math.hypot(physics.pos.x - cpCenter.x, physics.pos.z - cpCenter.z);
  if (d < 10) {
    cp.passed = true;
    lastCheckpointIdx = expectedCp;
    showCheckpointMsg('✓ Checkpoint ' + (lastCheckpointIdx + 1));
  }
  // Check if all checkpoints passed and back near start
  if (lastCheckpointIdx === checkpoints.length - 1) {
    const startD = Math.hypot(physics.pos.x - trackPoints[0].x, physics.pos.z - trackPoints[0].z);
    if (startD < 12) {
      // Completed a lap
      if (currentLap >= totalLaps) {
        endLap();
        return;
      } else {
        currentLap++;
        lastCheckpointIdx = -1;
        checkpoints.forEach(cp => cp.passed = false);
        showCheckpointMsg('🏁 VUELTA ' + currentLap + '/' + totalLaps);
      }
    }
  }
}

function showCheckpointMsg(text) {
  checkpointMsgEl.textContent = text;
  checkpointMsgEl.hidden = false;
  checkpointMsgEl.style.animation = 'none';
  // Force reflow
  void checkpointMsgEl.offsetWidth;
  checkpointMsgEl.style.animation = '';
  clearTimeout(showCheckpointMsg._t);
  showCheckpointMsg._t = setTimeout(() => { checkpointMsgEl.hidden = true; }, 1500);
}

function updateHUD() {
  lapEl.textContent = currentLap + '/' + totalLaps;
  if (gameStarted) {
    const elapsed = performance.now() - lapStartTime;
    timeEl.textContent = formatTime(elapsed);
  } else {
    timeEl.textContent = '00:00.000';
  }
  const kmh = Math.abs(physics.speed) * 2.2;
  speedEl.textContent = Math.floor(kmh) + ' km/h';
}

function drawMinimap() {
  const ctx = minimapCtx;
  const w = minimapCanvas.width, h = minimapCanvas.height;
  ctx.clearRect(0, 0, w, h);
  // Background
  ctx.fillStyle = 'rgba(20, 30, 50, 0.5)';
  ctx.fillRect(0, 0, w, h);

  // Compute track bounds
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of trackPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const pad = 20;
  const scaleX = (w - pad * 2) / (maxX - minX);
  const scaleZ = (h - pad * 2) / (maxZ - minZ);
  const scale = Math.min(scaleX, scaleZ);
  const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
  const oz = (h - (maxZ - minZ) * scale) / 2 - minZ * scale;

  // Track line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  trackPoints.forEach((p, i) => {
    const x = p.x * scale + ox, z = p.z * scale + oz;
    if (i === 0) ctx.moveTo(x, z);
    else ctx.lineTo(x, z);
  });
  ctx.closePath();
  ctx.stroke();

  // Start line indicator
  const sp = trackPoints[0];
  ctx.fillStyle = '#ff2e63';
  ctx.beginPath();
  ctx.arc(sp.x * scale + ox, sp.z * scale + oz, 4, 0, Math.PI * 2);
  ctx.fill();

  // Car dot
  ctx.fillStyle = '#00d9ff';
  ctx.beginPath();
  ctx.arc(physics.pos.x * scale + ox, physics.pos.z * scale + oz, 5, 0, Math.PI * 2);
  ctx.fill();
  // Direction indicator
  ctx.strokeStyle = '#00d9ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(physics.pos.x * scale + ox, physics.pos.z * scale + oz);
  ctx.lineTo(
    physics.pos.x * scale + ox + Math.sin(physics.heading) * 10,
    physics.pos.z * scale + oz + Math.cos(physics.heading) * 10
  );
  ctx.stroke();
}

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

// ---------- START ----------
$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('menuBtn').addEventListener('click', backToMenu);

init();
buildCarGrid();
buildColorSwatches();
updateCarSelection();
bindInput();
loop();

// Auto-fade minimap bg every frame is fine, it's lightweight
console.log('%c🏎️ Carreritas 3D listo', 'color:#ff2e63;font-size:16px;font-weight:bold;');

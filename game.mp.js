/* =====================================================================
 *  CARRERITAS 3D — Three.js racing game  (MP version)
 * ===================================================================== */
console.log('[mp] module top, before imports');

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

console.log('[mp] imports done, THREE=' + (typeof THREE) + ', GLTFLoader=' + (typeof GLTFLoader));

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const lobbyEl = $('lobby');
const menu = $('menu');
const hud = $('hud');
const finishScreen = $('finishScreen');
const countdownEl = $('countdown');
const countdownNumEl = $('countdownNum');
const leaderboardEl = $('leaderboard');
const leaderboardRowsEl = $('leaderboardRows');
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

// Track

// ---------- STATE ----------
let renderer, scene, camera;
let localCar = null;       // THREE.Object3D (the local player)
let carMeshes = [];        // meshes for color tinting
let clock;
let selectedCarIdx = 0;
let selectedColor = 0xff2e63;   // player-chosen car color
let inGame = false;
let gameStarted = false;

// ---------- MULTIPLAYER STATE ----------
const mp = {
  peer: null,            // MP API instance
  myId: null,
  isHost: false,
  roster: [],            // [{id, name, carId, color, isHost, ready, finished, finishTime, position}]
  players: new Map(),    // id -> { obj, fallback, def, color, isLocal, lastState, lastStateTime, targetPos, targetHeading, laps, lastCheckpointIdx, lapStartTime, finished, finishTime, lastInterpT }
  countdownT: 0,         // seconds left in countdown
  countdownActive: false,
  raceStartedAt: 0,
  lastSendT: 0,
  finishOrder: [],       // array of player ids in order of finish
};

// ---------- BEST TIME (still tracked, per host) ----------
const STORAGE_BEST_MP = 'carreritas3dBestMP';

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
    const v = localStorage.getItem(STORAGE_BEST_MP);
    if (v) {
      bestTime = parseFloat(v);
      bestTimeStr = formatTime(bestTime);
    }
  } catch (e) {}
  bestTimeEl.textContent = bestTimeStr;
  bestTimeEndEl.textContent = bestTimeStr;
}
function saveBest(t) {
  try { localStorage.setItem(STORAGE_BEST_MP, String(t)); } catch (e) {}
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
  console.log('[mp] init start');
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

  // Environment (pista, terreno, banner, etc.)
  buildEnvironment();
  buildTrack();
  buildStartBanner();

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);
  onResize();

  // Build car grid + color picker (mostrados en el menú MP)
  buildCarGrid();
  buildColorSwatches();
  updateCarSelection();
  bindInput();

  // Empezar mostrando el lobby de multiplayer
  console.log('[mp] calling showLobby');
  showLobby();
  console.log('[mp] init done');
  } catch (e) {
    console.error('[mp] Init failed:', e);
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

// ---------- MULTIPLAYER LOBBY + START ----------

function showLobby() {
  console.log('[mp] showLobby start');
  // UI: tabs
  lobbyEl.hidden = false;
  menu.hidden = true;
  hud.hidden = true;
  finishScreen.hidden = true;
  if (isMobileDevice()) mobileControls.hidden = true;
  leaderboardEl.hidden = true;

  // Tabs
  document.querySelectorAll('.mp-tab').forEach(t => {
    t.classList.toggle('mp-tab--active', t.dataset.tab === currentTab);
    t.onclick = () => {
      currentTab = t.dataset.tab;
      document.querySelectorAll('.mp-tab').forEach(x => x.classList.toggle('mp-tab--active', x === t));
      $('tabCreate').hidden = currentTab !== 'create';
      $('tabJoin').hidden = currentTab !== 'join';
    };
  });
  $('tabCreate').hidden = currentTab !== 'create';
  $('tabJoin').hidden = currentTab !== 'join';
  $('tabRoom').hidden = true;

  // Create button
  $('createBtn').onclick = async () => {
    const name = ($('hostName').value || '').trim() || 'Host';
    setStatus('createStatus', 'Conectando…', false);
    $('createBtn').disabled = true;
    try {
      const api = await MP.create({
        name,
        carId: selectedCarIdx,
        color: selectedColor,
      });
      mp.peer = api;
      mp.myId = api.id;
      mp.isHost = true;
      mp.roster = api.roster.slice();
      $('roomCode').textContent = api.code;
      $('roomCodeTag').textContent = api.code;
      $('playerCount').textContent = String(mp.roster.length);
      renderRoster();
      $('tabCreate').hidden = true;
      $('tabRoom').hidden = false;
      $('hostControls').hidden = false;
      $('clientWait').hidden = true;
      wireRosterHandlers();
    } catch (e) {
      setStatus('createStatus', e.message || 'Error al crear sala', true);
      $('createBtn').disabled = false;
    }
  };

  // Join button
  $('joinBtn').onclick = async () => {
    const name = ($('joinName').value || '').trim() || 'Cliente';
    const code = ($('joinCode').value || '').toUpperCase().trim();
    if (!code || code.length < 4) {
      setStatus('joinStatus', 'Código inválido', true);
      return;
    }
    setStatus('joinStatus', 'Conectando…', false);
    $('joinBtn').disabled = true;
    try {
      const api = await MP.join({
        code,
        name,
        carId: selectedCarIdx,
        color: selectedColor,
      });
      mp.peer = api;
      mp.myId = api.id;
      mp.isHost = false;
      mp.roster = api.roster.slice();
      $('roomCode').textContent = code;
      $('roomCodeTag').textContent = code;
      $('playerCount').textContent = String(mp.roster.length);
      renderRoster();
      $('tabJoin').hidden = true;
      $('tabRoom').hidden = false;
      $('hostControls').hidden = true;
      $('clientWait').hidden = false;
      wireRosterHandlers();
    } catch (e) {
      setStatus('joinStatus', e.message || 'Error al unirse', true);
      $('joinBtn').disabled = false;
    }
  };

  $('joinCode').oninput = (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  };

  // Start button (host only)
  $('startBtn').onclick = () => {
    if (!mp.isHost) return;
    if (mp.roster.length < 2) return;
    mp.peer.send({ type: 'start', countdown: 3, raceStartAt: performance.now() + 3500 });
    // host también inicia su propio countdown
    beginCountdown(3, performance.now() + 3500);
  };

  $('leaveBtn').onclick = () => {
    if (mp.peer) mp.peer.destroy();
    mp.peer = null;
    mp.roster = [];
    showLobby();
  };

  // Botón "VOLVER A SALA" en el menú de carro
  $('backToLobbyBtn').onclick = () => {
    menu.hidden = true;
    showLobby();
  };
  console.log('[mp] showLobby done');
}

let currentTab = 'create';
function setStatus(id, msg, isError) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
  el.classList.toggle('mp-error', isError);
}

function renderRoster() {
  $('roster').innerHTML = '';
  $('playerCount').textContent = String(mp.roster.length);
  $('playerCountTag').textContent = String(mp.roster.length);
  mp.roster.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'mp-roster__row';
    const isMe = r.id === mp.myId;
    row.innerHTML = `
      <div class="mp-roster__dot" style="background:#${r.color.toString(16).padStart(6, '0')};color:#${r.color.toString(16).padStart(6, '0')};"></div>
      <div class="mp-roster__name">${escapeHtml(r.name)}${isMe ? ' (tú)' : ''}</div>
      <div class="mp-roster__tag ${isMe ? 'mp-roster__tag--you' : (r.isHost ? 'mp-roster__tag--host' : '')}">${r.isHost ? 'HOST' : (isMe ? 'TÚ' : '')}</div>
    `;
    $('roster').appendChild(row);
  });

  // Update start button enabled state
  const startBtn = $('startBtn');
  if (mp.isHost) {
    startBtn.disabled = mp.roster.length < 2;
    startBtn.textContent = mp.roster.length < 2 ? 'NECESITAS +1 JUGADOR' : '🚀 EMPEZAR CARRERA';
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function wireRosterHandlers() {
  const api = mp.peer;
  api.on('roster', (roster) => {
    mp.roster = roster.slice();
    renderRoster();
  });
  api.on('peerJoin', (peer) => {
    // ya actualizamos via roster event, pero podemos mostrar un toast
    showToast(`${peer.name} se unió`);
  });
  api.on('peerLeave', (peer) => {
    if (peer.host) {
      showToast('Host se fue. Volviendo al lobby…', true);
      setTimeout(() => {
        if (mp.peer) mp.peer.destroy();
        mp.peer = null;
        mp.roster = [];
        showLobby();
      }, 1500);
    } else {
      showToast(`Jugador salió`);
    }
  });
  api.on('message', (msg) => {
    if (msg.type === 'start') {
      beginCountdown(msg.countdown, msg.raceStartAt);
    } else if (msg.type === 'state') {
      onRemoteState(msg);
    } else if (msg.type === 'lap-finish') {
      onRemoteFinish(msg);
    }
  });
  api.on('error', (err) => {
    setStatus('roomStatus', 'Error: ' + (err.message || err.type || 'desconocido'), true);
  });
}

function showToast(msg, isError) {
  // simple inline toast
  let t = $('mpToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'mpToast';
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(20,20,40,0.95);color:#fff;padding:10px 20px;border-radius:999px;font-size:14px;z-index:1000;border:1px solid rgba(255,255,255,0.1);font-family:sans-serif;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.borderColor = isError ? 'rgba(255,85,119,0.5)' : 'rgba(78,204,163,0.5)';
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2500);
}

// ---------- COUNTDOWN ----------

function beginCountdown(seconds, raceStartAt) {
  mp.countdownActive = true;
  mp.countdownT = seconds;
  mp.raceStartedAt = raceStartAt;
  countdownEl.hidden = false;
  countdownNumEl.textContent = String(Math.ceil(seconds));
}

function endCountdown() {
  mp.countdownActive = false;
  countdownEl.hidden = true;
  // Ahora sí empezar la carrera
  startRace();
}

// ---------- START RACE (called when countdown ends) ----------

function startRace() {
  // Resetear todos los players
  mp.players.forEach((p) => {
    p.laps = 0;
    p.lastCheckpointIdx = -1;
    p.finished = false;
    p.finishTime = 0;
  });
  mp.finishOrder = [];
  checkpoints.forEach(cp => cp.passed = false);
  currentLap = 1;
  lastCheckpointIdx = -1;
  gameStarted = false;

  // Construir todos los carros: local + remotos
  rebuildAllCars();

  // UI
  lobbyEl.hidden = true;
  menu.hidden = true;
  finishScreen.hidden = true;
  hud.hidden = false;
  leaderboardEl.hidden = false;
  if (isMobileDevice()) mobileControls.hidden = false;
  inGame = true;
  gameStarted = false;
  nitro = 1.0;
  nitroActive = false;
  nitroWasActive = false;
  lapStartTime = performance.now();
  updateHUD();
  updateLeaderboard();
}

function rebuildAllCars() {
  // Limpiar todos los carros
  mp.players.forEach((p) => {
    if (p.obj && p.obj.parent) p.obj.parent.remove(p.obj);
  });
  mp.players.clear();

  // Posiciones en grid en la línea de salida
  const start = trackPoints[0].clone();
  const next = trackPoints[1].clone();
  const dir = new THREE.Vector3().subVectors(next, start).setY(0).normalize();
  const perp = new THREE.Vector3(-dir.z, 0, dir.x);

  mp.roster.forEach((r, idx) => {
    const isLocal = r.id === mp.myId;
    const def = CARS[r.carId ?? 0] || CARS[0];
    const color = r.color ?? 0xffffff;
    const fallback = makeFallbackCar(def);
    applyColorToCar(fallback, color);

    // Posición en grid: separar por lane perpendicular
    // 2 carriles por fila, 2 filas para 4 jugadores
    const lane = (idx % 2) * 2 - 1; // -1 o 1
    const row = Math.floor(idx / 2);
    const offsetPerp = lane * 4;
    const offsetDir = row * -6;
    const pos = start.clone()
      .addScaledVector(perp, offsetPerp)
      .addScaledVector(dir, offsetDir);
    pos.y = 0.05;
    fallback.position.copy(pos);
    fallback.rotation.y = Math.atan2(dir.x, dir.z);
    scene.add(fallback);

    const player = {
      obj: fallback,
      fallback,
      def,
      color,
      isLocal,
      name: r.name,
      lastState: null,
      lastStateTime: 0,
      targetPos: pos.clone(),
      targetHeading: fallback.rotation.y,
      laps: 0,
      lastCheckpointIdx: -1,
      lapStartTime: performance.now(),
      finished: false,
      finishTime: 0,
      loadedCar: null,        // se reemplaza cuando carga el .glb
    };
    mp.players.set(r.id, player);

    if (isLocal) {
      localCar = fallback;
      physics.pos.copy(pos);
      physics.heading = fallback.rotation.y;
      physics.speed = 0;
      physics.steer = 0;
    }

    // Cargar el .glb en background
    loadCar(def, (loaded) => {
      if (!mp.players.has(r.id)) return;
      const p = mp.players.get(r.id);
      if (p.fallback && p.fallback.parent) p.fallback.parent.remove(p.fallback);
      applyColorToCar(loaded, color);
      loaded.position.copy(p.obj.position);
      loaded.rotation.y = p.obj.rotation.y;
      scene.add(loaded);
      p.obj = loaded;
      p.loadedCar = loaded;
      if (isLocal) localCar = loaded;
    });
  });
}

// ---------- GAME FLOW (MP-aware) ----------

function startGame() {
  // En MP, el host llama start() y esto llega como mensaje start.
  // El cliente NO llama startGame directamente — espera el mensaje.
  // El botón "LISTO" del menú MP simplemente nos lleva a la sala.
  menu.hidden = true;
  showLobby();
}

function placeCarOnTrack(carObj) {
  // No-op en MP: las posiciones se manejan en rebuildAllCars.
  // Mantenido por compatibilidad con código legacy.
  const start = trackPoints[0].clone();
  carObj.position.copy(start);
  carObj.position.y = 0.05;
}

function endLap() {
  // En MP no "terminamos" al cruzar meta: seguimos corriendo y el primero en
  // completar N vueltas es el ganador. Esta función queda para compatibilidad
  // con código legacy; el manejo real está en updateCheckpointCheck.
}

function backToMenu() {
  inGame = false;
  hud.hidden = true;
  if (isMobileDevice()) mobileControls.hidden = true;
  finishScreen.hidden = true;
  leaderboardEl.hidden = true;
  showLobby();
}

function showFatalError2(msg) { showFatalError(msg); }

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
  if (!localCar || Math.abs(physics.speed) < 5) return;
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
// ---------- REMOTE PLAYER STATE ----------

function onRemoteState(msg) {
  if (!mp.players.has(msg.from)) return;
  const p = mp.players.get(msg.from);
  p.lastState = msg;
  p.lastStateTime = performance.now();
  p.targetPos.set(msg.x, 0.05, msg.z);
  p.targetHeading = msg.h;
  // también actualizar info de vueltas del remoto (para leaderboard)
  if (typeof msg.laps === 'number') p.laps = msg.laps;
  if (typeof msg.lapStartTime === 'number') p.lapStartTime = msg.lapStartTime;
  if (typeof msg.lastCheckpointIdx === 'number') p.lastCheckpointIdx = msg.lastCheckpointIdx;
}

function onRemoteFinish(msg) {
  if (!mp.players.has(msg.from)) return;
  const p = mp.players.get(msg.from);
  if (p.finished) return; // ya terminó
  p.finished = true;
  p.finishTime = msg.ms;
  if (!mp.finishOrder.includes(msg.from)) mp.finishOrder.push(msg.from);
  showToast(`🏁 ${p.name} terminó (${formatTime(msg.ms)})`);
  updateLeaderboard();
  // Si somos el host y todos terminaron, podemos cerrar la carrera
  if (mp.isHost) {
    const allDone = [...mp.players.values()].every(pp => pp.finished);
    if (allDone) {
      setTimeout(() => endRaceAllFinished(), 1500);
    }
  }
}

function endRaceAllFinished() {
  // Broadcast end-of-race a todos
  mp.peer.send({ type: 'race-end', order: mp.finishOrder, times: Object.fromEntries([...mp.players.entries()].map(([id, p]) => [id, p.finishTime])) });
  showRaceResults();
}

function showRaceResults() {
  // Mostrar pantalla final con posiciones
  $('finalTime').textContent = formatTime(mp.players.get(mp.myId)?.finishTime || 0);
  const myPos = mp.finishOrder.indexOf(mp.myId) + 1 || mp.roster.length;
  $('finalPos').textContent = '#' + myPos;
  inGame = false;
  hud.hidden = true;
  leaderboardEl.hidden = true;
  if (isMobileDevice()) mobileControls.hidden = true;
  finishScreen.hidden = false;
  launchConfetti();
}

// ---------- LEADERBOARD ----------

function updateLeaderboard() {
  if (!leaderboardEl || leaderboardEl.hidden) return;
  // Ordenar por (laps DESC, lastCheckpointIdx DESC)
  const ranked = [...mp.players.values()].sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    if (a.laps !== b.laps) return b.laps - a.laps;
    if (a.lastCheckpointIdx !== b.lastCheckpointIdx) return b.lastCheckpointIdx - a.lastCheckpointIdx;
    return 0;
  });
  leaderboardRowsEl.innerHTML = '';
  ranked.forEach((p, i) => {
    const pos = i + 1;
    const timeStr = p.finished ? formatTime(p.finishTime) : (p.laps > 0 ? `V${p.laps + 1}` : '--');
    const isMe = p.isLocal;
    const row = document.createElement('div');
    row.className = 'mp-leaderboard__row';
    row.innerHTML = `
      <div class="mp-leaderboard__pos mp-leaderboard__pos--${pos}">${pos}.</div>
      <div class="mp-leaderboard__name ${isMe ? 'mp-leaderboard__name--you' : ''}">${escapeHtml(p.name)}${isMe ? ' (tú)' : ''}</div>
      <div class="mp-leaderboard__time">${timeStr}</div>
    `;
    leaderboardRowsEl.appendChild(row);
  });
}

// ---------- LOOP (MP-aware) ----------

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(50, now - last) / 16.6667; // dt in 60fps units (~1.0)
  last = now;

  // Countdown update
  if (mp.countdownActive) {
    const remaining = (mp.raceStartedAt - now) / 1000;
    mp.countdownT = remaining;
    if (remaining > 0) {
      const n = Math.ceil(remaining);
      if (countdownNumEl.textContent !== String(n)) {
        countdownNumEl.textContent = String(n);
        // Restart animation
        countdownNumEl.style.animation = 'none';
        void countdownNumEl.offsetWidth;
        countdownNumEl.style.animation = '';
      }
    } else {
      endCountdown();
    }
  }

  if (inGame) {
    updateLocalPhysics(dt);
    updateRemotePlayers(dt);
    updateLocalCamera();
    updateNitro(dt);
    updateDriftParticles(dt);
    updateNitroUI();
    if (nitroActive && !nitroWasActive) triggerNitroFlash();
    nitroWasActive = nitroActive;
    updateLocalCheckpoint();
    updateHUD();
    drawMinimap();
    updateLeaderboard();
    sendLocalState(now);
  }

  renderer.render(scene, camera);
}

// ---------- LOCAL PHYSICS ----------

function updateLocalPhysics(dt) {
  if (!localCar || !mp.players.get(mp.myId)) return;
  const player = mp.players.get(mp.myId);
  const def = player.def;

  // Start timer when first input (only after countdown)
  if (!mp.countdownActive && !gameStarted && (isKey('KeyW') || isKey('ArrowUp') || isKey('KeyS') || isKey('ArrowDown'))) {
    gameStarted = true;
  }

  // Inputs
  const gas = (isKey('KeyW') || isKey('ArrowUp')) ? 1 : 0;
  const brake = (isKey('KeyS') || isKey('ArrowDown')) ? 1 : 0;
  const leftInput = (isKey('KeyA') || isKey('ArrowLeft')) ? 1 : 0;
  const rightInput = (isKey('KeyD') || isKey('ArrowRight')) ? 1 : 0;
  physics.handbrake = !!isKey('Space');
  const nitroInput = isKey('ShiftLeft') || isKey('ShiftRight');
  nitroActive = nitroInput && nitro > 0.05 && gas > 0;

  const maxSpd = def.maxSpeed;
  let accelForce = def.accel * 0.5;
  if (nitroActive) accelForce *= NITRO_BOOST;
  const effectiveMaxSpd = nitroActive ? maxSpd * 1.25 : maxSpd;
  if (gas) physics.speed = Math.min(effectiveMaxSpd, physics.speed + accelForce * dt);
  if (brake) physics.speed = Math.max(-maxSpd * 0.3, physics.speed - accelForce * 1.5 * dt);

  const friction = 0.015;
  if (!gas && !brake) physics.speed *= (1 - friction);
  if (physics.handbrake) physics.speed *= (1 - 0.04);

  const speedFactor = Math.min(1, Math.abs(physics.speed) / 20);
  const maxSteer = 0.7;
  let targetSteer = 0;
  if (leftInput) targetSteer += maxSteer;
  if (rightInput) targetSteer -= maxSteer;
  targetSteer *= def.handling;
  physics.steer += (targetSteer - physics.steer) * Math.min(1, 0.18 * dt);

  const dir = physics.speed >= 0 ? 1 : -1;
  const yawRate = (physics.steer * speedFactor * 0.045) * dir;
  const yawBoost = physics.handbrake ? 1.6 : 1.0;
  physics.heading += yawRate * yawBoost * dt * 60 / 60;

  const forward = new THREE.Vector3(Math.sin(physics.heading), 0, Math.cos(physics.heading));
  const moveVec = forward.clone().multiplyScalar(physics.speed * 0.05 * dt);
  physics.pos.add(moveVec);
  physics.pos.y = 0.05;

  const trackInfo = getClosestTrackInfo(physics.pos.x, physics.pos.z);
  if (trackInfo && trackInfo.distance > 8.2) {
    const toCenter = new THREE.Vector3(trackInfo.point.x - physics.pos.x, 0, trackInfo.point.z - physics.pos.z).normalize();
    physics.pos.x += toCenter.x * 0.4;
    physics.pos.z += toCenter.z * 0.4;
    physics.speed *= 0.85;
  }

  // Apply to model
  if (localCar) {
    localCar.position.copy(physics.pos);
    localCar.rotation.y = physics.heading;
    localCar.traverse((c) => {
      if (c.isMesh && c.geometry && c.geometry.type === 'CylinderGeometry') {
        c.rotation.x += physics.speed * 0.05 * dt;
      }
    });
  }
  // Sincronizar player.lastCheckpointIdx para el leaderboard
  player.lastCheckpointIdx = lastCheckpointIdx;
  player.laps = currentLap - 1;
  player.lapStartTime = lapStartTime;
}

function updateLocalCamera() {
  if (!localCar) return;
  const speedFactor = Math.min(physics.speed / 60, 1);
  const dist = 6.5 - speedFactor * 0.8;
  const height = 3.2 - speedFactor * 0.4;
  const back = new THREE.Vector3(-Math.sin(physics.heading), 0, -Math.cos(physics.heading));
  const desired = new THREE.Vector3(
    physics.pos.x + back.x * dist,
    physics.pos.y + height,
    physics.pos.z + back.z * dist
  );
  camera.position.lerp(desired, 0.18);
  const lookAhead = 3 + speedFactor * 3;
  const lookAt = new THREE.Vector3(
    physics.pos.x + Math.sin(physics.heading) * lookAhead,
    physics.pos.y + 1.2,
    physics.pos.z + Math.cos(physics.heading) * lookAhead
  );
  camera.lookAt(lookAt);
  const targetFov = 85 + speedFactor * 8;
  camera.fov += (targetFov - camera.fov) * 0.1;
  camera.updateProjectionMatrix();
}

function updateLocalCheckpoint() {
  if (!gameStarted) return;
  const expectedCp = (lastCheckpointIdx + 1) % checkpoints.length;
  const cp = checkpoints[expectedCp];
  const cpCenter = trackPoints[cp.index];
  const d = Math.hypot(physics.pos.x - cpCenter.x, physics.pos.z - cpCenter.z);
  if (d < 10) {
    cp.passed = true;
    lastCheckpointIdx = expectedCp;
    showCheckpointMsg('✓ Checkpoint ' + (lastCheckpointIdx + 1));
  }
  if (lastCheckpointIdx === checkpoints.length - 1) {
    const startD = Math.hypot(physics.pos.x - trackPoints[0].x, physics.pos.z - trackPoints[0].z);
    if (startD < 12) {
      if (currentLap >= totalLaps) {
        // Terminamos la carrera
        const now = performance.now();
        const lapTime = now - lapStartTime;
        const me = mp.players.get(mp.myId);
        if (me && !me.finished) {
          me.finished = true;
          me.finishTime = lapTime;
          if (!mp.finishOrder.includes(mp.myId)) mp.finishOrder.push(mp.myId);
          // Broadcast finish
          if (mp.peer) mp.peer.send({ type: 'lap-finish', ms: lapTime, lap: totalLaps });
          // Host: si todos terminaron, cerrar
          if (mp.isHost) {
            const allDone = [...mp.players.values()].every(pp => pp.finished);
            if (allDone) setTimeout(() => endRaceAllFinished(), 1500);
          }
        }
        // Reset state pero no salir
        currentLap = 1;
        lastCheckpointIdx = -1;
        checkpoints.forEach(cp => cp.passed = false);
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

// ---------- REMOTE PLAYERS (interpolation) ----------

function updateRemotePlayers(dt) {
  const now = performance.now();
  mp.players.forEach((p, id) => {
    if (p.isLocal) return;
    if (!p.obj) return;
    // Si no hemos recibido state nunca, no interpolar
    if (!p.lastState) return;
    // Lerp suave hacia target
    const lerp = Math.min(1, 0.25 * dt);
    p.obj.position.lerp(p.targetPos, lerp);
    // Interpolación de heading (corta-path)
    let dh = p.targetHeading - p.obj.rotation.y;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    p.obj.rotation.y += dh * lerp;
  });
}

// ---------- SEND STATE TO PEERS ----------

function sendLocalState(now) {
  if (!mp.peer || !localCar) return;
  if (mp.countdownActive) return; // no enviar hasta GO
  if (now - mp.lastSendT < 50) return; // 20Hz
  mp.lastSendT = now;
  const me = mp.players.get(mp.myId);
  mp.peer.send({
    type: 'state',
    from: mp.myId,
    x: physics.pos.x,
    z: physics.pos.z,
    h: physics.heading,
    speed: physics.speed,
    laps: me ? me.laps : 0,
    lapStartTime: lapStartTime,
    lastCheckpointIdx: lastCheckpointIdx,
  });
}

// ---------- HUD + MINIMAP (MP-aware) ----------

function showCheckpointMsg(text) {
  checkpointMsgEl.textContent = text;
  checkpointMsgEl.hidden = false;
  checkpointMsgEl.style.animation = 'none';
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
  ctx.fillStyle = 'rgba(20, 30, 50, 0.5)';
  ctx.fillRect(0, 0, w, h);

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

  const sp = trackPoints[0];
  ctx.fillStyle = '#ff2e63';
  ctx.beginPath();
  ctx.arc(sp.x * scale + ox, sp.z * scale + oz, 4, 0, Math.PI * 2);
  ctx.fill();

  // Dots para todos los jugadores
  mp.players.forEach((p) => {
    if (!p.obj) return;
    const x = p.obj.position.x * scale + ox;
    const z = p.obj.position.z * scale + oz;
    const colorHex = '#' + (p.color ?? 0xffffff).toString(16).padStart(6, '0');
    ctx.fillStyle = p.isLocal ? '#00d9ff' : colorHex;
    ctx.beginPath();
    ctx.arc(x, z, 5, 0, Math.PI * 2);
    ctx.fill();
    // dirección
    ctx.strokeStyle = p.isLocal ? '#00d9ff' : colorHex;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, z);
    ctx.lineTo(x + Math.sin(p.obj.rotation.y) * 10, z + Math.cos(p.obj.rotation.y) * 10);
    ctx.stroke();
  });
}

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
}

// ---------- START ----------
// El flow es:
//  1. init() construye scene + muestra lobby
//  2. Usuario crea sala o se une
//  3. Host presiona "EMPEZAR" → countdown 3-2-1-GO → startRace()
$('playBtn').addEventListener('click', () => {
  // En MP el botón "CARREREAR" del menú single-player ahora es "VOLVER A SALA" o no aplica
  // pero por compatibilidad, lo mandamos al lobby
  menu.hidden = true;
  showLobby();
});
$('againBtn').addEventListener('click', () => {
  // Volver a la sala para re-correr
  finishScreen.hidden = true;
  showLobby();
});
$('menuBtn').addEventListener('click', () => {
  finishScreen.hidden = true;
  showLobby();
});

init();
loop();

console.log('[mp] module END');

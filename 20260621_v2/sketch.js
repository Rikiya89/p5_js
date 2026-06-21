'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS          = 60;
const MAX_DURATION = 30;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 30;

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;

// ─── Existing monochrome palette ─────────────────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

// ─── Artwork parameters ──────────────────────────────────────────────────────
const PARAMS = {
  lineThickness: 1.60,
  glowStrength: 1.15,
  animationSpeed: 1.0,
};

// ─── Newton's Method constants ───────────────────────────────────────────────
// Core rule: x_next = x - f(x) / f'(x)
// f(x) = x^3 - 2x + 0.5, f'(x) = 3x^2 - 2.
// The stored paths below are literal Newton iterates, then mapped into a
// rotating 3D convergence field: wide seed orbits collapse into root attractors.
const NEWTON = {
  DOMAIN_MIN: -2.35,
  DOMAIN_MAX:  2.35,
  ITERATIONS: 8,
  SEED_COUNT: 156,
  ROOT_SAMPLES: 900,
  FIELD_COLUMNS: 39,
  DUST_COUNT: 230,
  CLUSTER_COUNT: 96,
  TAIL_STEPS: 11,
  X_SCALE: 174,
  F_SCALE: 48,
  ITER_DROP: 70,
  SEED_SPREAD: 260,
  DEPTH_SPAN: 500,
  ROOT_RING_MAX: 220,
  COMPOSITION_Y: -170,
  ROTATION_SPEED: 1,      // one camera revolution per loop → seamless
  CAM_RADIUS: 1480,
  CAM_FOV: 1.0,
  FOG_NEAR: 560,
  FOG_FAR: 3800,
};

let pg;        // crisp line pass (WEBGL)
let glowPg;    // soft glow pass (WEBGL)
let halfPg;    // half-res scratch for blurred glow
let quartPg;   // quarter-res scratch for the wide outer bloom
let eighthPg;  // eighth-res for ultra-wide atmospheric haze
let grainPg;   // baked film grain, composited once per frame
let canvasEl = null;

let particleSeeds = [];
let clusterSeeds = [];
let dustSeeds = [];
let newtonRoots = [];
let camEye = { x: 0, y: 0, z: 0 };
let camYaw = 0;
let currentSeed = 0;
let breath = 1.0;                    // global slow pulse, 0.82–1.0

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  pg = createGraphics(W, H, WEBGL);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);

  glowPg = createGraphics(W, H, WEBGL);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);

  // Half-res buffer for cheap blur: draw glowPg scaled down then back up.
  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  halfPg.colorMode(RGB, 255, 255, 255, 255);

  // Quarter-res buffer: a second, wider bloom radius layered under the first.
  quartPg = createGraphics(W >> 2, H >> 2);
  quartPg.pixelDensity(1);
  quartPg.colorMode(RGB, 255, 255, 255, 255);

  // Eighth-res buffer: ultra-wide atmospheric haze, barely-there luminosity.
  eighthPg = createGraphics(W >> 3, H >> 3);
  eighthPg.pixelDensity(1);
  eighthPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  grainPg.colorMode(RGB, 255, 255, 255, 255);

  reseed(20260611);

  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').onclick = startRecording;
  if (el('stopBtn'))  el('stopBtn').onclick  = stopRecording;
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(s) {
  currentSeed = s;
  randomSeed(s);
  noiseSeed(s);
  bakeParticleSeeds();
  bakeGrain();
}

// ─── Precomputed Seeds ────────────────────────────────────────────────────────
function bakeParticleSeeds() {
  particleSeeds = [];
  clusterSeeds = [];

  newtonRoots = findNewtonRoots();

  // Deterministic seed lattice with a small jitter. Each seed stores literal
  // Newton iterates; drawing only maps those values into 3D space.
  for (let i = 0; i < NEWTON.SEED_COUNT; i++) {
    const row = floor(i / NEWTON.FIELD_COLUMNS);
    const col = i % NEWTON.FIELD_COLUMNS;
    const u = (col + 0.5) / NEWTON.FIELD_COLUMNS;
    const x0 = lerp(NEWTON.DOMAIN_MIN, NEWTON.DOMAIN_MAX, u) + random(-0.022, 0.022);
    const path = buildNewtonPath(x0);
    particleSeeds.push({
      x0,
      path,
      rootIndex: nearestRootIndex(path[path.length - 1].x),
      off: random(),
      cycles: 1 + floor(random(2)),       // integer cycles keep the wrap clean
      lane: row - 1.5,
      angle: random(TAU),
      radial: 42 + Math.pow(random(), 0.85) * NEWTON.SEED_SPREAD,
      zBias: random(-NEWTON.DEPTH_SPAN, NEWTON.DEPTH_SPAN) * 0.5,
      twist: random() < 0.5 ? -1 : 1,
      size: random(1.7, 4.1),
    });
  }

  // Small halos around attractor roots. They are static in root-space but rotate
  // in camera-facing planes, making the basins feel alive without chaos.
  for (let j = 0; j < NEWTON.CLUSTER_COUNT; j++) {
    clusterSeeds.push({
      ang: random(TAU),
      rad: 10 + Math.pow(random(), 1.55) * 118,
      rootIndex: j % Math.max(1, newtonRoots.length),
      spin: random() < 0.5 ? 2 : -2,
      wob: random(TAU),
      size: random(1.8, 4.2),
    });
  }

  // Ambient dust: static motes on a flattened shell around the scene.
  dustSeeds = [];
  for (let k = 0; k < NEWTON.DUST_COUNT; k++) {
    const th = random(TAU);
    const el = random(-1, 1);
    const r = 520 + Math.pow(random(), 0.7) * 950;
    dustSeeds.push({
      x: Math.cos(th) * Math.sqrt(1 - el * el) * r,
      y: -190 + el * r * 0.52,
      z: Math.sin(th) * Math.sqrt(1 - el * el) * r,
      size: random(0.9, 2.4),
      tw: random(TAU),
      twk: 2 + floor(random(2)),                // integer twinkle freq → seamless
    });
  }
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  // Fine base grain
  const count = floor(W * H * 0.0018);
  for (let i = 0; i < count; i++) {
    const v = random(100, 210);
    grainPg.fill(v, v, v, random(2, 8));
    grainPg.circle(random(W), random(H), random(0.18, 0.90));
  }
  // Sparse bright specks — micro starfield
  const sparks = floor(W * H * 0.00004);
  for (let i = 0; i < sparks; i++) {
    const v = random(200, 255);
    grainPg.fill(v, v, v, random(14, 38));
    grainPg.circle(random(W), random(H), random(0.5, 1.4));
  }
}

// ─── Newton Mathematics ──────────────────────────────────────────────────────
function newtonF(x) {
  return x * x * x - 2 * x + 0.5;
}

function newtonDf(x) {
  return 3 * x * x - 2;
}

function newtonNext(x) {
  const d = newtonDf(x);
  if (Math.abs(d) < 0.0008) return x + (d < 0 ? -0.018 : 0.018);
  return x - newtonF(x) / d;
}

function buildNewtonPath(x0) {
  const path = [];
  let x = x0;
  for (let i = 0; i <= NEWTON.ITERATIONS; i++) {
    path.push({ x, fx: newtonF(x) });
    x = newtonNext(x);
    x = Math.max(NEWTON.DOMAIN_MIN * 1.8, Math.min(NEWTON.DOMAIN_MAX * 1.8, x));
  }
  return path;
}

function findNewtonRoots() {
  const roots = [];
  let prevX = NEWTON.DOMAIN_MIN, prevF = newtonF(prevX);
  for (let i = 1; i <= NEWTON.ROOT_SAMPLES; i++) {
    const x = lerp(NEWTON.DOMAIN_MIN, NEWTON.DOMAIN_MAX, i / NEWTON.ROOT_SAMPLES);
    const fx = newtonF(x);
    if (prevF === 0 || prevF * fx < 0) {
      let a = prevX, b = x, fa = prevF;
      for (let k = 0; k < 42; k++) {
        const m = (a + b) * 0.5;
        const fm = newtonF(m);
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      const root = (a + b) * 0.5;
      if (!roots.length || Math.abs(root - roots[roots.length - 1]) > 0.01) roots.push(root);
    }
    prevX = x;
    prevF = fx;
  }
  return roots;
}

function nearestRootIndex(x) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < newtonRoots.length; i++) {
    const d = Math.abs(x - newtonRoots[i]);
    if (d < bestD) { best = i; bestD = d; }
  }
  return best;
}

function nearestRootValue(x) {
  return newtonRoots[nearestRootIndex(x)] || 0;
}

function easeInOut(t) {
  const k = Math.max(0, Math.min(1, t));
  return 0.5 - 0.5 * Math.cos(Math.PI * k);
}

// ─── World Mapping ───────────────────────────────────────────────────────────
function worldX(x) { return x * NEWTON.X_SCALE; }
function worldY(fx) {
  return -Math.max(-7.5, Math.min(7.5, fx)) * NEWTON.F_SCALE;
}

function seedPoint(seed, idx) {
  const p = seed.path[Math.max(0, Math.min(seed.path.length - 1, idx))];
  const root = nearestRootValue(p.x);
  const converge = idx / NEWTON.ITERATIONS;
  const collapse = Math.pow(1 - converge, 1.55);
  const theta = seed.angle + idx * 0.72 * seed.twist + root * 1.4;
  const curl = seed.radial * collapse;
  return {
    x: worldX(p.x) + Math.cos(theta) * curl * 0.55,
    y: worldY(p.fx) + (idx - NEWTON.ITERATIONS * 0.5) * NEWTON.ITER_DROP * 0.42 + seed.lane * 22 * collapse,
    z: seed.zBias * collapse + Math.sin(theta) * curl * 0.82,
    root,
    converge,
    fx: p.fx,
  };
}

function interpolatedSeedPoint(seed, t) {
  const scaled = Math.min(NEWTON.ITERATIONS - 0.0001, t * NEWTON.ITERATIONS);
  const i0 = floor(scaled);
  const i1 = Math.min(NEWTON.ITERATIONS, i0 + 1);
  const e = easeInOut(scaled - i0);
  const a = seedPoint(seed, i0);
  const b = seedPoint(seed, i1);
  return {
    x: lerp(a.x, b.x, e),
    y: lerp(a.y, b.y, e),
    z: lerp(a.z, b.z, e),
    root: b.root,
    converge: lerp(a.converge, b.converge, e),
  };
}

function fogFactor(x, y, z) {
  const dx = x - camEye.x, dy = y - camEye.y, dz = z - camEye.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const k = Math.max(0, Math.min(1, (d - NEWTON.FOG_NEAR) / (NEWTON.FOG_FAR - NEWTON.FOG_NEAR)));
  // Smoothstep so fog has no hard knee — elements ease in/out rather than pop
  const s = k * k * (3 - 2 * k);
  return Math.max(0, 1 - s);
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  renderFrame(loop);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    const el = id => document.getElementById(id);
    if (el('duration'))   el('duration').textContent   = (recFrameCount / FPS).toFixed(1);
    if (el('frameCount')) el('frameCount').textContent = recFrameCount;
    const pf = document.getElementById('progressFill');
    if (pf) pf.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderFrame(loop) {
  const phase = loop * TAU * PARAMS.animationSpeed;
  // Slow inhale/exhale: 2 full cycles per loop (integer → seamless)
  breath = 0.86 + 0.14 * Math.sin(2 * phase - Math.PI * 0.5);

  pg.clear();
  glowPg.clear();
  prepBuffer(pg, phase);
  prepBuffer(glowPg, phase);

  drawNewtonScene(glowPg, loop, phase, true);
  drawNewtonScene(pg, loop, phase, false);
  composite();

  drawHUD(loop);
  drawCornerBrackets();
  drawVignette();
}

// Additive blending + no depth test → order-independent glow strokes,
// so no per-frame depth sorting is needed.
function prepBuffer(g, phase) {
  g.blendMode(ADD);
  const gl = g.drawingContext;
  gl.disable(gl.DEPTH_TEST);
  applyCamera(g, phase);
}

// Slow orbital camera: exactly ROTATION_SPEED (integer) revolutions per loop.
function applyCamera(g, ph) {
  camYaw = ph * NEWTON.ROTATION_SPEED;
  const r  = NEWTON.CAM_RADIUS * 0.66 + 86 * Math.sin(2 * ph);
  const cy = -170;
  const ey = cy - 210 + 118 * Math.sin(ph) + 24 * Math.sin(3 * ph);
  camEye.x = Math.sin(camYaw) * r;
  camEye.y = ey;
  camEye.z = Math.cos(camYaw) * r;
  g.perspective(NEWTON.CAM_FOV, W / H, 10, 9000);
  g.camera(camEye.x, camEye.y, camEye.z, 0, cy + 28 * Math.sin(2 * ph), 0, 0, 1, 0);
}

// Composite: bg -> blurred glow (screen) -> sharp lines (screen) -> grain.
function composite() {
  background(BG_R, BG_G, BG_B);

  halfPg.clear();
  halfPg.image(glowPg, 0, 0, W >> 1, H >> 1);
  quartPg.clear();
  quartPg.image(halfPg, 0, 0, W >> 2, H >> 2);
  eighthPg.clear();
  eighthPg.image(quartPg, 0, 0, W >> 3, H >> 3);

  drawingContext.globalCompositeOperation = 'screen';
  tint(255, Math.round(80 * breath));   // ultra-wide atmospheric haze
  image(eighthPg, 0, 0, W, H);
  tint(255, Math.round(148 * breath));  // wide, faint outer halo
  image(quartPg, 0, 0, W, H);
  tint(255, Math.round(230 * breath));  // tight inner glow
  image(halfPg, 0, 0, W, H);
  noTint();
  image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 16);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

// ─── Newton Scene ─────────────────────────────────────────────────────────────
function drawNewtonScene(g, loop, phase, isGlow) {
  g.push();
  g.translate(0, NEWTON.COMPOSITION_Y, 0);
  g.noFill();

  drawDust(g, phase, isGlow);
  drawBasinScaffold(g, phase, isGlow);
  drawRootVeils(g, phase, isGlow);
  drawConvergenceTrails(g, phase, isGlow);
  drawRootAttractors(g, phase, isGlow);
  drawIterationParticles(g, loop, phase, isGlow);
  drawRootClusters(g, phase, isGlow);

  g.pop();
}

function applyStroke(g, isGlow, alpha, weight) {
  const a = alpha * (isGlow ? PARAMS.glowStrength : 1);
  const w = weight * PARAMS.lineThickness * (isGlow ? 6.6 : 1);
  g.stroke(INK_R, INK_G, INK_B, a);
  g.strokeWeight(w);
}

function applyFill(g, isGlow, alpha) {
  g.noStroke();
  g.fill(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
}

// Camera-facing primitives (orbit is around Y, so a yaw billboard suffices).
function billboardDot(g, x, y, z, d, alpha, isGlow) {
  g.push();
  g.translate(x, y, z);
  g.rotateY(camYaw);
  applyFill(g, isGlow, alpha);
  g.circle(0, 0, d);
  g.pop();
}

function billboardRing(g, x, y, z, r, alpha, weight, isGlow) {
  g.push();
  g.translate(x, y, z);
  g.rotateY(camYaw);
  g.noFill();
  applyStroke(g, isGlow, alpha, weight);
  g.circle(0, 0, r * 2);
  g.pop();
}

function drawBasinScaffold(g, ph, isGlow) {
  const cols = isGlow ? 13 : 31;
  const yBase = 255;
  g.push();
  for (let i = 0; i <= cols; i++) {
    const t = i / cols;
    const x0 = lerp(NEWTON.DOMAIN_MIN, NEWTON.DOMAIN_MAX, t);
    const root = nearestRootValue(x0);
    const sx = worldX(x0);
    const rx = worldX(root);
    const z = Math.sin(t * TAU * 3 + ph) * 70;
    const fog = fogFactor((sx + rx) * 0.5, yBase * 0.28, z);
    applyStroke(g, isGlow, (isGlow ? 3 : 10) * fog * breath, 0.34);
    g.beginShape();
    g.vertex(sx, yBase, z);
    g.vertex(lerp(sx, rx, 0.45), 94 + 18 * Math.sin(ph + t * TAU), z * 0.6);
    g.vertex(rx, 0, 0);
    g.endShape();
  }

  for (const root of newtonRoots) {
    const x = worldX(root);
    const fog = fogFactor(x, 0, 0);
    applyStroke(g, isGlow, (isGlow ? 10 : 36) * fog, 0.58);
    g.line(x, -420, 0, x, 280, 0);
    for (const z of [-210, 210]) {
      applyStroke(g, isGlow, (isGlow ? 3 : 10) * fog, 0.34);
      g.line(x, -150, z, x, 120, z);
    }
  }
  g.pop();
}

function drawRootVeils(g, ph, isGlow) {
  g.push();
  for (let ri = 0; ri < newtonRoots.length; ri++) {
    const x = worldX(newtonRoots[ri]);
    const fog = fogFactor(x, 0, 0);
    const ringCount = isGlow ? 5 : 9;
    for (let j = 0; j < ringCount; j++) {
      const t = j / Math.max(1, ringCount - 1);
      const y = -260 + t * 470;
      const wob = Math.sin(ph * 2 + ri * 1.7 + j * 0.9);
      const rx = 42 + t * 98 + wob * 6;
      const rz = 72 + Math.sin(ph + j) * 14 + t * 58;
      const a = Math.sin(Math.PI * t) * fog;
      applyStroke(g, isGlow, (isGlow ? 8 : 32) * a * breath, 0.42);
      g.push();
      g.translate(x, y, 0);
      g.rotateY(camYaw + ri * 0.28);
      g.beginShape();
      for (let k = 0; k <= 80; k++) {
        const u = k / 80;
        const ang = u * TAU;
        g.vertex(Math.cos(ang) * rx, Math.sin(ang) * 5, Math.sin(ang) * rz);
      }
      g.endShape();
      g.pop();
    }
  }
  g.pop();
}

function drawConvergenceTrails(g, ph, isGlow) {
  const stride = isGlow ? 4 : 2;
  g.push();
  for (let i = 0; i < particleSeeds.length; i += stride) {
    const seed = particleSeeds[i];
    for (let k = 0; k < NEWTON.ITERATIONS; k++) {
      const a = seedPoint(seed, k);
      const b = seedPoint(seed, k + 1);
      const rootX = worldX(seed.rootIndex < newtonRoots.length ? newtonRoots[seed.rootIndex] : b.root);
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      const midZ = (a.z + b.z) * 0.5;
      const fog = fogFactor(midX, midY, midZ);
      const pull = Math.pow((k + 1) / NEWTON.ITERATIONS, 1.15);
      const shimmer = 0.78 + 0.22 * Math.sin(2 * ph + i * 0.17 + k);
      const bow = Math.sin((k + 1) * PHI) * (1 - pull) * 58;
      applyStroke(g, isGlow, (isGlow ? 6 : 28) * pull * fog * shimmer, 0.34 + pull * 0.24);
      g.beginShape();
      g.vertex(a.x, a.y, a.z);
      g.vertex(lerp(a.x, rootX, 0.55), lerp(a.y, b.y, 0.45) - 22 * pull, lerp(a.z, b.z, 0.45) + bow);
      g.vertex(b.x, b.y, b.z);
      g.endShape();

      if (!isGlow && k > 0 && k % 2 === 0) {
        const d = 1.8 + pull * 2.1;
        billboardDot(g, b.x, b.y, b.z, d, 42 * pull * fog, isGlow);
      }
    }
  }
  g.pop();
}

function drawRootAttractors(g, ph, isGlow) {
  g.push();
  for (let i = 0; i < newtonRoots.length; i++) {
    const root = newtonRoots[i];
    const x = worldX(root);
    const fog = fogFactor(x, 0, 0);
    const pulse = 0.86 + 0.14 * Math.sin(4 * ph + i * TAU / 3);
    const labelW = 0.72 + 0.28 * Math.sin(2 * ph + i);

    billboardDot(g, x, 0, 0, isGlow ? 32 : 9, (isGlow ? 40 : 245) * fog, isGlow);
    billboardRing(g, x, 0, 0, 32 * pulse, (isGlow ? 32 : 160) * fog, 1.1, isGlow);
    billboardRing(g, x, 0, 0, 70 * pulse, (isGlow ? 14 : 76) * fog, 0.68, isGlow);
    billboardRing(g, x, 0, 0, 118 * pulse, (isGlow ? 7 : 34) * fog, 0.45, isGlow);

    for (const r0 of [0, 1 / 3, 2 / 3]) {
      const prog = ((ph / TAU) * 2 + r0 + i * 0.11) % 1;
      const eased = 1 - Math.pow(1 - prog, 2.5);
      const rad = 42 + eased * NEWTON.ROOT_RING_MAX;
      const alpha = Math.pow(1 - prog, 1.35) * Math.min(1, prog / 0.06);
      billboardRing(g, x, 0, 0, rad, alpha * (isGlow ? 15 : 62) * fog, 0.48, isGlow);
    }

    applyStroke(g, isGlow, (isGlow ? 18 : 82) * fog * labelW, 0.58);
    g.line(x - 45, -6, -72, x + 45, 6, 72);
    g.line(x - 45, 6, 72, x + 45, -6, -72);

    applyStroke(g, isGlow, (isGlow ? 8 : 24) * fog, 0.34);
    for (const z of [-150, 150]) g.line(x, -220, z, x, 190, -z);
  }
  g.pop();
}

function drawIterationParticles(g, loop, ph, isGlow) {
  const stride = isGlow ? 3 : 2;
  g.push();
  for (let i = 0; i < particleSeeds.length; i += stride) {
    const seed = particleSeeds[i];
    const s = (((loop * seed.cycles + seed.off) % 1) + 1) % 1;
    const fade = Math.pow(Math.sin(Math.PI * s), 0.72);
    const p = interpolatedSeedPoint(seed, s);
    const fog = fogFactor(p.x, p.y, p.z);
    const focus = 0.55 + 0.45 * p.converge;
    billboardDot(g, p.x, p.y, p.z, seed.size * (isGlow ? 4.2 : 0.92), (isGlow ? 22 : 138) * fade * focus * fog, isGlow);

    if (!isGlow) {
      let prev = p;
      for (let k = 1; k <= NEWTON.TAIL_STEPS; k++) {
        const st = Math.max(0, s - k * 0.026);
        const tp = interpolatedSeedPoint(seed, st);
        const a = fade * (1 - k / (NEWTON.TAIL_STEPS + 1)) * fog;
        applyStroke(g, isGlow, 68 * a, 0.54);
        g.line(prev.x, prev.y, prev.z, tp.x, tp.y, tp.z);
        prev = tp;
      }
    }
  }
  g.pop();
}

function drawRootClusters(g, ph, isGlow) {
  const stride = isGlow ? 2 : 2;
  const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  g.push();
  for (let j = 0; j < clusterSeeds.length; j += stride) {
    const cs = clusterSeeds[j];
    const root = newtonRoots[cs.rootIndex % Math.max(1, newtonRoots.length)] || 0;
    const ang = cs.ang + ph * cs.spin;
    const r = cs.rad * (1 + 0.12 * Math.sin(2 * ph + cs.wob));
    const x = worldX(root) + Math.cos(ang) * r * rx;
    const y = Math.sin(ang) * r * 0.75;
    const z = Math.cos(ang) * r * rz;
    const nearW = 1 - Math.min(1, r / 150);
    const fog = fogFactor(x, y, z);
    billboardDot(g, x, y, z, cs.size * (isGlow ? 4.0 : 1),
      (isGlow ? 18 : 100) * (0.25 + 0.75 * nearW) * fog, isGlow);
  }
  g.pop();
}

// ─── Ambient Dust ─────────────────────────────────────────────────────────────
// Static motes around the scene; the orbit turns them into slow parallax and
// the integer-frequency twinkle keeps the loop seamless.
function drawDust(g, ph, isGlow) {
  const stride = isGlow ? 3 : 1;
  g.push();
  for (let i = 0; i < dustSeeds.length; i += stride) {
    const d = dustSeeds[i];
    const fog = fogFactor(d.x, d.y, d.z);
    const twRaw = 0.5 + 0.5 * Math.sin(d.twk * ph + d.tw);
    const tw = 0.30 + 0.70 * twRaw * twRaw;   // squared → softer peaks, no hard flash
    billboardDot(g, d.x, d.y, d.z, d.size * (isGlow ? 3.2 : 1), (isGlow ? 6 : 32) * tw * fog * breath, isGlow);
  }
  g.pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');
  fill(255, 255, 255, 155);
  textSize(13);
  textAlign(LEFT, TOP);
  text("NEWTON'S METHOD · 3D CONVERGENCE FIELD", 52, 52);
  fill(255, 255, 255, 70);
  textSize(10);
  text("f(x)=x^3-2x+0.5  x_next=x-f(x)/f'(x)  roots="
    + newtonRoots.map(r => r.toFixed(3)).join(', ')
    + "  loop=" + loop.toFixed(3), 52, 76);
  fill(255, 255, 255, 50);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text(W + '×' + H + ' · ' + FPS + ' fps', 52, H - 52);
  textAlign(RIGHT, BOTTOM);
  text("20260621 · NEWTON'S METHOD", W - 52, H - 52);
  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push();
  noFill();
  stroke(255, 255, 255, 42);
  strokeWeight(0.7);
  const m = 32, L = 26;
  line(m, m, m + L, m); line(m, m, m, m + L);
  line(W - m, m, W - m - L, m); line(W - m, m, W - m, m + L);
  line(m, H - m, m + L, H - m); line(m, H - m, m, H - m - L);
  line(W - m, H - m, W - m - L, H - m); line(W - m, H - m, W - m, H - m - L);
  pop();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 80, maxR = dist(W / 2, H / 2, 0, 0) * 1.12;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.62, 1.0, 0, 145, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(floor(random(100000))); }
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('sacred_geometry_' + ts(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseed(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { console.error(e); isRecording = false; setStatus('Error', '#f44'); } });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording = true;
  const el = id => document.getElementById(id);
  if (el('duration')) el('duration').textContent = '0.0';
  if (el('frameCount')) el('frameCount').textContent = '0';
  if (el('startBtn')) el('startBtn').disabled = true;
  if (el('stopBtn')) el('stopBtn').disabled = false;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Recording…', '#fff');
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus('Finalizing…', '#ccc');
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sacred_geometry_' + ts() + '.mp4';
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn')) el('stopBtn').disabled = true;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(txt, c) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = txt;
    el.style.color = c;
  }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

if (typeof window !== 'undefined') {
  window.startRecording = startRecording;
  window.stopRecording = stopRecording;
}

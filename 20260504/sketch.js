'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 16;          // 16-second seamless loop

// ─── Math ─────────────────────────────────────────────────────────────────────
const PHI = 1.61803398875;
const TAU = Math.PI * 2;

// ─── Layers ───────────────────────────────────────────────────────────────────
let webglLayer = null;
let bloomLayer = null;
let grainLayer = null;
let canvasEl   = null;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Generative state ─────────────────────────────────────────────────────────
// Two interwoven knots + diffuse cloud + distant stars + inner caustic rays.
let knotA  = [];   // primary (3,7) knot
let knotB  = [];   // secondary counter-rotating knot
let cloud  = [];
let stars  = [];
let rays   = [];   // inner light streaks
const N_KNOT_A = 1100;
const N_KNOT_B = 800;
const N_CLOUD  = 800;
const N_STARS  = 110;
const N_RAYS   = 36;

let seedPhase = 0;

// Light direction in object space — used for pseudo-shading.
const LIGHT = (() => {
  const v = [0.55, -0.7, 0.45];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  webglLayer = createGraphics(W, H, WEBGL);
  webglLayer.pixelDensity(1);
  webglLayer.colorMode(RGB, 255, 255, 255, 255);
  webglLayer.noFill();
  webglLayer.strokeCap(ROUND);

  // Half-resolution bloom buffer
  bloomLayer = createGraphics(W >> 1, H >> 1);
  bloomLayer.pixelDensity(1);
  bloomLayer.colorMode(RGB, 255, 255, 255, 255);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseed(floor(random(100000)));

  document.getElementById('maxDuration').textContent = MAX_DURATION;
  document.getElementById('canvasSize').textContent  = W + ' × ' + H;
}

function reseed(s) {
  randomSeed(s);
  noiseSeed(s);
  seedPhase = random(TAU);
  knotA = buildKnot(N_KNOT_A, 3, 7, 280, 110, 14);
  knotB = buildKnot(N_KNOT_B, 5, 2, 230,  85, 10);
  buildCloud();
  buildStars();
  buildRays();
}

// ─── Generic torus knot builder with tangent for shading ─────────────────────
function buildKnot(N, p, q, r1, r2, jitterAmp) {
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const a = u * TAU;
    const cs = Math.cos(q * a), sn = Math.sin(q * a);
    const R  = r1 + r2 * cs;
    const j  = (random() - 0.5) * jitterAmp;
    const x = (R + j) * Math.cos(p * a);
    const y =  r2 * sn + j * 0.4;
    const z = (R + j) * Math.sin(p * a);

    // Tangent (analytical-ish via finite difference)
    const da = 0.001;
    const a2 = a + da;
    const cs2 = Math.cos(q * a2), R2 = r1 + r2 * cs2;
    const tx = R2 * Math.cos(p * a2) - R * Math.cos(p * a);
    const ty = r2 * Math.sin(q * a2) - r2 * sn;
    const tz = R2 * Math.sin(p * a2) - R * Math.sin(p * a);
    const tm = Math.hypot(tx, ty, tz) || 1;

    out[i] = {
      x, y, z,
      tx: tx / tm, ty: ty / tm, tz: tz / tm,
      phase: random(TAU),
      scale: 0.7 + Math.pow(random(), 2) * 1.4,
      u,
    };
  }
  return out;
}

function buildCloud() {
  cloud = [];
  for (let i = 0; i < N_CLOUD; i++) {
    const a = random() * TAU;
    const b = random() * TAU;
    const Rc = 320 + (random() - 0.5) * 240;
    const rc = 70  + (random() - 0.5) * 100;
    const x = (Rc + rc * Math.cos(b)) * Math.cos(a);
    const y =  rc * Math.sin(b) * 1.3;
    const z = (Rc + rc * Math.cos(b)) * Math.sin(a);
    cloud.push({
      x, y, z,
      phase: random(TAU),
      scale: 0.5 + random() * 1.0,
    });
  }
}

function buildStars() {
  stars = [];
  for (let i = 0; i < N_STARS; i++) {
    const u = random(), v = random();
    const theta = u * TAU;
    const phi   = Math.acos(2 * v - 1);
    const r     = 760 + random() * 240;
    stars.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
      phase: random(TAU),
      scale: 0.6 + random() * 1.6,
    });
  }
}

// Inner caustic-like rays — emerge from origin in random 3D directions
function buildRays() {
  rays = [];
  for (let i = 0; i < N_RAYS; i++) {
    const u = random(), v = random();
    const theta = u * TAU;
    const phi   = Math.acos(2 * v - 1);
    rays.push({
      dx: Math.sin(phi) * Math.cos(theta),
      dy: Math.cos(phi),
      dz: Math.sin(phi) * Math.sin(theta),
      phase: random(TAU),
      length: 460 + random() * 220,
    });
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const t    = loop * TAU;

  background(0);
  renderScene(t, loop);
  applyBloom();

  // Subtle grain
  push(); tint(255, 5); image(grainLayer, 0, 0); noTint(); pop();

  drawCornerBrackets();
  drawHUD(t, loop);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    document.getElementById('duration').textContent   = (recFrameCount / FPS).toFixed(1);
    document.getElementById('frameCount').textContent = recFrameCount;
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── 3D scene ─────────────────────────────────────────────────────────────────
let viewBasis = null;
function computeViewBasis(t) {
  const camR = 1380;
  const camA = t + seedPhase;
  const camY = 230 * Math.sin(t * 0.5 + seedPhase);
  const eye  = [camR * Math.cos(camA), camY, camR * Math.sin(camA)];
  const at   = [0, 0, 0];
  const fx = at[0] - eye[0], fy = at[1] - eye[1], fz = at[2] - eye[2];
  const fm = Math.hypot(fx, fy, fz);
  const fwd = [fx / fm, fy / fm, fz / fm];
  const upWorld = [0, 1, 0];
  const rx = fwd[1] * upWorld[2] - fwd[2] * upWorld[1];
  const ry = fwd[2] * upWorld[0] - fwd[0] * upWorld[2];
  const rz = fwd[0] * upWorld[1] - fwd[1] * upWorld[0];
  const rm = Math.hypot(rx, ry, rz);
  const right = [rx / rm, ry / rm, rz / rm];
  const ux = right[1] * fwd[2] - right[2] * fwd[1];
  const uy = right[2] * fwd[0] - right[0] * fwd[2];
  const uz = right[0] * fwd[1] - right[1] * fwd[0];
  return { right, up: [ux, uy, uz], fwd, eye };
}

function viewDepth(x, y, z) {
  const { fwd, eye } = viewBasis;
  return (x - eye[0]) * fwd[0] + (y - eye[1]) * fwd[1] + (z - eye[2]) * fwd[2];
}

function renderScene(t, loop) {
  webglLayer.clear();
  webglLayer.push();
  webglLayer.background(0, 0, 0, 0);
  webglLayer.noFill();

  viewBasis = computeViewBasis(t);
  const { eye } = viewBasis;
  webglLayer.camera(eye[0], eye[1], eye[2], 0, 0, 0, 0, 1, 0);
  webglLayer.perspective(Math.PI / 4.8, W / H, 0.1, 8000);

  // Soft tilt
  webglLayer.rotateX(Math.sin(t * 0.4) * 0.10);
  webglLayer.rotateZ(Math.cos(t * 0.3) * 0.07);

  drawHorizonRing(t);
  drawAxisGuides(t);
  drawStars(t);
  drawInnerRays(t);
  drawCloud(t);

  // Two knots, interwoven and counter-rotating
  webglLayer.push();
  webglLayer.rotateY(t * 0.18);
  drawKnot(knotA, t, 1.0);
  webglLayer.pop();

  webglLayer.push();
  webglLayer.rotateY(-t * 0.27);
  webglLayer.rotateX(0.45);
  drawKnot(knotB, t, 0.78);                // slightly smaller / dimmer
  webglLayer.pop();

  webglLayer.pop();
  image(webglLayer, 0, 0);
}

// ─── Knot render with rim-light + tangent streaks ────────────────────────────
function drawKnot(pts, t, weight) {
  const { fwd } = viewBasis;
  const wob = (p) => Math.sin(t * 0.7 + p.phase) * 5;
  const breath = (p) => 1 + 0.04 * Math.sin(t * 0.9 + p.phase);

  const cache = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const b = breath(p);
    const w = wob(p);
    const x = p.x * b + w * 0.4;
    const y = p.y * b;
    const z = p.z * b + w * 0.4;
    const d = viewDepth(x, y, z);

    // Lambertian-style shade
    const dotL = p.tx * LIGHT[0] + p.ty * LIGHT[1] + p.tz * LIGHT[2];
    const shade = 0.4 + 0.6 * (0.5 + 0.5 * dotL);

    // Rim term: tangent perpendicular to view direction → silhouette edge
    // (1 - |t·v|) is high when tangent is perpendicular to the view ray.
    const dotV = Math.abs(p.tx * fwd[0] + p.ty * fwd[1] + p.tz * fwd[2]);
    const rim  = Math.pow(1 - dotV, 3);   // sharper falloff = thinner rim

    cache[i] = { p, x, y, z, d, shade, rim };
  }

  // Pass 1 — connective thread (parametric order)
  webglLayer.push();
  for (let i = 0; i < cache.length - 1; i++) {
    const a = cache[i], b = cache[i + 1];
    const dAvg = (a.d + b.d) * 0.5;
    const fog  = fogFactor(dAvg);
    const sh   = (a.shade + b.shade) * 0.5;
    const rm   = (a.rim   + b.rim)   * 0.5;

    // Body
    webglLayer.stroke(255, 255, 255, 150 * fog * sh * weight);
    webglLayer.strokeWeight(1.5 * weight);
    webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
    // Glow underlay
    webglLayer.stroke(255, 255, 255, 8 * fog * sh * weight);
    webglLayer.strokeWeight(2.4);
    webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
    // Rim — bright thin highlight on silhouette edges
    if (rm > 0.25) {
      webglLayer.stroke(255, 255, 255, 235 * fog * rm * weight);
      webglLayer.strokeWeight(0.95 * weight);
      webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  // Close loop
  const a0 = cache[0], aN = cache[cache.length - 1];
  webglLayer.stroke(255, 255, 255, 30 * weight);
  webglLayer.strokeWeight(0.4 * weight);
  webglLayer.line(aN.x, aN.y, aN.z, a0.x, a0.y, a0.z);
  webglLayer.pop();

  // Pass 2 — beads, back-to-front, with tangent streaks
  const order = cache.slice().sort((a, b) => b.d - a.d);
  webglLayer.push();
  for (let i = 0; i < order.length; i++) {
    const { p, x, y, z, d, shade, rim } = order[i];
    const fog = fogFactor(d);

    // Halo
    webglLayer.stroke(255, 255, 255, 22 * fog * shade * weight);
    webglLayer.strokeWeight(7 * p.scale * weight);
    webglLayer.point(x, y, z);

    // Mid body
    webglLayer.stroke(255, 255, 255, 110 * fog * shade * weight);
    webglLayer.strokeWeight(2.2 * p.scale * weight);
    webglLayer.point(x, y, z);

    // Bright lit-side core
    if (shade > 0.85) {
      webglLayer.stroke(255, 255, 255, 245 * fog);
      webglLayer.strokeWeight(0.9 * p.scale * weight);
      webglLayer.point(x, y, z);
    }

    // Rim accent — extra-bright pixel on silhouette beads
    if (rim > 0.55) {
      webglLayer.stroke(255, 255, 255, 230 * fog * rim);
      webglLayer.strokeWeight(1.4 * p.scale * weight);
      webglLayer.point(x, y, z);
    }

    // Tangent streak — short line along the curve direction, scaled by shade.
    // Only on a subset to keep frame budget reasonable.
    if (i % 2 === 0 && shade > 0.55) {
      const L = 8 + 14 * shade;
      const sx = x + p.tx * L;
      const sy = y + p.ty * L;
      const sz = z + p.tz * L;
      const ex = x - p.tx * L;
      const ey = y - p.ty * L;
      const ez = z - p.tz * L;
      webglLayer.stroke(255, 255, 255, 36 * fog * shade * weight);
      webglLayer.strokeWeight(0.45 * weight);
      webglLayer.line(sx, sy, sz, ex, ey, ez);
    }
  }
  webglLayer.pop();
}

// ─── Cloud ────────────────────────────────────────────────────────────────────
function drawCloud(t) {
  const buf = new Array(cloud.length);
  for (let i = 0; i < cloud.length; i++) {
    const p = cloud[i];
    const w = Math.sin(t * 0.5 + p.phase) * 4;
    const x = p.x + w;
    const y = p.y + Math.cos(t * 0.4 + p.phase) * 3;
    const z = p.z + w;
    buf[i] = { p, x, y, z, d: viewDepth(x, y, z) };
  }
  buf.sort((a, b) => b.d - a.d);

  webglLayer.push();
  for (let i = 0; i < buf.length; i++) {
    const { p, x, y, z, d } = buf[i];
    const fog = fogFactor(d);
    webglLayer.stroke(255, 255, 255, 6 * fog);
    webglLayer.strokeWeight(3.5 * p.scale);
    webglLayer.point(x, y, z);
    webglLayer.stroke(255, 255, 255, 38 * fog);
    webglLayer.strokeWeight(0.7 * p.scale);
    webglLayer.point(x, y, z);
  }
  webglLayer.pop();
}

// ─── Stars ────────────────────────────────────────────────────────────────────
function drawStars(t) {
  webglLayer.push();
  for (let i = 0; i < stars.length; i++) {
    const p = stars[i];
    const k = 0.5 + 0.5 * Math.sin(t * 0.6 + p.phase * 1.7);
    const d = viewDepth(p.x, p.y, p.z);
    const fog = fogFactor(d);

    webglLayer.stroke(255, 255, 255, (10 + 30 * k) * fog);
    webglLayer.strokeWeight(5 * p.scale);
    webglLayer.point(p.x, p.y, p.z);
    webglLayer.stroke(255, 255, 255, (90 + 140 * k) * fog);
    webglLayer.strokeWeight(1.4 * p.scale);
    webglLayer.point(p.x, p.y, p.z);
  }
  webglLayer.pop();
}

// ─── Inner caustic rays — emerge from origin, very low alpha ────────────────
// Drawn first / behind the form, give a "lit-from-within" sense without
// covering the dark center we just removed.
function drawInnerRays(t) {
  webglLayer.push();
  for (let i = 0; i < rays.length; i++) {
    const r = rays[i];
    // Slow precession so rays don't feel static
    const wob = 0.06 * Math.sin(t * 0.5 + r.phase);
    const len = r.length * (0.85 + 0.15 * Math.sin(t * 0.7 + r.phase));

    // Rotate the ray direction slightly each frame (around Y)
    const c = Math.cos(wob), s = Math.sin(wob);
    const dx = r.dx * c - r.dz * s;
    const dz = r.dx * s + r.dz * c;
    const dy = r.dy;

    const ex = dx * len;
    const ey = dy * len;
    const ez = dz * len;

    const dEnd = viewDepth(ex, ey, ez);
    const fog  = fogFactor(dEnd);

    // Multi-pass for soft glow + crisp center
    webglLayer.stroke(255, 255, 255, 4 * fog);
    webglLayer.strokeWeight(3.2);
    webglLayer.line(0, 0, 0, ex, ey, ez);
    webglLayer.stroke(255, 255, 255, 12 * fog);
    webglLayer.strokeWeight(0.9);
    webglLayer.line(0, 0, 0, ex, ey, ez);
    webglLayer.stroke(255, 255, 255, 28 * fog);
    webglLayer.strokeWeight(0.3);
    webglLayer.line(0, 0, 0, ex, ey, ez);
  }
  webglLayer.pop();
}

// ─── Fog ──────────────────────────────────────────────────────────────────────
function fogFactor(d) {
  const near = 900, far = 2200;
  const k = constrain((far - d) / (far - near), 0, 1);
  return Math.pow(k, 1.4);
}

// ─── Axis guides ──────────────────────────────────────────────────────────────
function drawAxisGuides(t) {
  const r = 360, segs = 96;
  const drawRing = (axis) => {
    webglLayer.beginShape();
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU;
      const c = Math.cos(a) * r, s = Math.sin(a) * r;
      if (axis === 0) webglLayer.vertex(0, c, s);
      else if (axis === 1) webglLayer.vertex(c, 0, s);
      else webglLayer.vertex(c, s, 0);
    }
    webglLayer.endShape();
  };
  webglLayer.push();
  webglLayer.stroke(255, 255, 255, 9);
  webglLayer.strokeWeight(0.4);
  drawRing(0); drawRing(1); drawRing(2);
  webglLayer.stroke(255, 255, 255, 3);
  webglLayer.strokeWeight(2.4);
  drawRing(0); drawRing(1); drawRing(2);
  webglLayer.pop();
}

// ─── Horizon ring ─────────────────────────────────────────────────────────────
function drawHorizonRing(t) {
  const r = 760, segs = 220;
  webglLayer.push();
  webglLayer.rotateX(Math.PI / 2);
  webglLayer.stroke(255, 255, 255, 18);
  webglLayer.strokeWeight(0.5);
  webglLayer.beginShape();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU;
    webglLayer.vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  webglLayer.endShape();
  webglLayer.stroke(255, 255, 255, 5);
  webglLayer.strokeWeight(3.5);
  webglLayer.beginShape();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU;
    webglLayer.vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  webglLayer.endShape();
  webglLayer.pop();
}

// ─── Bloom — anamorphic-style horizontal streak ──────────────────────────────
function applyBloom() {
  bloomLayer.clear();
  bloomLayer.push();
  bloomLayer.image(webglLayer, 0, 0, W >> 1, H >> 1);
  bloomLayer.pop();

  push();
  blendMode(ADD);
  // Wider horizontal taps, narrower vertical = anamorphic feel
  const taps = [
    { dx:  0,  dy:  0,  a: 36 },
    { dx:  6,  dy:  0,  a: 26 },
    { dx: -6,  dy:  0,  a: 26 },
    { dx: 14,  dy:  0,  a: 18 },
    { dx: -14, dy:  0,  a: 18 },
    { dx: 26,  dy:  0,  a: 12 },
    { dx: -26, dy:  0,  a: 12 },
    { dx: 44,  dy:  0,  a:  7 },
    { dx: -44, dy:  0,  a:  7 },
    { dx:  0,  dy:  3,  a: 14 },
    { dx:  0,  dy: -3,  a: 14 },
    { dx:  0,  dy:  7,  a:  7 },
    { dx:  0,  dy: -7,  a:  7 },
  ];
  for (const t of taps) {
    tint(255, t.a);
    image(bloomLayer, t.dx, t.dy, W, H);
  }
  noTint();
  blendMode(BLEND);
  pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(t, loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');

  fill(255, 255, 255, 180);
  textSize(13);
  textAlign(LEFT, TOP);
  text('GENERATIVE 3D · INTERWOVEN KNOTS · B&W', 52, 52);

  fill(255, 255, 255, 95);
  textSize(10);
  text('N = ' + (N_KNOT_A + N_KNOT_B + N_CLOUD + N_STARS) + '   loop = ' + loop.toFixed(3), 52, 76);

  fill(255, 255, 255, 65);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text('φ=' + PHI.toFixed(6), 52, H - 52);
  textAlign(RIGHT, BOTTOM);
  text('20260504 · 3D · B&W', W - 52, H - 52);
  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push();
  noFill();
  stroke(255, 255, 255, 55);
  strokeWeight(0.8);
  const m = 32, L = 26;
  line(m, m, m+L, m);   line(m, m, m, m+L);
  line(W-m, m, W-m-L, m); line(W-m, m, W-m, m+L);
  line(m, H-m, m+L, H-m); line(m, H-m, m, H-m-L);
  line(W-m, H-m, W-m-L, H-m); line(W-m, H-m, W-m, H-m-L);
  pop();
}

// ─── Film grain ───────────────────────────────────────────────────────────────
function renderGrain() {
  grainLayer.clear();
  grainLayer.noStroke();
  const count = floor(W * H * 0.0014);
  for (let i = 0; i < count; i++) {
    const v = random(120, 220);
    grainLayer.fill(v, v, v, random(2, 6));
    grainLayer.circle(random(W), random(H), random(0.25, 0.9));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 70;
  const maxR  = dist(W/2, H/2, 0, 0) * 1.10;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.72, 1.0, 0, 110, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W/2, H/2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(floor(random(100000))); }
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('20260504_3d_' + ts(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseed(floor(random(100000))); return false; }
  return true;
}

// ─── Recording (mp4-muxer + WebCodecs) ───────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome or Edge.'); return; }
  if (typeof Mp4Muxer    === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording   = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording…', '#fff');
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus('Finalizing…', '#ccc');
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = '20260504_3d_' + ts() + '.mp4'; a.click();
  encoder.close();
  encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(t, c) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = t; el.style.color = c;
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_`
       + `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

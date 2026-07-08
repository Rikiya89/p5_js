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

// ─── Palette ──────────────────────────────────────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const PARAMS = {
  glowStrength:   1.18,
  animationSpeed: 1.0,
};

// ─── Scene constants ──────────────────────────────────────────────────────────
const SACRED = {
  // Outer Fibonacci-sphere lattice — golden-angle point distribution
  SHELL_COUNT: 89,     // Fibonacci number — density of the outer shell
  SHELL_R:     360,

  // Icosahedral edge cage inscribed inside the shell
  CAGE_R:      255,

  // Radiant core at the center
  CORE_R:      34,

  // Ceva theorem construction: triangle + 3 cevians meeting at one point
  CEVA_R:      225,

  // Great-circle orbit rings (armillary-sphere style), tilted at golden-ratio angles
  RING_COUNT:  3,
  RING_R:      300,

  // Peripheral dust field
  DUST_COUNT:  150,

  CAM_RADIUS:    1220,
  ROTATION_SPEED: 1,
  CAM_FOV:       0.82,
  FOG_NEAR:      560,
  FOG_FAR:       3400,

  COMPOSITION_Y: 0,
};

// Icosahedron — 12 vertices, 30 edges (pre-computed once)
const ICOSA_VERTS = (() => {
  const t = PHI;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1,-t, 0], [ 1,-t, 0],
    [ 0,-1, t], [0, 1, t], [ 0,-1,-t], [ 0, 1,-t],
    [ t, 0,-1], [t, 0, 1], [-t, 0,-1], [-t, 0, 1],
  ];
  return raw.map(v => {
    const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return [v[0]/l, v[1]/l, v[2]/l];
  });
})();

const ICOSA_EDGES = (() => {
  const edges = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) {
      const a = ICOSA_VERTS[i], b = ICOSA_VERTS[j];
      const dx = a[0]-b[0], dy = a[1]-b[1], dz = a[2]-b[2];
      const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < 1.12) edges.push([i, j]);
    }
  return edges;
})();

// Fibonacci sphere lattice — the outer shell of the sacred-geometry form.
// Golden-angle spacing gives near-uniform point density with no polar clustering.
const SHELL_NODES = (() => {
  const N = SACRED.SHELL_COUNT;
  return Array.from({ length: N }, (_, i) => {
    const phi   = Math.acos(1 - 2 * (i + 0.5) / N);
    const theta = TAU * i * PHI;
    return {
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi),
      z: Math.sin(phi) * Math.sin(theta),
      phase: (i / N) * TAU,
      freq:  1 + (i % 3),   // integer → seamless pulse
    };
  });
})();

// Shell lattice edges — connect each node to its nearest neighbours (parastichy
// links) so the shell reads as a woven geodesic cage rather than loose points.
const SHELL_EDGES = (() => {
  const N = SHELL_NODES.length;
  const edges = [];
  for (let i = 0; i < N; i++) {
    const dists = [];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const a = SHELL_NODES[i], b = SHELL_NODES[j];
      const dx = a.x-b.x, dy = a.y-b.y, dz = a.z-b.z;
      dists.push({ j, d: Math.sqrt(dx*dx+dy*dy+dz*dz) });
    }
    dists.sort((p, q) => p.d - q.d);
    for (let k = 0; k < 3; k++) {
      const j = dists[k].j;
      if (j > i) edges.push([i, j]);
    }
  }
  return edges;
})();

let pg, glowPg, halfPg, quartPg, eighthPg, sixteenthPg, grainPg;
let canvasEl = null;

let dustSeeds  = [];
let camEye     = { x: 0, y: 0, z: 0 };
let camYaw     = 0;
let breath     = 1.0;

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

  pg          = createGraphics(W, H, WEBGL); pg.pixelDensity(1);      pg.colorMode(RGB,255,255,255,255);
  glowPg      = createGraphics(W, H, WEBGL); glowPg.pixelDensity(1);  glowPg.colorMode(RGB,255,255,255,255);
  halfPg      = createGraphics(W>>1, H>>1);  halfPg.pixelDensity(1);
  quartPg     = createGraphics(W>>2, H>>2);  quartPg.pixelDensity(1);
  eighthPg    = createGraphics(W>>3, H>>3);  eighthPg.pixelDensity(1);
  sixteenthPg = createGraphics(W>>4, H>>4);  sixteenthPg.pixelDensity(1);
  grainPg     = createGraphics(W, H);        grainPg.pixelDensity(1);

  reseed(20260707);

  const el = id => document.getElementById(id);
  if (el('startBtn'))    el('startBtn').onclick = startRecording;
  if (el('stopBtn'))     el('stopBtn').onclick  = stopRecording;
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(s) {
  randomSeed(s); noiseSeed(s);
  bakeSeeds(); bakeGrain();
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear(); grainPg.noStroke();
  for (let i = 0, n = Math.floor(W * H * 0.0016); i < n; i++) {
    const v = random(110, 200);
    grainPg.fill(v, v, v, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.15, 0.85));
  }
  for (let i = 0, n = Math.floor(W * H * 0.000035); i < n; i++) {
    const v = random(210, 255);
    grainPg.fill(v, v, v, random(12, 34));
    grainPg.circle(random(W), random(H), random(0.4, 1.2));
  }
}

// ─── Seed baking ──────────────────────────────────────────────────────────────
function bakeSeeds() {
  dustSeeds = [];
  for (let k = 0; k < SACRED.DUST_COUNT; k++) {
    const th = random(TAU), el = random(-1, 1);
    const r  = 480 + Math.pow(random(), 0.6) * 900;
    const sq = Math.sqrt(Math.max(0, 1 - el * el));
    dustSeeds.push({
      x:   Math.cos(th) * sq * r,
      y:   el * r * 0.46,
      z:   Math.sin(th) * sq * r,
      tw:  random(TAU),
      twk: 2 + Math.floor(random(4)),
    });
  }
}

// ─── Fog ──────────────────────────────────────────────────────────────────────
function fogFactor(x, y, z) {
  const dx = x - camEye.x, dy = y - camEye.y, dz = z - camEye.z;
  const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const k  = Math.max(0, Math.min(1, (d - SACRED.FOG_NEAR) / (SACRED.FOG_FAR - SACRED.FOG_NEAR)));
  const s  = k * k * (3 - 2 * k);
  return Math.max(0, 1 - s);
}

// Shapes a -1..1 sine into a slower-at-the-extremes "held breath" curve —
// sin^3 keeps the same period/zero-crossings (still an integer harmonic of
// phase, so the loop stays seamless) but lingers near +-1 instead of racing
// through it, reading as a held inhale/exhale rather than a metronome.
function breathShape(s) { return s * s * s; }

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop  = (frame % LOOP_FRAMES) / LOOP_FRAMES;
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
  breath = 0.88 + 0.12 * breathShape(Math.sin(2 * phase - Math.PI * 0.5));

  pg.clear(); glowPg.clear();
  prepBuffer(pg,     phase);
  prepBuffer(glowPg, phase);

  drawScene(glowPg, loop, phase, true);
  drawScene(pg,     loop, phase, false);
  composite();
  drawHUD(loop);
  drawCornerBrackets();
  drawVignette();
}

function prepBuffer(g, phase) {
  g.blendMode(ADD);
  g.drawingContext.disable(g.drawingContext.DEPTH_TEST);
  applyCamera(g, phase);
}

// ─── Camera path ──────────────────────────────────────────────────────────────
// Tilted-plane crane orbit: the (x,z) orbit circle is rotated around Z by a
// slowly breathing tilt angle before the yaw spin is applied, so the camera
// arcs above and below the form like a slow crane move instead of a flat
// carousel spin. Every trig term uses an integer multiple of `ph` so the
// motion is bit-exact at loop=0 vs loop=1 (seamless export).
function cameraPath(ph) {
  camYaw = ph * SACRED.ROTATION_SPEED;
  const r    = SACRED.CAM_RADIUS + 45 * Math.sin(2 * ph);
  const tilt = 0.30 + 0.10 * Math.sin(ph);

  const x0 = Math.cos(camYaw) * r, z0 = Math.sin(camYaw) * r;
  const ex = x0 * Math.cos(tilt), ey = x0 * Math.sin(tilt), ez = z0;

  return {
    eye:   { x: ex, y: ey, z: ez },
    lookY: 14 * Math.sin(2 * ph) + 8 * Math.sin(3 * ph),
    up:    { x: 0, y: 1, z: 0 },
  };
}

function applyCamera(g, ph) {
  const cam = cameraPath(ph);
  camEye.x = cam.eye.x; camEye.y = cam.eye.y; camEye.z = cam.eye.z;
  g.perspective(SACRED.CAM_FOV, W / H, 10, 9000);
  g.camera(camEye.x, camEye.y, camEye.z, 0, cam.lookY, 0, cam.up.x, cam.up.y, cam.up.z);
}

// ─── 4-pass bloom ────────────────────────────────────────────────────────────
function composite() {
  background(BG_R, BG_G, BG_B);
  halfPg.clear();      halfPg.image(glowPg,    0, 0, W>>1, H>>1);
  quartPg.clear();     quartPg.image(halfPg,    0, 0, W>>2, H>>2);
  eighthPg.clear();    eighthPg.image(quartPg,  0, 0, W>>3, H>>3);
  sixteenthPg.clear(); sixteenthPg.image(eighthPg, 0, 0, W>>4, H>>4);

  drawingContext.globalCompositeOperation = 'screen';
  tint(255, Math.round(48  * breath)); image(sixteenthPg, 0, 0, W, H);
  tint(255, Math.round(80  * breath)); image(eighthPg,    0, 0, W, H);
  tint(255, Math.round(152 * breath)); image(quartPg,     0, 0, W, H);
  tint(255, Math.round(235 * breath)); image(halfPg,      0, 0, W, H);
  noTint(); image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 16); image(grainPg, 0, 0); noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

// ─── Scene ────────────────────────────────────────────────────────────────────
function drawScene(g, loop, phase, isGlow) {
  g.push();
  g.translate(0, SACRED.COMPOSITION_Y, 0);
  g.noStroke();

  drawDust(g, phase, isGlow);         // 1. peripheral star sparkle — outside the breathing group

  // Whole-object breathing scale — a slow uniform dilation/contraction so the
  // sacred-geometry form reads as one living body, not just alpha-pulsing parts.
  const wholeBreath = 1 + 0.035 * breathShape(Math.sin(2 * phase - Math.PI * 0.5));
  g.push();
  g.scale(wholeBreath);
  drawOrbitRings(g, phase, isGlow);   // 2. armillary great-circles
  drawIcosaCage(g, phase, isGlow);    // 3. inner sacred-geometry cage
  drawShell(g, phase, isGlow);        // 4. outer Fibonacci-sphere lattice
  drawCore(g, phase, isGlow);         // 5. radiant nucleus
  drawCevaTheorem(g, phase, isGlow);  // 6. theorem layer — concurrent cevians
  g.pop();

  g.pop();
}

// ─── Radiant core ─────────────────────────────────────────────────────────────
// Layered as a small stack of concentric spheres with falling alpha — a single
// flat sphere reads as a flat disc under additive blending; nesting 3 shells
// (dense hot center -> soft outer corona) gives it a luminous, stellar quality.
function drawCore(g, ph, isGlow) {
  const pulse = 1 + 0.08 * breathShape(Math.sin(2 * ph));
  const r     = SACRED.CORE_R * pulse * breath;
  const fog   = fogFactor(0, 0, 0);

  const layers = isGlow
    ? [{ k: 1.0, a: 60 }, { k: 1.6, a: 30 }, { k: 2.4, a: 14 }]
    : [{ k: 1.0, a: 235 }, { k: 1.35, a: 90 }, { k: 1.8, a: 34 }];

  g.push();
  g.noStroke();
  for (const layer of layers) {
    const alpha = layer.a * fog * (isGlow ? PARAMS.glowStrength : 1);
    g.fill(INK_R, INK_G, INK_B, alpha);
    g.sphere(r * layer.k, isGlow ? 12 : 20, isGlow ? 9 : 14);
  }
  g.pop();
}

// ─── Ceva theorem layer ──────────────────────────────────────────────────────
// For barycentric weights (a,b,c), the cevians from A/B/C through P hit the
// opposite sides at D/E/F and satisfy:
// (BD/DC) * (CE/EA) * (AF/FB) = (c/b) * (a/c) * (b/a) = 1.
// The moving point is always inside the triangle, so the theorem remains exact
// through the full seamless loop rather than becoming decorative coincidence.
function mix3(u, v, t) {
  return {
    x: u.x + (v.x - u.x) * t,
    y: u.y + (v.y - u.y) * t,
    z: u.z + (v.z - u.z) * t,
  };
}

function drawPointSphere(g, p, r, alpha, isGlow) {
  g.push();
  g.translate(p.x, p.y, p.z);
  g.noStroke();
  g.fill(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
  g.sphere(r, isGlow ? 10 : 14, isGlow ? 7 : 10);
  g.pop();
}

function drawCevaTheorem(g, ph, isGlow) {
  const R = SACRED.CEVA_R;
  const A = { x: 0,           y: -R,       z: 0 };
  const B = { x: -R * 0.866,  y: R * 0.5,  z: 0 };
  const C = { x: R * 0.866,   y: R * 0.5,  z: 0 };

  let wa = 0.36 + 0.09 * Math.sin(ph);
  let wb = 0.34 + 0.08 * Math.sin(2 * ph + 1.7);
  let wc = 0.30 + 0.07 * Math.sin(3 * ph + 3.1);
  const sum = wa + wb + wc;
  wa /= sum; wb /= sum; wc /= sum;

  const P = {
    x: A.x * wa + B.x * wb + C.x * wc,
    y: A.y * wa + B.y * wb + C.y * wc,
    z: 0,
  };
  const D = mix3(B, C, wc / (wb + wc));
  const E = mix3(C, A, wa / (wc + wa));
  const F = mix3(A, B, wb / (wa + wb));

  const fog = fogFactor(0, 0, 0);
  const theoremPulse = 0.72 + 0.28 * Math.sin(2 * ph + 0.4);
  const edgeAlpha = (isGlow ? 9 : 38) * fog * breath;
  const cevianAlpha = (isGlow ? 18 : 78) * fog * breath * theoremPulse;
  if (cevianAlpha < 1) return;

  g.push();
  g.rotateY(ph * 0.18);
  g.rotateX(0.48 + 0.08 * Math.sin(ph));
  g.rotateZ(-ph * 0.25);
  g.translate(0, 0, isGlow ? -6 : 6);

  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, edgeAlpha * (isGlow ? PARAMS.glowStrength : 1));
  g.strokeWeight(isGlow ? 5.2 : 1.5);
  g.line(A.x, A.y, A.z, B.x, B.y, B.z);
  g.line(B.x, B.y, B.z, C.x, C.y, C.z);
  g.line(C.x, C.y, C.z, A.x, A.y, A.z);

  g.stroke(INK_R, INK_G, INK_B, cevianAlpha * (isGlow ? PARAMS.glowStrength : 1));
  g.strokeWeight(isGlow ? 8.2 : 2.25);
  g.line(A.x, A.y, A.z, D.x, D.y, D.z);
  g.line(B.x, B.y, B.z, E.x, E.y, E.z);
  g.line(C.x, C.y, C.z, F.x, F.y, F.z);

  const markerAlpha = (isGlow ? 26 : 110) * fog * breath;
  drawPointSphere(g, A, isGlow ? 5.8 : 2.7, markerAlpha * 0.75, isGlow);
  drawPointSphere(g, B, isGlow ? 5.8 : 2.7, markerAlpha * 0.75, isGlow);
  drawPointSphere(g, C, isGlow ? 5.8 : 2.7, markerAlpha * 0.75, isGlow);
  drawPointSphere(g, D, isGlow ? 7.4 : 3.4, markerAlpha, isGlow);
  drawPointSphere(g, E, isGlow ? 7.4 : 3.4, markerAlpha, isGlow);
  drawPointSphere(g, F, isGlow ? 7.4 : 3.4, markerAlpha, isGlow);
  drawPointSphere(g, P, isGlow ? 12.5 : 5.4, markerAlpha * 1.35, isGlow);

  g.pop();
}

// ─── Icosahedral cage ─────────────────────────────────────────────────────────
// 30 edges, precessing slowly around Y with a slight wobble around X — the
// inner sacred-geometry skeleton, midground between the core and outer shell.
function drawIcosaCage(g, ph, isGlow) {
  const R    = SACRED.CAGE_R;
  const fog  = fogFactor(0, 0, R);
  const spin = ph * 0.5;
  const tilt = 0.22 + 0.05 * Math.sin(2 * ph);
  const alpha = (isGlow ? 18 : 68) * fog * breath;
  if (alpha < 1) return;

  // Same view-facing trick as the shell: near vertices read brighter than far
  // ones, so the cage reads as a solid rotating body instead of a flat wireframe.
  const camLen = Math.sqrt(camEye.x**2 + camEye.y**2 + camEye.z**2) + 1e-6;
  const camDirX = camEye.x/camLen, camDirY = camEye.y/camLen, camDirZ = camEye.z/camLen;
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const facing = (v) => {
    const x1 = v[0]*cs + v[2]*sn, z1 = -v[0]*sn + v[2]*cs, y1 = v[1];
    const y2 = y1*ct - z1*st, z2 = y1*st + z1*ct;
    const d = x1*camDirX + y2*camDirY + z2*camDirZ;
    return 0.4 + 0.6 * Math.max(0, d);
  };

  g.push();
  g.rotateY(spin);
  g.rotateX(tilt);
  g.stroke(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
  g.strokeWeight(isGlow ? 7.5 : 2.2);
  g.noFill();

  for (const [i, j] of ICOSA_EDGES) {
    const a = ICOSA_VERTS[i], b = ICOSA_VERTS[j];
    g.line(a[0]*R, a[1]*R, a[2]*R, b[0]*R, b[1]*R, b[2]*R);
  }

  g.noStroke();
  for (const v of ICOSA_VERTS) {
    const face = facing(v);
    g.fill(INK_R, INK_G, INK_B, (isGlow ? 22 : 85) * fog * breath * face);
    g.push();
    g.translate(v[0]*R, v[1]*R, v[2]*R);
    g.sphere((isGlow ? 7 : 3.2) * (0.7 + 0.3 * face));
    g.pop();
  }
  g.pop();
}

// ─── Outer Fibonacci-sphere shell ─────────────────────────────────────────────
// 89 nodes on a golden-angle lattice, connected to their 3 nearest neighbours
// (SHELL_EDGES) so it reads as a woven geodesic shell. Each node pulses at an
// integer harmonic of the loop phase; the whole shell precesses opposite the
// inner cage for parallax between the two layers.
// Rotates a unit shell-node direction by the same (rotateY spin, rotateZ wobble)
// transform applied to the WEBGL buffer, so JS can compute view-facing terms
// that match what's actually on screen.
function rotateShellNode(n, spin, wobble) {
  const cs = Math.cos(spin), sn = Math.sin(spin);
  const x1 = n.x*cs + n.z*sn, z1 = -n.x*sn + n.z*cs, y1 = n.y;
  const cw = Math.cos(wobble), sw = Math.sin(wobble);
  return { x: x1*cw - y1*sw, y: x1*sw + y1*cw, z: z1 };
}

function drawShell(g, ph, isGlow) {
  const R      = SACRED.SHELL_R;
  const spin   = -ph * 0.35;
  const wobble = 0.12 * Math.sin(ph);

  g.push();
  g.rotateY(spin);
  g.rotateZ(wobble);

  // View-facing term: nodes whose surface normal points toward the camera read
  // brighter, the far side of the shell dims — this is what turns a flat wireframe
  // into something that reads as a lit, dimensional sphere.
  const camLen = Math.sqrt(camEye.x**2 + camEye.y**2 + camEye.z**2) + 1e-6;
  const camDirX = camEye.x/camLen, camDirY = camEye.y/camLen, camDirZ = camEye.z/camLen;
  const facingTerm = (rot) => {
    const d = rot.x*camDirX + rot.y*camDirY + rot.z*camDirZ; // -1 (far) .. 1 (near)
    return 0.35 + 0.65 * Math.max(0, d);
  };

  // Edges first (dimmer — structural lattice)
  g.noFill();
  const edgeAlphaBase = (isGlow ? 5 : 20) * breath;
  for (const [i, j] of SHELL_EDGES) {
    const a = SHELL_NODES[i], b = SHELL_NODES[j];
    const ax = a.x*R, ay = a.y*R, az = a.z*R;
    const bx = b.x*R, by = b.y*R, bz = b.z*R;
    const fog = fogFactor((ax+bx)*0.5, (ay+by)*0.5, (az+bz)*0.5);
    if (fog < 0.05) continue;
    const rotA = rotateShellNode(a, spin, wobble), rotB = rotateShellNode(b, spin, wobble);
    const face = (facingTerm(rotA) + facingTerm(rotB)) * 0.5;
    g.stroke(INK_R, INK_G, INK_B, edgeAlphaBase * fog * face * (isGlow ? PARAMS.glowStrength : 1));
    g.strokeWeight(isGlow ? 3.8 : 1.1);
    g.line(ax, ay, az, bx, by, bz);
  }

  // Nodes on top — pulsing points, brighter than the lattice lines
  g.noStroke();
  for (const n of SHELL_NODES) {
    const px = n.x*R, py = n.y*R, pz = n.z*R;
    const fog = fogFactor(px, py, pz);
    if (fog < 0.05) continue;
    const face  = facingTerm(rotateShellNode(n, spin, wobble));
    const pulse = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(n.freq * ph + n.phase), 1.8);
    const alpha = (isGlow ? 14 : 52) * fog * pulse * face * breath;
    if (alpha < 1) continue;
    g.push();
    g.translate(px, py, pz);
    g.fill(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
    g.sphere((isGlow ? 6 + pulse * 4 : 2.0 + pulse * 1.6) * (0.7 + 0.3 * face));
    g.pop();
  }
  g.pop();
}

// ─── Armillary orbit rings ────────────────────────────────────────────────────
// 3 great-circle rings at golden-ratio-related tilt angles, precessing at
// different integer-harmonic rates so they read as independent orbits rather
// than one rotating rigid assembly.
// Light-echo trail count/spacing for the fast-rotating rings. Each echo is a
// real ring drawn at an earlier phase, dimmer than the last — since it's an
// actual 3D object (not a screen-space smear), it stays correct under the
// moving camera instead of streaking the whole frame.
const RING_TRAIL_ECHOES = 4;
const RING_TRAIL_SPACING = 0.045;   // radians of ph between echoes

function drawOrbitRings(g, ph, isGlow) {
  const rings = [
    { tiltX: Math.PI / PHI,           tiltZ: 0,               spinRate: 1 },
    { tiltX: Math.PI / (PHI * PHI),   tiltZ: Math.PI * 0.5,   spinRate: -1 },
    { tiltX: Math.PI * 0.5,           tiltZ: Math.PI / PHI,   spinRate: 2 },
  ];
  const segs = 96;

  for (let ri = 0; ri < SACRED.RING_COUNT; ri++) {
    const rg  = rings[ri];
    const fog = fogFactor(0, 0, 0);
    const shimmer = 0.6 + 0.4 * Math.sin(2 * ph + ri * 1.1);
    const baseAlpha = (isGlow ? 14 : 55) * fog * shimmer * breath;
    if (baseAlpha < 1) continue;

    for (let e = 0; e <= RING_TRAIL_ECHOES; e++) {
      const echoPh = ph - e * RING_TRAIL_SPACING;
      const echoFalloff = 1 - e / (RING_TRAIL_ECHOES + 1);   // 1 (now) -> ~0.2 (oldest)
      const alpha = baseAlpha * echoFalloff * echoFalloff;   // quadratic — trail fades fast
      if (alpha < 1) continue;

      g.push();
      g.rotateX(rg.tiltX);
      g.rotateZ(rg.tiltZ + rg.spinRate * echoPh * 0.4);
      g.stroke(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
      g.strokeWeight((isGlow ? 6.5 : 2.1) * (0.55 + 0.45 * echoFalloff));
      g.noFill();

      for (let s = 0; s < segs; s++) {
        if (s % 5 === 4) continue;   // dashed — every 5th segment skipped
        const a0 = (s / segs) * TAU, a1 = ((s+1) / segs) * TAU;
        g.line(
          Math.cos(a0)*SACRED.RING_R, Math.sin(a0)*SACRED.RING_R, 0,
          Math.cos(a1)*SACRED.RING_R, Math.sin(a1)*SACRED.RING_R, 0
        );
      }
      g.pop();
    }
  }
  g.noStroke();
}

// ─── Dust ─────────────────────────────────────────────────────────────────────
function drawDust(g, ph, isGlow) {
  const stride = isGlow ? 5 : 2;
  for (let i = 0; i < dustSeeds.length; i += stride) {
    const d   = dustSeeds[i];
    const fog = fogFactor(d.x, d.y, d.z);
    if (fog < 0.04) continue;
    const tw    = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(d.twk * ph + d.tw), 2.2);
    const aBase = (isGlow ? 6 : 22) * tw * fog * breath;
    if (aBase < 1) continue;

    g.push();
    g.translate(d.x, d.y, d.z);
    g.rotateY(camYaw);

    g.noStroke();
    g.fill(INK_R, INK_G, INK_B, aBase * (isGlow ? PARAMS.glowStrength : 1));
    g.circle(0, 0, 1.6);

    if (!isGlow) {
      const arm = 3.8 * tw;
      g.noFill();
      g.stroke(INK_R, INK_G, INK_B, aBase * 0.55);
      g.strokeWeight(0.5);
      g.line(-arm, 0, arm, 0);
      g.line(0, -arm * 0.62, 0, arm * 0.62);
      g.noStroke();
    }
    g.pop();
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');
  fill(255, 255, 255, 140);
  textSize(13); textAlign(LEFT, TOP);
  text('SACRED GEOMETRY · CEVA THEOREM SPHERE', 52, 52);
  fill(255, 255, 255, 60);
  textSize(10);
  text('fibonacci shell=' + SACRED.SHELL_COUNT
    + '  ceva product=1  icosa cage=12v/30e  rings=' + SACRED.RING_COUNT
    + '  loop=' + loop.toFixed(3), 52, 74);
  fill(255, 255, 255, 45); textSize(10);
  textAlign(LEFT, BOTTOM);  text(W + '×' + H + ' · ' + FPS + 'fps', 52, H - 52);
  textAlign(RIGHT, BOTTOM); text('20260707 · CEVA THEOREM', W - 52, H - 52);
  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push(); noFill(); stroke(255, 255, 255, 38); strokeWeight(0.7);
  const m = 34, L = 24;
  line(m,m,m+L,m); line(m,m,m,m+L);
  line(W-m,m,W-m-L,m); line(W-m,m,W-m,m+L);
  line(m,H-m,m+L,H-m); line(m,H-m,m,H-m-L);
  line(W-m,H-m,W-m-L,H-m); line(W-m,H-m,W-m,H-m-L);
  pop();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push(); noFill();
  const steps = 80, maxR = dist(W/2, H/2, 0, 0) * 1.12;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.60, 1.0, 0, 150, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W/2, H/2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(Math.floor(random(100000))); }
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('metatron_' + ts(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseed(Math.floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory', firstTimestampBehavior: 'offset',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (e) => { console.error(e); isRecording = false; setStatus('Error','#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0; isRecording = true;
  const el = id => document.getElementById(id);
  if (el('duration'))   el('duration').textContent   = '0.0';
  if (el('frameCount')) el('frameCount').textContent = '0';
  if (el('startBtn'))   el('startBtn').disabled = true;
  if (el('stopBtn'))    el('stopBtn').disabled  = false;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Recording…', '#fff');
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus('Finalizing…', '#ccc');
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'metatron_' + ts() + '.mp4'; a.click();
  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn'))  el('stopBtn').disabled  = true;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready','#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(txt, c) {
  const el = document.getElementById('status');
  if (el) { el.textContent = txt; el.style.color = c; }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

if (typeof window !== 'undefined') {
  window.startRecording = startRecording;
  window.stopRecording  = stopRecording;
}

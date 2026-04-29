'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

// ─── Speed ────────────────────────────────────────────────────────────────────
const LOOP_FRAMES = FPS * 12;   // 12-second loop
const GLOBAL_RATE = 1;

// ─── Math constants ───────────────────────────────────────────────────────────
const PHI = 1.61803398875;
const TAU = Math.PI * 2;

// ─── Knot parameters ──────────────────────────────────────────────────────────
// A (p, q) torus knot lives on the surface of a torus.
// gcd(p, q) = 1 ⇒ a single closed strand.
// (3, 8) gives a triquetra-like Celtic braid; (2, 7) is leaner; (4, 9) busier.
// We'll let the user choose this in the TODO below.
// (2, 3) is the trefoil — the simplest non-trivial knot and the geometric
// heart of the Celtic triquetra. We render THREE of them, rotated by 120°
// around the polar axis, to create a true triple-interlaced Trinity Knot.
const KNOT_P = 2;
const KNOT_Q = 3;
const KNOT_R1 = 200;            // major radius (torus center → tube center)
const KNOT_R2 = 78;             // minor radius (torus tube)
const KNOT_STEPS = 360;         // sample density along the strand
const TUBE_SIDES = 6;           // cross-section polygon
const TUBE_RADIUS = 6.4;        // physical thickness of the strand
const STRAND_COUNT = 3;         // three interlaced trefoils → Trinity Knot

// ─── State ────────────────────────────────────────────────────────────────────
let trailLayer = null;
let grainLayer = null;
let webglLayer = null;

let phaseA = 0, phaseB = 0, phaseC = 0;
let knotSamples = [];           // pre-computed centerline + frame
let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;
let canvasEl = null;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  noFill();
  strokeCap(ROUND);

  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  trailLayer.colorMode(RGB, 255, 255, 255, 255);
  trailLayer.strokeCap(ROUND);
  trailLayer.background(0, 0, 0);

  webglLayer = createGraphics(W, H, WEBGL);
  webglLayer.pixelDensity(1);
  webglLayer.colorMode(RGB, 255, 255, 255, 255);
  webglLayer.noFill();
  webglLayer.strokeCap(ROUND);
  webglLayer.strokeJoin(ROUND);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseedPattern(floor(random(100000)));

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
function reseedPattern(seed) {
  randomSeed(seed);
  noiseSeed(seed);
  phaseA = random(TAU);
  phaseB = random(TAU);
  phaseC = random(TAU);
  knotSamples = buildTorusKnot(KNOT_P, KNOT_Q, KNOT_R1, KNOT_R2, KNOT_STEPS);
  if (trailLayer) trailLayer.background(0, 0, 0);
}

// ─── Torus knot centerline + parallel-transport frame ─────────────────────────
// Standard parametrization:
//   x = (R1 + R2·cos(q·t)) · cos(p·t)
//   y = (R1 + R2·cos(q·t)) · sin(p·t)
//   z =        R2·sin(q·t)
// We then attach a smoothly rotating orthonormal frame (T, N, B) to each
// sample so we can extrude a tube without flipping.
function buildTorusKnot(p, q, R1, R2, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * TAU;
    const cq = Math.cos(q * t), sq = Math.sin(q * t);
    const cp = Math.cos(p * t), sp = Math.sin(p * t);
    const r = R1 + R2 * cq;
    pts.push({ x: r * cp, y: r * sp, z: R2 * sq, s: i / steps, u: t });
  }

  // tangents
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    let tx = b.x - a.x, ty = b.y - a.y, tz = b.z - a.z;
    const tl = Math.hypot(tx, ty, tz) + 1e-9;
    a.tx = tx / tl; a.ty = ty / tl; a.tz = tz / tl;
  }

  // parallel-transport frame: pick a reasonable starting normal,
  // then for each step rotate the previous N around (T_prev × T_curr).
  let Nx = 0, Ny = 0, Nz = 1;
  // make N perpendicular to T0
  let dot = pts[0].tx * Nx + pts[0].ty * Ny + pts[0].tz * Nz;
  Nx -= dot * pts[0].tx; Ny -= dot * pts[0].ty; Nz -= dot * pts[0].tz;
  let nl = Math.hypot(Nx, Ny, Nz) + 1e-9;
  Nx /= nl; Ny /= nl; Nz /= nl;

  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (i > 0) {
      const prev = pts[i - 1];
      // axis = T_prev × T_curr
      const ax = prev.ty * a.tz - prev.tz * a.ty;
      const ay = prev.tz * a.tx - prev.tx * a.tz;
      const az = prev.tx * a.ty - prev.ty * a.tx;
      const al = Math.hypot(ax, ay, az);
      if (al > 1e-7) {
        const c = prev.tx * a.tx + prev.ty * a.ty + prev.tz * a.tz;
        const s = al;
        const ux = ax / al, uy = ay / al, uz = az / al;
        // Rodrigues rotation of N by angle whose cos=c, sin=s about u
        const nDotU = Nx * ux + Ny * uy + Nz * uz;
        const cx = uy * Nz - uz * Ny;
        const cy = uz * Nx - ux * Nz;
        const cz = ux * Ny - uy * Nx;
        const rx = Nx * c + cx * s + ux * nDotU * (1 - c);
        const ry = Ny * c + cy * s + uy * nDotU * (1 - c);
        const rz = Nz * c + cz * s + uz * nDotU * (1 - c);
        Nx = rx; Ny = ry; Nz = rz;
      }
      // re-orthogonalise against T (drift correction)
      const d2 = Nx * a.tx + Ny * a.ty + Nz * a.tz;
      Nx -= d2 * a.tx; Ny -= d2 * a.ty; Nz -= d2 * a.tz;
      nl = Math.hypot(Nx, Ny, Nz) + 1e-9;
      Nx /= nl; Ny /= nl; Nz /= nl;
    }
    a.nx = Nx; a.ny = Ny; a.nz = Nz;
    // B = T × N
    a.bx = a.ty * Nz - a.tz * Ny;
    a.by = a.tz * Nx - a.tx * Nz;
    a.bz = a.tx * Ny - a.ty * Nx;
  }
  return pts;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const la = loop * TAU * GLOBAL_RATE;

  trailLayer.clear();
  trailLayer.background(0, 0, 0);

  renderScene(la, loop);

  background(0);
  image(trailLayer, 0, 0);

  push();
  tint(255, 18);
  image(grainLayer, 0, 0);
  noTint();
  pop();

  drawCornerBrackets();
  drawHUD(la, loop);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderScene(la, loop) {
  webglLayer.clear();
  webglLayer.push();
  webglLayer.background(0, 0, 0, 0);
  webglLayer.noFill();

  // ── Camera ────────────────────────────────────────────────────────────────
  // Pulled well back with a tighter (longer-focal-length) lens — gives the
  // composition negative space on all sides and reduces perspective distortion
  // so the trinity reads as a flat illuminated emblem rather than a bulging 3D
  // form pressed against the lens. The slight downward tilt (camY < 0 with
  // lookAt at origin) tilts the trinity's plane forward, which is the classic
  // manuscript-illumination viewing angle.
  const camZ = 1820 + 30 * Math.sin(la + phaseC);   // was 980 — much further
  const camX =   28 * Math.sin(la * 0.5 + phaseA * 0.2);
  const camY = -210 + 14 * Math.cos(la * 0.5 + phaseB * 0.2);

  webglLayer.camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);
  // Narrower FOV (~28°) — Celtic emblems read better through a long lens
  webglLayer.perspective(Math.PI / 6.4, W / H, 0.1, 8000);

  // Slower rotation — half a Y rotation per loop reads as meditative
  webglLayer.rotateX(-0.34 + 0.05 * Math.sin(la));
  webglLayer.rotateY(la * 0.25);
  webglLayer.rotateZ(0.04 * Math.sin(la * 0.5 + phaseB));
  webglLayer.scale(1.10 + 0.03 * Math.sin(la));

  drawBackgroundLattice(la, loop);
  drawHaloRings(la);
  drawTriquetraFigure(la);

  // Three interlaced trefoils, rotated by 120° each — the Trinity Knot.
  // Each strand also gets a small per-strand phase offset so the breathing
  // wave drifts between strands rather than locking together.
  for (let strand = 0; strand < STRAND_COUNT; strand++) {
    webglLayer.push();
    webglLayer.rotateY(strand * (TAU / STRAND_COUNT));
    // Slight tilt per strand so they actually weave rather than overlap flat
    webglLayer.rotateX(0.18 * Math.sin(strand * (TAU / 3) + la * 0.5));
    drawCelticKnotTube(la + strand * (TAU / 6), loop, strand);
    drawKnotShadowStrands(la + strand * (TAU / 6), strand);
    webglLayer.pop();
  }

  drawLobeJewels(la);
  drawCenterMark(la);

  webglLayer.pop();
  trailLayer.image(webglLayer, 0, 0);
}

// ─── The Celtic knot itself: extruded tube along the (p,q) torus knot ────────
// Per-sample modulation: golden-ratio breathing scales each point on the
// strand by a slowly-rolling wave whose frequency is the irrational PHI,
// so the wave never aligns with the q-fold lobe pattern → quasiperiodic life.
// Returns a NEW point; does not mutate the cached sample.
function modulatedPoint(a, t) {
  const breath = 1
    + 0.040 * Math.sin(PHI * a.s * TAU + t * 0.9)        // primary golden wave
    + 0.018 * Math.sin(a.s * TAU * KNOT_Q + t * 1.4);    // q-fold ripple
  // small z-warble — keeps the strand from feeling perfectly flat
  const dz = 6 * Math.sin(a.s * TAU * 5 + t * 1.2);
  return {
    x: a.x * breath,
    y: a.y * breath,
    z: a.z * breath + dz,
    nx: a.nx, ny: a.ny, nz: a.nz,
    bx: a.bx, by: a.by, bz: a.bz,
    s:  a.s,
  };
}

function drawCelticKnotTube(t, loop, strandIdx = 0) {
  const pts = knotSamples;
  if (!pts.length) return;

  // Two travelling pulses (opposite directions), offset per strand so the
  // three trefoils visibly "pass" energy around the trinity.
  const strandPhase = strandIdx / STRAND_COUNT;
  const pulse1 = ((loop * 1.0) + strandPhase) % 1;
  const pulse2 = ((1 - loop * 0.7) + strandPhase * 0.5) % 1;
  const pulseSigma = 0.07;
  const gauss = (s, c) => {
    const d1 = Math.abs(s - c);
    const d  = Math.min(d1, 1 - d1);
    return Math.exp(-(d * d) / (2 * pulseSigma * pulseSigma));
  };

  // Pre-modulate every sample once per frame.
  const mp = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) mp[i] = modulatedPoint(pts[i], t);

  // Four passes — base body of the cord at uniform alpha (fast):
  //   1 outermost glow  (wide, very dim)
  //   2 doubled-cord edge ring (bright outline)
  //   3 inner shell     (mid alpha)
  //   4 centerline      (hairline highlight)
  // The travelling pulse is a SEPARATE sparse pass — see below.
  const passes = [
    { radius: TUBE_RADIUS * 2.30, sw: 0.40, alpha: 14,  sides: 4 },
    { radius: TUBE_RADIUS * 1.45, sw: 0.95, alpha: 130, sides: TUBE_SIDES },
    { radius: TUBE_RADIUS * 0.70, sw: 0.85, alpha: 90,  sides: TUBE_SIDES },
    { radius: 0,                  sw: 1.30, alpha: 215, sides: 1 },
  ];

  webglLayer.push();
  const breathGlobal = 1 + 0.018 * Math.sin(t * 0.6);
  webglLayer.scale(breathGlobal);

  for (let pi = 0; pi < passes.length; pi++) {
    const pass = passes[pi];
    webglLayer.strokeWeight(pass.sw);
    webglLayer.stroke(255, 255, 255, pass.alpha);     // ← set ONCE per pass

    if (pass.sides === 1) {
      webglLayer.beginShape();
      for (let i = 0; i < mp.length; i++) {
        const a = mp[i];
        webglLayer.vertex(a.x, a.y, a.z);
      }
      webglLayer.endShape(CLOSE);
      continue;
    }

    for (let s = 0; s < pass.sides; s++) {
      const ang0 = (s / pass.sides) * TAU;
      const phase = 0.20 * Math.sin(t * 0.7 + pi) + (pi % 2 ? t * 0.05 : -t * 0.05);
      webglLayer.beginShape();
      for (let i = 0; i < mp.length; i++) {
        const a = mp[i];
        const ang = ang0 + phase + 0.0010 * i * Math.sin(t * 0.4);
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const r = pass.radius;
        webglLayer.vertex(
          a.x + (a.nx * cs + a.bx * sn) * r,
          a.y + (a.ny * cs + a.by * sn) * r,
          a.z + (a.nz * cs + a.bz * sn) * r
        );
      }
      webglLayer.endShape(CLOSE);
    }
  }

  // ── Pulse highlight pass ─────────────────────────────────────────────────
  // Only draw vertices where the pulse Gaussian is meaningfully bright (>0.15).
  // Each pulse's window is ~3σ ≈ 0.21 of the loop, so we touch ~70 samples per
  // pulse instead of all 360. Single uniform stroke colour → fast.
  const PULSE_THRESH = 0.15;
  webglLayer.strokeWeight(1.6);
  webglLayer.stroke(255, 255, 255, 240);
  for (const pulseCenter of [pulse1, pulse2]) {
    webglLayer.beginShape();
    let drawing = false;
    for (let i = 0; i < mp.length; i++) {
      const a = mp[i];
      const g = gauss(a.s, pulseCenter);
      if (g >= PULSE_THRESH) {
        webglLayer.vertex(a.x, a.y, a.z);
        drawing = true;
      } else if (drawing) {
        webglLayer.endShape();
        webglLayer.beginShape();
        drawing = false;
      }
    }
    webglLayer.endShape();
  }

  // ── Travelling beads ─────────────────────────────────────────────────────
  // One bead per pulse — much cheaper than the previous "every 14 samples"
  // approach (which drew ~26 rings × 6 sides = 156 verts; this is ~12 verts).
  webglLayer.strokeWeight(0.6);
  webglLayer.stroke(255, 255, 255, 200);
  for (const pulseCenter of [pulse1, pulse2]) {
    // sample index closest to pulse centre
    const i = Math.floor(pulseCenter * mp.length) % mp.length;
    const a = mp[i];
    webglLayer.beginShape();
    for (let s = 0; s <= TUBE_SIDES; s++) {
      const ang = (s / TUBE_SIDES) * TAU;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      const r = TUBE_RADIUS * 1.45;
      webglLayer.vertex(
        a.x + (a.nx * cs + a.bx * sn) * r,
        a.y + (a.ny * cs + a.by * sn) * r,
        a.z + (a.nz * cs + a.bz * sn) * r
      );
    }
    webglLayer.endShape();
  }

  webglLayer.pop();
}

// ─── Phantom strands: faint copies offset in phase, like a triple weave ──────
function drawKnotShadowStrands(t, strandIdx = 0) {
  const pts = knotSamples;
  if (!pts.length) return;

  webglLayer.push();
  // Lighter shadows now that each strand is one of three — too many ghost
  // lines would muddle the interlace.
  const offsets = [
    { dt:  0.012, alpha: 22, sw: 0.35, scale: 1.020 },
    { dt: -0.012, alpha: 22, sw: 0.35, scale: 0.982 },
  ];
  // Per-strand alpha drift — each rotated copy gets its own shadow brightness
  // wave so the three strands feel distinct rather than identically ghosted.
  const strandTint = 0.7 + 0.3 * Math.sin(t * 0.5 + strandIdx * (TAU / 3));
  for (let oi = 0; oi < offsets.length; oi++) {
    const off = offsets[oi];
    const idxShift = Math.floor(off.dt * pts.length);
    webglLayer.stroke(255, 255, 255, off.alpha * strandTint);
    webglLayer.strokeWeight(off.sw);
    webglLayer.beginShape();
    for (let i = 0; i < pts.length; i++) {
      const src = pts[(i + idxShift + pts.length) % pts.length];
      const m = modulatedPoint(src, t);
      const wob = off.scale + 0.025 * Math.sin(t * 0.5 + i * 0.04 + oi);
      webglLayer.vertex(m.x * wob, m.y * wob, m.z * wob);
    }
    webglLayer.endShape(CLOSE);
  }
  webglLayer.pop();
}

// ─── Halo rings — tilted concentric circles forming a luminous well ──────────
function drawHaloRings(t) {
  webglLayer.push();
  const radii  = [KNOT_R1 - 60, KNOT_R1, KNOT_R1 + 60, KNOT_R1 + 150];
  const alphas = [44,           110,     58,           24];
  const N = 180;
  for (let i = 0; i < radii.length; i++) {
    webglLayer.stroke(255, 255, 255, alphas[i]);
    webglLayer.strokeWeight(i === 1 ? 0.7 : 0.45);
    webglLayer.push();
    const tiltX = 0.10 * Math.sin(t * 0.3 + i * 0.7);
    const tiltY = 0.10 * Math.cos(t * 0.25 + i * 0.5);
    webglLayer.rotateX(tiltX);
    webglLayer.rotateY(tiltY);
    webglLayer.rotateZ(t * 0.04 * (i % 2 ? 1 : -1));
    webglLayer.beginShape();
    for (let k = 0; k <= N; k++) {
      const th = (k / N) * TAU;
      const wob = 1 + 0.014 * Math.sin(th * 7 + t + i)
                    + 0.008 * Math.cos(th * 13 - t * 1.3 + i);
      webglLayer.vertex(Math.cos(th) * radii[i] * wob,
                        Math.sin(th) * radii[i] * wob, 0);
    }
    webglLayer.endShape();
    webglLayer.pop();
  }
  webglLayer.pop();
}

// ─── Background structure: radial spokes, star polygons, knotwork frame ─────
function drawBackgroundLattice(t, loop) {
  // ── Radial spokes — drawn in 3 batched tiers (cheap):
  //    minor (uniform stroke), major (uniform stroke), highlighted (sweep)
  webglLayer.push();
  const SPOKES = 48;
  // tier 1: minor spokes
  webglLayer.stroke(255, 255, 255, 12);
  webglLayer.strokeWeight(0.22);
  for (let i = 0; i < SPOKES; i++) {
    if (i % 4 === 0) continue;
    const a = (i / SPOKES) * TAU;
    const outer = 440 + 8 * Math.sin(t + i * 0.3);
    webglLayer.line(Math.cos(a) * 36, Math.sin(a) * 36, 0,
                    Math.cos(a) * outer, Math.sin(a) * outer, 0);
  }
  // tier 2: major spokes
  webglLayer.stroke(255, 255, 255, 32);
  webglLayer.strokeWeight(0.4);
  for (let i = 0; i < SPOKES; i += 4) {
    const a = (i / SPOKES) * TAU;
    const outer = 480 + 8 * Math.sin(t + i * 0.3);
    webglLayer.line(Math.cos(a) * 24, Math.sin(a) * 24, 0,
                    Math.cos(a) * outer, Math.sin(a) * outer, 0);
  }
  // tier 3: highlighted spoke under the travelling sweep — only ONE per frame
  const sweepIdx = Math.floor(loop * SPOKES) % SPOKES;
  webglLayer.stroke(255, 255, 255, 130);
  webglLayer.strokeWeight(0.7);
  for (let d = -2; d <= 2; d++) {
    const idx = (sweepIdx + d + SPOKES) % SPOKES;
    const a = (idx / SPOKES) * TAU;
    const fade = Math.exp(-d * d / 1.6);
    if (fade < 0.1) continue;
    webglLayer.stroke(255, 255, 255, 130 * fade);
    webglLayer.strokeWeight(0.4 + 0.5 * fade);
    webglLayer.line(Math.cos(a) * 30, Math.sin(a) * 30, 0,
                    Math.cos(a) * 470, Math.sin(a) * 470, 0);
  }
  webglLayer.pop();

  // ── {12/5} star polygon — slowly counter-rotating ──
  webglLayer.push();
  webglLayer.rotateZ(t * 0.05);
  webglLayer.stroke(255, 255, 255, 80);
  webglLayer.strokeWeight(0.55);
  const SR = 420;
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * TAU;
    const a1 = ((i + 5) / 12) * TAU;
    webglLayer.line(Math.cos(a0) * SR, Math.sin(a0) * SR, 0,
                    Math.cos(a1) * SR, Math.sin(a1) * SR, 0);
  }
  webglLayer.pop();

  // ── {16/7} star — denser, finer, opposite rotation ──
  webglLayer.push();
  webglLayer.rotateZ(-t * 0.035);
  webglLayer.stroke(255, 255, 255, 38);
  webglLayer.strokeWeight(0.35);
  const SR2 = 360;
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * TAU;
    const a1 = ((i + 7) / 16) * TAU;
    webglLayer.line(Math.cos(a0) * SR2, Math.sin(a0) * SR2, 0,
                    Math.cos(a1) * SR2, Math.sin(a1) * SR2, 0);
  }
  webglLayer.pop();

  // ── Outer knotwork frame: lemniscate-like figure-8 wreath ──
  // r(θ) = a · √|cos(2θ)|  (Bernoulli's lemniscate). We rotate it 4× to make
  // a four-leaf wreath, with each leaf gently breathing.
  webglLayer.push();
  webglLayer.rotateZ(t * 0.02);
  webglLayer.stroke(255, 255, 255, 26);
  webglLayer.strokeWeight(0.35);
  const lemA = 470 + 8 * Math.sin(t * 0.6);
  for (let leaf = 0; leaf < 4; leaf++) {
    webglLayer.push();
    webglLayer.rotateZ(leaf * (TAU / 4));
    webglLayer.beginShape();
    for (let k = 0; k <= 90; k++) {
      const th = (k / 90) * Math.PI - Math.PI / 2;
      const c2 = Math.cos(2 * th);
      if (c2 < 0) continue;
      const r = lemA * Math.sqrt(c2) * 0.55;
      webglLayer.vertex(r * Math.cos(th), r * Math.sin(th), 0);
    }
    webglLayer.endShape();
    webglLayer.pop();
  }
  webglLayer.pop();
}

// ─── Triquetra: classical Celtic Trinity symbol (animated) ───────────────────
// Three overlapping Vesica-Piscis arcs with centers on an equilateral triangle.
// Each arc is the boundary of a circle of radius R, centered at distance R
// from the origin — the geometric ancestor of all Celtic triple-knot patterns.
//
// Animation layers (all loop-coherent so the recording splices seamlessly):
//   1. Slow Z rotation of the whole glyph.
//   2. Each lobe arc "draws itself in" cyclically — a comet-tail of high alpha
//      sweeps along the arc, fading to base alpha behind it.
//   3. Three orbiting pearls travel around the binding ring at the speed of
//      the comet-tails — energy circulates through the figure.
//   4. Inner pulsing vesica lens that breathes 0.92 → 1.08.
//   5. A counter-rotating ghost triquetra at lower alpha for parallax depth.
function drawTriquetraFigure(t) {
  webglLayer.push();
  const R = 80;
  const D = R;
  const ARC_SEGS = 90;

  // Two glyphs: one rotates +0.06t, one rotates -0.10t, lower alpha.
  const passes = [
    { rot:  t * 0.06, alphaScale: 1.00, scale: 1.00 },
    { rot: -t * 0.10, alphaScale: 0.32, scale: 1.18 },
  ];

  for (let layer = 0; layer < passes.length; layer++) {
    const lp = passes[layer];
    webglLayer.push();
    webglLayer.rotateZ(lp.rot);
    webglLayer.scale(lp.scale);

    // Comet sweep position: cycles 0..1 once per ~6 seconds
    const sweepU = (t * 0.18) % 1;
    const sweepSigma = 0.18;

    for (let lobe = 0; lobe < 3; lobe++) {
      const cAng = lobe * (TAU / 3) - Math.PI / 2;
      const cx = Math.cos(cAng) * D;
      const cy = Math.sin(cAng) * D;
      const startA = cAng + Math.PI - Math.PI / 3;
      const endA   = cAng + Math.PI + Math.PI / 3;

      // ── Base pass: uniform stroke for the whole arc ──
      webglLayer.stroke(255, 255, 255, 110 * lp.alphaScale);
      webglLayer.strokeWeight(0.85);
      webglLayer.beginShape();
      for (let k = 0; k <= ARC_SEGS; k++) {
        const u = k / ARC_SEGS;
        const a = lerp(startA, endA, u);
        const rr = R * (1 + 0.014 * Math.sin(t + lobe + u * TAU));
        webglLayer.vertex(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0);
      }
      webglLayer.endShape();

      // ── Comet pass: only the tail segment, very bright ──
      // Each lobe's comet is offset by 1/3 → energy passes between lobes.
      const lobeSweep = (sweepU + lobe / 3) % 1;
      webglLayer.stroke(255, 255, 255, 230 * lp.alphaScale);
      webglLayer.strokeWeight(1.4);
      webglLayer.beginShape();
      for (let k = 0; k <= ARC_SEGS; k++) {
        const u = k / ARC_SEGS;
        const d1 = Math.abs(u - lobeSweep);
        const d  = Math.min(d1, 1 - d1);
        if (d > sweepSigma * 1.6) continue;
        const a = lerp(startA, endA, u);
        const rr = R * (1 + 0.014 * Math.sin(t + lobe + u * TAU));
        webglLayer.vertex(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0);
      }
      webglLayer.endShape();

      // ── Crisp inner thin line for definition ──
      webglLayer.stroke(255, 255, 255, 175 * lp.alphaScale);
      webglLayer.strokeWeight(0.4);
      webglLayer.beginShape();
      for (let k = 0; k <= ARC_SEGS; k++) {
        const u = k / ARC_SEGS;
        const a = lerp(startA, endA, u);
        const rr = R * 0.985;
        webglLayer.vertex(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0);
      }
      webglLayer.endShape();
    }
    webglLayer.pop();
  }

  // ── Inner Vesica-Piscis lens — breathing eye at the heart of the trinity ──
  // Two arcs sharing a chord; their intersection is the canonical "eye" shape
  // medieval scribes used as a layout primitive.
  const breath = 1 + 0.07 * Math.sin(t * 0.9);
  const lensR = 28 * breath;
  webglLayer.push();
  webglLayer.rotateZ(t * 0.18);
  // top arc
  webglLayer.stroke(255, 255, 255, 160);
  webglLayer.strokeWeight(0.7);
  for (let side = 0; side < 2; side++) {
    const sign = side === 0 ? 1 : -1;
    const cx = sign * lensR * 0.5;
    const cy = 0;
    webglLayer.beginShape();
    const A0 = sign > 0 ? Math.PI - Math.PI / 3 : -Math.PI / 3;
    const A1 = sign > 0 ? Math.PI + Math.PI / 3 :  Math.PI / 3;
    for (let k = 0; k <= 40; k++) {
      const a = lerp(A0, A1, k / 40);
      webglLayer.vertex(cx + Math.cos(a) * lensR, cy + Math.sin(a) * lensR, 0);
    }
    webglLayer.endShape();
  }
  // bright pinpoint in the lens
  webglLayer.stroke(255, 255, 255, 210);
  webglLayer.strokeWeight(2.2 + 0.8 * Math.sin(t * 1.2));
  webglLayer.point(0, 0, 0);
  webglLayer.pop();

  // ── Encircling binding ring + pulsing outer halo ──
  const ringR = R * 1.85;
  webglLayer.stroke(255, 255, 255, 80);
  webglLayer.strokeWeight(0.55);
  webglLayer.circle(0, 0, ringR);
  // outer faint halo that breathes with the lens
  webglLayer.stroke(255, 255, 255, 18 + 14 * Math.sin(t * 0.9));
  webglLayer.strokeWeight(2.5);
  webglLayer.circle(0, 0, ringR);

  // ── Three orbiting pearls on the binding ring ──
  // Speed matches the comet sweep so each pearl appears to be the comet's head.
  const orbU = (t * 0.18) % 1;
  for (let p = 0; p < 3; p++) {
    const a = (orbU + p / 3) * TAU - Math.PI / 2;
    const px = Math.cos(a) * (ringR / 2);
    const py = Math.sin(a) * (ringR / 2);
    // glow halo
    webglLayer.stroke(255, 255, 255, 60);
    webglLayer.strokeWeight(0.6);
    webglLayer.circle(px, py, 18);
    // pearl
    webglLayer.stroke(255, 255, 255, 235);
    webglLayer.strokeWeight(3.4);
    webglLayer.point(px, py, 0);
  }

  webglLayer.pop();
}

// ─── Lobe pearls: small luminous beads at each strand's outermost lobe tips ──
// In Celtic manuscript art, lobe extremities often bear illuminated pearls
// or knot terminations. For a (p,q) torus knot the lobes sit at angles where
// cos(qt) = +1, i.e. t = 2πk/q. We draw a small breathing pearl at each.
function drawLobeJewels(t) {
  for (let strand = 0; strand < STRAND_COUNT; strand++) {
    webglLayer.push();
    webglLayer.rotateY(strand * (TAU / STRAND_COUNT));
    webglLayer.rotateX(0.18 * Math.sin(strand * (TAU / 3) + t * 0.5));
    for (let k = 0; k < KNOT_Q; k++) {
      const u = k / KNOT_Q;
      const tk = u * TAU;
      const cq = Math.cos(KNOT_Q * tk), sq = Math.sin(KNOT_Q * tk);
      const cp = Math.cos(KNOT_P * tk), sp = Math.sin(KNOT_P * tk);
      const r = KNOT_R1 + KNOT_R2 * cq;
      const px = r * cp, py = r * sp, pz = KNOT_R2 * sq;
      // Breathing brightness staggered by lobe index → ripple around the rosette
      const ph = (t * 0.6 + k * (TAU / KNOT_Q) + strand * (TAU / STRAND_COUNT)) % TAU;
      const k01 = (Math.sin(ph) + 1) / 2;
      // Outer glow
      webglLayer.stroke(255, 255, 255, 28 + 50 * k01);
      webglLayer.strokeWeight(0.6);
      const rr = 14 + 6 * k01;
      webglLayer.push();
      webglLayer.translate(px, py, pz);
      webglLayer.circle(0, 0, rr * 2);
      // Pearl point
      webglLayer.stroke(255, 255, 255, 200 + 40 * k01);
      webglLayer.strokeWeight(3.2 + 1.5 * k01);
      webglLayer.point(0, 0, 0);
      webglLayer.pop();
    }
    webglLayer.pop();
  }
}

// ─── Bright dot + concentric breath at the origin to anchor depth ────────────
function drawCenterMark(t) {
  webglLayer.push();
  // bright pinpoint
  webglLayer.stroke(255, 255, 255, 235);
  webglLayer.strokeWeight(3.0);
  webglLayer.point(0, 0, 0);
  // expanding breath rings — 3 of them, staggered, fading as they grow
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.4 + i * (TAU / 3)) % TAU;
    const k  = (Math.sin(ph) + 1) / 2;          // 0..1
    const r  = lerp(6, 56, k);
    const al = 80 * (1 - k);
    webglLayer.stroke(255, 255, 255, al);
    webglLayer.strokeWeight(0.6);
    webglLayer.circle(0, 0, r * 2);
  }
  webglLayer.pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(la, loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');

  fill(255, 255, 255, 200);
  textSize(13);
  textAlign(LEFT, TOP);
  text('CELTIC TRINITY  ·  TRIPLE TREFOIL  ·  BW', 52, 54);

  fill(255, 255, 255, 95);
  textSize(10);
  text('triquetra · vesica piscis · doubled cord · golden phase ' + PHI.toFixed(5), 52, 74);

  // tiny rotating phase indicator — three dots tracing the loop position
  fill(255, 255, 255, 100 + 60 * Math.sin(la * 0.5));
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text('(p,q)=(' + KNOT_P + ',' + KNOT_Q + ') × ' + STRAND_COUNT +
       ' strands    phase = ' + loop.toFixed(3), 52, H - 54);

  textAlign(RIGHT, BOTTOM);
  fill(255, 255, 255, 72);
  text('20260429 · celtic trinity', W - 52, H - 54);

  // progress bar
  const barW = (W - 104) * loop;
  noFill();
  stroke(255, 255, 255, 34);
  strokeWeight(1);
  line(52, H - 36, W - 52, H - 36);
  stroke(255, 255, 255, 130);
  line(52, H - 36, 52 + barW, H - 36);

  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push();
  noFill();
  stroke(255, 255, 255, 70);
  strokeWeight(0.9);
  const m = 32, L = 28;
  line(m, m, m + L, m); line(m, m, m, m + L);
  line(W - m, m, W - m - L, m); line(W - m, m, W - m, m + L);
  line(m, H - m, m + L, H - m); line(m, H - m, m, H - m - L);
  line(W - m, H - m, W - m - L, H - m); line(W - m, H - m, W - m, H - m - L);
  pop();
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function renderGrain() {
  if (!grainLayer) return;
  grainLayer.clear();
  grainLayer.noStroke();
  const count = floor(W * H * 0.0011);
  for (let i = 0; i < count; i++) {
    const v = random(60, 210);
    grainLayer.fill(v, v, v, random(3, 12));
    grainLayer.circle(random(W), random(H), random(0.3, 1.4));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 60;
  const maxR = dist(W / 2, H / 2, 0, 0) * 1.08;
  const sw = (maxR / steps) * 2 + 2;
  strokeWeight(sw);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.78, 1.0, 0, 105, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseedPattern(floor(random(100000))); }
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('20260429_celtic_' + timestampString(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseedPattern(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome or Edge.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W,
    height: H,
    bitrate: 18_000_000,
    framerate: FPS,
  });

  recFrameCount = 0;
  isRecording = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
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
  a.download = '20260429_celtic_' + timestampString() + '.mp4';
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);

  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}
function updateRecordingUI() {
  const dEl = document.getElementById('duration');
  const fEl = document.getElementById('frameCount');
  if (dEl) dEl.textContent = (recFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recFrameCount;
}
function updateCanvasInfo() {
  const el = document.getElementById('canvasSize');
  if (el) el.textContent = W + ' × ' + H;
}
function timestampString() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_`
       + `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}


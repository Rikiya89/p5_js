'use strict';

// ─── Canvas ──────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = FPS * 30;
const TAU = Math.PI * 2;

// ─── Palette ─────────────────────────────────────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

// ─── Hilbert Space constants ──────────────────────────────────────────────────
const HILBERT = {
  BASIS_COUNT:       16,
  STATE_COUNT:       144,
  PROJECTION_COUNT:  96,
  SUBSPACE_RING_COUNT: 9,
  DUST_COUNT:        260,
  CLUSTER_COUNT:     128,
  TAIL_STEPS:        12,
  SPACE_RADIUS:      360,
  DEPTH_SPAN:        620,
  COMPOSITION_Y:    -160,
  ROTATION_SPEED:    1,
  CAM_RADIUS:        1480,
  CAM_FOV:           1.0,
  FOG_NEAR:          560,
  FOG_FAR:           3800,
};

// ─── Buffers ──────────────────────────────────────────────────────────────────
let pg, glowPg, halfPg, quartPg, eighthPg, grainPg, overlayPg;
let canvasEl = null;

// ─── Simulation state ─────────────────────────────────────────────────────────
let basisVecs = [];      // |eₙ⟩ — orthonormal basis directions
let stateParticles = []; // amplitude particles orbiting basis vectors
let dustParticles = [];  // static atmospheric dust
let subspaceRings = [];  // rings per basis subspace

// ─── Recording ───────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  if (typeof setAttributes === 'function') {
    setAttributes({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  }

  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) wrap.appendChild(canvasEl);

  pg = createGraphics(W, H, WEBGL);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);

  glowPg = createGraphics(W, H, WEBGL);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);

  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  halfPg.colorMode(RGB, 255, 255, 255, 255);

  quartPg = createGraphics(W >> 2, H >> 2);
  quartPg.pixelDensity(1);
  quartPg.colorMode(RGB, 255, 255, 255, 255);

  eighthPg = createGraphics(W >> 3, H >> 3);
  eighthPg.pixelDensity(1);
  eighthPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  grainPg.colorMode(RGB, 255, 255, 255, 255);

  overlayPg = createGraphics(W, H);
  overlayPg.pixelDensity(1);
  overlayPg.colorMode(RGB, 255, 255, 255, 255);

  bakeGrain();
  initHilbertSpace();

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

// ─── Hilbert Space initialisation ────────────────────────────────────────────
function initHilbertSpace() {
  basisVecs = [];
  const N = HILBERT.BASIS_COUNT;

  // Distribute N basis vectors uniformly on the unit sphere (Fibonacci spiral)
  for (let i = 0; i < N; i++) {
    const phi   = Math.acos(1 - 2 * (i + 0.5) / N);
    const theta = TAU * i * ((1 + Math.sqrt(5)) / 2);
    const ex = Math.sin(phi) * Math.cos(theta);
    const ey = Math.cos(phi);
    const ez = Math.sin(phi) * Math.sin(theta);
    const len = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
    basisVecs.push({
      ex: ex / len, ey: ey / len, ez: ez / len,
      axisLen: 180 + (i % 4) * 28,  // visual length of axis line
      ringRadius: 55 + (i % 5) * 22,
      ringPhaseOffset: (i / N) * TAU,
      phaseOffset: (i / N) * TAU,
    });
  }

  // Amplitude particles — each assigned to a basis index
  stateParticles = [];
  for (let i = 0; i < HILBERT.STATE_COUNT; i++) {
    const bIdx = i % N;
    stateParticles.push({
      basisIdx:   bIdx,
      orbitRadius: 28 + (i % 7) * 14,
      orbitPhase:  (i / HILBERT.STATE_COUNT) * TAU,
      orbitTilt:   (i % 5) / 5 * Math.PI,
      orbitSpeed:  0.28 + (i % 4) * 0.12,  // turns per loop
      tailPhases:  Array.from({ length: HILBERT.TAIL_STEPS }, (_, k) => k),
    });
  }

  // Atmospheric dust — static positions, twinkle at integer frequencies
  dustParticles = [];
  const R = HILBERT.SPACE_RADIUS * 2.2;
  for (let i = 0; i < HILBERT.DUST_COUNT; i++) {
    const phi   = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * TAU;
    const r     = 80 + Math.random() * R;
    dustParticles.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
      twinkleFreq: 1 + Math.floor(Math.random() * 4), // integer → seamless loop
      twinklePhase: Math.random() * TAU,
      baseAlpha: 3 + Math.random() * 9,
      size: 0.5 + Math.random() * 1.1,
    });
  }

  // Subspace rings — one per selected basis, wrap to BASIS_COUNT
  subspaceRings = [];
  for (let i = 0; i < HILBERT.SUBSPACE_RING_COUNT; i++) {
    const bIdx = Math.round(i * N / HILBERT.SUBSPACE_RING_COUNT) % N;
    subspaceRings.push({ basisIdx: bIdx, ringPhase: (i / HILBERT.SUBSPACE_RING_COUNT) * TAU });
  }
}

// ─── State vector |ψ⟩ at loop phase t ─────────────────────────────────────────
// Returns a unit 3D vector that breathes through the basis field
function getPsi(t) {
  const a1 = TAU * t;
  const a2 = TAU * t * 1.618;  // irrational ratio keeps motion non-periodic in 30s
  const a3 = TAU * t * 2.414;
  const px = Math.sin(a1) * Math.cos(a3 * 0.5);
  const py = Math.cos(a2) * 0.7 + Math.sin(a1 * 0.3) * 0.3;
  const pz = Math.sin(a3) * Math.cos(a2 * 0.7);
  const len = Math.sqrt(px * px + py * py + pz * pz) || 1;
  return { x: px / len, y: py / len, z: pz / len };
}

// ─── Inner product ⟨eₙ|ψ⟩ ────────────────────────────────────────────────────
function innerProduct(b, psi) {
  return b.ex * psi.x + b.ey * psi.y + b.ez * psi.z;
}

// ─── Fog attenuation (depth-based) ───────────────────────────────────────────
function fogAlpha(worldDepth, baseAlpha) {
  const near = HILBERT.FOG_NEAR, far = HILBERT.FOG_FAR;
  const d    = Math.abs(worldDepth);
  if (d < near) return baseAlpha;
  if (d > far)  return 0;
  const t = (d - near) / (far - near);
  return baseAlpha * (1 - t * t);
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function smoothstep(t) { const k = clamp01(t); return k * k * (3 - 2 * k); }
function clamp01(t)     { return Math.max(0, Math.min(1, t)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  const count = Math.floor(W * H * 0.0009);
  for (let i = 0; i < count; i++) {
    const v = 130 + Math.random() * 80;
    grainPg.fill(v, v, v, 2 + Math.random() * 4);
    grainPg.circle(Math.random() * W, Math.random() * H, 0.2 + Math.random() * 0.55);
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop  = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  const phase = loop * TAU;
  const psi   = getPsi(loop);

  // Per-frame projection coefficients cₙ = ⟨eₙ|ψ⟩
  const coefs = basisVecs.map(b => innerProduct(b, psi));

  pg.clear();
  glowPg.clear();
  overlayPg.clear();

  renderHilbertScene(loop, phase, psi, coefs);
  drawHUD(loop, psi, coefs);
  drawVignette();
  compositeFrame();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Scene rendering ──────────────────────────────────────────────────────────
function renderHilbertScene(loop, phase, psi, coefs) {
  prepCamera(glowPg, loop);
  prepCamera(pg, loop);

  // Glow pass
  glowPg.push();
  glowPg.blendMode(ADD);
  drawDust(glowPg, phase, true);
  drawBasisAxes(glowPg, coefs, true);
  drawProjectionLines(glowPg, psi, coefs, true);
  drawSubspaceRings(glowPg, phase, psi, coefs, true);
  drawStateVector(glowPg, psi, true);
  drawAmplitudeParticles(glowPg, loop, phase, psi, coefs, true);
  glowPg.pop();

  // Sharp pass
  pg.push();
  pg.blendMode(BLEND);
  drawDust(pg, phase, false);
  drawBasisAxes(pg, coefs, false);
  drawProjectionLines(pg, psi, coefs, false);
  drawSubspaceRings(pg, phase, psi, coefs, false);
  drawStateVector(pg, psi, false);
  drawAmplitudeParticles(pg, loop, phase, psi, coefs, false);
  pg.pop();
}

function prepCamera(g, loop) {
  const gl = g.drawingContext;
  gl.enable(gl.DEPTH_TEST);
  g.resetMatrix();

  // Scene visible zone: from y=HUD_TOP_H to y=H-HUD_BOT_H
  // Mid of that zone in pixels: (HUD_TOP_H + H - HUD_BOT_H) / 2
  // Canvas centre in pixels: H / 2
  // We want the scene to render at the zone mid, so we translate the
  // projection matrix by the offset in NDC. In p5 WEBGL the easiest
  // way is to shift the camera Y so the look-at sits at the zone mid.
  // Zone mid = (280 + 1520)/2 = 900;  canvas centre = 960
  // Offset in pixels = 900 - 960 = -60  (scene should appear 60px higher)
  // Convert to world-Y at cam distance: worldY = pixelOffset * (2*tan(fov/2) * camDist) / H
  const sceneMidPx  = (HUD_TOP_H + (H - HUD_BOT_H)) / 2;
  const canvasMidPx = H / 2;
  const pixelOffset = sceneMidPx - canvasMidPx;   // negative = shift up
  const fovHalfTan  = Math.tan(HILBERT.CAM_FOV / 2);
  const worldOffset = pixelOffset * (2 * fovHalfTan * HILBERT.CAM_RADIUS) / H;

  g.perspective(HILBERT.CAM_FOV, W / H, 10, 8000);

  const camAngle = loop * TAU;
  const camTilt  = 0.18 + Math.sin(loop * TAU) * 0.07;
  const cx = Math.cos(camAngle) * HILBERT.CAM_RADIUS;
  const cy = -HILBERT.CAM_RADIUS * camTilt;
  const cz = Math.sin(camAngle) * HILBERT.CAM_RADIUS;
  g.camera(cx, cy, cz, 0, worldOffset, 0, 0, 1, 0);
}

// ─── 1. Basis axes |eₙ⟩ ──────────────────────────────────────────────────────
function drawBasisAxes(g, coefs, isGlow) {
  const R = HILBERT.SPACE_RADIUS;
  for (let n = 0; n < basisVecs.length; n++) {
    const b   = basisVecs[n];
    const cn  = coefs[n];
    const amp = clamp01(Math.abs(cn));
    const x1  = b.ex * R * b.axisLen / 180;
    const y1  = b.ey * R * b.axisLen / 180;
    const z1  = b.ez * R * b.axisLen / 180;

    const baseAlpha = isGlow
      ? 4 + amp * 28
      : 18 + amp * 120;
    const wt = isGlow ? 5 + amp * 8 : 0.7 + amp * 1.4;

    g.push();
    g.stroke(INK_R, INK_G, INK_B, baseAlpha);
    g.strokeWeight(wt);
    g.noFill();
    g.line(0, 0, 0, x1, y1, z1);

    // Tip marker
    g.push();
    g.translate(x1, y1, z1);
    if (isGlow) {
      g.noStroke();
      g.fill(INK_R, INK_G, INK_B, 8 + amp * 35);
      g.sphere(isGlow ? 14 + amp * 18 : 5 + amp * 7);
    } else {
      g.noFill();
      g.stroke(INK_R, INK_G, INK_B, 30 + amp * 160);
      g.strokeWeight(0.6 + amp * 0.8);
      g.sphere(5 + amp * 7);
    }
    g.pop();
    g.pop();
  }
}

// ─── 2. State vector |ψ⟩ ─────────────────────────────────────────────────────
function drawStateVector(g, psi, isGlow) {
  const R   = HILBERT.SPACE_RADIUS * 1.18;
  const px  = psi.x * R;
  const py  = psi.y * R;
  const pz  = psi.z * R;

  g.push();
  g.stroke(INK_R, INK_G, INK_B, isGlow ? 30 : 200);
  g.strokeWeight(isGlow ? 12 : 2.2);
  g.noFill();
  g.line(0, 0, 0, px, py, pz);

  // Arrowhead tip
  g.push();
  g.translate(px, py, pz);
  if (isGlow) {
    g.noStroke();
    g.fill(INK_R, INK_G, INK_B, 45);
    g.sphere(38);
  } else {
    g.noFill();
    g.stroke(INK_R, INK_G, INK_B, 220);
    g.strokeWeight(1.8);
    g.sphere(12);
    g.strokeWeight(0.8);
    g.sphere(22);
  }
  g.pop();
  g.pop();
}

// ─── 3. Projection lines from |ψ⟩ toward each |eₙ⟩ ──────────────────────────
function drawProjectionLines(g, psi, coefs, isGlow) {
  const R   = HILBERT.SPACE_RADIUS;
  const pR  = R * 1.18;

  for (let n = 0; n < basisVecs.length; n++) {
    const cn  = coefs[n];
    const amp = clamp01(Math.abs(cn));
    if (amp < 0.04) continue;

    const b   = basisVecs[n];
    const bx  = b.ex * R * b.axisLen / 180;
    const by  = b.ey * R * b.axisLen / 180;
    const bz  = b.ez * R * b.axisLen / 180;
    const px  = psi.x * pR;
    const py  = psi.y * pR;
    const pz  = psi.z * pR;

    // Projection foot on basis line: scalar proj * basis direction
    const projLen = cn * R * b.axisLen / 180;
    const fpx = b.ex * projLen;
    const fpy = b.ey * projLen;
    const fpz = b.ez * projLen;

    const alpha = isGlow ? amp * 20 : amp * 110;
    const wt    = isGlow ? 3 + amp * 6 : 0.5 + amp * 1.0;

    g.push();
    g.noFill();
    g.stroke(INK_R, INK_G, INK_B, alpha);
    g.strokeWeight(wt);

    // Dashed-looking curved line: draw as series of short segments along a quadratic bezier
    const steps = 14;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      // Quadratic bezier: P→midpoint→foot
      const mx  = (px + fpx) * 0.5;
      const my  = (py + fpy) * 0.5;
      const mz  = (pz + fpz) * 0.5;
      const x0  = (1 - t0) * (1 - t0) * px + 2 * (1 - t0) * t0 * mx + t0 * t0 * fpx;
      const y0  = (1 - t0) * (1 - t0) * py + 2 * (1 - t0) * t0 * my + t0 * t0 * fpy;
      const z0  = (1 - t0) * (1 - t0) * pz + 2 * (1 - t0) * t0 * mz + t0 * t0 * fpz;
      const x1  = (1 - t1) * (1 - t1) * px + 2 * (1 - t1) * t1 * mx + t1 * t1 * fpx;
      const y1  = (1 - t1) * (1 - t1) * py + 2 * (1 - t1) * t1 * my + t1 * t1 * fpy;
      const z1  = (1 - t1) * (1 - t1) * pz + 2 * (1 - t1) * t1 * mz + t1 * t1 * fpz;
      if (s % 2 === 0) g.line(x0, y0, z0, x1, y1, z1);
    }

    // Perpendicular foot marker (shows the right-angle projection)
    if (!isGlow && amp > 0.15) {
      g.stroke(INK_R, INK_G, INK_B, amp * 60);
      g.strokeWeight(0.5);
      // short perpendicular tick
      const perpX = (px - fpx) * 0.06;
      const perpY = (py - fpy) * 0.06;
      const perpZ = (pz - fpz) * 0.06;
      g.line(fpx, fpy, fpz, fpx + perpX, fpy + perpY, fpz + perpZ);
    }
    g.pop();
  }
}

// ─── 4. Subspace rings ────────────────────────────────────────────────────────
function drawSubspaceRings(g, phase, psi, coefs, isGlow) {
  for (const ring of subspaceRings) {
    const b   = basisVecs[ring.basisIdx];
    const cn  = coefs[ring.basisIdx];
    const amp = clamp01(Math.abs(cn));
    const pulse = 0.72 + 0.28 * Math.sin(phase + ring.ringPhase);
    const rr  = (b.ringRadius + amp * 55) * pulse;
    const cx  = b.ex * HILBERT.SPACE_RADIUS * b.axisLen / 180;
    const cy  = b.ey * HILBERT.SPACE_RADIUS * b.axisLen / 180;
    const cz  = b.ez * HILBERT.SPACE_RADIUS * b.axisLen / 180;

    const alpha = isGlow ? 4 + amp * 22 : 14 + amp * 85;
    const wt    = isGlow ? 6 + amp * 9 : 0.8 + amp * 1.3;

    g.push();
    g.translate(cx, cy, cz);

    // Orient ring perpendicular to basis direction using two tangent vectors
    const up    = Math.abs(b.ey) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const t1x   = b.ey * up.z - b.ez * up.y;
    const t1y   = b.ez * up.x - b.ex * up.z;
    const t1z   = b.ex * up.y - b.ey * up.x;
    const t1l   = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1;
    const tx    = t1x / t1l, ty = t1y / t1l, tz = t1z / t1l;
    const t2x   = b.ey * tz - b.ez * ty;
    const t2y   = b.ez * tx - b.ex * tz;
    const t2z   = b.ex * ty - b.ey * tx;

    const segs = 42;
    g.noFill();
    g.stroke(INK_R, INK_G, INK_B, alpha);
    g.strokeWeight(wt);
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * TAU;
      const a1 = ((s + 1) / segs) * TAU;
      const x0 = tx * Math.cos(a0) * rr + t2x * Math.sin(a0) * rr;
      const y0 = ty * Math.cos(a0) * rr + t2y * Math.sin(a0) * rr;
      const z0 = tz * Math.cos(a0) * rr + t2z * Math.sin(a0) * rr;
      const x1 = tx * Math.cos(a1) * rr + t2x * Math.sin(a1) * rr;
      const y1 = ty * Math.cos(a1) * rr + t2y * Math.sin(a1) * rr;
      const z1 = tz * Math.cos(a1) * rr + t2z * Math.sin(a1) * rr;
      if (s % 3 !== 2) g.line(x0, y0, z0, x1, y1, z1);  // dashed look
    }
    g.pop();
  }
}

// ─── 5. Amplitude particles with trails ──────────────────────────────────────
// Particles orbit around basis vectors; brightness ∝ |cₙ|
function drawAmplitudeParticles(g, loop, phase, psi, coefs, isGlow) {
  const R = HILBERT.SPACE_RADIUS;

  for (const p of stateParticles) {
    const b   = basisVecs[p.basisIdx];
    const cn  = coefs[p.basisIdx];
    const amp = clamp01(Math.abs(cn));

    // Low-amplitude basis states fade out particles
    const visibility = smoothstep(amp - 0.05);
    if (visibility < 0.01) continue;

    const bx  = b.ex * R * b.axisLen / 180;
    const by  = b.ey * R * b.axisLen / 180;
    const bz  = b.ez * R * b.axisLen / 180;

    // Tangent frame around basis direction (same as ring)
    const up  = Math.abs(b.ey) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const t1x = b.ey * up.z - b.ez * up.y;
    const t1y = b.ez * up.x - b.ex * up.z;
    const t1z = b.ex * up.y - b.ey * up.x;
    const t1l = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1;
    const tx  = t1x / t1l, ty = t1y / t1l, tz = t1z / t1l;
    const t2x = b.ey * tz - b.ez * ty;
    const t2y = b.ez * tx - b.ex * tz;
    const t2z = b.ex * ty - b.ey * tx;

    // Tilt the orbit plane slightly
    const tiltC = Math.cos(p.orbitTilt), tiltS = Math.sin(p.orbitTilt);

    // Deterministic orbit angle for seamless loop
    const orbitAngle = p.orbitPhase + loop * TAU * p.orbitSpeed;

    const co = Math.cos(orbitAngle), si = Math.sin(orbitAngle);
    const orb = p.orbitRadius * (0.7 + amp * 0.4);

    function orbitPos(angle) {
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const lx = ca * orb;
      const ly = sa * orb * tiltC;
      const lz = sa * orb * tiltS;
      return {
        x: bx + tx * lx + t2x * ly + b.ex * lz,
        y: by + ty * lx + t2y * ly + b.ey * lz,
        z: bz + tz * lx + t2z * ly + b.ez * lz,
      };
    }

    const pos = orbitPos(orbitAngle);
    const baseAlpha = isGlow
      ? visibility * (8 + amp * 40)
      : visibility * (40 + amp * 160);

    // Trail (deterministic tail stepping backwards in angle)
    if (!isGlow) {
      g.noFill();
      g.stroke(INK_R, INK_G, INK_B, baseAlpha * 0.35);
      g.strokeWeight(0.6);
      const tail = HILBERT.TAIL_STEPS;
      const dAngle = (TAU * p.orbitSpeed) / LOOP_FRAMES;
      for (let k = 1; k <= tail; k++) {
        const a0 = orbitAngle - k * dAngle * 8;
        const a1 = orbitAngle - (k - 1) * dAngle * 8;
        const p0 = orbitPos(a0);
        const p1 = orbitPos(a1);
        const falloff = (1 - k / (tail + 1)) * visibility * amp;
        g.stroke(INK_R, INK_G, INK_B, falloff * 55);
        g.line(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
      }
    }

    // Particle dot
    g.push();
    g.translate(pos.x, pos.y, pos.z);
    g.noStroke();
    if (isGlow) {
      g.fill(INK_R, INK_G, INK_B, baseAlpha);
      g.sphere(7 + amp * 10);
    } else {
      g.fill(INK_R, INK_G, INK_B, baseAlpha);
      g.sphere(2.5 + amp * 3);
    }
    g.pop();
  }
}

// ─── 6. Atmospheric dust ──────────────────────────────────────────────────────
function drawDust(g, phase, isGlow) {
  g.noStroke();
  for (const d of dustParticles) {
    const tw = 0.5 + 0.5 * Math.sin(phase * d.twinkleFreq + d.twinklePhase);
    const a  = (isGlow ? d.baseAlpha * 0.4 : d.baseAlpha) * tw;
    if (a < 0.3) continue;
    g.fill(INK_R, INK_G, INK_B, a);
    g.push();
    g.translate(d.x, d.y, d.z);
    g.sphere(isGlow ? d.size * 2.2 : d.size);
    g.pop();
  }
}

// ─── Composite ────────────────────────────────────────────────────────────────
function compositeFrame() {
  background(BG_R, BG_G, BG_B);

  halfPg.clear();
  halfPg.image(glowPg, 0, 0, W >> 1, H >> 1);
  quartPg.clear();
  quartPg.image(halfPg, 0, 0, W >> 2, H >> 2);
  eighthPg.clear();
  eighthPg.image(quartPg, 0, 0, W >> 3, H >> 3);

  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 55);
  image(eighthPg, 0, 0, W, H);
  tint(255, 90);
  image(quartPg, 0, 0, W, H);
  tint(255, 190);
  image(halfPg, 0, 0, W, H);
  noTint();
  image(pg, 0, 0, W, H);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 9);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();

  image(overlayPg, 0, 0, W, H);
}

// ─── HUD overlay ─────────────────────────────────────────────────────────────
// Layout constants for HUD panels
const HUD_TOP_H    = 280;  // height of dark top strip
const HUD_BOT_H    = 400;  // height of dark bottom strip

function drawHUD(loop, psi, coefs) {
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const ctx  = overlayPg.drawingContext;
  const bm   = 52;   // bracket / text margin from canvas edge
  const bk   = 60;   // bracket arm length

  // ── Dark top panel
  ctx.save();
  ctx.fillStyle = `rgba(${BG_R},${BG_G},${BG_B},0.82)`;
  ctx.fillRect(0, 0, W, HUD_TOP_H);
  ctx.restore();

  // ── Dark bottom panel
  ctx.save();
  ctx.fillStyle = `rgba(${BG_R},${BG_G},${BG_B},0.82)`;
  ctx.fillRect(0, H - HUD_BOT_H, W, HUD_BOT_H);
  ctx.restore();

  // ── Separator lines
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(72, HUD_TOP_H); ctx.lineTo(W - 72, HUD_TOP_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(72, H - HUD_BOT_H); ctx.lineTo(W - 72, H - HUD_BOT_H); ctx.stroke();
  ctx.restore();

  // ── Corner brackets — top-left
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(bm + bk, bm); ctx.lineTo(bm, bm); ctx.lineTo(bm, bm + bk);
  ctx.stroke();
  ctx.restore();

  // ── Corner brackets — top-right
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(W - bm - bk, bm); ctx.lineTo(W - bm, bm); ctx.lineTo(W - bm, bm + bk);
  ctx.stroke();
  ctx.restore();

  // ── Corner brackets — bottom-left
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(bm + bk, H - bm); ctx.lineTo(bm, H - bm); ctx.lineTo(bm, H - bm - bk);
  ctx.stroke();
  ctx.restore();

  // ── Corner brackets — bottom-right
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(W - bm - bk, H - bm); ctx.lineTo(W - bm, H - bm); ctx.lineTo(W - bm, H - bm - bk);
  ctx.stroke();
  ctx.restore();

  // ── Top strip: title — two rows, ASCII only for reliable rendering
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.font         = `normal 30px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.82)';
  ctx.fillText('HILBERT SPACE', W / 2, 52);
  ctx.font      = `normal 19px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.36)';
  ctx.fillText('3D PROJECTION SIMULATOR', W / 2, 94);
  ctx.restore();

  // ── Top strip: formula rows — all ASCII, no Unicode math glyphs
  const loopStr = loop.toFixed(3);
  const maxAmp  = Math.max(...coefs.map(Math.abs)).toFixed(3);
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.font         = `normal 20px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.50)';
  ctx.fillText('|psi> = SUM c_n |e_n>     c_n = <e_n | psi>', W / 2, 132);
  ctx.font      = `normal 17px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.fillText(`basis=16   loop=${loopStr}   maxAmp=${maxAmp}   dim=INF`, W / 2, 165);
  ctx.restore();

  // ── Top strip: loop progress bar
  const pbX = 112, pbY = 230, pbW = W - 224, pbH = 4;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.roundRect(pbX, pbY, pbW, pbH, 3); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.60)';
  ctx.beginPath(); ctx.roundRect(pbX, pbY, pbW * loop, pbH, 3); ctx.fill();
  ctx.restore();

  // ── Bottom strip: layout built from the bottom upward
  // Row 1 (very bottom): footer text — date right, psi left
  const footY   = H - 48;   // baseline for footer row
  const barIdxY = footY - 40;        // index numbers above footer
  const barBotY = barIdxY - 8;       // bottom edge of bars
  const barMaxH = 170;
  const barTopY = barBotY - barMaxH; // top edge of bars
  const lblY    = barTopY - 14;      // section label above bars

  const nBars     = HILBERT.BASIS_COUNT;
  const barPadL   = 72;
  const barTotalW = W - barPadL * 2;
  const barSlot   = barTotalW / nBars;

  // Footer text — larger and brighter so it reads clearly
  ctx.save();
  ctx.font         = `normal 22px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.65)';
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  const pStr = `psi=(${psi.x.toFixed(2)}, ${psi.y.toFixed(2)}, ${psi.z.toFixed(2)})`;
  ctx.fillText(pStr, 72, footY);

  ctx.textAlign = 'right';
  ctx.fillText('20260627  HILBERT SPACE', W - 72, footY);
  ctx.restore();

  // Index numbers
  ctx.save();
  ctx.fillStyle    = 'rgba(255,255,255,0.28)';
  ctx.font         = `normal 16px ${MONO}`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  for (let n = 0; n < nBars; n++) {
    const bx = barPadL + n * barSlot + barSlot / 2;
    ctx.fillText(String(n + 1), bx, barIdxY);
  }
  ctx.restore();

  // Bar track bg
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let n = 0; n < nBars; n++) {
    const bx = barPadL + n * barSlot + 2;
    ctx.fillRect(bx, barTopY, barSlot - 4, barMaxH);
  }
  // Filled bars
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  for (let n = 0; n < nBars; n++) {
    const amp = clamp01(Math.abs(coefs[n]));
    const bh  = amp * barMaxH;
    const bx  = barPadL + n * barSlot + 2;
    ctx.fillRect(bx, barTopY + (barMaxH - bh), barSlot - 4, bh);
  }
  ctx.restore();

  // Section label above bars
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font         = `normal 19px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.36)';
  ctx.fillText('|c_n|  amplitude spectrum', W / 2, lblY);
  ctx.restore();

}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  overlayPg.push();
  overlayPg.noFill();
  const steps = 55;
  const maxR  = dist(W / 2, H / 2, 0, 0) * 1.1;
  overlayPg.strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.68, 1.0, 0, 100, true);
    if (a <= 0) continue;
    overlayPg.stroke(0, 0, 0, a);
    overlayPg.circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  overlayPg.pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function keyReleased() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('hilbert_space_' + ts(), 'png');
    return false;
  }
  return true;
}

// ─── Recording implementation ─────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer    === 'undefined') { alert('mp4-muxer not loaded.');     return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video:  { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (e)           => { console.error(e); isRecording = false; setStatus('Error', '#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording   = true;
  frameCount    = 0;
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = true;
  if (el('stopBtn'))  el('stopBtn').disabled  = false;
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
  a.href     = url;
  a.download = 'hilbert_space_' + ts() + '.mp4';
  a.click();
  encoder.close();
  encoder = null;
  muxer   = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn'))  el('stopBtn').disabled  = true;
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

function updateRecordingUi() {
  const el = id => document.getElementById(id);
  if (el('duration'))   el('duration').textContent   = (recFrameCount / FPS).toFixed(1);
  if (el('frameCount')) el('frameCount').textContent = recFrameCount;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
}

function setStatus(txt, c) {
  const el = document.getElementById('status');
  if (el) { el.textContent = txt; el.style.color = c; }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

window.startRecording = startRecording;
window.stopRecording  = stopRecording;
window.ts             = ts;

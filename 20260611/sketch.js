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

// ─── Rolle's Theorem constants ───────────────────────────────────────────────
// f(x) is built ONLY from basis terms that vanish at u = ±1:
//   (1 - u²), u·(1 - u²), sin(2πu)
// so f(A_END) = f(B_END) = 0 holds for EVERY animation phase — condition
// f(a) = f(b) of Rolle's Theorem is satisfied by construction, not by tuning.
// f is a polynomial + sine mix: continuous on [a,b], differentiable on (a,b),
// therefore at least one c in (a,b) with f'(c) = 0 exists; c is found
// numerically each frame (sign-scan + bisection), never placed by eye.
const ROLLE = {
  A_END: -1.0,            // a — left endpoint  (normalized u-space)
  B_END:  1.0,            // b — right endpoint
  C_REFERENCE: 0.0,       // for the pure even arch (h2=h3=0), f'(0)=0 exactly
  AMPLITUDE: 400,         // vertical scale of f in pixels
  SPAN_X: W * 0.60,       // curve scale: pixel width of [a, b]
  DEPTH_LAYERS: 9,        // depth: echo copies offset along z
  LAYER_SPACING: 68,
  CURVE_SAMPLES: 280,     // point count along the curve
  CHUNK: 20,              // samples per constant-alpha stroke chunk
  PARTICLE_COUNT: 220,    // particles flowing from a to b
  CLUSTER_COUNT: 100,     // dense halo around c
  CURTAIN_STEP: 2,        // plumb-line veil: one line every Nth sample
  DUST_COUNT: 260,        // ambient dust field for spatial depth
  TAIL_STEPS: 9,          // comet-tail segments per flow particle
  TAIL_DS: 0.0065,        // tail spacing in curve-parameter units
  ROTATION_SPEED: 1,      // camera revolutions per 30 s loop (integer → seamless)
  CAM_RADIUS: 1550,
  CAM_FOV: 1.0,
  FOG_NEAR: 600,
  FOG_FAR: 3800,
};
const HALF_SPAN = ROLLE.SPAN_X * 0.5;

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
let lastCps = [];                    // critical points found this frame
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

  // Flow particles travel a→b along the curve. Integer cycles-per-loop keeps
  // the 30 s wrap seamless; the sin(πs) fade hides each respawn at the ends.
  for (let i = 0; i < ROLLE.PARTICLE_COUNT; i++) {
    particleSeeds.push({
      off: random(),
      cycles: 1 + floor(random(3)),     // 1..3 trips per loop (integers)
      z: random(-70, 70),
      jPhase: random(TAU),
      size: random(2.2, 4.6),
    });
  }

  // Halo cluster: density concentrated around the critical point c.
  for (let j = 0; j < ROLLE.CLUSTER_COUNT; j++) {
    clusterSeeds.push({
      ang: random(TAU),
      rad: 8 + Math.pow(random(), 1.7) * 120,   // biased toward c
      spin: random() < 0.5 ? 2 : -2,            // integer spin → seamless
      wob: random(TAU),
      size: random(1.8, 4.2),
    });
  }

  // Ambient dust: static motes on a flattened shell around the scene —
  // the orbiting camera turns them into slow parallax.
  dustSeeds = [];
  for (let k = 0; k < ROLLE.DUST_COUNT; k++) {
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

// ─── Rolle Mathematics ───────────────────────────────────────────────────────
// Animated coefficients — every multiplier of ph is an INTEGER so the field
// returns to its exact starting shape at the loop boundary.
function rolleHarmonics(ph) {
  return {
    h1: 1.0 + 0.12 * Math.sin(2 * ph),   // even arch (dominant, keeps f readable)
    h2: 0.60 * Math.sin(ph),             // odd tilt
    h3: 0.18 * Math.cos(3 * ph) + 0.06 * Math.sin(4 * ph),  // richer fine ripple
  };
}

// f(u, t): each basis term is 0 at u = ±1, hence f(a) = f(b) = 0 for all t.
function rolleFunction(u, ph) {
  const { h1, h2, h3 } = rolleHarmonics(ph);
  return ROLLE.AMPLITUDE * (
    h1 * (1 - u * u) +
    h2 * u * (1 - u * u) +
    h3 * Math.sin(TAU * u)
  );
}

// df/du. World slope dy/dx = (df/du)/(dx/du) with dx/du = HALF_SPAN (constant),
// so f'(c) = 0 in u-space is exactly a horizontal tangent in world space.
function rolleDerivative(u, ph) {
  const { h1, h2, h3 } = rolleHarmonics(ph);
  return ROLLE.AMPLITUDE * (
    h1 * (-2 * u) +
    h2 * (1 - 3 * u * u) +
    h3 * TAU * Math.cos(TAU * u)
  );
}

// Find every c in (a, b) with f'(c) = 0: sign-change scan + bisection.
// Rolle's Theorem guarantees this list is never empty.
function findCriticalPoints(ph) {
  const cps = [];
  const N = 480, lo = -0.996, hi = 0.996;
  let prevU = lo, prevD = rolleDerivative(lo, ph);
  for (let i = 1; i <= N; i++) {
    const u = lo + (hi - lo) * i / N;
    const d = rolleDerivative(u, ph);
    if (prevD * d < 0) {
      let ua = prevU, ub = u, da = prevD;
      for (let k = 0; k < 40; k++) {
        const um = (ua + ub) * 0.5;
        const dm = rolleDerivative(um, ph);
        if (da * dm <= 0) ub = um; else { ua = um; da = dm; }
      }
      const uc = (ua + ub) * 0.5;
      if (!cps.length || Math.abs(uc - cps[cps.length - 1]) > 0.004) cps.push(uc);
    }
    prevU = u; prevD = d;
  }
  return cps.map(u => {
    const f = rolleFunction(u, ph);
    return { u, f, x: worldX(u), y: worldY(f) };
  });
}

function dominantCp() {
  let best = null;
  for (const cp of lastCps) if (!best || Math.abs(cp.f) > Math.abs(best.f)) best = cp;
  return best;
}

// ─── World Mapping ───────────────────────────────────────────────────────────
function worldX(u) { return u * HALF_SPAN; }
function worldY(f) { return -f; }   // positive f renders upward (p5 y-down)

function fogFactor(x, y, z) {
  const dx = x - camEye.x, dy = y - camEye.y, dz = z - camEye.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const k = Math.max(0, Math.min(1, (d - ROLLE.FOG_NEAR) / (ROLLE.FOG_FAR - ROLLE.FOG_NEAR)));
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
  lastCps = findCriticalPoints(phase);

  pg.clear();
  glowPg.clear();
  prepBuffer(pg, phase);
  prepBuffer(glowPg, phase);

  drawRolleScene(glowPg, phase, true);
  drawRolleScene(pg, phase, false);
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
  camYaw = ph * ROLLE.ROTATION_SPEED;
  const r  = ROLLE.CAM_RADIUS * 0.68 + 130 * Math.sin(2 * ph);
  const cy = -190;
  const ey = cy - 260 + 175 * Math.sin(ph) + 40 * Math.sin(3 * ph);
  camEye.x = Math.sin(camYaw) * r;
  camEye.y = ey;
  camEye.z = Math.cos(camYaw) * r;
  g.perspective(ROLLE.CAM_FOV, W / H, 10, 9000);
  g.camera(camEye.x, camEye.y, camEye.z, 0, cy + 38 * Math.sin(2 * ph), 0, 0, 1, 0);
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

// ─── Rolle Scene ──────────────────────────────────────────────────────────────
function drawRolleScene(g, phase, isGlow) {
  g.push();
  g.noFill();

  drawDust(g, phase, isGlow);
  drawCurtain(g, phase, isGlow);
  drawAxisAndChord(g, phase, isGlow);
  drawCurve(g, phase, isGlow);
  drawEndpoints(g, phase, isGlow);
  drawCriticalPoint(g, phase, isGlow);
  drawTangentLine(g, phase, isGlow);
  drawParticles(g, phase, isGlow);

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

// ─── Light Curtain ────────────────────────────────────────────────────────────
// Plumb lines hang from the curve to the chord: the area under f rendered as
// a falling veil. Taller curve → brighter thread, so the veil itself reads
// the function's height.
function drawCurtain(g, ph, isGlow) {
  const zs = isGlow ? [0] : [0, -ROLLE.LAYER_SPACING, ROLLE.LAYER_SPACING,
                                  -ROLLE.LAYER_SPACING * 2, ROLLE.LAYER_SPACING * 2];
  g.push();
  for (const zi of zs) {
    const isCenter = zi === 0;
    const ampScale = isCenter ? 1 : Math.max(0.55, 1 - Math.abs(zi) / (ROLLE.LAYER_SPACING * 3));
    const sideW = isCenter ? 1 : Math.max(0.25, 0.7 - Math.abs(zi) / (ROLLE.LAYER_SPACING * 4));
    for (let i = 0; i <= ROLLE.CURVE_SAMPLES; i += ROLLE.CURTAIN_STEP) {
      const u = -1 + 2 * i / ROLLE.CURVE_SAMPLES;
      const fv = rolleFunction(u, ph) * ampScale;
      if (Math.abs(fv) < 6) continue;
      const x = worldX(u);
      const hN = Math.abs(fv) / ROLLE.AMPLITUDE;
      const fog = fogFactor(x, worldY(fv) * 0.5, zi);
      // Height²  weighting concentrates glow near the crest
      const hW = 0.28 + 0.72 * hN * hN;
      applyStroke(g, isGlow, (isGlow ? 6 : 18) * hW * sideW * fog * breath, 0.55);
      g.line(x, 0, zi, x, worldY(fv), zi);
    }
  }
  g.pop();
}

// ─── Axis + Secant Chord ──────────────────────────────────────────────────────
// Because f(a) = f(b), the secant chord a→b is HORIZONTAL — the tangent at c
// (also horizontal) is therefore parallel to it: the picture of Rolle.
function drawAxisAndChord(g, ph, isGlow) {
  const xa = worldX(ROLLE.A_END);
  const xb = worldX(ROLLE.B_END);
  const fog = (fogFactor(xa, 0, 0) + fogFactor(xb, 0, 0)) * 0.5;

  g.push();
  applyStroke(g, isGlow, (isGlow ? 8 : 42) * fog, 0.6);
  g.line(xa - 52, 0, 0, xb + 52, 0, 0);

  applyStroke(g, isGlow, (isGlow ? 12 : 64) * fog, 0.85);
  const dashes = 26;
  for (let d = 0; d < dashes; d++) {
    const t0 = d / dashes;
    const t1 = t0 + 0.5 / dashes;
    g.line(xa + (xb - xa) * t0, 0, 0, xa + (xb - xa) * t1, 0, 0);
  }

  // Depth rails at a and b ground the structure in z.
  applyStroke(g, isGlow, (isGlow ? 6 : 30) * fog, 0.6);
  const zr = (ROLLE.DEPTH_LAYERS - 1) / 2 * ROLLE.LAYER_SPACING;
  g.line(xa, 0, -zr, xa, 0, zr);
  g.line(xb, 0, -zr, xb, 0, zr);
  g.pop();
}

// ─── Curve f(x) ───────────────────────────────────────────────────────────────
// Main curve at z = 0 plus echo layers offset along z (depth ribbon).
// Echo layers are uniform scalings of f, so they also satisfy f(a) = f(b).
function drawCurve(g, ph, isGlow) {
  const half = (ROLLE.DEPTH_LAYERS - 1) / 2;
  const stride = isGlow ? 2 : 1;

  g.push();
  for (let li = 0; li < ROLLE.DEPTH_LAYERS; li += stride) {
    const z = (li - half) * ROLLE.LAYER_SPACING;
    const n = Math.abs(li - half) / half;
    const isMain = li === half;
    const ampScale = 1 - n * 0.16;
    const layerW = isMain ? 1 : 0.55 - n * 0.32;
    const baseA = isGlow ? 22 : 150;
    const weight = isMain ? 1.15 : 0.72;

    for (let c0 = 0; c0 < ROLLE.CURVE_SAMPLES; c0 += ROLLE.CHUNK) {
      const c1 = Math.min(c0 + ROLLE.CHUNK, ROLLE.CURVE_SAMPLES);
      const um = -1 + 2 * ((c0 + c1) * 0.5 / ROLLE.CURVE_SAMPLES);
      const fm = rolleFunction(um, ph);
      const fog = fogFactor(worldX(um), worldY(fm) * ampScale, z);
      // Crest weighting: the curve brightens toward its extrema, leading the
      // eye to where the horizontal tangents live.
      const crest = 0.60 + 0.80 * Math.abs(fm) / ROLLE.AMPLITUDE;
      applyStroke(g, isGlow, baseA * layerW * crest * fog, weight);
      g.beginShape();
      for (let i = c0; i <= c1; i++) {
        const u = -1 + 2 * i / ROLLE.CURVE_SAMPLES;
        g.vertex(worldX(u), worldY(rolleFunction(u, ph)) * ampScale, z);
      }
      g.endShape();
    }
  }
  g.pop();
}

// ─── Endpoints a, b ───────────────────────────────────────────────────────────
// Heights are COMPUTED from f, never hardcoded — both come out equal (= 0),
// demonstrating f(a) = f(b) programmatically every frame.
function drawEndpoints(g, ph, isGlow) {
  g.push();
  for (const u of [ROLLE.A_END, ROLLE.B_END]) {
    const fv = rolleFunction(u, ph);          // = 0 by construction
    const x = worldX(u);
    const y = worldY(fv);
    const fog = fogFactor(x, y, 0);
    const pulse = 0.86 + 0.14 * Math.sin(4 * ph + (u < 0 ? 0 : Math.PI));

    billboardRing(g, x, y, 0, 30 * pulse, (isGlow ? 18 : 120) * fog, 1.0, isGlow);
    billboardRing(g, x, y, 0, 52 * pulse, (isGlow ? 10 : 58) * fog, 0.65, isGlow);
    billboardRing(g, x, y, 0, 80 * pulse, (isGlow ? 5 : 28) * fog, 0.45, isGlow);
    billboardDot(g, x, y, 0, isGlow ? 20 : 7, (isGlow ? 26 : 200) * fog, isGlow);

    // Cross-flare: four radiating spokes for a starburst anchor
    g.push();
    g.translate(x, y, 0);
    g.rotateY(camYaw);
    const spikeLen = 36 * pulse;
    const spikeA = (isGlow ? 22 : 130) * fog;
    applyStroke(g, isGlow, spikeA, 0.8);
    g.line(0, -spikeLen, 0, 0, spikeLen, 0);
    g.line(-spikeLen * 0.7, 0, 0, spikeLen * 0.7, 0, 0);
    g.pop();

    applyStroke(g, isGlow, (isGlow ? 9 : 52) * fog, 0.7);
    g.line(x, y + 14, 0, x, y + 54, 0);
  }
  g.pop();
}

// ─── Critical Point(s) c ─────────────────────────────────────────────────────
// Every horizontal-tangent point gets a node, ripple rings and a guide line;
// brightness is weighted by |f(c)| so the dominant extremum leads the eye.
function drawCriticalPoint(g, ph, isGlow) {
  if (!lastCps.length) return;
  const maxAbs = Math.max(1e-6, ...lastCps.map(cp => Math.abs(cp.f)));

  g.push();
  lastCps.forEach((cp, k) => {
    const w = 0.30 + 0.70 * Math.abs(cp.f) / maxAbs;
    const fog = fogFactor(cp.x, cp.y, 0);

    applyStroke(g, isGlow, (isGlow ? 7 : 34) * w * fog, 0.6);
    g.line(cp.x, 0, 0, cp.x, cp.y, 0);

    const pulse = 0.85 + 0.15 * Math.sin(4 * ph + k);
    billboardDot(g, cp.x, cp.y, 0, (isGlow ? 24 : 10) * pulse, (isGlow ? 26 : 225) * w * fog, isGlow);

    // Expanding ripples: 2 integer cycles per loop → seamless wrap.
    // fadeIn ramps alpha from 0 at birth so rings never pop into view.
    for (const r0 of [0, 1 / 4, 2 / 4, 3 / 4]) {
      const prog = ((ph / TAU) * 2 + r0 + k * 0.18) % 1;
      const eased = 1 - Math.pow(1 - prog, 3);
      const rad = eased * 220 * w;
      const fadeIn  = Math.min(1, prog / 0.06);        // 0→1 over first 6% of life
      const fadeOut = Math.pow(1 - prog, 1.2);
      billboardRing(g, cp.x, cp.y, 0, rad, fadeIn * fadeOut * (isGlow ? 18 : 90) * w * fog, 0.75, isGlow);
    }
  });
  g.pop();
}

// ─── Tangent at c ─────────────────────────────────────────────────────────────
// Drawn with constant y on both sides of c: slope 0 by definition, which is
// exactly the conclusion f'(c) = 0 (c itself came from the root finder).
function drawTangentLine(g, ph, isGlow) {
  if (!lastCps.length) return;
  const maxAbs = Math.max(1e-6, ...lastCps.map(cp => Math.abs(cp.f)));

  g.push();
  lastCps.forEach((cp, k) => {
    const w = 0.30 + 0.70 * Math.abs(cp.f) / maxAbs;
    const fog = fogFactor(cp.x, cp.y, 0);
    const len = (200 + 60 * Math.sin(3 * ph + k)) * w;

    // Light blade in z=0 plane: brightness peaks at c, breathes out to soft ends.
    const SEGS = 16;
    for (let si = 0; si < SEGS; si++) {
      const t0 = si / SEGS, t1 = (si + 1) / SEGS;
      const fall = Math.pow(Math.sin(Math.PI * (t0 + t1) * 0.5), 1.2);
      applyStroke(g, isGlow, (isGlow ? 46 : 230) * w * fog * fall * breath, 1.6);
      g.line(cp.x - len + 2 * len * t0, cp.y, 0, cp.x - len + 2 * len * t1, cp.y, 0);
    }

    // Ghost tangent blades at ±z layers — turns the line into a glowing plane
    const zr = (ROLLE.DEPTH_LAYERS - 1) / 2 * ROLLE.LAYER_SPACING;
    for (const zi of [-zr * 0.55, zr * 0.55]) {
      const zFog = fogFactor(cp.x, cp.y, zi);
      const zLen = len * 0.65;
      for (let si = 0; si < 8; si++) {
        const t0 = si / 8, t1 = (si + 1) / 8;
        const fall = Math.pow(Math.sin(Math.PI * (t0 + t1) * 0.5), 1.5);
        applyStroke(g, isGlow, (isGlow ? 18 : 90) * w * zFog * fall, 0.9);
        g.line(cp.x - zLen + 2 * zLen * t0, cp.y, zi, cp.x - zLen + 2 * zLen * t1, cp.y, zi);
      }
    }
  });
  g.pop();
}

// ─── Particles ────────────────────────────────────────────────────────────────
function drawParticles(g, ph, isGlow) {
  const stride = isGlow ? 2 : 1;

  g.push();
  // Flow: a → b along the live curve, sin(πs) fade hides the wrap respawn.
  // Each particle trails a comet tail of fading segments along its own path.
  for (let i = 0; i < particleSeeds.length; i += stride) {
    const p = particleSeeds[i];
    const s = (((p.off + (ph / TAU) * p.cycles) % 1) + 1) % 1;
    const u = -1 + 2 * s;
    const fade = Math.sin(Math.PI * s);
    const jy = 7 * Math.sin(2 * ph + p.jPhase) * fade;   // fade to 0 at endpoints
    const z = p.z * (1 + 0.2 * Math.sin(2 * ph + p.jPhase)) * fade;
    const x = worldX(u);
    const y = worldY(rolleFunction(u, ph)) + jy;
    const fog = fogFactor(x, y, z);
    billboardDot(g, x, y, z, p.size * (isGlow ? 4.2 : 1), (isGlow ? 20 : 140) * fade * fog, isGlow);

    if (!isGlow) {
      let px = x, py = y;
      for (let k = 1; k <= ROLLE.TAIL_STEPS; k++) {
        const s2 = ((s - k * ROLLE.TAIL_DS) % 1 + 1) % 1;
        const u2 = -1 + 2 * s2;
        const tx = worldX(u2);
        const ty = worldY(rolleFunction(u2, ph)) + jy;
        const tFade = Math.sin(Math.PI * s2) * (1 - k / (ROLLE.TAIL_STEPS + 1));
        applyStroke(g, isGlow, 88 * tFade * fog, 0.7);
        g.line(px, py, z, tx, ty, z);
        px = tx; py = ty;
      }
    }
  }

  // Static wave dots: always-on points evenly spaced along the curve.
  const WAVE_DOTS = 48;
  for (let i = 0; i <= WAVE_DOTS; i++) {
    const u = -1 + 2 * i / WAVE_DOTS;
    const x = worldX(u);
    const y = worldY(rolleFunction(u, ph));
    const fog = fogFactor(x, y, 0);
    // Slightly brighter near crest for visual interest
    const crest = 0.5 + 0.5 * Math.abs(rolleFunction(u, ph)) / ROLLE.AMPLITUDE;
    billboardDot(g, x, y, 0, isGlow ? 5 : 2.2,
      (isGlow ? 14 : 90) * crest * fog * breath, isGlow);
  }

  // Halo cluster: dense region following the dominant critical point c.
  const dom = dominantCp();
  if (dom) {
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);   // camera-right vector
    for (let j = 0; j < clusterSeeds.length; j += stride) {
      const cs = clusterSeeds[j];
      const ang = cs.ang + ph * cs.spin;
      const r = cs.rad * (1 + 0.10 * Math.sin(2 * ph + cs.wob));
      const px = dom.x + Math.cos(ang) * r * rx;
      const py = dom.y + Math.sin(ang) * r;
      const pz = Math.cos(ang) * r * rz;
      const nearW = 1 - Math.min(1, r / 150);
      const fog = fogFactor(px, py, pz);
      billboardDot(g, px, py, pz, cs.size * (isGlow ? 4.0 : 1),
        (isGlow ? 22 : 145) * (0.25 + 0.75 * nearW) * fog, isGlow);
    }
  }
  g.pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(loop) {
  const dom = dominantCp();
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');
  fill(255, 255, 255, 155);
  textSize(13);
  textAlign(LEFT, TOP);
  text("ROLLE'S THEOREM · HORIZONTAL TANGENT FIELD", 52, 52);
  fill(255, 255, 255, 70);
  textSize(10);
  text('a=' + ROLLE.A_END.toFixed(3) + '  b=' + ROLLE.B_END.toFixed(3)
    + '  f(a)=f(b)=0.000  c=' + (dom ? dom.u.toFixed(3) : '—')
    + "  f'(c)=0  loop=" + loop.toFixed(3), 52, 76);
  fill(255, 255, 255, 50);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text(W + '×' + H + ' · ' + FPS + ' fps', 52, H - 52);
  textAlign(RIGHT, BOTTOM);
  text("20260611 · ROLLE'S THEOREM", W - 52, H - 52);
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

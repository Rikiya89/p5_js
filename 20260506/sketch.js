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

// ─── Creature parameters ──────────────────────────────────────────────────────
// Spine resolution (segments along body) and rib resolution (points around each rib)
const SPINE_SEGS = 140;
const RIB_SEGS   = 26;

// Two organisms — primary creature + smaller companion
let creatureA = null;
let creatureB = null;

let cloud = [];
let stars = [];
let rays  = [];
const N_CLOUD = 600;
const N_STARS = 110;
const N_RAYS  = 28;

let seedPhase = 0;

// Time-varying light direction — slowly orbits so rim highlights travel
// across the creature. Recomputed each frame in updateLight(t).
let LIGHT = [0.55, -0.7, 0.45];
function updateLight(t) {
  // Rotate base light direction around Y at a slow rate
  const baseY = -0.55;
  const r = Math.sqrt(1 - baseY * baseY);
  const a = t * 0.45 + seedPhase * 0.3;
  LIGHT = [r * Math.cos(a), baseY, r * Math.sin(a)];
}

// ─── Wake particles — bubbles streaming off flaps and tail ───────────────────
// Pool of fixed-size particles. Each frame we deterministically spawn from
// flap tips and tail (so animation is reproducible / loops cleanly), and
// advect existing particles by a current vector.
const N_WAKE = 220;
let wake = [];
function initWake() {
  wake = new Array(N_WAKE);
  for (let i = 0; i < N_WAKE; i++) {
    wake[i] = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 };
  }
}

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

  bloomLayer = createGraphics(W >> 1, H >> 1);
  bloomLayer.pixelDensity(1);
  bloomLayer.colorMode(RGB, 255, 255, 255, 255);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  initWake();
  reseed(floor(random(100000)));

  document.getElementById('maxDuration').textContent = MAX_DURATION;
  document.getElementById('canvasSize').textContent  = W + ' × ' + H;
}

function reseed(s) {
  randomSeed(s);
  noiseSeed(s);
  seedPhase = random(TAU);

  // Primary: large Anomalocaris
  creatureA = buildCreature({
    bodyLen:  640,    // total length head→tail
    bodyW:    150,    // half-width across (lateral)
    bodyH:     55,    // half-height (dorsoventral) — flattened
    arch:      90,    // gentle vertical arc
    swimAmp:   38,    // lateral swimming undulation amplitude
    swimFreq:   1.3,  // wavelengths along body
    nFlaps:    14,    // number of lateral swim flaps per side
    flapLen:  170,    // flap extension distance
    flapPhase:  3.4,  // phase offset across flaps (flap-wave speed)
    mouthR:    62,    // mouth ring radius
    mouthRings: 4,
    armLen:   330,    // frontal grasping appendage length
    armSegs:   12,    // arm segments
    armSpines:  8,    // spines per arm
    eyeStalk:  85,
    tailFanR: 220,
    tailFanFins: 7,
    weight: 1.0,
    seedOffset: 0,
  });
  // Companion: smaller, behind
  creatureB = buildCreature({
    bodyLen:  430,
    bodyW:    100,
    bodyH:     38,
    arch:      60,
    swimAmp:   28,
    swimFreq:   1.5,
    nFlaps:    11,
    flapLen:  115,
    flapPhase:  4.1,
    mouthR:    42,
    mouthRings: 3,
    armLen:   220,
    armSegs:   10,
    armSpines:  7,
    eyeStalk:  58,
    tailFanR: 150,
    tailFanFins: 6,
    weight: 0.78,
    seedOffset: 17.3,
  });

  buildCloud();
  buildStars();
  buildRays();
}

// ─── Anomalocaris — Cambrian apex predator anatomy ───────────────────────────
//
// Bilaterally symmetric, dorsoventrally flattened body with:
//   • spine running head→tail in +X direction (head at u=0, tail at u=1)
//   • body axes: tangent (X) along length, normal (Y) up/dorsal, binormal (Z) lateral
//   • flattened ellipse cross-section: wide laterally (Z), thin vertically (Y)
//   • taper: pointed head, rounded mid-body, narrowing toward tail
//
// The creature swims forward; in the scene it spins on Y so the camera sees it
// from various angles.
function buildCreature(params) {
  const spine = new Array(SPINE_SEGS);
  const half = params.bodyLen * 0.5;

  for (let i = 0; i < SPINE_SEGS; i++) {
    const u = i / (SPINE_SEGS - 1);

    // Spine: stretched along X, gentle vertical arc (the body curls slightly downward at tail)
    // Centered on origin so the creature sits at the scene origin.
    const x = lerp(-half, half, u);
    const y = -params.arch * Math.sin(u * Math.PI) * 0.35;  // shallow arc
    const z = 0;

    // Tangent — points head→tail, i.e. +X with a tiny y component
    const u2 = Math.min(1, u + 1 / SPINE_SEGS);
    const x2 = lerp(-half, half, u2);
    const y2 = -params.arch * Math.sin(u2 * Math.PI) * 0.35;
    const z2 = 0;
    let tx = x2 - x, ty = y2 - y, tz = z2 - z;
    const tm = Math.hypot(tx, ty, tz) || 1;
    tx /= tm; ty /= tm; tz /= tm;

    // Normal = world-up projected perpendicular to tangent (dorsal direction)
    let nx = 0, ny = 1, nz = 0;
    const dot = nx * tx + ny * ty + nz * tz;
    nx -= dot * tx; ny -= dot * ty; nz -= dot * tz;
    const nm = Math.hypot(nx, ny, nz) || 1;
    nx /= nm; ny /= nm; nz /= nm;

    // Binormal = tangent × normal — lateral (left-right) direction
    const bx = ty * nz - tz * ny;
    const by = tz * nx - tx * nz;
    const bz = tx * ny - ty * nx;

    // Body cross-section: ellipse half-widths
    //   widthFactor: 0 at head, peaks ~u=0.35, narrows toward tail
    //   The shape is a fish-like profile.
    const wf = bodyProfile(u);
    const halfW = params.bodyW * wf;   // lateral half-width
    const halfH = params.bodyH * wf;   // dorsoventral half-height

    spine[i] = {
      u, x, y, z,
      tx, ty, tz,
      nx, ny, nz,
      bx, by, bz,
      halfW, halfH,
    };
  }

  return { spine, params };
}

// Body profile multiplier — gives Anomalocaris its torpedo-with-fat-head look.
//   u=0   → ~0.55 (head, narrows to mouth)
//   u=0.3 → ~1.0  (broadest)
//   u=1   → ~0.15 (tail before fan)
function bodyProfile(u) {
  // Skewed bell: rises fast from head, decays slowly to tail
  const head = 1 - Math.pow(1 - smoothstep(0, 0.18, u), 2);
  const tail = Math.pow(1 - smoothstep(0.35, 1.0, u), 1.4);
  return 0.55 * head * (0.55 + 0.45 * tail);
}

function smoothstep(a, b, x) {
  const t = constrain((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Cross-section radius at angle theta around the spine.
//   theta=0    → +Y (dorsal/top)
//   theta=π/2  → +Z (right side)
//   theta=π    → -Y (ventral/bottom)
//   theta=3π/2 → -Z (left side)
//
// Returns (rN, rB) — components along the normal and binormal axes — so we can
// build a flattened ellipse instead of a circle.
function ellipseRadii(theta, halfW, halfH) {
  return {
    rN: halfH * Math.cos(theta),  // dorsoventral component
    rB: halfW * Math.sin(theta),  // lateral component
  };
}

// ─── Cloud / stars / rays (ambient context) ──────────────────────────────────
function buildCloud() {
  cloud = [];
  for (let i = 0; i < N_CLOUD; i++) {
    const a = random() * TAU;
    const b = random() * TAU;
    const Rc = 360 + (random() - 0.5) * 280;
    const rc = 80  + (random() - 0.5) * 120;
    const x = (Rc + rc * Math.cos(b)) * Math.cos(a);
    const y =  rc * Math.sin(b) * 1.4;
    const z = (Rc + rc * Math.cos(b)) * Math.sin(a);
    cloud.push({ x, y, z, phase: random(TAU), scale: 0.5 + random() * 1.0 });
  }
}

function buildStars() {
  stars = [];
  for (let i = 0; i < N_STARS; i++) {
    const u = random(), v = random();
    const theta = u * TAU;
    const phi   = Math.acos(2 * v - 1);
    const r     = 780 + random() * 240;
    stars.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.cos(phi),
      z: r * Math.sin(phi) * Math.sin(theta),
      phase: random(TAU),
      scale: 0.6 + random() * 1.6,
    });
  }
}

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
      length: 440 + random() * 220,
    });
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const t    = loop * TAU;

  updateLight(t);

  background(0);
  renderScene(t, loop);
  applyBloom();

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
  // Cinematic camera — three blended motions over the loop.
  //   • Slow continuous orbit (Y axis)
  //   • Breathing radius — the camera dollies in and out twice per loop
  //   • Vertical sweep — the camera rises and falls, looking up then down
  // Eased with smoothstep-like sin curves so motion feels deliberate, not linear.

  const phase = t / TAU;  // 0..1 over the loop

  // Orbit: full revolution per loop, but with non-uniform speed (slows on the
  // beauty-shot side so the camera lingers on the creature's profile).
  const orbitBase = t + seedPhase;
  const orbitEase = 0.35 * Math.sin(t * 2 + seedPhase);
  const camA = orbitBase + orbitEase;

  // Radius — pull in close, push out wide, twice per loop.
  // Eased so the dolly feels like a deliberate camera move.
  const radiusBreath = (Math.sin(t - Math.PI / 2) + 1) * 0.5;  // 0..1
  const camR = lerp(1280, 1850, radiusBreath);

  // Vertical sweep — sine-eased, offset so the camera is high-near-front.
  const camY = 360 * Math.sin(t * 0.5 + seedPhase) - 60;

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

  // Soft scene tilt — like the camera drifts in a current.
  webglLayer.rotateX(Math.sin(t * 0.4) * 0.10);
  webglLayer.rotateZ(Math.cos(t * 0.3) * 0.07);
  // Slow vertical drift — the whole scene sinks and rises like marine snow.
  webglLayer.translate(0, 24 * Math.sin(t * 0.35), 0);

  drawHorizonRing(t);
  drawAxisGuides(t);
  drawStars(t);
  drawInnerRays(t);
  drawCloud(t);

  // Wake bubbles — drawn before creature so the creature occludes them.
  updateAndDrawWake(t);

  // Primary Anomalocaris — slow drift, gentle pitch (it's swimming, not spinning)
  webglLayer.push();
  webglLayer.rotateY(t * 0.12);
  webglLayer.rotateX(Math.sin(t * 0.6) * 0.12);
  drawCreature(creatureA, t);
  webglLayer.pop();

  // Companion — offset position, different drift
  webglLayer.push();
  webglLayer.translate(60, 180, -120);
  webglLayer.rotateY(-t * 0.18 + 1.1);
  webglLayer.rotateX(0.25 + Math.sin(t * 0.7) * 0.1);
  drawCreature(creatureB, t);
  webglLayer.pop();

  webglLayer.pop();
  image(webglLayer, 0, 0);
}

// ─── Creature render — spine ribbon + rib rings + filaments ──────────────────
function drawCreature(creature, t) {
  const { spine, params } = creature;
  const { fwd } = viewBasis;
  const W_ = params.weight;

  // ── Coordinated swim — single phase variable drives body, flaps, arms, eyes.
  //    The body sways laterally as a wave traveling head→tail; the wave's
  //    spatial frequency is `swimFreq`, temporal speed is fixed at 1.4.
  //    Tail whips most (pow(u, 1.4)), head locks in.
  //    Plus a slow body-wide breath cycle that scales the whole creature.
  const breath = 1 + 0.025 * Math.sin(t * 0.6 + params.seedOffset);
  const sp = new Array(spine.length);
  for (let i = 0; i < spine.length; i++) {
    const s = spine[i];
    const swimWave = Math.sin(s.u * TAU * params.swimFreq - t * 1.4);
    const sway = params.swimAmp * swimWave * Math.pow(s.u, 1.4);
    // Subtle vertical bob — 90° out of phase with sway, like real fish swimming
    const bob  = params.swimAmp * 0.15 * Math.cos(s.u * TAU * params.swimFreq - t * 1.4) * Math.pow(s.u, 1.6);
    sp[i] = {
      ...s,
      px: (s.x + s.bx * sway) * breath,
      py: (s.y + bob) * breath,
      pz: (s.z + s.bz * sway) * breath,
      // Carry per-vertex scale for downstream passes
      _breath: breath,
      _swim: swimWave,
    };
  }

  // ─── Pass 1: Spine ribbon (the central thread) ─────────────────────────────
  webglLayer.push();
  for (let i = 0; i < sp.length - 1; i++) {
    const a = sp[i], b = sp[i + 1];
    const dAvg = (viewDepth(a.px, a.py, a.pz) + viewDepth(b.px, b.py, b.pz)) * 0.5;
    const fog  = fogFactor(dAvg);

    webglLayer.stroke(255, 255, 255, 175 * fog * W_);
    webglLayer.strokeWeight(1.4 * W_);
    webglLayer.line(a.px, a.py, a.pz, b.px, b.py, b.pz);

    webglLayer.stroke(255, 255, 255, 28 * fog * W_);
    webglLayer.strokeWeight(4.2);
    webglLayer.line(a.px, a.py, a.pz, b.px, b.py, b.pz);
  }
  webglLayer.pop();

  // ─── Pass 2: Body cross-section ellipses — flattened, segmented ──────────
  // Anomalocaris had visible body segmentation. We draw an ellipse at every
  // few spine samples (the segment boundaries).
  webglLayer.push();
  const RIB_STRIDE = 3;
  for (let i = 0; i < sp.length; i += RIB_STRIDE) {
    const s = sp[i];
    if (s.halfW < 1) continue;

    let prevX = 0, prevY = 0, prevZ = 0, prevValid = false;
    for (let j = 0; j <= RIB_SEGS; j++) {
      const theta = (j / RIB_SEGS) * TAU;
      const { rN, rB } = ellipseRadii(theta, s.halfW, s.halfH);

      const x = s.px + s.nx * rN + s.bx * rB;
      const y = s.py + s.ny * rN + s.by * rB;
      const z = s.pz + s.nz * rN + s.bz * rB;

      if (prevValid) {
        const d = viewDepth(x, y, z);
        const fog = fogFactor(d);

        // Outward normal at this point
        const onx = s.nx * Math.cos(theta) + s.bx * Math.sin(theta);
        const ony = s.ny * Math.cos(theta) + s.by * Math.sin(theta);
        const onz = s.nz * Math.cos(theta) + s.bz * Math.sin(theta);
        const dotL = onx * LIGHT[0] + ony * LIGHT[1] + onz * LIGHT[2];
        const shade = 0.35 + 0.65 * (0.5 + 0.5 * dotL);

        const dotV = Math.abs(onx * fwd[0] + ony * fwd[1] + onz * fwd[2]);
        const rim  = Math.pow(1 - dotV, 2.5);

        webglLayer.stroke(255, 255, 255, 150 * fog * shade * W_);
        webglLayer.strokeWeight(1.0 * W_);
        webglLayer.line(prevX, prevY, prevZ, x, y, z);

        if (rim > 0.35) {
          webglLayer.stroke(255, 255, 255, 255 * fog * rim * W_);
          webglLayer.strokeWeight(0.9 * W_);
          webglLayer.line(prevX, prevY, prevZ, x, y, z);
        }
      }
      prevX = x; prevY = y; prevZ = z; prevValid = true;
    }
  }
  webglLayer.pop();

  // ─── Pass 3: Longitudinal body lines (dorsal + ventral + sides) ──────────
  webglLayer.push();
  const LONGITUDES = 12;
  for (let k = 0; k < LONGITUDES; k++) {
    const theta = (k / LONGITUDES) * TAU;
    let prevX = 0, prevY = 0, prevZ = 0, prevShade = 0, prevValid = false;
    for (let i = 0; i < sp.length; i++) {
      const s = sp[i];
      if (s.halfW < 1) { prevValid = false; continue; }
      const { rN, rB } = ellipseRadii(theta, s.halfW, s.halfH);
      const x = s.px + s.nx * rN + s.bx * rB;
      const y = s.py + s.ny * rN + s.by * rB;
      const z = s.pz + s.nz * rN + s.bz * rB;

      const onx = s.nx * Math.cos(theta) + s.bx * Math.sin(theta);
      const ony = s.ny * Math.cos(theta) + s.by * Math.sin(theta);
      const onz = s.nz * Math.cos(theta) + s.bz * Math.sin(theta);
      const dotL = onx * LIGHT[0] + ony * LIGHT[1] + onz * LIGHT[2];
      const shade = 0.35 + 0.65 * (0.5 + 0.5 * dotL);

      if (prevValid) {
        const d = viewDepth((x + prevX) * 0.5, (y + prevY) * 0.5, (z + prevZ) * 0.5);
        const fog = fogFactor(d);
        const sh = (shade + prevShade) * 0.5;
        webglLayer.stroke(255, 255, 255, 115 * fog * sh * W_);
        webglLayer.strokeWeight(0.7 * W_);
        webglLayer.line(prevX, prevY, prevZ, x, y, z);
      }
      prevX = x; prevY = y; prevZ = z; prevShade = shade; prevValid = true;
    }
  }
  webglLayer.pop();

  // ─── Pass 4: Lateral swimming flaps (the iconic Anomalocaris feature) ────
  // Discrete fin-lobes on each side of the body, with phase-offset undulation
  // that travels head→tail like an underwater wave.
  drawLateralFlaps(sp, params, t, W_);

  // ─── Pass 5: Mouth ring — concentric rings at u=0 ────────────────────────
  drawMouth(sp[0], params, t, W_);

  // ─── Pass 6: Frontal grasping appendages — segmented arms with spines ────
  drawFrontalArms(sp[0], params, t, W_);

  // ─── Pass 7: Eye stalks — two stalks above the head ──────────────────────
  drawEyeStalks(sp[Math.floor(sp.length * 0.06)] || sp[0], params, t, W_);

  // ─── Pass 8: Tail fan — splayed fins at u=1 ──────────────────────────────
  drawTailFan(sp[sp.length - 1], params, t, W_);
}

// ─── Lateral swim flaps — Anomalocaris's defining feature ────────────────────
function drawLateralFlaps(sp, params, t, W_) {
  const { fwd } = viewBasis;
  const N = params.nFlaps;
  // Flaps span u ∈ [0.18, 0.86] (skip mouth area and tail tip)
  const uStart = 0.18, uEnd = 0.86;

  webglLayer.push();
  for (let side = -1; side <= 1; side += 2) {  // -1 = left, +1 = right
    for (let f = 0; f < N; f++) {
      const u = lerp(uStart, uEnd, f / (N - 1));
      // Find spine sample at u
      const idx = Math.min(sp.length - 1, Math.floor(u * (sp.length - 1)));
      const s = sp[idx];

      // Flap waving phase — different along body so the wave travels
      const phase = (f / N) * params.flapPhase + (side > 0 ? 0 : Math.PI);
      const wave  = Math.sin(t * 1.6 - phase);
      const flapAngle = wave * 0.55;  // ±32° from horizontal

      // Flap shape: a tapered, leaf-like fin extending from body side.
      // Build it as a 5-vertex outline: root-front, tip-front, tip, tip-back, root-back
      const sideDir = {
        x: s.bx * side, y: s.by * side, z: s.bz * side,
      };

      // Flap basis: side direction (out), normal (vertical for flap pitch),
      //   tangent (along body for length).
      // The flap tilts around the body-tangent axis by flapAngle.
      const cs = Math.cos(flapAngle), sn = Math.sin(flapAngle);
      // Rotated outward direction (mixes side dir with vertical)
      const outX = sideDir.x * cs + s.nx * sn;
      const outY = sideDir.y * cs + s.ny * sn;
      const outZ = sideDir.z * cs + s.nz * sn;

      // Flap length tapers near head and tail
      const sizeProfile = Math.sin(((u - uStart) / (uEnd - uStart)) * Math.PI);
      const len = params.flapLen * (0.55 + 0.45 * sizeProfile);
      const halfChord = len * 0.45;  // along body tangent

      // Anchor at body surface
      const ax = s.px + sideDir.x * s.halfW * 0.95;
      const ay = s.py + sideDir.y * s.halfW * 0.95;
      const az = s.pz + sideDir.z * s.halfW * 0.95;

      // Flap polygon vertices
      const front = { x: ax + s.tx * halfChord,        y: ay + s.ty * halfChord,        z: az + s.tz * halfChord };
      const back  = { x: ax - s.tx * halfChord,        y: ay - s.ty * halfChord,        z: az - s.tz * halfChord };
      const tipMid= { x: ax + outX * len,              y: ay + outY * len,              z: az + outZ * len };
      const tipF  = { x: front.x + outX * len * 0.85,  y: front.y + outY * len * 0.85,  z: front.z + outZ * len * 0.85 };
      const tipB  = { x: back.x  + outX * len * 0.75,  y: back.y  + outY * len * 0.75,  z: back.z  + outZ * len * 0.75 };

      const verts = [front, tipF, tipMid, tipB, back];

      // Outline
      const dotL = outX * LIGHT[0] + outY * LIGHT[1] + outZ * LIGHT[2];
      const shade = 0.35 + 0.65 * (0.5 + 0.5 * dotL);
      const dotV  = Math.abs(outX * fwd[0] + outY * fwd[1] + outZ * fwd[2]);
      const rim   = Math.pow(1 - dotV, 2.0);

      for (let v = 0; v < verts.length - 1; v++) {
        const a = verts[v], b = verts[v + 1];
        const d = viewDepth((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
        const fog = fogFactor(d);
        webglLayer.stroke(255, 255, 255, 195 * fog * shade * W_);
        webglLayer.strokeWeight(1.1 * W_);
        webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
        // Soft glow underlay — blooms the flap edges
        webglLayer.stroke(255, 255, 255, 22 * fog * shade * W_);
        webglLayer.strokeWeight(3.5);
        webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
        if (rim > 0.3) {
          webglLayer.stroke(255, 255, 255, 255 * fog * rim * W_);
          webglLayer.strokeWeight(0.85 * W_);
          webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }

      // Internal fin rays — 5 lines from anchor area to tip edge
      const RAYS = 6;
      for (let r = 1; r < RAYS; r++) {
        const k = r / RAYS;
        // Sample anchor along front-back chord
        const aax = lerp(back.x, front.x, k);
        const aay = lerp(back.y, front.y, k);
        const aaz = lerp(back.z, front.z, k);
        // Sample tip along same parameter
        const ttx = lerp(tipB.x, tipF.x, k);
        const tty = lerp(tipB.y, tipF.y, k);
        const ttz = lerp(tipB.z, tipF.z, k);
        const d = viewDepth((aax + ttx) * 0.5, (aay + tty) * 0.5, (aaz + ttz) * 0.5);
        const fog = fogFactor(d);
        webglLayer.stroke(255, 255, 255, 110 * fog * shade * W_);
        webglLayer.strokeWeight(0.55 * W_);
        webglLayer.line(aax, aay, aaz, ttx, tty, ttz);
      }
    }
  }
  webglLayer.pop();
}

// ─── Mouth — concentric rings (Peytoia/pineapple-slice mouth) ────────────────
function drawMouth(sHead, params, t, W_) {
  if (!sHead) return;
  const { fwd } = viewBasis;
  webglLayer.push();
  const segs = 32;
  // Place mouth slightly ahead of head along -tangent direction (head faces -X after spine head)
  // Actually: head is at u=0, spine goes head→tail in +tangent direction, so mouth faces -tangent
  const cx = sHead.px - sHead.tx * 12;
  const cy = sHead.py - sHead.ty * 12;
  const cz = sHead.pz - sHead.tz * 12;

  for (let r = 0; r < params.mouthRings; r++) {
    const ringR = params.mouthR * (0.35 + 0.7 * (r / Math.max(1, params.mouthRings - 1)));
    // Slow dilation — mouth slowly opens/closes
    const dilate = 1 + 0.08 * Math.sin(t * 1.1 + r * 0.7);
    const rr = ringR * dilate;

    let px = 0, py = 0, pz = 0, valid = false;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU;
      // Ring lies in the plane spanned by normal + binormal (perpendicular to tangent)
      const cs = Math.cos(a), sn = Math.sin(a);
      const x = cx + sHead.nx * rr * cs + sHead.bx * rr * sn;
      const y = cy + sHead.ny * rr * cs + sHead.by * rr * sn;
      const z = cz + sHead.nz * rr * cs + sHead.bz * rr * sn;
      if (valid) {
        const d = viewDepth(x, y, z);
        const fog = fogFactor(d);
        webglLayer.stroke(255, 255, 255, 175 * fog * W_);
        webglLayer.strokeWeight(0.85 * W_);
        webglLayer.line(px, py, pz, x, y, z);
        // Soft halo
        webglLayer.stroke(255, 255, 255, 18 * fog * W_);
        webglLayer.strokeWeight(3.0);
        webglLayer.line(px, py, pz, x, y, z);
      }
      px = x; py = y; pz = z; valid = true;
    }

    // Radial teeth — short spokes from this ring inward
    if (r === params.mouthRings - 1) {
      const teeth = 16;
      for (let j = 0; j < teeth; j++) {
        const a = (j / teeth) * TAU;
        const cs = Math.cos(a), sn = Math.sin(a);
        const x1 = cx + sHead.nx * rr * cs + sHead.bx * rr * sn;
        const y1 = cy + sHead.ny * rr * cs + sHead.by * rr * sn;
        const z1 = cz + sHead.nz * rr * cs + sHead.bz * rr * sn;
        const innerR = rr * 0.55;
        const x2 = cx + sHead.nx * innerR * cs + sHead.bx * innerR * sn;
        const y2 = cy + sHead.ny * innerR * cs + sHead.by * innerR * sn;
        const z2 = cz + sHead.nz * innerR * cs + sHead.bz * innerR * sn;
        const d = viewDepth(x2, y2, z2);
        const fog = fogFactor(d);
        webglLayer.stroke(255, 255, 255, 230 * fog * W_);
        webglLayer.strokeWeight(0.7 * W_);
        webglLayer.line(x1, y1, z1, x2, y2, z2);
      }
    }
  }
  webglLayer.pop();
}

// ─── Frontal grasping appendages ─────────────────────────────────────────────
// Two segmented arms emerging just below the mouth, curving forward, with
// inner-facing spines (the "great appendages" of Anomalocaris).
function drawFrontalArms(sHead, params, t, W_) {
  if (!sHead) return;
  webglLayer.push();
  for (let side = -1; side <= 1; side += 2) {
    // Anchor: just below head, slightly to one side
    const ax = sHead.px - sHead.tx * 8 + sHead.bx * (params.bodyW * 0.35) * side - sHead.nx * (params.bodyH * 0.6);
    const ay = sHead.py - sHead.ty * 8 + sHead.by * (params.bodyW * 0.35) * side - sHead.ny * (params.bodyH * 0.6);
    const az = sHead.pz - sHead.tz * 8 + sHead.bz * (params.bodyW * 0.35) * side - sHead.nz * (params.bodyH * 0.6);

    // Arm reaches forward (-tangent) and curls inward (toward -side·binormal)
    // Build arm as polyline of armSegs joints
    const segs = params.armSegs;
    const joints = new Array(segs + 1);
    joints[0] = { x: ax, y: ay, z: az };

    // Arm "reach" cycle — arms slowly extend and retract together, like a
    // mantis shrimp testing the water. Locked to body breath rhythm.
    const reachCycle = 0.5 + 0.5 * Math.sin(t * 0.7 + params.seedOffset);
    const reachAmt   = 0.65 + 0.35 * reachCycle;  // 0.65..1.0 length multiplier

    for (let k = 1; k <= segs; k++) {
      const u = k / segs;
      // Curl progressively, but less when reaching
      const curl = u * (1.9 - 0.7 * reachCycle);
      // Whip wave — phase-delayed by k so the wave travels down the arm
      const wave = 0.22 * Math.sin(t * 1.6 - u * 5 + side * 1.2);
      const angle = -curl + wave * side;

      // Direction in head-local plane: forward (-tangent) rotated by `angle` around dorsal axis
      const cs = Math.cos(angle), sn = Math.sin(angle);
      // forward = -tangent, inward = -side*binormal
      const dirX = -sHead.tx * cs + (-side * sHead.bx) * sn;
      const dirY = -sHead.ty * cs + (-side * sHead.by) * sn;
      const dirZ = -sHead.tz * cs + (-side * sHead.bz) * sn;

      // Arm taper — modulated by reach (longer when extending)
      const segLen = (params.armLen / segs) * (1 - 0.4 * u) * reachAmt;
      const prev = joints[k - 1];
      joints[k] = {
        x: prev.x + dirX * segLen,
        y: prev.y + dirY * segLen,
        z: prev.z + dirZ * segLen,
      };
    }

    // Draw arm shaft
    for (let k = 0; k < joints.length - 1; k++) {
      const a = joints[k], b = joints[k + 1];
      const d = viewDepth((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
      const fog = fogFactor(d);
      const taperW = 1 - (k / joints.length) * 0.55;
      webglLayer.stroke(255, 255, 255, 235 * fog * W_);
      webglLayer.strokeWeight(1.7 * W_ * taperW);
      webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
      // Brighter glow underlay
      webglLayer.stroke(255, 255, 255, 42 * fog * W_);
      webglLayer.strokeWeight(4.2 * taperW);
      webglLayer.line(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    // Inner-facing spines — primitive "claw teeth" along the arm
    const spines = params.armSpines;
    for (let s = 1; s <= spines; s++) {
      const k = Math.floor((s / (spines + 1)) * segs);
      if (k < 1 || k >= joints.length - 1) continue;
      const j = joints[k];
      // Inward direction = toward body center = +side*binormal (back toward origin)
      // and slightly toward -tangent (forward)
      const ix = side * sHead.bx * 0.85 - sHead.tx * 0.4;
      const iy = side * sHead.by * 0.85 - sHead.ty * 0.4;
      const iz = side * sHead.bz * 0.85 - sHead.tz * 0.4;
      const im = Math.hypot(ix, iy, iz) || 1;
      const spineLen = 22 + 8 * Math.sin(t + s);
      const ex = j.x + (ix / im) * spineLen;
      const ey = j.y + (iy / im) * spineLen;
      const ez = j.z + (iz / im) * spineLen;
      const d = viewDepth(ex, ey, ez);
      const fog = fogFactor(d);
      webglLayer.stroke(255, 255, 255, 255 * fog * W_);
      webglLayer.strokeWeight(0.85 * W_);
      webglLayer.line(j.x, j.y, j.z, ex, ey, ez);
    }
  }
  webglLayer.pop();
}

// ─── Eye stalks ──────────────────────────────────────────────────────────────
function drawEyeStalks(sHead, params, t, W_) {
  if (!sHead) return;
  webglLayer.push();
  for (let side = -1; side <= 1; side += 2) {
    // Stalk base on top of head, slightly to one side
    const bx = sHead.px + sHead.nx * params.bodyH * 0.9 + sHead.bx * params.bodyW * 0.4 * side;
    const by = sHead.py + sHead.ny * params.bodyH * 0.9 + sHead.by * params.bodyW * 0.4 * side;
    const bz = sHead.pz + sHead.nz * params.bodyH * 0.9 + sHead.bz * params.bodyW * 0.4 * side;

    // Stalk tip — extends up + outward, with gentle sway
    const sway = 0.12 * Math.sin(t * 1.3 + side);
    const upX  = sHead.nx + sHead.bx * (0.4 * side + sway);
    const upY  = sHead.ny + sHead.by * (0.4 * side + sway);
    const upZ  = sHead.nz + sHead.bz * (0.4 * side + sway);
    const um   = Math.hypot(upX, upY, upZ) || 1;
    const tipX = bx + (upX / um) * params.eyeStalk;
    const tipY = by + (upY / um) * params.eyeStalk;
    const tipZ = bz + (upZ / um) * params.eyeStalk;

    // Stalk shaft
    const d = viewDepth(tipX, tipY, tipZ);
    const fog = fogFactor(d);
    webglLayer.stroke(255, 255, 255, 230 * fog * W_);
    webglLayer.strokeWeight(1.2 * W_);
    webglLayer.line(bx, by, bz, tipX, tipY, tipZ);
    webglLayer.stroke(255, 255, 255, 28 * fog * W_);
    webglLayer.strokeWeight(3.5);
    webglLayer.line(bx, by, bz, tipX, tipY, tipZ);

    // Eye sphere — small ring at tip + bright center point
    const eyeR = params.eyeStalk * 0.18;
    const ringSegs = 16;
    let px = 0, py = 0, pz = 0, valid = false;
    for (let j = 0; j <= ringSegs; j++) {
      const a = (j / ringSegs) * TAU;
      const cs = Math.cos(a), sn = Math.sin(a);
      const ex = tipX + sHead.tx * eyeR * cs + sHead.bx * eyeR * sn;
      const ey = tipY + sHead.ty * eyeR * cs + sHead.by * eyeR * sn;
      const ez = tipZ + sHead.tz * eyeR * cs + sHead.bz * eyeR * sn;
      if (valid) {
        webglLayer.stroke(255, 255, 255, 255 * fog * W_);
        webglLayer.strokeWeight(0.9 * W_);
        webglLayer.line(px, py, pz, ex, ey, ez);
      }
      px = ex; py = ey; pz = ez; valid = true;
    }
    // Bright pupil — bigger halo
    webglLayer.stroke(255, 255, 255, 255 * fog);
    webglLayer.strokeWeight(3.2 * W_);
    webglLayer.point(tipX, tipY, tipZ);
    webglLayer.stroke(255, 255, 255, 140 * fog);
    webglLayer.strokeWeight(11 * W_);
    webglLayer.point(tipX, tipY, tipZ);
  }
  webglLayer.pop();
}

// ─── Tail fan — splayed fins at the tail tip ─────────────────────────────────
function drawTailFan(sTail, params, t, W_) {
  if (!sTail) return;
  webglLayer.push();
  const fins = params.tailFanFins;
  const fanR = params.tailFanR;
  // Fan plane is perpendicular to tangent (vertical fan when body is horizontal)
  for (let f = 0; f < fins; f++) {
    // Splay angles span across the lateral plane
    const k = f / (fins - 1);
    const angle = lerp(-Math.PI * 0.42, Math.PI * 0.42, k);
    // Wave the fan
    const wave = 0.12 * Math.sin(t * 1.6 - f * 0.4);
    const a = angle + wave;
    const cs = Math.cos(a), sn = Math.sin(a);
    // Fin extends in -tangent (away from body) plus lateral spread
    const dirX = -sTail.tx + sTail.bx * sn * 1.2 + sTail.nx * cs * 0.05;
    const dirY = -sTail.ty + sTail.by * sn * 1.2 + sTail.ny * cs * 0.05;
    const dirZ = -sTail.tz + sTail.bz * sn * 1.2 + sTail.nz * cs * 0.05;
    const dm = Math.hypot(dirX, dirY, dirZ) || 1;
    // Fin length — outer fins shorter
    const lenK = 1 - 0.35 * Math.abs(k - 0.5) * 2;
    const L = fanR * lenK;
    const ex = sTail.px + (dirX / dm) * L;
    const ey = sTail.py + (dirY / dm) * L;
    const ez = sTail.pz + (dirZ / dm) * L;
    const d = viewDepth(ex, ey, ez);
    const fog = fogFactor(d);

    webglLayer.stroke(255, 255, 255, 220 * fog * W_);
    webglLayer.strokeWeight(1.1 * W_);
    webglLayer.line(sTail.px, sTail.py, sTail.pz, ex, ey, ez);
    // Brighter glow
    webglLayer.stroke(255, 255, 255, 38 * fog * W_);
    webglLayer.strokeWeight(4.0);
    webglLayer.line(sTail.px, sTail.py, sTail.pz, ex, ey, ez);
  }
  webglLayer.pop();
}

// ─── Wake — bubble particles streaming behind the creature ──────────────────
// Each frame: deterministically respawn particles whose life has expired by
// re-seeding them at the creature's body region with outward+backward velocity.
// Living particles advect by their velocity scaled by dt-equivalent.
function updateAndDrawWake(t) {
  const dt = 1 / 60;
  webglLayer.push();
  for (let i = 0; i < wake.length; i++) {
    const p = wake[i];

    p.life -= dt;
    if (p.life <= 0) {
      // Respawn deterministically using i + t as seed so positions vary but loop cleanly.
      // Spawn in a ring around the creature's main body region.
      const ang = (i * 0.61803398875) * TAU + t * 0.3;
      const u   = (i * 7) % wake.length / wake.length;       // body-axis position
      const xAxis = lerp(-280, 280, u);                       // along body (X)
      const r     = 80 + 60 * ((i * 13) % 7) / 7;
      p.x = xAxis;
      p.y = (Math.sin(ang) * r) * 0.45 + 30 * Math.sin(t + i);
      p.z = Math.cos(ang) * r;
      // Velocity: drift backward (along body tangent +X) and outward radially
      const radOut = 0.5 + 0.5 * (((i * 19) % 11) / 11);
      p.vx = 30 + 20 * radOut;
      p.vy = (p.y > 0 ? 1 : -1) * 8 * radOut;
      p.vz = (p.z > 0 ? 1 : -1) * 18 * radOut;
      p.maxLife = 1.6 + 1.4 * (((i * 23) % 13) / 13);
      p.life = p.maxLife;
    }

    // Advect
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    // Gentle damping
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.vz *= 0.985;

    const lifeFrac = p.life / p.maxLife;       // 1 = fresh, 0 = dying
    const fade = lifeFrac * (1 - lifeFrac) * 4; // peaks mid-life (bell curve)

    const d = viewDepth(p.x, p.y, p.z);
    const fog = fogFactor(d);

    // Three-pass bubble: wide halo + medium glow + bright pinpoint core
    webglLayer.stroke(255, 255, 255, 22 * fog * fade);
    webglLayer.strokeWeight(5.0);
    webglLayer.point(p.x, p.y, p.z);
    webglLayer.stroke(255, 255, 255, 70 * fog * fade);
    webglLayer.strokeWeight(2.2);
    webglLayer.point(p.x, p.y, p.z);
    webglLayer.stroke(255, 255, 255, 200 * fog * fade);
    webglLayer.strokeWeight(1.0);
    webglLayer.point(p.x, p.y, p.z);
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

    webglLayer.stroke(255, 255, 255, (18 + 48 * k) * fog);
    webglLayer.strokeWeight(6 * p.scale);
    webglLayer.point(p.x, p.y, p.z);
    webglLayer.stroke(255, 255, 255, (140 + 180 * k) * fog);
    webglLayer.strokeWeight(1.6 * p.scale);
    webglLayer.point(p.x, p.y, p.z);
  }
  webglLayer.pop();
}

// ─── Inner caustic rays ──────────────────────────────────────────────────────
function drawInnerRays(t) {
  webglLayer.push();
  for (let i = 0; i < rays.length; i++) {
    const r = rays[i];
    const wob = 0.06 * Math.sin(t * 0.5 + r.phase);
    const len = r.length * (0.85 + 0.15 * Math.sin(t * 0.7 + r.phase));
    const c = Math.cos(wob), s = Math.sin(wob);
    const dx = r.dx * c - r.dz * s;
    const dz = r.dx * s + r.dz * c;
    const dy = r.dy;
    const ex = dx * len, ey = dy * len, ez = dz * len;
    const dEnd = viewDepth(ex, ey, ez);
    const fog  = fogFactor(dEnd);

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
  const taps = [
    { dx:  0,  dy:  0,  a: 64 },
    { dx:  6,  dy:  0,  a: 46 },
    { dx: -6,  dy:  0,  a: 46 },
    { dx: 14,  dy:  0,  a: 32 },
    { dx: -14, dy:  0,  a: 32 },
    { dx: 26,  dy:  0,  a: 22 },
    { dx: -26, dy:  0,  a: 22 },
    { dx: 44,  dy:  0,  a: 14 },
    { dx: -44, dy:  0,  a: 14 },
    { dx: 70,  dy:  0,  a:  8 },
    { dx: -70, dy:  0,  a:  8 },
    { dx:  0,  dy:  3,  a: 26 },
    { dx:  0,  dy: -3,  a: 26 },
    { dx:  0,  dy:  7,  a: 14 },
    { dx:  0,  dy: -7,  a: 14 },
    { dx:  0,  dy: 14,  a:  8 },
    { dx:  0,  dy:-14,  a:  8 },
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
  text('ANOMALOCARIS · CAMBRIAN DRIFT · B&W', 52, 52);

  fill(255, 255, 255, 95);
  textSize(10);
  text('spine = ' + SPINE_SEGS + '   ribs = ' + RIB_SEGS + '   loop = ' + loop.toFixed(3), 52, 76);

  fill(255, 255, 255, 65);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text('φ=' + PHI.toFixed(6), 52, H - 52);
  textAlign(RIGHT, BOTTOM);
  text('20260506 · CREATURE · B&W', W - 52, H - 52);
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
    const a = map(k, 0.78, 1.0, 0, 90, true);
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
  if (key === 's' || key === 'S') { saveCanvas('20260506_creature_' + ts(), 'png'); return false; }
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
  a.href = url; a.download = '20260506_creature_' + ts() + '.mp4'; a.click();
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

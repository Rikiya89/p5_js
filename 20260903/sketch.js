"use strict";

// Existing project framework: retained exactly.
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;

const BG = { r: 3, g: 3, b: 5 };
const INK = { r: 255, g: 255, b: 255 };
const CYAN = { r: 0, g: 229, b: 255 };
const MAGENTA = { r: 255, g: 61, b: 191 };
const ACID = { r: 182, g: 255, b: 61 };

const CONFIG = {
  surfaceUSegments: 84,
  surfaceVSegments: 56,
  sphereRadius: 240,

  // Deterministic normalized mean-curvature-flow ladder. Each saved state is
  // separated by several stable normal-projected mesh relaxation steps.
  flowStates: 64,
  flowStepsPerState: 8,
  flowStep: 0.19,

  surfaceLineWeight: 1.35,
  surfaceVisualScale: 1.06,
  cameraDistance: 1030,
  cameraMaxDistance: 1800,
  framingFill: 0.78,
  fogDepthRange: 1100,
};

// Asymmetric fused bubble lobes:
// 4 primary + 7 secondary + 9 tertiary deformation centers. Higher
// concentration keeps neighboring volumes visibly distinct while their bases
// overlap smoothly, so this remains one radial genus-0 manifold.
const LOBES = [
  // 4 Primary large dominant lobes (persist longest)
  { d: [-0.10, 0.96, 0.26], amp: 0.88, k: 7.2 },
  { d: [-0.82, -0.18, 0.54], amp: 0.82, k: 7.8 },
  { d: [0.77, -0.38, 0.51], amp: 0.86, k: 8.3 },
  { d: [0.08, -0.91, -0.41], amp: 0.90, k: 6.8 },

  // 7 Secondary medium lobes (merge in middle phase)
  { d: [0.88, 0.44, -0.18], amp: 0.62, k: 12.5 },
  { d: [-0.66, 0.69, -0.29], amp: 0.58, k: 13.8 },
  { d: [-0.42, -0.63, -0.65], amp: 0.64, k: 11.8 },
  { d: [0.39, 0.12, 0.91], amp: 0.56, k: 14.6 },
  { d: [-0.94, 0.20, -0.27], amp: 0.66, k: 12.0 },
  { d: [0.18, -0.28, -0.94], amp: 0.60, k: 13.2 },
  { d: [0.73, -0.67, -0.12], amp: 0.61, k: 12.7 },

  // 9 small tertiary high-curvature bumps (disappear first)
  { d: [0.33, 0.88, -0.34], amp: 0.40, k: 25.0 },
  { d: [-0.39, 0.84, 0.38], amp: 0.38, k: 29.0 },
  { d: [-0.56, -0.74, 0.37], amp: 0.43, k: 23.0 },
  { d: [0.92, -0.12, 0.37], amp: 0.36, k: 28.0 },
  { d: [-0.12, 0.32, 0.94], amp: 0.39, k: 26.0 },
  { d: [0.58, 0.72, 0.39], amp: 0.37, k: 31.0 },
  { d: [-0.91, -0.36, 0.18], amp: 0.35, k: 27.0 },
  { d: [0.48, -0.84, 0.25], amp: 0.41, k: 24.0 },
  { d: [-0.22, 0.04, -0.97], amp: 0.34, k: 30.0 },
];

const LOBE_GROUPS = {
  largeEnd: 4,
  mediumEnd: 11,
};

// Normalize lobe directions
for (const m of LOBES) {
  const len = Math.hypot(...m.d) || 1;
  m.d[0] /= len; m.d[1] /= len; m.d[2] /= len;
}

// Choreographed timeline phases (10.0s / 600 frames):
// 0.0-0.5s: 01 · COMPLEX SURFACE (immediate hook, complex fused bubbles)
// 0.5-2.0s: 02 · LOCAL SMOOTHING (small tertiary bumps rapidly dissolve)
// 2.0-4.0s: 03 · LOBE MERGING (medium lobes merge into larger body)
// 4.0-6.5s: 04 · GLOBAL ROUNDING (object reduces to ~4 large dominant forms)
// 6.5-9.3s: 05 · NEAR SPHERE (final smoothing, then a brief equilibrium)
// 9.3-10.0s: constructive large-to-small lobe return (kept out of the HUD)
const PHASE_BOUNDS = {
  hookEnd: 0.05,
  microEnd: 0.20,
  mergeEnd: 0.40,
  roundingEnd: 0.65,
  smoothingEnd: 0.85,
  sphereEnd: 0.93,
  loopEnd: 1.00,
};

const PHASES = [
  { key: "CLUSTER", label: "01 · COMPLEX SURFACE" },
  { key: "MICRO", label: "02 · LOCAL SMOOTHING" },
  { key: "MERGE", label: "03 · LOBE MERGING" },
  { key: "ROUNDING", label: "04 · GLOBAL ROUNDING" },
  { key: "SPHERE", label: "05 · NEAR SPHERE" },
];

const HUD = {
  safeX: 56,
  stageY: 374,
  trackY: 418,
  bottomMainAlpha: 140,
  bottomProcessAlpha: 115,
  citationAlpha: 64,
};

const uSeg = CONFIG.surfaceUSegments;
const vSeg = CONFIG.surfaceVSegments;
const pointCount = uSeg * vSeg;

// Discrete flow state storage
let flowStates = [];
let flowCurvatures = [];
let flowNormals = [];
let restorationStates = [];
let restorationCurvatures = [];
let restorationNormals = [];
let curvatureReference = 1;

const surface = {
  positions: new Float32Array(pointCount * 3),
  curvature: new Float32Array(pointCount),
  normals: new Float32Array(pointCount * 3),
  colors: new Float32Array(pointCount * 3),
};

let canvasEl = null;
let grainPg = null;
let hudPg = null;
let bloomPg = null;
let bloomStreakPg = null;
const BLOOM_SCALE = 0.5;
let loopProgress = 0;
let phase = 0;
let flowT = 0;
const previewParam = typeof window !== "undefined" ?
  new URLSearchParams(window.location.search).get("preview") : null;
const previewProgress = previewParam === null ? NaN : Number(previewParam);

// Deterministic WebCodecs + mp4-muxer recording pipeline
let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;

function setup() {
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  strokeCap(ROUND);
  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  bloomPg = createGraphics(W * BLOOM_SCALE, H * BLOOM_SCALE, WEBGL);
  bloomPg.pixelDensity(1);
  bloomStreakPg = createGraphics(W * BLOOM_SCALE, H * BLOOM_SCALE);
  bloomStreakPg.pixelDensity(1);
  bakeGrain();
  buildBubbleFlowStates();
  buildRestorationStates();

  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").onclick = startRecording;
  if (el("stopBtn")) el("stopBtn").onclick = stopRecording;
  if (el("maxDuration")) el("maxDuration").textContent = MAX_DURATION;
  if (el("canvasSize")) el("canvasSize").textContent = W + " × " + H;
  if (el("maxFrames")) el("maxFrames").textContent = MAX_FRAMES;
}

function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  randomSeed(20260903);
  for (let i = 0; i < Math.floor(W * H * 0.0016); i++) {
    const value = random(110, 200);
    grainPg.fill(value, value, value, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.15, 0.85));
  }
  for (let i = 0; i < Math.floor(W * H * 0.000035); i++) {
    const value = random(210, 255);
    grainPg.fill(value, value, value, random(12, 34));
    grainPg.circle(random(W), random(H), random(0.4, 1.2));
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothstepSegment(t, t0, t1, v0, v1) {
  const local = t1 === t0 ? 1 : clamp((t - t0) / (t1 - t0), 0, 1);
  return v0 + (v1 - v0) * smooth01(local);
}

function surgeSegment(t, t0, t1, v0, v1, strength = 0.12) {
  const local = t1 === t0 ? 1 : clamp((t - t0) / (t1 - t0), 0, 1);
  // Strictly monotonic, but front-loaded so every stage opens with an obvious
  // geometric event rather than spending its first frames easing in.
  const surged = local + strength * Math.sin(Math.PI * local);
  return lerp(v0, v1, surged);
}

function activeMotionProfile(t = loopProgress) {
  let local = 0;
  let stageStrength = 0;
  if (t >= PHASE_BOUNDS.hookEnd && t < PHASE_BOUNDS.microEnd) {
    local = (t - PHASE_BOUNDS.hookEnd) / (PHASE_BOUNDS.microEnd - PHASE_BOUNDS.hookEnd);
    stageStrength = 0.78;
  } else if (t >= PHASE_BOUNDS.microEnd && t < PHASE_BOUNDS.mergeEnd) {
    local = (t - PHASE_BOUNDS.microEnd) / (PHASE_BOUNDS.mergeEnd - PHASE_BOUNDS.microEnd);
    stageStrength = 1.0;
  } else if (t >= PHASE_BOUNDS.mergeEnd && t < PHASE_BOUNDS.roundingEnd) {
    local = (t - PHASE_BOUNDS.mergeEnd) / (PHASE_BOUNDS.roundingEnd - PHASE_BOUNDS.mergeEnd);
    stageStrength = 0.86;
  }
  const envelope = Math.pow(Math.sin(Math.PI * clamp(local, 0, 1)), 0.72) * stageStrength;
  const pulse = 0.5 + 0.5 * Math.sin(TAU * (local * 1.65 + t * 0.35));
  return { energy: envelope, pulse, local };
}

function objectMotion() {
  const active = activeMotionProfile();
  return {
    scale: CONFIG.surfaceVisualScale * (1 + active.energy * (0.012 + 0.010 * active.pulse)),
    orbit: 0.60 * Math.sin(phase * 0.5) + active.energy * 0.16 * Math.sin(phase * 4.2),
    tiltX: 0.18 + 0.08 * Math.sin(phase) + active.energy * 0.085 * Math.sin(phase * 3.1 + 0.6),
    tiltZ: 0.06 * Math.cos(phase) + active.energy * 0.070 * Math.cos(phase * 3.7),
  };
}

function paramIndex(i, j) {
  const wrappedI = (i + uSeg) % uSeg;
  const boundedJ = clamp(j, 0, vSeg - 1);
  return wrappedI * vSeg + boundedJ;
}

// Maps the visible choreography to the forward-only flow ladder. The early
// intervals intentionally consume more states so small, sharp lobes react in
// the first second while broad features persist into global rounding.
function flowEnvelope(t) {
  if (t < PHASE_BOUNDS.hookEnd) {
    return smoothstepSegment(t, 0, PHASE_BOUNDS.hookEnd, 0, 0.025);
  }
  if (t < PHASE_BOUNDS.microEnd) {
    return surgeSegment(t, PHASE_BOUNDS.hookEnd, PHASE_BOUNDS.microEnd, 0.025, 0.12, 0.13);
  }
  if (t < PHASE_BOUNDS.mergeEnd) {
    return surgeSegment(t, PHASE_BOUNDS.microEnd, PHASE_BOUNDS.mergeEnd, 0.12, 0.34, 0.14);
  }
  if (t < PHASE_BOUNDS.roundingEnd) {
    return surgeSegment(t, PHASE_BOUNDS.mergeEnd, PHASE_BOUNDS.roundingEnd, 0.34, 0.78, 0.13);
  }
  if (t < PHASE_BOUNDS.smoothingEnd) {
    return smoothstepSegment(t, PHASE_BOUNDS.roundingEnd, PHASE_BOUNDS.smoothingEnd, 0.78, 1.0);
  }
  return 1.0;
}

// Evaluates the initial fused multi-lobed closed manifold at parameters (u, v).
// Constructed as a smooth radial deformation on S^2 with directional lobe centers.
function evaluateBubble(u, v, groupWeights = [1, 1, 1]) {
  const sinV = Math.sin(v);
  const cosV = Math.cos(v);
  const nx = sinV * Math.cos(u);
  const ny = cosV;
  const nz = sinV * Math.sin(u);

  let sum = 0;
  for (let lobeIndex = 0; lobeIndex < LOBES.length; lobeIndex++) {
    const m = LOBES[lobeIndex];
    const dot = nx * m.d[0] + ny * m.d[1] + nz * m.d[2];
    const group = lobeIndex < LOBE_GROUPS.largeEnd ? 0 :
      (lobeIndex < LOBE_GROUPS.mediumEnd ? 1 : 2);
    const bump = m.amp * groupWeights[group] * Math.exp(m.k * (dot - 1));
    sum += bump;
  }

  const r = CONFIG.sphereRadius * (1 + sum);
  return [r * nx, r * ny, r * nz];
}

function copyPositions(source) {
  return new Float32Array(source);
}

function computeGeometryFields(pos) {
  const cur = new Float32Array(pointCount);
  const nor = new Float32Array(pointCount * 3);
  let maxH = 1e-6;

  for (let i = 0; i < uSeg; i++) {
    for (let j = 0; j < vSeg; j++) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      let nx = 0, ny = 0, nz = 0;

      if (j === 0 || j === vSeg - 1) {
        ny = j === 0 ? 1 : -1;
      } else {
        const iP = paramIndex(i + 1, j) * 3;
        const iM = paramIndex(i - 1, j) * 3;
        const jP = paramIndex(i, j + 1) * 3;
        const jM = paramIndex(i, j - 1) * 3;
        const tux = pos[iP] - pos[iM];
        const tuy = pos[iP + 1] - pos[iM + 1];
        const tuz = pos[iP + 2] - pos[iM + 2];
        const tvx = pos[jP] - pos[jM];
        const tvy = pos[jP + 1] - pos[jM + 1];
        const tvz = pos[jP + 2] - pos[jM + 2];
        const cx = tuy * tvz - tuz * tvy;
        const cy = tuz * tvx - tux * tvz;
        const cz = tux * tvy - tuy * tvx;
        const clen = Math.hypot(cx, cy, cz) || 1;
        nx = cx / clen; ny = cy / clen; nz = cz / clen;
      }

      nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;

      let sx = 0, sy = 0, sz = 0, weightSum = 0;
      const neighbors = [
        [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
        [-1, -1, 0.35], [1, -1, 0.35], [-1, 1, 0.35], [1, 1, 0.35],
      ];
      for (const [di, dj, weight] of neighbors) {
        if (j + dj < 0 || j + dj >= vSeg) continue;
        const no = paramIndex(i + di, j + dj) * 3;
        sx += pos[no] * weight;
        sy += pos[no + 1] * weight;
        sz += pos[no + 2] * weight;
        weightSum += weight;
      }
      sx /= weightSum; sy /= weightSum; sz /= weightSum;
      const lx = sx - pos[o], ly = sy - pos[o + 1], lz = sz - pos[o + 2];
      const signedNormalLaplacian = lx * nx + ly * ny + lz * nz;
      const hVal = Math.abs(signedNormalLaplacian);
      cur[idx] = hVal;
      if (hVal > maxH) maxH = hVal;
    }
  }

  return { cur, nor, maxH };
}

function meanRadius(pos) {
  let sum = 0;
  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    sum += Math.hypot(pos[o], pos[o + 1], pos[o + 2]);
  }
  return sum / pointCount;
}

// One stable step of volume-normalized mean curvature flow. The umbrella
// Laplacian estimates the curvature vector; projecting it onto the surface
// normal prevents UV parameter drift from becoming the visible motion.
function evolveMeanCurvatureStep(pos, progress) {
  const fields = computeGeometryFields(pos);
  const next = copyPositions(pos);
  const lambda = CONFIG.flowStep;

  for (let i = 0; i < uSeg; i++) {
    for (let j = 1; j < vSeg - 1; j++) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      let sx = 0, sy = 0, sz = 0, weightSum = 0;
      const neighbors = [
        [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
        [-1, -1, 0.35], [1, -1, 0.35], [-1, 1, 0.35], [1, 1, 0.35],
      ];
      for (const [di, dj, weight] of neighbors) {
        const no = paramIndex(i + di, j + dj) * 3;
        sx += pos[no] * weight;
        sy += pos[no + 1] * weight;
        sz += pos[no + 2] * weight;
        weightSum += weight;
      }
      const lx = sx / weightSum - pos[o];
      const ly = sy / weightSum - pos[o + 1];
      const lz = sz / weightSum - pos[o + 2];
      const nx = fields.nor[o], ny = fields.nor[o + 1], nz = fields.nor[o + 2];
      const normalLaplacian = lx * nx + ly * ny + lz * nz;
      next[o] += lambda * normalLaplacian * nx;
      next[o + 1] += lambda * normalLaplacian * ny;
      next[o + 2] += lambda * normalLaplacian * nz;
    }
  }

  // Collapse each duplicated pole to one point derived from its adjacent ring.
  for (const poleJ of [0, vSeg - 1]) {
    const adjacentJ = poleJ === 0 ? 1 : vSeg - 2;
    let px = 0, py = 0, pz = 0;
    for (let i = 0; i < uSeg; i++) {
      const o = paramIndex(i, adjacentJ) * 3;
      px += next[o]; py += next[o + 1]; pz += next[o + 2];
    }
    px /= uSeg; py /= uSeg; pz /= uSeg;
    for (let i = 0; i < uSeg; i++) {
      const o = paramIndex(i, poleJ) * 3;
      next[o] = px; next[o + 1] = py; next[o + 2] = pz;
    }
  }

  // The latitude-longitude mesh is intentionally kept as a radial graph.
  // A weak late-stage normalized-flow term counters UV-grid anisotropy; it is
  // negligible during lobe loss and becomes strong only near equilibrium.
  const spherePull = 0.0008 + 0.032 * Math.pow(progress, 3.2);
  for (let i = 0; i < uSeg; i++) {
    const u = (i / uSeg) * TAU;
    for (let j = 0; j < vSeg; j++) {
      const v = (j / (vSeg - 1)) * Math.PI;
      const sinV = Math.sin(v);
      const nx = sinV * Math.cos(u), ny = Math.cos(v), nz = sinV * Math.sin(u);
      const o = paramIndex(i, j) * 3;
      const tx = CONFIG.sphereRadius * 1.015 * nx;
      const ty = CONFIG.sphereRadius * 1.015 * ny;
      const tz = CONFIG.sphereRadius * 1.015 * nz;
      next[o] = lerp(next[o], tx, spherePull);
      next[o + 1] = lerp(next[o + 1], ty, spherePull);
      next[o + 2] = lerp(next[o + 2], tz, spherePull);
    }
  }

  // Normalized MCF keeps the sculpture legible while converging toward the
  // compact reference radius instead of numerically collapsing to a point.
  const targetMeanRadius = lerp(meanRadius(pos), CONFIG.sphereRadius * 1.015, 0.018 + progress * 0.012);
  const scaleCorrection = targetMeanRadius / Math.max(1e-6, meanRadius(next));
  for (let o = 0; o < next.length; o += 3) {
    next[o] *= scaleCorrection;
    next[o + 1] *= scaleCorrection;
    next[o + 2] *= scaleCorrection;
  }
  return next;
}

function pushState(pos, states, curvatures, normals) {
  const fields = computeGeometryFields(pos);
  if (flowStates.length === 0 && states === flowStates) {
    curvatureReference = fields.maxH;
  }
  for (let k = 0; k < fields.cur.length; k++) {
    fields.cur[k] = clamp(fields.cur[k] / Math.max(1e-6, curvatureReference), 0, 1);
  }
  states.push(copyPositions(pos));
  curvatures.push(fields.cur);
  normals.push(fields.nor);
}

// Precomputes the actual discrete flow once. Playback only interpolates saved
// states, keeping animation and recording deterministic at 60 FPS.
function buildBubbleFlowStates() {
  const du = TAU / uSeg;
  const dv = Math.PI / (vSeg - 1);
  let pos = new Float32Array(pointCount * 3);
  for (let i = 0; i < uSeg; i++) {
    for (let j = 0; j < vSeg; j++) {
      const [x, y, z] = evaluateBubble(i * du, j * dv);
      const o = paramIndex(i, j) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
    }
  }

  pushState(pos, flowStates, flowCurvatures, flowNormals);
  for (let s = 1; s < CONFIG.flowStates; s++) {
    const progress = s / (CONFIG.flowStates - 1);
    for (let iteration = 0; iteration < CONFIG.flowStepsPerState; iteration++) {
      pos = evolveMeanCurvatureStep(pos, progress);
    }
    pushState(pos, flowStates, flowCurvatures, flowNormals);
  }
}

// The loop return is a separate constructive event, not reversed MCF: broad
// modes emerge first, then medium modes, then the sharp tertiary features.
function buildRestorationStates() {
  const stateCount = 18;
  const du = TAU / uSeg;
  const dv = Math.PI / (vSeg - 1);
  const finalFlow = flowStates[flowStates.length - 1];

  for (let s = 0; s < stateCount; s++) {
    const t = s / (stateCount - 1);
    const weights = [
      smoothstepSegment(t, 0.00, 0.56, 0, 1),
      smoothstepSegment(t, 0.16, 0.84, 0, 1),
      smoothstepSegment(t, 0.48, 1.00, 0, 1),
    ];
    const pos = new Float32Array(pointCount * 3);
    const radialize = smoothstepSegment(t, 0, 0.22, 0, 1);
    for (let i = 0; i < uSeg; i++) {
      const u = i * du;
      for (let j = 0; j < vSeg; j++) {
        const v = j * dv;
        const idx = paramIndex(i, j);
        const o = idx * 3;
        const sinV = Math.sin(v);
        const nx = sinV * Math.cos(u), ny = Math.cos(v), nz = sinV * Math.sin(u);
        const finalRadius = finalFlow[o] * nx + finalFlow[o + 1] * ny + finalFlow[o + 2] * nz;
        const [tx, ty, tz] = evaluateBubble(u, v, weights);
        const targetRadius = Math.hypot(tx, ty, tz);
        const radius = lerp(finalRadius, targetRadius, radialize);
        pos[o] = lerp(finalFlow[o], radius * nx, radialize);
        pos[o + 1] = lerp(finalFlow[o + 1], radius * ny, radialize);
        pos[o + 2] = lerp(finalFlow[o + 2], radius * nz, radialize);
      }
    }
    pushState(pos, restorationStates, restorationCurvatures, restorationNormals);
  }
}

function updateLoopTime() {
  const frame = isRecording ? recFrameCount : frameCount - 1;
  loopProgress = !isRecording && Number.isFinite(previewProgress) ?
    clamp(previewProgress, 0, 0.999999) :
    (((frame % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  phase = loopProgress * TAU;
  flowT = loopProgress;
}

function currentPhaseInfo() {
  if (loopProgress >= PHASE_BOUNDS.roundingEnd) return PHASES[4];
  if (loopProgress >= PHASE_BOUNDS.mergeEnd) return PHASES[3];
  if (loopProgress >= PHASE_BOUNDS.microEnd) return PHASES[2];
  if (loopProgress >= PHASE_BOUNDS.hookEnd) return PHASES[1];
  return PHASES[0];
}

function getEquationHighlight(t) {
  const activeCol = (t >= 0.05 && t <= 0.85) ? 1.0 : 0.65;
  return {
    dX: activeCol,
    dt: activeCol,
    eq: (t >= 0.20 && t <= 0.85) ? 1.0 : 0.55,
    H: (t >= 0.05 && t <= 0.85) ? 1.0 : 0.55,
    n: (t >= 0.05 && t <= 0.85) ? 1.0 : 0.55,
  };
}

function draw() {
  updateLoopTime();
  updateFlowSurface();
  renderFrame();
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

let maxRadius = CONFIG.sphereRadius * 1.6;
let maxVerticalExtent = CONFIG.sphereRadius * 1.6;

// Interpolates between discrete flow ladder states.
function updateFlowSurface() {
  const restoring = loopProgress >= PHASE_BOUNDS.sphereEnd;
  const states = restoring ? restorationStates : flowStates;
  const curvatures = restoring ? restorationCurvatures : flowCurvatures;
  const normals = restoring ? restorationNormals : flowNormals;
  const stateProgress = restoring ?
    clamp((loopProgress - PHASE_BOUNDS.sphereEnd) / (1 - PHASE_BOUNDS.sphereEnd), 0, 1) :
    flowEnvelope(loopProgress);
  const stateF = stateProgress * (states.length - 1);
  const i0 = Math.floor(stateF);
  const i1 = Math.min(i0 + 1, states.length - 1);
  const blend = stateF - i0;

  const a = states[i0], b = states[i1];
  const ca = curvatures[i0], cb = curvatures[i1];
  const na = normals[i0], nb = normals[i1];

  let peak = 0, peakY = 0;
  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    const x = a[o] + (b[o] - a[o]) * blend;
    const y = a[o + 1] + (b[o + 1] - a[o + 1]) * blend;
    const z = a[o + 2] + (b[o + 2] - a[o + 2]) * blend;

    surface.positions[o] = x;
    surface.positions[o + 1] = y;
    surface.positions[o + 2] = z;

    const nx = na[o] + (nb[o] - na[o]) * blend;
    const ny = na[o + 1] + (nb[o + 1] - na[o + 1]) * blend;
    const nz = na[o + 2] + (nb[o + 2] - na[o + 2]) * blend;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    surface.normals[o] = nx / nlen;
    surface.normals[o + 1] = ny / nlen;
    surface.normals[o + 2] = nz / nlen;

    const c = ca[idx] + (cb[idx] - ca[idx]) * blend;
    surface.curvature[idx] = c;

    distributePaletteColor(c, surface.colors, o);

    const lateral = Math.hypot(x, z);
    if (lateral > peak) peak = lateral;
    const absY = Math.abs(y);
    if (absY > peakY) peakY = absY;
  }
  maxRadius = peak;
  maxVerticalExtent = peakY;
}

function renderFrame() {
  setupCamera();
  renderBloomSource();
  streakBloom();

  background(BG.r, BG.g, BG.b);
  perspective(PI / 3.35, W / H, 10, 5000);
  drawEnvironment();

  push();
  const equilibriumBreath = loopProgress >= PHASE_BOUNDS.smoothingEnd && loopProgress < PHASE_BOUNDS.sphereEnd ?
    1 + 0.006 * Math.sin(phase * 3) : 1;
  const motion = objectMotion();
  scale(motion.scale * equilibriumBreath);

  // The global orbit stays slow; stages 02-04 add short sculptural inspection
  // arcs and tilt accents without turning the object into a fast spinner.
  rotateY(motion.orbit);
  rotateX(motion.tiltX);
  rotateZ(motion.tiltZ);

  // 1. Surface Mass (Translucent glass / iridescent liquid membrane, 85% visual mass)
  drawSurfaceMass();

  // 2. Structural Lines (Sparse flowing contours, 15% visual mass)
  drawCurvatureContours();

  pop();

  compositeBloom();
  drawScreenFinish();
}

// Camera choreography:
// Slow cinematic orbit (total ~35 degrees), slight vertical movement and subtle perspective
const cameraEye = { x: 0, y: 0, z: 0 };
const VFOV = Math.PI / 3.35;
const ASPECT = W / H;
const TAN_HALF_VFOV = Math.tan(VFOV / 2);

function setupCamera() {
  const active = activeMotionProfile();
  const eyeX = 85 * Math.sin(phase * 0.5) + active.energy * 62 * Math.sin(phase * 3.6);
  const eyeY = -28 + 18 * Math.sin(phase) + active.energy * 34 * Math.cos(phase * 3.1);

  const distForVertical = maxVerticalExtent / (TAN_HALF_VFOV * CONFIG.framingFill);
  const distForLateral = maxRadius / (TAN_HALF_VFOV * ASPECT * CONFIG.framingFill);
  const baseEyeZ = Math.min(
    Math.max(distForVertical, distForLateral, CONFIG.cameraDistance),
    CONFIG.cameraMaxDistance,
  );
  const eyeZ = baseEyeZ * (1 - active.energy * (0.035 + 0.025 * active.pulse));
  cameraEye.x = eyeX; cameraEye.y = eyeY; cameraEye.z = eyeZ;
  camera(eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
}

function fogFactor(viewDepth) {
  const nearDepth = cameraEye.z - CONFIG.fogDepthRange * 0.5;
  const t = clamp((viewDepth - nearDepth) / CONFIG.fogDepthRange, 0, 1);
  return 1 - smooth01(t) * 0.82;
}

function viewDepthAt(offset) {
  const dx = surface.positions[offset] - cameraEye.x;
  const dy = surface.positions[offset + 1] - cameraEye.y;
  const dz = surface.positions[offset + 2] - cameraEye.z;
  return Math.hypot(dx, dy, dz);
}

function drawEnvironment() {
  noFill();
  strokeWeight(0.62);
  const fieldRadius = 420;
  for (let ring = 0; ring < 3; ring++) {
    const radius = fieldRadius + ring * 110;
    stroke(INK.r, INK.g, INK.b, 8 - ring * 1.8);
    beginShape();
    for (let j = 0; j <= 96; j++) {
      const a = (j / 96) * TAU;
      vertex(Math.cos(a) * radius, Math.sin(a) * radius, -350 - ring * 24);
    }
    endShape();
  }
  stroke(INK.r, INK.g, INK.b, 12);
  line(-fieldRadius - 90, 0, -370, fieldRadius + 90, 0, -370);
  line(0, -fieldRadius - 90, -370, 0, fieldRadius + 90, -370);
}

// Palette distribution & View-dependent iridescence:
// Facing center -> dark cool cyan/indigo body
// Mid-angle -> electric magenta/violet
// Glancing rim -> electric acid/cyan
// Curvature peaks -> brilliant acid/white highlights
function distributePaletteColor(c, colors, offset) {
  let r, g, b;
  if (c < 0.25) {
    const t = c / 0.25;
    r = CYAN.r * (0.16 + 0.38 * t);
    g = CYAN.g * (0.28 + 0.40 * t);
    b = CYAN.b * (0.46 + 0.42 * t);
  } else if (c < 0.65) {
    const t = smooth01((c - 0.25) / 0.40);
    const startR = CYAN.r * 0.54;
    const startG = CYAN.g * 0.68;
    const startB = CYAN.b * 0.88;
    r = startR + (MAGENTA.r - startR) * t;
    g = startG + (MAGENTA.g - startG) * t;
    b = startB + (MAGENTA.b - startB) * t;
  } else {
    const t = smooth01((c - 0.65) / 0.35);
    r = MAGENTA.r + (ACID.r - MAGENTA.r) * t;
    g = MAGENTA.g + (ACID.g - MAGENTA.g) * t;
    b = MAGENTA.b + (ACID.b - MAGENTA.b) * t;
  }

  colors[offset] = r;
  colors[offset + 1] = g;
  colors[offset + 2] = b;
}

// 1. SURFACE MASS (85% Visual Weight):
// Translucent blown glass / liquid mathematical bubble cluster with Fresnel edge illumination,
// dual Blinn-Phong specular glints, and curvature modulation.
function drawSurfaceMass() {
  noStroke();
  blendMode(BLEND);
  drawingContext.depthMask(true);

  // Dual moving light directions make the curvature field visibly migrate.
  const active = activeMotionProfile();
  const sweep = phase * 0.34 + active.energy * 0.55 * Math.sin(phase * 3.4);
  const l1y = -0.65;
  const l1Horizontal = Math.sqrt(1 - l1y * l1y);
  const l1x = Math.cos(-2.18 + sweep) * l1Horizontal;
  const l1z = Math.sin(-2.18 + sweep) * l1Horizontal;
  const l2y = 0.55;
  const l2Horizontal = Math.sqrt(1 - l2y * l2y);
  const l2x = Math.cos(0.88 - sweep * 0.72) * l2Horizontal;
  const l2z = Math.sin(0.88 - sweep * 0.72) * l2Horizontal;

  for (let j = 0; j < vSeg - 1; j++) {
    beginShape(TRIANGLE_STRIP);
    for (let i = 0; i <= uSeg; i++) {
      for (const dj of [0, 1]) {
        const jj = j + dj;
        const idx = paramIndex(i, jj);
        const o = idx * 3;
        const px = surface.positions[o], py = surface.positions[o + 1], pz = surface.positions[o + 2];
        const nx = surface.normals[o], ny = surface.normals[o + 1], nz = surface.normals[o + 2];

        // View vector & Fresnel rim
        const vx = cameraEye.x - px, vy = cameraEye.y - py, vz = cameraEye.z - pz;
        const vLen = Math.hypot(vx, vy, vz) || 1;
        const vnx = vx / vLen, vny = vy / vLen, vnz = vz / vLen;
        const ndotv = Math.abs(nx * vnx + ny * vny + nz * vnz);
        const rim = Math.pow(1 - clamp(ndotv, 0, 1), 1.7);

        // Blinn-Phong specular 1 (primary key light)
        const h1x = (l1x + vnx) * 0.5, h1y = (l1y + vny) * 0.5, h1z = (l1z + vnz) * 0.5;
        const h1len = Math.hypot(h1x, h1y, h1z) || 1;
        const spec1 = Math.pow(Math.max(0, (nx * h1x + ny * h1y + nz * h1z) / h1len), 22);

        // Blinn-Phong specular 2 (rim backlight)
        const h2x = (l2x + vnx) * 0.5, h2y = (l2y + vny) * 0.5, h2z = (l2z + vnz) * 0.5;
        const h2len = Math.hypot(h2x, h2y, h2z) || 1;
        const spec2 = Math.pow(Math.max(0, (nx * h2x + ny * h2y + nz * h2z) / h2len), 14);

        const diff = Math.max(0.18, nx * l1x + ny * l1y + nz * l1z);
        const c = surface.curvature[idx];

        // A substantial translucent body makes the manifold read as one closed
        // surface. View angle shifts only among the established palette.
        const fog = fogFactor(viewDepthAt(o));
        const iridescence = smooth01(rim);
        const curvatureAccent = smooth01(c);
        const baseR = lerp(CYAN.r * 0.18, MAGENTA.r * 0.72, iridescence);
        const baseG = lerp(CYAN.g * 0.34, MAGENTA.g * 0.34, iridescence);
        const baseB = lerp(CYAN.b * 0.58, MAGENTA.b * 0.82, iridescence);
        const accentR = lerp(baseR, ACID.r, curvatureAccent * 0.48);
        const accentG = lerp(baseG, ACID.g, curvatureAccent * 0.48);
        const accentB = lerp(baseB, ACID.b, curvatureAccent * 0.48);
        const a = (142 + 48 * rim + 22 * diff + 28 * curvatureAccent) * fog;
        const highlightEnergy = 1 + active.energy * (0.38 + 0.46 * active.pulse);
        const specHighlight = (spec1 * 155 + spec2 * 74) * highlightEnergy;
        fill(
          Math.min(255, accentR + specHighlight),
          Math.min(255, accentG + specHighlight),
          Math.min(255, accentB + specHighlight),
          a,
        );
        vertex(px, py, pz);
      }
    }
    endShape();
  }

  blendMode(BLEND);
}

// 2. STRUCTURAL CONTOURS (15% Visual Weight):
// Only 5 sparse longitudinal ribbons and 2 latitude rings trace the surface.
// No dense wireframe!
function drawCurvatureContours() {
  blendMode(ADD);
  const active = activeMotionProfile();

  // 5 sparse longitudinal streamlines
  const streamStep = Math.floor(uSeg / 5);
  for (let s = 0; s < 5; s++) {
    const i = s * streamStep;
    noFill();
    beginShape();
    for (let j = 0; j < vSeg; j++) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      const c = surface.curvature[idx];

      strokeWeight(CONFIG.surfaceLineWeight * (1.1 + 1.8 * c));
      const a = (34 + 116 * c) * (1 + active.energy * 0.42 * active.pulse) * fogFactor(viewDepthAt(o));
      stroke(surface.colors[o], surface.colors[o + 1], surface.colors[o + 2], a);
      vertex(surface.positions[o], surface.positions[o + 1], surface.positions[o + 2]);
    }
    endShape();
  }

  // 2 sparse latitude rings
  const latRings = [19, 37];
  for (const j of latRings) {
    noFill();
    beginShape();
    for (let i = 0; i <= uSeg; i += 2) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      const c = surface.curvature[idx];

      strokeWeight(CONFIG.surfaceLineWeight * (0.9 + 1.2 * c));
      const a = (28 + 96 * c) * (1 + active.energy * 0.36 * active.pulse) * fogFactor(viewDepthAt(o));
      stroke(surface.colors[o], surface.colors[o + 1], surface.colors[o + 2], a);
      vertex(surface.positions[o], surface.positions[o + 1], surface.positions[o + 2]);
    }
    endShape();
  }

  blendMode(BLEND);
}

// Half-resolution bloom pass: focuses on brightest Fresnel edges & high-curvature lobe peaks
function renderBloomSource() {
  const b = bloomPg;
  b.push();
  b.background(0);
  b.perspective(PI / 3.35, W / H, 10, 5000);
  b.camera(cameraEye.x, cameraEye.y, cameraEye.z, 0, 0, 0, 0, 1, 0);
  b.blendMode(ADD);
  b.noFill();

  b.push();
  const equilibriumBreath = loopProgress >= PHASE_BOUNDS.smoothingEnd && loopProgress < PHASE_BOUNDS.sphereEnd ?
    1 + 0.006 * Math.sin(phase * 3) : 1;
  const motion = objectMotion();
  const active = activeMotionProfile();
  b.scale(motion.scale * equilibriumBreath);
  b.rotateY(motion.orbit);
  b.rotateX(motion.tiltX);
  b.rotateZ(motion.tiltZ);

  // Isolated highlights bloom at curvature peaks without rebuilding a grid.
  b.strokeWeight(3.2);
  for (let j = 4; j < vSeg - 4; j += 2) {
    for (let i = 0; i < uSeg; i += 2) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      const c = surface.curvature[idx];
      if (c > 0.34) {
        const a = 112 * c * c * (1 + active.energy * (0.5 + 0.6 * active.pulse)) * fogFactor(viewDepthAt(o));
        b.stroke(surface.colors[o], surface.colors[o + 1], surface.colors[o + 2], a);
        b.point(surface.positions[o], surface.positions[o + 1], surface.positions[o + 2]);
      }
    }
  }
  b.pop();
  b.pop();
}

function streakBloom() {
  const s = bloomStreakPg;
  const taps = 14;
  const active = activeMotionProfile();
  const spread = 8 + active.energy * (3 + 3 * active.pulse);
  s.clear();
  s.push();
  s.blendMode(ADD);
  s.imageMode(CENTER);
  const cx = s.width / 2, cy = s.height / 2;
  for (let k = -taps; k <= taps; k++) {
    const falloff = 1 - Math.abs(k) / taps;
    s.tint(255, 255, 255, 22 * falloff * falloff * (1 + active.energy * 0.72));
    s.image(bloomPg, cx + k * spread, cy);
  }
  s.pop();
}

function compositeBloom() {
  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
  ortho(-W * 0.5, W * 0.5, -H * 0.5, H * 0.5, -10, 10);
  noLights();
  blendMode(ADD);
  tint(255, 255, 255, 235);
  image(bloomStreakPg, -W * 0.5, -H * 0.5, W, H);
  noTint();
  blendMode(BLEND);
  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

function displayProgress() {
  const frame = Math.round(loopProgress * LOOP_FRAMES);
  return clamp(frame / Math.max(1, LOOP_FRAMES - 1), 0, 1);
}

function flowPercentText(progress) {
  return Math.floor(progress * 100) + "%";
}

// Tokenized formula: ∂X / ∂t = -H n
const FORMULA_BASE_SIZE = 34;
const FORMULA_SUB_SIZE = 21;
const FORMULA_TOKENS = [
  { text: "∂X", weightKey: "dX" },
  { text: " / ", weightKey: "dt" },
  { text: "∂t", weightKey: "dt" },
  { text: "  =  ", weightKey: "eq" },
  { text: "-H", weightKey: "H" },
  { text: " n", weightKey: "n" },
];

function drawFormula(g, cx, cy, tokens, weights, alphaScale = 1) {
  g.textSize(FORMULA_BASE_SIZE);
  g.textStyle(NORMAL);
  let totalW = 0;
  const widths = tokens.map((tok) => {
    g.textSize(tok.sub ? FORMULA_SUB_SIZE : FORMULA_BASE_SIZE);
    const w = g.textWidth(tok.text);
    totalW += w;
    return w;
  });
  let x = cx - totalW * 0.5;
  g.textAlign(LEFT, CENTER);
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    const wgt = tok.weightKey ? weights[tok.weightKey] : 1;
    g.fill(INK.r, INK.g, INK.b, 235 * wgt * alphaScale);
    g.textSize(tok.sub ? FORMULA_SUB_SIZE : FORMULA_BASE_SIZE);
    g.text(tok.text, x, tok.sub ? cy + 7 : cy);
    x += widths[k];
  }
  g.textAlign(CENTER, CENTER);
}

function drawScreenFinish() {
  const g = hudPg;
  const info = currentPhaseInfo();
  const progress = displayProgress();
  g.clear();
  g.image(grainPg, 0, 0);

  g.noFill();
  g.stroke(INK.r, INK.g, INK.b, 38);
  g.strokeWeight(0.7);
  const m = 34, l = 24;
  g.line(m, m, m + l, m); g.line(m, m, m, m + l);
  g.line(W - m, m, W - m - l, m); g.line(W - m, m, W - m, m + l);
  g.line(m, H - m, m + l, H - m); g.line(m, H - m, m, H - m - l);
  g.line(W - m, H - m, W - m - l, H - m); g.line(W - m, H - m, W - m, H - m - l);

  // Typography system preserved from original template
  g.noStroke();
  g.textFont("Georgia");
  g.textAlign(CENTER, CENTER);
  g.textStyle(BOLD);
  g.fill(INK.r, INK.g, INK.b, 246);
  g.textSize(72);
  g.text("MEAN CURVATURE FLOW", W * 0.5, 210);

  g.textStyle(NORMAL);
  g.textFont("monospace");
  drawFormula(g, W * 0.5, 276, FORMULA_TOKENS, getEquationHighlight(loopProgress));

  // Instagram hook subtitle
  g.fill(INK.r, INK.g, INK.b, 166);
  g.textSize(26);
  g.text("THIS SHAPE WANTS TO BECOME A SPHERE", W * 0.5, 326);

  g.push();
  g.textAlign(LEFT, TOP);
  g.fill(INK.r, INK.g, INK.b, 235);
  g.textSize(26);
  g.text(info.label, HUD.safeX, HUD.stageY);

  g.textAlign(RIGHT, TOP);
  g.textSize(22);
  g.text("SMOOTHING · " + flowPercentText(progress), W - HUD.safeX, HUD.stageY + 3);

  const trackX = HUD.safeX, trackY = HUD.trackY, trackEndX = W - HUD.safeX;
  const progressX = lerp(trackX, trackEndX, progress);
  g.stroke(INK.r, INK.g, INK.b, 34);
  g.strokeWeight(1);
  g.line(trackX, trackY, trackEndX, trackY);
  g.stroke(INK.r, INK.g, INK.b, 184);
  g.strokeWeight(2.2);
  g.line(trackX, trackY, progressX, trackY);
  g.noStroke();
  g.fill(INK.r, INK.g, INK.b, 235);
  g.circle(progressX, trackY, 8);
  g.pop();

  // Reduced, focused explanatory hierarchy
  g.textAlign(CENTER, CENTER);
  g.fill(INK.r, INK.g, INK.b, HUD.bottomMainAlpha);
  g.textSize(28);
  g.text("HIGH CURVATURE DISSOLVES FIRST", W * 0.5, 1540);

  g.textSize(22);
  g.fill(INK.r, INK.g, INK.b, HUD.citationAlpha);
  g.text("MATHEMATICAL FLOW · GAGE · HAMILTON · GRAYSON", W * 0.5, 1620);

  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
  ortho(-W * 0.5, W * 0.5, -H * 0.5, H * 0.5, -10, 10);
  noLights();
  blendMode(BLEND);
  image(g, -W * 0.5, -H * 0.5, W, H);
  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

function keyReleased() {
  if (key === "r" || key === "R") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === "s" || key === "S") {
    saveCanvas("mean_curvature_flow_bubbles_" + getTimestamp(), "png");
    return false;
  }
  return true;
}

function updateRecordingUI() {
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = (recFrameCount / FPS).toFixed(1);
  if (el("frameCount")) el("frameCount").textContent = recFrameCount;
  if (el("progressFill")) el("progressFill").style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
}

function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported."); return; }
  if (typeof Mp4Muxer === "undefined") { alert("mp4-muxer not loaded."); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { console.error(error); isRecording = false; setStatus("Error", "#f44"); },
  });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  loopProgress = 0;
  phase = 0;
  isRecording = true;
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = "0.0";
  if (el("frameCount")) el("frameCount").textContent = "0";
  if (el("startBtn")) el("startBtn").disabled = true;
  if (el("stopBtn")) el("stopBtn").disabled = false;
  if (el("progressFill")) el("progressFill").style.width = "0%";
  setStatus("Recording…", "#fff");
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing…", "#ccc");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mean_curvature_flow_bubbles_" + getTimestamp() + ".mp4";
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").disabled = false;
  if (el("stopBtn")) el("stopBtn").disabled = true;
  if (el("progressFill")) el("progressFill").style.width = "0%";
  setStatus("Complete", "#fff");
  setTimeout(() => setStatus("Ready", "#ccc"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(textValue, colorValue) {
  const el = document.getElementById("status");
  if (el) { el.textContent = textValue; el.style.color = colorValue; }
}

function getTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "_" +
    pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

if (typeof window !== "undefined") {
  window.startRecording = startRecording;
  window.stopRecording = stopRecording;
}

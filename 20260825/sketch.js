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
  surfaceUSegments: 96,
  surfaceVSegments: 48,
  sphereRadius: 300,

  // Initial deformation field: axisymmetric "kv" lobe modes (nonzero at the
  // poles, r = R(1 + amp*cos(kv*v))) drive the large-scale dumbbell/peanut
  // silhouette -- kv:2 gives two end lobes with a pinched neck, kv:4 layers
  // a secondary waist for the multi-lobe body. Angular/axial modes on top
  // (k1/k2, k3/k4) add sharp local pinches and asymmetry so the surface
  // isn't purely a body of revolution -- the flow resolves both scales.
  deformModes: [
    { kv: 2, amp: 0.34 },
    { kv: 4, amp: 0.12 },
    { k3: 1, k4: 1, amp: 0.16, delta: 0.4 },
    { k1: 3, k2: 2, amp: 0.16 },
    { k3: 5, k4: 3, amp: 0.12, delta: 0.9 },
    { k3: 2, k4: 5, amp: 0.10, delta: 2.4 },
  ],

  // Ricci-flow precompute: each deformation mode's amplitude decays
  // analytically (rate ~ k_u^2 + k_v^2, so high-curvature/high-frequency
  // modes vanish first), baked into a state ladder so draw() only
  // interpolates. See buildFlowStates() for the approximation this implements.
  flowStates: 46,
  flowTauMax: 2.2,

  surfaceLineWeight: 1.28,
  cameraDistance: 1500,
  cameraMaxDistance: 2100,
  cameraOrbitAmount: 126,
  framingFill: 0.82,
  fogDepthRange: 920,

  showFlowVectors: true,
};

// Boundaries below are the single source of truth for the whole synchronized
// system (formula highlight, curvature heatmap, flow vectors, HUD labels) --
// see getFormulaPhase(). Keep PHASES and those boundaries in lockstep.
const PHASE_BOUNDS = { geomEnd: 0.15, curvEnd: 0.30, flowMid: 0.48, flowEnd: 0.65, uniformEnd: 0.85 };

const PHASES = [
  { key: "GEOMETRY", label: "01 · gij · GEOMETRY", note: "THIS IS THE CURRENT METRIC" },
  { key: "CURVATURE", label: "02 · Rij · CURVATURE", note: "HIGH-CURVATURE REGIONS ARE FLAGGED" },
  { key: "FLOW", label: "03 · -2Rij · FLOW", note: "CURVATURE DRIVES THE FLOW" },
  { key: "EVOLUTION", label: "04 · dgij/dt · EVOLUTION", note: "THE GEOMETRY CHANGES" },
  { key: "UNIFORM", label: "05 · RICCI FLOW · UNIFORMITY", note: "THE SURFACE BECOMES SMOOTHER" },
  { key: "RETURN", label: "06 · gij · RETURN", note: "THE LOOP RESETS TO GEOMETRY" },
];

const uSeg = CONFIG.surfaceUSegments;
const vSeg = CONFIG.surfaceVSegments;
const pointCount = uSeg * vSeg;

// One Float32Array per flow state: [x,y,z] per vertex, plus a matching
// per-vertex curvature-intensity array normalized into [0,1] at bake time.
let flowStates = [];      // positions per state
let flowCurvatures = [];  // curvature intensity per state

const surface = {
  positions: new Float32Array(pointCount * 3),
  curvature: new Float32Array(pointCount),
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

// Existing deterministic WebCodecs + mp4-muxer recording workflow.
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
  buildFlowStates();

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
  randomSeed(20260825);
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

function paramIndex(i, j) {
  const wrappedI = (i + uSeg) % uSeg;
  const boundedJ = clamp(j, 0, vSeg - 1);
  return wrappedI * vSeg + boundedJ;
}

// Per-mode decay rate for analytic Ricci-flow-like relaxation: rate ~
// k_u^2 + k_v^2, mirroring how heat/curvature flow damps higher-frequency
// modes on a radial graph faster than low-frequency ones.
function modeRate(m) {
  if (m.kv !== undefined && m.k1 === undefined && m.k3 === undefined) return m.kv * m.kv;
  const ku = m.k1 !== undefined ? m.k1 : m.k3;
  const kv = m.k1 !== undefined ? m.k2 : m.k4;
  return ku * ku + kv * kv;
}

// Irregular radial field: R * [1 + sum of angular/axial modes], each mode's
// amplitude scaled by exp(-rate*tau). tau=0 reproduces the raw t=0 "irregular
// metric" state; tau=flowTauMax leaves < 0.5% deviation from a perfect sphere.
// Deterministic and free of per-frame noise so the same (u,v,tau) always
// yields the same deformed radius.
function deformedRadius(u, v, tau) {
  let sum = 0;
  for (const m of CONFIG.deformModes) {
    const decay = Math.exp(-modeRate(m) * tau);
    if (m.kv !== undefined && m.k1 === undefined && m.k3 === undefined) {
      sum += m.amp * decay * Math.cos(m.kv * v);
    } else if (m.k1 !== undefined) {
      sum += m.amp * decay * Math.sin(m.k1 * u) * Math.sin(m.k2 * v);
    } else {
      sum += m.amp * decay * Math.cos(m.k3 * u + m.delta) * Math.sin(m.k4 * v);
    }
  }
  return CONFIG.sphereRadius * (1 + sum);
}

function sphericalToXYZ(u, v, r) {
  const sv = Math.sin(v);
  return [
    r * sv * Math.cos(u),
    r * Math.cos(v),
    r * sv * Math.sin(u),
  ];
}

// Precompute the Ricci-flow ladder: state 0 is the raw deformed sphere
// (tau=0), each subsequent state evaluates deformedRadius at a larger tau so
// every mode's amplitude has decayed further, high-frequency/high-curvature
// modes fastest (see modeRate). At tau=flowTauMax the field is within 0.5%
// of a perfect sphere by construction -- no iterative relaxation, no
// renormalization, no risk of overshooting past the round state.
function buildFlowStates() {
  const du = TAU / uSeg;
  const dv = Math.PI / (vSeg - 1);
  let refMaxC = null;

  for (let s = 0; s < CONFIG.flowStates; s++) {
    const tau = CONFIG.flowTauMax * Math.pow(s / (CONFIG.flowStates - 1), 2.6);
    const pos = new Float32Array(pointCount * 3);
    for (let i = 0; i < uSeg; i++) {
      for (let j = 0; j < vSeg; j++) {
        const u = i * du;
        const v = j * dv;
        const r = deformedRadius(u, v, tau);
        const [x, y, z] = sphericalToXYZ(u, v, r);
        const idx = paramIndex(i, j);
        pos[idx * 3] = x; pos[idx * 3 + 1] = y; pos[idx * 3 + 2] = z;
      }
    }
    flowStates.push(pos);
    const { curvature, maxC } = computeCurvature(pos, refMaxC);
    if (refMaxC === null) refMaxC = maxC;
    flowCurvatures.push(curvature);
  }
}

// Per-vertex curvature intensity C_i = |L(p_i)| (graph-Laplacian defect: how
// far a point sits from the mean of its neighbors), normalized against a
// FIXED reference -- state 0's peak -- rather than each state's own max, so
// the highlight layer actually fades toward zero as the surface flattens
// instead of being re-stretched to full range every state.
function computeCurvature(pos, refMaxC) {
  const c = new Float32Array(pointCount);
  let maxC = 1e-6;
  for (let i = 0; i < uSeg; i++) {
    for (let j = 0; j < vSeg; j++) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      // Pole rings (j=0/vSeg-1) are coincident copies of one logical vertex:
      // curvature there is distance from that point to the mean of the full
      // adjacent ring, not a 4-neighbor blend.
      let sx = 0, sy = 0, sz = 0;
      if (j === 0 || j === vSeg - 1) {
        const jN = j === 0 ? 1 : vSeg - 2;
        for (let k = 0; k < uSeg; k++) {
          const no = paramIndex(k, jN) * 3;
          sx += pos[no]; sy += pos[no + 1]; sz += pos[no + 2];
        }
        sx /= uSeg; sy /= uSeg; sz /= uSeg;
      } else {
        const iP = paramIndex(i + 1, j), iM = paramIndex(i - 1, j);
        const jP = paramIndex(i, j + 1), jM = paramIndex(i, j - 1);
        for (const n of [iP, iM, jP, jM]) {
          const no = n * 3;
          sx += pos[no]; sy += pos[no + 1]; sz += pos[no + 2];
        }
        sx *= 0.25; sy *= 0.25; sz *= 0.25;
      }
      const mag = Math.hypot(sx - pos[o], sy - pos[o + 1], sz - pos[o + 2]);
      c[idx] = mag;
      if (mag > maxC) maxC = mag;
    }
  }
  const norm = refMaxC === null ? maxC : refMaxC;
  for (let k = 0; k < pointCount; k++) c[k] /= norm;
  return { curvature: c, maxC };
}

// Piecewise-smoothstep keyframe curve: zero slope at every keyframe, so the
// segments splice together C1-continuous and the 1.0->0.0 return lands with
// zero velocity at both loop endpoints (no snap at the wrap).
function smoothstepSegment(t, t0, t1, v0, v1) {
  const local = t1 === t0 ? 1 : clamp((t - t0) / (t1 - t0), 0, 1);
  return v0 + (v1 - v0) * smooth01(local);
}

// Generic piecewise-smoothstep keyframe evaluator. Every animated channel in
// this sketch (flow envelope, equation-token weights, ...) is a list of
// {t, v} keyframes sampled through here, so C0/C1 continuity and loop-seam
// matching are structural instead of something to re-verify per channel.
function envelopeAt(keys, t) {
  for (let k = 0; k < keys.length - 1; k++) {
    const a = keys[k], b = keys[k + 1];
    if (t <= b.t) return smoothstepSegment(t, a.t, b.t, a.v, b.v);
  }
  return keys[keys.length - 1].v;
}

const FLOW_KEYS = [
  { t: 0, v: 0 },
  { t: PHASE_BOUNDS.geomEnd, v: 0 },
  { t: PHASE_BOUNDS.curvEnd, v: 0 },
  { t: PHASE_BOUNDS.flowEnd, v: 0.92 },
  { t: PHASE_BOUNDS.uniformEnd, v: 1 },
  { t: 1, v: 0 },
];

function flowEnvelope(t) {
  return envelopeAt(FLOW_KEYS, t);
}

function updateLoopTime() {
  const frame = isRecording ? recFrameCount : frameCount - 1;
  loopProgress = (((frame % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  phase = loopProgress * TAU;
  // flowT holds at 0 through GEOMETRY+CURVATURE (0-30%) so the viewer can
  // inspect the problem surface, ramps hardest through FLOW (30-65%),
  // plateaus at 1 through UNIFORM (65-85%), then returns to exactly 0 by
  // t=1 -- matching PHASE_BOUNDS and the REEL TIMELINE spec exactly.
  flowT = flowEnvelope(loopProgress);
}

// Single source of truth for "what is the formula/HUD emphasizing right now".
// Every visual subsystem (curvature heatmap, flow vectors, formula alpha,
// HUD label) reads from this instead of keeping an independent boundary set.
function currentPhaseInfo() {
  const t = loopProgress;
  const b = PHASE_BOUNDS;
  if (t < b.geomEnd) return PHASES[0];
  if (t < b.curvEnd) return PHASES[1];
  if (t < b.flowMid) return PHASES[2];
  if (t < b.flowEnd) return PHASES[3];
  if (t < b.uniformEnd) return PHASES[4];
  return PHASES[5];
}

// Continuous curvature-heatmap visibility: near-zero during GEOMETRY (keep
// the mesh itself easiest to read), ramps to full through CURVATURE, stays
// lit through FLOW, fades back toward zero as UNIFORM settles in (heatmap
// has nothing left to show once curvature is ~gone), zero again at the loop
// seam so it matches the GEOMETRY-phase look on return.
function getCurvatureVisibility(t) {
  const b = PHASE_BOUNDS;
  if (t < b.geomEnd) return smoothstepSegment(t, 0, b.geomEnd, 0.15, 0.15);
  if (t < b.curvEnd) return smoothstepSegment(t, b.geomEnd, b.curvEnd, 0.15, 1);
  if (t < b.flowEnd) return 1;
  if (t < b.uniformEnd) return smoothstepSegment(t, b.flowEnd, b.uniformEnd, 1, 0.25);
  return smoothstepSegment(t, b.uniformEnd, 1, 0.25, 0.15);
}

// Flow vectors only make sense while curvature is actively driving motion:
// silent during GEOMETRY/CURVATURE inspection, on during FLOW, fading out
// as EVOLUTION settles into UNIFORM, off by the loop seam.
function getVectorVisibility(t) {
  const b = PHASE_BOUNDS;
  if (t < b.curvEnd) return 0;
  if (t < b.flowEnd) return smoothstepSegment(t, b.curvEnd, b.flowEnd, 0, 1);
  if (t < b.uniformEnd) return smoothstepSegment(t, b.flowEnd, b.uniformEnd, 1, 0);
  return 0;
}

// Per-token formula alpha ladder. Tokens: gij, slash, dt-left(=d/dt of g),
// eq, minus2, Rij. Inactive terms stay dimly visible (never fully hidden)
// per spec; active term(s) for the current phase go to full weight.
// -2Rij and Rij overlap on purpose: FLOW lights both "-2" and "Rij" while
// CURVATURE lights only "Rij".
const DIM = 0.30, LIT = 1.0;
const eqB = PHASE_BOUNDS;
// Keyframe tables per equation token, all sharing PHASE_BOUNDS as the single
// source of truth for timing. dt aliases dg (they're the same "d/dt g"
// visual unit) so it isn't listed separately. Every table starts and ends
// at the same value so t=0 and t=1 match exactly at the loop seam, and
// envelopeAt's smoothstep splicing keeps every phase boundary continuous
// (no hard cuts at geomEnd/curvEnd/flowMid/flowEnd/uniformEnd).
// Each token's LIT key sits at the START of the window that names it (not
// the end), so the term is already fully lit while its label is on screen,
// not merely ramping up to it. Rij lights for CURVATURE (ramps in during
// GEOMETRY's back half so it's already LIT by geomEnd), m2 lights for FLOW
// (ramps in during CURVATURE), dg/dt light for EVOLUTION (dip through
// CURVATURE/early FLOW, ramp back up by flowMid), eq lights for UNIFORM
// (ramps in during EVOLUTION). All stay LIT through UNIFORM per spec, then
// fade back to their DIM/LIT geometry-phase baseline for RETURN.
const EQ_KEYS = {
  dg: [
    { t: 0, v: LIT },
    { t: eqB.geomEnd, v: LIT },
    { t: eqB.curvEnd, v: DIM },
    { t: eqB.flowMid, v: LIT },
    { t: eqB.uniformEnd, v: LIT },
    { t: 1, v: LIT },
  ],
  eq: [
    { t: 0, v: DIM },
    { t: eqB.flowMid, v: DIM },
    { t: eqB.flowEnd, v: LIT },
    { t: eqB.uniformEnd, v: LIT },
    { t: 1, v: DIM },
  ],
  m2: [
    { t: 0, v: DIM },
    { t: eqB.geomEnd, v: DIM },
    { t: eqB.curvEnd, v: LIT },
    { t: eqB.uniformEnd, v: LIT },
    { t: 1, v: DIM },
  ],
  Rij: [
    { t: 0, v: DIM },
    { t: eqB.geomEnd * 0.5, v: DIM },
    { t: eqB.geomEnd, v: LIT },
    { t: eqB.uniformEnd, v: LIT },
    { t: 1, v: DIM },
  ],
};

function getEquationHighlight(t) {
  const dg = envelopeAt(EQ_KEYS.dg, t);
  return {
    dg,
    dt: dg,
    eq: envelopeAt(EQ_KEYS.eq, t),
    m2: envelopeAt(EQ_KEYS.m2, t),
    Rij: envelopeAt(EQ_KEYS.Rij, t),
  };
}

// Second formula line (normalized Ricci flow) is revealed only once UNIFORM
// begins, since that's where the +（2r/n)g volume-preserving correction
// becomes the visible story. The sphere in this sketch already holds its
// radius rather than collapsing, i.e. it has been depicting normalized flow
// throughout — this envelope controls when that's shown on screen, not
// when the term is "active".
const NORM_VIS_KEYS = [
  { t: 0, v: 0 },
  { t: eqB.flowEnd, v: 0 },
  { t: eqB.uniformEnd, v: 1 },
  { t: 1, v: 0 },
];

function getNormFormulaVis(t) {
  return envelopeAt(NORM_VIS_KEYS, t);
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

let maxRadius = CONFIG.sphereRadius;
let maxVerticalExtent = CONFIG.sphereRadius;

// Interpolate between adjacent precomputed flow states by flowT. Cheap: no
// smoothing iterations run in draw(), only a per-vertex lerp.
function updateFlowSurface() {
  const stateF = flowT * (flowStates.length - 1);
  const i0 = Math.floor(stateF);
  const i1 = Math.min(i0 + 1, flowStates.length - 1);
  const blend = stateF - i0;

  const a = flowStates[i0], b = flowStates[i1];
  const ca = flowCurvatures[i0], cb = flowCurvatures[i1];

  let peak = 0, peakY = 0;
  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    const x = a[o] + (b[o] - a[o]) * blend;
    const y = a[o + 1] + (b[o + 1] - a[o + 1]) * blend;
    const z = a[o + 2] + (b[o + 2] - a[o + 2]) * blend;
    surface.positions[o] = x;
    surface.positions[o + 1] = y;
    surface.positions[o + 2] = z;
    surface.curvature[idx] = ca[idx] + (cb[idx] - ca[idx]) * blend;

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
  rotateX(surfaceViewTilt());
  rotateZ(surfaceViewRoll());
  rotateY(-0.22 + 0.11 * Math.sin(phase));
  drawFlowWireframe();
  const vectorVis = getVectorVisibility(loopProgress);
  if (CONFIG.showFlowVectors && vectorVis > 0.002) drawFlowVectors(vectorVis);
  pop();
  compositeBloom();
  drawScreenFinish();
}

function surfaceViewTilt() {
  return -0.14 - 0.1 * Math.sin(phase);
}

function surfaceViewRoll() {
  return 0.05 * Math.sin(phase * 2);
}

// Half-res WEBGL pass: same wireframe geometry, brighter/thicker, ADD-blended,
// then streaked horizontally for real luminous bloom instead of a fat low-alpha stroke.
function renderBloomSource() {
  const b = bloomPg;
  b.push();
  b.background(0);
  b.perspective(PI / 3.35, W / H, 10, 5000);
  b.camera(cameraEye.x, cameraEye.y, cameraEye.z, 0, 0, 0, 0, 1, 0);
  b.blendMode(ADD);
  b.noFill();
  b.push();
  b.rotateX(surfaceViewTilt());
  b.rotateZ(surfaceViewRoll());
  b.rotateY(-0.22 + 0.11 * Math.sin(phase));
  const curvatureVis = getCurvatureVisibility(loopProgress);
  for (let i = 0; i < uSeg; i += 4) {
    b.strokeWeight(2.4);
    b.beginShape();
    for (let j = 0; j < vSeg; j++) {
      const idx = paramIndex(i, j);
      const offset = idx * 3;
      const a = curvatureAlpha(surface.curvature[idx], 150, curvatureVis) * fogFactor(viewDepthAt(offset));
      b.stroke(INK.r, INK.g, INK.b, a);
      b.vertex(surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2]);
    }
    b.endShape();
  }
  b.pop();
  b.pop();
}

function streakBloom() {
  const s = bloomStreakPg;
  const taps = 14;
  const spread = 9;
  s.clear();
  s.push();
  s.blendMode(ADD);
  s.imageMode(CENTER);
  const cx = s.width / 2, cy = s.height / 2;
  for (let k = -taps; k <= taps; k++) {
    const falloff = 1 - Math.abs(k) / taps;
    s.tint(255, 255, 255, 28 * falloff * falloff);
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

const cameraEye = { x: 0, y: 0, z: 0 };

const VFOV = Math.PI / 3.35;
const ASPECT = W / H;
const TAN_HALF_VFOV = Math.tan(VFOV / 2);

function setupCamera() {
  // Full-revolution orbit per loop (integer harmonic of phase) so the camera
  // returns exactly to its start position at the wrap -- no seam cut.
  const eyeX = CONFIG.cameraOrbitAmount * Math.sin(phase);
  const eyeY = -44 + 34 * Math.sin(phase * 2);
  const distForVertical = maxVerticalExtent / (TAN_HALF_VFOV * CONFIG.framingFill);
  const distForLateral = maxRadius / (TAN_HALF_VFOV * ASPECT * CONFIG.framingFill);
  const eyeZ = Math.min(
    Math.max(distForVertical, distForLateral, CONFIG.cameraDistance),
    CONFIG.cameraMaxDistance,
  );
  cameraEye.x = eyeX; cameraEye.y = eyeY; cameraEye.z = eyeZ;
  camera(eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
}

// fogFactor(): near->far alpha falloff so depth reads as atmosphere, not a flat diagram.
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
  const fieldRadius = CONFIG.sphereRadius * 1.62;
  for (let ring = 0; ring < 3; ring++) {
    const radius = fieldRadius + ring * 92;
    stroke(INK.r, INK.g, INK.b, 8 - ring * 1.8);
    beginShape();
    for (let j = 0; j <= 96; j++) {
      const a = (j / 96) * TAU;
      vertex(Math.cos(a) * radius, Math.sin(a) * radius, -310 - ring * 24);
    }
    endShape();
  }

  stroke(INK.r, INK.g, INK.b, 12);
  line(-fieldRadius - 82, 0, -330, fieldRadius + 82, 0, -330);
  line(0, -fieldRadius - 82, -330, 0, fieldRadius + 82, -330);
}

// Monochrome curvature encoding: brightness + line weight rise with local
// curvature intensity, so high-curvature regions read as brighter/thicker
// without introducing a second color system (project stays strict ink-only).
// curvatureVis (0..1) is the phase-driven heatmap visibility from
// getCurvatureVisibility(): near 0 during GEOMETRY keeps the mesh itself the
// brightest, readable thing on screen; near 1 during CURVATURE/FLOW lets
// high-curvature vertices dominate.
function curvatureAlpha(curvature, baseAlpha, curvatureVis) {
  const vis = curvatureVis === undefined ? 1 : curvatureVis;
  const flat = 0.78;
  return baseAlpha * (flat + (0.55 + 0.75 * curvature - flat) * vis);
}

function drawFlowWireframe() {
  // ADD makes overlapping high-curvature strokes brightest, reinforcing the
  // curvature-intensity read without needing hue.
  blendMode(ADD);
  const baseAlpha = 176;
  const curvatureVis = getCurvatureVisibility(loopProgress);
  for (let i = 0; i < uSeg; i += 2) {
    const isRib = i % 10 === 0;
    noFill();
    beginShape();
    for (let j = 0; j < vSeg; j++) {
      const idx = paramIndex(i, j);
      const offset = idx * 3;
      const c = surface.curvature[idx];
      const ribGain = isRib ? 1.35 : 0.62;
      strokeWeight(CONFIG.surfaceLineWeight * (isRib ? 1.7 : 1) * (0.85 + 0.5 * c));
      const a = curvatureAlpha(c, baseAlpha, curvatureVis) * ribGain * fogFactor(viewDepthAt(offset));
      stroke(INK.r, INK.g, INK.b, a);
      vertex(surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2]);
    }
    endShape();
  }
  strokeWeight(CONFIG.surfaceLineWeight);
  for (let j = 0; j < vSeg; j += 3) {
    noFill();
    beginShape();
    for (let i = 0; i <= uSeg; i++) {
      const idx = paramIndex(i, j);
      const offset = idx * 3;
      const a = curvatureAlpha(surface.curvature[idx], baseAlpha * 0.5, curvatureVis) * fogFactor(viewDepthAt(offset));
      stroke(INK.r, INK.g, INK.b, a);
      vertex(surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2]);
    }
    endShape();
  }
  blendMode(BLEND);
}

// Sparse flow-direction hints: short segments from p_i toward its Laplacian
// target (mean neighbor position), sampled only at high-curvature vertices
// so the field reads as "where the metric is moving" without clutter. Reads
// the same blended surface.positions the mesh itself uses (not a floored
// flowStates[i0] snapshot), so vectors never pop at a state-ladder boundary.
// vectorVis (0..1) is the phase-driven visibility from getVectorVisibility().
function drawFlowVectors(vectorVis) {
  blendMode(ADD);
  strokeWeight(1.1);
  for (let i = 0; i < uSeg; i += 6) {
    for (let j = 2; j < vSeg - 2; j += 6) {
      const idx = paramIndex(i, j);
      const c = surface.curvature[idx];
      if (c < 0.35) continue;
      const o = idx * 3;
      const iP = paramIndex(i + 1, j), iM = paramIndex(i - 1, j);
      const jP = paramIndex(i, j + 1), jM = paramIndex(i, j - 1);
      let mx = 0, my = 0, mz = 0;
      for (const n of [iP, iM, jP, jM]) {
        mx += surface.positions[n * 3]; my += surface.positions[n * 3 + 1]; mz += surface.positions[n * 3 + 2];
      }
      mx *= 0.25; my *= 0.25; mz *= 0.25;
      const px = surface.positions[o], py = surface.positions[o + 1], pz = surface.positions[o + 2];
      const vx = mx - px, vy = my - py, vz = mz - pz;
      const s = 2.4;
      const a = 90 * c * vectorVis * fogFactor(viewDepthAt(o));
      stroke(INK.r, INK.g, INK.b, a);
      line(px, py, pz, px + vx * s, py + vy * s, pz + vz * s);
    }
  }
  blendMode(BLEND);
}

function flowPercentText() {
  return Math.round(flowT * 100) + "%";
}

// Tokenized formula: dg_ij / dt = -2 R_ij, drawn as separate pieces so each
// term's alpha can follow getEquationHighlight(loopProgress) independently.
// Subscripts drawn as smaller offset text rather than relying on the ᵢⱼ
// Unicode glyphs, which are commonly missing from monospace font stacks.
const FORMULA_BASE_SIZE = 24;
const FORMULA_SUB_SIZE = 15;
const FORMULA_TOKENS = [
  { text: "dg", weightKey: "dg" },
  { text: "ij", sub: true, weightKey: "dg" },
  { text: " / ", weightKey: "dt" },
  { text: "dt", weightKey: "dt" },
  { text: "  =  ", weightKey: "eq" },
  { text: "-2", weightKey: "m2" },
  { text: "R", weightKey: "Rij" },
  { text: "ij", sub: true, weightKey: "Rij" },
];

// Normalized form: dg_ij/dt = -2 R_ij + (2r/n) g_ij. Uses a single flat
// weight (its own fade envelope) rather than per-token highlighting —
// this line is a reveal, not a phase-by-phase highlight sequence.
const NORM_FORMULA_TOKENS = [
  { text: "dg" },
  { text: "ij", sub: true },
  { text: " / " },
  { text: "dt" },
  { text: "  =  " },
  { text: "-2R" },
  { text: "ij", sub: true },
  { text: "  +  " },
  { text: "(2r/n)g" },
  { text: "ij", sub: true },
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
    const wgt = tok.weightKey ? weights[tok.weightKey] : weights.flat;
    const alphaMax = 210;
    g.fill(INK.r, INK.g, INK.b, alphaMax * wgt * alphaScale);
    g.textSize(tok.sub ? FORMULA_SUB_SIZE : FORMULA_BASE_SIZE);
    g.text(tok.text, x, tok.sub ? cy + 7 : cy);
    x += widths[k];
  }
  g.textAlign(CENTER, CENTER);
}

function drawScreenFinish() {
  const g = hudPg;
  const info = currentPhaseInfo();
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

  // Exact existing typography settings, positions, alignment, spacing, and hierarchy.
  g.noStroke();
  g.textFont("ui-monospace, Menlo, Consolas, monospace");
  g.textAlign(CENTER, CENTER);
  g.textStyle(BOLD);
  g.fill(INK.r, INK.g, INK.b, 246);
  g.textSize(54);
  g.text("RICCI FLOW", W * 0.5, 222);
  g.textStyle(NORMAL);
  drawFormula(g, W * 0.5, 278, FORMULA_TOKENS, getEquationHighlight(loopProgress));
  const normVis = getNormFormulaVis(loopProgress);
  if (normVis > 0.001) {
    drawFormula(g, W * 0.5, 314, NORM_FORMULA_TOKENS, { flat: 1 }, normVis);
  }
  g.fill(INK.r, INK.g, INK.b, 92);
  g.textSize(17);
  g.text("CURVATURE  ->  UNIFORMIZATION", W * 0.5, 352);

  g.textAlign(LEFT, TOP);
  g.fill(INK.r, INK.g, INK.b, 100);
  g.textSize(19);
  g.text(info.label, 70, 372);
  g.textAlign(RIGHT, TOP);
  g.text(flowPercentText(), W - 70, 372);

  const trackX = 70, trackY = 416, trackW = W - 140;
  g.stroke(INK.r, INK.g, INK.b, 34);
  g.strokeWeight(1);
  g.line(trackX, trackY, trackX + trackW, trackY);
  g.stroke(INK.r, INK.g, INK.b, 184);
  g.strokeWeight(2.2);
  g.line(trackX, trackY, trackX + trackW * loopProgress, trackY);
  g.noStroke();
  for (const marker of [0, 0.25, 0.5, 0.75, 1]) {
    g.fill(INK.r, INK.g, INK.b, marker === 0.5 ? 170 : 78);
    g.circle(trackX + trackW * marker, trackY, marker === 0.5 ? 6 : 4);
  }

  g.textAlign(CENTER, CENTER);
  g.fill(INK.r, INK.g, INK.b, 72 + 164 * smooth01(Math.sin(flowT * Math.PI)));
  g.textSize(22);
  g.text(info.note, W * 0.5, 1482);
  g.textSize(17);
  g.fill(INK.r, INK.g, INK.b, 130);
  g.text("IRREGULAR  ->  FLOW  ->  UNIFORM  ->  RETURN", W * 0.5, 1514);
  g.textSize(13);
  g.fill(INK.r, INK.g, INK.b, 64);
  g.text("POSITIVE CURVATURE -> SMOOTH CONVERGENCE, NO SINGULARITY (HAMILTON 1982)", W * 0.5, 1540);

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
    saveCanvas("ricci_flow_" + getTimestamp(), "png");
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
  a.download = "ricci_flow_" + getTimestamp() + ".mp4";
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

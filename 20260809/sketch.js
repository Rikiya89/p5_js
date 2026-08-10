"use strict";

// ============================================================
// 1. CONSTANTS
// ============================================================
const W = 1080,
  H = 1920,
  FPS = 60,
  MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION,
  LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// ============================================================
// 2. CENTRAL CONFIGURATION
// ============================================================
const CONFIG = {
  pointCount: 900,
  sphereScale: 420,
  vectorLengthScale: 148,
  vectorLengthMin: 0.08,

  fieldA: 1.0, // constant-term amplitude
  fieldB: 0.55, // rotational-term amplitude (ω × p, tangent by construction)
  // Field phase offset + counter-rotating camera: chosen so a singularity
  // faces the camera at the loop's hero frame and remains strongly visible.
  fieldPhi0: (270 * Math.PI) / 180,

  zeroThresholdFrac: 0.08, // relative to that frame's max |v_tangent|
  newtonIters: 3, // per-frame refinement (seed pass uses 8)
  newtonSeedIters: 8,
  newtonFDStep: 1e-4,
  newtonMaxStep: 0.25,

  baseAlpha: 220,
  frontDepthMin: 0.16,
  baseWeight: 1.1,
  glowAlpha: 20,
  glowWeight: 4.2,
  flowStride: 13,
  flowPointSize: 5.6,
  probeVectorScale: 210,

  singularityRadius: 9,
  singularityRingCount: 3,

  cameraRadius: 1480,
  cameraRadiusVariation: 34,
  cameraHeight: -115,
  cameraHeightVariation: 52,
  cameraStartAngle: -0.55,

  showInterface: true,
};

// ============================================================
// 3. EXISTING PALETTE
// ============================================================
const BG_R = 3,
  BG_G = 3,
  BG_B = 5;
const INK = { r: 255, g: 255, b: 255 };
const CYAN = { r: 0, g: 229, b: 255 };
const MAGENTA = { r: 255, g: 61, b: 191 };
const ACID = { r: 182, g: 255, b: 61 };

// ============================================================
// 4. CAPTURE SETTINGS AND SHARED RUNTIME
// ============================================================
let canvasEl, hudPg, vignettePg;
let muxer = null,
  encoder = null,
  isRecording = false,
  recFrameCount = 0,
  recordingStartFrame = 0;
let paused = false,
  frozenFrame = 0;
let isDragging = false,
  lastMouseX = 0,
  lastMouseY = 0;
let userYaw = 0,
  userPitch = 0,
  userZoomOffset = 0;
let showInterface = CONFIG.showInterface;

const loopState = {
  loopT: 0,
  phase: 0,
  cameraAngle: CONFIG.cameraStartAngle,
  cameraRadius: CONFIG.cameraRadius,
  cameraHeight: CONFIG.cameraHeight,
  viewX: 0,
  viewY: 0,
  viewZ: 1,
};

const EXPLANATION_STAGES = [
  "1  SOURCE VECTOR",
  "2  REMOVE NORMAL",
  "3  TANGENT RESULT",
  "4  ZERO REMAINS",
];

const EXPLANATION_FORMULAS = [
  `v(p,t) = ĉ(t) + ${CONFIG.fieldB.toFixed(2)}[ω̂(t) × p]`,
  "vᴛ = v − n(v · n)",
  "n · vᴛ = 0    (tangent to S²)",
  "min p∈S²  |vᴛ(p)| = 0",
];

const EXPLANATION_HELP = [
  "START WITH A SMOOTH 3D VECTOR",
  "SUBTRACT THE PART POINTING THROUGH THE SPHERE",
  "THE REMAINDER LIES FLAT ON THE SURFACE",
  "THE FIELD MUST VANISH SOMEWHERE",
];

const probeState = {
  x: 0,
  y: 0,
  z: 1,
  sourceX: 0,
  sourceY: 0,
  sourceZ: 0,
  normalX: 0,
  normalY: 0,
  normalZ: 0,
  tangentX: 0,
  tangentY: 0,
  tangentZ: 0,
  sourceMagnitude: 0,
  normalMagnitude: 0,
  tangentMagnitude: 0,
  stage: 0,
};

// ============================================================
// 5. SPHERE POINT DATA (STATIC — Fibonacci distribution)
// ============================================================
let spherePositions; // Float32Array [x,y,z] * pointCount, unit sphere
let tangentBuffer; // Float32Array [vx,vy,vz] * pointCount, scratch per-frame
let magnitudeBuffer; // Float32Array, |v_tangent| per point, scratch per-frame

function generateSpherePoints() {
  spherePositions = new Float32Array(CONFIG.pointCount * 3);
  for (let i = 0; i < CONFIG.pointCount; i++) {
    const y = 1 - (2 * (i + 0.5)) / CONFIG.pointCount;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    const offset = i * 3;
    spherePositions[offset] = radius * Math.cos(theta);
    spherePositions[offset + 1] = y;
    spherePositions[offset + 2] = radius * Math.sin(theta);
  }
  tangentBuffer = new Float32Array(CONFIG.pointCount * 3);
  magnitudeBuffer = new Float32Array(CONFIG.pointCount);
}

// ============================================================
// 6. HAIRY BALL VECTOR FIELD
// ============================================================
// v(p) = A·ĉ(phase) + B·(ω(phase) × p), then projected tangent to the
// sphere at p. The rotational term is automatically tangent (cross product
// with position is always ⊥ p), so only the constant term needs projection.
function fieldConstant(phase, out) {
  const p = phase + CONFIG.fieldPhi0;
  const x = Math.cos(p),
    y = 0.25 * Math.sin(2 * p),
    z = Math.sin(p);
  const inv = 1 / (Math.hypot(x, y, z) || 1);
  out[0] = x * inv;
  out[1] = y * inv;
  out[2] = z * inv;
}

function fieldOmega(phase, out) {
  const p = phase + CONFIG.fieldPhi0;
  const x = 0.2 * (1 + 0.3 * Math.sin(p)),
    y = 1,
    z = 0.15 * Math.cos(p) * (1 + 0.3 * Math.sin(p));
  const inv = 1 / (Math.hypot(x, y, z) || 1);
  out[0] = x * inv;
  out[1] = y * inv;
  out[2] = z * inv;
}

const _c = [0, 0, 0],
  _w = [0, 0, 0];

// Writes tangent vector for point p (unit vector) at phase into out.
// Original (unremapped) magnitude preserved — used later for singularity
// detection before any display-length remapping.
function tangentFieldAt(px, py, pz, phase, out) {
  fieldConstant(phase, _c);
  fieldOmega(phase, _w);
  const rx = _w[1] * pz - _w[2] * py;
  const ry = _w[2] * px - _w[0] * pz;
  const rz = _w[0] * py - _w[1] * px;
  const vx = CONFIG.fieldA * _c[0] + CONFIG.fieldB * rx;
  const vy = CONFIG.fieldA * _c[1] + CONFIG.fieldB * ry;
  const vz = CONFIG.fieldA * _c[2] + CONFIG.fieldB * rz;
  const vn = vx * px + vy * py + vz * pz;
  out[0] = vx - px * vn;
  out[1] = vy - py * vn;
  out[2] = vz - pz * vn;
}

function updateFieldBuffers(phase) {
  let maxMag = 0;
  for (let i = 0; i < CONFIG.pointCount; i++) {
    const o = i * 3;
    tangentFieldAt(
      spherePositions[o],
      spherePositions[o + 1],
      spherePositions[o + 2],
      phase,
      _tmpV,
    );
    tangentBuffer[o] = _tmpV[0];
    tangentBuffer[o + 1] = _tmpV[1];
    tangentBuffer[o + 2] = _tmpV[2];
    const m = Math.hypot(_tmpV[0], _tmpV[1], _tmpV[2]);
    magnitudeBuffer[i] = m;
    if (m > maxMag) maxMag = m;
  }
  return maxMag;
}
const _tmpV = [0, 0, 0];

function updateProbeState() {
  const rightX = loopState.viewZ;
  const rightZ = -loopState.viewX;
  let px = loopState.viewX + rightX * 0.72;
  let py = loopState.viewY - 0.36;
  let pz = loopState.viewZ + rightZ * 0.72;
  const pinv = 1 / (Math.hypot(px, py, pz) || 1);
  px *= pinv;
  py *= pinv;
  pz *= pinv;

  fieldConstant(loopState.phase, _c);
  fieldOmega(loopState.phase, _w);
  const rx = _w[1] * pz - _w[2] * py;
  const ry = _w[2] * px - _w[0] * pz;
  const rz = _w[0] * py - _w[1] * px;
  const sourceX = CONFIG.fieldA * _c[0] + CONFIG.fieldB * rx;
  const sourceY = CONFIG.fieldA * _c[1] + CONFIG.fieldB * ry;
  const sourceZ = CONFIG.fieldA * _c[2] + CONFIG.fieldB * rz;
  const normalScalar = sourceX * px + sourceY * py + sourceZ * pz;
  const normalX = px * normalScalar;
  const normalY = py * normalScalar;
  const normalZ = pz * normalScalar;
  const tangentX = sourceX - normalX;
  const tangentY = sourceY - normalY;
  const tangentZ = sourceZ - normalZ;

  probeState.x = px;
  probeState.y = py;
  probeState.z = pz;
  probeState.sourceX = sourceX;
  probeState.sourceY = sourceY;
  probeState.sourceZ = sourceZ;
  probeState.normalX = normalX;
  probeState.normalY = normalY;
  probeState.normalZ = normalZ;
  probeState.tangentX = tangentX;
  probeState.tangentY = tangentY;
  probeState.tangentZ = tangentZ;
  probeState.sourceMagnitude = Math.hypot(sourceX, sourceY, sourceZ);
  probeState.normalMagnitude = Math.hypot(normalX, normalY, normalZ);
  probeState.tangentMagnitude = Math.hypot(tangentX, tangentY, tangentZ);
  probeState.stage = Math.min(3, Math.floor(loopState.loopT * 4));
}

// ============================================================
// 7. SINGULARITY TRACKING (Newton's method in local tangent basis)
// ============================================================
// Two singularities exist naturally (Poincaré–Hopf: index sum over S² = 2).
// Tracked precisely frame-to-frame rather than snapped to render points, so
// they read as genuine field zeros, not an artificially placed marker.
const singularities = [
  { x: 0, y: 0, z: 0 },
  { x: 0, y: 0, z: 0 },
];
let singularitiesSeeded = false;

function localBasis(px, py, pz, out1, out2) {
  const upx = Math.abs(py) < 0.9 ? 0 : 1,
    upy = Math.abs(py) < 0.9 ? 1 : 0,
    upz = 0;
  let e1x = upy * pz - upz * py,
    e1y = upz * px - upx * pz,
    e1z = upx * py - upy * px;
  const e1inv = 1 / (Math.hypot(e1x, e1y, e1z) || 1);
  e1x *= e1inv;
  e1y *= e1inv;
  e1z *= e1inv;
  const e2x = py * e1z - pz * e1y,
    e2y = pz * e1x - px * e1z,
    e2z = px * e1y - py * e1x;
  out1[0] = e1x;
  out1[1] = e1y;
  out1[2] = e1z;
  out2[0] = e2x;
  out2[1] = e2y;
  out2[2] = e2z;
}

const _e1 = [0, 0, 0],
  _e2 = [0, 0, 0],
  _fu = [0, 0, 0],
  _fv = [0, 0, 0];

function newtonStep(pt, phase, h, maxStep) {
  localBasis(pt.x, pt.y, pt.z, _e1, _e2);
  tangentFieldAt(pt.x, pt.y, pt.z, phase, _tmpV);
  const f0e1 = _tmpV[0] * _e1[0] + _tmpV[1] * _e1[1] + _tmpV[2] * _e1[2];
  const f0e2 = _tmpV[0] * _e2[0] + _tmpV[1] * _e2[1] + _tmpV[2] * _e2[2];

  let ux = pt.x + _e1[0] * h,
    uy = pt.y + _e1[1] * h,
    uz = pt.z + _e1[2] * h;
  let uinv = 1 / (Math.hypot(ux, uy, uz) || 1);
  tangentFieldAt(ux * uinv, uy * uinv, uz * uinv, phase, _fu);

  let vx = pt.x + _e2[0] * h,
    vy = pt.y + _e2[1] * h,
    vz = pt.z + _e2[2] * h;
  let vinv = 1 / (Math.hypot(vx, vy, vz) || 1);
  tangentFieldAt(vx * vinv, vy * vinv, vz * vinv, phase, _fv);

  const fue1 = _fu[0] * _e1[0] + _fu[1] * _e1[1] + _fu[2] * _e1[2];
  const fue2 = _fu[0] * _e2[0] + _fu[1] * _e2[1] + _fu[2] * _e2[2];
  const fve1 = _fv[0] * _e1[0] + _fv[1] * _e1[1] + _fv[2] * _e1[2];
  const fve2 = _fv[0] * _e2[0] + _fv[1] * _e2[1] + _fv[2] * _e2[2];

  const j11 = (fue1 - f0e1) / h,
    j21 = (fue2 - f0e2) / h;
  const j12 = (fve1 - f0e1) / h,
    j22 = (fve2 - f0e2) / h;
  const det = j11 * j22 - j12 * j21;
  if (Math.abs(det) < 1e-9) return;

  let du = (j22 * f0e1 - j12 * f0e2) / det;
  let dv = (j11 * f0e2 - j21 * f0e1) / det;
  const mag = Math.hypot(du, dv);
  if (mag > maxStep) {
    const s = maxStep / mag;
    du *= s;
    dv *= s;
  }
  const nx = pt.x - _e1[0] * du - _e2[0] * dv;
  const ny = pt.y - _e1[1] * du - _e2[1] * dv;
  const nz = pt.z - _e1[2] * du - _e2[2] * dv;
  const ninv = 1 / (Math.hypot(nx, ny, nz) || 1);
  pt.x = nx * ninv;
  pt.y = ny * ninv;
  pt.z = nz * ninv;
}

function coarseSeedSingularities(phase) {
  const nTheta = 48,
    nPhi = 96;
  let best = [];
  for (let i = 0; i < nTheta; i++) {
    const theta = (Math.PI * (i + 0.5)) / nTheta;
    const st = Math.sin(theta),
      ct = Math.cos(theta);
    for (let j = 0; j < nPhi; j++) {
      const phi = (TAU * j) / nPhi;
      const px = st * Math.cos(phi),
        py = ct,
        pz = st * Math.sin(phi);
      tangentFieldAt(px, py, pz, phase, _tmpV);
      best.push([Math.hypot(_tmpV[0], _tmpV[1], _tmpV[2]), px, py, pz]);
    }
  }
  best.sort((a, b) => a[0] - b[0]);
  const picks = [best[0]];
  for (const cand of best) {
    const dp = cand[1] * picks[0][1] + cand[2] * picks[0][2] + cand[3] * picks[0][3];
    if (dp < Math.cos(0.5)) {
      picks.push(cand);
      break;
    }
  }
  for (let k = 0; k < 2 && k < picks.length; k++) {
    singularities[k].x = picks[k][1];
    singularities[k].y = picks[k][2];
    singularities[k].z = picks[k][3];
    for (let it = 0; it < CONFIG.newtonSeedIters; it++) {
      newtonStep(singularities[k], phase, CONFIG.newtonFDStep, CONFIG.newtonMaxStep);
    }
  }
  singularitiesSeeded = true;
}

function trackSingularities(phase) {
  if (!singularitiesSeeded) {
    coarseSeedSingularities(phase);
    return;
  }
  for (let k = 0; k < singularities.length; k++) {
    for (let it = 0; it < CONFIG.newtonIters; it++) {
      newtonStep(singularities[k], phase, CONFIG.newtonFDStep, CONFIG.newtonMaxStep);
    }
  }
}

// ============================================================
// 8. RENDERING
// ============================================================
function depthBrightness(px, py, pz) {
  const depth = px * loopState.viewX + py * loopState.viewY + pz * loopState.viewZ;
  const facing = (clamp(depth, -1, 1) + 1) * 0.5;
  return (
    CONFIG.frontDepthMin +
    (1 - CONFIG.frontDepthMin) * Math.pow(facing, 1.75)
  );
}

function fieldStageVisibility() {
  return [0.88, 0.88, 0.94, 1][probeState.stage];
}

function renderVectorGlow(maxMag) {
  blendMode(ADD);
  strokeWeight(CONFIG.glowWeight);
  for (let i = 0; i < CONFIG.pointCount; i++) {
    const o = i * 3;
    const px = spherePositions[o],
      py = spherePositions[o + 1],
      pz = spherePositions[o + 2];
    const vx = tangentBuffer[o],
      vy = tangentBuffer[o + 1],
      vz = tangentBuffer[o + 2];
    const mag = magnitudeBuffer[i];
    const magFrac = maxMag > 0 ? mag / maxMag : 0;
    const displayLen =
      CONFIG.vectorLengthScale *
      (CONFIG.vectorLengthMin + (1 - CONFIG.vectorLengthMin) * magFrac);
    const vinv = mag > 1e-6 ? displayLen / mag : 0;
    const sx = px * CONFIG.sphereScale,
      sy = py * CONFIG.sphereScale,
      sz = pz * CONFIG.sphereScale;
    const ux = vx * vinv,
      uy = vy * vinv,
      uz = vz * vinv;
    const depth = depthBrightness(px, py, pz);
    const alpha =
      CONFIG.glowAlpha *
      depth *
      depth *
      (0.35 + 0.65 * magFrac) *
      fieldStageVisibility();

    stroke(INK.r, INK.g, INK.b, alpha);
    line(
      sx - ux * 0.18,
      sy - uy * 0.18,
      sz - uz * 0.18,
      sx + ux * 0.82,
      sy + uy * 0.82,
      sz + uz * 0.82,
    );
  }
  blendMode(BLEND);
}

function renderVectorField(maxMag) {
  const hero = heroMix();
  strokeWeight(CONFIG.baseWeight);
  blendMode(BLEND);
  for (let i = 0; i < CONFIG.pointCount; i++) {
    const o = i * 3;
    const px = spherePositions[o],
      py = spherePositions[o + 1],
      pz = spherePositions[o + 2];
    const vx = tangentBuffer[o],
      vy = tangentBuffer[o + 1],
      vz = tangentBuffer[o + 2];
    const mag = magnitudeBuffer[i];
    const magFrac = maxMag > 0 ? mag / maxMag : 0;
    const displayLen =
      CONFIG.vectorLengthScale *
      (CONFIG.vectorLengthMin + (1 - CONFIG.vectorLengthMin) * magFrac);
    const vinv = mag > 1e-6 ? displayLen / mag : 0;

    const sx = px * CONFIG.sphereScale,
      sy = py * CONFIG.sphereScale,
      sz = pz * CONFIG.sphereScale;
    const ux = vx * vinv,
      uy = vy * vinv,
      uz = vz * vinv;
    const ex = sx + ux * 0.82,
      ey = sy + uy * 0.82,
      ez = sz + uz * 0.82;
    const bx = sx - ux * 0.18,
      by = sy - uy * 0.18,
      bz = sz - uz * 0.18;

    const depth = depthBrightness(px, py, pz);
    const alpha =
      CONFIG.baseAlpha *
      depth *
      (0.55 + 0.45 * magFrac) *
      (0.88 + 0.12 * hero) *
      fieldStageVisibility();
    const zeroMix = clamp(
      (CONFIG.zeroThresholdFrac - magFrac) / CONFIG.zeroThresholdFrac,
      0,
      1,
    );

    if (zeroMix > 0) {
      const dot0 =
        px * singularities[0].x +
        py * singularities[0].y +
        pz * singularities[0].z;
      const dot1 =
        px * singularities[1].x +
        py * singularities[1].y +
        pz * singularities[1].z;
      const c = dot0 > dot1 ? CYAN : MAGENTA;
      stroke(
        INK.r + (c.r - INK.r) * zeroMix,
        INK.g + (c.g - INK.g) * zeroMix,
        INK.b + (c.b - INK.b) * zeroMix,
        alpha + 58 * zeroMix * depth * fieldStageVisibility(),
      );
      strokeWeight(CONFIG.baseWeight + 1.15 * zeroMix);
    } else {
      stroke(INK.r, INK.g, INK.b, alpha);
      strokeWeight(CONFIG.baseWeight);
    }
    line(bx, by, bz, ex, ey, ez);
  }
}

const _flowC = [0, 0, 0];
const _probeE1 = [0, 0, 0];
const _probeE2 = [0, 0, 0];
const _defectE1 = [0, 0, 0];
const _defectE2 = [0, 0, 0];

function drawProbeRing(bx, by, bz, radius, alpha) {
  noFill();
  stroke(INK.r, INK.g, INK.b, alpha);
  strokeWeight(1.5);
  beginShape();
  for (let i = 0; i <= 32; i++) {
    const angle = (i / 32) * TAU;
    const u = Math.cos(angle) * radius;
    const v = Math.sin(angle) * radius;
    vertex(
      bx + _probeE1[0] * u + _probeE2[0] * v,
      by + _probeE1[1] * u + _probeE2[1] * v,
      bz + _probeE1[2] * u + _probeE2[2] * v,
    );
  }
  endShape();
}

function renderFlowAccents(maxMag) {
  fieldConstant(loopState.phase, _flowC);
  const stageVisibility = [0.52, 0.52, 0.9, 1][probeState.stage];
  blendMode(ADD);
  for (let i = 0; i < CONFIG.pointCount; i += CONFIG.flowStride) {
    const o = i * 3;
    const px = spherePositions[o],
      py = spherePositions[o + 1],
      pz = spherePositions[o + 2];
    const vx = tangentBuffer[o],
      vy = tangentBuffer[o + 1],
      vz = tangentBuffer[o + 2];
    const mag = magnitudeBuffer[i];
    const magFrac = maxMag > 0 ? mag / maxMag : 0;
    if (magFrac < CONFIG.zeroThresholdFrac * 0.8) continue;

    const displayLen =
      CONFIG.vectorLengthScale *
      (CONFIG.vectorLengthMin + (1 - CONFIG.vectorLengthMin) * magFrac);
    const vinv = mag > 1e-6 ? displayLen / mag : 0;
    const ux = vx * vinv,
      uy = vy * vinv,
      uz = vz * vinv;
    const sx = px * CONFIG.sphereScale - ux * 0.18,
      sy = py * CONFIG.sphereScale - uy * 0.18,
      sz = pz * CONFIG.sphereScale - uz * 0.18;
    const flowT = (loopState.loopT * 2 + i * 0.037) % 1;
    const envelope = Math.pow(Math.sin(flowT * Math.PI), 2);
    const depth = depthBrightness(px, py, pz);
    const sourceDot = px * _flowC[0] + py * _flowC[1] + pz * _flowC[2];
    const c = sourceDot >= 0 ? CYAN : MAGENTA;

    stroke(c.r, c.g, c.b, 96 * depth * envelope * stageVisibility);
    strokeWeight(CONFIG.flowPointSize * (0.65 + 0.35 * envelope));
    point(sx + ux * flowT, sy + uy * flowT, sz + uz * flowT);
  }
  blendMode(BLEND);
}

function renderProbe() {
  const p = probeState;
  if (p.stage === 3) return;
  const gl = drawingContext;
  gl.disable(gl.DEPTH_TEST);
  const scale = CONFIG.probeVectorScale;
  const bx = p.x * CONFIG.sphereScale,
    by = p.y * CONFIG.sphereScale,
    bz = p.z * CONFIG.sphereScale;
  const sourceX = bx + p.sourceX * scale,
    sourceY = by + p.sourceY * scale,
    sourceZ = bz + p.sourceZ * scale;
  const tangentX = bx + p.tangentX * scale,
    tangentY = by + p.tangentY * scale,
    tangentZ = bz + p.tangentZ * scale;
  const sourceFocus = [1, 0.28, 0.06][p.stage];
  const normalFocus = [0, 1, 0.06][p.stage];
  const tangentFocus = [0, 0.12, 1][p.stage];
  const planeFocus = [0, 1, 0.38][p.stage];

  localBasis(p.x, p.y, p.z, _probeE1, _probeE2);
  const planeRadius = 74;
  blendMode(BLEND);
  fill(CYAN.r, CYAN.g, CYAN.b, 18 * planeFocus);
  stroke(CYAN.r, CYAN.g, CYAN.b, 74 * planeFocus);
  strokeWeight(1.1);
  beginShape();
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * TAU;
    const u = Math.cos(angle) * planeRadius;
    const v = Math.sin(angle) * planeRadius;
    vertex(
      bx + _probeE1[0] * u + _probeE2[0] * v,
      by + _probeE1[1] * u + _probeE2[1] * v,
      bz + _probeE1[2] * u + _probeE2[2] * v,
    );
  }
  endShape(CLOSE);

  const markerPulse = 0.5 + 0.5 * Math.sin(loopState.phase * 2);
  blendMode(ADD);
  drawProbeRing(bx, by, bz, 17, 190);
  drawProbeRing(bx, by, bz, 27 + markerPulse * 12, 82 * (1 - markerPulse * 0.35));
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * TAU;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    line(
      bx + (_probeE1[0] * c + _probeE2[0] * s) * 21,
      by + (_probeE1[1] * c + _probeE2[1] * s) * 21,
      bz + (_probeE1[2] * c + _probeE2[2] * s) * 21,
      bx + (_probeE1[0] * c + _probeE2[0] * s) * 29,
      by + (_probeE1[1] * c + _probeE2[1] * s) * 29,
      bz + (_probeE1[2] * c + _probeE2[2] * s) * 29,
    );
  }

  strokeWeight(13);
  stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, 48 * sourceFocus);
  line(bx, by, bz, sourceX, sourceY, sourceZ);
  stroke(ACID.r, ACID.g, ACID.b, 48 * normalFocus);
  line(tangentX, tangentY, tangentZ, sourceX, sourceY, sourceZ);
  stroke(CYAN.r, CYAN.g, CYAN.b, 52 * tangentFocus);
  line(bx, by, bz, tangentX, tangentY, tangentZ);

  stroke(ACID.r, ACID.g, ACID.b, 82 * normalFocus);
  strokeWeight(2.2);
  line(
    bx - p.x * 58,
    by - p.y * 58,
    bz - p.z * 58,
    bx + p.x * 82,
    by + p.y * 82,
    bz + p.z * 82,
  );
  strokeWeight(6.5);
  stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, 255 * sourceFocus);
  line(bx, by, bz, sourceX, sourceY, sourceZ);
  stroke(ACID.r, ACID.g, ACID.b, 255 * normalFocus);
  line(tangentX, tangentY, tangentZ, sourceX, sourceY, sourceZ);
  stroke(CYAN.r, CYAN.g, CYAN.b, 255 * tangentFocus);
  line(bx, by, bz, tangentX, tangentY, tangentZ);

  noStroke();
  fill(INK.r, INK.g, INK.b, 190 * Math.max(sourceFocus, normalFocus, tangentFocus));
  push();
  translate(bx, by, bz);
  sphere(8, 8, 6);
  pop();
  fill(MAGENTA.r, MAGENTA.g, MAGENTA.b, 240 * sourceFocus);
  push();
  translate(sourceX, sourceY, sourceZ);
  sphere(10, 8, 6);
  pop();
  fill(CYAN.r, CYAN.g, CYAN.b, 250 * tangentFocus);
  push();
  translate(tangentX, tangentY, tangentZ);
  sphere(10, 8, 6);
  pop();
  blendMode(BLEND);
  gl.enable(gl.DEPTH_TEST);
}

function renderSingularities() {
  const colors = [CYAN, MAGENTA];
  const hero = heroMix();
  blendMode(ADD);
  noStroke();

  for (let k = 0; k < singularities.length; k++) {
    const s = singularities[k];
    const c = colors[k];
    const depth = depthBrightness(s.x, s.y, s.z);
    const sx = s.x * CONFIG.sphereScale,
      sy = s.y * CONFIG.sphereScale,
      sz = s.z * CONFIG.sphereScale;

    push();
    translate(sx, sy, sz);
    const pulse = 0.5 + 0.5 * Math.sin(loopState.phase * 2 + k * Math.PI);
    for (let r = 0; r < CONFIG.singularityRingCount; r++) {
      const ringT =
        (loopState.loopT + r / CONFIG.singularityRingCount + k * 0.5) % 1;
      const ringRadius = CONFIG.singularityRadius * (1.8 + ringT * 2.2);
      const defectFocus = probeState.stage === 3 ? 1.6 : 0.22;
      const ringAlpha =
        80 *
        Math.pow(1 - ringT, 1.7) *
        depth *
        (0.65 + 0.35 * hero) *
        defectFocus;
      push();
      noFill();
      stroke(c.r, c.g, c.b, ringAlpha);
      strokeWeight(1.4);
      rotateY(loopState.phase * 0.3 + (r * TAU) / CONFIG.singularityRingCount);
      rotateX(HALF_PI + 0.35 * Math.sin(loopState.phase + r * 2.1));
      circle(0, 0, ringRadius * 2);
      pop();
    }
    noStroke();
    const defectBodyFocus = probeState.stage === 3 ? 1.45 : 0.24;
    fill(c.r, c.g, c.b, 34 * depth * defectBodyFocus);
    sphere(CONFIG.singularityRadius * 1.6, 10, 8);
    fill(c.r, c.g, c.b, (210 + 45 * pulse) * depth * defectBodyFocus);
    sphere(CONFIG.singularityRadius * 0.7, 10, 8);
    pop();
  }
  blendMode(BLEND);
}

function renderDefectHalos() {
  if (probeState.stage !== 3) return;

  const colors = [CYAN, MAGENTA];
  const stageT = clamp((loopState.loopT - 0.75) / 0.25, 0, 1);
  const reveal = stageT * stageT * (3 - 2 * stageT);
  const surfaceRadius = CONFIG.sphereScale + 4;

  blendMode(ADD);
  noFill();

  for (let k = 0; k < singularities.length; k++) {
    const s = singularities[k];
    const c = colors[k];
    const depth = depthBrightness(s.x, s.y, s.z);
    localBasis(s.x, s.y, s.z, _defectE1, _defectE2);

    for (let ring = 0; ring < 4; ring++) {
      const wave = (stageT * 1.35 + ring * 0.19 + k * 0.5) % 1;
      const angularRadius = 0.055 + ring * 0.038 + wave * 0.035;
      const ringAlpha =
        (118 - ring * 16) *
        depth *
        reveal *
        Math.pow(1 - wave * 0.52, 1.5);

      stroke(c.r, c.g, c.b, ringAlpha);
      strokeWeight(2.4 - ring * 0.3);
      beginShape();
      for (let i = 0; i <= 48; i++) {
        const angle = (i / 48) * TAU;
        const ca = Math.cos(angularRadius);
        const sa = Math.sin(angularRadius);
        const tx =
          _defectE1[0] * Math.cos(angle) + _defectE2[0] * Math.sin(angle);
        const ty =
          _defectE1[1] * Math.cos(angle) + _defectE2[1] * Math.sin(angle);
        const tz =
          _defectE1[2] * Math.cos(angle) + _defectE2[2] * Math.sin(angle);
        vertex(
          (s.x * ca + tx * sa) * surfaceRadius,
          (s.y * ca + ty * sa) * surfaceRadius,
          (s.z * ca + tz * sa) * surfaceRadius,
        );
      }
      endShape();

      const orbitAngle = loopState.phase * (k === 0 ? 1.4 : -1.4) + ring * 1.7;
      const ca = Math.cos(angularRadius);
      const sa = Math.sin(angularRadius);
      const ox =
        _defectE1[0] * Math.cos(orbitAngle) +
        _defectE2[0] * Math.sin(orbitAngle);
      const oy =
        _defectE1[1] * Math.cos(orbitAngle) +
        _defectE2[1] * Math.sin(orbitAngle);
      const oz =
        _defectE1[2] * Math.cos(orbitAngle) +
        _defectE2[2] * Math.sin(orbitAngle);
      stroke(c.r, c.g, c.b, 210 * depth * reveal);
      strokeWeight(5.4 - ring * 0.55);
      point(
        (s.x * ca + ox * sa) * (surfaceRadius + 2),
        (s.y * ca + oy * sa) * (surfaceRadius + 2),
        (s.z * ca + oz * sa) * (surfaceRadius + 2),
      );
    }
  }

  blendMode(BLEND);
}

// ============================================================
// 9. ATMOSPHERE AND COMPACT INTERFACE
// ============================================================
function createInterfaceLayers() {
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  vignettePg = createGraphics(W, H);
  vignettePg.pixelDensity(1);
  const context = vignettePg.drawingContext;
  const gradient = context.createRadialGradient(W / 2, H / 2, 260, W / 2, H / 2, 1030);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.72, "rgba(0,0,0,0.04)");
  gradient.addColorStop(1, "rgba(0,0,0,0.34)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, W, H);
}

const HUD_BOT_H = 480;
const SAFE_TOP = 90;
const _hudV = [0, 0, 0];

function singularityResidual() {
  let maxResidual = 0;
  for (const singularity of singularities) {
    tangentFieldAt(
      singularity.x,
      singularity.y,
      singularity.z,
      loopState.phase,
      _hudV,
    );
    maxResidual = Math.max(maxResidual, Math.hypot(_hudV[0], _hudV[1], _hudV[2]));
  }
  return maxResidual;
}

function renderSimulatorInterface() {
  if (!showInterface) return;
  hudPg.clear();
  const context = hudPg.drawingContext;
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  context.save();
  context.textBaseline = "top";
  context.textAlign = "left";
  context.font = `26px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.92)";
  context.fillText("HAIRY BALL THEOREM", 72, 72 + SAFE_TOP);
  context.font = `18px ${mono}`;
  context.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.84)`;
  context.fillText("S² tangent field", 72, 112 + SAFE_TOP);

  context.textAlign = "left";
  context.font = `16px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.48)";
  context.fillText(
    `VECTORS  ${CONFIG.pointCount}    DEFECTS  2    PROBE  LIVE`,
    72,
    150 + SAFE_TOP,
  );

  const topRuleY = 232 + SAFE_TOP;
  const footY = H - HUD_BOT_H;
  context.strokeStyle = "rgba(255,255,255,.12)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(72, topRuleY);
  context.lineTo(W - 72, topRuleY);
  context.moveTo(72, footY);
  context.lineTo(W - 72, footY);
  context.stroke();

  const residual = singularityResidual();
  const phaseDegrees = loopState.loopT * 360;
  const baseY = footY + 38;
  const sourceHudAlpha = [0.96, 0.24, 0.16, 0.12][probeState.stage];
  const normalHudAlpha = [0.18, 0.96, 0.2, 0.12][probeState.stage];
  const tangentHudAlpha = [0.16, 0.24, 0.96, 0.12][probeState.stage];
  const defectHudAlpha = [0.16, 0.16, 0.22, 0.92][probeState.stage];

  context.textAlign = "center";
  context.font = `16px ${mono}`;
  context.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.86)`;
  context.fillText(
    `SIMULATOR    ${EXPLANATION_STAGES[probeState.stage]}`,
    W / 2,
    baseY,
  );

  context.font = `23px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.9)";
  context.fillText(EXPLANATION_FORMULAS[probeState.stage], W / 2, baseY + 38);
  context.font = `17px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.42)";
  context.fillText(EXPLANATION_HELP[probeState.stage], W / 2, baseY + 78);

  context.font = `16px ${mono}`;
  context.textAlign = "left";
  context.fillStyle = `rgba(${MAGENTA.r},${MAGENTA.g},${MAGENTA.b},${sourceHudAlpha})`;
  context.fillText(
    `1 SOURCE  |v| = ${probeState.sourceMagnitude.toFixed(3)}`,
    76,
    baseY + 128,
  );
  context.textAlign = "center";
  context.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},${normalHudAlpha})`;
  context.fillText(
    `2 REMOVE  |n(v·n)| = ${probeState.normalMagnitude.toFixed(3)}`,
    W / 2,
    baseY + 128,
  );
  context.textAlign = "right";
  context.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},${tangentHudAlpha})`;
  context.fillText(
    `3 RESULT  |vᴛ| = ${probeState.tangentMagnitude.toFixed(3)}`,
    W - 76,
    baseY + 128,
  );

  context.textAlign = "left";
  context.fillStyle = "rgba(255,255,255,.42)";
  context.fillText(
    `PHASE  ${phaseDegrees.toFixed(1).padStart(5, " ")}°`,
    76,
    baseY + 170,
  );
  context.textAlign = "right";
  context.fillStyle = `rgba(255,255,255,${defectHudAlpha})`;
  context.fillText(
    `4 DEFECT  max |vᴛ(p*)| = ${residual.toExponential(1)}`,
    W - 76,
    baseY + 170,
  );

  const trackY = baseY + 222;
  const trackWidth = W - 152;
  const phaseX = 76 + trackWidth * loopState.loopT;
  context.beginPath();
  context.moveTo(76, trackY);
  context.lineTo(W - 76, trackY);
  context.strokeStyle = "rgba(255,255,255,.12)";
  context.lineWidth = 1;
  context.stroke();
  context.strokeStyle = "rgba(255,255,255,.16)";
  for (let i = 1; i < 4; i++) {
    const tickX = 76 + (trackWidth * i) / 4;
    context.beginPath();
    context.moveTo(tickX, trackY - 7);
    context.lineTo(tickX, trackY + 7);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(76, trackY);
  context.lineTo(phaseX, trackY);
  context.strokeStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.72)`;
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.arc(phaseX, trackY, 4.5, 0, TAU);
  context.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.92)`;
  context.fill();

  context.textAlign = "center";
  context.font = `15px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.28)";
  context.fillText("∄ continuous tangent field with |vᴛ(p)| > 0 for every p ∈ S²", W / 2, baseY + 252);
  context.restore();

  drawOverlayLayer(vignettePg);
  drawOverlayLayer(hudPg);
}

function drawOverlayLayer(layer) {
  const gl = drawingContext;
  gl.disable(gl.DEPTH_TEST);
  const overlayZ = H / (2 * Math.tan(PI / 6));
  push();
  camera(0, 0, overlayZ, 0, 0, 0, 0, 1, 0);
  perspective(PI / 3, W / H, 10, 5000);
  imageMode(CENTER);
  image(layer, 0, 0, W, H);
  pop();
  gl.enable(gl.DEPTH_TEST);
}

// ============================================================
// 10. LOOP-SAFE CAMERA (counter-rotating relative to field phase —
// keeps at least one singularity camera-facing across the whole loop)
// ============================================================
function applyLoopingCamera() {
  const angle = loopState.cameraAngle + userYaw;
  const radius = loopState.cameraRadius + userZoomOffset;
  const height = loopState.cameraHeight + userPitch * 420;
  const cx = Math.sin(angle) * radius;
  const cz = Math.cos(angle) * radius;
  camera(cx, height, cz, 0, 0, 0, 0, 1, 0);
}

// ============================================================
// 11. AUTOMATIC REEL TIMELINE
// ============================================================
// Peaks at t=0 and t=1 (loop wrap) — integer k=1 cosine, so the hero state
// is both the strongest frame and identical at both loop ends.
function heroMix() {
  return 0.5 + 0.5 * Math.cos(loopState.phase);
}

function updateAutomaticTimeline(frameIndex) {
  loopState.loopT =
    (((frameIndex % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  loopState.phase = loopState.loopT * TAU;

  // Camera counter-rotates against the field phase (verified via numeric
  // sweep — co-rotating leaves both singularities on the far side for a
  // stretch of the loop; counter-rotation keeps a defect strongly visible).
  loopState.cameraAngle = CONFIG.cameraStartAngle - loopState.phase;
  loopState.cameraRadius =
    CONFIG.cameraRadius + Math.sin(loopState.phase * 2) * CONFIG.cameraRadiusVariation;
  loopState.cameraHeight =
    CONFIG.cameraHeight + Math.sin(loopState.phase) * CONFIG.cameraHeightVariation;
  const viewInv = 1 / Math.max(1, Math.hypot(loopState.cameraRadius, loopState.cameraHeight));
  loopState.viewX = Math.sin(loopState.cameraAngle) * loopState.cameraRadius * viewInv;
  loopState.viewY = loopState.cameraHeight * viewInv;
  loopState.viewZ = Math.cos(loopState.cameraAngle) * loopState.cameraRadius * viewInv;
}

// ============================================================
// 12. SETUP AND MAIN RENDER LOOP
// ============================================================
function setup() {
  setAttributes({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  const canvas = createCanvas(W, H, WEBGL);
  canvasEl = canvas.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  strokeCap(ROUND);
  document.getElementById("canvas-wrap").appendChild(canvasEl);
  document.getElementById("maxDuration").textContent = MAX_DURATION;
  document.getElementById("maxFrames").textContent = MAX_FRAMES;
  generateSpherePoints();
  createInterfaceLayers();
  bindControls();
}

function renderScene() {
  applyLoopingCamera();
  const maxMag = updateFieldBuffers(loopState.phase);
  trackSingularities(loopState.phase);
  updateProbeState();

  push();
  rotateX(-0.16);
  renderVectorGlow(maxMag);
  renderVectorField(maxMag);
  renderFlowAccents(maxMag);
  renderProbe();
  renderDefectHalos();
  renderSingularities();
  pop();

  renderSimulatorInterface();
}

function draw() {
  const sourceFrame = isRecording
    ? recordingStartFrame + recFrameCount
    : frameCount - 1;
  if (!paused || isRecording) frozenFrame = sourceFrame;
  updateAutomaticTimeline(frozenFrame);
  background(BG_R, BG_G, BG_B);
  perspective(PI / 3, W / H, 10, 5000);
  renderScene();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ============================================================
// 13. INTERACTION CONTROLS
// ============================================================
function bindControls() {
  document.getElementById("startBtn").addEventListener("click", startRecording);
  document.getElementById("stopBtn").addEventListener("click", stopRecording);
  document
    .getElementById("pngBtn")
    .addEventListener("click", () => saveCanvas("hairy_ball_" + ts(), "png"));
}

function resetCamera() {
  userYaw = 0;
  userPitch = 0;
  userZoomOffset = 0;
}

function resetSimulation() {
  resetCamera();
  singularitiesSeeded = false;
}

function mousePressed() {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  isDragging = true;
  lastMouseX = mouseX;
  lastMouseY = mouseY;
}

function mouseReleased() {
  isDragging = false;
}

function mouseDragged() {
  if (!isDragging) return;
  userYaw += (mouseX - lastMouseX) * 0.006;
  userPitch = clamp(userPitch + (mouseY - lastMouseY) * 0.004, -0.7, 0.7);
  lastMouseX = mouseX;
  lastMouseY = mouseY;
  return false;
}

function mouseWheel(event) {
  userZoomOffset = clamp(userZoomOffset + event.delta * 0.55, -320, 520);
  return false;
}

function keyPressed() {
  if (key === " ") {
    paused = !paused;
    return false;
  }
  if (key === "r" || key === "R") {
    resetSimulation();
    return false;
  }
  if (key === "h" || key === "H") {
    showInterface = !showInterface;
    return false;
  }
  if (key === "p" || key === "P") {
    saveCanvas("hairy_ball_" + ts(), "png");
    return false;
  }
  if (key === "c" || key === "C" || key === "e" || key === "E") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  return true;
}

// ============================================================
// 14. EXISTING WEBCodecs + MP4-MUXER CAPTURE/EXPORT WORKFLOW
// ============================================================
function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs not supported.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer not loaded.");
    return;
  }
  // Capture from the exact phase and camera state currently on screen.
  // Adding recFrameCount still records one complete, seamless 600-frame loop.
  recordingStartFrame = frozenFrame;
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      console.error(error);
      isRecording = false;
      setStatus("Error", "#f44");
    },
  });
  encoder.configure({
    codec: "avc1.640028",
    width: W,
    height: H,
    bitrate: 18_000_000,
    framerate: FPS,
  });
  recFrameCount = 0;
  isRecording = true;
  paused = false;
  document.body.classList.add("recording");
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  setStatus("Recording…", "#fff");
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing…", "#ccc");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" }),
    url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hairy_ball_" + ts() + ".mp4";
  anchor.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.body.classList.remove("recording");
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  document.getElementById("progressFill").style.width = "0%";
  setStatus("Complete", "#fff");
  setTimeout(() => setStatus("Ready", "#ccc"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function updateRecordingUi() {
  document.getElementById("duration").textContent = (recFrameCount / FPS).toFixed(1);
  document.getElementById("frameCount").textContent = recFrameCount;
  document.getElementById("progressFill").style.width =
    ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
}

function setStatus(textValue, colorValue) {
  const element = document.getElementById("status");
  element.textContent = textValue;
  element.style.color = colorValue;
}

// ============================================================
// 15. UTILITIES
// ============================================================
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function ts() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.ts = ts;

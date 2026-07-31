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

const MODES = {
  FULL_FIBRATION: 0,
  SINGLE_FIBER: 1,
  LINKED_PAIR: 2,
  HOPF_MAP: 3,
  PROJECTION: 4,
};
const MODE_NAMES = [
  "FULL FIBRATION",
  "SINGLE FIBER",
  "LINKED PAIR",
  "HOPF MAP",
  "PROJECTION",
];

// ============================================================
// 2. CENTRAL CONFIGURATION
// ============================================================
const CONFIG = {
  fiberCount: 64,
  pointsPerFiber: 168,
  structureScale: 218,

  projectionBase: 0.82,
  projectionAmplitude: 0.07,
  projectionMin: 0.68,
  projectionMax: 0.92,
  projectionEpsilon: 0.001,
  maxProjectionRadius: 7,

  baseLineWeight: 1.05,
  glowLineWeight: 6.5,
  coreAlpha: 188,
  secondaryAlpha: 38,
  selectedAlpha: 255,

  travellingParticleCount: 12,
  particleSize: 6,
  trailLength: 8,

  cameraRadius: 1480,
  cameraRadiusVariation: 34,
  cameraHeight: -115,
  cameraHeightVariation: 52,
  cameraStartAngle: -0.55,

  baseSphereRadius: 108,
  baseSphereX: 310,
  baseSphereY: -300,

  selectedFiber: 13,
  linkedPair: [13, 47],
  showInterface: true,
  showBaseSphere: true,
  showProjectionGuides: true,
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
  recFrameCount = 0;
let paused = false,
  frozenFrame = 0;
let isDragging = false,
  lastMouseX = 0,
  lastMouseY = 0;
let userYaw = 0,
  userPitch = 0,
  userZoomOffset = 0;

// ============================================================
// 5. SIMULATOR STATE
// ============================================================
let autoMode = true;
let manualMode = MODES.FULL_FIBRATION;
let selectedFiber = CONFIG.selectedFiber;
let manualLambda = CONFIG.projectionBase;
let showInterface = CONFIG.showInterface;

const loopState = {
  loopT: 0,
  phase: 0,
  lambda: CONFIG.projectionBase,
  cameraAngle: CONFIG.cameraStartAngle,
  cameraRadius: CONFIG.cameraRadius,
  cameraHeight: CONFIG.cameraHeight,
  viewX: 0,
  viewY: 0,
  viewZ: 1,
  activeMode: MODES.FULL_FIBRATION,
};
const modeMixes = new Float32Array(5);

// ============================================================
// 6. FIBER DATA INITIALIZATION
// ============================================================
const fibers = [];
let baseSpherePoints;
let fiberPositions;
let fiberValid;
let fiberCurvature;
let fiberCentroids;
const s3Point = { x1: 0, x2: 0, x3: 0, x4: 0 };
const projectedPoint = { x: 0, y: 0, z: 0 };
const hopfPoint = { x: 0, y: 0, z: 0 };

function initializeSimulator() {
  generateBaseSpherePoints();
  createFiberParameters();
  const stride = CONFIG.pointsPerFiber + 1;
  fiberPositions = new Float32Array(CONFIG.fiberCount * stride * 3);
  fiberValid = new Uint8Array(CONFIG.fiberCount * stride);
  fiberCurvature = new Float32Array(CONFIG.fiberCount * stride);
  fiberCentroids = new Float32Array(CONFIG.fiberCount * 3);
}

function generateBaseSpherePoints() {
  baseSpherePoints = new Float32Array(CONFIG.fiberCount * 3);
  for (let i = 0; i < CONFIG.fiberCount; i++) {
    const y = 1 - (2 * (i + 0.5)) / CONFIG.fiberCount;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * GOLDEN_ANGLE;
    const offset = i * 3;
    baseSpherePoints[offset] = radius * Math.cos(theta);
    baseSpherePoints[offset + 1] = y;
    baseSpherePoints[offset + 2] = radius * Math.sin(theta);
  }
}

function createFiberParameters() {
  for (let i = 0; i < CONFIG.fiberCount; i++) {
    const offset = i * 3;
    const hx = baseSpherePoints[offset];
    const hy = baseSpherePoints[offset + 1];
    const hz = baseSpherePoints[offset + 2];

    // Invert H=(sin(2eta)cos(delta), sin(2eta)sin(delta), cos(2eta)).
    const eta = 0.5 * Math.acos(clamp(hz, -1, 1));
    const delta = Math.atan2(hy, hx);
    const fiber = {
      eta,
      xi1: delta * 0.5,
      xi2: -delta * 0.5,
      cosEta: Math.cos(eta),
      sinEta: Math.sin(eta),
      hx,
      hy,
      hz,
    };
    // Recalculate the base point with the forward Hopf map. This makes the
    // displayed S² association depend on the same S³ fiber used for rendering.
    calculateS3Point(fiber, 0, s3Point);
    calculateHopfMap(s3Point, hopfPoint);
    fiber.hx = hopfPoint.x;
    fiber.hy = hopfPoint.y;
    fiber.hz = hopfPoint.z;
    baseSpherePoints[offset] = hopfPoint.x;
    baseSpherePoints[offset + 1] = hopfPoint.y;
    baseSpherePoints[offset + 2] = hopfPoint.z;
    fibers.push(fiber);
  }
}

// ============================================================
// 7. HOPF MATHEMATICS ON S^3
// ============================================================
function calculateS3Point(fiber, t, out) {
  const a = fiber.xi1 + t;
  const b = fiber.xi2 + t;
  out.x1 = fiber.cosEta * Math.cos(a);
  out.x2 = fiber.cosEta * Math.sin(a);
  out.x3 = fiber.sinEta * Math.cos(b);
  out.x4 = fiber.sinEta * Math.sin(b);
  return out;
}

// ============================================================
// 8. STEREOGRAPHIC PROJECTION S^3 -> R^3
// ============================================================
function stereographicProject(point4, lambda, out) {
  let denominator = 1 - lambda * point4.x4;
  if (Math.abs(denominator) < CONFIG.projectionEpsilon) {
    denominator =
      denominator < 0
        ? -CONFIG.projectionEpsilon
        : CONFIG.projectionEpsilon;
  }

  const x = point4.x1 / denominator;
  const y = point4.x2 / denominator;
  const z = point4.x3 / denominator;
  const radius = Math.hypot(x, y, z);
  if (!Number.isFinite(radius) || radius > CONFIG.maxProjectionRadius) {
    return false;
  }

  out.x = x * CONFIG.structureScale;
  out.y = y * CONFIG.structureScale;
  out.z = z * CONFIG.structureScale;
  return true;
}

// ============================================================
// 9. HOPF MAP S^3 -> S^2
// ============================================================
function calculateHopfMap(point4, out) {
  out.x = 2 * (point4.x1 * point4.x3 + point4.x2 * point4.x4);
  out.y = 2 * (point4.x2 * point4.x3 - point4.x1 * point4.x4);
  out.z =
    point4.x1 * point4.x1 +
    point4.x2 * point4.x2 -
    point4.x3 * point4.x3 -
    point4.x4 * point4.x4;
  return out;
}

function sampleFiber(fiberIndex) {
  const pointCount = CONFIG.pointsPerFiber;
  const stride = pointCount + 1;
  const fiberOffset = fiberIndex * stride;
  const positionOffset = fiberOffset * 3;
  const fiber = fibers[fiberIndex];
  let sumX = 0,
    sumY = 0,
    sumZ = 0,
    validCount = 0;

  for (let pi = 0; pi <= pointCount; pi++) {
    const t = (TAU * pi) / pointCount;
    calculateS3Point(fiber, t, s3Point);
    const valid = stereographicProject(s3Point, loopState.lambda, projectedPoint);
    const sampleIndex = fiberOffset + pi;
    fiberValid[sampleIndex] = valid ? 1 : 0;
    const target = positionOffset + pi * 3;

    if (valid) {
      fiberPositions[target] = projectedPoint.x;
      fiberPositions[target + 1] = projectedPoint.y;
      fiberPositions[target + 2] = projectedPoint.z;
      sumX += projectedPoint.x;
      sumY += projectedPoint.y;
      sumZ += projectedPoint.z;
      validCount++;
    }
  }

  const centroidOffset = fiberIndex * 3;
  const inv = 1 / Math.max(1, validCount);
  fiberCentroids[centroidOffset] = sumX * inv;
  fiberCentroids[centroidOffset + 1] = sumY * inv;
  fiberCentroids[centroidOffset + 2] = sumZ * inv;
  estimateFiberCurvature(fiberIndex);
}

function estimateFiberCurvature(fiberIndex) {
  const pointCount = CONFIG.pointsPerFiber;
  const stride = pointCount + 1;
  const fiberOffset = fiberIndex * stride;
  const positionOffset = fiberOffset * 3;

  for (let pi = 0; pi < pointCount; pi++) {
    const prev = (pi - 1 + pointCount) % pointCount;
    const next = (pi + 1) % pointCount;
    const a = positionOffset + prev * 3;
    const b = positionOffset + pi * 3;
    const c = positionOffset + next * 3;
    const ax = fiberPositions[b] - fiberPositions[a];
    const ay = fiberPositions[b + 1] - fiberPositions[a + 1];
    const az = fiberPositions[b + 2] - fiberPositions[a + 2];
    const bx = fiberPositions[c] - fiberPositions[b];
    const by = fiberPositions[c + 1] - fiberPositions[b + 1];
    const bz = fiberPositions[c + 2] - fiberPositions[b + 2];
    const invA = 1 / Math.max(1e-6, Math.hypot(ax, ay, az));
    const invB = 1 / Math.max(1e-6, Math.hypot(bx, by, bz));
    const dot = clamp(
      (ax * bx + ay * by + az * bz) * invA * invB,
      -1,
      1,
    );
    fiberCurvature[fiberOffset + pi] = Math.sqrt(Math.max(0, 1 - dot * dot));
  }
  fiberCurvature[fiberOffset + pointCount] = fiberCurvature[fiberOffset];
}

function updateFiberBuffers() {
  for (let fi = 0; fi < CONFIG.fiberCount; fi++) sampleFiber(fi);
}

// ============================================================
// 10. FIBER RENDERING AND DEPTH TREATMENT
// ============================================================
function fiberDepthBrightness(fiberIndex) {
  const offset = fiberIndex * 3;
  const depth =
    fiberCentroids[offset] * loopState.viewX +
    fiberCentroids[offset + 1] * loopState.viewY +
    fiberCentroids[offset + 2] * loopState.viewZ;
  return map(clamp(depth, -260, 260), -260, 260, 0.42, 1);
}

function renderFiberPath(fiberIndex, colorValue, alpha, weight) {
  const pointCount = CONFIG.pointsPerFiber;
  const stride = pointCount + 1;
  const sampleOffset = fiberIndex * stride;
  let positionOffset = sampleOffset * 3;
  let shapeOpen = false;

  noFill();
  stroke(colorValue.r, colorValue.g, colorValue.b, alpha);
  strokeWeight(weight);
  for (let pi = 0; pi <= pointCount; pi++) {
    if (fiberValid[sampleOffset + pi]) {
      if (!shapeOpen) {
        beginShape();
        shapeOpen = true;
      }
      vertex(
        fiberPositions[positionOffset],
        fiberPositions[positionOffset + 1],
        fiberPositions[positionOffset + 2],
      );
    } else if (shapeOpen) {
      endShape();
      shapeOpen = false;
    }
    positionOffset += 3;
  }
  if (shapeOpen) endShape();
}

function renderFiberGlow(fiberIndex, colorValue, visibility) {
  const depth = fiberDepthBrightness(fiberIndex);
  const selectedAlpha = CONFIG.selectedAlpha * visibility * depth;
  renderFiberPath(
    fiberIndex,
    colorValue,
    selectedAlpha * 0.045,
    CONFIG.glowLineWeight * 2.2,
  );
  renderFiberPath(
    fiberIndex,
    colorValue,
    selectedAlpha * 0.2,
    CONFIG.glowLineWeight,
  );
  renderFiberPath(
    fiberIndex,
    colorValue,
    selectedAlpha,
    CONFIG.baseLineWeight * 2.35,
  );
  renderCurvatureCore(fiberIndex, selectedAlpha);
}

function renderCurvatureCore(fiberIndex, alpha) {
  const pointCount = CONFIG.pointsPerFiber;
  const stride = pointCount + 1;
  const sampleOffset = fiberIndex * stride;
  const positionOffset = sampleOffset * 3;

  for (let pi = 0; pi < pointCount; pi++) {
    if (!fiberValid[sampleOffset + pi] || !fiberValid[sampleOffset + pi + 1]) {
      continue;
    }
    const a = positionOffset + pi * 3;
    const b = a + 3;
    const curvature = clamp(fiberCurvature[sampleOffset + pi] * 15, 0, 1);
    stroke(INK.r, INK.g, INK.b, alpha * (0.22 + curvature * 0.34));
    strokeWeight(0.65 + curvature * 0.4);
    line(
      fiberPositions[a],
      fiberPositions[a + 1],
      fiberPositions[a + 2],
      fiberPositions[b],
      fiberPositions[b + 1],
      fiberPositions[b + 2],
    );
  }
}

function focusStrength() {
  return Math.max(
    modeMixes[MODES.SINGLE_FIBER],
    modeMixes[MODES.LINKED_PAIR],
    modeMixes[MODES.HOPF_MAP],
  );
}

function isFocusedFiber(fiberIndex) {
  let strength = 0;
  if (fiberIndex === selectedFiber) {
    strength = Math.max(
      modeMixes[MODES.SINGLE_FIBER],
      modeMixes[MODES.HOPF_MAP],
    );
  }
  if (
    fiberIndex === CONFIG.linkedPair[0] ||
    fiberIndex === CONFIG.linkedPair[1]
  ) {
    strength = Math.max(strength, modeMixes[MODES.LINKED_PAIR]);
  }
  return strength;
}

function renderFullFibration() {
  const dim = 1 - focusStrength() * 0.86;
  const projectionLift = modeMixes[MODES.PROJECTION] * 0.18;

  for (let fi = 0; fi < CONFIG.fiberCount; fi++) {
    const depth = fiberDepthBrightness(fi);
    const selected = isFocusedFiber(fi);
    const isPrimaryGroup = fi % 8 === 0;
    const groupColor = isPrimaryGroup ? CYAN : INK;
    const alpha =
      CONFIG.secondaryAlpha *
      depth *
      (dim + selected * 0.2 + projectionLift) *
      (isPrimaryGroup ? 2.75 : 1);
    renderFiberPath(
      fi,
      groupColor,
      alpha,
      CONFIG.baseLineWeight * (isPrimaryGroup ? 1.22 : 1),
    );
  }
}

function prepareSelectedLayer() {
  drawingContext.clear(drawingContext.DEPTH_BUFFER_BIT);
  drawingContext.depthFunc(drawingContext.LEQUAL);
}

function renderSingleFiber() {
  const visibility = modeMixes[MODES.SINGLE_FIBER];
  if (visibility <= 0.001) return;
  renderFiberGlow(selectedFiber, CYAN, visibility);
}

function renderLinkedPair() {
  const visibility = modeMixes[MODES.LINKED_PAIR];
  if (visibility <= 0.001) return;
  renderFiberGlow(CONFIG.linkedPair[0], CYAN, visibility);
  renderFiberGlow(CONFIG.linkedPair[1], MAGENTA, visibility);
}

function renderHopfMapMode() {
  const visibility = modeMixes[MODES.HOPF_MAP];
  if (visibility <= 0.001) return;
  renderFiberGlow(selectedFiber, CYAN, visibility);
}

function renderProjectionMode() {
  const visibility = modeMixes[MODES.PROJECTION];
  if (visibility <= 0.001) return;
  for (let i = 0; i < 4; i++) {
    const fiberIndex = (i * 16 + 6) % CONFIG.fiberCount;
    renderFiberGlow(fiberIndex, i % 2 ? ACID : CYAN, visibility * 0.42);
  }
  if (CONFIG.showProjectionGuides) renderProjectionGuides(visibility);
}

function renderProjectionGuides(visibility) {
  noFill();
  stroke(ACID.r, ACID.g, ACID.b, 34 * visibility);
  strokeWeight(1);
  const fiberIndex = selectedFiber;
  const stride = CONFIG.pointsPerFiber + 1;
  const offset = fiberIndex * stride * 3;
  for (let pi = 0; pi < CONFIG.pointsPerFiber; pi += 28) {
    const source = offset + pi * 3;
    line(
      0,
      0,
      0,
      fiberPositions[source],
      fiberPositions[source + 1],
      fiberPositions[source + 2],
    );
  }
}

// ============================================================
// 11. PARTICLE AND TRAIL RENDERING
// ============================================================
function renderTravellingParticles() {
  const singleMix = Math.max(
    modeMixes[MODES.SINGLE_FIBER],
    modeMixes[MODES.HOPF_MAP],
  );
  const pairMix = modeMixes[MODES.LINKED_PAIR];
  const visibility = Math.max(singleMix, pairMix);
  if (visibility <= 0.01) return;

  const count = pairMix > singleMix ? CONFIG.travellingParticleCount : 8;
  blendMode(ADD);
  for (let i = 0; i < count; i++) {
    const usePair = pairMix > singleMix;
    const fiberIndex = usePair ? CONFIG.linkedPair[i % 2] : selectedFiber;
    const colorValue = usePair && i % 2 ? MAGENTA : CYAN;
    const base = TAU * (i / count);
    const sampleIndex =
      Math.floor(fract((base + loopState.phase) / TAU) * CONFIG.pointsPerFiber);
    const curvatureOffset =
      fiberIndex * (CONFIG.pointsPerFiber + 1) + sampleIndex;
    const curvature = clamp(fiberCurvature[curvatureOffset] * 15, 0, 1);
    const t =
      base +
      loopState.phase +
      0.035 * curvature * Math.sin(loopState.phase + base);
    renderParticleTrail(fiberIndex, t, colorValue, visibility);
    renderParticle(fiberIndex, t, visibility, curvature);
  }
  blendMode(BLEND);
}

function renderParticleTrail(fiberIndex, headT, colorValue, visibility) {
  const fiber = fibers[fiberIndex];
  for (let j = CONFIG.trailLength; j > 0; j--) {
    const life = 1 - j / CONFIG.trailLength;
    const ta = headT - j * 0.018;
    const tb = headT - (j - 1) * 0.018;
    calculateS3Point(fiber, ta, s3Point);
    if (!stereographicProject(s3Point, loopState.lambda, projectedPoint)) continue;
    const ax = projectedPoint.x,
      ay = projectedPoint.y,
      az = projectedPoint.z;
    calculateS3Point(fiber, tb, s3Point);
    if (!stereographicProject(s3Point, loopState.lambda, projectedPoint)) continue;
    stroke(
      colorValue.r,
      colorValue.g,
      colorValue.b,
      (8 + life * 105) * visibility,
    );
    strokeWeight(0.8 + life * 2.2);
    line(ax, ay, az, projectedPoint.x, projectedPoint.y, projectedPoint.z);
  }
}

function renderParticle(fiberIndex, t, visibility, curvature) {
  calculateS3Point(fibers[fiberIndex], t, s3Point);
  if (!stereographicProject(s3Point, loopState.lambda, projectedPoint)) return;
  const size = CONFIG.particleSize * (0.9 + curvature * 0.3);
  push();
  translate(projectedPoint.x, projectedPoint.y, projectedPoint.z);
  noStroke();
  fill(ACID.r, ACID.g, ACID.b, 32 * visibility);
  sphere(size * 2.5, 6, 4);
  fill(ACID.r, ACID.g, ACID.b, 242 * visibility);
  sphere(size, 7, 5);
  pop();
}

// ============================================================
// 12. BASE SPHERE S^2 AND POINT-TO-FIBER RELATIONSHIP
// ============================================================
function renderBaseSphere() {
  if (!CONFIG.showBaseSphere) return;
  const visibility = Math.max(
    modeMixes[MODES.HOPF_MAP],
    modeMixes[MODES.SINGLE_FIBER] * 0.58,
  );
  if (visibility <= 0.01) return;

  // A fixed secondary camera keeps the reference sphere in a safe margin.
  camera(0, 0, CONFIG.cameraRadius, 0, 0, 0, 0, 1, 0);
  push();
  translate(CONFIG.baseSphereX, CONFIG.baseSphereY, 0);
  drawBaseSphereGrid(visibility);
  drawBaseSpherePoints(visibility);
  drawMapConnector(visibility);
  pop();
}

function drawBaseSphereGrid(visibility) {
  const radius = CONFIG.baseSphereRadius;
  noFill();
  stroke(INK.r, INK.g, INK.b, 62 * visibility);
  strokeWeight(1);
  for (let lat = -2; lat <= 2; lat++) {
    const v = lat / 3;
    const y = v * radius;
    const ringRadius = Math.sqrt(1 - v * v) * radius;
    beginShape();
    for (let i = 0; i <= 48; i++) {
      const a = (TAU * i) / 48;
      vertex(Math.cos(a) * ringRadius, y, Math.sin(a) * ringRadius);
    }
    endShape();
  }
  for (let longitude = 0; longitude < 6; longitude++) {
    const a = (TAU * longitude) / 6;
    beginShape();
    for (let i = 0; i <= 48; i++) {
      const t = (TAU * i) / 48;
      vertex(
        Math.cos(a) * Math.cos(t) * radius,
        Math.sin(t) * radius,
        Math.sin(a) * Math.cos(t) * radius,
      );
    }
    endShape();
  }
}

function drawBaseSpherePoints(visibility) {
  const radius = CONFIG.baseSphereRadius;
  for (let i = 0; i < CONFIG.fiberCount; i += 2) {
    const offset = i * 3;
    push();
    translate(
      baseSpherePoints[offset] * radius,
      baseSpherePoints[offset + 1] * radius,
      baseSpherePoints[offset + 2] * radius,
    );
    noStroke();
    if (i === selectedFiber) {
      fill(ACID.r, ACID.g, ACID.b, 250 * visibility);
      sphere(7.5, 7, 5);
    } else {
      fill(CYAN.r, CYAN.g, CYAN.b, 145 * visibility);
      sphere(3, 5, 4);
    }
    pop();
  }

  // The selected index may be odd and therefore absent from the half-density set.
  if (selectedFiber % 2 !== 0) {
    const offset = selectedFiber * 3;
    push();
    translate(
      baseSpherePoints[offset] * radius,
      baseSpherePoints[offset + 1] * radius,
      baseSpherePoints[offset + 2] * radius,
    );
    noStroke();
    fill(ACID.r, ACID.g, ACID.b, 250 * visibility);
    sphere(7.5, 7, 5);
    pop();
  }
}

function drawMapConnector(visibility) {
  const offset = selectedFiber * 3;
  const radius = CONFIG.baseSphereRadius;
  const px = baseSpherePoints[offset] * radius;
  const py = baseSpherePoints[offset + 1] * radius;
  const pz = baseSpherePoints[offset + 2] * radius;
  stroke(ACID.r, ACID.g, ACID.b, 70 * visibility);
  strokeWeight(1);
  line(px, py, pz, -CONFIG.baseSphereX, -CONFIG.baseSphereY, 0);
}

// ============================================================
// 13. ATMOSPHERE AND COMPACT SIMULATOR INTERFACE
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

function renderCentralGlow() {
  blendMode(ADD);
  noStroke();
  const breathe = 1 + 0.045 * Math.sin(loopState.phase);
  push();
  scale(breathe);
  fill(CYAN.r, CYAN.g, CYAN.b, 4);
  sphere(96, 16, 10);
  fill(MAGENTA.r, MAGENTA.g, MAGENTA.b, 3);
  sphere(58, 14, 9);
  pop();
  blendMode(BLEND);
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
  context.fillText("HOPF FIBRATION", 72, 72);
  context.font = `18px ${mono}`;
  context.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.84)`;
  context.fillText("S³ → S²", 72, 112);

  context.textAlign = "right";
  context.font = `16px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.48)";
  context.fillText(`FIBERS  ${CONFIG.fiberCount}`, W - 72, 72);
  context.fillText(`MODE  ${MODE_NAMES[loopState.activeMode]}`, W - 72, 100);
  context.fillText(`λ  ${loopState.lambda.toFixed(3)}`, W - 72, 128);

  context.strokeStyle = "rgba(255,255,255,.12)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(72, 154);
  context.lineTo(W - 72, 154);
  context.moveTo(72, H - 126);
  context.lineTo(W - 72, H - 126);
  context.stroke();

  context.textAlign = "center";
  context.font = `17px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.5)";
  context.fillText(
    "(X,Y,Z) = (x₁,x₂,x₃) / (1 − λx₄)",
    W / 2,
    H - 96,
  );
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
// 14. LOOP-SAFE CAMERA
// ============================================================
function applyLoopingCamera() {
  const pairInspectionAngle =
    CONFIG.cameraStartAngle + TAU * 0.41 + Math.sin(loopState.phase) * 0.18;
  const angle =
    (!autoMode && manualMode === MODES.LINKED_PAIR
      ? pairInspectionAngle
      : loopState.cameraAngle) + userYaw;
  const radius = loopState.cameraRadius + userZoomOffset;
  const height = loopState.cameraHeight + userPitch * 420;
  const cx = Math.sin(angle) * radius;
  const cz = Math.cos(angle) * radius;
  camera(cx, height, cz, 0, 0, 0, 0, 1, 0);
}

// ============================================================
// 15. AUTOMATIC REEL TIMELINE
// ============================================================
function modeEnvelope(startIn, endIn, startOut, endOut, t) {
  return smoothStep(startIn, endIn, t) * (1 - smoothStep(startOut, endOut, t));
}

function updateAutomaticTimeline(frameIndex) {
  loopState.loopT =
    (((frameIndex % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  loopState.phase = loopState.loopT * TAU;
  modeMixes.fill(0);

  if (autoMode) {
    modeMixes[MODES.SINGLE_FIBER] = modeEnvelope(0.08, 0.12, 0.25, 0.3, loopState.loopT);
    modeMixes[MODES.LINKED_PAIR] = modeEnvelope(0.27, 0.32, 0.5, 0.56, loopState.loopT);
    modeMixes[MODES.HOPF_MAP] = modeEnvelope(0.52, 0.57, 0.74, 0.8, loopState.loopT);
    modeMixes[MODES.PROJECTION] = modeEnvelope(0.76, 0.82, 0.93, 0.98, loopState.loopT);
    const maxFocus = Math.max(
      modeMixes[MODES.SINGLE_FIBER],
      modeMixes[MODES.LINKED_PAIR],
      modeMixes[MODES.HOPF_MAP],
      modeMixes[MODES.PROJECTION],
    );
    modeMixes[MODES.FULL_FIBRATION] = 1 - maxFocus;
  } else {
    modeMixes[manualMode] = 1;
  }

  let activeMode = MODES.FULL_FIBRATION;
  for (let i = 1; i < modeMixes.length; i++) {
    if (modeMixes[i] > modeMixes[activeMode]) activeMode = i;
  }
  loopState.activeMode = activeMode;

  const projectionMix = modeMixes[MODES.PROJECTION];
  loopState.lambda = autoMode
    ? CONFIG.projectionBase +
      CONFIG.projectionAmplitude *
        Math.sin(loopState.phase) *
        (0.25 + projectionMix * 0.75)
    : manualLambda;
  loopState.lambda = clamp(
    loopState.lambda,
    CONFIG.projectionMin,
    CONFIG.projectionMax,
  );

  loopState.cameraAngle = CONFIG.cameraStartAngle + loopState.phase;
  loopState.cameraRadius =
    CONFIG.cameraRadius +
    Math.sin(loopState.phase * 2) * CONFIG.cameraRadiusVariation;
  loopState.cameraHeight =
    CONFIG.cameraHeight +
    Math.sin(loopState.phase) * CONFIG.cameraHeightVariation;
  const viewInv = 1 / Math.max(1, Math.hypot(loopState.cameraRadius, loopState.cameraHeight));
  loopState.viewX = Math.sin(loopState.cameraAngle) * loopState.cameraRadius * viewInv;
  loopState.viewY = loopState.cameraHeight * viewInv;
  loopState.viewZ = Math.cos(loopState.cameraAngle) * loopState.cameraRadius * viewInv;
}

// ============================================================
// 16. SETUP AND MAIN RENDER LOOP
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
  initializeSimulator();
  createInterfaceLayers();
  bindControls();
}

function renderScene() {
  applyLoopingCamera();
  updateFiberBuffers();
  ambientLight(18, 18, 24);
  pointLight(CYAN.r, CYAN.g, CYAN.b, -300, -380, 500);
  pointLight(MAGENTA.r, MAGENTA.g, MAGENTA.b, 360, 180, -320);

  push();
  rotateX(-0.16);
  renderCentralGlow();
  renderFullFibration();
  prepareSelectedLayer();
  renderSingleFiber();
  renderLinkedPair();
  renderHopfMapMode();
  renderProjectionMode();
  renderTravellingParticles();
  drawingContext.depthFunc(drawingContext.LESS);
  pop();

  renderBaseSphere();
  renderSimulatorInterface();
}

function draw() {
  const sourceFrame = isRecording ? recFrameCount : frameCount - 1;
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
// 17. INTERACTION CONTROLS
// ============================================================
function bindControls() {
  document.getElementById("startBtn").addEventListener("click", startRecording);
  document.getElementById("stopBtn").addEventListener("click", stopRecording);
  document
    .getElementById("pngBtn")
    .addEventListener("click", () =>
      saveCanvas("hopf_fibration_" + ts(), "png"),
    );
}

function setManualMode(mode) {
  manualMode = mode;
  autoMode = false;
}

function resetCamera() {
  userYaw = 0;
  userPitch = 0;
  userZoomOffset = 0;
}

function resetSimulation(useAutomatic = true) {
  resetCamera();
  selectedFiber = CONFIG.selectedFiber;
  manualLambda = CONFIG.projectionBase;
  autoMode = useAutomatic;
  manualMode = MODES.FULL_FIBRATION;
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
  if (key >= "1" && key <= "5") {
    setManualMode(Number(key) - 1);
    return false;
  }
  if (keyCode === LEFT_ARROW || keyCode === RIGHT_ARROW) {
    const direction = keyCode === RIGHT_ARROW ? 1 : -1;
    selectedFiber =
      (selectedFiber + direction + CONFIG.fiberCount) % CONFIG.fiberCount;
    return false;
  }
  if (keyCode === UP_ARROW || keyCode === DOWN_ARROW) {
    autoMode = false;
    manualMode = MODES.PROJECTION;
    manualLambda = clamp(
      manualLambda + (keyCode === UP_ARROW ? 0.01 : -0.01),
      CONFIG.projectionMin,
      CONFIG.projectionMax,
    );
    return false;
  }
  if (key === " ") {
    paused = !paused;
    return false;
  }
  if (key === "r" || key === "R") {
    resetSimulation(true);
    return false;
  }
  if (key === "h" || key === "H") {
    showInterface = !showInterface;
    return false;
  }
  if (key === "p" || key === "P") {
    saveCanvas("hopf_fibration_" + ts(), "png");
    return false;
  }
  if (key === "c" || key === "C" || key === "e" || key === "E") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  return true;
}

// ============================================================
// 18. EXISTING WEBCodecs + MP4-MUXER CAPTURE/EXPORT WORKFLOW
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
  resetSimulation(true);
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
  frozenFrame = 0;
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
  anchor.download = "hopf_fibration_" + ts() + ".mp4";
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
  document.getElementById("duration").textContent = (
    recFrameCount / FPS
  ).toFixed(1);
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
// 19. UTILITIES
// ============================================================
function smoothStep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function fract(value) {
  return value - Math.floor(value);
}

function ts() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.ts = ts;

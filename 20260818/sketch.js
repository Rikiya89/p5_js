"use strict";

// Existing project framework: retained exactly.
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;

const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const CONFIG = {
  surfaceUSegments: 72,
  surfaceVSegments: 40,
  sphereRadius: 300,
  sphereDeformation: 0.10,
  torusMajorRadius: 250,
  torusMinorRadius: 113,
  curvatureDisplacement: 18,
  curvatureLineLength: 54,
  curvatureGlow: 6.2,
  scanWidth: 0.075,
  markerStrideU: 6,
  markerStrideV: 4,
  cameraDistance: 1510,
  cameraOrbitAmount: 105,
};

const SURFACES = {
  SPHERE: { label: "SPHERE", chi: 2, theorem: 4 * Math.PI, result: "4π", sign: "K > 0 EVERYWHERE" },
  TORUS: { label: "TORUS", chi: 0, theorem: 0, result: "0", sign: "K > 0 OUTSIDE  ·  K < 0 INSIDE" },
};

const pointCount = CONFIG.surfaceUSegments * CONFIG.surfaceVSegments;
const surface = {
  positions: new Float32Array(pointCount * 3),
  normals: new Float32Array(pointCount * 3),
  curvature: new Float32Array(pointCount),
  area: new Float32Array(pointCount),
  integral: 0,
  revealedIntegral: 0,
  maxAbsK: 1,
};

let canvasEl = null;
let grainPg = null;
let hudPg = null;
let loopProgress = 0;
let phase = 0;
let activeType = "sphere";
let topologyScale = 1;
let deformationAmount = 0;
let scanProgress = 0;
let singularAmount = 0;

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
  bakeGrain();

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
  randomSeed(20260812);
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

function cyclicDistance(a, b) {
  const direct = Math.abs(a - b);
  return Math.min(direct, 1 - direct);
}

function updateLoopTime() {
  const frame = isRecording ? recFrameCount : frameCount - 1;
  loopProgress = (((frame % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  phase = loopProgress * TAU;
  updateTopologyTimeline();
}

function updateTopologyTimeline() {
  const t = loopProgress;
  activeType = "sphere";
  topologyScale = 1;
  deformationAmount = 0;
  singularAmount = 0;

  if (t < 0.34) {
    activeType = "sphere";
    deformationAmount = CONFIG.sphereDeformation * Math.sin((t / 0.34) * Math.PI);
    scanProgress = smooth01(t / 0.34);
  } else if (t < 0.42) {
    const q = smooth01((t - 0.34) / 0.08);
    activeType = "sphere";
    topologyScale = 1 - 0.91 * q;
    singularAmount = Math.sin(q * Math.PI * 0.5);
    scanProgress = 1;
  } else if (t < 0.50) {
    const q = smooth01((t - 0.42) / 0.08);
    activeType = "torus";
    topologyScale = 0.09 + 0.91 * q;
    singularAmount = Math.cos(q * Math.PI * 0.5);
    scanProgress = 0;
  } else if (t < 0.88) {
    activeType = "torus";
    scanProgress = smooth01((t - 0.50) / 0.38);
  } else if (t < 0.94) {
    const q = smooth01((t - 0.88) / 0.06);
    activeType = "torus";
    topologyScale = 1 - 0.91 * q;
    singularAmount = Math.sin(q * Math.PI * 0.5);
    scanProgress = 1;
  } else {
    const q = smooth01((t - 0.94) / 0.06);
    activeType = "sphere";
    topologyScale = 0.09 + 0.91 * q;
    singularAmount = Math.cos(q * Math.PI * 0.5);
    scanProgress = 0;
  }
}

function draw() {
  updateLoopTime();
  updateSurface();
  renderFrame();
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function surfaceIndex(i, j) {
  const wrappedI = (i + CONFIG.surfaceUSegments) % CONFIG.surfaceUSegments;
  const boundedJ = activeType === "torus"
    ? (j + CONFIG.surfaceVSegments) % CONFIG.surfaceVSegments
    : clamp(j, 0, CONFIG.surfaceVSegments - 1);
  return wrappedI * CONFIG.surfaceVSegments + boundedJ;
}

function positionComponent(i, j, component) {
  return surface.positions[surfaceIndex(i, j) * 3 + component];
}

function setPosition(index, x, y, z) {
  const offset = index * 3;
  surface.positions[offset] = x;
  surface.positions[offset + 1] = y;
  surface.positions[offset + 2] = z;
}

function writeSpherePosition(index, u, latitude) {
  const sl = Math.sin(latitude);
  const cl = Math.cos(latitude);
  const deformationField =
    0.52 * Math.sin(3 * u + phase) * Math.sin(2 * latitude) +
    0.30 * Math.cos(5 * u - phase) * sl * sl +
    0.18 * Math.sin(4 * latitude + phase * 2);
  const radius = CONFIG.sphereRadius * (1 + deformationAmount * deformationField);
  setPosition(index, radius * sl * Math.cos(u), radius * cl, radius * sl * Math.sin(u));
}

function writeTorusPosition(index, u, v) {
  const minor = CONFIG.torusMinorRadius;
  const ring = CONFIG.torusMajorRadius + minor * Math.cos(v);
  setPosition(index, ring * Math.cos(u), minor * Math.sin(v), ring * Math.sin(u));
}

function updateSurface() {
  const du = TAU / CONFIG.surfaceUSegments;
  const sphereLatitudeSpan = Math.PI - 0.07;
  const dv = activeType === "torus" ? TAU / CONFIG.surfaceVSegments : sphereLatitudeSpan / (CONFIG.surfaceVSegments - 1);

  for (let i = 0; i < CONFIG.surfaceUSegments; i++) {
    for (let j = 0; j < CONFIG.surfaceVSegments; j++) {
      const u = i * du;
      const v = activeType === "torus" ? j * dv : 0.035 + j * dv;
      const idx = surfaceIndex(i, j);
      if (activeType === "torus") writeTorusPosition(idx, u, v);
      else writeSpherePosition(idx, u, v);
    }
  }

  if (activeType === "torus") calculateTorusCurvature(du, dv);
  else calculateDifferentialCurvature(du, dv);
  calculateRevealedIntegral();
}

function calculateTorusCurvature(du, dv) {
  let integral = 0;
  let maxAbsK = 1e-9;
  const major = CONFIG.torusMajorRadius;
  const minor = CONFIG.torusMinorRadius;
  for (let i = 0; i < CONFIG.surfaceUSegments; i++) {
    const u = i * du;
    for (let j = 0; j < CONFIG.surfaceVSegments; j++) {
      const v = j * dv;
      const idx = surfaceIndex(i, j);
      const offset = idx * 3;
      const cv = Math.cos(v), sv = Math.sin(v);
      surface.normals[offset] = cv * Math.cos(u);
      surface.normals[offset + 1] = sv;
      surface.normals[offset + 2] = cv * Math.sin(u);
      const K = cv / (minor * (major + minor * cv));
      const area = minor * (major + minor * cv) * du * dv;
      surface.curvature[idx] = K;
      surface.area[idx] = area;
      integral += K * area;
      maxAbsK = Math.max(maxAbsK, Math.abs(K));
    }
  }
  surface.integral = integral;
  surface.maxAbsK = maxAbsK;
}

function calculateDifferentialCurvature(du, dv) {
  let integral = 0;
  let maxAbsK = 1e-9;
  const ru = [0, 0, 0], rv = [0, 0, 0], ruu = [0, 0, 0], rvv = [0, 0, 0], ruv = [0, 0, 0];
  for (let i = 0; i < CONFIG.surfaceUSegments; i++) {
    for (let j = 0; j < CONFIG.surfaceVSegments; j++) {
      const idx = surfaceIndex(i, j);
      const offset = idx * 3;
      if (j === 0 || j === CONFIG.surfaceVSegments - 1) {
        surface.curvature[idx] = 0;
        surface.area[idx] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) {
        const center = positionComponent(i, j, c);
        ru[c] = (positionComponent(i + 1, j, c) - positionComponent(i - 1, j, c)) / (2 * du);
        rv[c] = (positionComponent(i, j + 1, c) - positionComponent(i, j - 1, c)) / (2 * dv);
        ruu[c] = (positionComponent(i + 1, j, c) - 2 * center + positionComponent(i - 1, j, c)) / (du * du);
        rvv[c] = (positionComponent(i, j + 1, c) - 2 * center + positionComponent(i, j - 1, c)) / (dv * dv);
        ruv[c] = (positionComponent(i + 1, j + 1, c) - positionComponent(i + 1, j - 1, c) - positionComponent(i - 1, j + 1, c) + positionComponent(i - 1, j - 1, c)) / (4 * du * dv);
      }
      const nx = ru[1] * rv[2] - ru[2] * rv[1];
      const ny = ru[2] * rv[0] - ru[0] * rv[2];
      const nz = ru[0] * rv[1] - ru[1] * rv[0];
      const areaDensity = Math.hypot(nx, ny, nz);
      const invNormal = 1 / Math.max(1e-9, areaDensity);
      const ux = nx * invNormal, uy = ny * invNormal, uz = nz * invNormal;
      const E = dot3(ru, ru), F = dot3(ru, rv), G = dot3(rv, rv);
      const L = ruu[0] * ux + ruu[1] * uy + ruu[2] * uz;
      const M = ruv[0] * ux + ruv[1] * uy + ruv[2] * uz;
      const N = rvv[0] * ux + rvv[1] * uy + rvv[2] * uz;
      const denominator = E * G - F * F;
      const K = Math.abs(denominator) > 1e-8 ? (L * N - M * M) / denominator : 0;
      surface.normals[offset] = ux;
      surface.normals[offset + 1] = uy;
      surface.normals[offset + 2] = uz;
      surface.curvature[idx] = K;
      surface.area[idx] = areaDensity * du * dv;
      integral += K * surface.area[idx];
      maxAbsK = Math.max(maxAbsK, Math.abs(K));
    }
  }
  surface.integral = integral;
  surface.maxAbsK = maxAbsK;
}

function calculateRevealedIntegral() {
  let total = 0;
  const revealedRows = Math.floor(scanProgress * CONFIG.surfaceVSegments);
  for (let i = 0; i < CONFIG.surfaceUSegments; i++) {
    for (let j = 0; j < revealedRows; j++) {
      const idx = surfaceIndex(i, j);
      total += surface.curvature[idx] * surface.area[idx];
    }
  }
  surface.revealedIntegral = total;
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function renderFrame() {
  background(BG_R, BG_G, BG_B);
  perspective(PI / 3.35, W / H, 10, 5000);
  setupCamera();
  drawEnvironment();
  push();
  translate(0, 38, 0);
  rotateX(activeType === "torus" ? -0.30 : -0.12);
  rotateY(-0.22 + 0.11 * Math.sin(phase));
  scale(topologyScale);
  drawSurfaceBase();
  drawCurvatureWireframe();
  drawCurvatureSamples();
  pop();
  drawSingularEvent();
  drawScreenFinish();
}

function setupCamera() {
  const eyeX = CONFIG.cameraOrbitAmount * Math.sin(phase);
  const eyeY = -44 + 34 * Math.sin(phase * 2);
  const eyeZ = CONFIG.cameraDistance + 30 * (1 - Math.cos(phase));
  camera(eyeX, eyeY, eyeZ, 0, 10, 0, 0, 1, 0);
}

function drawEnvironment() {
  noFill();
  strokeWeight(0.55);
  for (let i = -2; i <= 2; i++) {
    const drift = 14 * Math.sin(phase + i * 1.7);
    stroke(INK_R, INK_G, INK_B, 5 + (i === 0 ? 4 : 0));
    beginShape();
    for (let j = 0; j <= 64; j++) {
      const u = j / 64;
      vertex(-520 + u * 1040, i * 245 + drift + 13 * Math.sin(u * TAU + phase), -220 - i * 26);
    }
    endShape();
  }
}

function curvatureStrength(K) {
  return clamp(Math.abs(K) / Math.max(1e-9, surface.maxAbsK), 0, 1);
}

function signedAlpha(K, baseAlpha) {
  const strength = Math.pow(curvatureStrength(K), 0.48);
  return K < 0 ? baseAlpha * (0.30 + 0.34 * strength) : baseAlpha * (0.55 + 0.45 * strength);
}

function emitDisplacedVertex(index, amount) {
  const offset = index * 3;
  const signed = surface.curvature[index] < 0 ? -1 : 1;
  const displacement = signed * CONFIG.curvatureDisplacement * curvatureStrength(surface.curvature[index]) * amount;
  vertex(
    surface.positions[offset] + surface.normals[offset] * displacement,
    surface.positions[offset + 1] + surface.normals[offset + 1] * displacement,
    surface.positions[offset + 2] + surface.normals[offset + 2] * displacement,
  );
}

function drawSurfaceBase() {
  noStroke();
  fill(INK_R, INK_G, INK_B, 8);
  for (let i = 0; i < CONFIG.surfaceUSegments; i += 2) {
    beginShape(TRIANGLE_STRIP);
    for (let j = 0; j <= CONFIG.surfaceVSegments; j += 2) {
      const jj = activeType === "torus" ? j % CONFIG.surfaceVSegments : Math.min(j, CONFIG.surfaceVSegments - 1);
      for (const ii of [i, i + 2]) {
        const idx = surfaceIndex(ii, jj);
        const offset = idx * 3;
        vertex(surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2]);
      }
    }
    endShape();
  }
}

function drawCurvatureWireframe() {
  for (let pass = 0; pass < 2; pass++) {
    blendMode(pass === 0 ? ADD : BLEND);
    strokeWeight(pass === 0 ? CONFIG.curvatureGlow : 1.05);
    const baseAlpha = pass === 0 ? 15 : 168;
    for (let i = 0; i < CONFIG.surfaceUSegments; i += 2) {
      noFill();
      beginShape();
      for (let j = 0; j < CONFIG.surfaceVSegments; j++) {
        const idx = surfaceIndex(i, j);
        const row = j / CONFIG.surfaceVSegments;
        const scan = Math.exp(-Math.pow(cyclicDistance(row, scanProgress) / CONFIG.scanWidth, 2));
        stroke(INK_R, INK_G, INK_B, signedAlpha(surface.curvature[idx], baseAlpha + scan * 72));
        emitDisplacedVertex(idx, scan);
      }
      if (activeType === "torus") {
        const idx = surfaceIndex(i, 0);
        emitDisplacedVertex(idx, 0);
      }
      endShape();
    }
    for (let j = 0; j < CONFIG.surfaceVSegments; j += 2) {
      noFill();
      beginShape();
      for (let i = 0; i <= CONFIG.surfaceUSegments; i++) {
        const idx = surfaceIndex(i, j);
        const row = j / CONFIG.surfaceVSegments;
        const scan = Math.exp(-Math.pow(cyclicDistance(row, scanProgress) / CONFIG.scanWidth, 2));
        stroke(INK_R, INK_G, INK_B, signedAlpha(surface.curvature[idx], baseAlpha * 0.74 + scan * 62));
        emitDisplacedVertex(idx, scan);
      }
      endShape();
    }
  }
  blendMode(BLEND);
}

function drawCurvatureSamples() {
  blendMode(ADD);
  for (let i = 0; i < CONFIG.surfaceUSegments; i += CONFIG.markerStrideU) {
    for (let j = 1; j < CONFIG.surfaceVSegments - 1; j += CONFIG.markerStrideV) {
      const idx = surfaceIndex(i, j);
      const offset = idx * 3;
      const K = surface.curvature[idx];
      const row = j / CONFIG.surfaceVSegments;
      const scan = Math.exp(-Math.pow(cyclicDistance(row, scanProgress) / (CONFIG.scanWidth * 1.25), 2));
      const sign = K < 0 ? -1 : 1;
      const length = CONFIG.curvatureLineLength * (0.25 + 0.75 * curvatureStrength(K)) * (0.38 + 0.62 * scan);
      stroke(INK_R, INK_G, INK_B, signedAlpha(K, 64 + 165 * scan));
      strokeWeight(K < 0 ? 1.0 : 1.8);
      line(
        surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2],
        surface.positions[offset] + surface.normals[offset] * length * sign,
        surface.positions[offset + 1] + surface.normals[offset + 1] * length * sign,
        surface.positions[offset + 2] + surface.normals[offset + 2] * length * sign,
      );
      if (scan > 0.48) {
        strokeWeight(2.4 + 2.8 * scan);
        point(
          surface.positions[offset] + surface.normals[offset] * length * sign,
          surface.positions[offset + 1] + surface.normals[offset + 1] * length * sign,
          surface.positions[offset + 2] + surface.normals[offset + 2] * length * sign,
        );
      }
    }
  }
  blendMode(BLEND);
}

function drawSingularEvent() {
  if (singularAmount < 0.01) return;
  push();
  noFill();
  blendMode(ADD);
  rotateX(PI * 0.5);
  for (let ring = 0; ring < 4; ring++) {
    const radius = 36 + ring * 28 + singularAmount * 350;
    stroke(INK_R, INK_G, INK_B, (70 - ring * 12) * singularAmount);
    strokeWeight(1.4 + (3 - ring) * 0.5);
    circle(0, 0, radius * 2);
  }
  blendMode(BLEND);
  pop();
}

function activeSurfaceInfo() {
  return activeType === "torus" ? SURFACES.TORUS : SURFACES.SPHERE;
}

function numericalIntegralText() {
  if (singularAmount > 0.56) return "MESH INTEGRAL  UNDEFINED AT SINGULAR EVENT";
  return "MESH INTEGRAL  " + surface.integral.toFixed(3) + "     SCANNED  " + surface.revealedIntegral.toFixed(3);
}

function drawScreenFinish() {
  const g = hudPg;
  const info = activeSurfaceInfo();
  g.clear();
  g.image(grainPg, 0, 0);
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, 38);
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
  g.fill(INK_R, INK_G, INK_B, 246);
  g.textSize(50);
  g.text("CURVATURE KEEPS THE SCORE.", W * 0.5, 250);
  g.textStyle(NORMAL);
  g.fill(INK_R, INK_G, INK_B, 148);
  g.textSize(29);
  g.text("GAUSS–BONNET     ·     LOCAL → GLOBAL", W * 0.5, 309);

  g.textAlign(LEFT, TOP);
  g.fill(INK_R, INK_G, INK_B, 132);
  g.textSize(19);
  g.text("SURFACE     " + info.label, 70, 390);
  g.text("LOCAL K     " + info.sign, 70, 425);
  g.text("SCAN        Σ Kᵢ ΔAᵢ", 70, 460);
  g.textAlign(RIGHT, TOP);
  g.text("EULER       χ = " + info.chi, W - 70, 390);
  g.text("THEOREM     ∫ K dA = 2πχ", W - 70, 425);
  g.text("LOOP        " + MAX_DURATION + "s · DETERMINISTIC", W - 70, 460);

  const reveal = smooth01(scanProgress);
  g.textAlign(CENTER, CENTER);
  g.fill(INK_R, INK_G, INK_B, singularAmount > 0.25 ? 236 : 72 + 164 * reveal);
  g.textSize(18);
  g.text(singularAmount > 0.25 ? "SINGULAR EVENT · TOPOLOGY CHANGE" : "∫ K dA = 2πχ(M) = " + info.result, W * 0.5, 1450);
  g.textSize(15);
  g.fill(INK_R, INK_G, INK_B, 50 + 110 * Math.max(reveal, singularAmount));
  g.text(singularAmount > 0.25 ? "NO SMOOTH SPHERE → TORUS DEFORMATION" : numericalIntegralText(), W * 0.5, 1480);

  const trackLeft = 170, trackRight = W - 170, trackY = 1542;
  g.stroke(INK_R, INK_G, INK_B, 42);
  g.strokeWeight(1);
  g.line(trackLeft, trackY, trackRight, trackY);
  g.stroke(INK_R, INK_G, INK_B, 166);
  g.line(trackLeft, trackY, lerp(trackLeft, trackRight, scanProgress), trackY);
  g.noStroke();
  g.fill(INK_R, INK_G, INK_B, 190);
  g.circle(lerp(trackLeft, trackRight, scanProgress), trackY, 6);

  g.fill(INK_R, INK_G, INK_B, 42);
  g.textSize(16);
  g.textAlign(LEFT, BOTTOM);
  g.text(W + "×" + H + " · " + FPS + "fps", 52, H - 52);
  g.textAlign(RIGHT, BOTTOM);
  g.text("20260818 · LOOP " + loopProgress.toFixed(3), W - 52, H - 52);

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
    saveCanvas("gauss_bonnet_" + getTimestamp(), "png");
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
  a.download = "gauss_bonnet_" + getTimestamp() + ".mp4";
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

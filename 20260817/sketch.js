"use strict";

// GAUSS–BONNET / existing Reel and capture baseline
const W = 1080, H = 1920, FPS = 60, MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION, LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK = { r: 255, g: 255, b: 255 };
const CYAN = { r: 0, g: 229, b: 255 };
const MAGENTA = { r: 255, g: 61, b: 191 };
const ACID = { r: 182, g: 255, b: 61 };

const CONFIG = {
  uSegments: 72,
  vSegments: 38,
  sphereRadius: 405,
  torusMajorRadius: 315,
  torusMinorRadius: 142,
  surfaceLineWeight: 1.15,
  glowLineWeight: 5.2,
  markerStrideU: 6,
  markerStrideV: 4,
  markerLength: 34,
  cameraRadius: 1510,
  cameraHeight: -95,
  showInterface: true,
};

const SURFACES = [
  { label: "SPHERE", genus: 0, chi: 2, total: "4π" },
  { label: "DISTORTED SPHERE", genus: 0, chi: 2, total: "4π" },
  { label: "TORUS", genus: 1, chi: 0, total: "0" },
  { label: "DOUBLE TORUS", genus: 2, chi: -2, total: "−4π" },
];

let canvasEl, hudPg, vignettePg;
let muxer = null, encoder = null, isRecording = false;
let recFrameCount = 0, recordingStartFrame = 0;
let paused = false, frozenFrame = 0, forcedSurface = -1;
let isDragging = false, lastMouseX = 0, lastMouseY = 0;
let userYaw = 0, userPitch = 0, userZoomOffset = 0;
let showInterface = CONFIG.showInterface;

const loopState = {
  loopT: 0, phase: 0, cameraAngle: -0.46,
  cameraRadius: CONFIG.cameraRadius, cameraHeight: CONFIG.cameraHeight,
  primary: 0, secondary: -1, mix: 0, deformation: 0,
};

const pointCount = CONFIG.uSegments * CONFIG.vSegments;
const paramSurface = {
  positions: new Float32Array(pointCount * 3),
  normals: new Float32Array(pointCount * 3),
  curvature: new Float32Array(pointCount),
  area: new Float32Array(pointCount),
  integral: 0,
  maxAbsK: 1,
};
const genus2Surface = { triangles: [], maxAbsK: 1e-9 };

// Deterministic 10-second topology sequence. Crossfades also close the loop.
function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function setTransition(from, to, start, end, t) {
  loopState.primary = from;
  loopState.secondary = to;
  loopState.mix = smooth01((t - start) / (end - start));
}

function updateAutomaticTimeline(frameIndex) {
  const t = (((frameIndex % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  loopState.loopT = t;
  loopState.phase = t * TAU;
  loopState.primary = 0;
  loopState.secondary = -1;
  loopState.mix = 0;
  loopState.deformation = 0;

  if (forcedSurface >= 0 && !isRecording) {
    loopState.primary = forcedSurface;
    loopState.deformation = forcedSurface === 1 ? 1 : 0;
  } else if (t < 0.18) {
    loopState.deformation = smooth01(t / 0.18);
    loopState.primary = loopState.deformation > 0.52 ? 1 : 0;
  } else if (t < 0.27) {
    loopState.primary = 1;
    loopState.deformation = 1;
  } else if (t < 0.35) {
    setTransition(1, 2, 0.27, 0.35, t);
    loopState.deformation = 1;
  } else if (t < 0.58) {
    loopState.primary = 2;
  } else if (t < 0.66) {
    setTransition(2, 3, 0.58, 0.66, t);
  } else if (t < 0.84) {
    loopState.primary = 3;
  } else {
    setTransition(3, 0, 0.84, 1, t);
  }

  loopState.cameraAngle = -0.46 + 0.23 * Math.sin(loopState.phase);
  loopState.cameraRadius = CONFIG.cameraRadius + 36 * Math.sin(loopState.phase * 2);
  loopState.cameraHeight = CONFIG.cameraHeight + 52 * Math.sin(loopState.phase);
}

// Parametric sphere/torus mesh and differential Gaussian curvature.
function paramIndex(i, j) {
  const u = (i + CONFIG.uSegments) % CONFIG.uSegments;
  return u * CONFIG.vSegments + clamp(j, 0, CONFIG.vSegments - 1);
}

function positionAt(i, j, c) {
  return paramSurface.positions[paramIndex(i, j) * 3 + c];
}

function writePosition(index, x, y, z) {
  const o = index * 3;
  paramSurface.positions[o] = x;
  paramSurface.positions[o + 1] = y;
  paramSurface.positions[o + 2] = z;
}

function evaluateSphere(u, v, deformation, phase) {
  const latitude = 0.035 + v * (Math.PI - 0.07);
  const sl = Math.sin(latitude), cl = Math.cos(latitude);
  const wave =
    0.56 * Math.sin(3 * u + phase) * Math.sin(2 * latitude) +
    0.28 * Math.cos(5 * u - phase) * sl * sl +
    0.16 * Math.sin(4 * latitude + phase * 2);
  const radius = CONFIG.sphereRadius * (1 + deformation * 0.24 * wave);
  return [radius * sl * Math.cos(u), radius * cl, radius * sl * Math.sin(u)];
}

function evaluateTorus(u, v, phase) {
  const ripple = 1 + 0.035 * Math.sin(3 * u + phase) * Math.cos(2 * v);
  const minor = CONFIG.torusMinorRadius * ripple;
  const ring = CONFIG.torusMajorRadius + minor * Math.cos(v);
  return [ring * Math.cos(u), minor * Math.sin(v), ring * Math.sin(u)];
}

function updateParametricSurface(surfaceIndex) {
  const isTorus = surfaceIndex === 2;
  const deformation = surfaceIndex === 1 ? Math.max(0.02, loopState.deformation) : loopState.deformation;
  const du = TAU / CONFIG.uSegments;
  const dv = isTorus ? TAU / CONFIG.vSegments : (Math.PI - 0.07) / (CONFIG.vSegments - 1);
  for (let i = 0; i < CONFIG.uSegments; i++) {
    for (let j = 0; j < CONFIG.vSegments; j++) {
      const p = isTorus
        ? evaluateTorus(i * du, j * dv, loopState.phase)
        : evaluateSphere(i * du, j / (CONFIG.vSegments - 1), deformation, loopState.phase);
      writePosition(paramIndex(i, j), p[0], p[1], p[2]);
    }
  }
  calculateParametricCurvature(isTorus, du, dv);
}

function calculateParametricCurvature(periodicV, du, dv) {
  let integral = 0, maxAbsK = 1e-9;
  for (let i = 0; i < CONFIG.uSegments; i++) {
    for (let j = 0; j < CONFIG.vSegments; j++) {
      const idx = paramIndex(i, j);
      if (!periodicV && (j === 0 || j === CONFIG.vSegments - 1)) {
        paramSurface.curvature[idx] = 0;
        continue;
      }
      const jm = periodicV ? (j - 1 + CONFIG.vSegments) % CONFIG.vSegments : j - 1;
      const jp = periodicV ? (j + 1) % CONFIG.vSegments : j + 1;
      const p = [positionAt(i, j, 0), positionAt(i, j, 1), positionAt(i, j, 2)];
      const ru = [0, 0, 0], rv = [0, 0, 0], ruu = [0, 0, 0], rvv = [0, 0, 0], ruv = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        ru[c] = (positionAt(i + 1, j, c) - positionAt(i - 1, j, c)) / (2 * du);
        rv[c] = (positionAt(i, jp, c) - positionAt(i, jm, c)) / (2 * dv);
        ruu[c] = (positionAt(i + 1, j, c) - 2 * p[c] + positionAt(i - 1, j, c)) / (du * du);
        rvv[c] = (positionAt(i, jp, c) - 2 * p[c] + positionAt(i, jm, c)) / (dv * dv);
        ruv[c] = (positionAt(i + 1, jp, c) - positionAt(i + 1, jm, c) - positionAt(i - 1, jp, c) + positionAt(i - 1, jm, c)) / (4 * du * dv);
      }
      const nx = ru[1] * rv[2] - ru[2] * rv[1];
      const ny = ru[2] * rv[0] - ru[0] * rv[2];
      const nz = ru[0] * rv[1] - ru[1] * rv[0];
      const areaDensity = Math.hypot(nx, ny, nz);
      const invN = 1 / Math.max(1e-9, areaDensity);
      const ux = nx * invN, uy = ny * invN, uz = nz * invN;
      const E = dot3(ru, ru), F = dot3(ru, rv), G = dot3(rv, rv);
      const L = dot3(ruu, [ux, uy, uz]);
      const M = dot3(ruv, [ux, uy, uz]);
      const N = dot3(rvv, [ux, uy, uz]);
      const denominator = E * G - F * F;
      const K = Math.abs(denominator) > 1e-8 ? (L * N - M * M) / denominator : 0;
      const o = idx * 3;
      paramSurface.normals[o] = ux;
      paramSurface.normals[o + 1] = uy;
      paramSurface.normals[o + 2] = uz;
      paramSurface.curvature[idx] = K;
      paramSurface.area[idx] = areaDensity * du * dv;
      maxAbsK = Math.max(maxAbsK, Math.abs(K));
      integral += K * paramSurface.area[idx];
    }
  }
  paramSurface.integral = integral;
  paramSurface.maxAbsK = maxAbsK;
}

// Genus-2 isosurface: smooth union of two overlapping solid tori.
function torusDistance(x, y, z, centerX) {
  const radial = Math.hypot(x - centerX, z) - 175;
  return Math.hypot(radial, y) - 72;
}

function genus2Field(x, y, z) {
  const a = torusDistance(x, y, z, -190);
  const b = torusDistance(x, y, z, 190);
  const k = 24;
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return b * (1 - h) + a * h - k * h * (1 - h);
}

// K for an implicit level set: grad(f)^T adj(H(f)) grad(f) / |grad(f)|^4.
function implicitDifferential(x, y, z) {
  const h = 4, f = genus2Field(x, y, z);
  const xp = genus2Field(x + h, y, z), xm = genus2Field(x - h, y, z);
  const yp = genus2Field(x, y + h, z), ym = genus2Field(x, y - h, z);
  const zp = genus2Field(x, y, z + h), zm = genus2Field(x, y, z - h);
  const gx = (xp - xm) / (2 * h), gy = (yp - ym) / (2 * h), gz = (zp - zm) / (2 * h);
  const g2 = gx * gx + gy * gy + gz * gz;
  const invG = 1 / Math.max(1e-9, Math.sqrt(g2));
  const xx = (xp - 2 * f + xm) / (h * h);
  const yy = (yp - 2 * f + ym) / (h * h);
  const zz = (zp - 2 * f + zm) / (h * h);
  const xy = mixedDerivative(x, y, z, h, h, 0);
  const xz = mixedDerivative(x, y, z, h, 0, h);
  const yz = mixedDerivative(x, y, z, 0, h, h);
  const a00 = yy * zz - yz * yz, a01 = xz * yz - xy * zz;
  const a02 = xy * yz - xz * yy, a11 = xx * zz - xz * xz;
  const a12 = xy * xz - xx * yz, a22 = xx * yy - xy * xy;
  const numerator =
    gx * (a00 * gx + a01 * gy + a02 * gz) +
    gy * (a01 * gx + a11 * gy + a12 * gz) +
    gz * (a02 * gx + a12 * gy + a22 * gz);
  return [gx * invG, gy * invG, gz * invG, numerator / Math.max(1e-9, g2 * g2)];
}

function mixedDerivative(x, y, z, dx, dy, dz) {
  const a = genus2Field(x + dx, y + dy, z + dz);
  const b = genus2Field(x + dx, y - dy, z - dz);
  const c = genus2Field(x - dx, y + dy, z - dz);
  const d = genus2Field(x - dx, y - dy, z + dz);
  const divisor = 4 * Math.max(dx * dy, dx * dz, dy * dz, 1);
  return (a - b - c + d) / divisor;
}

const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const TETS = [
  [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
  [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
];

function interpolateIso(a, b) {
  const t = a.value / (a.value - b.value || 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function polygonizeTet(points) {
  const inside = [], outside = [];
  for (const point of points) (point.value <= 0 ? inside : outside).push(point);
  if (inside.length === 0 || inside.length === 4) return;
  const triangles = [];
  if (inside.length === 1 || inside.length === 3) {
    const source = inside.length === 1 ? inside[0] : outside[0];
    const targets = inside.length === 1 ? outside : inside;
    triangles.push(targets.map((target) => interpolateIso(source, target)));
  } else {
    const a = interpolateIso(inside[0], outside[0]);
    const b = interpolateIso(inside[0], outside[1]);
    const c = interpolateIso(inside[1], outside[0]);
    const d = interpolateIso(inside[1], outside[1]);
    triangles.push([a, b, c], [b, d, c]);
  }
  for (const triangle of triangles) {
    for (const vertex of triangle) {
      const differential = implicitDifferential(vertex.x, vertex.y, vertex.z);
      vertex.nx = differential[0];
      vertex.ny = differential[1];
      vertex.nz = differential[2];
      vertex.k = differential[3];
      genus2Surface.maxAbsK = Math.max(genus2Surface.maxAbsK, Math.abs(vertex.k));
    }
    genus2Surface.triangles.push(triangle);
  }
}

function generateGenus2Surface() {
  const resolution = 25, min = -510, max = 510;
  const step = (max - min) / resolution;
  for (let ix = 0; ix < resolution; ix++) {
    for (let iy = 0; iy < resolution; iy++) {
      for (let iz = 0; iz < resolution; iz++) {
        const corners = CUBE_CORNERS.map(([dx, dy, dz]) => {
          const x = min + (ix + dx) * step;
          const y = min + (iy + dy) * step;
          const z = min + (iz + dz) * step;
          return { x, y, z, value: genus2Field(x, y, z) };
        });
        for (const tet of TETS) polygonizeTet(tet.map((index) => corners[index]));
      }
    }
  }
}

// Existing palette is repurposed as a signed-curvature scale.
function curvatureColor(K, scale, alpha) {
  const normalized = clamp(K / Math.max(1e-9, scale * 0.7), -1, 1);
  const strength = Math.pow(Math.abs(normalized), 0.55);
  const target = normalized < 0 ? MAGENTA : CYAN;
  return [
    INK.r + (target.r - INK.r) * strength,
    INK.g + (target.g - INK.g) * strength,
    INK.b + (target.b - INK.b) * strength,
    alpha * (0.48 + 0.52 * strength),
  ];
}

function drawParametricLines(alpha, glow) {
  noFill();
  strokeWeight(glow ? CONFIG.glowLineWeight : CONFIG.surfaceLineWeight);
  for (let i = 0; i < CONFIG.uSegments; i += 2) {
    beginShape();
    for (let j = 0; j < CONFIG.vSegments; j++) {
      const idx = paramIndex(i, j), o = idx * 3;
      const c = curvatureColor(paramSurface.curvature[idx], paramSurface.maxAbsK, alpha * (glow ? 23 : 209));
      stroke(c[0], c[1], c[2], c[3]);
      vertex(paramSurface.positions[o], paramSurface.positions[o + 1], paramSurface.positions[o + 2]);
    }
    endShape();
  }
  for (let j = 0; j < CONFIG.vSegments; j += 2) {
    beginShape();
    for (let i = 0; i <= CONFIG.uSegments; i++) {
      const idx = paramIndex(i, j), o = idx * 3;
      const c = curvatureColor(paramSurface.curvature[idx], paramSurface.maxAbsK, alpha * (glow ? 20 : 166));
      stroke(c[0], c[1], c[2], c[3]);
      vertex(paramSurface.positions[o], paramSurface.positions[o + 1], paramSurface.positions[o + 2]);
    }
    endShape();
  }
}

function drawParametricMarkers(alpha) {
  blendMode(ADD);
  for (let i = 0; i < CONFIG.uSegments; i += CONFIG.markerStrideU) {
    for (let j = 1; j < CONFIG.vSegments - 1; j += CONFIG.markerStrideV) {
      const idx = paramIndex(i, j), o = idx * 3, K = paramSurface.curvature[idx];
      const c = curvatureColor(K, paramSurface.maxAbsK, alpha * 188);
      const length = CONFIG.markerLength * (0.38 + 0.62 * clamp(Math.abs(K) / paramSurface.maxAbsK, 0, 1));
      stroke(c[0], c[1], c[2], c[3]);
      strokeWeight(2.2);
      line(
        paramSurface.positions[o], paramSurface.positions[o + 1], paramSurface.positions[o + 2],
        paramSurface.positions[o] + paramSurface.normals[o] * length,
        paramSurface.positions[o + 1] + paramSurface.normals[o + 1] * length,
        paramSurface.positions[o + 2] + paramSurface.normals[o + 2] * length,
      );
    }
  }
  blendMode(BLEND);
}

function renderParametricSurface(surfaceIndex, alpha) {
  updateParametricSurface(surfaceIndex);
  blendMode(ADD);
  drawParametricLines(alpha, true);
  blendMode(BLEND);
  drawParametricLines(alpha, false);
  drawParametricMarkers(alpha);
}

function renderGenus2Surface(alpha) {
  noFill();
  for (let pass = 0; pass < 2; pass++) {
    blendMode(pass === 0 ? ADD : BLEND);
    strokeWeight(pass === 0 ? 4.8 : 1.05);
    for (let i = 0; i < genus2Surface.triangles.length; i += 2) {
      const triangle = genus2Surface.triangles[i];
      beginShape();
      for (let j = 0; j <= 3; j++) {
        const p = triangle[j % 3];
        const c = curvatureColor(p.k, genus2Surface.maxAbsK, alpha * (pass === 0 ? 14 : 158));
        stroke(c[0], c[1], c[2], c[3]);
        vertex(p.x, p.y, p.z);
      }
      endShape();
    }
  }
  blendMode(BLEND);
}

function renderSurface(index, alpha) {
  if (alpha <= 0.002) return;
  push();
  rotateX(index === 3 ? 1.18 : -0.16);
  if (index === 3) scale(0.82);
  rotateY(0.08 * Math.sin(loopState.phase));
  if (index === 3) renderGenus2Surface(alpha);
  else renderParametricSurface(index, alpha);
  pop();
}

function applyLoopingCamera() {
  const angle = loopState.cameraAngle + userYaw;
  const radius = loopState.cameraRadius + userZoomOffset;
  const height = loopState.cameraHeight + userPitch * 420;
  camera(Math.sin(angle) * radius, height, Math.cos(angle) * radius, 0, 0, 0, 0, 1, 0);
}

function createInterfaceLayers() {
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  vignettePg = createGraphics(W, H);
  vignettePg.pixelDensity(1);
  const context = vignettePg.drawingContext;
  const gradient = context.createRadialGradient(W / 2, H / 2, 250, W / 2, H / 2, 1040);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.72, "rgba(0,0,0,.04)");
  gradient.addColorStop(1, "rgba(0,0,0,.36)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, W, H);
}

function currentSurfaceIndex() {
  return loopState.mix < 0.5 || loopState.secondary < 0 ? loopState.primary : loopState.secondary;
}

function calculatedIntegralText(index) {
  if (index === 3) return "IMPLICIT FIELD / THEORETICAL TOTAL";
  return Number.isFinite(paramSurface.integral)
    ? `MESH ESTIMATE  ${paramSurface.integral.toFixed(3)}`
    : "MESH ESTIMATE  —";
}

function renderSimulatorInterface() {
  if (!showInterface) return;
  const activeIndex = currentSurfaceIndex(), active = SURFACES[activeIndex];
  hudPg.clear();
  const context = hudPg.drawingContext;
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const top = 162, foot = H - 430;
  context.save();
  context.textBaseline = "top";
  context.textAlign = "left";
  context.font = `26px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.92)";
  context.fillText("GAUSS–BONNET THEOREM", 72, top);
  context.font = `18px ${mono}`;
  context.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.84)`;
  context.fillText("LOCAL CURVATURE / GLOBAL TOPOLOGY", 72, top + 42);
  context.font = `16px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.46)";
  context.fillText("CYAN  K > 0     WHITE  K ≈ 0     MAGENTA  K < 0", 72, top + 82);
  context.strokeStyle = "rgba(255,255,255,.12)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(72, top + 142); context.lineTo(W - 72, top + 142);
  context.moveTo(72, foot); context.lineTo(W - 72, foot);
  context.stroke();
  context.textAlign = "center";
  context.font = `16px ${mono}`;
  context.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.86)`;
  context.fillText(`GENUS  ${active.genus}    χ = 2 − 2g = ${active.chi}`, W / 2, foot + 38);
  context.font = `30px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.94)";
  context.fillText(active.label, W / 2, foot + 78);
  context.font = `23px ${mono}`;
  context.fillText(`∫ K dA = 2πχ(S) = ${active.total}`, W / 2, foot + 126);
  context.font = `16px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.42)";
  context.fillText(calculatedIntegralText(activeIndex), W / 2, foot + 170);
  const trackY = foot + 235, trackLeft = 76, trackWidth = W - 152;
  context.strokeStyle = "rgba(255,255,255,.13)";
  context.beginPath(); context.moveTo(trackLeft, trackY); context.lineTo(trackLeft + trackWidth, trackY); context.stroke();
  for (const stop of [0, 0.18, 0.35, 0.66, 1]) {
    const x = trackLeft + stop * trackWidth;
    context.beginPath(); context.moveTo(x, trackY - 7); context.lineTo(x, trackY + 7); context.stroke();
  }
  const phaseX = trackLeft + loopState.loopT * trackWidth;
  context.strokeStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.76)`;
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(trackLeft, trackY); context.lineTo(phaseX, trackY); context.stroke();
  context.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.94)`;
  context.beginPath(); context.arc(phaseX, trackY, 4.5, 0, TAU); context.fill();
  context.font = `15px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.3)";
  context.fillText("TOPOLOGY KEEPS THE SCORE.", W / 2, foot + 272);
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
  createInterfaceLayers();
  generateGenus2Surface();
  bindControls();
}

function renderScene() {
  applyLoopingCamera();
  renderSurface(loopState.primary, loopState.secondary >= 0 ? 1 - loopState.mix : 1);
  if (loopState.secondary >= 0) renderSurface(loopState.secondary, loopState.mix);
  renderSimulatorInterface();
}

function draw() {
  const sourceFrame = isRecording ? recordingStartFrame + recFrameCount : frameCount - 1;
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

function bindControls() {
  document.getElementById("startBtn").addEventListener("click", startRecording);
  document.getElementById("stopBtn").addEventListener("click", stopRecording);
  document.getElementById("pngBtn").addEventListener("click", () => saveCanvas("gauss_bonnet_" + getTimestamp(), "png"));
}

function resetSimulation() {
  userYaw = 0; userPitch = 0; userZoomOffset = 0; forcedSurface = -1;
}

function mousePressed() {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  isDragging = true; lastMouseX = mouseX; lastMouseY = mouseY;
}
function mouseReleased() { isDragging = false; }
function mouseDragged() {
  if (!isDragging) return;
  userYaw += (mouseX - lastMouseX) * 0.006;
  userPitch = clamp(userPitch + (mouseY - lastMouseY) * 0.004, -0.7, 0.7);
  lastMouseX = mouseX; lastMouseY = mouseY;
  return false;
}
function mouseWheel(event) {
  userZoomOffset = clamp(userZoomOffset + event.delta * 0.55, -320, 520);
  return false;
}

function keyPressed() {
  if (key === " ") { paused = !paused; return false; }
  if (key >= "1" && key <= "4") { forcedSurface = Number(key) - 1; return false; }
  if (key === "r" || key === "R") { resetSimulation(); return false; }
  if (key === "h" || key === "H") { showInterface = !showInterface; return false; }
  if (key === "p" || key === "P") { saveCanvas("gauss_bonnet_" + getTimestamp(), "png"); return false; }
  if (key === "c" || key === "C" || key === "e" || key === "E") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  return true;
}

// Preserved WebCodecs + mp4-muxer export pipeline.
function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported."); return; }
  if (typeof Mp4Muxer === "undefined") { alert("mp4-muxer not loaded."); return; }
  recordingStartFrame = 0;
  frozenFrame = 0;
  forcedSurface = -1;
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
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "gauss_bonnet_" + getTimestamp() + ".mp4";
  anchor.click();
  encoder.close();
  encoder = null; muxer = null;
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
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}
function updateRecordingUi() {
  document.getElementById("duration").textContent = (recFrameCount / FPS).toFixed(1);
  document.getElementById("frameCount").textContent = recFrameCount;
  document.getElementById("progressFill").style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
}
function setStatus(textValue, colorValue) {
  const element = document.getElementById("status");
  element.textContent = textValue;
  element.style.color = colorValue;
}

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function getTimestamp() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.getTimestamp = getTimestamp;

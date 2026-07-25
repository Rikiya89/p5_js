"use strict";

// ============================================================
// CONFIGURATION + EXISTING PALETTE / EXPORT FORMAT
// ============================================================
const W = 1080,
  H = 1920,
  FPS = 60,
  MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION,
  LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;
const BG_R = 3,
  BG_G = 3,
  BG_B = 5;
const INK = { r: 255, g: 255, b: 255 };
const CYAN = { r: 0, g: 229, b: 255 };
const MAGENTA = { r: 255, g: 61, b: 191 };
const ACID = { r: 182, g: 255, b: 61 };

const CONFIG = {
  radius: 2.65,
  worldScale: 120,
  boundaryParticles: 18,
  fieldRings: [1.05, 1.75, 2.35],
  fieldArrowsPerRing: 10,
  curlRadialSamples: 4,
  curlAngularSamples: 10,
  normalRadialSamples: 3,
  normalAngularSamples: 8,
  tolerance: 0.006,
};

const PARAMS = {
  amplitude: 1,
  frequency: 2.5,
  fieldStrength: 1,
  boundarySamples: 256,
  surfaceResolution: 28,
  particleSpeed: 1,
  autoMode: true,
  surfaceMode: 0,
  showField: true,
  showCurl: true,
  showNormals: true,
  showBoundary: true,
  showGrid: true,
  showIntegrals: true,
};

const MODE_NAMES = ["FLAT", "WAVE", "BOWL", "SADDLE", "TWISTED"];
let canvasEl, hudPg;
let muxer = null,
  encoder = null,
  isRecording = false,
  recFrameCount = 0;
let paused = false,
  showHUD = true,
  frozenFrame = 0;
let userYaw = 0,
  userPitch = 0,
  userZoomOffset = 0;
let isDragging = false,
  lastMouseX = 0,
  lastMouseY = 0;
let surfacePoints = [],
  surfaceNormals = [],
  surfaceStride = 0;

// ============================================================
// VECTOR-FIELD MATHEMATICS — replace these two functions together
// ============================================================
function vectorField(x, y, z, out) {
  out.x = -PARAMS.fieldStrength * y;
  out.y = PARAMS.fieldStrength * x;
  out.z = 0;
  return out;
}

function curlField(x, y, z, out) {
  out.x = 0;
  out.y = 0;
  out.z = 2 * PARAMS.fieldStrength;
  return out;
}

const scratchField = { x: 0, y: 0, z: 0 };
const scratchCurl = { x: 0, y: 0, z: 0 };

// ============================================================
// PARAMETRIC SURFACE + FIXED BOUNDARY
// p(r,theta) = (r cos(theta), r sin(theta), z(r,theta)).
// Every deformation contains a boundary envelope, so z(R,theta)=0.
// ============================================================
function deformationValue(mode, r, theta, time) {
  const R = CONFIG.radius;
  const q = r / R;
  const edge = Math.max(0, 1 - q * q);
  const x = r * Math.cos(theta),
    y = r * Math.sin(theta);
  const a = PARAMS.amplitude;
  const f = PARAMS.frequency;
  if (mode === 0) return 0;
  if (mode === 1) return a * 0.72 * edge * Math.sin(f * theta + time * TAU);
  if (mode === 2) return a * 0.78 * edge * (0.25 + 0.75 * q * q);
  if (mode === 3) return (a * 0.62 * edge * (x * x - y * y)) / (R * R);
  return a * 0.72 * edge * q * Math.sin(2 * theta + time * TAU);
}

function generateSurface(u, v, deformation, out) {
  const r = CONFIG.radius * u;
  const theta = TAU * v;
  out.x = r * Math.cos(theta);
  out.y = r * Math.sin(theta);
  out.z = deformation(r, theta);
  return out;
}

function generateBoundaryPoint(t, out) {
  const theta = TAU * t;
  out.x = CONFIG.radius * Math.cos(theta);
  out.y = CONFIG.radius * Math.sin(theta);
  out.z = 0;
  return out;
}

function normalizedModeWeights(modePosition) {
  const weights = [0, 0, 0, 0, 0];
  const base = Math.floor(modePosition) % MODE_NAMES.length;
  const next = (base + 1) % MODE_NAMES.length;
  const blend = smoothstep01(modePosition - Math.floor(modePosition));
  weights[base] = 1 - blend;
  weights[next] = blend;
  return weights;
}

function deformationFromState(state) {
  return (r, theta) => {
    let z = 0;
    for (let i = 0; i < state.modeWeights.length; i++) {
      if (state.modeWeights[i] > 0)
        z += state.modeWeights[i] * deformationValue(i, r, theta, state.loop);
    }
    return z;
  };
}

// Numerical derivatives furnish two surface tangents. Their cross product
// gives the upward-oriented normal, matching the CCW boundary direction.
function surfaceFrame(r, theta, deform, outPoint, outNormal) {
  const epsR = 0.004,
    epsT = 0.003;
  const r0 = Math.max(0, r - epsR),
    r1 = Math.min(CONFIG.radius, r + epsR);
  const z = deform(r, theta);
  const zr = (deform(r1, theta) - deform(r0, theta)) / Math.max(1e-6, r1 - r0);
  const zt = (deform(r, theta + epsT) - deform(r, theta - epsT)) / (2 * epsT);
  const c = Math.cos(theta),
    s = Math.sin(theta);
  outPoint.x = r * c;
  outPoint.y = r * s;
  outPoint.z = z;
  const tx = c,
    ty = s,
    tz = zr;
  const ux = -r * s,
    uy = r * c,
    uz = zt;
  let nx = ty * uz - tz * uy;
  let ny = tz * ux - tx * uz;
  let nz = tx * uy - ty * ux;
  const inv = 1 / Math.max(1e-6, Math.hypot(nx, ny, nz));
  outNormal.x = nx * inv;
  outNormal.y = ny * inv;
  outNormal.z = nz * inv;
}

// ============================================================
// NUMERICAL INTEGRATION — both sides are independently accumulated
// ============================================================
function calculateBoundaryCirculation() {
  const n = Math.max(16, Math.round(PARAMS.boundarySamples));
  const R = CONFIG.radius;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = (TAU * i) / n,
      b = (TAU * (i + 1)) / n;
    const x0 = R * Math.cos(a),
      y0 = R * Math.sin(a);
    const x1 = R * Math.cos(b),
      y1 = R * Math.sin(b);
    const xm = (x0 + x1) * 0.5,
      ym = (y0 + y1) * 0.5;
    vectorField(xm, ym, 0, scratchField);
    sum += scratchField.x * (x1 - x0) + scratchField.y * (y1 - y0);
  }
  return sum;
}

function calculateSurfaceCurlFlux(deform) {
  const radialN = Math.max(4, Math.round(PARAMS.surfaceResolution));
  const angularN = Math.max(16, Math.round(PARAMS.boundarySamples));
  const R = CONFIG.radius;
  let sum = 0;
  // Two oriented triangles per cell; scalar math avoids allocations.
  for (let ir = 0; ir < radialN; ir++) {
    const ra = (R * ir) / radialN,
      rb = (R * (ir + 1)) / radialN;
    for (let it = 0; it < angularN; it++) {
      const ta = (TAU * it) / angularN,
        tb = (TAU * (it + 1)) / angularN;
      const ax = ra * Math.cos(ta),
        ay = ra * Math.sin(ta),
        az = deform(ra, ta);
      const bx = rb * Math.cos(ta),
        by = rb * Math.sin(ta),
        bz = deform(rb, ta);
      const cx = rb * Math.cos(tb),
        cy = rb * Math.sin(tb),
        cz = deform(rb, tb);
      const dx = ra * Math.cos(tb),
        dy = ra * Math.sin(tb),
        dz = deform(ra, tb);
      sum += triangleCurlFlux(ax, ay, az, bx, by, bz, cx, cy, cz);
      sum += triangleCurlFlux(ax, ay, az, cx, cy, cz, dx, dy, dz);
    }
  }
  return sum;
}

function triangleCurlFlux(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax,
    uy = by - ay,
    uz = bz - az,
    vx = cx - ax,
    vy = cy - ay,
    vz = cz - az;
  const dsx = (uy * vz - uz * vy) * 0.5,
    dsy = (uz * vx - ux * vz) * 0.5,
    dsz = (ux * vy - uy * vx) * 0.5;
  curlField(
    (ax + bx + cx) / 3,
    (ay + by + cy) / 3,
    (az + bz + cz) / 3,
    scratchCurl,
  );
  return scratchCurl.x * dsx + scratchCurl.y * dsy + scratchCurl.z * dsz;
}

// ============================================================
// SETUP + CONTROLS
// ============================================================
function setup() {
  setAttributes({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  document.getElementById("canvas-wrap").appendChild(canvasEl);
  document.getElementById("maxDuration").textContent = MAX_DURATION;
  document.getElementById("maxFrames").textContent = MAX_FRAMES;
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  bindControls();
}

function bindControls() {
  const bind = (id, key, digits = 0) => {
    const el = document.getElementById(id),
      out = document.getElementById(id + "Out");
    el.addEventListener("input", () => {
      PARAMS[key] = +el.value;
      out.textContent = (+el.value).toFixed(digits);
    });
  };
  bind("amplitude", "amplitude", 2);
  bind("frequency", "frequency", 2);
  bind("fieldStrength", "fieldStrength", 2);
  bind("particleSpeed", "particleSpeed", 2);
  bind("boundarySamples", "boundarySamples");
  bind("surfaceResolution", "surfaceResolution");
  document.getElementById("startBtn").addEventListener("click", startRecording);
  document.getElementById("stopBtn").addEventListener("click", stopRecording);
  document
    .getElementById("pngBtn")
    .addEventListener("click", () =>
      saveCanvas("stokes_theorem_" + ts(), "png"),
    );
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
  userPitch = constrain(userPitch + (mouseY - lastMouseY) * 0.005, -0.75, 0.75);
  lastMouseX = mouseX;
  lastMouseY = mouseY;
  return false;
}
function mouseWheel(event) {
  userZoomOffset = constrain(userZoomOffset + event.delta * 0.55, -340, 520);
  return false;
}
function resetCamera() {
  userYaw = 0;
  userPitch = 0;
  userZoomOffset = 0;
}

// ============================================================
// SEAMLESS REEL TIMELINE
// ============================================================
function updateSimulation(frame) {
  const loop =
    (((frame % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  let modePosition;
  if (PARAMS.autoMode) {
    // The mode path traverses all five surfaces and returns continuously.
    modePosition = (0.65 + loop * MODE_NAMES.length) % MODE_NAMES.length;
  } else modePosition = PARAMS.surfaceMode;
  const modeWeights = normalizedModeWeights(modePosition);
  const dominantMode = modeWeights.indexOf(Math.max(...modeWeights));
  const deform = deformationFromState({ loop, modeWeights });
  const boundaryIntegral = calculateBoundaryCirculation();
  const surfaceIntegral = calculateSurfaceCurlFlux(deform);
  const theoremError = Math.abs(boundaryIntegral - surfaceIntegral);
  let scene = "HOOK";
  if (loop >= 0.1 && loop < 0.3) scene = "BOUNDARY";
  else if (loop >= 0.3 && loop < 0.56) scene = "CURL";
  else if (loop >= 0.56 && loop < 0.84) scene = "MORPH";
  else if (loop >= 0.84) scene = "EQUALITY";
  const boundaryFocus =
    scene === "BOUNDARY" ? 1 : scene === "CURL" ? 0.42 : 0.78;
  const curlFocus =
    scene === "CURL"
      ? 1
      : scene === "BOUNDARY"
        ? 0.18
        : scene === "HOOK"
          ? 0.42
          : 0.72;
  const surfaceFocus =
    scene === "BOUNDARY" ? 0.38 : scene === "CURL" ? 0.82 : 1;
  const equalityPulse =
    scene === "EQUALITY" ? 0.72 + 0.28 * pulse(loop * 5) : 0.55;
  return {
    loop,
    modeWeights,
    dominantMode,
    deform,
    boundaryIntegral,
    surfaceIntegral,
    theoremError,
    isEqual: theoremError < CONFIG.tolerance,
    scene,
    boundaryFocus,
    curlFocus,
    surfaceFocus,
    equalityPulse,
  };
}

function smoothstep01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
function pulse(t) {
  return 0.5 - 0.5 * Math.cos(TAU * t);
}

function updateCamera(s) {
  const auto = PARAMS.autoMode ? 1 : 0;
  // Hero pose: elevated three-quarter view matching the chosen cover frame.
  // The automatic path only breathes around this position, keeping the full
  // boundary readable for the entire Reel.
  const yaw = (-0.46 + 0.055 * Math.sin(TAU * s.loop)) * auto + userYaw;
  const elevation =
    -0.53 + 0.025 * Math.sin(TAU * s.loop + 0.6) + userPitch;
  const distance =
    1000 +
    12 * Math.sin(TAU * s.loop) -
    8 * pulse(s.loop * 2) +
    userZoomOffset;
  const cx = Math.sin(yaw) * distance;
  const cz = Math.cos(yaw) * distance;
  const roll = 0.008 * Math.sin(TAU * s.loop);
  camera(
    cx,
    elevation * distance,
    cz,
    0,
    15,
    0,
    Math.sin(roll),
    Math.cos(roll),
    0,
  );
}

// ============================================================
// DRAW LOOP
// ============================================================
function draw() {
  const sourceFrame = isRecording ? recFrameCount : frameCount;
  if (!paused || isRecording) frozenFrame = sourceFrame;
  const state = updateSimulation(frozenFrame);
  background(BG_R, BG_G, BG_B);
  perspective(PI / 3, W / H, 10, 5000);
  updateCamera(state);
  ambientLight(20, 20, 26);
  pointLight(CYAN.r, CYAN.g, CYAN.b, -280, -420, 460);
  pointLight(MAGENTA.r, MAGENTA.g, MAGENTA.b, 380, 160, -300);
  drawScene(state);
  if (showHUD) drawHUD(state);
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ============================================================
// SURFACE MESH + WORLD HELPERS
// ============================================================
function worldVertex(p) {
  vertex(
    p.x * CONFIG.worldScale,
    -p.z * CONFIG.worldScale,
    p.y * CONFIG.worldScale,
  );
}
function worldPoint(x, y, z) {
  vertex(x * CONFIG.worldScale, -z * CONFIG.worldScale, y * CONFIG.worldScale);
}
function worldLine(a, b) {
  line(
    a.x * CONFIG.worldScale,
    -a.z * CONFIG.worldScale,
    a.y * CONFIG.worldScale,
    b.x * CONFIG.worldScale,
    -b.z * CONFIG.worldScale,
    b.y * CONFIG.worldScale,
  );
}

function buildSurfaceBuffers(state) {
  const radialN = Math.max(8, Math.round(PARAMS.surfaceResolution));
  const angularN = Math.max(32, radialN * 3);
  surfaceStride = angularN + 1;
  const needed = (radialN + 1) * surfaceStride;
  while (surfacePoints.length < needed)
    surfacePoints.push({ x: 0, y: 0, z: 0 });
  while (surfaceNormals.length < needed)
    surfaceNormals.push({ x: 0, y: 0, z: 1 });
  for (let ir = 0; ir <= radialN; ir++) {
    const r = (CONFIG.radius * ir) / radialN;
    for (let it = 0; it <= angularN; it++) {
      const theta = (TAU * it) / angularN,
        idx = ir * surfaceStride + it;
      surfaceFrame(
        r,
        theta,
        state.deform,
        surfacePoints[idx],
        surfaceNormals[idx],
      );
    }
  }
  return { radialN, angularN };
}

function drawScene(s) {
  push();
  rotateX(-0.03);
  if (PARAMS.showGrid) drawGrid();
  if (PARAMS.showField) drawVectorField(s);
  const mesh = buildSurfaceBuffers(s);
  drawSurfaceMesh(s, mesh);
  if (PARAMS.showCurl) drawCurlIndicators(s);
  if (PARAMS.showNormals) drawSurfaceNormals(s);
  if (PARAMS.showBoundary) drawBoundary(s);
  pop();
}

function drawGrid() {
  push();
  translate(0, 150, 0);
  noFill();
  strokeWeight(1);
  const span = 760,
    step = 95;
  for (let i = -span; i <= span; i += step) {
    const fade = 28 * (1 - Math.abs(i) / (span + step));
    stroke(INK.r, INK.g, INK.b, fade);
    line(i, 0, -span, i, 0, span);
    line(-span, 0, i, span, 0, i);
  }
  stroke(CYAN.r, CYAN.g, CYAN.b, 90);
  strokeWeight(2);
  line(-700, 0, 0, 700, 0, 0);
  stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, 80);
  line(0, 0, -700, 0, 0, 700);
  stroke(ACID.r, ACID.g, ACID.b, 70);
  line(0, 230, 0, 0, -430, 0);
  pop();
}

function drawSurfaceMesh(s, mesh) {
  noStroke();
  fill(CYAN.r, CYAN.g, CYAN.b, 44 * s.surfaceFocus);
  beginShape(TRIANGLES);
  for (let ir = 0; ir < mesh.radialN; ir++) {
    for (let it = 0; it < mesh.angularN; it++) {
      const a = surfacePoints[ir * surfaceStride + it];
      const b = surfacePoints[(ir + 1) * surfaceStride + it];
      const c = surfacePoints[(ir + 1) * surfaceStride + it + 1];
      const d = surfacePoints[ir * surfaceStride + it + 1];
      const wave =
        0.5 + 0.5 * Math.sin(it * 0.31 - ir * 0.42 - TAU * s.loop * 3);
      const fluxGlow =
        (24 +
          25 * Math.max(0, surfaceNormals[(ir + 1) * surfaceStride + it].z) +
          22 * wave) *
        s.surfaceFocus;
      fill(CYAN.r, CYAN.g, CYAN.b, fluxGlow);
      worldVertex(a);
      worldVertex(b);
      worldVertex(c);
      fill(
        MAGENTA.r,
        MAGENTA.g,
        MAGENTA.b,
        (17 + 18 * (1 - wave)) * s.surfaceFocus,
      );
      worldVertex(a);
      worldVertex(c);
      worldVertex(d);
    }
  }
  endShape();
  noFill();
  strokeWeight(1);
  for (let ir = 2; ir < mesh.radialN; ir += 3) {
    stroke(CYAN.r, CYAN.g, CYAN.b, 38 * s.surfaceFocus);
    beginShape();
    for (let it = 0; it <= mesh.angularN; it++)
      worldVertex(surfacePoints[ir * surfaceStride + it]);
    endShape();
  }
  for (
    let it = 0;
    it < mesh.angularN;
    it += Math.max(4, Math.floor(mesh.angularN / 18))
  ) {
    stroke(INK.r, INK.g, INK.b, 22);
    beginShape();
    for (let ir = 0; ir <= mesh.radialN; ir++)
      worldVertex(surfacePoints[ir * surfaceStride + it]);
    endShape();
  }
}

// ============================================================
// VECTOR FIELD, CURL, NORMALS, AND CIRCULATION
// ============================================================
function drawVectorField(s) {
  const emphasis =
    s.scene === "BOUNDARY" ? 0.45 : s.scene === "HOOK" ? 0.72 : 1;
  for (let ri = 0; ri < CONFIG.fieldRings.length; ri++) {
    const r = CONFIG.fieldRings[ri];
    for (let i = 0; i < CONFIG.fieldArrowsPerRing; i++) {
      const theta =
        TAU * (i / CONFIG.fieldArrowsPerRing + s.loop * (0.055 + 0.014 * ri));
      const x = r * Math.cos(theta),
        y = r * Math.sin(theta);
      vectorField(x, y, 0, scratchField);
      const m = Math.hypot(scratchField.x, scratchField.y) || 1;
      const len = 0.22 + 0.11 * r;
      drawArrow3D(
        x,
        y,
        -0.52,
        (scratchField.x / m) * len,
        (scratchField.y / m) * len,
        0,
        CYAN,
        75 * emphasis,
        5,
      );
    }
  }
}

function drawCurlIndicators(s) {
  const sceneAlpha = s.curlFocus;
  for (let ir = 1; ir <= CONFIG.curlRadialSamples; ir++) {
    const r = (CONFIG.radius * ir) / (CONFIG.curlRadialSamples + 1);
    for (let it = 0; it < CONFIG.curlAngularSamples; it++) {
      const theta =
        TAU *
        (it / CONFIG.curlAngularSamples +
          (ir % 2) * 0.05 +
          s.loop * 0.022 * (ir % 2 ? 1 : -1));
      const p = { x: 0, y: 0, z: 0 },
        n = { x: 0, y: 0, z: 1 };
      surfaceFrame(r, theta, s.deform, p, n);
      const localPulse =
        0.72 + 0.28 * Math.sin(TAU * s.loop * 4 + ir * 0.9 + it * 0.55);
      push();
      translate(
        p.x * CONFIG.worldScale,
        -p.z * CONFIG.worldScale,
        p.y * CONFIG.worldScale,
      );
      noFill();
      stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, 105 * sceneAlpha);
      strokeWeight(2);
      rotateX(HALF_PI);
      rotateZ(TAU * s.loop * 1.5 + theta);
      arc(0, 0, 22 + 7 * localPulse, 22 + 7 * localPulse, 0, PI * 1.68);
      pop();
      const fluxLen = 0.34 + 0.22 * localPulse;
      drawArrow3D(
        p.x,
        p.y,
        p.z - fluxLen * 0.5,
        0,
        0,
        fluxLen,
        MAGENTA,
        125 * sceneAlpha,
        6,
      );
      if ((it + ir) % 3 === 0)
        drawFluxSpark(p, s, (it + ir * 3) / 17, sceneAlpha);
    }
  }
  drawVortexCore(s, sceneAlpha);
}

function drawFluxSpark(p, s, offset, alpha) {
  const travel = (s.loop * 2.4 + offset) % 1;
  const z = p.z - 0.48 + travel * 0.96;
  stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, 28 * alpha);
  strokeWeight(1);
  line(
    p.x * CONFIG.worldScale,
    -(p.z - 0.52) * CONFIG.worldScale,
    p.y * CONFIG.worldScale,
    p.x * CONFIG.worldScale,
    -(p.z + 0.52) * CONFIG.worldScale,
    p.y * CONFIG.worldScale,
  );
  glowPoint(p.x, p.y, z, MAGENTA, 3.5);
}

function drawVortexCore(s, alpha) {
  for (let strand = 0; strand < 2; strand++) {
    noFill();
    stroke(
      strand ? CYAN.r : MAGENTA.r,
      strand ? CYAN.g : MAGENTA.g,
      strand ? CYAN.b : MAGENTA.b,
      100 * alpha,
    );
    strokeWeight(2.3);
    beginShape();
    for (let i = 0; i <= 70; i++) {
      const q = i / 70,
        z = -0.72 + q * 1.44;
      const radius = 0.28 * (0.35 + 0.65 * Math.sin(PI * q));
      const a = TAU * (q * 3.2 - s.loop * 2) + strand * PI;
      worldPoint(Math.cos(a) * radius, Math.sin(a) * radius, z);
    }
    endShape();
  }
  glowPoint(0, 0, 0.02, ACID, 5 + 4 * pulse(s.loop * 3));
}

function drawSurfaceNormals(s) {
  const alpha = s.scene === "CURL" ? 105 : 42;
  for (let ir = 1; ir <= CONFIG.normalRadialSamples; ir++) {
    const r = (CONFIG.radius * ir) / (CONFIG.normalRadialSamples + 1);
    for (let it = 0; it < CONFIG.normalAngularSamples; it++) {
      const theta = (TAU * it) / CONFIG.normalAngularSamples;
      const p = { x: 0, y: 0, z: 0 },
        n = { x: 0, y: 0, z: 1 };
      surfaceFrame(r, theta, s.deform, p, n);
      drawArrow3D(
        p.x,
        p.y,
        p.z,
        n.x * 0.28,
        n.y * 0.28,
        n.z * 0.28,
        ACID,
        alpha,
        5,
      );
    }
  }
}

function drawBoundary(s) {
  const R = CONFIG.radius,
    n = 180;
  // Keep the theorem boundary visually clean: it is rendered as a foreground
  // layer so the surface edge and grid cannot create z-fighting artifacts.
  const gl = drawingContext;
  gl.disable(gl.DEPTH_TEST);
  strokeCap(ROUND);
  // Layered strokes create controlled glow without relying on blend modes.
  for (const layer of [
    { w: 14, a: 22 },
    { w: 7, a: 70 },
    { w: 3.2, a: 245 },
  ]) {
    noFill();
    stroke(CYAN.r, CYAN.g, CYAN.b, layer.a * s.boundaryFocus);
    strokeWeight(layer.w);
    beginShape();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      worldPoint(R * Math.cos(TAU * t), R * Math.sin(TAU * t), 0);
    }
    endShape();
  }
  const speed = PARAMS.particleSpeed;
  for (let i = 0; i < CONFIG.boundaryParticles; i++) {
    const t = (i / CONFIG.boundaryParticles + s.loop * speed) % 1;
    const a = TAU * t,
      x = R * Math.cos(a),
      y = R * Math.sin(a);
    const bright = i % 4 === 0 ? 1 : 0.55;
    if (i % 4 === 0) drawCometTrail(t, s.boundaryFocus);
    glowPoint(x, y, 0, CYAN, (i % 4 === 0 ? 9 : 5) * bright);
  }
  drawTravelingBoundaryHighlight(s);
  // Tangent arrows explicitly mark positive (CCW from +normal) orientation.
  for (let i = 0; i < 8; i++) {
    const a = TAU * (i / 8 + s.loop * 0.035),
      x = R * Math.cos(a),
      y = R * Math.sin(a);
    const tx = -Math.sin(a),
      ty = Math.cos(a);
    drawArrow3D(
      x,
      y,
      0,
      tx * 0.34,
      ty * 0.34,
      0,
      ACID,
      210 * s.boundaryFocus,
      9,
    );
  }
  gl.enable(gl.DEPTH_TEST);
}

function drawCometTrail(t, alpha) {
  const R = CONFIG.radius;
  noFill();
  strokeWeight(3);
  beginShape();
  for (let j = 7; j >= 0; j--) {
    const q = j / 7,
      a = TAU * (t - j * 0.0055);
    stroke(CYAN.r, CYAN.g, CYAN.b, (1 - q) * 95 * alpha);
    worldPoint(R * Math.cos(a), R * Math.sin(a), 0);
  }
  endShape();
}

function drawTravelingBoundaryHighlight(s) {
  const R = CONFIG.radius,
    head = (s.loop * PARAMS.particleSpeed) % 1;
  for (const layer of [
    { w: 18, a: 22 },
    { w: 7, a: 150 },
    { w: 2.5, a: 255 },
  ]) {
    noFill();
    stroke(ACID.r, ACID.g, ACID.b, layer.a * s.boundaryFocus);
    strokeWeight(layer.w);
    beginShape();
    for (let i = 0; i <= 28; i++) {
      const t = head - 0.115 + (i / 28) * 0.115,
        a = TAU * t;
      worldPoint(R * Math.cos(a), R * Math.sin(a), 0);
    }
    endShape();
  }
}

function drawArrow3D(x, y, z, dx, dy, dz, col, alpha, headSize) {
  const a = { x, y, z },
    b = { x: x + dx, y: y + dy, z: z + dz };
  stroke(col.r, col.g, col.b, alpha);
  strokeWeight(2);
  worldLine(a, b);
  push();
  translate(
    b.x * CONFIG.worldScale,
    -b.z * CONFIG.worldScale,
    b.y * CONFIG.worldScale,
  );
  noStroke();
  fill(col.r, col.g, col.b, alpha);
  sphere(headSize, 6, 4);
  pop();
}

function glowPoint(x, y, z, col, size) {
  push();
  translate(
    x * CONFIG.worldScale,
    -z * CONFIG.worldScale,
    y * CONFIG.worldScale,
  );
  noStroke();
  fill(col.r, col.g, col.b, 24);
  sphere(size * 2.5, 7, 5);
  fill(col.r, col.g, col.b, 235);
  sphere(size, 8, 5);
  pop();
}

// ============================================================
// PHONE-SAFE HUD / REEL COPY
// ============================================================
function drawHUD(s) {
  hudPg.clear();
  const ctx = hudPg.drawingContext,
    mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  ctx.save();
  ctx.fillStyle = "rgba(3,3,5,.80)";
  ctx.fillRect(0, 0, W, 285);
  ctx.fillRect(0, H - 410, W, 410);
  ctx.strokeStyle = "rgba(255,255,255,.11)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(82, 285);
  ctx.lineTo(W - 82, 285);
  ctx.moveTo(82, H - 410);
  ctx.lineTo(W - 82, H - 410);
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `25px ${mono}`;
  ctx.fillStyle = "rgba(255,255,255,.62)";
  ctx.fillText("[SKETCH]", W / 2, 78);
  ctx.font = `34px ${mono}`;
  ctx.fillStyle = "rgba(255,255,255,.96)";
  ctx.fillText("STOKES’ THEOREM", W / 2, 128);
  ctx.font = `22px ${mono}`;
  ctx.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.82)`;
  ctx.fillText("F(x,y,z) = (−y, x, 0)", W / 2, 190);
  drawSceneCopy(ctx, s, mono);
  const left = 86,
    y = H - 330;
  ctx.textAlign = "left";
  ctx.font = `18px ${mono}`;
  ctx.fillStyle = "rgba(255,255,255,.46)";
  ctx.fillText("BOUNDARY CIRCULATION", left, y);
  ctx.font = `31px ${mono}`;
  ctx.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.96)`;
  ctx.fillText(`∮ F · dr   ${s.boundaryIntegral.toFixed(3)}`, left, y + 35);
  ctx.textAlign = "right";
  ctx.font = `18px ${mono}`;
  ctx.fillStyle = "rgba(255,255,255,.46)";
  ctx.fillText("SURFACE CURL FLUX", W - left, y);
  ctx.font = `31px ${mono}`;
  ctx.fillStyle = `rgba(${MAGENTA.r},${MAGENTA.g},${MAGENTA.b},.96)`;
  ctx.fillText(
    `∬ curl(F) · n dS   ${s.surfaceIntegral.toFixed(3)}`,
    W - left,
    y + 35,
  );
  ctx.textAlign = "center";
  ctx.font = `20px ${mono}`;
  ctx.fillStyle = s.isEqual
    ? `rgba(${ACID.r},${ACID.g},${ACID.b},.95)`
    : "rgba(255,255,255,.58)";
  ctx.fillText(
    `${s.isEqual ? "CIRCULATION = CURL FLUX" : "NUMERICAL CONVERGENCE"}   error ${s.theoremError.toFixed(6)}`,
    W / 2,
    y + 112,
  );
  ctx.font = `16px ${mono}`;
  ctx.fillStyle = "rgba(255,255,255,.34)";
  ctx.fillText(
    `SURFACE ${MODE_NAMES[s.dominantMode]}  ·  +n / CCW ORIENTATION`,
    W / 2,
    y + 164,
  );
  ctx.textAlign = "right";
  ctx.fillText("20260725  #RikiCodeArt", W - 76, H - 62);
  ctx.restore();
  const gl = drawingContext;
  gl.disable(gl.DEPTH_TEST);
  const overlayZ = H / (2 * Math.tan(PI / 6));
  push();
  camera(0, 0, overlayZ, 0, 0, 0, 0, 1, 0);
  perspective(PI / 3, W / H, 10, 5000);
  imageMode(CENTER);
  image(hudPg, 0, 0, W, H);
  pop();
  gl.enable(gl.DEPTH_TEST);
}

function drawSceneCopy(ctx, s, mono) {
  let lines = ["ONE LOOP.", "ANY SURFACE."],
    color = CYAN;
  if (s.scene === "BOUNDARY") {
    lines = ["BOUNDARY CIRCULATION", "∮ F · dr"];
    color = CYAN;
  } else if (s.scene === "CURL") {
    lines = ["LOCAL CURL", "ACCUMULATES"];
    color = MAGENTA;
  } else if (s.scene === "MORPH") {
    lines = ["THE SURFACE CHANGES.", "THE RESULT DOES NOT."];
    color = ACID;
  } else if (s.scene === "EQUALITY") {
    lines = ["CIRCULATION", "＝ CURL FLUX"];
    color = ACID;
  }
  const alpha = 0.82 + 0.18 * pulse(s.loop * 2);
  ctx.font = `bold 47px ${mono}`;
  ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${alpha})`;
  ctx.fillText(lines[0], W / 2, 430);
  ctx.fillText(lines[1], W / 2, 490);
}

// ============================================================
// KEYBOARD INTERACTION
// ============================================================
function keyPressed() {
  if (key === " ") {
    paused = !paused;
    return false;
  }
  if (key === "r" || key === "R") {
    resetCamera();
    return false;
  }
  if (key === "a" || key === "A") {
    PARAMS.autoMode = !PARAMS.autoMode;
    return false;
  }
  if (key === "s" || key === "S") {
    PARAMS.surfaceMode = (PARAMS.surfaceMode + 1) % MODE_NAMES.length;
    PARAMS.autoMode = false;
    return false;
  }
  if (key === "v" || key === "V") {
    PARAMS.showField = !PARAMS.showField;
    return false;
  }
  if (key === "c" || key === "C") {
    PARAMS.showCurl = !PARAMS.showCurl;
    return false;
  }
  if (key === "n" || key === "N") {
    PARAMS.showNormals = !PARAMS.showNormals;
    return false;
  }
  if (key === "b" || key === "B") {
    PARAMS.showBoundary = !PARAMS.showBoundary;
    return false;
  }
  if (key === "g" || key === "G") {
    PARAMS.showGrid = !PARAMS.showGrid;
    return false;
  }
  if (key === "i" || key === "I") {
    PARAMS.showIntegrals = !PARAMS.showIntegrals;
    showHUD = PARAMS.showIntegrals;
    return false;
  }
  if (key === "h" || key === "H") {
    showHUD = !showHUD;
    return false;
  }
  if (key === "p" || key === "P") {
    saveCanvas("stokes_theorem_" + ts(), "png");
    return false;
  }
  if (key === "e" || key === "E") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  return true;
}

// ============================================================
// EXISTING WEBCodecs + MP4-MUXER EXPORT SYSTEM
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
  // Every export starts from the same close, cinematic opening frame.
  resetCamera();
  PARAMS.autoMode = true;
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error(e);
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
    a = document.createElement("a");
  a.href = url;
  a.download = "stokes_theorem_" + ts() + ".mp4";
  a.click();
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
function setStatus(txt, c) {
  const el = document.getElementById("status");
  el.textContent = txt;
  el.style.color = c;
}
function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.ts = ts;

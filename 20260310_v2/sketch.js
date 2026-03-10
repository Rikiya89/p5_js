"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const BLACK = [0, 0, 0];
const VOID = [10, 10, 10];
const SHADE = [28, 28, 28];
const GRAPHITE = [74, 74, 74];
const SILVER = [150, 150, 150];
const PEARL = [214, 214, 214];
const WHITE = [255, 255, 255];

const PLANE_EXTENT = 1.72;
const PLANE_SCALE = 310;
const PLANE_Y = 320;
const ROOT_TOP_Y = -470;
const TRAJECTORY_STEPS = 9;
const CONVERGENCE_EPS = 0.0009;
const BASIN_COLS = 20;
const BASIN_ROWS = 28;
const SEED_COLS = 12;
const SEED_ROWS = 18;
const DUST_COUNT = 220;
const ORBITER_COUNT = 64;

const ROOTS = [
  { label: "1", value: { re: 1, im: 0 }, phase: 0.00, tone: 1.00 },
  { label: "i", value: { re: 0, im: 1 }, phase: 0.25, tone: 0.92 },
  { label: "-1", value: { re: -1, im: 0 }, phase: 0.50, tone: 0.84 },
  { label: "-i", value: { re: 0, im: -1 }, phase: 0.75, tone: 0.94 },
];

let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "newton_convergence_20260310.mp4";

let fc = 0;
let bgLayer = null;
let overlayLayer = null;
let basinRows = [];
let basinCols = [];
let trajectories = [];
let orbiters = [];
let dust = [];

function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs not supported. Use Chrome or Edge.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer failed to load.");
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      console.error(err);
      setStatus("Encoder error", "#f2f2f2");
      isRecording = false;
    },
  });

  encoder.configure({
    codec: "avc1.640028",
    width: W,
    height: H,
    bitrate: 16_000_000,
    framerate: FPS,
  });

  fc = 0;
  recordingFrameCount = 0;
  isRecording = true;
  clearDownloadLink();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  updateDownloadButton(false);
  setStatus("Recording MP4...", "#ffffff");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;

  isRecording = false;
  setStatus("Finalizing...", "#d8d8d8");
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  latestRecordingFilename = "newton_convergence_20260310.mp4";
  setDownloadLink(url, latestRecordingFilename);
  updateDownloadButton(true);
  triggerDownload(url, latestRecordingFilename);

  encoder.close();
  encoder = null;
  muxer = null;

  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("MP4 ready - click Save MP4 if auto-save was blocked.", "#ffffff");
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, {
    timestamp: recordingFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, color) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

function updateRecordingUI() {
  const dEl = document.getElementById("duration");
  const fEl = document.getElementById("frameCount");
  if (dEl) dEl.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recordingFrameCount;
}

function updateCanvasInfo() {
  const el = document.getElementById("canvasSize");
  if (el) el.textContent = W + " x " + H;
}

function setDownloadLink(url, filename) {
  const link = document.getElementById("downloadLink");
  if (!link) return;
  link.href = url;
  link.download = filename;
  link.hidden = false;
  link.textContent = "Direct Link";
}

function clearDownloadLink() {
  if (latestRecordingUrl) {
    URL.revokeObjectURL(latestRecordingUrl);
    latestRecordingUrl = "";
  }
  latestRecordingFilename = "newton_convergence_20260310.mp4";
  const link = document.getElementById("downloadLink");
  if (!link) return;
  link.hidden = true;
  link.removeAttribute("href");
  updateDownloadButton(false);
}

function updateDownloadButton(enabled) {
  const button = document.getElementById("downloadBtn");
  if (!button) return;
  button.disabled = !enabled;
}

function triggerDownload(url, filename) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadLatestRecording() {
  if (!latestRecordingUrl) {
    setStatus("No MP4 available yet.", "#bbbbbb");
    return;
  }
  triggerDownload(latestRecordingUrl, latestRecordingFilename);
  setStatus("Download triggered.", "#ffffff");
}

function setup() {
  pixelDensity(1);
  setAttributes("antialias", true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  textFont("monospace");

  ROOTS.forEach((root) => {
    root.pos = { x: root.value.re * PLANE_SCALE, z: root.value.im * PLANE_SCALE };
  });

  buildScene();
  buildBackdrop();
  buildOverlay();

  const maxDurationEl = document.getElementById("maxDuration");
  if (maxDurationEl) maxDurationEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function draw() {
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const theta = loopT * TWO_PI;

  background(...BLACK);
  drawBackdrop();
  setSceneCamera(theta);
  setSceneLights(theta);

  drawBasinPlane(theta);
  drawRootTowers(theta);
  drawConvergencePaths(loopT, theta);

  blendMode(ADD);
  noLights();
  drawOrbiters(theta);
  drawDust(theta);
  blendMode(BLEND);

  drawHud(loopT, theta);

  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }

  fc++;
}

function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  return true;
}

function buildScene() {
  basinRows = [];
  basinCols = [];
  trajectories = [];
  orbiters = [];
  dust = [];

  const rng = makeRng(20260310);
  const basinGrid = [];

  for (let row = 0; row < BASIN_ROWS; row++) {
    const rowPoints = [];
    const im = map(row, 0, BASIN_ROWS - 1, -PLANE_EXTENT, PLANE_EXTENT);
    for (let col = 0; col < BASIN_COLS; col++) {
      const re = map(col, 0, BASIN_COLS - 1, -PLANE_EXTENT, PLANE_EXTENT);
      const sample = sampleBasinPoint(re, im);
      rowPoints.push(sample);
    }
    basinGrid.push(rowPoints);
  }

  basinRows = basinGrid;
  for (let col = 0; col < BASIN_COLS; col++) {
    const colPoints = [];
    for (let row = 0; row < BASIN_ROWS; row++) colPoints.push(basinGrid[row][col]);
    basinCols.push(colPoints);
  }

  for (let row = 0; row < SEED_ROWS; row++) {
    for (let col = 0; col < SEED_COLS; col++) {
      const baseRe = map(col, 0, SEED_COLS - 1, -PLANE_EXTENT * 0.96, PLANE_EXTENT * 0.96);
      const baseIm = map(row, 0, SEED_ROWS - 1, -PLANE_EXTENT * 0.96, PLANE_EXTENT * 0.96);
      const re = baseRe + (rng() - 0.5) * 0.17;
      const im = baseIm + (rng() - 0.5) * 0.17;
      if (re * re + im * im < 0.04) continue;

      const trajectory = buildTrajectory({ re, im });
      if (trajectory.points.length < 2) continue;
      trajectory.phase = rng();
      trajectory.weight = 1.0 + rng() * 1.6;
      trajectory.spark = rng();
      trajectories.push(trajectory);
    }
  }

  for (let i = 0; i < ORBITER_COUNT; i++) {
    const rootIndex = i % ROOTS.length;
    orbiters.push({
      rootIndex,
      radius: 26 + rng() * 64,
      heightPhase: rng() * TWO_PI,
      orbitPhase: rng() * TWO_PI,
      speed: 0.5 + rng() * 1.6,
      size: 3 + rng() * 5,
      drift: 0.65 + rng() * 0.8,
    });
  }

  for (let i = 0; i < DUST_COUNT; i++) {
    const angle = rng() * TWO_PI;
    const lift = rng() * TWO_PI;
    const radius = 620 + rng() * 840;
    dust.push({
      x: cos(angle) * radius,
      y: sin(lift) * 560 - 120,
      z: sin(angle) * radius,
      alpha: 40 + rng() * 90,
      weight: 1 + rng() * 2.2,
      phase: rng() * TWO_PI,
    });
  }

  trajectories.sort((a, b) => a.phase - b.phase);
}

function sampleBasinPoint(re, im) {
  const start = { re, im };
  let z = start;
  let lastStep = 0;

  for (let i = 0; i < 6; i++) {
    lastStep = i;
    if (complexAbs(complexSub(z, ROOTS[closestRootIndex(z)].value)) < CONVERGENCE_EPS) break;
    const next = newtonStep(z);
    if (!next) break;
    z = next;
  }

  const rootIndex = closestRootIndex(z);
  const residual = complexAbs(newtonFunction(z));
  const relief = 16 + lastStep * 9 + clamp(-Math.log10(residual + 1e-9), 0, 7) * 5;
  const boundary = clamp(1.4 - nearestRootGap(z) * 1.6, 0, 1);
  const height = PLANE_Y - relief - boundary * 62;
  return {
    x: re * PLANE_SCALE,
    y: height,
    z: im * PLANE_SCALE,
    rootIndex,
    boundary,
    relief,
  };
}

function buildTrajectory(seed) {
  const points = [];
  let z = { re: seed.re, im: seed.im };
  let rootIndex = -1;
  let converged = false;

  for (let step = 0; step <= TRAJECTORY_STEPS; step++) {
    const residual = complexAbs(newtonFunction(z));
    const lift = clamp(-Math.log10(residual + 1e-9), 0, 8);
    const y = PLANE_Y - step * 72 - lift * 26;
    points.push({
      x: z.re * PLANE_SCALE,
      y,
      z: z.im * PLANE_SCALE,
      residual,
    });

    rootIndex = closestRootIndex(z);
    if (complexAbs(complexSub(z, ROOTS[rootIndex].value)) < CONVERGENCE_EPS) {
      converged = true;
      break;
    }

    const next = newtonStep(z);
    if (!next) break;
    z = next;
  }

  if (rootIndex >= 0) {
    const target = ROOTS[rootIndex];
    points.push({
      x: target.pos.x,
      y: ROOT_TOP_Y,
      z: target.pos.z,
      residual: 0,
    });
  }

  return { seed, points, rootIndex, converged };
}

function buildBackdrop() {
  bgLayer = createGraphics(W, H);
  bgLayer.pixelDensity(1);
  bgLayer.background(0);
  bgLayer.noFill();

  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const alpha = 16 * (1 - t);
    bgLayer.stroke(255, alpha);
    bgLayer.ellipse(W * 0.5, H * 0.48, W * (0.12 + t * 0.9), W * (0.08 + t * 0.68));
  }

  bgLayer.stroke(255, 12);
  for (let i = 0; i < 1400; i++) {
    const x = (i * 193) % W;
    const y = (i * 317) % H;
    const w = i % 3 === 0 ? 1.4 : 0.8;
    bgLayer.strokeWeight(w);
    bgLayer.point(x, y);
  }

  bgLayer.strokeWeight(1);
  for (let y = 0; y < H; y += 48) {
    const alpha = y % 96 === 0 ? 10 : 5;
    bgLayer.stroke(255, alpha);
    bgLayer.line(0, y, W, y);
  }
}

function buildOverlay() {
  overlayLayer = createGraphics(W, H);
  overlayLayer.pixelDensity(1);
  overlayLayer.clear();
  overlayLayer.noFill();
  overlayLayer.stroke(255, 22);
  overlayLayer.rect(36, 36, W - 72, H - 72, 26);
  overlayLayer.stroke(255, 12);
  overlayLayer.rect(52, 52, W - 104, H - 104, 22);
  overlayLayer.stroke(255, 10);
  overlayLayer.line(86, H * 0.5, W - 86, H * 0.5);
}

function drawBackdrop() {
  disableDepthTest();
  push();
  resetMatrix();
  noLights();
  translate(-W / 2, -H / 2);
  tint(255, 255);
  image(bgLayer, 0, 0, W, H);
  pop();
  enableDepthTest();
}

function setSceneCamera(theta) {
  const orbit = theta;
  const radius = 960 + 90 * sin(theta * 2.0);
  const camX = sin(orbit) * radius;
  const camY = -120 + sin(theta * 2.0) * 120 + cos(theta * 3.0) * 26;
  const camZ = cos(orbit) * (radius - 90 * sin(theta));

  const targetX = 0;
  const targetY = -100 + cos(theta * 2.0) * 18;
  const targetZ = 0;

  camera(camX, camY, camZ, targetX, targetY, targetZ, 0, 1, 0);
}

function setSceneLights(theta) {
  ambientLight(42, 42, 42);
  directionalLight(210, 210, 210, -0.4 + 0.1 * sin(theta), 0.28, -1);
  directionalLight(90, 90, 90, 0.6, -0.18, -0.4);
  pointLight(255, 255, 255, 0, -620 + 80 * sin(theta * 2), 250);
}

function drawBasinPlane(theta) {
  noFill();
  strokeWeight(1.2);

  for (let r = 0; r < basinRows.length; r++) {
    const row = basinRows[r];
    for (let i = 0; i < row.length - 1; i++) {
      const a = row[i];
      const b = row[i + 1];
      const shimmerA = sin(theta * 2 + (a.x + a.z) * 0.008) * 6;
      const shimmerB = sin(theta * 2 + (b.x + b.z) * 0.008) * 6;
      const alpha = 24 + a.boundary * 54;
      stroke(200 + a.boundary * 55, alpha);
      line(a.x, a.y + shimmerA, a.z, b.x, b.y + shimmerB, b.z);
    }
  }

  for (let c = 0; c < basinCols.length; c += 2) {
    const col = basinCols[c];
    for (let i = 0; i < col.length - 1; i++) {
      const a = col[i];
      const b = col[i + 1];
      const shimmerA = cos(theta * 2 + (a.x - a.z) * 0.008) * 6;
      const shimmerB = cos(theta * 2 + (b.x - b.z) * 0.008) * 6;
      const alpha = 18 + a.boundary * 44;
      stroke(170 + a.boundary * 65, alpha);
      line(a.x, a.y + shimmerA, a.z, b.x, b.y + shimmerB, b.z);
    }
  }
}

function drawRootTowers(theta) {
  noFill();
  for (let i = 0; i < ROOTS.length; i++) {
    const root = ROOTS[i];
    const pulse = 0.5 + 0.5 * sin(theta + root.phase * TWO_PI);
    const towerTop = ROOT_TOP_Y - 36 * pulse;
    const towerBase = PLANE_Y - 10;
    const tone = 188 + 64 * root.tone;

    push();
    translate(root.pos.x, 0, root.pos.z);
    stroke(tone, 220);
    strokeWeight(2.6);
    line(0, towerBase, 0, 0, towerTop, 0);

    for (let ring = 0; ring < 8; ring++) {
      const t = ring / 7;
      const y = lerp(towerBase, towerTop, t);
      const radius = 18 + (1 - t) * 42 + pulse * 10;
      push();
      translate(0, y, 0);
      rotateX(HALF_PI);
      stroke(tone, 50 + (1 - t) * 130);
      strokeWeight(1.3 + (1 - t) * 0.9);
      circle(0, 0, radius * 2);
      pop();
    }

    push();
    translate(0, towerTop, 0);
    noStroke();
    ambientMaterial(...WHITE);
    sphere(12 + pulse * 10, 10, 8);
    pop();

    stroke(255, 90);
    strokeWeight(1);
    for (let arm = 0; arm < 4; arm++) {
      const angle = theta + arm * HALF_PI;
      line(0, towerTop + 40, 0, cos(angle) * 62, towerTop - 24, sin(angle) * 62);
    }
    pop();
  }
}

function drawConvergencePaths(loopT, theta) {
  noFill();

  for (let i = 0; i < trajectories.length; i++) {
    const trail = trajectories[i];
    const count = trail.points.length;
    if (count < 2) continue;

    const reveal = fract(loopT + trail.phase);
    const visible = 1 + floor(reveal * (count - 1));
    const active = 0.35 + 0.65 * smooth01(0.5 + 0.5 * sin(TWO_PI * (loopT - trail.phase)));
    const sparkle = 0.5 + 0.5 * sin(theta * 3 + trail.spark * TWO_PI);
    const tone = 170 + ROOTS[trail.rootIndex].tone * 70;
    strokeWeight(trail.weight);

    for (let p = 0; p < visible - 1; p++) {
      const a = trail.points[p];
      const b = trail.points[p + 1];
      const segFade = 1 - p / max(1, count - 2);
      stroke(tone, (20 + segFade * 120) * active);
      line(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    if (visible < count) {
      const idx = max(0, visible - 1);
      const a = trail.points[idx];
      const b = trail.points[idx + 1];
      const frac = reveal * (count - 1) - idx;
      const x = lerp(a.x, b.x, frac);
      const y = lerp(a.y, b.y, frac);
      const z = lerp(a.z, b.z, frac);

      push();
      translate(x, y, z);
      noStroke();
      emissiveMaterial(255 * sparkle);
      sphere(3.5 + sparkle * 3.5, 7, 6);
      pop();
    }
  }
}

function drawOrbiters(theta) {
  noStroke();
  for (let i = 0; i < orbiters.length; i++) {
    const orbiter = orbiters[i];
    const root = ROOTS[orbiter.rootIndex];
    const angle = theta * orbiter.speed + orbiter.orbitPhase;
    const climb = 0.5 + 0.5 * sin(theta * 2 + orbiter.heightPhase);
    const y = lerp(PLANE_Y - 10, ROOT_TOP_Y + 70, climb);
    const x = root.pos.x + cos(angle) * orbiter.radius;
    const z = root.pos.z + sin(angle) * orbiter.radius;
    const glow = 120 + 135 * (0.5 + 0.5 * sin(theta * 3 + orbiter.heightPhase));

    push();
    translate(x, y, z);
    emissiveMaterial(glow);
    sphere(orbiter.size, 7, 5);
    pop();
  }
}

function drawDust(theta) {
  push();
  rotateY(theta * 0.25);
  for (let i = 0; i < dust.length; i++) {
    const mote = dust[i];
    stroke(255, mote.alpha * (0.45 + 0.55 * sin(theta + mote.phase)));
    strokeWeight(mote.weight);
    point(
      mote.x + sin(theta + mote.phase) * 24,
      mote.y + cos(theta * 2 + mote.phase) * 18,
      mote.z
    );
  }
  pop();
}

function drawHud(loopT, theta) {
  disableDepthTest();
  push();
  resetMatrix();
  translate(-W / 2, -H / 2);
  noLights();
  image(overlayLayer, 0, 0, W, H);

  noStroke();
  fill(255, 230);
  textAlign(LEFT, TOP);
  textSize(18);
  text("NEWTON CONVERGENCE MONOLITH", 78, 74);

  fill(210, 210, 210, 210);
  textSize(12);
  text("f(z) = z^4 - 1", 78, 104);
  text("z_(n+1) = z_n - f(z_n) / f'(z_n)", 78, 122);
  text("loop " + nf(loopT, 1, 3) + "  phase " + nf(theta / TWO_PI, 1, 3), 78, 140);

  textAlign(RIGHT, TOP);
  text("roots: 1, i, -1, -i", W - 78, 74);
  text("grayscale WEBGL / 1080 x 1920 / 60 fps", W - 78, 92);

  fill(255, 160);
  textAlign(LEFT, BOTTOM);
  text("Newton trajectories ascend as residuals collapse toward attractors.", 78, H - 96);
  pop();
  enableDepthTest();
}

function closestRootIndex(z) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < ROOTS.length; i++) {
    const distance = complexAbs(complexSub(z, ROOTS[i].value));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function nearestRootGap(z) {
  const distances = ROOTS.map((root) => complexAbs(complexSub(z, root.value))).sort((a, b) => a - b);
  return distances[1] - distances[0];
}

function newtonFunction(z) {
  return complexSub(complexPow4(z), { re: 1, im: 0 });
}

function newtonDerivative(z) {
  return complexScale(complexPow3(z), 4);
}

function newtonStep(z) {
  const derivative = newtonDerivative(z);
  const magnitudeSq = derivative.re * derivative.re + derivative.im * derivative.im;
  if (magnitudeSq < 1e-10) return null;
  return complexSub(z, complexDiv(newtonFunction(z), derivative));
}

function complexPow3(z) {
  return complexMul(complexMul(z, z), z);
}

function complexPow4(z) {
  const zz = complexMul(z, z);
  return complexMul(zz, zz);
}

function complexMul(a, b) {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

function complexSub(a, b) {
  return { re: a.re - b.re, im: a.im - b.im };
}

function complexScale(z, scalar) {
  return { re: z.re * scalar, im: z.im * scalar };
}

function complexDiv(a, b) {
  const denom = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  };
}

function complexAbs(z) {
  return Math.hypot(z.re, z.im);
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function fract(value) {
  return value - Math.floor(value);
}

function disableDepthTest() {
  const gl = drawingContext;
  if (gl && gl.disable) gl.disable(gl.DEPTH_TEST);
}

function enableDepthTest() {
  const gl = drawingContext;
  if (gl && gl.enable) gl.enable(gl.DEPTH_TEST);
}

function makeRng(seed) {
  let state = seed >>> 0;
  return function rng() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

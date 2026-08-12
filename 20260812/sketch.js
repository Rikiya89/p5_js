"use strict";

// Canvas, timing, palette, and export settings retained from this project.
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const CONFIG = {
  pointCount: 960,
  sphereScale: 405,
  vectorLengthScale: 128,
  vectorLengthMin: 0,
  vectorThickness: 1.25,
  curveBend: 13,
  anchorStride: 4,
  fieldA: 1,
  fieldB: 0,
  rotationSpeed: 1,
  cameraOrbitAmount: 72,
  cameraDistance: 1770,
  highlightSpeed: 2,
  highlightWidth: 0.055,
  baseAlpha: 178,
  glowAlpha: 18,
  heroFrame: 0.5,
};

let canvasEl = null;
let grainPg = null;
let hudPg = null;
let spherePoints = null;
let tangentVectors = null;
let magnitudes = null;
let loopProgress = 0;
let phase = 0;
let fieldAxis = { x: 0, y: 0, z: -1 };
let cameraView = { x: 0, y: 0, z: 1 };
let maxMagnitude = 1;

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

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  generateSpherePoints();
  bakeGrain();

  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").onclick = startRecording;
  if (el("stopBtn")) el("stopBtn").onclick = stopRecording;
  if (el("maxDuration")) el("maxDuration").textContent = MAX_DURATION;
  if (el("canvasSize")) el("canvasSize").textContent = W + " × " + H;
  if (el("maxFrames")) el("maxFrames").textContent = MAX_FRAMES;
}

// Fibonacci sampling avoids the density bands of latitude-longitude grids.
function generateSpherePoints() {
  spherePoints = new Float32Array(CONFIG.pointCount * 3);
  tangentVectors = new Float32Array(CONFIG.pointCount * 3);
  magnitudes = new Float32Array(CONFIG.pointCount);

  for (let i = 0; i < CONFIG.pointCount; i++) {
    const y = 1 - 2 * (i + 0.5) / CONFIG.pointCount;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = i * GOLDEN_ANGLE;
    const offset = i * 3;
    spherePoints[offset] = radius * Math.cos(angle);
    spherePoints[offset + 1] = y;
    spherePoints[offset + 2] = radius * Math.sin(angle);
  }
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

function updateLoopTime() {
  const frame = isRecording ? recFrameCount : frameCount;
  loopProgress = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  phase = loopProgress * TAU;
}

function draw() {
  updateLoopTime();
  renderFrame();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderFrame() {
  background(BG_R, BG_G, BG_B);
  perspective(PI / 3.35, W / H, 10, 5000);
  updateCamera();
  updateField();

  push();
  rotateZ(0.08 * Math.sin(phase * CONFIG.rotationSpeed));
  renderAtmosphere();
  renderSurfaceAnchors();
  renderVectorGlow();
  renderVectorField();
  renderTravelingHighlights();
  renderZero();
  pop();

  drawScreenFinish();
}

function updateCamera() {
  const heroEase = heroMix();
  const eyeX = CONFIG.cameraOrbitAmount * Math.sin(phase) * (1 - 0.72 * heroEase);
  const eyeY = -45 + 30 * Math.sin(phase * 2) * (1 - heroEase);
  const distance = CONFIG.cameraDistance + 24 * (1 - Math.cos(phase));
  const viewInv = 1 / Math.hypot(eyeX, eyeY, distance);
  cameraView.x = eyeX * viewInv;
  cameraView.y = eyeY * viewInv;
  cameraView.z = distance * viewInv;
  camera(eyeX, eyeY, distance, 0, 0, 0, 0, 1, 0);
}

// v = a - (a·p)p removes the radial projection of a. Since |p|=1,
// v·p = a·p - (a·p)(p·p) = 0, so every vector lies in the tangent plane.
// At p = ±a, the projection equals a itself and v becomes exactly zero.
function updateField() {
  let ax = 0.42 * Math.sin(phase);
  let ay = 0.18 * Math.sin(phase * 2);
  let az = -Math.cos(phase); // +z at the intentional midpoint hero frame.
  const axisInv = 1 / Math.hypot(ax, ay, az);
  ax *= axisInv;
  ay *= axisInv;
  az *= axisInv;
  fieldAxis.x = ax;
  fieldAxis.y = ay;
  fieldAxis.z = az;

  maxMagnitude = 0;
  for (let i = 0; i < CONFIG.pointCount; i++) {
    const offset = i * 3;
    const px = spherePoints[offset];
    const py = spherePoints[offset + 1];
    const pz = spherePoints[offset + 2];
    const radial = ax * px + ay * py + az * pz;
    const vx = CONFIG.fieldA * (ax - radial * px);
    const vy = CONFIG.fieldA * (ay - radial * py);
    const vz = CONFIG.fieldA * (az - radial * pz);
    const magnitude = Math.hypot(vx, vy, vz);
    tangentVectors[offset] = vx;
    tangentVectors[offset + 1] = vy;
    tangentVectors[offset + 2] = vz;
    magnitudes[i] = magnitude;
    if (magnitude > maxMagnitude) maxMagnitude = magnitude;
  }
}

function depthFade(px, py, pz) {
  const facing = constrain(
    px * cameraView.x + py * cameraView.y + pz * cameraView.z,
    -1,
    1
  );
  return 0.2 + 0.8 * Math.pow((facing + 1) * 0.5, 1.55);
}

function vectorGeometry(i) {
  const offset = i * 3;
  const px = spherePoints[offset];
  const py = spherePoints[offset + 1];
  const pz = spherePoints[offset + 2];
  const vx = tangentVectors[offset];
  const vy = tangentVectors[offset + 1];
  const vz = tangentVectors[offset + 2];
  const magnitude = magnitudes[i];
  const magnitudeRatio = maxMagnitude > 0 ? magnitude / maxMagnitude : 0;
  // No minimum clamp: stroke length truly tends to zero at each singularity.
  const length = CONFIG.vectorLengthScale * Math.pow(magnitudeRatio, 0.88);
  const scale = magnitude > 1e-9 ? length / magnitude : 0;
  const ux = vx * scale;
  const uy = vy * scale;
  const uz = vz * scale;
  let bendX = py * uz - pz * uy;
  let bendY = pz * ux - px * uz;
  let bendZ = px * uy - py * ux;
  const bendInv = 1 / (Math.hypot(bendX, bendY, bendZ) || 1);
  const bendWave = Math.sin(phase + 2.4 * (px + py - 0.65 * pz));
  const bendAmount = CONFIG.curveBend * magnitudeRatio * bendWave;
  bendX *= bendInv * bendAmount;
  bendY *= bendInv * bendAmount;
  bendZ *= bendInv * bendAmount;
  return {
    sx: px * CONFIG.sphereScale,
    sy: py * CONFIG.sphereScale,
    sz: pz * CONFIG.sphereScale,
    ux,
    uy,
    uz,
    bendX,
    bendY,
    bendZ,
    magnitudeRatio,
    depth: depthFade(px, py, pz),
  };
}

function drawHairCurve(g) {
  const startX = g.sx - g.ux * 0.15;
  const startY = g.sy - g.uy * 0.15;
  const startZ = g.sz - g.uz * 0.15;
  const endX = g.sx + g.ux * 0.85;
  const endY = g.sy + g.uy * 0.85;
  const endZ = g.sz + g.uz * 0.85;
  bezier(
    startX, startY, startZ,
    g.sx + g.ux * 0.16 + g.bendX * 0.78,
    g.sy + g.uy * 0.16 + g.bendY * 0.78,
    g.sz + g.uz * 0.16 + g.bendZ * 0.78,
    g.sx + g.ux * 0.58 + g.bendX,
    g.sy + g.uy * 0.58 + g.bendY,
    g.sz + g.uz * 0.58 + g.bendZ,
    endX, endY, endZ
  );
}

function renderVectorGlow() {
  blendMode(ADD);
  strokeWeight(5.2);
  for (let i = 0; i < CONFIG.pointCount; i++) {
    const g = vectorGeometry(i);
    if (g.magnitudeRatio < 0.015) continue;
    stroke(INK_R, INK_G, INK_B, CONFIG.glowAlpha * g.depth * g.magnitudeRatio);
    drawHairCurve(g);
  }
  blendMode(BLEND);
}

function renderVectorField() {
  for (let i = 0; i < CONFIG.pointCount; i++) {
    const g = vectorGeometry(i);
    if (g.magnitudeRatio < 0.002) continue;
    const alpha = CONFIG.baseAlpha * g.depth * (0.28 + 0.72 * g.magnitudeRatio);
    stroke(INK_R, INK_G, INK_B, alpha);
    strokeWeight(CONFIG.vectorThickness + 0.5 * g.magnitudeRatio);
    drawHairCurve(g);

    // A brighter root and finer tip create a subtle tapered filament.
    stroke(INK_R, INK_G, INK_B, alpha * 0.58);
    strokeWeight(2.1 + 0.55 * g.magnitudeRatio);
    line(
      g.sx - g.ux * 0.15,
      g.sy - g.uy * 0.15,
      g.sz - g.uz * 0.15,
      g.sx + g.ux * 0.04 + g.bendX * 0.28,
      g.sy + g.uy * 0.04 + g.bendY * 0.28,
      g.sz + g.uz * 0.04 + g.bendZ * 0.28
    );
  }
}

function renderTravelingHighlights() {
  blendMode(ADD);
  const head = (loopProgress * CONFIG.highlightSpeed) % 1;
  for (let i = 0; i < CONFIG.pointCount; i += 7) {
    const travel = (i * 0.61803398875) % 1;
    const wrapped = Math.abs(((travel - head + 1.5) % 1) - 0.5);
    const highlight = Math.max(0, 1 - wrapped / CONFIG.highlightWidth);
    if (highlight <= 0) continue;
    const g = vectorGeometry(i);
    const along = 0.15 + 0.7 * ((head * 2 + travel) % 1);
    stroke(INK_R, INK_G, INK_B, 190 * highlight * g.depth * g.magnitudeRatio);
    strokeWeight(3.2 + 2.4 * highlight);
    point(
      g.sx + g.ux * along,
      g.sy + g.uy * along,
      g.sz + g.uz * along
    );
  }
  blendMode(BLEND);
}

function renderAtmosphere() {
  noFill();
  strokeWeight(0.55);
  for (let ring = -2; ring <= 2; ring++) {
    const y = ring * CONFIG.sphereScale * 0.2;
    const radius = Math.sqrt(CONFIG.sphereScale ** 2 - y ** 2);
    stroke(INK_R, INK_G, INK_B, ring === 0 ? 10 : 5);
    beginShape();
    for (let i = 0; i <= 96; i++) {
      const a = i / 96 * TAU;
      vertex(radius * Math.cos(a), y, radius * Math.sin(a));
    }
    endShape();
  }
}

function renderSurfaceAnchors() {
  blendMode(ADD);
  for (let i = 0; i < CONFIG.pointCount; i += CONFIG.anchorStride) {
    const offset = i * 3;
    const px = spherePoints[offset];
    const py = spherePoints[offset + 1];
    const pz = spherePoints[offset + 2];
    const depth = depthFade(px, py, pz);
    const magnitudeRatio = maxMagnitude > 0 ? magnitudes[i] / maxMagnitude : 0;
    const radius = CONFIG.sphereScale - 2;
    stroke(
      INK_R,
      INK_G,
      INK_B,
      34 * depth * (0.25 + 0.75 * magnitudeRatio)
    );
    strokeWeight(1.1 + 1.1 * depth);
    point(px * radius, py * radius, pz * radius);
  }
  blendMode(BLEND);
}

function heroMix() {
  const distance = Math.abs(loopProgress - CONFIG.heroFrame);
  return Math.exp(-distance * distance / 0.0065);
}

function tangentBasis(nx, ny, nz) {
  const ux = Math.abs(ny) < 0.9 ? 0 : 1;
  const uy = Math.abs(ny) < 0.9 ? 1 : 0;
  let e1x = uy * nz;
  let e1y = -ux * nz;
  let e1z = ux * ny - uy * nx;
  const inv = 1 / Math.hypot(e1x, e1y, e1z);
  e1x *= inv; e1y *= inv; e1z *= inv;
  return {
    e1x, e1y, e1z,
    e2x: ny * e1z - nz * e1y,
    e2y: nz * e1x - nx * e1z,
    e2z: nx * e1y - ny * e1x,
  };
}

function renderZero() {
  const hero = heroMix();
  const nx = fieldAxis.x;
  const ny = fieldAxis.y;
  const nz = fieldAxis.z;
  const basis = tangentBasis(nx, ny, nz);
  const radius = CONFIG.sphereScale + 4;
  const cx = nx * radius;
  const cy = ny * radius;
  const cz = nz * radius;

  blendMode(ADD);
  noFill();
  for (let ring = 0; ring < 4; ring++) {
    const pulse = (loopProgress * 2 + ring / 4) % 1;
    const ringRadius = 14 + ring * 12 + pulse * 15;
    stroke(INK_R, INK_G, INK_B, (54 + 74 * hero) * (1 - pulse * 0.55));
    strokeWeight(0.9 + hero * 1.2);
    beginShape();
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * TAU;
      const u = Math.cos(a) * ringRadius;
      const v = Math.sin(a) * ringRadius;
      vertex(
        cx + basis.e1x * u + basis.e2x * v,
        cy + basis.e1y * u + basis.e2y * v,
        cz + basis.e1z * u + basis.e2z * v
      );
    }
    endShape();
  }
  stroke(INK_R, INK_G, INK_B, 170 + 85 * hero);
  strokeWeight(4 + 5 * hero);
  point(cx, cy, cz);
  blendMode(BLEND);
}

function drawScreenFinish() {
  const g = hudPg;
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

  g.noStroke();
  g.textFont("ui-monospace, Menlo, Consolas, monospace");
  g.textAlign(CENTER, CENTER);
  g.textStyle(BOLD);
  g.fill(INK_R, INK_G, INK_B, 246);
  g.textSize(50);
  g.text("YOU CANNOT COMB A SPHERE.", W * 0.5, 250);
  g.textStyle(NORMAL);
  g.fill(INK_R, INK_G, INK_B, 148);
  g.textSize(29);
  g.text("v(p) = a − (a · p)p     ·     v · p = 0", W * 0.5, 309);

  g.textAlign(LEFT, TOP);
  g.fill(INK_R, INK_G, INK_B, 76);
  g.textSize(19);
  g.text("FIELD       T(S²)", 70, 390);
  g.text("SAMPLES     " + CONFIG.pointCount + " · FIBONACCI", 70, 425);
  g.text("ZERO        p = ±a", 70, 460);
  g.textAlign(RIGHT, TOP);
  g.text("MAGNITUDE   |v| = √(1 − (a·p)²)", W - 70, 390);
  g.text("INDEX SUM   2", W - 70, 425);
  g.text("LOOP        " + MAX_DURATION + "s · DETERMINISTIC", W - 70, 460);

  const hero = heroMix();
  g.textAlign(CENTER, CENTER);
  g.fill(INK_R, INK_G, INK_B, 72 + 164 * hero);
  g.textSize(18);
  g.text("|v| → 0", W * 0.5, 1450);
  g.textSize(15);
  g.fill(INK_R, INK_G, INK_B, 50 + 110 * hero);
  g.text("UNAVOIDABLE ZERO", W * 0.5, 1480);

  g.fill(INK_R, INK_G, INK_B, 42);
  g.textSize(16);
  g.textAlign(LEFT, BOTTOM);
  g.text(W + "×" + H + " · " + FPS + "fps", 52, H - 52);
  g.textAlign(RIGHT, BOTTOM);
  g.text("20260812 · LOOP " + loopProgress.toFixed(3), W - 52, H - 52);

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
    saveCanvas("hairy_ball_theorem_" + getTimestamp(), "png");
    return false;
  }
  return true;
}

function updateRecordingUI() {
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = (recFrameCount / FPS).toFixed(1);
  if (el("frameCount")) el("frameCount").textContent = recFrameCount;
  if (el("progressFill")) {
    el("progressFill").style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
  }
}

function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs not supported.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer not loaded.");
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
  a.download = "hairy_ball_theorem_" + getTimestamp() + ".mp4";
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
  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(textValue, colorValue) {
  const el = document.getElementById("status");
  if (el) {
    el.textContent = textValue;
    el.style.color = colorValue;
  }
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

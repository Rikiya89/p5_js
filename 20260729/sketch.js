"use strict";

// ─── Canvas / export: retained from the existing project ────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = FPS * MAX_DURATION;
const TAU = Math.PI * 2;

// Existing monochrome palette — unchanged.
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const PARAMS = {
  surfaceRadius: 390,
  surfaceHeight: 145,
  radialSteps: 18,
  angularSteps: 72,
  boundarySamples: 144,
  boundaryParticles: 24,
  fieldRings: 5,
  fieldParticlesPerRing: 10,
  curlRings: 4,
  normalStrideR: 4,
  normalStrideA: 8,
};

let canvasEl = null;
let grainPg = null;
let hudPg = null;
let grainSeed = 20260729;
let loopProgress = 0;
let phase = 0;

// Reused numeric buffers. No p5.Vector allocation occurs in draw().
let surfacePoints;
let surfaceNormals;
let boundaryPoints;

// ─── Recording: existing deterministic WebCodecs/mp4-muxer pipeline ─────────
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
  grainPg.colorMode(RGB, 255, 255, 255, 255);
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  hudPg.colorMode(RGB, 255, 255, 255, 255);

  const pointCount = (PARAMS.radialSteps + 1) * PARAMS.angularSteps * 3;
  surfacePoints = new Float32Array(pointCount);
  surfaceNormals = new Float32Array(pointCount);
  boundaryPoints = new Float32Array(PARAMS.boundarySamples * 3);

  reseed(grainSeed);

  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").onclick = startRecording;
  if (el("stopBtn")) el("stopBtn").onclick = stopRecording;
  if (el("maxDuration")) el("maxDuration").textContent = MAX_DURATION;
  if (el("canvasSize")) el("canvasSize").textContent = W + " × " + H;
  if (el("maxFrames")) el("maxFrames").textContent = MAX_FRAMES;
}

function reseed(seed) {
  grainSeed = seed;
  randomSeed(seed);
  noiseSeed(seed);
  bakeGrain();
}

function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  randomSeed(grainSeed);
  for (let i = 0, n = Math.floor(W * H * 0.0016); i < n; i++) {
    const v = random(110, 200);
    grainPg.fill(v, v, v, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.15, 0.85));
  }
  for (let i = 0, n = Math.floor(W * H * 0.000035); i < n; i++) {
    const v = random(210, 255);
    grainPg.fill(v, v, v, random(12, 34));
    grainPg.circle(random(W), random(H), random(0.4, 1.2));
  }
}

// ─── Seamless loop clock ────────────────────────────────────────────────────
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
  perspective(PI / 3.25, W / H, 10, 5000);
  updateCamera();
  updateGeometry();

  // The sculpture uses additive white layers over the inherited near-black field.
  blendMode(ADD);
  drawAmbientField();
  drawSurface();
  drawSurfaceMesh();
  drawSurfacePulse();
  drawCurlField();
  drawSurfaceNormals();
  drawBoundaryCurve();
  drawBoundaryCirculation();
  drawParticles();
  blendMode(BLEND);

  drawScreenFinish();
}

// A gently warped disk. Its moving quadratic height field is periodic in phase,
// so positions and derivatives match exactly at the loop seam.
function surfaceZ(x, y) {
  const R = PARAMS.surfaceRadius;
  const nx = x / R;
  const ny = y / R;
  const r2 = nx * nx + ny * ny;
  const saddle = (nx * nx - ny * ny) * cos(phase) + 2 * nx * ny * sin(phase);
  const breathingWave = sin(TAU * r2 - phase) * (1 - r2) * 0.36;
  return PARAMS.surfaceHeight * (0.78 * saddle + breathingWave);
}

function updateGeometry() {
  const R = PARAMS.surfaceRadius;
  const dr = R / PARAMS.radialSteps;
  const eps = 1.25;
  let p = 0;

  for (let ir = 0; ir <= PARAMS.radialSteps; ir++) {
    const r = ir * dr;
    for (let ia = 0; ia < PARAMS.angularSteps; ia++) {
      const a = (ia / PARAMS.angularSteps) * TAU;
      const x = r * cos(a);
      const y = r * sin(a);
      const z = surfaceZ(x, y);
      surfacePoints[p] = x;
      surfacePoints[p + 1] = y;
      surfacePoints[p + 2] = z;

      // n ∝ (-dz/dx, -dz/dy, 1), oriented toward +z.
      let nx = -(surfaceZ(x + eps, y) - surfaceZ(x - eps, y)) / (2 * eps);
      let ny = -(surfaceZ(x, y + eps) - surfaceZ(x, y - eps)) / (2 * eps);
      let nz = 1;
      const inv = 1 / sqrt(nx * nx + ny * ny + nz * nz);
      surfaceNormals[p] = nx * inv;
      surfaceNormals[p + 1] = ny * inv;
      surfaceNormals[p + 2] = nz * inv;
      p += 3;
    }
  }

  for (let i = 0; i < PARAMS.boundarySamples; i++) {
    const a = (i / PARAMS.boundarySamples) * TAU;
    const x = R * cos(a);
    const y = R * sin(a);
    boundaryPoints[i * 3] = x;
    boundaryPoints[i * 3 + 1] = y;
    boundaryPoints[i * 3 + 2] = surfaceZ(x, y);
  }
}

// A full revolution over one loop, with a gentle periodic elevation change.
function updateCamera() {
  const orbit = phase - PI * 0.5;
  const distance = 1280 + 45 * cos(phase * 2);
  const eyeX = distance * cos(orbit);
  const eyeY = distance * sin(orbit);
  const eyeZ = 690 + 55 * sin(phase * 2);
  camera(eyeX, eyeY, eyeZ, 0, 0, 10, 0, 0, 1);
}

function pointIndex(ir, ia) {
  const wrappedA = (ia + PARAMS.angularSteps) % PARAMS.angularSteps;
  return (ir * PARAMS.angularSteps + wrappedA) * 3;
}

function drawSurface() {
  push();
  noStroke();
  fill(INK_R, INK_G, INK_B, 12);
  for (let ir = 0; ir < PARAMS.radialSteps; ir++) {
    beginShape(TRIANGLE_STRIP);
    for (let ia = 0; ia <= PARAMS.angularSteps; ia++) {
      let k = pointIndex(ir, ia);
      vertex(surfacePoints[k], surfacePoints[k + 1], surfacePoints[k + 2]);
      k = pointIndex(ir + 1, ia);
      vertex(surfacePoints[k], surfacePoints[k + 1], surfacePoints[k + 2]);
    }
    endShape();
  }
  pop();
}

function drawSurfaceMesh() {
  push();
  noFill();
  stroke(INK_R, INK_G, INK_B, 50);
  strokeWeight(0.75);

  for (let ir = 1; ir <= PARAMS.radialSteps; ir++) {
    beginShape();
    for (let ia = 0; ia <= PARAMS.angularSteps; ia++) {
      const k = pointIndex(ir, ia);
      vertex(surfacePoints[k], surfacePoints[k + 1], surfacePoints[k + 2]);
    }
    endShape();
  }
  for (let ia = 0; ia < PARAMS.angularSteps; ia += 4) {
    beginShape();
    for (let ir = 0; ir <= PARAMS.radialSteps; ir++) {
      const k = pointIndex(ir, ia);
      vertex(surfacePoints[k], surfacePoints[k + 1], surfacePoints[k + 2]);
    }
    endShape();
  }
  pop();
}

// A radial wave converges on the interior while the boundary simultaneously
// brightens. That shared pulse is the visual equality between the two integrals.
function drawSurfacePulse() {
  const pulseRadius = PARAMS.surfaceRadius * (0.12 + 0.88 * (0.5 - 0.5 * cos(phase)));
  const sigma = 30;
  push();
  noFill();
  for (let ir = 1; ir <= PARAMS.radialSteps; ir++) {
    const r = (ir / PARAMS.radialSteps) * PARAMS.surfaceRadius;
    const intensity = exp(-sq(r - pulseRadius) / (2 * sigma * sigma));
    if (intensity < 0.025) continue;
    stroke(INK_R, INK_G, INK_B, 125 * intensity);
    strokeWeight(0.8 + 2.4 * intensity);
    beginShape();
    for (let ia = 0; ia <= PARAMS.angularSteps; ia++) {
      const k = pointIndex(ir, ia);
      vertex(surfacePoints[k], surfacePoints[k + 1], surfacePoints[k + 2] + 2);
    }
    endShape();
  }
  pop();
}

function drawBoundaryCurve() {
  const boundaryPulse = pow(0.5 - 0.5 * cos(phase), 2);
  push();
  noFill();

  // Layered strokes form a restrained monochrome glow.
  stroke(INK_R, INK_G, INK_B, 18 + 24 * boundaryPulse);
  strokeWeight(13);
  drawBoundaryPolyline();
  stroke(INK_R, INK_G, INK_B, 70 + 65 * boundaryPulse);
  strokeWeight(4.5);
  drawBoundaryPolyline();
  stroke(INK_R, INK_G, INK_B, 235);
  strokeWeight(1.4);
  drawBoundaryPolyline();
  pop();
}

function drawBoundaryPolyline() {
  beginShape();
  for (let i = 0; i <= PARAMS.boundarySamples; i++) {
    const k = (i % PARAMS.boundarySamples) * 3;
    vertex(boundaryPoints[k], boundaryPoints[k + 1], boundaryPoints[k + 2] + 4);
  }
  endShape();
}

// F=(-y/2,x/2,0). Along the projected circular boundary, F is tangent and
// counter-clockwise; curl(F)=(0,0,1). Thus both integrals equal πR².
function drawBoundaryCirculation() {
  const R = PARAMS.surfaceRadius;
  for (let i = 0; i < PARAMS.boundaryParticles; i++) {
    const a = phase + (i / PARAMS.boundaryParticles) * TAU;
    const x = R * cos(a);
    const y = R * sin(a);
    const z = surfaceZ(x, y) + 9;
    const head = 0.5 + 0.5 * cos(phase - i * 0.7);

    push();
    translate(x, y, z);
    noStroke();
    fill(INK_R, INK_G, INK_B, 35);
    sphere(10 + 5 * head, 5, 4);
    fill(INK_R, INK_G, INK_B, 225);
    sphere(2.8 + 1.6 * head, 5, 4);
    pop();

    if (i % 4 === 0) drawArrow3D(x, y, z, -sin(a), cos(a), 0, 42, 170, 1.4);
  }
}

// Sparse streamlines and tracers expose the ambient vector field F.
function drawAmbientField() {
  push();
  noFill();
  for (let ring = 0; ring < PARAMS.fieldRings; ring++) {
    const radius = 465 + ring * 70;
    const z = -235 + ring * 116 + 25 * sin(phase * 2 + ring);
    stroke(INK_R, INK_G, INK_B, 13 + ring * 2);
    strokeWeight(0.7);
    beginShape();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      vertex(radius * cos(a), radius * sin(a), z);
    }
    endShape();

    for (let i = 0; i < PARAMS.fieldParticlesPerRing; i++) {
      const a = phase * (0.45 + ring * 0.04) + (i / PARAMS.fieldParticlesPerRing) * TAU;
      push();
      translate(radius * cos(a), radius * sin(a), z);
      noStroke();
      fill(INK_R, INK_G, INK_B, 70);
      sphere(2.2, 4, 3);
      pop();
    }
  }
  pop();
}

// The curl is exactly +z everywhere. Each glyph pierces the moving surface;
// a rotating halo makes its local axial rotation legible without changing curl.
function drawCurlField() {
  for (let ring = 0; ring < PARAMS.curlRings; ring++) {
    const r = 70 + ring * 82;
    const count = 6 + ring * 4;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + ring * 0.31;
      const x = r * cos(a);
      const y = r * sin(a);
      const z = surfaceZ(x, y);
      const pulse = 0.5 + 0.5 * cos(phase - r / PARAMS.surfaceRadius * PI);
      drawCurlGlyph(x, y, z, a + phase * 2, pulse);
    }
  }
}

function drawCurlGlyph(x, y, z, rotationAngle, pulseValue) {
  const length = 58 + 26 * pulseValue;
  drawArrow3D(x, y, z - length * 0.45, 0, 0, 1, length, 65 + 110 * pulseValue, 1.0);

  push();
  translate(x, y, z + 6);
  rotateZ(rotationAngle);
  noFill();
  stroke(INK_R, INK_G, INK_B, 40 + 65 * pulseValue);
  strokeWeight(0.8);
  arc(0, 0, 22, 22, 0.18, TAU - 0.45);
  line(10, -4, 15, -1);
  line(10, -4, 11, -10);
  pop();
}

function drawSurfaceNormals() {
  for (let ir = PARAMS.normalStrideR; ir < PARAMS.radialSteps; ir += PARAMS.normalStrideR) {
    for (let ia = 0; ia < PARAMS.angularSteps; ia += PARAMS.normalStrideA) {
      const k = pointIndex(ir, ia);
      const emphasis = ir === PARAMS.normalStrideR * 2 && ia === 0;
      drawArrow3D(
        surfacePoints[k], surfacePoints[k + 1], surfacePoints[k + 2] + 3,
        surfaceNormals[k], surfaceNormals[k + 1], surfaceNormals[k + 2],
        emphasis ? 72 : 34, emphasis ? 150 : 42, emphasis ? 1.3 : 0.65
      );
    }
  }
}

function drawParticles() {
  // Flux particles climb through S along curl(F), synchronized to one loop.
  const rows = 9;
  for (let i = 0; i < 42; i++) {
    const ring = 1 + (i % rows);
    const r = (ring / (rows + 1)) * PARAMS.surfaceRadius * 0.9;
    const a = i * 2.399963229728653;
    const x = r * cos(a);
    const y = r * sin(a);
    const baseZ = surfaceZ(x, y);
    const travel = (loopProgress + i * 0.137) % 1;
    const z = baseZ + map(travel, 0, 1, -145, 175);
    const fade = sin(PI * travel);
    push();
    translate(x, y, z);
    noStroke();
    fill(INK_R, INK_G, INK_B, 105 * fade);
    sphere(1.8 + 2.2 * fade, 4, 3);
    pop();
  }
}

function drawArrow3D(x, y, z, dx, dy, dz, length, alpha, weight) {
  const mag = sqrt(dx * dx + dy * dy + dz * dz) || 1;
  dx /= mag; dy /= mag; dz /= mag;
  const ex = x + dx * length;
  const ey = y + dy * length;
  const ez = z + dz * length;
  const head = min(11, length * 0.24);

  stroke(INK_R, INK_G, INK_B, alpha);
  strokeWeight(weight);
  line(x, y, z, ex, ey, ez);

  // Stable perpendicular for the two arrowhead strokes.
  let px = -dy, py = dx, pz = 0;
  let pm = sqrt(px * px + py * py + pz * pz);
  if (pm < 0.01) { px = 1; py = 0; pz = 0; pm = 1; }
  px /= pm; py /= pm; pz /= pm;
  const bx = ex - dx * head;
  const by = ey - dy * head;
  const bz = ez - dz * head;
  line(ex, ey, ez, bx + px * head * 0.45, by + py * head * 0.45, bz + pz * head * 0.45);
  line(ex, ey, ez, bx - px * head * 0.45, by - py * head * 0.45, bz - pz * head * 0.45);
}

// Screen-space finish keeps the established editorial restraint and grain.
function drawScreenFinish() {
  // Render typography in a 2D buffer. This avoids browser-dependent WEBGL text
  // support while keeping the artwork itself on the WEBGL canvas.
  const g = hudPg;
  g.clear();
  g.push();
  g.image(grainPg, 0, 0);

  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, 38);
  g.strokeWeight(0.7);
  const m = 34, L = 24;
  g.line(m, m, m + L, m); g.line(m, m, m, m + L);
  g.line(W - m, m, W - m - L, m); g.line(W - m, m, W - m, m + L);
  g.line(m, H - m, m + L, H - m); g.line(m, H - m, m, H - m - L);
  g.line(W - m, H - m, W - m - L, H - m); g.line(W - m, H - m, W - m, H - m - L);

  g.noStroke();
  g.textFont("ui-monospace, Menlo, Consolas, monospace");

  // Editorial hierarchy follows the established series: a large conceptual
  // hook, one compact identity, then quiet mathematical notes on both sides.
  g.textAlign(CENTER, CENTER);
  g.textStyle(BOLD);
  g.fill(INK_R, INK_G, INK_B, 246);
  g.textSize(39);
  g.text("BOUNDARY EQUALS SURFACE.", W * 0.5, 250);

  g.textStyle(NORMAL);
  g.fill(INK_R, INK_G, INK_B, 146);
  g.textSize(20);
  g.text("∮∂S F·dr  =  ∬S (∇×F)·n dS", W * 0.5, 305);

  g.textAlign(LEFT, TOP);
  g.fill(INK_R, INK_G, INK_B, 78);
  g.textSize(11);
  g.text("BOUNDARY   ∂S", 70, 386);
  g.text("FIELD      F = ½(−y, x, 0)", 70, 409);
  g.text("CIRCULATION   ∮∂S F·dr", 70, 432);

  g.textAlign(RIGHT, TOP);
  g.text("SURFACE    S · n = +ẑ", W - 70, 386);
  g.text("CURL       ∇×F = (0, 0, 1)", W - 70, 409);
  g.text("FLUX       ∬S (∇×F)·n dS", W - 70, 432);

  g.fill(INK_R, INK_G, INK_B, 42);
  g.textSize(10);
  g.textAlign(LEFT, BOTTOM);
  g.text(W + "×" + H + " · " + FPS + "fps", 52, H - 52);
  g.textAlign(RIGHT, BOTTOM);
  g.text("20260729 · LOOP " + loopProgress.toFixed(3), W - 52, H - 52);
  g.pop();

  // Composite the 2D HUD in screen coordinates after all 3D geometry.
  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  // resetMatrix() does not reset the active view camera in p5 WEBGL.
  // Restore the default screen-facing camera before placing the HUD plane.
  camera();
  ortho();
  noLights();
  noStroke();
  blendMode(BLEND);
  texture(hudPg);
  plane(W, H);
  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

// ─── Interaction / recording ────────────────────────────────────────────────
function mousePressed() {
  reseed(Math.floor(random(100000)));
}

function keyReleased() {
  if (key === "r" || key === "R") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === "s" || key === "S") {
    saveCanvas("stokes_theorem_" + getTimestamp(), "png");
    return false;
  }
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    reseed(Math.floor(random(100000)));
    return false;
  }
  return true;
}

function updateRecordingUI() {
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = (recFrameCount / FPS).toFixed(1);
  if (el("frameCount")) el("frameCount").textContent = recFrameCount;
  const fill = el("progressFill");
  if (fill) fill.style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
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
  // Recording always restarts the normalized loop at frame zero.
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
  a.download = "stokes_theorem_" + getTimestamp() + ".mp4";
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
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

if (typeof window !== "undefined") {
  window.startRecording = startRecording;
  window.stopRecording = stopRecording;
}

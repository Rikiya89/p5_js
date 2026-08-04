"use strict";

// ─── Canvas / export: retained from the existing project ────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = FPS * MAX_DURATION;
const TAU = Math.PI * 2;

// Existing monochrome palette — exact values unchanged.
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const PARAMS = {
  fiberCount: 32,
  samplesPerFiber: 160,
  structureScale: 155,
  fiberWeight: 1.65,
  emphasisWeight: 2.4,
  cameraDistance: 1220,
  orbitAmount: 0.22,
  rotationSpeed: 1.0,
  deformationAmount: 0.045,
  highlightSpeed: 1.0,
  highlightLength: 0.055,
  baseAlpha: 92,
  guideAlpha: 16,
  projectionPoleLimit: 0.965,
};

let canvasEl = null;
let grainPg = null;
let hudPg = null;
let grainSeed = 20260804;
let loopProgress = 0;
let phase = 0;

// Geometry is allocated once. Each fiber stores samplesPerFiber projected R³
// positions; no p5.Vector allocations occur inside draw().
let fiberPoints = null;
let fiberCentres = null;
let fiberEta = null;
let fiberDelta = null;

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

  fiberPoints = new Float32Array(
    PARAMS.fiberCount * PARAMS.samplesPerFiber * 3
  );
  fiberCentres = new Float32Array(PARAMS.fiberCount * 3);
  fiberEta = new Float32Array(PARAMS.fiberCount);
  fiberDelta = new Float32Array(PARAMS.fiberCount);
  buildFiberParameters();

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
  perspective(PI / 3.35, W / H, 10, 5000);
  updateCamera();
  updateFiberGeometry();

  push();
  applyStructureTransform();
  blendMode(ADD);
  drawGuideSphere();
  drawFibers();
  drawFiberHighlights();
  blendMode(BLEND);
  pop();

  drawScreenFinish();
}

// ─── Hopf fibration mathematics ─────────────────────────────────────────────
// A base point on S² fixes eta and delta = ξ₂ - ξ₁. Moving a shared angle t
// through both complex phases traces one Hopf fiber on S³:
//   z₁ = exp(i t) cos(eta)
//   z₂ = exp(i (t + delta)) sin(eta)
// Different (eta, delta) pairs specify distinct fibers. Under stereographic
// projection every selected S³ circle becomes a closed circle in R³, and any
// two distinct fibers have linking number one.
function buildFiberParameters() {
  const goldenAngle = PI * (3 - sqrt(5));
  const baseLatitude = 0.48;
  const latitudeExtent = 0.28;

  for (let fiber = 0; fiber < PARAMS.fiberCount; fiber++) {
    // Fibonacci-distributed base points over a broad, pole-safe band of S².
    // Hopf base coordinates are (sin(2eta)cos(delta),
    // sin(2eta)sin(delta), cos(2eta)).
    const u = (fiber + 0.5) / PARAMS.fiberCount;
    const baseZ = baseLatitude + latitudeExtent * (1 - 2 * u);
    fiberEta[fiber] = 0.5 * acos(baseZ);
    fiberDelta[fiber] = (fiber * goldenAngle + 0.38) % TAU;
  }
}

function updateFiberGeometry() {
  const samples = PARAMS.samplesPerFiber;
  const scale = PARAMS.structureScale;
  const breathe = 1 + PARAMS.deformationAmount * (0.5 - 0.5 * cos(phase));
  const fiberShift = 0.09 * sin(phase);

  for (let fiber = 0; fiber < PARAMS.fiberCount; fiber++) {
    const eta = fiberEta[fiber];
    const delta = fiberDelta[fiber];
    const cosEta = cos(eta);
    const sinEta = sin(eta);
    let centreX = 0;
    let centreY = 0;
    let centreZ = 0;

    for (let sample = 0; sample < samples; sample++) {
      const t = (sample / samples) * TAU + fiberShift;

      // S³ point (x1, y1, x2, y2) from the two complex coordinates.
      const x1 = cosEta * cos(t);
      const y1 = cosEta * sin(t);
      const x2 = sinEta * cos(t + delta);
      const y2 = sinEta * sin(t + delta);

      const pointOffset = (fiber * samples + sample) * 3;
      stereographicProject(
        x1, y1, x2, y2,
        pointOffset,
        scale * breathe,
        t,
        fiber
      );
      centreX += fiberPoints[pointOffset];
      centreY += fiberPoints[pointOffset + 1];
      centreZ += fiberPoints[pointOffset + 2];
    }

    const centreOffset = fiber * 3;
    fiberCentres[centreOffset] = centreX / samples;
    fiberCentres[centreOffset + 1] = centreY / samples;
    fiberCentres[centreOffset + 2] = centreZ / samples;
  }
}

// Stereographic projection from the north pole (0,0,0,1) of S³:
//   (X,Y,Z) = (x1,y1,x2) / (1-y2)
// The selected base-point band keeps the denominator safely away from zero.
function stereographicProject(x1, y1, x2, y2, offset, scale, t, fiber) {
  const denominator = max(1 - y2, 1 - PARAMS.projectionPoleLimit);
  const inverse = 1 / denominator;
  const radialWave = 1 + 0.014 * sin(2 * t + phase + fiber * 0.27);

  fiberPoints[offset] = x1 * inverse * scale * radialWave;
  fiberPoints[offset + 1] = y1 * inverse * scale * radialWave;
  fiberPoints[offset + 2] = x2 * inverse * scale * radialWave;
}

// All terms are periodic in phase. rotationSpeed is intentionally integral,
// so rotateZ advances by exactly one full turn over the exported loop.
function applyStructureTransform() {
  rotateX(-0.18 + 0.06 * sin(phase));
  rotateY(0.36 + 0.10 * cos(phase));
  rotateZ(phase * PARAMS.rotationSpeed);
}

function updateCamera() {
  const orbit = -PI * 0.5 + PARAMS.orbitAmount * sin(phase);
  const distance = PARAMS.cameraDistance + 28 * (1 - cos(phase));
  const eyeX = distance * cos(orbit);
  const eyeY = distance * sin(orbit);
  const eyeZ = 40 + 54 * sin(phase);
  camera(eyeX, eyeY, eyeZ, 0, 0, 0, 0, 0, 1);
}

// ─── Fiber rendering ─────────────────────────────────────────────────────────
function drawFibers() {
  noFill();
  const samples = PARAMS.samplesPerFiber;

  for (let fiber = 0; fiber < PARAMS.fiberCount; fiber++) {
    const centreOffset = fiber * 3;
    const depth = constrain(
      0.5 + fiberCentres[centreOffset + 2] / (PARAMS.structureScale * 5.2),
      0,
      1
    );
    const hierarchy = fiber % 8 === 0;
    const alpha = PARAMS.baseAlpha * (0.48 + 0.52 * depth);

    stroke(INK_R, INK_G, INK_B, alpha);
    strokeWeight(hierarchy ? PARAMS.emphasisWeight : PARAMS.fiberWeight);
    beginShape();
    for (let sample = 0; sample <= samples; sample++) {
      const wrapped = sample % samples;
      const offset = (fiber * samples + wrapped) * 3;
      vertex(
        fiberPoints[offset],
        fiberPoints[offset + 1],
        fiberPoints[offset + 2]
      );
    }
    endShape();
  }
}

function drawFiberHighlights() {
  const samples = PARAMS.samplesPerFiber;
  const halfLength = max(3, floor(samples * PARAMS.highlightLength));

  for (let fiber = 0; fiber < PARAMS.fiberCount; fiber++) {
    const travel = (
      loopProgress * PARAMS.highlightSpeed + fiber / PARAMS.fiberCount
    ) % 1;
    const head = floor(travel * samples);

    // A short tapered energy pulse follows the actual fiber coordinates.
    for (let step = -halfLength; step <= halfLength; step++) {
      const sampleA = (head + step + samples) % samples;
      const sampleB = (sampleA + 1) % samples;
      const offsetA = (fiber * samples + sampleA) * 3;
      const offsetB = (fiber * samples + sampleB) * 3;
      const falloff = 0.5 + 0.5 * cos((step / halfLength) * PI);

      stroke(INK_R, INK_G, INK_B, 175 * falloff);
      strokeWeight(PARAMS.fiberWeight + 2.6 * falloff);
      line(
        fiberPoints[offsetA], fiberPoints[offsetA + 1], fiberPoints[offsetA + 2],
        fiberPoints[offsetB], fiberPoints[offsetB + 1], fiberPoints[offsetB + 2]
      );
    }
  }
}

// A very quiet reference sphere reinforces that the object is one coherent
// fibration, while remaining subordinate to the linked circles.
function drawGuideSphere() {
  push();
  noFill();
  stroke(INK_R, INK_G, INK_B, PARAMS.guideAlpha);
  strokeWeight(0.65);
  const radius = PARAMS.structureScale * 1.02;

  for (let ring = -2; ring <= 2; ring++) {
    const z = ring * radius * 0.19;
    const ringRadius = sqrt(max(0, radius * radius - z * z));
    beginShape();
    for (let sample = 0; sample <= 96; sample++) {
      const a = (sample / 96) * TAU;
      vertex(ringRadius * cos(a), ringRadius * sin(a), z);
    }
    endShape();
  }
  pop();
}

// Screen-space finish keeps the established editorial restraint and grain.
function drawScreenFinish() {
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
  g.textAlign(CENTER, CENTER);
  g.textStyle(BOLD);
  g.fill(INK_R, INK_G, INK_B, 246);
  g.textSize(48);
  g.text("EVERY CIRCLE LINKS EVERY OTHER.", W * 0.5, 250);

  g.textStyle(NORMAL);
  g.fill(INK_R, INK_G, INK_B, 146);
  g.textSize(32);
  g.text("S³  →  S²    ·    π : S³ \\ {N}  →  ℝ³", W * 0.5, 305);

  g.textAlign(LEFT, TOP);
  g.fill(INK_R, INK_G, INK_B, 78);
  g.textSize(22);
  g.text("FIBER      t ↦ (z₁, z₂)", 70, 386);
  g.text("z₁         eⁱᵗ cos(η)", 70, 423);
  g.text("z₂         eⁱ⁽ᵗ⁺δ⁾ sin(η)", 70, 460);

  g.textAlign(RIGHT, TOP);
  g.text("BASE       (η, δ) ∈ S²", W - 70, 386);
  g.text("LINKING    Lk(Fᵢ, Fⱼ) = 1", W - 70, 423);
  g.text("PROJECT    (x₁,y₁,x₂)/(1−y₂)", W - 70, 460);

  g.fill(INK_R, INK_G, INK_B, 42);
  g.textSize(16);
  g.textAlign(LEFT, BOTTOM);
  g.text(W + "×" + H + " · " + FPS + "fps", 52, H - 52);
  g.textAlign(RIGHT, BOTTOM);
  g.text("20260804 · LOOP " + loopProgress.toFixed(3), W - 52, H - 52);
  g.pop();

  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
  ortho(-W * 0.5, W * 0.5, -H * 0.5, H * 0.5, -10, 10);
  noLights();
  blendMode(BLEND);
  image(hudPg, -W * 0.5, -H * 0.5, W, H);
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
    saveCanvas("hopf_fibration_" + getTimestamp(), "png");
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
  a.download = "hopf_fibration_" + getTimestamp() + ".mp4";
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

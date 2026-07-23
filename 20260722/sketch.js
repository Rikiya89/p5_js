"use strict";

// ─── Canvas / export ──────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = FPS * MAX_DURATION;

const TAU = Math.PI * 2;

// ─── Existing monochrome palette — unchanged ────────────────────────────────
const BG_R = 3,
  BG_G = 3,
  BG_B = 5;
const INK_R = 255,
  INK_G = 255,
  INK_B = 255;

// ─── Editable artwork parameters ─────────────────────────────────────────────
const PARAMS = {
  powerN: 5, // z^n: integer powers preserve a seamless loop
  pointCount: 96, // angular samples on every complex circle
  radialLayers: 5, // sampled magnitudes r
  outerRadius: 408,
  innerRadius: 0.54, // smallest sampled magnitude
  motionRange: 0.34, // slow ±19.5° input sweep; output still follows nθ
  lineAlpha: 60,
  glowStrength: 1.20,
  proofPointAngle: -0.34 * Math.PI,
};

const COMPOSITION_CENTER = { x: W * 0.5, y: H * 0.51 };

let pg, glowPg, halfPg, quartPg, eighthPg, sixteenthPg, grainPg;
let canvasEl = null;
let grainSeed = 20260722;

// ─── Recording ───────────────────────────────────────────────────────────────
let muxer = null,
  encoder = null;
let isRecording = false,
  recFrameCount = 0;

function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);
  glowPg = createGraphics(W, H);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);
  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  quartPg = createGraphics(W >> 2, H >> 2);
  quartPg.pixelDensity(1);
  eighthPg = createGraphics(W >> 3, H >> 3);
  eighthPg.pixelDensity(1);
  sixteenthPg = createGraphics(W >> 4, H >> 4);
  sixteenthPg.pixelDensity(1);
  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);

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

// ─── Animation ───────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const progress = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  renderFrame(progress);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderFrame(progress) {
  const loopPhase = progress * TAU;
  const motionPhase = Math.sin(loopPhase) * PARAMS.motionRange;
  pg.clear();
  glowPg.clear();
  drawDeMoivreSystem(glowPg, motionPhase, loopPhase, true);
  drawDeMoivreSystem(pg, motionPhase, loopPhase, false);
  composite(loopPhase);
  drawEditorialOverlay(progress, loopPhase);
  drawCornerBrackets();
  drawVignette();
}

// For z = r(cos(theta) + i sin(theta)), the exact power is
// z^n = r^n(cos(n theta) + i sin(n theta)). Every endpoint below is computed
// from that identity; the lines are mappings, not random particle motion.
function drawDeMoivreSystem(g, phase, loopPhase, isGlow) {
  const n = PARAMS.powerN;
  const R = PARAMS.outerRadius;
  const sampleCount = PARAMS.pointCount;

  g.push();
  g.translate(COMPOSITION_CENTER.x, COMPOSITION_CENTER.y);
  g.noFill();

  drawComplexPlane(g, loopPhase, isGlow);

  for (let layer = 0; layer < PARAMS.radialLayers; layer++) {
    const layerT = layer / Math.max(1, PARAMS.radialLayers - 1);
    const magnitude = lerp(1, PARAMS.innerRadius, layerT);
    const outputMagnitude = Math.pow(magnitude, n);
    const layerOffset = (layer * TAU) / (sampleCount * PARAMS.radialLayers);

    for (let i = 0; i < sampleCount; i++) {
      const theta = (i / sampleCount) * TAU + phase + layerOffset;
      const outputTheta = n * theta;
      const input = polarPoint(magnitude * R, theta);
      const output = polarPoint(outputMagnitude * R, outputTheta);
      const harmonic = 0.5 + 0.5 * Math.cos((n - 1) * theta - phase * 2);
      const alpha =
        (isGlow ? 6 : PARAMS.lineAlpha) *
        (0.42 + 0.58 * harmonic) *
        (1 - layerT * 0.34);

      g.stroke(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
      g.strokeWeight(isGlow ? 4.8 : 0.72);
      g.line(input.x, input.y, output.x, output.y);

      if (i % 8 === 0) {
        const travel = (loopPhase / TAU + i / sampleCount + layerT * 0.27) % 1;
        const eased = smooth01(travel);
        const x = lerp(input.x, output.x, eased);
        const y = lerp(input.y, output.y, eased);
        const pulse = Math.sin(Math.PI * travel);
        g.noStroke();
        g.fill(INK_R, INK_G, INK_B, (isGlow ? 54 : 188) * pulse);
        g.circle(x, y, (isGlow ? 12 : 3.2) + pulse * (isGlow ? 7 : 2));
        g.noFill();
      }
    }

    drawMagnitudeOrbit(
      g,
      magnitude * R,
      phase + layerOffset,
      layerT,
      isGlow,
      false,
    );
    drawMagnitudeOrbit(
      g,
      outputMagnitude * R,
      n * (phase + layerOffset),
      layerT,
      isGlow,
      true,
    );
  }

  drawProofMapping(g, phase, isGlow);
  drawRootsOfUnity(g, loopPhase, isGlow);
  g.pop();
}

function polarPoint(radius, angle) {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function drawComplexPlane(g, phase, isGlow) {
  const R = PARAMS.outerRadius;
  const pulse = 0.86 + 0.14 * Math.cos(phase * 2);
  g.stroke(INK_R, INK_G, INK_B, (isGlow ? 10 : 52) * pulse);
  g.strokeWeight(isGlow ? 5.5 : 0.9);
  g.line(-R - 58, 0, R + 58, 0);
  g.line(0, -R - 58, 0, R + 58);

  g.stroke(INK_R, INK_G, INK_B, isGlow ? 13 : 68);
  g.strokeWeight(isGlow ? 6.5 : 1.15);
  g.circle(0, 0, R * 2);

  const tick = R / 4;
  g.stroke(INK_R, INK_G, INK_B, isGlow ? 8 : 46);
  g.strokeWeight(isGlow ? 4 : 0.8);
  for (let i = -4; i <= 4; i++) {
    if (i === 0) continue;
    const p = i * tick;
    g.line(p, -7, p, 7);
    g.line(-7, p, 7, p);
  }

  g.noStroke();
  g.fill(INK_R, INK_G, INK_B, isGlow ? 72 : 235);
  g.circle(0, 0, isGlow ? 18 : 5);
  g.noFill();
}

function drawMagnitudeOrbit(g, radius, rotation, layerT, isGlow, isOutput) {
  if (radius < 4) return;
  const dashCount = isOutput ? PARAMS.powerN * 12 : 48;
  const alpha = (isGlow ? 7 : 30) * (1 - layerT * 0.48);
  g.strokeWeight(isGlow ? 4.2 : 0.7);
  for (let i = 0; i < dashCount; i += 2) {
    const a0 = rotation + (i / dashCount) * TAU;
    const a1 = rotation + ((i + 1) / dashCount) * TAU;
    g.stroke(INK_R, INK_G, INK_B, alpha);
    g.arc(0, 0, radius * 2, radius * 2, a0, a1);
  }
}

// One enlarged pair makes angle multiplication directly readable:
// theta on the input becomes n*theta on the transformed point.
function drawProofMapping(g, phase, isGlow) {
  const n = PARAMS.powerN;
  const R = PARAMS.outerRadius;
  const theta = PARAMS.proofPointAngle + phase;
  const input = polarPoint(R, theta);
  const output = polarPoint(R, n * theta);
  const rayAlpha = isGlow ? 22 : 112;

  g.stroke(INK_R, INK_G, INK_B, rayAlpha);
  g.strokeWeight(isGlow ? 8 : 1.65);
  g.line(0, 0, input.x, input.y);
  g.line(0, 0, output.x, output.y);

  g.stroke(INK_R, INK_G, INK_B, isGlow ? 38 : 176);
  g.strokeWeight(isGlow ? 11 : 2.3);
  g.line(input.x, input.y, output.x, output.y);

  g.noStroke();
  g.fill(INK_R, INK_G, INK_B, isGlow ? 105 : 255);
  g.circle(input.x, input.y, isGlow ? 34 : 10);
  g.circle(output.x, output.y, isGlow ? 42 : 13);
  g.noFill();

  const arcRadiusA = 78;
  const arcRadiusB = 118;
  drawSignedArc(g, arcRadiusA, 0, theta, isGlow ? 18 : 102, isGlow ? 6 : 1.3);
  drawSignedArc(
    g,
    arcRadiusB,
    0,
    n * theta,
    isGlow ? 11 : 72,
    isGlow ? 5 : 1.0,
  );
}

function drawSignedArc(g, radius, startAngle, endAngle, alpha, weight) {
  const span = endAngle - startAngle;
  const steps = Math.max(8, Math.ceil((Math.abs(span) / TAU) * 90));
  g.stroke(INK_R, INK_G, INK_B, alpha);
  g.strokeWeight(weight);
  g.beginShape();
  for (let i = 0; i <= steps; i++) {
    const angle = lerp(startAngle, endAngle, i / steps);
    g.vertex(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  g.endShape();
}

// The n equally spaced points satisfy z^n = 1. They stay fixed as the mapped
// field rotates, providing a stable reference for the power transformation.
function drawRootsOfUnity(g, phase, isGlow) {
  const n = PARAMS.powerN;
  const radius = PARAMS.outerRadius + 38;
  for (let k = 0; k < n; k++) {
    const angle = (k / n) * TAU;
    const p = polarPoint(radius, angle);
    const pulse = 0.68 + 0.32 * Math.cos(phase * n + (k * TAU) / n);
    g.noStroke();
    g.fill(INK_R, INK_G, INK_B, (isGlow ? 48 : 175) * pulse);
    g.circle(p.x, p.y, (isGlow ? 17 : 4.5) + pulse * (isGlow ? 7 : 2));
  }
  g.noFill();
}

function smooth01(value) {
  const t = constrain(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothRange(edge0, edge1, value) {
  return smooth01((value - edge0) / (edge1 - edge0));
}

// ─── Bloom / finishing ───────────────────────────────────────────────────────
function composite(phase) {
  background(BG_R, BG_G, BG_B);
  halfPg.clear();
  halfPg.image(glowPg, 0, 0, W >> 1, H >> 1);
  quartPg.clear();
  quartPg.image(halfPg, 0, 0, W >> 2, H >> 2);
  eighthPg.clear();
  eighthPg.image(quartPg, 0, 0, W >> 3, H >> 3);
  sixteenthPg.clear();
  sixteenthPg.image(eighthPg, 0, 0, W >> 4, H >> 4);

  const bloomBreath = 0.88 + 0.12 * Math.cos(phase * 2);
  drawingContext.globalCompositeOperation = "screen";
  tint(255, Math.round(42 * bloomBreath));
  image(sixteenthPg, 0, 0, W, H);
  tint(255, Math.round(72 * bloomBreath));
  image(eighthPg, 0, 0, W, H);
  tint(255, Math.round(142 * bloomBreath));
  image(quartPg, 0, 0, W, H);
  tint(255, Math.round(225 * bloomBreath));
  image(halfPg, 0, 0, W, H);
  noTint();
  image(pg, 0, 0);
  drawingContext.globalCompositeOperation = "source-over";

  push();
  drawingContext.globalCompositeOperation = "screen";
  tint(255, 16);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = "source-over";
  pop();
}

function drawEditorialOverlay(progress, phase) {
  const loopDistance = Math.min(progress, 1 - progress);
  const hookAlpha = 1 - smoothRange(0.018, 0.07, loopDistance);
  const formulaAlpha =
    smoothRange(0.045, 0.075, progress) *
    (1 - smoothRange(0.17, 0.205, progress));
  const ctaAlpha =
    smoothRange(0.835, 0.875, progress) *
    (1 - smoothRange(0.945, 0.985, progress));
  const systemAlpha = 0.52 + 0.48 * Math.cos(phase * PARAMS.powerN);

  push();
  textFont("ui-monospace, Menlo, monospace");
  textAlign(CENTER, CENTER);
  noStroke();

  fill(INK_R, INK_G, INK_B, 255 * hookAlpha);
  textSize(39);
  textStyle(BOLD);
  text("ANGLES MULTIPLIED.", W * 0.5, 285);

  fill(INK_R, INK_G, INK_B, 205 * formulaAlpha);
  textSize(24);
  textStyle(NORMAL);
  text("(cos θ + i sin θ)ⁿ", W * 0.5, 306);
  text("= cos(nθ) + i sin(nθ)", W * 0.5, 344);

  textAlign(LEFT, TOP);
  fill(INK_R, INK_G, INK_B, 102);
  textSize(12);
  text("INPUT  z = r(cos θ + i sin θ)", 70, 430);
  text("POWER  n = " + PARAMS.powerN, 70, 452);
  text("OUTPUT zⁿ = rⁿ(cos nθ + i sin nθ)", 70, 474);

  textAlign(RIGHT, TOP);
  fill(INK_R, INK_G, INK_B, 70 + 38 * systemAlpha);
  text("ARGUMENT  θ → " + PARAMS.powerN + "θ", W - 70, 430);
  text("MAGNITUDE r → r^" + PARAMS.powerN, W - 70, 452);
  text("ROOTS OF UNITY  " + PARAMS.powerN, W - 70, 474);

  textAlign(CENTER, CENTER);
  fill(INK_R, INK_G, INK_B, 225 * ctaAlpha);
  textSize(22);
  textStyle(BOLD);
  text("Follow for formulas + parameters.", W * 0.5, 1570);

  textStyle(NORMAL);
  fill(INK_R, INK_G, INK_B, 55);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text(W + "×" + H + " · " + FPS + "fps", 52, H - 52);
  textAlign(RIGHT, BOTTOM);
  text("20260722 · LOOP " + progress.toFixed(3), W - 52, H - 52);
  pop();
}

function drawCornerBrackets() {
  push();
  noFill();
  stroke(INK_R, INK_G, INK_B, 38);
  strokeWeight(0.7);
  const m = 34,
    L = 24;
  line(m, m, m + L, m);
  line(m, m, m, m + L);
  line(W - m, m, W - m - L, m);
  line(W - m, m, W - m, m + L);
  line(m, H - m, m + L, H - m);
  line(m, H - m, m, H - m - L);
  line(W - m, H - m, W - m - L, H - m);
  line(W - m, H - m, W - m, H - m - L);
  pop();
}

function drawVignette() {
  push();
  noFill();
  const steps = 80,
    maxR = dist(W / 2, H / 2, 0, 0) * 1.12;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const alpha = map(k, 0.6, 1, 0, 150, true);
    if (alpha <= 0) continue;
    stroke(0, 0, 0, alpha);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction / recording ─────────────────────────────────────────────────
function mousePressed() {
  reseed(Math.floor(random(100000)));
}

function keyReleased() {
  if (key === "r" || key === "R") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === "s" || key === "S") {
    saveCanvas("de_moivre_" + getTimestamp(), "png");
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
  if (el("duration"))
    el("duration").textContent = (recFrameCount / FPS).toFixed(1);
  if (el("frameCount")) el("frameCount").textContent = recFrameCount;
  const fill = el("progressFill");
  if (fill)
    fill.style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
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
  a.download = "de_moivre_" + getTimestamp() + ".mp4";
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

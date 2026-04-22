'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const LOOP_SECONDS = 20;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

// ─── Palette (monochrome) ─────────────────────────────────────────────────────
// Black & white only. Role is conveyed by stroke weight and pattern, not hue:
//   triangle edges → solid, medium
//   cevian AD      → solid, bold
//   cevian BE      → dashed, bold
//   cevian CF      → dotted, bold
const BG  = [0, 0, 0];
const INK = [255, 255, 255];

// Semantic aliases kept so call sites don't care about the palette.
const MINT = INK;
const CYAN = INK;
const VIO  = INK;
const MAG  = INK;

const TRAIL_ALPHA = 10;

// Irrational constants for quasiperiodic motion
const PHI  = 1.61803398875;
const SQ2  = 1.41421356237;

// ─── Ceva's Theorem ───────────────────────────────────────────────────────────
// Triangle ABC with cevian feet:
//   D on BC, E on CA, F on AB.
// Write each foot as an affine interpolation parameter t ∈ (0,1):
//   D = (1-α) B + α C      →  BD/DC = α/(1-α)
//   E = (1-β) C + β A      →  CE/EA = β/(1-β)
//   F = (1-γ) A + γ B      →  AF/FB = γ/(1-γ)
//
// Ceva's concurrency condition:
//   (BD/DC) · (CE/EA) · (AF/FB) = 1
//   ⇔  α β γ  =  (1-α)(1-β)(1-γ)
//
// We freely pick α(t) and β(t), then SOLVE for γ(t) so the product stays 1.
// This guarantees AD, BE, CF always meet at a single point — the visible
// "Cevian pencil" of the sketch.

// ─── State ────────────────────────────────────────────────────────────────────
let trailLayer = null;
let grainLayer = null;

let motionSeed = 0;
let phaseA = 0, phaseB = 0, phaseC = 0;

let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;
let canvasEl = null;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  noFill();
  strokeCap(ROUND);

  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  trailLayer.colorMode(RGB, 255, 255, 255, 255);
  trailLayer.background(BG[0], BG[1], BG[2]);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseedPattern(floor(random(100000)));

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function reseedPattern(seed) {
  motionSeed = seed;
  randomSeed(motionSeed);
  noiseSeed(motionSeed);
  phaseA = random(TWO_PI);
  phaseB = random(TWO_PI);
  phaseC = random(TWO_PI);
  if (trailLayer) trailLayer.background(BG[0], BG[1], BG[2]);
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const la = loop * TWO_PI;

  // Fade trail
  trailLayer.noStroke();
  trailLayer.fill(BG[0], BG[1], BG[2], TRAIL_ALPHA);
  trailLayer.rect(0, 0, W, H);

  // Triangle vertices — slowly rotating equilateral, centered on canvas
  const cx = W * 0.5;
  const cy = H * 0.5;
  const R  = Math.min(W, H) * 0.36;
  const spin = la * 0.5 + phaseA * 0.2;
  const A = [cx + R * cos(spin - HALF_PI),          cy + R * sin(spin - HALF_PI)];
  const B = [cx + R * cos(spin - HALF_PI + TWO_PI / 3), cy + R * sin(spin - HALF_PI + TWO_PI / 3)];
  const C = [cx + R * cos(spin - HALF_PI + 2 * TWO_PI / 3), cy + R * sin(spin - HALF_PI + 2 * TWO_PI / 3)];

  // Ratios (α, β) with γ solved from Ceva's constraint
  const { alpha, beta, gamma } = cevaRatios(la);

  // Feet
  const D = [lerp(B[0], C[0], alpha), lerp(B[1], C[1], alpha)];
  const E = [lerp(C[0], A[0], beta),  lerp(C[1], A[1], beta)];
  const F = [lerp(A[0], B[0], gamma), lerp(A[1], B[1], gamma)];

  // Concurrency point (AD ∩ BE)
  const P = lineIntersect(A, D, B, E);

  // 0. Circumscribed circle (faint geometric scaffold)
  drawCircle([cx, cy], R, 0.6, 28);
  // Inner "harmonic" circle — inradius-ish ghost
  drawCircle([cx, cy], R * 0.5, 0.6, 18);

  // 1. Pencil of faint cevians — a family of AD, BE, CF at nearby ratios.
  // Each fan individually is just concurrent cevians; together they ruled
  // surface that visually *announces* concurrency.
  drawCevianFan(A, B, C, alpha, 1);
  drawCevianFan(B, C, A, beta,  2);
  drawCevianFan(C, A, B, gamma, 0);

  // 2. Triangle edges — bold solid
  drawEdge(A, B, 1.3, 200, 'solid');
  drawEdge(B, C, 1.3, 200, 'solid');
  drawEdge(C, A, 1.3, 200, 'solid');

  // 3. Primary cevians — distinguished by stroke pattern
  drawEdge(A, D, 1.8, 240, 'solid');
  drawEdge(B, E, 1.8, 240, 'dashed');
  drawEdge(C, F, 1.8, 240, 'dotted');

  // 4. Foot markers — hollow rings + tick perpendicular to the side
  drawFootMark(D, B, C, 5.5);
  drawFootMark(E, C, A, 5.5);
  drawFootMark(F, A, B, 5.5);

  // 5. Vertex markers — bright dots with subtle glyph labels
  drawVertex(A, 7);
  drawVertex(B, 7);
  drawVertex(C, 7);

  // 6. Concurrency point — the theorem, rendered bright
  if (P) drawConcurrencyPoint(P);

  // Composite
  background(BG[0], BG[1], BG[2]);
  image(trailLayer, 0, 0);

  // Grain
  push();
  tint(255, 38);
  image(grainLayer, 0, 0);
  noTint();
  pop();

  drawCornerBrackets();
  drawHUD(alpha, beta, gamma);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Ceva ratio schedule ──────────────────────────────────────────────────────
// α, β freely chosen; γ solved so αβγ = (1-α)(1-β)(1-γ) always holds.
//   γ = (1-α)(1-β) / (αβ + (1-α)(1-β))
function cevaRatios(la) {
  // Quasiperiodic breathing: α and β oscillate at irrational frequency ratios
  // (1 vs φ), so the (α, β) orbit densely fills a rectangle without ever
  // closing — P traces an ever-changing curve over the loop.
  const alpha = 0.5 + 0.30 * sin(la + phaseA);
  const beta  = 0.5 + 0.30 * sin(la * PHI + phaseB);
  const gamma = (1 - alpha) * (1 - beta) / (alpha * beta + (1 - alpha) * (1 - beta));
  return { alpha, beta, gamma };
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────
// Pattern lengths are in pixels.
const DASH_LEN = 18;
const DASH_GAP = 10;
const DOT_LEN  = 2.5;
const DOT_GAP  = 10;

function drawEdge(P1, P2, sw, alpha, pattern) {
  trailLayer.stroke(INK[0], INK[1], INK[2], alpha);
  trailLayer.strokeWeight(sw);
  trailLayer.noFill();

  const mode = pattern || 'solid';
  if (mode === 'solid') {
    trailLayer.line(P1[0], P1[1], P2[0], P2[1]);
    return;
  }
  const dx = P2[0] - P1[0];
  const dy = P2[1] - P1[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const ux = dx / len, uy = dy / len;

  const on  = mode === 'dashed' ? DASH_LEN : DOT_LEN;
  const off = mode === 'dashed' ? DASH_GAP : DOT_GAP;
  const period = on + off;

  for (let s = 0; s < len; s += period) {
    const e = Math.min(s + on, len);
    trailLayer.line(P1[0] + ux * s, P1[1] + uy * s, P1[0] + ux * e, P1[1] + uy * e);
  }
}

// Faint pencil of cevians near the primary one — ratio offsets sweep a small
// interval around α/β/γ so the concurrency constraint reads visually as a fan.
function drawCevianFan(vertex, sideP, sideQ, primary, patternIdx) {
  const FAN_COUNT = 6;
  const SPREAD = 0.07;
  const patterns = ['solid', 'dashed', 'dotted'];
  for (let i = 1; i <= FAN_COUNT; i++) {
    for (const sign of [-1, 1]) {
      const t = primary + sign * (i / FAN_COUNT) * SPREAD;
      if (t <= 0.04 || t >= 0.96) continue;
      const foot = [lerp(sideP[0], sideQ[0], t), lerp(sideP[1], sideQ[1], t)];
      const a = map(i, 1, FAN_COUNT, 42, 10);
      drawEdge(vertex, foot, 0.6, a, patterns[patternIdx]);
    }
  }
}

function drawCircle(P, r, sw, alpha) {
  trailLayer.noFill();
  trailLayer.stroke(INK[0], INK[1], INK[2], alpha);
  trailLayer.strokeWeight(sw);
  trailLayer.circle(P[0], P[1], r * 2);
}

function drawVertex(P, r) {
  trailLayer.noStroke();
  for (let h = 4; h >= 1; h--) {
    trailLayer.fill(INK[0], INK[1], INK[2], 10);
    trailLayer.circle(P[0], P[1], r * (2 + h * 1.3));
  }
  trailLayer.fill(INK[0], INK[1], INK[2], 245);
  trailLayer.circle(P[0], P[1], r);
  // Tiny hollow ring around vertex for a drafting look
  trailLayer.noFill();
  trailLayer.stroke(INK[0], INK[1], INK[2], 110);
  trailLayer.strokeWeight(0.8);
  trailLayer.circle(P[0], P[1], r * 2.6);
}

// Foot marker: hollow ring + short tick drawn perpendicular to the host side.
function drawFootMark(F, sideP, sideQ, r) {
  const dx = sideQ[0] - sideP[0];
  const dy = sideQ[1] - sideP[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;  // perpendicular
  const tick = 7;

  trailLayer.noFill();
  trailLayer.stroke(INK[0], INK[1], INK[2], 230);
  trailLayer.strokeWeight(1.2);
  trailLayer.circle(F[0], F[1], r);

  trailLayer.stroke(INK[0], INK[1], INK[2], 190);
  trailLayer.strokeWeight(1);
  trailLayer.line(F[0] - nx * tick, F[1] - ny * tick, F[0] + nx * tick, F[1] + ny * tick);
}

function drawConcurrencyPoint(P) {
  // Crossed hair — classic surveying crosshair
  trailLayer.stroke(INK[0], INK[1], INK[2], 150);
  trailLayer.strokeWeight(0.8);
  const cs = 22;
  trailLayer.line(P[0] - cs, P[1], P[0] + cs, P[1]);
  trailLayer.line(P[0], P[1] - cs, P[0], P[1] + cs);

  // Outer halo
  trailLayer.noStroke();
  for (let h = 7; h >= 1; h--) {
    const rr = 5 + h * 5;
    trailLayer.fill(INK[0], INK[1], INK[2], 9);
    trailLayer.circle(P[0], P[1], rr * 2);
  }
  // Concentric rings
  trailLayer.noFill();
  trailLayer.stroke(INK[0], INK[1], INK[2], 220);
  trailLayer.strokeWeight(1.6);
  trailLayer.circle(P[0], P[1], 16);
  trailLayer.stroke(INK[0], INK[1], INK[2], 110);
  trailLayer.strokeWeight(0.8);
  trailLayer.circle(P[0], P[1], 26);

  // Bright core
  trailLayer.noStroke();
  trailLayer.fill(INK[0], INK[1], INK[2], 255);
  trailLayer.circle(P[0], P[1], 5.5);
}

// Intersection of segments P1P2 and P3P4 (lines, actually — unbounded).
function lineIntersect(P1, P2, P3, P4) {
  const x1 = P1[0], y1 = P1[1];
  const x2 = P2[0], y2 = P2[1];
  const x3 = P3[0], y3 = P3[1];
  const x4 = P4[0], y4 = P4[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (abs(den) < 1e-6) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(alpha, beta, gamma) {
  const product = (alpha * beta * gamma) / ((1 - alpha) * (1 - beta) * (1 - gamma));
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');

  // Top title block
  fill(INK[0], INK[1], INK[2], 200);
  textSize(13);
  textAlign(LEFT, TOP);
  text('CEVA · 1678', 52, 54);
  fill(INK[0], INK[1], INK[2], 110);
  textSize(10);
  text('concurrency of cevians in a triangle', 52, 74);

  // Bottom equation
  fill(INK[0], INK[1], INK[2], 160);
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text('(BD / DC) · (CE / EA) · (AF / FB)  =  ' + product.toFixed(4), 52, H - 76);

  // Bottom ratios
  fill(INK[0], INK[1], INK[2], 110);
  textSize(10);
  text('α = ' + alpha.toFixed(3) + '     β = ' + beta.toFixed(3) + '     γ = ' + gamma.toFixed(3), 52, H - 54);

  // Tag
  textAlign(RIGHT, BOTTOM);
  fill(INK[0], INK[1], INK[2], 90);
  text('20260422 · mono', W - 52, H - 54);
  pop();
}

// Thin corner brackets — editorial crop marks
function drawCornerBrackets() {
  push();
  noFill();
  stroke(INK[0], INK[1], INK[2], 120);
  strokeWeight(1);
  const m = 32;
  const L = 28;
  // top-left
  line(m, m, m + L, m); line(m, m, m, m + L);
  // top-right
  line(W - m, m, W - m - L, m); line(W - m, m, W - m, m + L);
  // bottom-left
  line(m, H - m, m + L, H - m); line(m, H - m, m, H - m - L);
  // bottom-right
  line(W - m, H - m, W - m - L, H - m); line(W - m, H - m, W - m, H - m - L);
  pop();
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function renderGrain() {
  if (!grainLayer) return;
  grainLayer.clear();
  grainLayer.noStroke();
  const count = floor(W * H * 0.004);
  for (let i = 0; i < count; i++) {
    const v = random(60, 210);
    grainLayer.fill(v, v, v, random(4, 14));
    grainLayer.circle(random(W), random(H), random(0.3, 1.4));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 60;
  const maxR = dist(W / 2, H / 2, 0, 0) * 1.08;
  const sw = (maxR / steps) * 2 + 2;
  strokeWeight(sw);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.55, 1.0, 0, 220, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    const r = lerp(0, maxR, k);
    circle(W / 2, H / 2, r * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseedPattern(floor(random(100000))); }

function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('20260422_' + timestampString(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseedPattern(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome or Edge.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W, height: H,
    bitrate: 18_000_000,
    framerate: FPS,
  });

  recFrameCount = 0;
  isRecording = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  setStatus('Recording…', '#fff');
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus('Finalizing…', '#ccc');
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '20260422_ceva_' + timestampString() + '.mp4';
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

function updateRecordingUI() {
  const dEl = document.getElementById('duration');
  const fEl = document.getElementById('frameCount');
  if (dEl) dEl.textContent = (recFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recFrameCount;
}

function updateCanvasInfo() {
  const el = document.getElementById('canvasSize');
  if (el) el.textContent = W + ' × ' + H;
}

function timestampString() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

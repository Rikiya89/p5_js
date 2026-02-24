"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP = MAX_FRAMES;

// ── Recording state ──────────────────────────────────────────────────────────
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let fc = 0;

// ── Art constants ─────────────────────────────────────────────────────────────
const FS = 12; // flow-field cell size (px) — finer than before

// Three particle layers: fine background / mid / bright accent
const LAYER_DEFS = [
  { count: 1800, minL: 60,  maxL: 185, minSw: 0.15, maxSw: 0.55, minSpd: 0.8, maxSpd: 1.8, maxAlpha: 85  },
  { count:  900, minL: 90,  maxL: 230, minSw: 0.40, maxSw: 1.05, minSpd: 1.4, maxSpd: 2.6, maxAlpha: 140 },
  { count:  300, minL: 35,  maxL: 100, minSw: 0.80, maxSw: 2.20, minSpd: 2.2, maxSpd: 4.2, maxAlpha: 220 },
];

// Three ring sources distribute visual interest vertically across the portrait
const RING_ORIGINS = [0.18, 0.50, 0.82]; // fractions of H

// ── Art state ─────────────────────────────────────────────────────────────────
let particles = [];
let F_COLS, F_ROWS, flowField;

// ── Particle ──────────────────────────────────────────────────────────────────
class Particle {
  constructor(def, stagger = false) {
    this.def  = def;
    // Spawn on the LEFT half only — show() mirrors every stroke to the right.
    this.x    = random(W / 2);
    this.y    = random(H);
    this.px   = this.x;
    this.py   = this.y;
    this.maxL = floor(random(def.minL, def.maxL));
    this.life = stagger ? floor(random(this.maxL)) : this.maxL;
    this.sw   = random(def.minSw, def.maxSw);
    this.spd  = random(def.minSpd, def.maxSpd);
  }

  step() {
    const c = constrain(floor(this.x / FS), 0, floor(F_COLS / 2) - 1);
    const r = constrain(floor(this.y / FS), 0, F_ROWS - 1);
    const a = flowField[r * F_COLS + c];
    this.px  = this.x;
    this.py  = this.y;
    this.x  += cos(a) * this.spd;
    this.y  += sin(a) * this.spd;
    this.life--;
  }

  show() {
    const alpha = map(this.life, 0, this.maxL, 0, this.def.maxAlpha);
    stroke(255, alpha);
    strokeWeight(this.sw);
    line(this.px,     this.py, this.x,     this.y); // left half (real)
    line(W - this.px, this.py, W - this.x, this.y); // right half (mirror)
  }

  isDead() {
    return (
      this.life <= 0 ||
      this.x < 0 || this.x > W / 2 ||
      this.y < 0 || this.y > H
    );
  }
}

// ── p5 ────────────────────────────────────────────────────────────────────────
function setup() {
  createCanvas(W, H);
  background(0);
  noiseSeed(7);
  randomSeed(42);

  F_COLS    = floor(W / FS);
  F_ROWS    = floor(H / FS);
  flowField = new Float32Array(F_COLS * F_ROWS);

  for (const def of LAYER_DEFS) {
    for (let i = 0; i < def.count; i++) {
      particles.push(new Particle(def, true));
    }
  }

  document.getElementById('maxDuration').textContent = MAX_DURATION;
  frameRate(FPS);
}

function draw() {
  const t  = fc / LOOP;
  const θ  = t * TWO_PI;
  const cx = W * 0.5;
  const cy = H * 0.5;

  // ── Slow fade → longer, lusher trails ────────────────────────────────────
  noStroke();
  fill(0, 14);
  rect(0, 0, W, H);

  // ── Flow field — two-octave noise for richer, more complex patterns ────────
  // Primary octave: large-scale direction (the dominant flow)
  const dr1 = cos(θ) * 1.6,               dc1 = sin(θ) * 1.6;
  // Secondary octave: fine detail, phase-shifted so it evolves independently
  const dr2 = cos(θ + PI * 0.6) * 0.85,  dc2 = sin(θ + PI * 0.6) * 0.85;

  const halfCols = floor(F_COLS / 2);
  for (let r = 0; r < F_ROWS; r++) {
    for (let c = 0; c < halfCols; c++) {
      const nx = c * 0.04, ny = r * 0.04;
      const a1  = noise(nx + dr1, ny + dc1) * TWO_PI * 3;
      const a2  = noise(nx * 2.3 + dr2, ny * 2.3 + dc2) * TWO_PI;
      flowField[r * F_COLS + c] = a1 + a2 * 0.35;
    }
  }

  // ── Particles (bilateral symmetry) ────────────────────────────────────────
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.step();
    p.show();
    if (p.isDead()) particles[i] = new Particle(p.def);
  }

  noFill();

  // ── Three ring-pulse systems at top / centre / bottom ─────────────────────
  for (const yFrac of RING_ORIGINS) {
    const oy = H * yFrac;
    for (let i = 0; i < 4; i++) {
      const phase = (t + i * 0.25) % 1.0;
      const rad   = phase * 560;
      const alpha = sin(phase * PI) * 65;
      stroke(255, alpha);
      strokeWeight(0.75);
      ellipse(cx, oy, rad * 2, rad * 2);
    }
  }

  // ── Breathing diamond (rotated square) at centre ──────────────────────────
  const dSize = (sin(θ * 2) * 0.5 + 0.5) * 260 + 90;
  stroke(255, 20);
  strokeWeight(0.85);
  push();
    translate(cx, cy);
    rotate(QUARTER_PI);
    rectMode(CENTER);
    rect(0, 0, dSize * sqrt(2), dSize * sqrt(2));
  pop();

  // ── Thin inset canvas frame ───────────────────────────────────────────────
  rectMode(CORNER);
  stroke(255, 13);
  strokeWeight(0.5);
  rect(16, 16, W - 32, H - 32);

  // ── Central vertical axis (emphasises the symmetry seam) ─────────────────
  stroke(255, 11);
  strokeWeight(0.35);
  line(cx, 0, cx, H);

  // ── Horizontal golden-ratio rules ─────────────────────────────────────────
  stroke(255, 17);
  strokeWeight(0.5);
  const gr = H * 0.382;
  line(0, gr,     W, gr);
  line(0, H - gr, W, H - gr);

  // ── Fine 45° cross-hatching — subtle depth texture ────────────────────────
  stroke(255, 5);
  strokeWeight(0.25);
  for (let x = -H; x < W + H; x += 120) {
    line(x,     0, x + H, H);
    line(x + H, 0, x,     H);
  }

  // ── Advance ───────────────────────────────────────────────────────────────
  fc++;
  if (fc >= LOOP) fc = 0;

  // ── MP4 capture ───────────────────────────────────────────────────────────
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function keyPressed() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
  }
}

// ── Recording ────────────────────────────────────────────────────────────────

function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome/Edge.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { console.error(e); setStatus('Encoder error', '#f66'); isRecording = false; }
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 12_000_000, framerate: FPS });

  fc = 0;
  isRecording = true;
  recordingFrameCount = 0;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording MP4...', '#fff');
  updateRecordingUI();
}

async function stopRecording() {
  if (!isRecording || !encoder || !muxer) return;
  isRecording = false;
  setStatus('Finalizing...', '#aaa');
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'monochrome_flow_20260224.mp4'; a.click();
  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete!', '#fff');
  setTimeout(() => setStatus('Ready', '#aaa'), 3000);
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  const frame = new VideoFrame(canvas, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text; el.style.color = color;
}

function updateRecordingUI() {
  const d = document.getElementById('duration');
  const f = document.getElementById('frameCount');
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}

'use strict';

// ---------------------------------------------------------------------------
// 3D Generative Art — Prime Harmonic Field
//
// Mathematical theme:
//   3D Lissajous / harmonic motion
//   x = sin(3t + phase)
//   y = sin(5t)
//   z = sin(7t + phase)
//
// Prime ratio:
//   3 : 5 : 7
//
// Visual direction:
//   Clean black-and-white mathematical sculpture.
//   Thin harmonic curves, glowing prime nodes, orbital rings, and depth fog.
//
// Constraints preserved:
//   Canvas size: 1080 × 1920
//   FPS / LOOP_SECONDS / LOOP_FRAMES structure
//   WebCodecs + mp4-muxer capture pipeline
// ---------------------------------------------------------------------------

const W            = 1080;
const H            = 1920;
const FPS          = 60;
const LOOP_SECONDS = 24;
const LOOP_FRAMES  = FPS * LOOP_SECONDS;

const BG = [0, 0, 0];

// ---------------------------------------------------------------------------
// Artwork configuration
// ---------------------------------------------------------------------------
const FIELD_SCALE = 390;
const CURVE_COUNT = 22;
const CURVE_STEPS = 280;
const NODE_COUNT  = 96;
const RING_COUNT  = 9;
const STAR_COUNT  = 220;

const PRIME_A = 3;
const PRIME_B = 5;
const PRIME_C = 7;
const PHI     = (1 + Math.sqrt(5)) * 0.5;

let stars = [];
let camZ  = 2200;

// ---------------------------------------------------------------------------
// setup / draw
// ---------------------------------------------------------------------------
let canvasEl;
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
  setAttributes('antialias', true);
  smooth();

  stars = buildStars(STAR_COUNT);

  const maxDurEl     = document.getElementById('maxDuration');
  const maxFramesEl  = document.getElementById('maxFrames');
  const canvasSizeEl = document.getElementById('canvasSize');

  if (maxDurEl)     maxDurEl.textContent     = LOOP_SECONDS;
  if (maxFramesEl)  maxFramesEl.textContent  = LOOP_FRAMES;
  if (canvasSizeEl) canvasSizeEl.textContent = W + ' × ' + H;
}

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const time = loop * TWO_PI;

  background(BG[0], BG[1], BG[2]);

  camZ = 2200;
  camera(0, 0, camZ, 0, 0, 0, 0, 1, 0);
  perspective(PI / 5.35, W / H, 10, 10000);

  const yaw   = time * 0.82;
  const pitch = 0.34 + 0.12 * Math.sin(time * 0.5);
  const roll  = 0.08 * Math.sin(time * 0.25);

  drawStarField(time, yaw, pitch);
  drawOrbitalRings(time, yaw, pitch, roll);
  drawHarmonicCurves(time, yaw, pitch, roll);
  drawPrimeNodes(time, yaw, pitch, roll);
  drawCentralSeed(time);
  drawVignette();
  drawHUD(time);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingHUD();

    if (recFrameCount >= LOOP_FRAMES) {
      stopRecording();
    }
  }
}

// ---------------------------------------------------------------------------
// Mathematical structure
// ---------------------------------------------------------------------------
function harmonicPoint(t, phase, radiusMul = 1) {
  // 3D Lissajous curve using prime ratios 3:5:7.
  const x = Math.sin(PRIME_A * t + phase) * FIELD_SCALE * radiusMul;
  const y = Math.sin(PRIME_B * t) * FIELD_SCALE * 0.86 * radiusMul;
  const z = Math.sin(PRIME_C * t + phase * 0.73) * FIELD_SCALE * 0.72 * radiusMul;

  // Golden-ratio twist gives the structure a subtle sacred-geometry feeling.
  const twist = 0.18 * Math.sin(t * PHI + phase);
  return rotateAroundY({ x, y, z }, twist);
}

function transformPoint(p, yaw, pitch, roll) {
  const y1 = rotateAroundY(p, yaw);
  const x1 = rotateAroundX(y1, pitch);
  return rotateAroundZ(x1, roll);
}

function rotateAroundX(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);

  return {
    x: p.x,
    y: p.y * c - p.z * s,
    z: p.y * s + p.z * c,
  };
}

function rotateAroundY(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);

  return {
    x: p.x * c + p.z * s,
    y: p.y,
    z: -p.x * s + p.z * c,
  };
}

function rotateAroundZ(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);

  return {
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c,
    z: p.z,
  };
}

function fog(z) {
  const dist = Math.abs(camZ - z);
  return Math.exp(-dist / 3300);
}

// ---------------------------------------------------------------------------
// Hero harmonic curves
// ---------------------------------------------------------------------------
function drawHarmonicCurves(time, yaw, pitch, roll) {
  noFill();

  // Soft glow pass.
  blendMode(ADD);

  for (let c = 0; c < CURVE_COUNT; c++) {
    const k = c / CURVE_COUNT;
    const phase = k * TWO_PI + time * 0.22;
    const radiusMul = 0.70 + 0.34 * Math.sin(k * TWO_PI + time * 0.45);

    stroke(255, 255, 255, 28 + 22 * Math.sin(time + k * TWO_PI));
    strokeWeight(9.0);

    beginShape();
    for (let i = 0; i <= CURVE_STEPS; i++) {
      const t = (i / CURVE_STEPS) * TWO_PI + time * 0.18;
      const p = harmonicPoint(t, phase, radiusMul);
      const q = transformPoint(p, yaw, pitch, roll);
      vertex(q.x, q.y, q.z);
    }
    endShape();
  }

  blendMode(BLEND);

  // Crisp line pass.
  for (let c = 0; c < CURVE_COUNT; c++) {
    const k = c / CURVE_COUNT;
    const phase = k * TWO_PI + time * 0.22;
    const radiusMul = 0.70 + 0.34 * Math.sin(k * TWO_PI + time * 0.45);

    stroke(255, 255, 255, 120 + 70 * Math.sin(k * TWO_PI + time * 0.6));
    strokeWeight(c % 4 === 0 ? 1.15 : 0.58);

    beginShape();
    for (let i = 0; i <= CURVE_STEPS; i++) {
      const t = (i / CURVE_STEPS) * TWO_PI + time * 0.18;
      const p = harmonicPoint(t, phase, radiusMul);
      const q = transformPoint(p, yaw, pitch, roll);
      vertex(q.x, q.y, q.z);
    }
    endShape();
  }
}

// ---------------------------------------------------------------------------
// Prime nodes moving on the harmonic field
// ---------------------------------------------------------------------------
function drawPrimeNodes(time, yaw, pitch, roll) {
  noStroke();

  for (let i = 0; i < NODE_COUNT; i++) {
    const k = i / NODE_COUNT;
    const t = k * TWO_PI * PRIME_B + time * 0.42;
    const phase = Math.floor(i % PRIME_C) / PRIME_C * TWO_PI;
    const radiusMul = 0.74 + 0.23 * Math.sin(time * 1.2 + i * 0.37);

    const p = harmonicPoint(t, phase, radiusMul);
    const q = transformPoint(p, yaw, pitch, roll);
    const f = fog(q.z);
    const pulse = 0.72 + 0.28 * Math.sin(time * 3.0 + i * 0.61);

    blendMode(ADD);
    fill(255, 255, 255, 50 * f * pulse);
    circle(q.x, q.y, 26 * pulse);

    blendMode(BLEND);
    fill(255, 255, 255, 210 * f);
    circle(q.x, q.y, 4.2 + 2.0 * pulse);
  }

  blendMode(BLEND);
}

// ---------------------------------------------------------------------------
// Nested orbital rings
// ---------------------------------------------------------------------------
function drawOrbitalRings(time, yaw, pitch, roll) {
  noFill();

  for (let r = 0; r < RING_COUNT; r++) {
    const k = r / (RING_COUNT - 1);
    const radius = 120 + k * 730;
    const wobble = 0.055 * Math.sin(time + r * 0.8);
    const alpha = 80 - k * 50;

    stroke(255, 255, 255, alpha);
    strokeWeight(r === 0 ? 1.2 : 0.52);

    beginShape();
    for (let i = 0; i <= 260; i++) {
      const a = (i / 260) * TWO_PI;
      const rr = radius * (1 + wobble * Math.sin(a * PRIME_A + time * PHI));

      const p = {
        x: Math.cos(a) * rr,
        y: Math.sin(a) * rr * 1.18,
        z: Math.sin(a * PRIME_B + time * 0.5 + r) * 56,
      };

      const q = transformPoint(p, yaw * 0.78, pitch + k * 0.20, roll);
      vertex(q.x, q.y, q.z);
    }
    endShape(CLOSE);
  }
}

// ---------------------------------------------------------------------------
// Central luminous seed
// ---------------------------------------------------------------------------
function drawCentralSeed(time) {
  push();
  noStroke();

  blendMode(ADD);
  for (let i = 5; i >= 1; i--) {
    const pulse = 1 + 0.08 * Math.sin(time * 2 + i);
    fill(255, 255, 255, 15 / i);
    sphere(42 * i * pulse, 32, 16);
  }

  blendMode(BLEND);
  fill(255, 255, 255, 235);
  sphere(16 + 3 * Math.sin(time * 2.0), 32, 16);

  pop();
}

// ---------------------------------------------------------------------------
// Sparse depth particles
// ---------------------------------------------------------------------------
function buildStars(count) {
  const arr = [];

  for (let i = 0; i < count; i++) {
    const a = random(TWO_PI);
    const r = random(560, 1280);

    arr.push({
      x: Math.cos(a) * r,
      y: random(-910, 910),
      z: Math.sin(a) * r,
      s: random(0.5, 1.9),
      p: random(TWO_PI),
    });
  }

  return arr;
}

function drawStarField(time, yaw, pitch) {
  noStroke();

  for (const s of stars) {
    const p = transformPoint(s, yaw * 0.16, pitch * 0.22, 0);
    const twinkle = 0.55 + 0.45 * Math.sin(time * 1.7 + s.p);
    const f = fog(p.z);

    fill(255, 255, 255, 36 * f * twinkle);
    circle(p.x, p.y, s.s);
  }
}

// ---------------------------------------------------------------------------
// Screen-space overlays
// ---------------------------------------------------------------------------
function drawVignette() {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);
  noFill();

  const maxR = Math.hypot(W, H) * 0.64;
  strokeWeight(maxR / 30);

  for (let i = 0; i < 30; i++) {
    const k = i / 29;
    const alp = constrain(map(k, 0.50, 1, 0, 185), 0, 185);
    stroke(0, 0, 0, alp);
    circle(0, 0, maxR * 2 * k);
  }

  pop();
}

function drawHUD(time) {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);
  textFont('monospace');

  const x = -W / 2 + 34;
  const y = H / 2 - 34;

  noStroke();
  fill(255, 255, 255, 185);
  textAlign(LEFT, BOTTOM);
  textSize(31);
  text('Prime Harmonic Field', x, y - 58);

  fill(255, 255, 255, 104);
  textSize(15);
  text('x=sin(3t+φ) · y=sin(5t) · z=sin(7t+ψ)', x, y - 26);

  fill(255, 255, 255, 70);
  textSize(12);
  text('Lissajous 3:5:7 · golden-ratio twist · monochrome p5.js WEBGL', x, y);

  // Right-side prime markers: 3 / 5 / 7.
  const cx = W / 2 - 52;
  const cy = H / 2 - 122;
  const primes = [3, 5, 7];

  for (let i = 0; i < primes.length; i++) {
    const yy = cy - i * 34;
    const pulse = 0.55 + 0.45 * Math.sin(time * 2.0 + i * 0.85);

    stroke(255, 255, 255, 110 + 95 * pulse);
    strokeWeight(1.1);
    noFill();
    circle(cx, yy, 20 + i * 3);

    noStroke();
    fill(255, 255, 255, 130 + 80 * pulse);
    textAlign(CENTER, CENTER);
    textSize(10);
    text(primes[i], cx, yy + 0.5);
  }

  fill(255, 255, 255, 48);
  textAlign(RIGHT, TOP);
  textSize(11);
  text('a:b:c = 3:5:7', W / 2 - 28, -H / 2 + 28);
  text('φ ≈ 1.618', W / 2 - 28, -H / 2 + 46);

  pop();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function keyReleased() {
  if (key === 'r' || key === 'R') {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
    return false;
  }

  if (key === 's' || key === 'S') {
    saveCanvas('20260512_prime_harmonic_' + timestamp(), 'png');
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Recording pipeline
// ---------------------------------------------------------------------------
function updateRecordingHUD() {
  if (!isRecording) return;

  const durEl    = document.getElementById('duration');
  const framesEl = document.getElementById('frameCount');
  const fillEl   = document.getElementById('progressFill');

  if (durEl)    durEl.textContent    = (recFrameCount / FPS).toFixed(1);
  if (framesEl) framesEl.textContent = recFrameCount;
  if (fillEl)   fillEl.style.width   = (100 * recFrameCount / LOOP_FRAMES).toFixed(2) + '%';
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;

  el.textContent = text;
  if (color) el.style.color = color;
}

function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    setStatus('WebCodecs unsupported · use Chrome', '#f44');
    return;
  }

  if (typeof Mp4Muxer === 'undefined') {
    setStatus('mp4-muxer not loaded', '#f44');
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: W,
      height: H,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      console.error(err);
      isRecording = false;
      setStatus('Encoder error', '#f44');
    },
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W,
    height: H,
    bitrate: 18_000_000,
    framerate: FPS,
  });

  recFrameCount = 0;
  isRecording = true;

  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');

  if (startBtn) startBtn.disabled = true;
  if (stopBtn)  stopBtn.disabled  = false;

  setStatus('Recording…', '#fff');
  updateRecordingHUD();
}

async function stopRecording() {
  if (!encoder || !muxer) return;

  isRecording = false;
  setStatus('Finalizing…', '#ccc');

  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');

  a.href = url;
  a.download = '20260512_prime_harmonic_' + timestamp() + '.mp4';
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;

  setTimeout(() => URL.revokeObjectURL(url), 6000);

  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');

  if (startBtn) startBtn.disabled = false;
  if (stopBtn)  stopBtn.disabled  = true;

  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;

  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1000000 / FPS),
  });

  encoder.encode(frame, {
    keyFrame: recFrameCount % FPS === 0,
  });

  frame.close();
}

function timestamp() {
  const d = new Date();

  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_`
       + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}
'use strict';

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const LOOP_SECONDS = 20;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

// Ring field
const RING_COUNT = 24;
const TRAIL_ALPHA = 28;   // higher = shorter trail, cleaner shapes

// Background the trail fades toward (deep navy — makes neons glow hard without blowing out)
// ── FULL PALETTE ──────────────────────────────────────────────────────────────
const COL = {
  darkSlate: [41, 48, 57],   // #293039
  darkForest: [40, 54, 49],  // #283631
  deepNavy: [13, 31, 45],    // #0d1f2d
  deepGreen: [10, 61, 46],   // #0a3d2e

  neonGreen: [0, 255, 135],  // #00ff87
  neonCyan: [0, 212, 255],   // #00d4ff
  electricPurple: [123, 47, 255], // #7b2fff
  neonPink: [255, 45, 122],  // #ff2d7a

  pastelMint: [176, 255, 232], // #b0ffe8
  pastelSky: [196, 240, 255],  // #c4f0ff
};

// Base background
const BG = COL.deepNavy;

// Ring/glow palette only
const PALETTE = [
  COL.electricPurple,
  COL.neonPink,
  COL.neonCyan,
  COL.neonGreen,
  COL.pastelMint,
  COL.pastelSky,
];

function ringColor(t) {
  const n = PALETTE.length;
  const f = t * (n - 1);
  const i = floor(f);
  const k = f - i;
  const a = PALETTE[i];
  const b = PALETTE[min(i + 1, n - 1)];
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

// Lissajous n:m pairs — each ring gets one based on its index
const LISSAJOUS_PAIRS = [
  [1, 2], [2, 3], [3, 4], [3, 5], [4, 5],
  [5, 6], [2, 5], [3, 7], [4, 7], [5, 8],
];

const PAPER_DOTS = 14000;
const PAPER_FIBERS = 140;

let rings = [];
let trailLayer = null;
let paperLayer = null;

let motionSeed = 0;
let phaseA = 0, phaseB = 0, phaseC = 0;
let phaseD = 0, phaseE = 0, phaseF = 0;

let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;
let canvasEl = null;

// ─── Setup ────────────────────────────────────────────────────────────────────

function setup() {
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  noFill();
  strokeCap(ROUND);

  // Trail buffer — drawn in 2D, composited each frame
  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  trailLayer.colorMode(RGB, 255, 255, 255, 255);
  trailLayer.background(BG[0], BG[1], BG[2]);

  paperLayer = createGraphics(W, H);
  paperLayer.pixelDensity(1);
  paperLayer.colorMode(RGB, 255, 255, 255, 255);

  buildRings();
  reseedPattern(floor(random(100000)));

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function buildRings() {
  rings = [];
  for (let i = 0; i < RING_COUNT; i++) {
    const t = i / RING_COUNT;
    rings.push({
      t,                              // normalized index 0..1
      seed: i * 137.508,             // golden-angle phase offset
      r: 0, theta: 0, phi2: 0,       // spherical-ish coords, animated each frame
    });
  }
}

function reseedPattern(seed) {
  motionSeed = seed;
  randomSeed(motionSeed);
  noiseSeed(motionSeed);
  phaseA = random(TWO_PI);
  phaseB = random(TWO_PI);
  phaseC = random(TWO_PI);
  phaseD = random(TWO_PI);
  phaseE = random(TWO_PI);
  phaseF = random(TWO_PI);

  // Reset trail to background color
  if (trailLayer) {
    trailLayer.background(BG[0], BG[1], BG[2]);
  }

  renderPaperTexture();
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const la = loop * TWO_PI; // loopAngle

  // --- Fade trail layer (motion blur) ---
  trailLayer.noStroke();
  trailLayer.fill(BG[0], BG[1], BG[2], TRAIL_ALPHA);
  trailLayer.rect(0, 0, W, H);

  // --- Draw each ring onto trail layer ---
  for (let i = 0; i < RING_COUNT; i++) {
    drawRingToTrail(rings[i], la);
  }

  // Global attractor — warm dot with soft halo
  const attrX = W * 0.5 + sin(la * 0.37 + phaseE) * W * 0.18;
  const attrY = H * 0.5 + cos(la * 0.29 + phaseF) * H * 0.22;
  const attrPulse = 0.7 + 0.3 * sin(la * 2.3 + phaseA);
  const ac = ringColor(0.08); // warm end of palette
  trailLayer.noStroke();
  trailLayer.fill(ac[0], ac[1], ac[2], 70 * attrPulse);
  trailLayer.circle(attrX, attrY, 26 * attrPulse);
  trailLayer.fill(196, 240, 255, 220 * attrPulse); // pastel sky core #c4f0ff
  trailLayer.circle(attrX, attrY, 7 * attrPulse);
  trailLayer.noFill();

  // --- Composite to WEBGL canvas ---
  background(BG[0], BG[1], BG[2]);
  push();
  translate(-W / 2, -H / 2, 0);
  image(trailLayer, 0, 0);
  pop();

  // --- Paper grain overlay ---
  push();
  translate(-W / 2, -H / 2, 0);
  tint(255, 55);
  image(paperLayer, 0, 0);
  noTint();
  pop();

  // --- Vignette: soft radial darkening at corners ---
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Ring drawing ─────────────────────────────────────────────────────────────
// Each "ring" is a 3D orbital ellipse — projected manually to 2D on the trail layer.
// We rotate the ring's plane with noise-animated Euler angles, then project each
// sample point using a simple perspective divide.

const RING_STEPS = 360;
const FOV = 500; // lower = stronger perspective, rings feel closer

function drawRingToTrail(rg, la) {
  const t = rg.t;

  // Ring center: deterministic grid (3 cols × 8 rows) + small noise drift
  const cols = 3, rows = 8;
  const col = floor(t * cols) % cols;
  const row = floor(t * (cols * rows) / cols) % rows;
  const gridX = map(col, 0, cols - 1, -W * 0.35, W * 0.35);
  const gridY = map(row, 0, rows - 1, -H * 0.42, H * 0.42);
  const noiseSpeed = 0.12;
  const drift = W * 0.10; // small wander so it's not rigid
  const cx3 = gridX + (noise(t * 1.4,     la * noiseSpeed + phaseA) - 0.5) * drift;
  const cy3 = gridY + (noise(t * 1.4 + 5, la * noiseSpeed + phaseB) - 0.5) * drift;
  const cz3 = (noise(t * 1.4 + 10,        la * noiseSpeed + phaseC) - 0.5) * 300;

  // Ring radius — varies by index and breathes
  const baseR = map(t, 0, 1, W * 0.14, W * 0.28);
  const breathe = 0.7 + 0.3 * sin(la * 1.1 + t * TWO_PI * 2.3 + phaseD);
  const rx = baseR * breathe;
  const ry = rx; // keep pure Lissajous (circular bounding box)

  // Lissajous n:m pair for this ring
  const [lN, lM] = LISSAJOUS_PAIRS[floor(t * LISSAJOUS_PAIRS.length)];
  // δ must be integer multiple of TWO_PI per loop for seamless looping
  const kPhase = floor(1 + t * 3); // integer: 1, 2 or 3 open/close cycles per loop
  const delta = la * kPhase + rg.seed;

  // Ring plane orientation — slow tumble driven by noise
  const rotX = la * (0.18 + t * 0.26) + phaseA + noise(t * 1.8, la * 0.12) * TWO_PI;
  const rotY = la * (0.22 + t * 0.19) + phaseB + noise(t * 1.6 + 7, la * 0.14) * TWO_PI;
  const rotZ = la * (0.08 + t * 0.13) + phaseC;

  // Depth: front rings are bright+thick, back rings are dim+thin
  const normZ = map(cz3, -400, 400, 0, 1);
  const depthAlpha = map(normZ, 0, 1, 255, 55);
  const sw = map(normZ, 0, 1, 2.8, 0.6);

  // Project all ring points
  const pts = [];
  for (let s = 0; s <= RING_STEPS; s++) {
    const angle = (s / RING_STEPS) * TWO_PI;
    let lx = rx * sin(lN * angle + delta);
    let ly = ry * sin(lM * angle);
    let lz = 0;

    let x = lx * cos(rotZ) - ly * sin(rotZ);
    let y = lx * sin(rotZ) + ly * cos(rotZ);
    let z = lz;

    const x2 = x * cos(rotY) + z * sin(rotY);
    const z2 = -x * sin(rotY) + z * cos(rotY);
    x = x2; z = z2;

    const y2 = y * cos(rotX) - z * sin(rotX);
    const z3 = y * sin(rotX) + z * cos(rotX);
    y = y2; z = z3;

    x += cx3; y += cy3; z += cz3;
    const p = FOV / (FOV + z + 600);
    pts.push([W * 0.5 + x * p, H * 0.5 + y * p]);
  }

  // Partial arc: draw ~70% of curve, window rotates with la
  const arcLen = floor(RING_STEPS * 0.70);
  const startStep = floor((la / TWO_PI) * RING_STEPS) % RING_STEPS;

  trailLayer.noFill();

  // Pick this ring's color from the palette (hue shifts slowly with time)
  const hueShift = 0.08 * sin(la + rg.seed * 0.01);
  const ringCol = ringColor(constrain(t + hueShift, 0, 1));

  // Pass 1: glow — thick + saturated color + low alpha (bloom halo)
  trailLayer.strokeWeight(sw * 4.5);
  trailLayer.stroke(ringCol[0], ringCol[1], ringCol[2], depthAlpha * 0.22);
  for (let i = 1; i <= arcLen; i++) {
    const a = (startStep + i - 1) % RING_STEPS;
    const b = (startStep + i)     % RING_STEPS;
    trailLayer.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
  }

  // Pass 2: core line — bright (near-white) + velocity-adaptive weight
  // Core is desaturated toward white so curves stay crisp and readable
  const cr = lerp(ringCol[0], 255, 0.55);
  const cg = lerp(ringCol[1], 255, 0.55);
  const cb = lerp(ringCol[2], 255, 0.55);
  for (let i = 1; i <= arcLen; i++) {
    const a = (startStep + i - 1) % RING_STEPS;
    const b = (startStep + i)     % RING_STEPS;
    const vel = dist(pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
    const w = map(vel, 0, rx * 0.06, sw * 3.2, sw * 0.5, true);
    trailLayer.strokeWeight(w);
    trailLayer.stroke(cr, cg, cb, depthAlpha);
    trailLayer.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
  }

  // Small dot at ring center (near rings only)
  if (normZ < 0.40 && depthAlpha > 100) {
    const p = FOV / (FOV + cz3 + 600);
    const sx = W * 0.5 + cx3 * p;
    const sy = H * 0.5 + cy3 * p;
    trailLayer.noStroke();
    trailLayer.fill(cr, cg, cb, depthAlpha * 0.9);
    trailLayer.circle(sx, sy, sw * 2.2);
    trailLayer.noFill();
  }

  // Connector line: ring center → global attractor (tinted, very faint)
  const attrX = W * 0.5 + sin(la * 0.37 + phaseE) * W * 0.18;
  const attrY = H * 0.5 + cos(la * 0.29 + phaseF) * H * 0.22;
  const p2 = FOV / (FOV + cz3 + 600);
  const projX = W * 0.5 + cx3 * p2;
  const projY = H * 0.5 + cy3 * p2;
  const connAlpha = depthAlpha * 0.14;
  if (connAlpha > 4) {
    trailLayer.strokeWeight(0.5);
    trailLayer.stroke(ringCol[0], ringCol[1], ringCol[2], connAlpha);
    trailLayer.line(projX, projY, attrX, attrY);
  }
}

// ─── Paper texture ────────────────────────────────────────────────────────────

function renderPaperTexture() {
  if (!paperLayer) return;
  paperLayer.clear();
  paperLayer.noStroke();

  for (let i = 0; i < PAPER_DOTS; i++) {
    const mix = random();
    let c;

    if (mix < 0.35) c = COL.darkSlate;
    else if (mix < 0.7) c = COL.darkForest;
    else c = COL.deepGreen;

    const alpha = random(3, 10);
    paperLayer.fill(c[0], c[1], c[2], alpha);
    paperLayer.circle(random(W), random(H), random(0.3, 1.8));
  }

  for (let i = 0; i < PAPER_DOTS * 0.08; i++) {
    const c = random() > 0.5 ? COL.pastelMint : COL.pastelSky;
    paperLayer.fill(c[0], c[1], c[2], random(2, 6));
    paperLayer.circle(random(W), random(H), random(0.3, 1.2));
  }

  paperLayer.stroke(COL.darkForest[0], COL.darkForest[1], COL.darkForest[2], 18);
  for (let i = 0; i < PAPER_FIBERS; i++) {
    const x = random(W);
    const y = random(H);
    paperLayer.line(x, y, x + random(-6, 6), y + random(16, 100));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
// Ring-based vignette drawn in WEBGL immediate mode. Alpha rises toward corners
// so the center stays clean and the edges sink into the background color.

function drawVignette() {
  push();
  noFill();
  const steps = 80;
  const maxR = dist(0, 0, W / 2, H / 2) * 1.08;
  const sw = (maxR / steps) * 2 + 2;
  strokeWeight(sw);

  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.55, 1.0, 0, 180, true);
    if (a <= 0) continue;

    const c = [
      lerp(COL.deepNavy[0], COL.darkForest[0], k),
      lerp(COL.deepNavy[1], COL.darkForest[1], k),
      lerp(COL.deepNavy[2], COL.darkForest[2], k),
    ];

    stroke(c[0], c[1], c[2], a);
    const r = lerp(0, maxR, k);
    circle(0, 0, r * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────

function mousePressed() {
  reseedPattern(floor(random(100000)));
}

function keyReleased() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('20260409_' + timestampString(), 'png');
    return false;
  }
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    reseedPattern(floor(random(100000)));
    return false;
  }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────

function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('WebCodecs not supported. Use Chrome or Edge.');
    return;
  }
  if (typeof Mp4Muxer === 'undefined') {
    alert('mp4-muxer failed to load.');
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
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
  a.download = '20260407_v4_' + timestampString() + '.mp4';
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
  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1_000_000 / FPS),
  });
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

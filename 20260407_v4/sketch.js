'use strict';

const COL = {
  darkSlate:       [41, 48, 57],
  darkForest:      [40, 54, 49],
  deepNavy:        [13, 31, 45],
  deepGreen:       [10, 61, 46],
  neonGreen:       [0, 255, 135],
  neonCyan:        [0, 212, 255],
  electricPurple:  [123, 47, 255],
  neonPink:        [255, 45, 122],
  pastelMint:      [176, 255, 232],
  pastelSky:       [196, 240, 255],
};

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const LOOP_SECONDS = 16;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

// Grid dimensions
const COLS = 9;
const ROWS = 16;
const LAYERS = 5;

const PAPER_DOTS = 14000;
const PAPER_FIBERS = 140;

let cells = [];
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

  paperLayer = createGraphics(W, H);
  paperLayer.pixelDensity(1);
  paperLayer.colorMode(RGB, 255, 255, 255, 255);

  buildCells();
  reseedPattern(floor(random(100000)));

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function buildCells() {
  cells = [];
  for (let iz = 0; iz < LAYERS; iz++) {
    for (let iy = 0; iy < ROWS; iy++) {
      for (let ix = 0; ix < COLS; ix++) {
        const nx = ix / (COLS - 1);
        const ny = iy / (ROWS - 1);
        const nz = iz / (LAYERS - 1);
        cells.push({
          baseX: (nx - 0.5) * W * 0.72,
          baseY: (ny - 0.5) * H * 0.82,
          baseZ: (nz - 0.5) * 320,
          nx, ny, nz,
        });
      }
    }
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
  renderPaperTexture();
}

// ─── Draw ─────────────────────────────────────────────────────────────────────

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const loopAngle = loop * TWO_PI;

  background(...COL.deepNavy);

  // Slow global camera tilt
  rotateX(cos(loopAngle * 0.35 + phaseB) * 0.18);
  rotateY(sin(loopAngle * 0.5 + phaseA) * 0.28);
  rotateZ(sin(loopAngle * 0.22 + phaseC) * 0.04);

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];

    // Per-cell Perlin noise displacement
    const noiseT = loop + c.nx * 1.1 + c.ny * 0.8 + c.nz * 0.6;
    const dx = noise(c.nx * 2.2, noiseT + phaseD) * 2 - 1;
    const dy = noise(c.ny * 2.4, noiseT + phaseE + 10) * 2 - 1;
    const dz = noise(c.nz * 3.1, noiseT + phaseF + 20) * 2 - 1;
    const dispScale = W * 0.04 + W * 0.07 * (sin(loopAngle * 0.5 + phaseA + c.nx * PI) * 0.5 + 0.5);

    const px = c.baseX + dx * dispScale;
    const py = c.baseY + dy * dispScale * 1.5;
    const pz = c.baseZ + dz * 140;

    // Size pulses with noise
    const sizePulse = noise(c.nx * 3, c.ny * 3, loopAngle * 0.3 + phaseB);
    const cellSize = W * 0.055 * (0.3 + sizePulse * 1.4);

    // Alpha fades by depth
    const depthAlpha = map(c.nz, 0, 1, 220, 40);
    const pulseAlpha = depthAlpha * (0.5 + 0.5 * sin(loopAngle * 1.2 + c.nx * 2.3 + c.ny * 1.8 + phaseC));

    if (pulseAlpha < 4) continue;

    push();
    translate(px, py, pz);

    const localRot = loopAngle + c.nx * 2.8 + c.ny * 1.6 + phaseD;
    rotateX(localRot * 0.31);
    rotateY(localRot * 0.47);
    rotateZ(localRot * 0.19);

    drawCell(cellSize, pulseAlpha, c, loopAngle);
    pop();
  }

  // Paper overlay (WEBGL origin is center, shift to top-left)
  push();
  translate(-W / 2, -H / 2, 0);
  tint(255, 70);
  image(paperLayer, 0, 0);
  noTint();
  pop();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Cell variants ────────────────────────────────────────────────────────────

function drawCell(sz, alpha, c, loopAngle) {
  const h = sz * 0.5;
  const variant = ((c.nx * 7 + c.ny * 13 + c.nz * 3) * 100 | 0) % 3;

  strokeWeight(0.6 + (1 - c.nz) * 0.8);

  if (variant === 0) {
    // Wireframe box — neonCyan
    stroke(...COL.neonCyan, alpha);
    noFill();
    box(sz);

  } else if (variant === 1) {
    // Nested wireframe boxes — neonGreen outer, electricPurple inner
    stroke(...COL.neonGreen, alpha);
    noFill();
    box(sz);
    const inner = sz * (0.45 + 0.15 * sin(loopAngle + c.nx * PI));
    stroke(...COL.electricPurple, alpha * 0.55);
    box(inner);

  } else {
    // Three intersecting rectangles — neonPink / neonCyan / neonGreen
    noFill();
    stroke(...COL.neonPink, alpha);
    beginShape();
    vertex(-h, -h, 0); vertex(h, -h, 0);
    vertex(h, h, 0);   vertex(-h, h, 0);
    endShape(CLOSE);

    stroke(...COL.neonCyan, alpha * 0.6);
    beginShape();
    vertex(-h, 0, -h); vertex(h, 0, -h);
    vertex(h, 0, h);   vertex(-h, 0, h);
    endShape(CLOSE);

    stroke(...COL.neonGreen, alpha * 0.35);
    beginShape();
    vertex(0, -h, -h); vertex(0, h, -h);
    vertex(0, h, h);   vertex(0, -h, h);
    endShape(CLOSE);
  }

  // Dot at center for near-front cells — pastelMint
  if (c.nz < 0.25 && alpha > 80) {
    fill(...COL.pastelMint, alpha);
    noStroke();
    sphere(sz * 0.07);
    noFill();
  }
}

// ─── Paper texture ────────────────────────────────────────────────────────────

function renderPaperTexture() {
  if (!paperLayer) return;
  paperLayer.clear();
  paperLayer.noStroke();
  for (let i = 0; i < PAPER_DOTS; i++) {
    const bright = random() > 0.12;
    const alpha = bright ? random(2, 10) : random(1, 6);
    if (bright) {
      paperLayer.fill(...COL.darkSlate, alpha);
    } else {
      paperLayer.fill(...COL.pastelSky, alpha);
    }
    paperLayer.circle(random(W), random(H), random(0.3, 1.6));
  }
  paperLayer.stroke(...COL.darkForest, 6);
  for (let i = 0; i < PAPER_FIBERS; i++) {
    const x = random(W);
    const y = random(H);
    paperLayer.line(x, y, x + random(-7, 7), y + random(18, 130));
  }
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
    saveCanvas('20260407_v4_' + timestampString(), 'png');
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

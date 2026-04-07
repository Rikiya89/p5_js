'use strict';

// ── Constants ─────────────────────────────────────────────────
const W            = 1080;
const H            = 1920;
const FPS          = 60;
const MAX_DURATION = 24;
const MAX_FRAMES   = FPS * MAX_DURATION;

const BORDER       = 10;
const STEP_SIZE    = 4;
const MIN_LENGTH   = 16;
const ANGLE_COUNT  = 9;       // more angle variety → denser mesh
const NUM_AGENTS   = 8;
const SPEED        = 14;      // steps per frame per agent

// ── Agent ─────────────────────────────────────────────────────
const NORTH = 0, EAST = 1, SOUTH = 2, WEST = 3;

function makeAgent(i) {
  // scatter start positions across the canvas in a grid-ish pattern
  const col = i % 4;
  const row = floor(i / 4);
  const sx  = map(col, 0, 3, W * 0.12, W * 0.88) + random(-60, 60);
  const sy  = map(row, 0, 1, H * 0.22, H * 0.78) + random(-80, 80);
  const dir = floor(random(4));
  return {
    x: sx, y: sy,
    cx: sx, cy: sy,
    dir,
    angle: getRandomAngle(dir),
    weight: 0.6 + random(1.4),   // each agent has a characteristic line weight
    reachedBorder: false,
  };
}

function getRandomAngle(dir) {
  const a = (floor(random(-ANGLE_COUNT, ANGLE_COUNT)) + 0.5) * 90 / ANGLE_COUNT;
  if (dir === NORTH) return a - 90;
  if (dir === EAST)  return a;
  if (dir === SOUTH) return a + 90;
  if (dir === WEST)  return a + 180;
  return 0;
}

// ── State ─────────────────────────────────────────────────────
let agents = [];
let fc     = 0;

// ── Recording ─────────────────────────────────────────────────
let muxer         = null;
let encoder       = null;
let isRecording   = false;
let recFrameCount = 0;
let canvasEl      = null;

// ── Setup ─────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl  = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  resetScene();
  updateCanvasInfo();
  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
}

function resetScene() {
  background(0);
  drawVignette();
  fc = 0;
  agents = [];
  for (let i = 0; i < NUM_AGENTS; i++) agents.push(makeAgent(i));
}

// very subtle radial gradient burnt into the BG at reset
function drawVignette() {
  noStroke();
  for (let r = max(W, H) * 0.72; r > 0; r -= 6) {
    const t   = r / (max(W, H) * 0.72);
    const alp = map(t, 0, 1, 0, 38);
    fill(0, 0, 0, alp);
    ellipse(W * 0.5, H * 0.5, r * 2 * (W / H), r * 2);
  }
}

// ── Draw ──────────────────────────────────────────────────────
function draw() {
  // very slow fade — lines ghost out over ~20 s
  noStroke();
  fill(0, 0, 0, 3);
  rect(0, 0, W, H);

  for (const ag of agents) {
    for (let i = 0; i < SPEED; i++) stepAgent(ag);
  }

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

function stepAgent(ag) {
  ag.x += cos(radians(ag.angle)) * STEP_SIZE;
  ag.y += sin(radians(ag.angle)) * STEP_SIZE;

  // border
  ag.reachedBorder = false;
  if (ag.y <= BORDER)        { ag.dir = SOUTH; ag.reachedBorder = true; }
  else if (ag.x >= W-BORDER) { ag.dir = WEST;  ag.reachedBorder = true; }
  else if (ag.y >= H-BORDER) { ag.dir = NORTH; ag.reachedBorder = true; }
  else if (ag.x <= BORDER)   { ag.dir = EAST;  ag.reachedBorder = true; }

  // pixel collision: any pixel brighter than threshold → we hit a drawn line
  const px     = get(floor(ag.x), floor(ag.y));
  const bright = (px[0] + px[1] + px[2]) / 3;
  const onLine = !ag.reachedBorder && bright > 18;

  if (ag.reachedBorder || onLine) {
    ag.angle = getRandomAngle(ag.dir);

    const d = dist(ag.x, ag.y, ag.cx, ag.cy);
    if (d >= MIN_LENGTH) {
      drawStroke(ag.cx, ag.cy, ag.x, ag.y, ag.weight, d);
    }
    ag.cx = ag.x;
    ag.cy = ag.y;
  }
}

function drawStroke(x1, y1, x2, y2, baseW, d) {
  // line weight scales with segment length — long sweeps are bolder
  const w = baseW * map(d, MIN_LENGTH, 400, 0.5, 2.2, true);

  // === outer bloom ===
  strokeWeight(w * 9);
  stroke(255, 255, 255, 5);
  line(x1, y1, x2, y2);

  strokeWeight(w * 5);
  stroke(255, 255, 255, 10);
  line(x1, y1, x2, y2);

  // === soft halo ===
  strokeWeight(w * 2.8);
  stroke(255, 255, 255, 28);
  line(x1, y1, x2, y2);

  // === crisp core ===
  strokeWeight(w * 0.9);
  stroke(255, 255, 255, 220);
  line(x1, y1, x2, y2);

  // === specular highlight (thinnest, brightest) ===
  strokeWeight(w * 0.3);
  stroke(255, 255, 255, 255);
  line(x1, y1, x2, y2);

  // node dots at intersections
  const dotR = w * 1.6;
  strokeWeight(dotR * 3);
  stroke(255, 255, 255, 18);
  point(x1, y1); point(x2, y2);
  strokeWeight(dotR);
  stroke(255, 255, 255, 180);
  point(x1, y1); point(x2, y2);
}

// ── Keys ──────────────────────────────────────────────────────
function keyReleased() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    resetScene(); return false;
  }
  return true;
}

// ── Recording ─────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('WebCodecs not supported. Use Chrome or Edge.'); return;
  }
  if (typeof Mp4Muxer === 'undefined') {
    alert('mp4-muxer failed to load.'); return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });

  encoder.configure({
    codec: 'avc1.640028', width: W, height: H,
    bitrate: 18_000_000, framerate: FPS,
  });

  recFrameCount = 0;
  isRecording   = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording…', '#fff');
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
  a.download = 'p_2_2_2_01_20260407.mp4';
  a.click();

  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
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

// ── UI ────────────────────────────────────────────────────────
function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text; el.style.color = color;
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

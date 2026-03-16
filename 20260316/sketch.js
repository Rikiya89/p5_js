"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette ───────────────────── */
const BG_DEEP   = [13, 31, 45];    // #0d1f2d
const BG_FOREST = [10, 61, 46];    // #0a3d2e
const BG_SLATE  = [41, 48, 57];    // #293039
const BG_MOSS   = [40, 54, 49];    // #283631

const MINT      = [0, 255, 135];   // #00ff87
const CYAN      = [0, 212, 255];   // #00d4ff
const VIOLET    = [123, 47, 255];  // #7b2fff
const MAGENTA   = [255, 45, 122];  // #ff2d7a
const PALE_MINT = [176, 255, 232]; // #b0ffe8
const PALE_CYAN = [196, 240, 255]; // #c4f0ff

const ACCENT_COLORS = [MINT, CYAN, VIOLET, MAGENTA, PALE_MINT, PALE_CYAN];

/* ───────────────────── Grid Layout ───────────────────── */
const GRID_COLS = 3;
const GRID_ROWS = 5;
const GRID_PAD  = 52;
const CELL_GAP  = 16;

/* ───────────────────── Mandala Config ───────────────────── */
const SHAPE_TYPES = 5; // circle, polygon, star, flower, wave-ring
const LAYER_COUNT = 5; // concentric layers per mandala
const MORPH_SPEED = 0.4;

/* ───────────────────── State ───────────────────── */
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "grid_mandala_20260316.mp4";

let fc = 0;
let pg = null;        // trail buffer
let mandalas = [];
let gridLines = [];

/* ───────────────────── Recording Boilerplate ───────────────────── */
function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs not supported. Use Chrome or Edge.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer failed to load.");
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
    error: (err) => { console.error(err); setStatus("Encoder error"); isRecording = false; },
  });
  encoder.configure({
    codec: "avc1.640028", width: W, height: H,
    bitrate: 16_000_000, framerate: FPS,
  });
  fc = 0;
  recordingFrameCount = 0;
  isRecording = true;
  clearDownloadLink();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  updateDownloadButton(false);
  setStatus("Recording...");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing...");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  setDownloadLink(url, latestRecordingFilename);
  updateDownloadButton(true);
  triggerDownload(url, latestRecordingFilename);
  encoder.close(); encoder = null; muxer = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("MP4 ready.");
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(t) { const e = document.getElementById("status"); if (e) e.textContent = t; }
function updateRecordingUI() {
  const d = document.getElementById("duration"), f = document.getElementById("frameCount");
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}
function updateCanvasInfo() { const e = document.getElementById("canvasSize"); if (e) e.textContent = W + " x " + H; }
function setDownloadLink(url, fn) { const l = document.getElementById("downloadLink"); if (!l) return; l.href = url; l.download = fn; l.hidden = false; l.textContent = "Direct Link"; }
function clearDownloadLink() {
  if (latestRecordingUrl) { URL.revokeObjectURL(latestRecordingUrl); latestRecordingUrl = ""; }
  const l = document.getElementById("downloadLink"); if (!l) return; l.hidden = true; l.removeAttribute("href"); updateDownloadButton(false);
}
function updateDownloadButton(on) { const b = document.getElementById("downloadBtn"); if (b) b.disabled = !on; }
function triggerDownload(url, fn) { const a = document.createElement("a"); a.href = url; a.download = fn; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); }
function downloadLatestRecording() { if (!latestRecordingUrl) { setStatus("No MP4 yet."); return; } triggerDownload(latestRecordingUrl, latestRecordingFilename); }

/* ───────────────────── p5 Setup ───────────────────── */
function setup() {
  pixelDensity(1);
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);
  pg.background(...BG_DEEP);

  buildMandalas();
  buildGridLines();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Build ───────────────────── */
function buildMandalas() {
  mandalas = [];
  const rng = makeRng(20260316);
  const cellW = (W - GRID_PAD * 2 - CELL_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cellH = (H - GRID_PAD * 2 - CELL_GAP * (GRID_ROWS - 1)) / GRID_ROWS;
  const radius = Math.min(cellW, cellH) * 0.42;

  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const cx = GRID_PAD + col * (cellW + CELL_GAP) + cellW * 0.5;
      const cy = GRID_PAD + row * (cellH + CELL_GAP) + cellH * 0.5;

      const layers = [];
      for (let l = 0; l < LAYER_COUNT; l++) {
        const t = l / (LAYER_COUNT - 1);
        layers.push({
          radiusFactor: 0.3 + t * 0.7,
          shapeFrom: floor(rng() * SHAPE_TYPES),
          shapeTo: floor(rng() * SHAPE_TYPES),
          petalCount: 4 + floor(rng() * 9),
          rotSpeed: (rng() - 0.5) * 0.8,
          colorIndex: floor(rng() * ACCENT_COLORS.length),
          weight: 1.0 + rng() * 1.8,
          morphOffset: rng() * TWO_PI,
        });
      }

      mandalas.push({
        cx, cy, radius,
        layers,
        symmetry: 4 + floor(rng() * 9),
        basePhase: rng() * TWO_PI,
        pulseSpeed: 0.6 + rng() * 1.2,
        morphCycle: 3.0 + rng() * 5.0,
      });
    }
  }
}

function buildGridLines() {
  gridLines = [];
  const cellW = (W - GRID_PAD * 2 - CELL_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cellH = (H - GRID_PAD * 2 - CELL_GAP * (GRID_ROWS - 1)) / GRID_ROWS;

  for (let col = 0; col <= GRID_COLS; col++) {
    const x = GRID_PAD + col * (cellW + CELL_GAP) - CELL_GAP * 0.5;
    gridLines.push({ x1: x, y1: GRID_PAD - 10, x2: x, y2: H - GRID_PAD + 10 });
  }
  for (let row = 0; row <= GRID_ROWS; row++) {
    const y = GRID_PAD + row * (cellH + CELL_GAP) - CELL_GAP * 0.5;
    gridLines.push({ x1: GRID_PAD - 10, y1: y, x2: W - GRID_PAD + 10, y2: y });
  }
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const theta = loopT * TWO_PI;
  const timeSec = fc / FPS;

  // Fade trail buffer
  pg.noStroke();
  pg.fill(...BG_DEEP, 18);
  pg.rect(0, 0, W, H);

  // Draw grid structure on trail buffer
  drawGrid(pg, theta);

  // Draw each mandala on trail buffer
  for (let i = 0; i < mandalas.length; i++) {
    drawMandala(pg, mandalas[i], timeSec, theta, i);
  }

  // Composite to main canvas
  background(0);
  image(pg, 0, 0);

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

function drawGrid(g, theta) {
  for (let i = 0; i < gridLines.length; i++) {
    const ln = gridLines[i];
    const pulse = 0.4 + 0.6 * (0.5 + 0.5 * sin(theta * 0.5 + i * 0.3));
    const alpha = 18 * pulse;
    g.stroke(...BG_MOSS, alpha * 3);
    g.strokeWeight(0.8);
    g.line(ln.x1, ln.y1, ln.x2, ln.y2);
  }

  // Grid intersection dots
  const cellW = (W - GRID_PAD * 2 - CELL_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const cellH = (H - GRID_PAD * 2 - CELL_GAP * (GRID_ROWS - 1)) / GRID_ROWS;
  for (let row = 0; row <= GRID_ROWS; row++) {
    for (let col = 0; col <= GRID_COLS; col++) {
      const x = GRID_PAD + col * (cellW + CELL_GAP) - CELL_GAP * 0.5;
      const y = GRID_PAD + row * (cellH + CELL_GAP) - CELL_GAP * 0.5;
      const flicker = 0.5 + 0.5 * sin(theta * 2 + (row + col) * 1.1);
      g.noStroke();
      g.fill(...PALE_MINT, 30 * flicker);
      g.circle(x, y, 4);
    }
  }
}

function drawMandala(g, m, timeSec, theta, index) {
  g.push();
  g.translate(m.cx, m.cy);

  const breathe = 1.0 + 0.08 * sin(theta * m.pulseSpeed + m.basePhase);

  for (let l = m.layers.length - 1; l >= 0; l--) {
    const layer = m.layers[l];
    const layerR = m.radius * layer.radiusFactor * breathe;
    const rotation = timeSec * layer.rotSpeed + m.basePhase;

    // Morph factor oscillates between shapes
    const morphT = 0.5 + 0.5 * sin(timeSec * MORPH_SPEED + layer.morphOffset);

    const col = ACCENT_COLORS[layer.colorIndex];
    const alphaBase = 100 + 80 * (1 - layer.radiusFactor);
    const alpha = alphaBase * (0.6 + 0.4 * sin(theta + l * 0.7));

    g.push();
    g.rotate(rotation);
    g.noFill();
    g.stroke(...col, alpha);
    g.strokeWeight(layer.weight);

    // Draw symmetrical mandala shape
    drawMandalaShape(g, 0, 0, layerR, m.symmetry, layer, morphT);

    // Mirror layer with half-step rotation
    g.rotate(PI / m.symmetry);
    g.stroke(...col, alpha * 0.4);
    g.strokeWeight(layer.weight * 0.6);
    drawMandalaShape(g, 0, 0, layerR * 0.85, m.symmetry, layer, 1.0 - morphT);

    g.pop();
  }

  // Center glow dot
  const glowPulse = 0.5 + 0.5 * sin(theta * 2 + m.basePhase);
  const cCol = ACCENT_COLORS[index % ACCENT_COLORS.length];
  g.noStroke();
  for (let r = 3; r >= 0; r--) {
    const t = r / 3;
    g.fill(...cCol, 15 + 50 * (1 - t) * glowPulse);
    g.circle(0, 0, (8 + r * 8) * breathe);
  }

  g.pop();
}

function drawMandalaShape(g, cx, cy, radius, symmetry, layer, morphT) {
  const shapeA = layer.shapeFrom;
  const shapeB = layer.shapeTo;
  const petals = layer.petalCount;
  const steps = symmetry * 12;
  const angleStep = TWO_PI / steps;

  g.beginShape();
  for (let i = 0; i <= steps; i++) {
    const a = i * angleStep;
    const symAngle = a * symmetry;

    const rA = shapeRadius(shapeA, a, symAngle, radius, petals, symmetry);
    const rB = shapeRadius(shapeB, a, symAngle, radius, petals, symmetry);
    const r = lerp(rA, rB, morphT);

    const x = cx + cos(a) * r;
    const y = cy + sin(a) * r;
    g.vertex(x, y);
  }
  g.endShape(CLOSE);
}

function shapeRadius(shapeType, angle, symAngle, baseR, petals, symmetry) {
  switch (shapeType) {
    case 0: // Circle
      return baseR;

    case 1: // Polygon
      return baseR * polygonRadius(angle, symmetry);

    case 2: // Star
      return baseR * (0.5 + 0.5 * abs(cos(symAngle * 0.5)));

    case 3: // Flower petals
      return baseR * (0.4 + 0.6 * abs(sin(angle * petals * 0.5)));

    case 4: // Wave ring
      return baseR * (0.7 + 0.3 * sin(angle * petals + symAngle * 0.3));

    default:
      return baseR;
  }
}

function polygonRadius(angle, sides) {
  const halfAngle = PI / sides;
  const sectorAngle = ((angle % (TWO_PI / sides)) + (TWO_PI / sides)) % (TWO_PI / sides);
  const offset = abs(sectorAngle - halfAngle);
  return cos(halfAngle) / cos(offset);
}

/* ───────────────────── Input ───────────────────── */
function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  return true;
}

/* ───────────────────── Utilities ───────────────────── */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

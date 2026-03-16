"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── State ───────────────────── */
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "exponentiation_3d_20260316.mp4";

let fc = 0;
let captureCanvas = null;
let captureCtx = null;

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
  captureCtx.drawImage(canvasEl, 0, 0);
  const frame = new VideoFrame(captureCanvas, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
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

/* ───────────────────── Utility ───────────────────── */
const PHI = 1.618033988749;
const TAU = Math.PI * 2;

// Deterministic pseudo-random based on seed
function hash(x) {
  let h = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/* ───────────────────── p5 Setup ───────────────────── */
function setup() {
  pixelDensity(1);
  setAttributes("preserveDrawingBuffer", true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);

  captureCanvas = document.createElement("canvas");
  captureCanvas.width = W;
  captureCanvas.height = H;
  captureCtx = captureCanvas.getContext("2d");

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS; // time in seconds
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES; // 0→1 over full loop

  background(0);

  // Camera: slow orbit around the scene
  const camAngle = t * 0.15;
  const camR = 650;
  const camY = -350 + 80 * Math.sin(t * 0.2);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, 50, 0,
    0, 1, 0
  );

  // Lighting: dramatic black & white
  ambientLight(30);
  directionalLight(255, 255, 255, 0.5, -1, -0.3);
  directionalLight(120, 120, 120, -0.8, -0.5, 0.6);
  directionalLight(60, 60, 60, 0.2, 0.3, -1);
  pointLight(200, 200, 200, 0, -400, 0);

  noStroke();

  // ── 1. Exponential Tower Grid ──
  // Columns on a grid whose height = base^exponent, morphing over time
  const gridN = 9;
  const spacing = 55;
  const offset = (gridN - 1) * spacing * 0.5;

  for (let ix = 0; ix < gridN; ix++) {
    for (let iz = 0; iz < gridN; iz++) {
      const px = ix * spacing - offset;
      const pz = iz * spacing - offset;
      const dist = Math.sqrt(px * px + pz * pz);
      const normDist = dist / (offset * 1.414);

      // Exponentiation: height = pow(base, exponent)
      // base oscillates, exponent depends on distance from center
      const base = 1.2 + 0.8 * Math.sin(t * 0.4 + normDist * TAU);
      const exponent = 1.0 + 3.5 * (1.0 - normDist) + 0.5 * Math.sin(t * 0.3 + ix * 0.5 + iz * 0.7);
      const h = Math.pow(base, exponent) * 8;
      const clampedH = Math.min(h, 350);

      // Grayscale based on height — taller = brighter
      const brightness = map(clampedH, 0, 350, 40, 255);
      ambientMaterial(brightness);

      push();
      translate(px, -clampedH * 0.5, pz);
      box(spacing * 0.7, clampedH, spacing * 0.7);
      pop();
    }
  }

  // ── 2. Exponential Spiral Arms ──
  // 3D spirals where radius = e^(k*theta)
  const numArms = 3;
  const pointsPerArm = 120;

  for (let arm = 0; arm < numArms; arm++) {
    const armOffset = (arm / numArms) * TAU;
    const dir = arm % 2 === 0 ? 1 : -1;

    for (let i = 0; i < pointsPerArm; i++) {
      const frac = i / pointsPerArm;
      const theta = frac * TAU * 2.5 + armOffset + t * 0.3 * dir;

      // Exponential spiral: r = a * e^(b * theta)
      const r = 15 * Math.exp(0.18 * (frac * TAU * 2.5));
      const clampedR = Math.min(r, 500);

      const sx = clampedR * Math.cos(theta);
      const sz = clampedR * Math.sin(theta);
      const sy = -200 - 80 * Math.sin(frac * Math.PI) + 30 * Math.sin(t * 0.5 + frac * 5);

      // Size grows exponentially along the arm
      const size = 3 + Math.pow(frac, 2.5) * 18;

      const bright = map(frac, 0, 1, 220, 60);
      ambientMaterial(bright);

      push();
      translate(sx, sy, sz);
      sphere(size, 6, 6);
      pop();
    }
  }

  // ── 3. Floating Exponential Curves (x^n visualization) ──
  // Draw curves for x^2, x^3, x^4 as 3D ribbons
  const exponents = [2, 3, 4, 5];
  const curvePoints = 80;

  for (let e = 0; e < exponents.length; e++) {
    const n = exponents[e];
    const yBase = 150 + e * 60;
    const rotAngle = t * 0.2 + e * 0.8;

    const bright = map(e, 0, exponents.length - 1, 255, 100);
    ambientMaterial(bright);

    push();
    rotateY(rotAngle);

    for (let i = 0; i < curvePoints; i++) {
      const frac = i / curvePoints;
      const x = frac * 2.0 - 1.0; // -1 to 1
      const y = Math.pow(Math.abs(x), n) * (x < 0 ? -1 : 1);

      const cx = x * 250;
      const cy = yBase - y * 120;
      const cz = 20 * Math.sin(frac * TAU + t);

      const s = 4 + 3 * (1 - Math.abs(x));

      push();
      translate(cx, cy, cz);
      box(s, s, s);
      pop();
    }
    pop();
  }

  // ── 4. Central Monolith: exponential growth tower ──
  {
    const numSegments = 20;
    let currentY = 0;

    for (let i = 0; i < numSegments; i++) {
      const frac = i / numSegments;
      // Each segment height = exponential decay (tall at bottom, thin at top)
      const segH = 8 + 25 * Math.pow(0.85, i);
      // Width decays exponentially
      const segW = 40 * Math.pow(0.88, i) + 5;

      const pulse = 1.0 + 0.1 * Math.sin(t * 2 + i * 0.5);
      const w = segW * pulse;

      const bright = map(i, 0, numSegments - 1, 180, 255);
      ambientMaterial(bright);

      push();
      translate(0, -currentY - segH * 0.5, 0);
      rotateY(i * 0.12 + t * 0.1);
      box(w, segH, w);
      pop();

      currentY += segH;
    }

    // Crown: glowing sphere at top
    ambientMaterial(255);
    push();
    translate(0, -currentY - 15, 0);
    const crownSize = 12 + 4 * Math.sin(t * 1.5);
    sphere(crownSize, 12, 12);
    pop();
  }

  // ── 5. Ground plane: exponential decay rings ──
  {
    const numRings = 15;
    for (let i = 1; i <= numRings; i++) {
      const r = 40 * i;
      const thick = 3 * Math.pow(0.9, i);
      const bright = map(i, 1, numRings, 80, 15);
      ambientMaterial(bright);

      push();
      translate(0, 2, 0);
      rotateX(HALF_PI);
      torus(r, thick, 48, 8);
      pop();
    }
  }

  // ── 6. Falling particles: exponential acceleration ──
  {
    const numParticles = 60;
    for (let i = 0; i < numParticles; i++) {
      const seed = hash(i * 7.31);
      const seed2 = hash(i * 13.17);
      const seed3 = hash(i * 23.71);

      // Each particle falls with exponential acceleration
      const period = 3 + seed * 5;
      const phase = ((t + seed * 100) % period) / period;

      // y = exponential acceleration: y = e^(k*t) - 1
      const fallY = (Math.exp(phase * 3) - 1) / (Math.exp(3) - 1);

      const px = (seed - 0.5) * 600;
      const pz = (seed2 - 0.5) * 600;
      const py = -400 + fallY * 500;

      const size = 2 + seed3 * 4;
      const bright = map(fallY, 0, 1, 255, 40);
      ambientMaterial(bright);

      push();
      translate(px, py, pz);
      sphere(size, 4, 4);
      pop();
    }
  }

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
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

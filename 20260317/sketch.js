"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette (black & white) ───────────────────── */
const BG      = [0, 0, 0];
const MINT    = [255, 255, 255];
const CYAN    = [220, 220, 220];
const VIOLET  = [180, 180, 180];
const MAGENTA = [140, 140, 140];
const PALE_MINT = [240, 240, 240];
const PALE_CYAN = [200, 200, 200];

const CURVE_COLORS = [MINT, CYAN, VIOLET, MAGENTA, PALE_MINT, PALE_CYAN];

/* ───────────────────── Rolle Curve Config ───────────────────── */
const NUM_CURVES = 8;
const CURVE_RESOLUTION = 200;
const CYLINDER_RADIUS = 220;
const CURVE_HEIGHT = 300;

/* ───────────────────── State ───────────────────── */
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "rolles_theorem_20260317.mp4";

let fc = 0;
let captureCanvas = null;
let captureCtx = null;

let rolleCurves = [];
let particles = [];

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

/* ───────────────────── Utilities ───────────────────── */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ───────────────────── Rolle Curve Generation ───────────────────── */
// Each curve is f(x) on [0,1] with f(0) = f(1) = 0 (Rolle's condition)
// We use combinations of sin harmonics: f(x) = sum( a_k * sin(k*PI*x) )
// Derivative: f'(x) = sum( a_k * k*PI * cos(k*PI*x) )
// Critical points where f'(c) = 0

function buildCurves() {
  const rng = makeRng(20260317);
  rolleCurves = [];

  for (let i = 0; i < NUM_CURVES; i++) {
    // Random harmonic coefficients (guarantees f(0)=f(1)=0 by construction)
    const numHarmonics = 2 + Math.floor(rng() * 3);
    const harmonics = [];
    for (let k = 0; k < numHarmonics; k++) {
      harmonics.push({
        n: k + 1,
        amp: (rng() - 0.3) * 1.5,
      });
    }

    // Evaluate function at resolution points
    const points = [];
    for (let j = 0; j <= CURVE_RESOLUTION; j++) {
      const x = j / CURVE_RESOLUTION;
      let y = 0;
      for (const h of harmonics) {
        y += h.amp * Math.sin(h.n * Math.PI * x);
      }
      points.push({ x, y });
    }

    // Normalize y to [-1, 1]
    let maxAbs = 0;
    for (const p of points) maxAbs = Math.max(maxAbs, Math.abs(p.y));
    if (maxAbs > 0) for (const p of points) p.y /= maxAbs;

    // Find critical points (f'(c) = 0) numerically
    const criticals = [];
    for (let j = 1; j < CURVE_RESOLUTION; j++) {
      const dy1 = points[j].y - points[j - 1].y;
      const dy2 = points[j + 1].y - points[j].y;
      if (dy1 * dy2 <= 0 && (Math.abs(dy1) + Math.abs(dy2)) > 0.001) {
        criticals.push({
          x: points[j].x,
          y: points[j].y,
          index: j,
        });
      }
    }

    const baseAngle = (i / NUM_CURVES) * TWO_PI;
    const colorIdx = i % CURVE_COLORS.length;

    rolleCurves.push({
      points,
      criticals,
      harmonics,
      baseAngle,
      color: CURVE_COLORS[colorIdx],
      phaseOffset: rng() * TWO_PI,
      waveSpeed: 0.3 + rng() * 0.5,
      ribbonWidth: 3 + rng() * 5,
    });
  }
}

function buildParticles() {
  const rng = makeRng(31720260);
  particles = [];
  for (let i = 0; i < 60; i++) {
    particles.push({
      angle: rng() * TWO_PI,
      y: (rng() - 0.5) * CURVE_HEIGHT * 2.5,
      r: CYLINDER_RADIUS * (0.5 + rng() * 1.2),
      speed: (rng() - 0.5) * 0.08,
      ySpeed: (rng() - 0.5) * 0.3,
      size: 1 + rng() * 2,
      colorIdx: Math.floor(rng() * CURVE_COLORS.length),
    });
  }
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

  buildCurves();
  buildParticles();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS;
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const theta = loopT * TWO_PI;

  background(BG[0], BG[1], BG[2]);

  // Camera orbit
  const camAngle = t * 0.1;
  const camR = 600 + 80 * Math.sin(t * 0.05);
  const camY = -100 + 150 * Math.sin(t * 0.09);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, 0, 0,
    0, 1, 0
  );

  // Lighting
  ambientLight(25, 30, 28);
  pointLight(CYAN[0] * 0.4, CYAN[1] * 0.4, CYAN[2] * 0.4, 0, -400, 0);
  pointLight(VIOLET[0] * 0.3, VIOLET[1] * 0.3, VIOLET[2] * 0.3, 300, 100, -300);
  pointLight(MINT[0] * 0.2, MINT[1] * 0.2, MINT[2] * 0.2, -200, 200, 200);

  // ── Base ring: the f(a)=f(b) level (y=0 plane) ──
  drawBaseRing(t, theta);

  // ── Vertical axis (interval [a,b]) ──
  drawAxis(t);

  // ── Rolle curves on cylinder ──
  for (let i = 0; i < rolleCurves.length; i++) {
    drawRolleCurve(rolleCurves[i], t, theta, i);
  }

  // ── Critical point connections ──
  drawCriticalNetwork(t, theta);

  // ── Floating particles ──
  drawParticles(t);

  // ── Central theorem glow ──
  drawCenterGlow(t, theta);

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

/* ───────────────────── Base Ring ───────────────────── */
function drawBaseRing(t, theta) {
  // Two rings at y=0 representing f(a) = f(b) boundary
  const pulse = 0.7 + 0.3 * Math.sin(theta * 0.5);

  push();
  rotateX(HALF_PI);
  noFill();

  // Outer ring
  stroke(CYAN[0], CYAN[1], CYAN[2], 40 * pulse);
  strokeWeight(1.2);
  const segments = 120;
  beginShape();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * TWO_PI;
    const r = CYLINDER_RADIUS + 4 * Math.sin(a * 8 + t * 2);
    vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  endShape();

  // Inner ring
  stroke(MINT[0], MINT[1], MINT[2], 25 * pulse);
  strokeWeight(0.8);
  beginShape();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * TWO_PI;
    const r = CYLINDER_RADIUS * 0.3 + 2 * Math.sin(a * 6 - t * 1.5);
    vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  endShape();

  // f(a) = f(b) label ring — dotted circle
  stroke(PALE_CYAN[0], PALE_CYAN[1], PALE_CYAN[2], 15);
  strokeWeight(0.5);
  for (let i = 0; i < 60; i++) {
    const a1 = (i / 60) * TWO_PI;
    const a2 = ((i + 0.4) / 60) * TWO_PI;
    const r = CYLINDER_RADIUS * 0.65;
    line(
      Math.cos(a1) * r, Math.sin(a1) * r, 0,
      Math.cos(a2) * r, Math.sin(a2) * r, 0
    );
  }

  pop();
}

/* ───────────────────── Vertical Axis ───────────────────── */
function drawAxis(t) {
  // Vertical axis representing the interval [a, b]
  const axisH = CURVE_HEIGHT * 1.2;
  stroke(PALE_MINT[0], PALE_MINT[1], PALE_MINT[2], 20);
  strokeWeight(0.6);
  line(0, -axisH, 0, 0, axisH, 0);

  // Endpoint markers (a and b)
  noStroke();
  for (let end = -1; end <= 1; end += 2) {
    push();
    translate(0, end * axisH, 0);
    emissiveMaterial(CYAN[0] * 0.15, CYAN[1] * 0.15, CYAN[2] * 0.15);
    ambientMaterial(CYAN[0] * 0.1, CYAN[1] * 0.1, CYAN[2] * 0.1);
    sphere(4, 8, 8);
    pop();
  }
}

/* ───────────────────── Rolle Curve Drawing ───────────────────── */
function drawRolleCurve(curve, t, theta, index) {
  const col = curve.color;
  const wave = Math.sin(t * curve.waveSpeed + curve.phaseOffset);
  const breathe = 1.0 + 0.05 * wave;

  // Animate the curve's angular position (slow rotation)
  const angleOffset = t * 0.06 * (index % 2 === 0 ? 1 : -1);

  // Draw the curve as a 3D ribbon on the cylinder surface
  noFill();
  const alpha = 140 + 60 * (0.5 + 0.5 * Math.sin(theta + index * 1.1));
  stroke(col[0], col[1], col[2], alpha);
  strokeWeight(curve.ribbonWidth * 0.5);

  beginShape();
  for (let j = 0; j <= CURVE_RESOLUTION; j++) {
    const p = curve.points[j];
    const curveAngle = curve.baseAngle + angleOffset + p.x * Math.PI * 0.8;
    const r = CYLINDER_RADIUS * (0.6 + 0.4 * p.x * (1 - p.x) * 4) * breathe;
    const px = Math.cos(curveAngle) * r;
    const pz = Math.sin(curveAngle) * r;
    const py = p.y * CURVE_HEIGHT * breathe;
    vertex(px, -py, pz);
  }
  endShape();

  // Second pass: thinner glow line
  stroke(col[0], col[1], col[2], alpha * 0.3);
  strokeWeight(curve.ribbonWidth * 1.2);
  beginShape();
  for (let j = 0; j <= CURVE_RESOLUTION; j++) {
    const p = curve.points[j];
    const curveAngle = curve.baseAngle + angleOffset + p.x * Math.PI * 0.8;
    const r = CYLINDER_RADIUS * (0.6 + 0.4 * p.x * (1 - p.x) * 4) * breathe;
    const px = Math.cos(curveAngle) * r;
    const pz = Math.sin(curveAngle) * r;
    const py = p.y * CURVE_HEIGHT * breathe;
    vertex(px, -py, pz);
  }
  endShape();

  // ── Critical points: glowing orbs where f'(c) = 0 ──
  for (const cp of curve.criticals) {
    const curveAngle = curve.baseAngle + angleOffset + cp.x * Math.PI * 0.8;
    const r = CYLINDER_RADIUS * (0.6 + 0.4 * cp.x * (1 - cp.x) * 4) * breathe;
    const cpx = Math.cos(curveAngle) * r;
    const cpz = Math.sin(curveAngle) * r;
    const cpy = -cp.y * CURVE_HEIGHT * breathe;

    const glowPulse = 0.5 + 0.5 * Math.sin(t * 3 + cp.x * 10 + curve.phaseOffset);

    // Glow layers
    push();
    translate(cpx, cpy, cpz);
    noStroke();

    // Outer glow
    emissiveMaterial(col[0] * 0.08 * glowPulse, col[1] * 0.08 * glowPulse, col[2] * 0.08 * glowPulse);
    ambientMaterial(0);
    sphere(18 + 6 * glowPulse, 8, 8);

    // Mid glow
    emissiveMaterial(col[0] * 0.2 * glowPulse, col[1] * 0.2 * glowPulse, col[2] * 0.2 * glowPulse);
    sphere(10 + 3 * glowPulse, 8, 8);

    // Core
    emissiveMaterial(col[0] * 0.6, col[1] * 0.6, col[2] * 0.6);
    ambientMaterial(col[0] * 0.3, col[1] * 0.3, col[2] * 0.3);
    sphere(4 + 1.5 * glowPulse, 10, 10);

    pop();

    // Horizontal tangent line at critical point (f'(c) = 0 visualization)
    const tangentLen = 30 + 15 * glowPulse;
    const tangentAlpha = 50 * glowPulse;
    stroke(col[0], col[1], col[2], tangentAlpha);
    strokeWeight(1.0);

    // Tangent lies in the horizontal plane at this height
    const tDir1x = -Math.sin(curveAngle);
    const tDir1z = Math.cos(curveAngle);
    line(
      cpx - tDir1x * tangentLen, cpy, cpz - tDir1z * tangentLen,
      cpx + tDir1x * tangentLen, cpy, cpz + tDir1z * tangentLen
    );

    // Small horizontal disc at critical point
    push();
    translate(cpx, cpy, cpz);
    rotateX(HALF_PI);
    noFill();
    stroke(col[0], col[1], col[2], 20 * glowPulse);
    strokeWeight(0.4);
    circle(0, 0, tangentLen * 1.5);
    pop();
  }

  // ── Endpoint markers (f(a) = f(b) = 0) ──
  for (let end = 0; end <= 1; end++) {
    const p = end === 0 ? curve.points[0] : curve.points[CURVE_RESOLUTION];
    const curveAngle = curve.baseAngle + angleOffset + p.x * Math.PI * 0.8;
    const r = CYLINDER_RADIUS * (0.6 + 0.4 * p.x * (1 - p.x) * 4) * breathe;
    const epx = Math.cos(curveAngle) * r;
    const epz = Math.sin(curveAngle) * r;
    const epy = -p.y * CURVE_HEIGHT * breathe;

    push();
    translate(epx, epy, epz);
    noStroke();
    emissiveMaterial(PALE_CYAN[0] * 0.2, PALE_CYAN[1] * 0.2, PALE_CYAN[2] * 0.2);
    ambientMaterial(PALE_CYAN[0] * 0.15, PALE_CYAN[1] * 0.15, PALE_CYAN[2] * 0.15);
    sphere(3, 6, 6);
    pop();
  }
}

/* ───────────────────── Critical Point Network ───────────────────── */
function drawCriticalNetwork(t, theta) {
  // Connect critical points across curves with faint lines
  const allCriticals = [];

  for (let i = 0; i < rolleCurves.length; i++) {
    const curve = rolleCurves[i];
    const angleOffset = t * 0.06 * (i % 2 === 0 ? 1 : -1);
    const breathe = 1.0 + 0.05 * Math.sin(t * curve.waveSpeed + curve.phaseOffset);

    for (const cp of curve.criticals) {
      const curveAngle = curve.baseAngle + angleOffset + cp.x * Math.PI * 0.8;
      const r = CYLINDER_RADIUS * (0.6 + 0.4 * cp.x * (1 - cp.x) * 4) * breathe;
      allCriticals.push({
        x: Math.cos(curveAngle) * r,
        y: -cp.y * CURVE_HEIGHT * breathe,
        z: Math.sin(curveAngle) * r,
        color: curve.color,
      });
    }
  }

  // Connect nearby critical points
  for (let i = 0; i < allCriticals.length; i++) {
    for (let j = i + 1; j < allCriticals.length; j++) {
      const a = allCriticals[i];
      const b = allCriticals[j];
      const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (d < 350) {
        const fade = 1 - d / 350;
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.5 + i * 0.7 + j * 0.3);
        const alpha = 12 * fade * pulse;

        stroke(PALE_MINT[0], PALE_MINT[1], PALE_MINT[2], alpha);
        strokeWeight(0.4);
        line(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
  }
}

/* ───────────────────── Particles ───────────────────── */
function drawParticles(t) {
  noStroke();
  for (const p of particles) {
    const angle = p.angle + t * p.speed;
    const y = p.y + 20 * Math.sin(t * p.ySpeed + p.angle * 3);
    const px = Math.cos(angle) * p.r;
    const pz = Math.sin(angle) * p.r;

    const col = CURVE_COLORS[p.colorIdx];
    const flicker = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.5 + p.angle * 5));

    push();
    translate(px, y, pz);
    emissiveMaterial(col[0] * 0.08 * flicker, col[1] * 0.08 * flicker, col[2] * 0.08 * flicker);
    ambientMaterial(0);
    sphere(p.size, 4, 4);
    pop();
  }
}

/* ───────────────────── Center Glow ───────────────────── */
function drawCenterGlow(t, theta) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.6);

  push();
  noStroke();
  emissiveMaterial(CYAN[0] * 0.03 * pulse, CYAN[1] * 0.03 * pulse, CYAN[2] * 0.03 * pulse);
  ambientMaterial(0);
  sphere(50, 16, 16);

  emissiveMaterial(MINT[0] * 0.06 * pulse, MINT[1] * 0.06 * pulse, MINT[2] * 0.06 * pulse);
  sphere(25, 12, 12);
  pop();

  // Rotating theorem ring
  push();
  rotateY(t * 0.2);
  rotateX(0.3);
  noFill();
  stroke(VIOLET[0], VIOLET[1], VIOLET[2], 18 * pulse);
  strokeWeight(0.8);
  const ringSegs = 80;
  beginShape();
  for (let i = 0; i <= ringSegs; i++) {
    const a = (i / ringSegs) * TWO_PI;
    const r = 60 + 8 * Math.sin(a * 5 + t);
    vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
  endShape();
  pop();
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

"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette ───────────────────── */
const BG_DEEP   = [13, 31, 45];
const BG_FOREST = [10, 61, 46];
const BG_SLATE  = [41, 48, 57];
const BG_MOSS   = [40, 54, 49];

const MINT      = [0, 255, 135];
const CYAN      = [0, 212, 255];
const VIOLET    = [123, 47, 255];
const MAGENTA   = [255, 45, 122];
const PALE_MINT = [176, 255, 232];
const PALE_CYAN = [196, 240, 255];

const CURVE_COLORS = [MINT, CYAN, VIOLET, MAGENTA, PALE_MINT, PALE_CYAN];

/* ───────────────────── Surface Config ───────────────────── */
const GRID_RES = 70;
const EXTENT = 3.0;
const SCALE = 120;
const HEIGHT_SCALE = 50;

/* ───────────────────── State ───────────────────── */
let muxer = null, encoder = null, isRecording = false, recordingFrameCount = 0;
let canvasEl = null, latestRecordingUrl = "";
let latestRecordingFilename = "complex_functions_20260318.mp4";
let fc = 0, captureCanvas = null, captureCtx = null;

let flowParticles = [];
let conformalLines = [];

/* ───────────────────── Recording Boilerplate ───────────────────── */
function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported."); return; }
  if (typeof Mp4Muxer === "undefined") { alert("mp4-muxer failed."); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory", firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); setStatus("Encoder error"); isRecording = false; },
  });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 16_000_000, framerate: FPS });
  fc = 0; recordingFrameCount = 0; isRecording = true;
  clearDownloadLink();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  updateDownloadButton(false); setStatus("Recording..."); updateRecordingUI();
}
async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus("Finalizing...");
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  setDownloadLink(url, latestRecordingFilename); updateDownloadButton(true);
  triggerDownload(url, latestRecordingFilename);
  encoder.close(); encoder = null; muxer = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true; setStatus("MP4 ready.");
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

/* ───────────────────── Complex Arithmetic ───────────────────── */
function cMul(ar, ai, br, bi) { return [ar * br - ai * bi, ar * bi + ai * br]; }
function cDiv(ar, ai, br, bi) {
  const d = br * br + bi * bi + 1e-12;
  return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}
function cAbs(r, i) { return Math.sqrt(r * r + i * i); }
function cArg(r, i) { return Math.atan2(i, r); }
function cExp(r, i) { const e = Math.exp(r); return [e * Math.cos(i), e * Math.sin(i)]; }
function cSin(r, i) {
  return [Math.sin(r) * Math.cosh(i), Math.cos(r) * Math.sinh(i)];
}
function cPow(ar, ai, n) {
  const r = cAbs(ar, ai);
  const th = cArg(ar, ai);
  const rn = Math.pow(r, n);
  return [rn * Math.cos(n * th), rn * Math.sin(n * th)];
}

/* ───────────────────── Complex Functions ───────────────────── */
// f0: (z³ - 1) / (z² + 1)
function f0(zr, zi) {
  const [nr, ni] = [zr * zr * zr - 3 * zr * zi * zi - 1, 3 * zr * zr * zi - zi * zi * zi];
  const [dr, di] = [zr * zr - zi * zi + 1, 2 * zr * zi];
  return cDiv(nr, ni, dr, di);
}

// f1: z⁴ - z  (4 fixed points, interesting spirals)
function f1(zr, zi) {
  const [p4r, p4i] = cPow(zr, zi, 4);
  return [p4r - zr, p4i - zi];
}

// f2: sin(z) / z  (sinc-like, essential singularity flavor)
function f2(zr, zi) {
  const [sr, si] = cSin(zr, zi);
  return cDiv(sr, si, zr, zi);
}

// f3: e^(1/z) (essential singularity at origin)
function f3(zr, zi) {
  const [invr, invi] = cDiv(1, 0, zr, zi);
  return cExp(invr, invi);
}

function evalFunc(zr, zi, blend) {
  // Cycle through 4 functions over the loop duration
  const cycle = blend * 4;
  const idx = Math.floor(cycle) % 4;
  const frac = cycle - Math.floor(cycle);
  const smooth = frac * frac * (3 - 2 * frac);

  const funcs = [f0, f1, f2, f3];
  const fa = funcs[idx];
  const fb = funcs[(idx + 1) % 4];

  const [ar, ai] = fa(zr, zi);
  const [br, bi] = fb(zr, zi);

  return [ar + (br - ar) * smooth, ai + (bi - ai) * smooth];
}

/* ───────────────────── Domain Coloring → RGB ───────────────────── */
function domainColor(wr, wi) {
  const mag = cAbs(wr, wi);
  const arg = cArg(wr, wi);
  // Map arg to palette: 6 colors evenly around the circle
  const t6 = ((arg / Math.PI + 1) * 0.5 * CURVE_COLORS.length) % CURVE_COLORS.length;
  const i0 = Math.floor(t6) % CURVE_COLORS.length;
  const i1 = (i0 + 1) % CURVE_COLORS.length;
  const frac = t6 - Math.floor(t6);
  const smooth = frac * frac * (3 - 2 * frac);
  const c0 = CURVE_COLORS[i0], c1 = CURVE_COLORS[i1];
  // Brightness modulated by log-magnitude with banding
  const logMag = Math.log(1 + mag);
  const band = 0.5 + 0.5 * Math.cos(logMag * 4);
  const bright = (0.5 + 0.5 * Math.min(logMag * 0.5, 1)) * (0.75 + 0.25 * band);
  return [
    (c0[0] + (c1[0] - c0[0]) * smooth) * bright,
    (c0[1] + (c1[1] - c0[1]) * smooth) * bright,
    (c0[2] + (c1[2] - c0[2]) * smooth) * bright,
  ];
}

/* ───────────────────── RNG ───────────────────── */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
}

/* ───────────────────── Blend BG color by time ───────────────────── */
function getBgColor(t) {
  const bgs = [BG_DEEP, BG_FOREST, BG_SLATE, BG_MOSS];
  const cycle = (t * 0.03) % bgs.length;
  const i0 = Math.floor(cycle) % bgs.length;
  const i1 = (i0 + 1) % bgs.length;
  const frac = cycle - Math.floor(cycle);
  const smooth = frac * frac * (3 - 2 * frac);
  return [
    bgs[i0][0] + (bgs[i1][0] - bgs[i0][0]) * smooth,
    bgs[i0][1] + (bgs[i1][1] - bgs[i0][1]) * smooth,
    bgs[i0][2] + (bgs[i1][2] - bgs[i0][2]) * smooth,
  ];
}

/* ───────────────────── Build Flow Particles ───────────────────── */
function buildFlowParticles() {
  const rng = makeRng(20260318);
  flowParticles = [];
  for (let i = 0; i < 200; i++) {
    flowParticles.push({
      zr: (rng() - 0.5) * EXTENT * 2,
      zi: (rng() - 0.5) * EXTENT * 2,
      life: rng(),
      speed: 0.3 + rng() * 0.7,
      size: 1 + rng() * 2.5,
      trail: [],
      maxTrail: 15 + Math.floor(rng() * 25),
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

  buildFlowParticles();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS;
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const blend = loopT;

  const bg = getBgColor(t);
  background(bg[0], bg[1], bg[2]);

  // Camera — orbit above the surface
  const camAngle = t * 0.06;
  const camR = 520 + 60 * Math.sin(t * 0.03);
  const camY = -280 - 80 * Math.sin(t * 0.05);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, -20, 0,
    0, 1, 0
  );

  // Lighting — colored to complement the palette
  ambientLight(15, 25, 22);
  pointLight(CYAN[0] * 0.35, CYAN[1] * 0.35, CYAN[2] * 0.35, 0, -500, 0);
  pointLight(VIOLET[0] * 0.25, VIOLET[1] * 0.25, VIOLET[2] * 0.25, 300, -200, -300);
  pointLight(MAGENTA[0] * 0.2, MAGENTA[1] * 0.2, MAGENTA[2] * 0.2, -300, -100, 300);

  drawModularSurface(blend, t);
  drawConformalGrid(blend, t);
  drawPoleMarkers(blend, t);
  drawZeroMarkers(blend, t);
  drawFlowField(blend, t);
  drawUnitCircle(t);
  drawAxes(t);

  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

/* ───────────────────── Modular Surface |f(z)| ───────────────────── */
function drawModularSurface(blend, t) {
  const res = GRID_RES;
  const breathe = 0.85 + 0.15 * Math.sin(t * 0.2);

  push();
  noFill();
  strokeWeight(0.8);

  // Draw rows (constant imaginary part)
  for (let vi = 0; vi <= res; vi += 2) {
    const zi = ((vi / res) - 0.5) * EXTENT * 2;

    beginShape();
    for (let ui = 0; ui <= res; ui++) {
      const zr = ((ui / res) - 0.5) * EXTENT * 2;
      const [wr, wi] = evalFunc(zr, zi, blend);
      const mag = cAbs(wr, wi);
      const h = -Math.log(1 + mag) * HEIGHT_SCALE * breathe;
      const clampH = Math.max(h, -350);
      const col = domainColor(wr, wi);

      stroke(col[0], col[1], col[2], 140 + 60 * breathe);
      vertex(zr * SCALE, clampH, zi * SCALE);
    }
    endShape();
  }

  // Draw columns (constant real part)
  for (let ui = 0; ui <= res; ui += 2) {
    const zr = ((ui / res) - 0.5) * EXTENT * 2;

    beginShape();
    for (let vi = 0; vi <= res; vi++) {
      const zi = ((vi / res) - 0.5) * EXTENT * 2;
      const [wr, wi] = evalFunc(zr, zi, blend);
      const mag = cAbs(wr, wi);
      const h = -Math.log(1 + mag) * HEIGHT_SCALE * breathe;
      const clampH = Math.max(h, -350);
      const col = domainColor(wr, wi);

      stroke(col[0], col[1], col[2], 120 + 50 * breathe);
      vertex(zr * SCALE, clampH, zi * SCALE);
    }
    endShape();
  }

  // Bright peak highlights (high magnitude regions glow)
  strokeWeight(3.5);
  for (let vi = 0; vi <= res; vi += 3) {
    const zi = ((vi / res) - 0.5) * EXTENT * 2;
    beginShape();
    for (let ui = 0; ui <= res; ui += 3) {
      const zr = ((ui / res) - 0.5) * EXTENT * 2;
      const [wr, wi] = evalFunc(zr, zi, blend);
      const mag = cAbs(wr, wi);
      if (mag > 4) {
        const h = -Math.log(1 + mag) * HEIGHT_SCALE * breathe;
        const clampH = Math.max(h, -350);
        const col = domainColor(wr, wi);
        stroke(col[0], col[1], col[2], 35);
        vertex(zr * SCALE, clampH, zi * SCALE);
      }
    }
    endShape();
  }

  pop();
}

/* ───────────────────── Conformal Grid ───────────────────── */
function drawConformalGrid(blend, t) {
  const res = 60;
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.35);

  push();
  noFill();
  strokeWeight(1.0);

  // Map horizontal lines through f(z) onto the base plane
  for (let k = -8; k <= 8; k += 2) {
    const imag = k * 0.35;
    stroke(CYAN[0], CYAN[1], CYAN[2], 50 + 40 * pulse);
    beginShape();
    for (let i = 0; i <= res; i++) {
      const real = ((i / res) - 0.5) * EXTENT * 2;
      const [wr, wi] = evalFunc(real, imag, blend);
      // Map output to world XZ with clamping
      const ox = Math.max(-500, Math.min(500, wr * SCALE * 0.5));
      const oz = Math.max(-500, Math.min(500, wi * SCALE * 0.5));
      vertex(ox, 2, oz);
    }
    endShape();
  }

  // Map vertical lines
  for (let k = -8; k <= 8; k += 2) {
    const real = k * 0.35;
    stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 50 + 40 * pulse);
    beginShape();
    for (let i = 0; i <= res; i++) {
      const imag = ((i / res) - 0.5) * EXTENT * 2;
      const [wr, wi] = evalFunc(real, imag, blend);
      const ox = Math.max(-500, Math.min(500, wr * SCALE * 0.5));
      const oz = Math.max(-500, Math.min(500, wi * SCALE * 0.5));
      vertex(ox, 2, oz);
    }
    endShape();
  }

  pop();
}

/* ───────────────────── Pole Markers ───────────────────── */
function drawPoleMarkers(blend, t) {
  // Poles of f0: z²+1=0 → z = ±i
  const poles0 = [[0, 1], [0, -1]];
  // Poles of f3: essential singularity at 0
  const poles3 = [[0, 0]];
  // Interpolate visibility based on which function is active
  const cycle = (blend * 4) % 4;

  const allPoles = [...poles0, ...poles3];
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.0);

  for (const [pr, pi] of allPoles) {
    const wx = pr * SCALE;
    const wz = pi * SCALE;

    // Vortex tower
    push();
    noFill();
    const spiralSegs = 80;
    const towerH = 250 + 50 * pulse;

    // Spiral
    stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 60 + 40 * pulse);
    strokeWeight(1.0);
    beginShape();
    for (let j = 0; j <= spiralSegs; j++) {
      const frac = j / spiralSegs;
      const angle = frac * TWO_PI * 5 + t * 2.5;
      const r = 3 + frac * 30;
      vertex(wx + Math.cos(angle) * r, -frac * towerH, wz + Math.sin(angle) * r);
    }
    endShape();

    // Glow spiral
    stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 30 + 20 * pulse);
    strokeWeight(5);
    beginShape();
    for (let j = 0; j <= spiralSegs; j += 2) {
      const frac = j / spiralSegs;
      const angle = frac * TWO_PI * 5 + t * 2.5;
      const r = 3 + frac * 30;
      vertex(wx + Math.cos(angle) * r, -frac * towerH, wz + Math.sin(angle) * r);
    }
    endShape();

    // Vertical spine
    stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 80 + 50 * pulse);
    strokeWeight(1.2);
    line(wx, 0, wz, wx, -towerH, wz);

    // × marker
    stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], 150);
    strokeWeight(2.5);
    const cs = 10;
    line(wx - cs, -1, wz - cs, wx + cs, -1, wz + cs);
    line(wx - cs, -1, wz + cs, wx + cs, -1, wz - cs);

    // Base orb
    translate(wx, -3, wz);
    noStroke();
    emissiveMaterial(MAGENTA[0] * 0.25 * pulse, MAGENTA[1] * 0.25 * pulse, MAGENTA[2] * 0.25 * pulse);
    sphere(18 + 8 * pulse, 10, 10);
    emissiveMaterial(MAGENTA[0] * 0.5, MAGENTA[1] * 0.5, MAGENTA[2] * 0.5);
    sphere(6, 8, 8);

    // Peak orb
    translate(0, -towerH + 3, 0);
    emissiveMaterial(MAGENTA[0] * 0.35 * pulse, MAGENTA[1] * 0.35 * pulse, MAGENTA[2] * 0.35 * pulse);
    sphere(8 + 4 * pulse, 8, 8);

    pop();
  }
}

/* ───────────────────── Zero Markers ───────────────────── */
function drawZeroMarkers(blend, t) {
  // Zeros of f0: z³=1 → cube roots of unity
  const zeros = [
    [1, 0],
    [-0.5, Math.sqrt(3) / 2],
    [-0.5, -Math.sqrt(3) / 2],
  ];
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.5);

  for (const [zr, zi] of zeros) {
    const wx = zr * SCALE;
    const wz = zi * SCALE;

    push();
    translate(wx, -1, wz);

    // ○ marker
    rotateX(HALF_PI);
    noFill();
    stroke(PALE_CYAN[0], PALE_CYAN[1], PALE_CYAN[2], 90 + 50 * pulse);
    strokeWeight(2.0);
    circle(0, 0, 22);
    stroke(MINT[0], MINT[1], MINT[2], 80 + 60 * pulse);
    strokeWeight(1.2);
    circle(0, 0, 14);

    // Collapsing rings
    for (let r = 0; r < 4; r++) {
      const ringR = 25 + r * 15 - (t * 10) % 15;
      if (ringR > 6) {
        const alpha = 35 * (1 - r / 4) * pulse;
        stroke(PALE_MINT[0], PALE_MINT[1], PALE_MINT[2], alpha);
        strokeWeight(0.6);
        circle(0, 0, ringR * 2);
      }
    }
    pop();

    // Depression glow
    push();
    translate(wx, 4, wz);
    noStroke();
    emissiveMaterial(CYAN[0] * 0.12 * pulse, CYAN[1] * 0.12 * pulse, CYAN[2] * 0.12 * pulse);
    sphere(12, 6, 6);
    pop();
  }
}

/* ───────────────────── Flow Field Particles ───────────────────── */
function drawFlowField(blend, t) {
  const dt = 0.015;
  const bound = EXTENT;
  const rng = makeRng(fc * 7 + 31);

  noStroke();

  for (const p of flowParticles) {
    // Evaluate function at particle position for flow direction
    const [wr, wi] = evalFunc(p.zr, p.zi, blend);
    const mag = cAbs(wr, wi);
    const invMag = 1 / (1 + mag);

    // Flow along the conjugate of f(z) — creates streamlines
    p.zr += wr * dt * p.speed * invMag;
    p.zi += wi * dt * p.speed * invMag;

    // Reset if out of bounds
    if (Math.abs(p.zr) > bound * 1.2 || Math.abs(p.zi) > bound * 1.2 || isNaN(p.zr)) {
      p.zr = (rng() - 0.5) * bound * 2;
      p.zi = (rng() - 0.5) * bound * 2;
      p.trail = [];
    }

    // Trail
    p.trail.push({ x: p.zr * SCALE, z: p.zi * SCALE });
    if (p.trail.length > p.maxTrail) p.trail.shift();

    // Draw trail
    if (p.trail.length > 2) {
      const col = domainColor(wr, wi);
      push();
      noFill();
      stroke(col[0], col[1], col[2], 100);
      strokeWeight(1.2);
      beginShape();
      for (const pt of p.trail) {
        vertex(pt.x, -8, pt.z);
      }
      endShape();

      // Glow trail
      stroke(col[0], col[1], col[2], 30);
      strokeWeight(4);
      beginShape();
      for (let i = Math.max(0, p.trail.length - 8); i < p.trail.length; i++) {
        vertex(p.trail[i].x, -8, p.trail[i].z);
      }
      endShape();
      pop();
    }

    // Head particle
    const col = domainColor(wr, wi);
    const flicker = 0.5 + 0.5 * Math.sin(t * 3 + p.zr * 2 + p.zi * 2);
    push();
    translate(p.zr * SCALE, -10, p.zi * SCALE);
    emissiveMaterial(col[0] * 0.25 * flicker, col[1] * 0.25 * flicker, col[2] * 0.25 * flicker);
    sphere(p.size, 5, 5);
    pop();
  }
}

/* ───────────────────── Unit Circle ───────────────────── */
function drawUnitCircle(t) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 0.4);
  const segs = 100;

  push();
  noFill();

  // Main circle
  stroke(VIOLET[0], VIOLET[1], VIOLET[2], 70 + 40 * pulse);
  strokeWeight(1.5);
  beginShape();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TWO_PI;
    vertex(Math.cos(a) * SCALE, -1, Math.sin(a) * SCALE);
  }
  endShape();

  // Glow
  stroke(VIOLET[0], VIOLET[1], VIOLET[2], 20 + 15 * pulse);
  strokeWeight(5);
  beginShape();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TWO_PI;
    vertex(Math.cos(a) * SCALE, -1, Math.sin(a) * SCALE);
  }
  endShape();

  // Tick marks on circle at special angles
  stroke(PALE_CYAN[0], PALE_CYAN[1], PALE_CYAN[2], 60 + 30 * pulse);
  strokeWeight(1.8);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TWO_PI;
    const r1 = SCALE * 0.92;
    const r2 = SCALE * 1.08;
    line(Math.cos(a) * r1, -1, Math.sin(a) * r1, Math.cos(a) * r2, -1, Math.sin(a) * r2);
  }

  pop();
}

/* ───────────────────── Axes ───────────────────── */
function drawAxes(t) {
  const pulse = 0.6 + 0.4 * Math.sin(t * 0.3);
  const len = EXTENT * SCALE * 1.2;

  push();

  // Real axis (σ)
  stroke(MINT[0], MINT[1], MINT[2], 70 + 40 * pulse);
  strokeWeight(1.4);
  line(-len, 0, 0, len, 0, 0);
  stroke(MINT[0], MINT[1], MINT[2], 18 + 12 * pulse);
  strokeWeight(5);
  line(-len, 0, 0, len, 0, 0);

  // Imaginary axis (jω)
  stroke(CYAN[0], CYAN[1], CYAN[2], 70 + 40 * pulse);
  strokeWeight(1.4);
  line(0, 0, -len, 0, 0, len);
  stroke(CYAN[0], CYAN[1], CYAN[2], 18 + 12 * pulse);
  strokeWeight(5);
  line(0, 0, -len, 0, 0, len);

  // Vertical axis (|f(z)|)
  stroke(VIOLET[0], VIOLET[1], VIOLET[2], 50 + 30 * pulse);
  strokeWeight(1.0);
  line(0, 0, 0, 0, -400, 0);
  stroke(VIOLET[0], VIOLET[1], VIOLET[2], 12 + 8 * pulse);
  strokeWeight(4);
  line(0, 0, 0, 0, -400, 0);

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

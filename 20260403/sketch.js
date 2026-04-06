"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const BG = [0, 0, 0];

const DUST_COUNT = 900;
const ORBITER_COUNT = 220;
const RING_COUNT = 16;
const RING_STEPS = 180;
const GRID_COUNT = 9;
const GRID_STEPS = 96;
const CURVE_COUNT = 4;
const CURVE_STEPS = 240;
const CAMERA_BASE_RADIUS = 980;
const CAMERA_RADIUS_SWAY = 160;
const CAMERA_VERTICAL_SWAY = 110;

const DOMAIN_SPAN = 2.15;
const DUST_RADIAL_GAIN = 185;
const SHELL_RADIAL_GAIN = 255;
const LATTICE_RADIAL_GAIN = 350;
const CURVE_RADIAL_GAIN = 320;
const ORBITER_RADIAL_GAIN = 390;
const HALO_RADIUS = 210;

let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "complex_signal_20260403.mp4";
let fc = 0;
let captureCanvas = null;
let captureCtx = null;

let dustSeeds = [];
let orbiterSeeds = [];
let vignetteGfx = null;

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
  const d = document.getElementById("duration");
  const f = document.getElementById("frameCount");
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

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lerpValue(a, b, t) {
  return a + (b - a) * t;
}

function cAdd(a, b) {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cMul(a, b) {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

function cScale(z, s) {
  return { re: z.re * s, im: z.im * s };
}

function cAbs(z) {
  return Math.hypot(z.re, z.im);
}

function cArg(z) {
  return Math.atan2(z.im, z.re);
}

function cFromPolar(r, angle) {
  return { re: r * Math.cos(angle), im: r * Math.sin(angle) };
}

function cReciprocal(z) {
  const d = z.re * z.re + z.im * z.im + 1e-9;
  return { re: z.re / d, im: -z.im / d };
}

function cPow2(z) {
  return {
    re: z.re * z.re - z.im * z.im,
    im: 2 * z.re * z.im,
  };
}

function glowStroke(alpha, weight) {
  return [
    { a: alpha * 0.18, w: weight * 5.5 },
    { a: alpha * 0.45, w: weight * 2.6 },
    { a: alpha, w: weight },
  ];
}

function drawLuminousPoint(x, y, z, value, alpha, weight) {
  stroke(value, value, value, alpha * 0.18);
  strokeWeight(weight * 2.6);
  point(x, y, z);
  stroke(value, value, value, alpha);
  strokeWeight(weight);
  point(x, y, z);
}

function buildDust() {
  const rng = makeRng(20260403);
  dustSeeds = [];
  for (let i = 0; i < DUST_COUNT; i++) {
    const angle = rng() * TWO_PI;
    const radius = 0.18 + Math.pow(rng(), 0.72) * 1.95;
    dustSeeds.push({
      re: Math.cos(angle) * radius,
      im: Math.sin(angle) * radius,
      phaseA: rng() * TWO_PI,
      phaseB: rng() * TWO_PI,
      depth: Math.pow(rng(), 1.35),
      lift: -460 + rng() * 920,
      gain: rng() * 80,
      weight: 0.6 + rng() * 1.7,
      value: 120 + rng() * 135,
      alpha: 20 + rng() * 45,
    });
  }
}

function buildOrbiters() {
  const rng = makeRng(20260403);
  orbiterSeeds = [];
  for (let i = 0; i < ORBITER_COUNT; i++) {
    orbiterSeeds.push({
      phase: rng() * TWO_PI,
      speed: 0.12 + rng() * 0.35,
      radius: 0.36 + rng() * 1.45,
      turn: -0.45 + rng() * 0.9,
      bias: cFromPolar(0.08 + rng() * 0.22, rng() * TWO_PI),
      offset: cFromPolar(0.26 + rng() * 0.22, rng() * TWO_PI),
      lift: -260 + rng() * 520,
      gain: rng() * 90,
      twinkle: rng() * TWO_PI,
      weight: 0.9 + rng() * 2.3,
      value: 180 + rng() * 75,
    });
  }
}

function buildVignette() {
  vignetteGfx = createGraphics(W, H);
  vignetteGfx.clear();
  vignetteGfx.noStroke();
  const cx = W * 0.5;
  const cy = H * 0.5;
  const maxR = Math.hypot(cx, cy);
  const steps = 96;
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const fade = Math.pow(1 - t, 0.38);
    vignetteGfx.fill(0, fade * 85);
    vignetteGfx.ellipse(cx, cy, maxR * 2 * t, maxR * 2 * t);
  }
}

// Mix rotation, reciprocal warping, and harmonic phase forcing into one shared field.
function signalField(z, t) {
  const zr = cMul(z, cFromPolar(1, 0.19 * t));
  const inv = cReciprocal(cAdd(zr, cFromPolar(0.42, -0.31 * t)));
  const quad = cMul(cPow2(zr), cFromPolar(0.18, 0.47 * t));
  const harmonic = cFromPolar(
    0.28 + 0.06 * Math.sin(0.9 * t + 3.0 * cArg(zr)),
    3.0 * cArg(zr) - 0.52 * t
  );
  return cAdd(cAdd(cScale(zr, 0.88), cScale(inv, 0.74)), cAdd(quad, harmonic));
}

// Magnitude lifts the structure while phase steers the azimuthal sweep in 3D.
function complexToWorld(z, w, t, radialGain, lift) {
  const mag = cAbs(w);
  const phase = cArg(w);
  const swirl = radialGain * (0.52 + 0.24 * mag);
  return {
    x: swirl * Math.cos(phase) + 90 * z.re,
    y: lift + 95 * Math.sin(2.0 * phase - 0.35 * t) + 82 * (mag - 1.0),
    z: swirl * Math.sin(phase) + 90 * z.im,
    mag,
    phase,
  };
}

function drawDeepField(t) {
  push();
  noFill();
  for (let i = 0; i < dustSeeds.length; i++) {
    const d = dustSeeds[i];
    const drift = d.phaseA + t * (0.05 + d.depth * 0.05);
    const z = {
      re: d.re + 0.09 * Math.cos(drift) + 0.04 * Math.sin(d.phaseB + 0.07 * t),
      im: d.im + 0.09 * Math.sin(drift * 1.1) + 0.04 * Math.cos(d.phaseB - 0.05 * t),
    };
    const w = signalField(z, t);
    const pos = complexToWorld(z, w, t, DUST_RADIAL_GAIN + d.gain, d.lift);
    const depthScale = 1.15 + d.depth * 0.95;
    const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(0.45 * t + d.phaseB));
    drawLuminousPoint(
      pos.x * depthScale,
      pos.y * 0.75 + (d.depth - 0.5) * 120,
      pos.z * depthScale - 320 - d.depth * 280,
      d.value,
      d.alpha * pulse,
      d.weight
    );
  }
  pop();
}

function drawWarpedShells(t) {
  push();
  noFill();
  for (let ring = 0; ring < RING_COUNT; ring++) {
    const ringT = ring / (RING_COUNT - 1);
    const sourceRadius = 0.26 + ringT * 1.46;
    const lift = -360 + ringT * 720;
    const radialGain = SHELL_RADIAL_GAIN + ringT * 110;
    const alpha = 26 + 54 * (1 - Math.abs(0.5 - ringT) * 1.35);
    const weight = 0.65 + 0.7 * (1 - ringT * 0.45);
    const phaseBias = ringT * 0.55 + 0.08 * Math.sin(0.14 * t + ringT * 6.0);
    const layers = glowStroke(alpha, weight);
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      stroke(255, 255, 255, layer.a);
      strokeWeight(layer.w);
      beginShape();
      for (let i = 0; i < RING_STEPS; i++) {
        const u = i / RING_STEPS;
        const angle = TWO_PI * u + phaseBias;
        const ripple = 1 + 0.07 * Math.sin(6 * angle - 0.35 * t + ring * 0.4);
        const z = cFromPolar(sourceRadius * ripple, angle);
        const w = signalField(z, t);
        const pos = complexToWorld(z, w, t, radialGain, lift);
        vertex(pos.x, pos.y, pos.z);
      }
      endShape(CLOSE);
    }
  }
  pop();
}

function drawSignalLattice(t) {
  push();
  noFill();
  for (let lineIndex = 0; lineIndex < GRID_COUNT; lineIndex++) {
    const offsetT = lineIndex / (GRID_COUNT - 1);
    const offset = lerpValue(-1.5, 1.5, offsetT);
    const emphasis = 1 - Math.min(1, Math.abs(offset) / 1.5);
    const alpha = 18 + 46 * emphasis;
    const weight = 0.3 + 0.65 * emphasis;
    const layers = glowStroke(alpha, weight);
    for (let axis = 0; axis < 2; axis++) {
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        stroke(255, 255, 255, layer.a);
        strokeWeight(layer.w);
        beginShape();
        for (let i = 0; i <= GRID_STEPS; i++) {
          const u = i / GRID_STEPS;
          const sweep = lerpValue(-DOMAIN_SPAN, DOMAIN_SPAN, u);
          const z = axis === 0
            ? { re: sweep, im: offset + 0.05 * Math.sin(0.1 * t + sweep * 1.8) }
            : { re: offset + 0.05 * Math.cos(0.1 * t + sweep * 1.6), im: sweep };
          const w = signalField(z, t);
          const pos = complexToWorld(z, w, t, LATTICE_RADIAL_GAIN, offset * 120);
          vertex(pos.x, pos.y, pos.z);
        }
        endShape();
      }
    }
  }
  pop();
}

function drawPhaseCurves(t) {
  push();
  noFill();
  for (let curve = 0; curve < CURVE_COUNT; curve++) {
    const phaseOff = curve * TWO_PI / CURVE_COUNT;
    const alpha = 76 - curve * 8;
    const weight = 1.35 - curve * 0.14;
    const lift = -180 + curve * 120;
    const radialGain = CURVE_RADIAL_GAIN + curve * 12;
    const layers = glowStroke(alpha, weight);
    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];
      stroke(255, 255, 255, layer.a);
      strokeWeight(layer.w);
      beginShape();
      for (let i = 0; i <= CURVE_STEPS; i++) {
        const u = i / CURVE_STEPS;
        const a = 8.5 * PI * u + phaseOff;
        const r = 0.18 + 1.55 * u + 0.05 * Math.sin(10 * u - 0.6 * t);
        const z = cFromPolar(r, a);
        const w = signalField(z, t);
        const pos = complexToWorld(z, w, t, radialGain, lift);
        vertex(pos.x, pos.y, pos.z);
      }
      endShape();
    }
  }
  pop();
}

function drawOrbiters(t) {
  push();
  noFill();
  for (let i = 0; i < orbiterSeeds.length; i++) {
    const o = orbiterSeeds[i];
    const theta = t * o.speed + o.phase;
    let z = cAdd(
      cFromPolar(o.radius + 0.14 * Math.sin(theta * 1.7), theta),
      o.bias
    );
    // Three reciprocal refinements fold each seed back into the shared field.
    for (let j = 0; j < 3; j++) {
      const rotated = cMul(z, cFromPolar(1, o.turn + 0.21 * j + 0.09 * t));
      z = cAdd(cReciprocal(cAdd(rotated, o.offset)), o.bias);
    }
    const w = signalField(z, t);
    const pos = complexToWorld(z, w, t, ORBITER_RADIAL_GAIN + o.gain, o.lift);
    const shimmer = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(theta * 2.1 + o.twinkle));
    drawLuminousPoint(pos.x, pos.y, pos.z, o.value, 90 + 120 * shimmer, o.weight);
  }
  pop();
}

function drawHaloRing(radius, alpha, weight, t, ripplePhase) {
  const layers = glowStroke(alpha, weight);
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    stroke(255, 255, 255, layer.a);
    strokeWeight(layer.w);
    beginShape();
    for (let i = 0; i <= RING_STEPS; i++) {
      const a = TWO_PI * (i / RING_STEPS);
      const r = radius * (1 + 0.02 * Math.sin(6 * a - 0.4 * t + ripplePhase));
      vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    endShape(CLOSE);
  }
}

function drawCoreHalo(t) {
  push();
  noFill();

  push();
  rotateZ(0.12 * t);
  drawHaloRing(HALO_RADIUS + 18 * Math.sin(0.18 * t), 92, 1.25, t, 0);
  pop();

  push();
  rotateX(HALF_PI + 0.14 * t);
  rotateZ(0.2 * t + 0.6);
  drawHaloRing((HALO_RADIUS - 8) + 16 * Math.sin(0.18 * t + 0.9), 74, 1.05, t, 1.6);
  pop();

  push();
  rotateY(HALF_PI + 0.1 * t);
  rotateZ(-0.18 * t + 1.2);
  drawHaloRing((HALO_RADIUS + 12) + 14 * Math.sin(0.18 * t + 1.7), 62, 0.95, t, 3.1);
  pop();

  noStroke();
  const pulse = 1 + 0.04 * Math.sin(0.7 * t);
  const shellRadii = [104, 68, 34, 12];
  const shellValues = [26, 72, 150, 255];
  for (let i = 0; i < shellRadii.length; i++) {
    push();
    rotateY(0.22 * t + i * 0.7);
    rotateX(-0.18 * t + i * 0.45);
    if (i < shellRadii.length - 1) {
      ambientMaterial(shellValues[i], shellValues[i], shellValues[i]);
    } else {
      emissiveMaterial(shellValues[i], shellValues[i], shellValues[i]);
    }
    sphere(shellRadii[i] * pulse, Math.max(8, 18 - i * 3), Math.max(6, 14 - i * 2));
    pop();
  }

  pop();
}

function drawVignetteOverlay() {
  push();
  resetMatrix();
  ortho();
  noLights();
  noStroke();
  texture(vignetteGfx);
  plane(W, H);
  pop();
}

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

  buildDust();
  buildOrbiters();
  buildVignette();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function draw() {
  const t = fc / FPS;
  background(BG[0], BG[1], BG[2]);

  const yaw = t * 0.03 + 0.22 * Math.sin(0.11 * t);
  const camR = CAMERA_BASE_RADIUS + CAMERA_RADIUS_SWAY * Math.sin(0.07 * t);
  const camY = -160 + CAMERA_VERTICAL_SWAY * Math.sin(0.09 * t);
  const lookY = -20 + 40 * Math.sin(0.05 * t);
  camera(
    camR * Math.cos(yaw), camY, camR * Math.sin(yaw),
    0, lookY, 0,
    0, 1, 0
  );

  ambientLight(20, 20, 20);
  directionalLight(220, 220, 220, -0.3, 0.85, -0.6);
  directionalLight(90, 90, 90, 0.5, -0.2, 0.7);
  pointLight(255, 255, 255, 0, -260, 260);
  pointLight(90, 90, 90, -320, 240, -360);

  drawDeepField(t);
  drawWarpedShells(t);
  drawSignalLattice(t);
  drawPhaseCurves(t);
  drawOrbiters(t);
  drawCoreHalo(t);
  drawVignetteOverlay();

  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  return true;
}

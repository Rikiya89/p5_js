"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette ───────────────────── */
const BG_DEEP   = [13, 31, 45];
const MINT      = [0, 255, 135];
const CYAN      = [0, 212, 255];
const VIOLET    = [123, 47, 255];
const MAGENTA   = [255, 45, 122];
const PALE_MINT = [176, 255, 232];
const PALE_CYAN = [196, 240, 255];

const ACCENT_COLORS = [MINT, CYAN, VIOLET, MAGENTA, PALE_MINT, PALE_CYAN];

/* ───────────────────── Mandala Config ───────────────────── */
const RING_COUNT     = 14;     // concentric rings
const POINTS_PER_RING_BASE = 120;
const SYMMETRY       = 8;     // N-fold radial symmetry
const SHAPE_TYPES    = 5;     // circle, polygon, star, flower, wave-ring
const MORPH_SPEED    = 0.15;  // shape morph rate
const Z_WAVE_AMP     = 120;   // depth undulation
const CAMERA_DIST    = 700;   // orbit radius

/* ───────────────────── State ───────────────────── */
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "3d_mandala_cloud_20260316.mp4";

let fc = 0;
let particles = [];
let rings = [];

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

/* ───────────────────── Seeded RNG ───────────────────── */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ───────────────────── Build Point Cloud ───────────────────── */
function buildCloud() {
  particles = [];
  rings = [];
  const rng = makeRng(20260316);

  for (let r = 0; r < RING_COUNT; r++) {
    const t = r / (RING_COUNT - 1);                // 0..1
    const baseRadius = 60 + t * 380;               // inner to outer radius
    const pointCount = Math.floor(POINTS_PER_RING_BASE * (0.5 + t * 1.0));
    const colorIdx = r % ACCENT_COLORS.length;

    // Each ring has its own morph: oscillates between two shape types
    const shapeFrom = Math.floor(rng() * SHAPE_TYPES);
    const shapeTo   = (shapeFrom + 1 + Math.floor(rng() * (SHAPE_TYPES - 1))) % SHAPE_TYPES;
    const petalCount = 3 + Math.floor(rng() * 8);
    const morphOffset = rng() * Math.PI * 2;
    const rotSpeed   = (rng() - 0.5) * 0.4;        // per-ring rotation speed
    const zPhase     = rng() * Math.PI * 2;
    const zFreq      = 1 + Math.floor(rng() * 3);

    rings.push({
      baseRadius,
      pointCount,
      colorIdx,
      shapeFrom,
      shapeTo,
      petalCount,
      morphOffset,
      rotSpeed,
      zPhase,
      zFreq,
      ringT: t,
    });

    // Generate points evenly around the ring
    for (let i = 0; i < pointCount; i++) {
      const angle = (i / pointCount) * Math.PI * 2;
      // Small jitter for organic feel
      const jitterR = (rng() - 0.5) * 12;
      const jitterZ = (rng() - 0.5) * 20;
      const sizeBase = 1.5 + rng() * 3.0;

      particles.push({
        ringIndex: r,
        baseAngle: angle,
        jitterR,
        jitterZ,
        sizeBase,
        twinklePhase: rng() * Math.PI * 2,
      });
    }
  }
}

/* ───────────────────── Shape Radius Functions ───────────────────── */
function mandalaRadius(shapeType, angle, baseR, petals, sym) {
  switch (shapeType) {
    case 0: // Circle
      return baseR;
    case 1: // Polygon
      return baseR * polyRadius(angle, sym);
    case 2: // Star
      return baseR * (0.5 + 0.5 * Math.abs(Math.cos(angle * sym * 0.5)));
    case 3: // Flower
      return baseR * (0.4 + 0.6 * Math.abs(Math.sin(angle * petals * 0.5)));
    case 4: // Wave ring
      return baseR * (0.7 + 0.3 * Math.sin(angle * petals + angle * sym * 0.3));
    default:
      return baseR;
  }
}

function polyRadius(angle, sides) {
  const ha = Math.PI / sides;
  const sector = ((angle % (Math.PI * 2 / sides)) + (Math.PI * 2 / sides)) % (Math.PI * 2 / sides);
  const off = Math.abs(sector - ha);
  return Math.cos(ha) / Math.cos(off);
}

/* ───────────────────── p5 Setup ───────────────────── */
function setup() {
  pixelDensity(1);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);

  buildCloud();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}


/* ───────────────────── Draw ───────────────────── */
function draw() {
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const theta = loopT * TWO_PI;
  const timeSec = fc / FPS;

  // Deep dark background
  background(BG_DEEP[0], BG_DEEP[1], BG_DEEP[2]);

  // Camera orbits slowly
  const camAngleH = timeSec * 0.12;               // horizontal orbit
  const camAngleV = 0.3 + 0.25 * sin(theta * 0.5); // gentle vertical bob
  const camX = CAMERA_DIST * cos(camAngleH) * cos(camAngleV);
  const camY = CAMERA_DIST * sin(camAngleV) * 0.6;
  const camZ = CAMERA_DIST * sin(camAngleH) * cos(camAngleV);
  camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);

  // Subtle ambient + directional light for depth cues
  ambientLight(30, 40, 50);
  pointLight(MINT[0], MINT[1], MINT[2], 200, -300, 200);
  pointLight(VIOLET[0], VIOLET[1], VIOLET[2], -200, 200, -200);

  // Global slow rotation of the entire mandala structure
  const globalRot = timeSec * 0.05;
  rotateY(globalRot);

  // Draw particles
  noFill();
  strokeCap(ROUND);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const ring = rings[p.ringIndex];

    // Morph factor for this ring
    const morphT = 0.5 + 0.5 * sin(timeSec * MORPH_SPEED + ring.morphOffset);

    // Per-ring rotation
    const ringRot = timeSec * ring.rotSpeed;
    const angle = p.baseAngle + ringRot;

    // Compute morphed radius
    const rA = mandalaRadius(ring.shapeFrom, angle, ring.baseRadius, ring.petalCount, SYMMETRY);
    const rB = mandalaRadius(ring.shapeTo, angle, ring.baseRadius, ring.petalCount, SYMMETRY);
    const r = lerp(rA, rB, morphT) + p.jitterR;

    // 3D position
    const px = cos(angle) * r;
    const py = sin(angle) * r;
    // Z undulates based on ring position and angle
    const zWave = Z_WAVE_AMP * ring.ringT * sin(angle * ring.zFreq + timeSec * 0.8 + ring.zPhase);
    const pz = zWave + p.jitterZ;

    // Color with alpha based on depth and twinkle
    const col = ACCENT_COLORS[ring.colorIdx];
    const twinkle = 0.5 + 0.5 * sin(timeSec * 3.0 + p.twinklePhase);
    const breathe = 0.7 + 0.3 * sin(theta + ring.ringT * PI);
    const alpha = (120 + 100 * twinkle) * breathe;

    // Point size pulses
    const sz = p.sizeBase * (0.6 + 0.8 * twinkle) * breathe;

    push();
    translate(px, py, pz);
    stroke(col[0], col[1], col[2], alpha);
    strokeWeight(sz);
    point(0, 0, 0);

    // Glow halo — slightly larger, lower alpha
    strokeWeight(sz * 2.5);
    stroke(col[0], col[1], col[2], alpha * 0.15);
    point(0, 0, 0);
    pop();
  }

  // Draw connecting lines between adjacent ring points (sparse, for structure)
  drawConnections(timeSec, theta);

  // Center core glow
  drawCoreGlow(timeSec, theta);

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

/* ───────────────────── Connections ───────────────────── */
function drawConnections(timeSec, theta) {
  // Draw radial connections every N-th spoke
  const spokeCount = SYMMETRY * 2;
  const morphBase = timeSec * MORPH_SPEED;

  for (let s = 0; s < spokeCount; s++) {
    const spokeAngle = (s / spokeCount) * TWO_PI;

    beginShape();
    noFill();
    for (let r = 0; r < RING_COUNT; r++) {
      const ring = rings[r];
      const morphT = 0.5 + 0.5 * sin(morphBase + ring.morphOffset);
      const angle = spokeAngle + timeSec * ring.rotSpeed;

      const rA = mandalaRadius(ring.shapeFrom, angle, ring.baseRadius, ring.petalCount, SYMMETRY);
      const rB = mandalaRadius(ring.shapeTo, angle, ring.baseRadius, ring.petalCount, SYMMETRY);
      const rad = lerp(rA, rB, morphT);

      const px = cos(angle) * rad;
      const py = sin(angle) * rad;
      const zWave = Z_WAVE_AMP * ring.ringT * sin(angle * ring.zFreq + timeSec * 0.8 + ring.zPhase);

      const col = ACCENT_COLORS[ring.colorIdx];
      const alpha = 30 + 45 * sin(theta + s * 0.5);
      stroke(col[0], col[1], col[2], alpha);
      strokeWeight(1.0);
      vertex(px, py, zWave);
    }
    endShape();
  }
}

/* ───────────────────── Core Glow ───────────────────── */
function drawCoreGlow(timeSec, theta) {
  const pulse = 0.5 + 0.5 * sin(theta * 2);

  push();
  noStroke();
  // Layered transparent spheres
  for (let i = 4; i >= 0; i--) {
    const t = i / 4;
    const r = 15 + i * 12;
    const a = (60 + 80 * (1 - t)) * pulse;
    // Alternate colors for core
    const col = i % 2 === 0 ? MINT : CYAN;
    fill(col[0], col[1], col[2], a);
    sphere(r * (0.8 + 0.2 * pulse));
  }
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

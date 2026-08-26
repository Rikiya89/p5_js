"use strict";

// Existing project framework: retained exactly.
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;

const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const CONFIG = {
  surfaceUSegments: 96,
  surfaceVSegments: 48,
  sphereRadius: 300,
  bulgeAmount: 0.4,        // equatorial expansion of the radial profile
  squashAmount: 0.1,       // axial compression feeding the corrugation
  corrugationLobes: 5,     // integer lobe count (Fibonacci, C1-safe / loop-safe)
  corrugationAmount: 0.34, // wrinkle depth, kept below the crease threshold
  openingOffset: 0,        // frame 0 opens on a bare sphere; Morin blend magnitude makes ripple-offset unnecessary
  surfaceLineWeight: 1.28,
  cameraDistance: 1500,
  cameraMaxDistance: 2300,
  cameraOrbitAmount: 126,
  framingFill: 0.82,
  fogDepthRange: 920,
};

const PHASES = [
  { key: "SPHERE", label: "01 · SPHERE", note: "A SPHERE, AT REST" },
  { key: "FOLD", label: "02 · FOLD", note: "THE SURFACE ENTERS ITSELF" },
  { key: "HALFWAY", label: "03 · MORIN HALFWAY", note: "SELF-INTERSECTION IS ALLOWED" },
  { key: "INVERT", label: "04 · INVERT", note: "THE ORIENTATION TURNS THROUGH" },
  { key: "EVERTED", label: "05 · EVERTED", note: "THE SAME SPHERE, INSIDE OUT" },
  { key: "RETURN", label: "06 · RETURN", note: "THE LOOP RETRACES THE INTERPOLATION" },
];

const pointCount = CONFIG.surfaceUSegments * CONFIG.surfaceVSegments;
const surface = {
  positions: new Float32Array(pointCount * 3),
  side: new Float32Array(pointCount), // sign of the radial profile: +1 outward, -1 everted
};

let canvasEl = null;
let grainPg = null;
let hudPg = null;
let bloomPg = null;
let bloomStreakPg = null;
const BLOOM_SCALE = 0.5;
let loopProgress = 0;
let phase = 0;
let evertT = 0;

// Existing deterministic WebCodecs + mp4-muxer recording workflow.
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
  strokeCap(ROUND);
  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  bloomPg = createGraphics(W * BLOOM_SCALE, H * BLOOM_SCALE, WEBGL);
  bloomPg.pixelDensity(1);
  bloomStreakPg = createGraphics(W * BLOOM_SCALE, H * BLOOM_SCALE);
  bloomStreakPg.pixelDensity(1);
  bakeGrain();

  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").onclick = startRecording;
  if (el("stopBtn")) el("stopBtn").onclick = stopRecording;
  if (el("maxDuration")) el("maxDuration").textContent = MAX_DURATION;
  if (el("canvasSize")) el("canvasSize").textContent = W + " × " + H;
  if (el("maxFrames")) el("maxFrames").textContent = MAX_FRAMES;
}

function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  randomSeed(20260824);
  for (let i = 0; i < Math.floor(W * H * 0.0016); i++) {
    const value = random(110, 200);
    grainPg.fill(value, value, value, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.15, 0.85));
  }
  for (let i = 0; i < Math.floor(W * H * 0.000035); i++) {
    const value = random(210, 255);
    grainPg.fill(value, value, value, random(12, 34));
    grainPg.circle(random(W), random(H), random(0.4, 1.2));
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function updateLoopTime() {
  const frame = isRecording ? recFrameCount : frameCount - 1;
  loopProgress = (((frame % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  phase = loopProgress * TAU;
  // Palindromic, C1-continuous eversion envelope, phase-offset so frame 0
  // already shows visible corrugation instead of a bare static sphere.
  evertT = 0.5 - 0.5 * Math.cos(TAU * (loopProgress + CONFIG.openingOffset));
}

// Driven by loopProgress (monotonic 0->1), not evertT (palindromic, needed
// for the seamless geometry loop) -- otherwise the stage label and percent
// would count back down through the second half of the loop.
function currentPhaseInfo() {
  const t = loopProgress;
  if (t < 0.06 || t >= 0.94) return PHASES[0];
  if (t < 0.19) return PHASES[1];
  if (t < 0.31) return PHASES[2];
  if (t < 0.47) return PHASES[3];
  if (t < 0.53) return PHASES[4];
  if (t < 0.69) return PHASES[5];
  if (t < 0.81) return PHASES[2];
  return PHASES[5];
}

function draw() {
  updateLoopTime();
  updateEvertingSurface();
  renderFrame();
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function paramIndex(i, j) {
  const wrappedI = (i + CONFIG.surfaceUSegments) % CONFIG.surfaceUSegments;
  const boundedJ = clamp(j, 0, CONFIG.surfaceVSegments - 1);
  return wrappedI * CONFIG.surfaceVSegments + boundedJ;
}

function setPosition(index, x, y, z) {
  const offset = index * 3;
  surface.positions[offset] = x;
  surface.positions[offset + 1] = y;
  surface.positions[offset + 2] = z;
}

// Morin-inspired halfway immersion with 3-fold rotational symmetry and
// self-intersection. u in [0, TAU), v in (0, PI). The denominator never
// vanishes (|denom| >= 2 - sqrt(2) ~= 0.586).
function morinPosition(u, v) {
  const denom = 2 + Math.SQRT2 * Math.cos(3 * u) * Math.sin(2 * v);
  const s2v = Math.sin(2 * v);
  const x = Math.cos(u) * s2v / denom;
  const y = Math.sin(u) * s2v / denom;
  const z = Math.cos(v) * Math.cos(v) / denom;
  return [x, y, z];
}

// Morin-driven visual interpolation: blend the outward sphere through the
// halfway immersion and toward the orientation-reversed sphere. This is a
// generative study of the eversion stages, not a numerical proof that every
// intermediate blend is a regular homotopy. s = sin(pi*t) is palindromic.
function evertPosition(u, v, t) {
  const s = Math.sin(Math.PI * t);
  const a = v - Math.PI * t;

  // Outward-sphere endpoint, orientation-flipped by pi*t over the loop.
  const sx = Math.sin(a) * Math.cos(u);
  const sy = Math.cos(a);
  const sz = Math.sin(a) * Math.sin(u);

  const [mx, my, mz] = morinPosition(u, v);
  // Morin surface's own axis is z; align it to the sketch's y-up axis and
  // scale to sphereRadius so the blend has comparable magnitude to the sphere.
  const morinScale = CONFIG.sphereRadius * 1.4;
  const bx = mx * morinScale, by = mz * morinScale, bz = my * morinScale;

  const x = sx * CONFIG.sphereRadius * (1 - s) + bx * s;
  const y = sy * CONFIG.sphereRadius * (1 - s) + by * s;
  const z = sz * CONFIG.sphereRadius * (1 - s) + bz * s;

  // Endpoint-orientation proxy: positive at the outward sphere, negative at
  // the everted sphere, and switching at the Morin halfway configuration.
  const side = Math.cos(Math.PI * t) >= 0 ? 1 : -1;
  return [x, y, z, side];
}

let maxRadius = CONFIG.sphereRadius;
let maxVerticalExtent = CONFIG.sphereRadius;

function updateEvertingSurface() {
  const du = TAU / CONFIG.surfaceUSegments;
  const vSpan = Math.PI - 0.07;
  const dv = vSpan / (CONFIG.surfaceVSegments - 1);

  // The Morin blend is not centroid-symmetric like a sphere, so recenter on
  // the bounding-box center each frame to keep the shape framed as it warps.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < CONFIG.surfaceUSegments; i++) {
    for (let j = 0; j < CONFIG.surfaceVSegments; j++) {
      const u = i * du;
      const v = 0.035 + j * dv;
      const idx = paramIndex(i, j);
      const p = evertPosition(u, v, evertT);
      setPosition(idx, p[0], p[1], p[2]);
      surface.side[idx] = p[3] < 0 ? -1 : 1;
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;

  let peak = 0, peakY = 0;
  for (let idx = 0; idx < pointCount; idx++) {
    const offset = idx * 3;
    surface.positions[offset] -= cx;
    surface.positions[offset + 1] -= cy;
    surface.positions[offset + 2] -= cz;
    const lateral = Math.hypot(surface.positions[offset], surface.positions[offset + 2]);
    if (lateral > peak) peak = lateral;
    const absY = Math.abs(surface.positions[offset + 1]);
    if (absY > peakY) peakY = absY;
  }
  maxRadius = peak;
  maxVerticalExtent = peakY;
}

function renderFrame() {
  setupCamera();
  renderBloomSource();
  streakBloom();

  background(BG_R, BG_G, BG_B);
  perspective(PI / 3.35, W / H, 10, 5000);
  drawEnvironment();
  push();
  rotateX(surfaceViewTilt());
  rotateZ(surfaceViewRoll());
  rotateY(-0.22 + 0.11 * Math.sin(phase));
  drawEvertingWireframe();
  pop();
  compositeBloom();
  drawScreenFinish();
}

function surfaceViewTilt() {
  const halfwayAmount = Math.sin(Math.PI * evertT);
  return -0.14 - 0.44 * halfwayAmount;
}

function surfaceViewRoll() {
  const halfwayAmount = Math.sin(Math.PI * evertT);
  return 0.07 * halfwayAmount * Math.sin(phase);
}

// Half-res WEBGL pass: same wireframe geometry, brighter/thicker, ADD-blended,
// then streaked horizontally for real luminous bloom instead of a fat low-alpha stroke.
function renderBloomSource() {
  const b = bloomPg;
  b.push();
  b.background(0);
  b.perspective(PI / 3.35, W / H, 10, 5000);
  b.camera(cameraEye.x, cameraEye.y, cameraEye.z, 0, 0, 0, 0, 1, 0);
  b.blendMode(ADD);
  b.noFill();
  b.push();
  b.rotateX(surfaceViewTilt());
  b.rotateZ(surfaceViewRoll());
  b.rotateY(-0.22 + 0.11 * Math.sin(phase));
  for (let i = 0; i < CONFIG.surfaceUSegments; i += 4) {
    b.strokeWeight(2.4);
    b.beginShape();
    for (let j = 0; j < CONFIG.surfaceVSegments; j++) {
      const idx = paramIndex(i, j);
      const offset = idx * 3;
      const a = sideAlpha(surface.side[idx], 150) * fogFactor(viewDepthAt(offset));
      b.stroke(INK_R, INK_G, INK_B, a);
      b.vertex(surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2]);
    }
    b.endShape();
  }
  b.pop();
  b.pop();
}

function streakBloom() {
  const s = bloomStreakPg;
  const taps = 14;
  const spread = 9;
  s.clear();
  s.push();
  s.blendMode(ADD);
  s.imageMode(CENTER);
  const cx = s.width / 2, cy = s.height / 2;
  for (let k = -taps; k <= taps; k++) {
    const falloff = 1 - Math.abs(k) / taps;
    s.tint(255, 255, 255, 28 * falloff * falloff);
    s.image(bloomPg, cx + k * spread, cy);
  }
  s.pop();
}

function compositeBloom() {
  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
  ortho(-W * 0.5, W * 0.5, -H * 0.5, H * 0.5, -10, 10);
  noLights();
  blendMode(ADD);
  tint(255, 255, 255, 235);
  image(bloomStreakPg, -W * 0.5, -H * 0.5, W, H);
  noTint();
  blendMode(BLEND);
  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

const cameraEye = { x: 0, y: 0, z: 0 };

const VFOV = Math.PI / 3.35;
const ASPECT = W / H;
const TAN_HALF_VFOV = Math.tan(VFOV / 2);

function setupCamera() {
  // Full-revolution orbit per loop (integer harmonic of phase) so the camera
  // returns exactly to its start position at the wrap — no seam cut.
  const eyeX = CONFIG.cameraOrbitAmount * Math.sin(phase);
  const eyeY = -44 + 34 * Math.sin(phase * 2);
  // Compute the distance needed to fit each axis separately against its own
  // half-FOV (vertical extent against vertical FOV, lateral extent against
  // horizontal FOV = vertical FOV * aspect), then take whichever is the
  // binding constraint. This replaces an isotropic pullback that shrank
  // wide-flat Morin-peak shapes far more than needed, leaving the portrait
  // frame's vertical space under-filled.
  const distForVertical = maxVerticalExtent / (TAN_HALF_VFOV * CONFIG.framingFill);
  const distForLateral = maxRadius / (TAN_HALF_VFOV * ASPECT * CONFIG.framingFill);
  // Isolated Morin outliers can otherwise force the whole subject into a tiny
  // portrait-frame footprint. The cap lets those strands approach the crop
  // while the main surface remains legible.
  const eyeZ = Math.min(
    Math.max(distForVertical, distForLateral, CONFIG.cameraDistance),
    CONFIG.cameraMaxDistance,
  );
  cameraEye.x = eyeX; cameraEye.y = eyeY; cameraEye.z = eyeZ;
  // Geometry is recentered to its own bounding-box centroid each frame, so
  // the look-at target stays at the origin rather than a fixed offset.
  camera(eyeX, eyeY, eyeZ, 0, 0, 0, 0, 1, 0);
}

// fogFactor(): near→far alpha falloff so depth reads as atmosphere, not a flat diagram.
function fogFactor(viewDepth) {
  // Measure atmosphere relative to the current camera distance. A fixed
  // world-distance fog made the Morin phase fade whenever auto-framing pulled
  // the camera back, even when a strand was on the visible front surface.
  const nearDepth = cameraEye.z - CONFIG.fogDepthRange * 0.5;
  const t = clamp((viewDepth - nearDepth) / CONFIG.fogDepthRange, 0, 1);
  return 1 - smooth01(t) * 0.82;
}

function viewDepthAt(offset) {
  const dx = surface.positions[offset] - cameraEye.x;
  const dy = surface.positions[offset + 1] - cameraEye.y;
  const dz = surface.positions[offset + 2] - cameraEye.z;
  return Math.hypot(dx, dy, dz);
}

function drawEnvironment() {
  noFill();
  strokeWeight(0.62);
  const fieldRadius = CONFIG.sphereRadius * 1.62;
  for (let ring = 0; ring < 3; ring++) {
    const radius = fieldRadius + ring * 92;
    stroke(INK_R, INK_G, INK_B, 8 - ring * 1.8);
    beginShape();
    for (let j = 0; j <= 96; j++) {
      const a = (j / 96) * TAU;
      vertex(Math.cos(a) * radius, Math.sin(a) * radius, -310 - ring * 24);
    }
    endShape();
  }

  stroke(INK_R, INK_G, INK_B, 12);
  line(-fieldRadius - 82, 0, -330, fieldRadius + 82, 0, -330);
  line(0, -fieldRadius - 82, -330, 0, fieldRadius + 82, -330);
}

// Monochrome orientation cue: the outward endpoint renders at full ink and
// the everted endpoint at a softer value. ADD still makes overlapping surface
// branches brightest without introducing a second color system.
function sideAlpha(side, baseAlpha) {
  return side < 0 ? baseAlpha * 0.88 : baseAlpha;
}

function drawEvertingWireframe() {
  // ADD makes actual overlapping surface branches brightest, so the visual
  // hierarchy exposes the self-intersections instead of flattening them.
  blendMode(ADD);
  const baseAlpha = 176;
  for (let i = 0; i < CONFIG.surfaceUSegments; i += 2) {
    const isRib = i % 10 === 0;
    strokeWeight(CONFIG.surfaceLineWeight * (isRib ? 1.7 : 1));
    const ribGain = isRib ? 1.35 : 0.62;
    noFill();
    beginShape();
    for (let j = 0; j < CONFIG.surfaceVSegments; j++) {
      const idx = paramIndex(i, j);
      const offset = idx * 3;
      const a = sideAlpha(surface.side[idx], baseAlpha) * ribGain * fogFactor(viewDepthAt(offset));
      stroke(INK_R, INK_G, INK_B, a);
      vertex(surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2]);
    }
    endShape();
  }
  strokeWeight(CONFIG.surfaceLineWeight);
  for (let j = 0; j < CONFIG.surfaceVSegments; j += 3) {
    noFill();
    beginShape();
    for (let i = 0; i <= CONFIG.surfaceUSegments; i++) {
      const idx = paramIndex(i, j);
      const offset = idx * 3;
      const a = sideAlpha(surface.side[idx], baseAlpha * 0.5) * fogFactor(viewDepthAt(offset));
      stroke(INK_R, INK_G, INK_B, a);
      vertex(surface.positions[offset], surface.positions[offset + 1], surface.positions[offset + 2]);
    }
    endShape();
  }
  blendMode(BLEND);
}

function evertPercentText() {
  return Math.round(evertT * 100) + "%";
}

function drawScreenFinish() {
  const g = hudPg;
  const info = currentPhaseInfo();
  g.clear();
  g.image(grainPg, 0, 0);
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, 38);
  g.strokeWeight(0.7);
  const m = 34, l = 24;
  g.line(m, m, m + l, m); g.line(m, m, m, m + l);
  g.line(W - m, m, W - m - l, m); g.line(W - m, m, W - m, m + l);
  g.line(m, H - m, m + l, H - m); g.line(m, H - m, m, H - m - l);
  g.line(W - m, H - m, W - m - l, H - m); g.line(W - m, H - m, W - m, H - m - l);

  // Exact existing typography settings, positions, alignment, spacing, and hierarchy.
  g.noStroke();
  g.textFont("ui-monospace, Menlo, Consolas, monospace");
  g.textAlign(CENTER, CENTER);
  g.textStyle(BOLD);
  g.fill(INK_R, INK_G, INK_B, 246);
  g.textSize(54);
  g.text("SPHERE EVERSION", W * 0.5, 222);
  g.textStyle(NORMAL);
  g.fill(INK_R, INK_G, INK_B, 148);
  g.textSize(24);
  g.text("A MORIN-SURFACE STUDY", W * 0.5, 278);
  g.fill(INK_R, INK_G, INK_B, 92);
  g.textSize(17);
  g.text("S^2 x I  ->  R^3   /   NO CUTS  ·  NO CREASES", W * 0.5, 316);

  g.textAlign(LEFT, TOP);
  g.fill(INK_R, INK_G, INK_B, 100);
  g.textSize(19);
  g.text(info.label, 70, 372);
  g.textAlign(RIGHT, TOP);
  g.text(evertPercentText(), W - 70, 372);

  const trackX = 70, trackY = 416, trackW = W - 140;
  g.stroke(INK_R, INK_G, INK_B, 34);
  g.strokeWeight(1);
  g.line(trackX, trackY, trackX + trackW, trackY);
  g.stroke(INK_R, INK_G, INK_B, 184);
  g.strokeWeight(2.2);
  g.line(trackX, trackY, trackX + trackW * loopProgress, trackY);
  g.noStroke();
  for (const marker of [0, 0.25, 0.5, 0.75, 1]) {
    g.fill(INK_R, INK_G, INK_B, marker === 0.5 ? 170 : 78);
    g.circle(trackX + trackW * marker, trackY, marker === 0.5 ? 6 : 4);
  }

  g.textAlign(CENTER, CENTER);
  g.fill(INK_R, INK_G, INK_B, 72 + 164 * smooth01(Math.sin(evertT * Math.PI)));
  g.textSize(22);
  g.text(info.note, W * 0.5, 1482);
  g.textSize(17);
  g.fill(INK_R, INK_G, INK_B, 130);
  g.text("OUTSIDE  ->  HALFWAY  ->  INSIDE OUT  ->  RETURN", W * 0.5, 1514);

  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
  ortho(-W * 0.5, W * 0.5, -H * 0.5, H * 0.5, -10, 10);
  noLights();
  blendMode(BLEND);
  image(g, -W * 0.5, -H * 0.5, W, H);
  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

function keyReleased() {
  if (key === "r" || key === "R") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === "s" || key === "S") {
    saveCanvas("sphere_eversion_" + getTimestamp(), "png");
    return false;
  }
  return true;
}

function updateRecordingUI() {
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = (recFrameCount / FPS).toFixed(1);
  if (el("frameCount")) el("frameCount").textContent = recFrameCount;
  if (el("progressFill")) el("progressFill").style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
}

function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported."); return; }
  if (typeof Mp4Muxer === "undefined") { alert("mp4-muxer not loaded."); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { console.error(error); isRecording = false; setStatus("Error", "#f44"); },
  });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  loopProgress = 0;
  phase = 0;
  isRecording = true;
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = "0.0";
  if (el("frameCount")) el("frameCount").textContent = "0";
  if (el("startBtn")) el("startBtn").disabled = true;
  if (el("stopBtn")) el("stopBtn").disabled = false;
  if (el("progressFill")) el("progressFill").style.width = "0%";
  setStatus("Recording…", "#fff");
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing…", "#ccc");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sphere_eversion_" + getTimestamp() + ".mp4";
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").disabled = false;
  if (el("stopBtn")) el("stopBtn").disabled = true;
  if (el("progressFill")) el("progressFill").style.width = "0%";
  setStatus("Complete", "#fff");
  setTimeout(() => setStatus("Ready", "#ccc"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(textValue, colorValue) {
  const el = document.getElementById("status");
  if (el) { el.textContent = textValue; el.style.color = colorValue; }
}

function getTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "_" +
    pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

if (typeof window !== "undefined") {
  window.startRecording = startRecording;
  window.stopRecording = stopRecording;
}

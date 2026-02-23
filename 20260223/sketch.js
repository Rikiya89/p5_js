// Repunit — 3D Generative Art
// R(n) = (10^n - 1)/9 = 1, 11, 111, 1111 ...  (n repeated "1" digits)
// Visual pillars:
//   · Repunit Columns  — column n has n unit-spheres stacked (the n digits of R(n))
//   · Digit Rings      — ring n has n nodes orbiting the ring (one per "1")
//   · Binary Repunits  — B(n) = 2^n−1 (Mersenne) as concentric wireframe spheres
//   · Unit Particles   — glowing motes drifting around each column
//   · Repunit Core     — icosahedral nucleus at centre
// Canvas: 1080 × 1920 (portrait 9:16)

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;
const MAX_N = 9;  // R(1)…R(9)

// ── Palette (unchanged from previous works) ──────────────────────────────────
const PALETTE_HEX = [
  "#362d78",
  "#523fa3",
  "#916ccc",
  "#bda1e5",
  "#c8c0e9",
  "#84bae7",
  "#516ad4",
  "#333f87",
  "#293039",
  "#283631"
];

// ── Repunit helper ────────────────────────────────────────────────────────────
// R(n) = 1, 11, 111, ...  (n ones)
function repunit(n) {
  let r = 0;
  for (let i = 0; i < n; i++) r = r * 10 + 1;
  return r;
}
// Binary repunit (Mersenne): B(n) = 2^n - 1
function binaryRepunit(n) { return Math.pow(2, n) - 1; }

// ── Global state ──────────────────────────────────────────────────────────────
let palette = [];
let stars    = [];
let unitParticles = [];

let encoder  = null, muxer = null;
let isRecording        = false;
let recordingFrameCount = 0;
let t = 0;

const STAR_COUNT          = 340;
const UNIT_PARTICLE_COUNT = 200;

// ── Icosahedron vertex table (for Repunit Core) ───────────────────────────────
const PHI_G = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS = [
  [ 0,  1,  PHI_G], [ 0, -1,  PHI_G], [ 0,  1, -PHI_G], [ 0, -1, -PHI_G],
  [ 1,  PHI_G,  0], [-1,  PHI_G,  0], [ 1, -PHI_G,  0], [-1, -PHI_G,  0],
  [ PHI_G,  0,  1], [-PHI_G,  0,  1], [ PHI_G,  0, -1], [-PHI_G,  0, -1]
];

// ─────────────────────────────────────────────────────────────────────────────
//  p5 entry-points
// ─────────────────────────────────────────────────────────────────────────────

function setup() {
  pixelDensity(1);
  setAttributes("antialias", true);
  createCanvas(W, H, WEBGL);
  frameRate(FPS);
  colorMode(RGB);
  smooth();

  palette = PALETTE_HEX.map(c => color(c));
  initStars();
  initUnitParticles();

  const maxDurationEl = document.getElementById("maxDuration");
  if (maxDurationEl) maxDurationEl.textContent = MAX_DURATION;
}

function draw() {
  if (isRecording && recordingFrameCount >= MAX_FRAMES) {
    stopRecording();
    return;
  }

  background(5, 4, 18);
  applyCamera();
  applyLights();
  drawStellarField();

  push();
  const breathe = 1 + 0.022 * sin(t * 0.38);
  scale(breathe);

  drawBinaryRepunitSpheres();   // outer wire shells (deepest layer)
  drawRepunitRings();           // stacked digit rings (mid layer)
  drawRepunitColumns();         // column towers (feature layer)
  drawColumnConnectors();       // inter-column digit webs
  drawUnitParticles();          // mote cloud
  drawRepunitCore();            // icosahedral nucleus

  pop();

  t += 0.0072;

  if (isRecording && encoder) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
  }
}

function keyPressed() {
  if (key === "r" || key === "R") {
    isRecording ? stopRecording() : startRecording();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Init helpers
// ─────────────────────────────────────────────────────────────────────────────

function initStars() {
  randomSeed(20260223);
  noiseSeed(20260223);
  stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = random(TWO_PI);
    const phi   = acos(random(-1, 1));
    const r     = random(700, 1460);
    stars.push({
      x: r * sin(phi) * cos(theta),
      y: r * sin(phi) * sin(theta),
      z: r * cos(phi),
      weight: random(0.7, 2.6),
      hueOffset: random()
    });
  }
}

function initUnitParticles() {
  unitParticles = [];
  for (let i = 0; i < UNIT_PARTICLE_COUNT; i++) {
    const col = floor(random(MAX_N));
    unitParticles.push({
      col,
      digitFrac:   random(),          // fractional digit index within column
      phase:       random(TWO_PI),
      speed:       random(0.28, 1.15),
      size:        random(1.8, 5.2),
      hueOffset:   random(),
      orbitRadius: random(14, 58),
      orbitPhase:  random(TWO_PI),
      riseOffset:  random()
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Palette
// ─────────────────────────────────────────────────────────────────────────────

function paletteColor(frac) {
  const n   = palette.length;
  const pos = ((frac % 1 + 1) % 1) * (n - 1);
  const i0  = floor(pos);
  const i1  = (i0 + 1) % n;
  return lerpColor(palette[i0], palette[i1], pos - i0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Camera & Lights
// ─────────────────────────────────────────────────────────────────────────────

function applyCamera() {
  const orbit     = t * 0.092;
  const zoomPulse = 0.5 + 0.5 * sin(t * 0.29);
  const radius    = 830 + 195 * zoomPulse * zoomPulse;

  const camX = radius * sin(orbit) + 185 * sin(t * 0.28);
  const camY = 145 * sin(t * 0.22) - 82 * cos(t * 0.075) + 58 * sin(t * 0.51);
  const camZ = radius * cos(orbit * (0.84 + 0.11 * sin(t * 0.11))) + 155 * cos(t * 0.25);

  const targetX = 65 * sin(t * 0.18);
  const targetY = 40 * cos(t * 0.20) + 28 * sin(t * 0.44);
  const targetZ = 52 * sin(t * 0.12);

  camera(camX, camY, camZ, targetX, targetY, targetZ, 0, 1, 0);
}

function applyLights() {
  ambientLight(20, 17, 42);
  const key  = paletteColor(t * 0.042 + 0.10);
  const fill = paletteColor(t * 0.042 + 0.46);
  const rim  = paletteColor(t * 0.042 + 0.77);
  pointLight(red(key),  green(key),  blue(key),  0, -420, 330);
  pointLight(red(fill), green(fill), blue(fill),
             390 * sin(t * 0.41), 260 * cos(t * 0.31), -230);
  directionalLight(red(rim), green(rim), blue(rim),
                   -0.38 + 0.27 * sin(t * 0.19), 0.22, -1);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Stellar field
// ─────────────────────────────────────────────────────────────────────────────

function drawStellarField() {
  push();
  rotateY(-t * 0.026);
  rotateX( t * 0.009);
  noFill();
  for (let i = 0; i < stars.length; i++) {
    const s       = stars[i];
    const twinkle = 0.35 + 0.65 * abs(sin(t * 1.75 + s.hueOffset * TWO_PI));
    const c       = paletteColor(s.hueOffset + t * 0.042);
    stroke(red(c), green(c), blue(c), 22 + 115 * twinkle);
    strokeWeight(s.weight * (0.42 + twinkle));
    point(s.x, s.y, s.z);
  }
  pop();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Repunit Columns
//  Column n (1-indexed) has n unit-spheres stacked vertically.
//  9 columns are arranged in a ring — together they display R(1)…R(9).
// ─────────────────────────────────────────────────────────────────────────────

function drawRepunitColumns() {
  const RING_R   = 285;   // radius of the arrangement circle
  const SPACING  = 62;    // vertical gap between unit spheres
  const UNIT_R   = 11.5;  // base radius of each "1" sphere

  push();
  rotateY(t * 0.115);

  for (let col = 0; col < MAX_N; col++) {
    const n     = col + 1;                           // column n has n spheres
    const angle = (col / MAX_N) * TWO_PI;
    const cx    = RING_R * cos(angle);
    const cz    = RING_R * sin(angle);

    const totalH = (n - 1) * SPACING;
    const topY   = -totalH / 2;                      // top sphere Y

    // Faint spine line connecting the spheres
    if (n > 1) {
      const lc = paletteColor(col / MAX_N + t * 0.04);
      stroke(red(lc), green(lc), blue(lc), 48);
      strokeWeight(0.65);
      line(cx, topY, cz, cx, topY + totalH, cz);
    }

    for (let d = 0; d < n; d++) {
      const phase  = t * 1.38 + col * 0.52 + d * 0.31;
      const pulse  = 0.5 + 0.5 * sin(phase);
      const yOff   = 7 * sin(t * 0.88 + col * 0.68 + d * 0.48);
      const cy     = topY + d * SPACING + yOff;
      const r      = UNIT_R + 3.2 * pulse;

      const c = paletteColor(col / MAX_N + d / (n * 1.8) + t * 0.052);

      push();
      translate(cx, cy, cz);

      // Halo ring around each sphere
      noFill();
      stroke(red(c), green(c), blue(c), 52 + 62 * pulse);
      strokeWeight(0.85);
      push();
      rotateX(HALF_PI + t * 0.18 + d * 0.28);
      beginShape();
      for (let j = 0; j <= 44; j++) {
        const a = (j / 44) * TWO_PI;
        vertex((r + 5) * cos(a), (r + 5) * sin(a), 0);
      }
      endShape(CLOSE);
      pop();

      // Core unit sphere
      noStroke();
      specularMaterial(red(c), green(c), blue(c));
      shininess(20);
      sphere(r, 14, 11);

      pop();
    }
  }
  pop();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Column Connectors
//  Connects the k-th sphere across all columns that have at least k digits,
//  tracing how R(n) grows from R(n-1) by appending one "1".
// ─────────────────────────────────────────────────────────────────────────────

function drawColumnConnectors() {
  const RING_R  = 285;
  const SPACING = 62;

  push();
  rotateY(t * 0.115);   // same rotation as columns
  noFill();

  for (let k = 0; k < MAX_N; k++) {
    const pulse = 0.35 + 0.65 * abs(sin(t * 0.78 + k * 0.38));
    const c     = paletteColor(k / MAX_N + t * 0.058 + 0.18);
    stroke(red(c), green(c), blue(c), 24 + 50 * pulse);
    strokeWeight(0.68);

    let prev = null;
    for (let col = k; col < MAX_N; col++) {
      const n     = col + 1;
      const angle = (col / MAX_N) * TWO_PI;
      const cx    = RING_R * cos(angle);
      const cz    = RING_R * sin(angle);

      const topY = -(n - 1) * SPACING / 2;
      const yOff = 7 * sin(t * 0.88 + col * 0.68 + k * 0.48);
      const cy   = topY + k * SPACING + yOff;

      if (prev) {
        line(prev.x, prev.y, prev.z, cx, cy, cz);
      }
      prev = { x: cx, y: cy, z: cz };
    }
  }
  pop();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Repunit Rings
//  Ring n sits at a different depth and carries n evenly-spaced glowing nodes
//  (one "1" digit per node).  Outer ring = R(9), inner ring = R(1).
// ─────────────────────────────────────────────────────────────────────────────

function drawRepunitRings() {
  push();
  rotateX(HALF_PI * 0.28 + 0.14 * sin(t * 0.24));
  rotateY(-t * 0.078);
  rotateZ( t * 0.048);

  for (let n = 1; n <= MAX_N; n++) {
    const ringR  = 58 + n * 35 + 9 * sin(t * 0.88 + n * 0.5);
    const zPos   = map(n, 1, MAX_N, 310, -310) + 17 * sin(t * 1.08 + n * 0.58);
    const c      = paletteColor((n - 1) / MAX_N + t * 0.042);
    const pulse  = 0.5 + 0.5 * sin(t * 1.45 + n * 0.54);
    const spinDir = (n % 2 === 0 ? 1 : -1);
    const spinRate = 0.28 * (n / MAX_N);

    push();
    translate(0, 0, zPos);

    // Ring outline
    noFill();
    stroke(red(c), green(c), blue(c), 48 + 62 * pulse);
    strokeWeight(0.88 + 0.38 * pulse);
    beginShape();
    for (let j = 0; j <= 90; j++) {
      const a = (j / 90) * TWO_PI;
      vertex(ringR * cos(a), ringR * sin(a), 0);
    }
    endShape(CLOSE);

    // n nodes on the ring, one per "1" digit in R(n)
    for (let k = 0; k < n; k++) {
      const nodeAngle = (k / n) * TWO_PI + t * spinDir * spinRate;
      const nx        = ringR * cos(nodeAngle);
      const ny        = ringR * sin(nodeAngle);
      const nc        = paletteColor((n - 1) / MAX_N + k / n * 0.28 + t * 0.068);
      const nodePulse = 0.5 + 0.5 * sin(t * 2.1 + n * 0.58 + k * 0.82);
      const nodeR     = 4.2 + 2.8 * nodePulse;

      // Spoke to centre
      stroke(red(nc), green(nc), blue(nc), 20 + 28 * nodePulse);
      strokeWeight(0.48);
      line(0, 0, 0, nx, ny, 0);

      // Node sphere
      push();
      translate(nx, ny, 0);
      noStroke();
      emissiveMaterial(red(nc) * 0.88, green(nc) * 0.88, blue(nc) * 0.88);
      sphere(nodeR, 9, 8);
      pop();
    }

    pop();
  }
  pop();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Binary Repunit Spheres
//  B(n) = 2^n − 1 = 1, 3, 7, 15, 31, 63, 127
//  Rendered as slowly-counter-rotating wireframe spheres at log-scaled radii.
// ─────────────────────────────────────────────────────────────────────────────

function drawBinaryRepunitSpheres() {
  push();
  rotateY(-t * 0.055);
  rotateX( t * 0.038);
  noFill();

  for (let n = 1; n <= 7; n++) {
    const baseR  = 52 + n * 34;
    const pulse  = 0.38 + 0.62 * abs(sin(t * 0.68 + n * 0.44));
    const r      = baseR + 11 * pulse;
    const c      = paletteColor(n / 7 + t * 0.038 + 0.52);
    stroke(red(c), green(c), blue(c), 22 + 36 * pulse);
    strokeWeight(0.55 + 0.28 * pulse);

    push();
    rotateY(t * 0.065 * (n % 2 === 0 ? 1 : -1) + n * 0.7);
    rotateX(t * 0.042 * n * 0.28 + n * 0.38);

    // Latitude rings
    const latN = 5;
    for (let lat = 0; lat < latN; lat++) {
      const theta = map(lat, 0, latN - 1, -HALF_PI, HALF_PI);
      const ringR = r * cos(theta);
      const y     = r * sin(theta);
      beginShape();
      for (let j = 0; j <= 48; j++) {
        const a = (j / 48) * TWO_PI;
        vertex(ringR * cos(a), y, ringR * sin(a));
      }
      endShape(CLOSE);
    }

    // Longitude arcs
    const lonN = 7;
    for (let lon = 0; lon < lonN; lon++) {
      const phi = (lon / lonN) * TWO_PI;
      beginShape();
      for (let j = 0; j <= 48; j++) {
        const theta = map(j, 0, 48, -HALF_PI, HALF_PI);
        vertex(r * cos(theta) * cos(phi), r * sin(theta), r * cos(theta) * sin(phi));
      }
      endShape();
    }

    pop();
  }
  pop();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Unit Particles
//  Glowing motes orbiting each column's sphere stack.
// ─────────────────────────────────────────────────────────────────────────────

function drawUnitParticles() {
  const RING_R  = 285;
  const SPACING = 62;

  push();
  rotateY(t * 0.115);

  for (let i = 0; i < unitParticles.length; i++) {
    const p   = unitParticles[i];
    const col = p.col;
    const n   = col + 1;

    const angle = (col / MAX_N) * TWO_PI;
    const cx    = RING_R * cos(angle);
    const cz    = RING_R * sin(angle);

    const digitIdx = floor(p.digitFrac * n);
    const topY     = -(n - 1) * SPACING / 2;
    const baseY    = topY + digitIdx * SPACING;

    const cycle      = (p.riseOffset + t * 0.052 * p.speed) % 1;
    const orbitAngle = p.orbitPhase + t * p.speed * 1.45;

    const px = cx + p.orbitRadius * cos(orbitAngle);
    const py = baseY + 22 * sin(cycle * TWO_PI + p.phase);
    const pz = cz + p.orbitRadius * sin(orbitAngle);

    const c     = paletteColor(p.hueOffset + t * 0.068 + cycle * 0.22);
    const alpha = 78 + 118 * (0.5 + 0.5 * sin(cycle * TWO_PI));

    push();
    translate(px, py, pz);
    noStroke();
    emissiveMaterial(red(c) * 0.88, green(c) * 0.88, blue(c) * 0.88);
    sphere(p.size * (0.72 + 0.28 * sin(t * 2.8 + i)), 7, 6);
    pop();
  }
  pop();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Repunit Core
//  12-vertex icosahedral shell of unit spheres at the origin.
//  Each vertex represents a "1" — 12 ones, echoing the twelve-digit digital root.
// ─────────────────────────────────────────────────────────────────────────────

function drawRepunitCore() {
  push();
  rotateY( t * 0.28);
  rotateX(-t * 0.19);
  rotateZ( t * 0.13);

  const coreR = 44 + 7.5 * sin(t * 1.18);

  // Icosahedral vertices (normalised to coreR)
  const pts = [];
  for (let i = 0; i < ICO_VERTS.length; i++) {
    const [vx, vy, vz] = ICO_VERTS[i];
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    pts.push(createVector(vx / len * coreR, vy / len * coreR, vz / len * coreR));
  }

  // Edges between vertices close enough (icosahedral edges ≈ 2/PHI_G * coreR)
  const edgeThresh = coreR * 1.18;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = p5.Vector.dist(pts[i], pts[j]);
      if (d < edgeThresh) {
        const ec = paletteColor(i / pts.length + t * 0.078 + 0.28);
        stroke(red(ec), green(ec), blue(ec), 88);
        strokeWeight(0.85);
        line(pts[i].x, pts[i].y, pts[i].z,
             pts[j].x, pts[j].y, pts[j].z);
      }
    }
  }

  // Vertex spheres
  for (let i = 0; i < pts.length; i++) {
    const c     = paletteColor(i / pts.length + t * 0.095);
    const pulse = 0.5 + 0.5 * sin(t * 2.18 + i * 0.51);
    push();
    translate(pts[i].x, pts[i].y, pts[i].z);
    noStroke();
    emissiveMaterial(red(c) * 0.92, green(c) * 0.92, blue(c) * 0.92);
    sphere(5.5 + 3.2 * pulse, 10, 9);
    pop();
  }

  // Central nucleus
  noStroke();
  const cc = paletteColor(t * 0.10 + 0.48);
  emissiveMaterial(red(cc) * 0.72, green(cc) * 0.72, blue(cc) * 0.72);
  sphere(18 + 4.5 * sin(t * 1.75), 18, 14);

  pop();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Recording — WebCodecs + mp4-muxer  (palette & recording code kept intact)
// ─────────────────────────────────────────────────────────────────────────────

function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs API is not supported in this browser.\nUse Chrome or Edge.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer failed to load. Refresh and try again.");
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error("Encoder error:", e);
      setStatus("Encoder error", "#ff6b6b");
      isRecording = false;
    }
  });
  encoder.configure({
    codec: "avc1.640028",
    width: W, height: H,
    bitrate: 12_000_000,
    framerate: FPS
  });

  t = 0;
  isRecording = true;
  recordingFrameCount = 0;

  const startBtn = document.getElementById("startBtn");
  const stopBtn  = document.getElementById("stopBtn");
  if (startBtn) startBtn.disabled = true;
  if (stopBtn)  stopBtn.disabled  = false;

  setStatus("Recording MP4...", "#ff6b6b");
  updateRecordingUI();
}

async function stopRecording() {
  if (!isRecording || !encoder || !muxer) return;

  isRecording = false;
  setStatus("Finalizing MP4...", "#84bae7");

  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = "repunit_20260223.mp4";
  a.click();

  encoder.close();
  encoder = null;
  muxer   = null;
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  const startBtn = document.getElementById("startBtn");
  const stopBtn  = document.getElementById("stopBtn");
  if (startBtn) startBtn.disabled = false;
  if (stopBtn)  stopBtn.disabled  = true;

  setStatus("Complete!", "#84bae7");
  setTimeout(() => setStatus("Ready", "#84bae7"), 3000);
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector("canvas");
  if (!canvas) return;
  const frame = new VideoFrame(canvas, {
    timestamp: recordingFrameCount * (1_000_000 / FPS)
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, colorHex) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent  = text;
  el.style.color  = colorHex;
}

function updateRecordingUI() {
  const d = document.getElementById("duration");
  const f = document.getElementById("frameCount");
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}

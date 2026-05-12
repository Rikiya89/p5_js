'use strict';

// ---------------------------------------------------------------------------
// 3D Generative Art — Rose Lissajous Particle Bloom
//
// Mathematical theme:
//   Rose curve + Lissajous motion + spherical particle layering
//
// Core formulas:
//   Clifford attractor:
//     x(n+1) = sin(a*y(n)) + c*cos(a*x(n))
//     y(n+1) = sin(b*x(n)) + d*cos(b*y(n))
//
//   Hyperbolic wave field:
//     z = sin(x² - y² + t) * A + cos(2xy - t) * B
//
//   Polar caustic halo:
//     r = base * (1 + amp * sin(kθ + t))
//
// Visual direction:
//   Different formula family from the previous version.
//   This version uses chaotic attractor paths, hyperbolic saddle waves,
//   polar caustic halos, luminous particles, scan beams, and soft trails.
//
// Constraints preserved:
//   Canvas size: 1080 × 1920
//   FPS / LOOP_SECONDS / LOOP_FRAMES structure
//   WebCodecs + mp4-muxer capture pipeline
// ---------------------------------------------------------------------------

const W            = 1080;
const H            = 1920;
const FPS          = 60;
const LOOP_SECONDS = 24;
const LOOP_FRAMES  = FPS * LOOP_SECONDS;

const BG = [8, 10, 13];

// ---------------------------------------------------------------------------
// Artwork configuration
// ---------------------------------------------------------------------------
const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) * 0.5;
const ROSE_K = 7;
const LISS_A = 3;
const LISS_B = 4;
const LISS_DELTA = Math.PI * 0.5;

const GRID_COLS = 32;
const GRID_ROWS = 44;
const GRID_SPACING = 34;

const BLOOM_LAYERS = 6;
const BLOOM_STEPS = 300;
const PARTICLE_COUNT = 620;
const DUST_PARTICLE_COUNT = 260;
const BEAM_COUNT = 10;
const STAR_COUNT = 180;

let stars = [];
let particles = [];
let dustParticles = [];
let camZ = 2300;
let trailLayer;

// ---------------------------------------------------------------------------
// setup / draw
// ---------------------------------------------------------------------------
let canvasEl;
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
  setAttributes('antialias', true);
  smooth();

  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  trailLayer.clear();

  stars = buildStars(STAR_COUNT);
  particles = buildRoseParticles(PARTICLE_COUNT);
  dustParticles = buildRoseDustParticles(DUST_PARTICLE_COUNT);

  const maxDurEl     = document.getElementById('maxDuration');
  const maxFramesEl  = document.getElementById('maxFrames');
  const canvasSizeEl = document.getElementById('canvasSize');

  if (maxDurEl)     maxDurEl.textContent     = LOOP_SECONDS;
  if (maxFramesEl)  maxFramesEl.textContent  = LOOP_FRAMES;
  if (canvasSizeEl) canvasSizeEl.textContent = W + ' × ' + H;
}

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const time = loop * TAU;

  background(BG[0], BG[1], BG[2]);

  camZ = 2700;
  camera(0, 0, camZ, 0, 0, 0, 0, 1, 0);
  perspective(PI / 5.75, W / H, 10, 10000);

  const yaw = 0.22 * Math.sin(time * 0.5) + time * 0.038;
  const pitch = 0.74 + 0.065 * Math.sin(time * 0.75);
  const roll = 0.04 * Math.sin(time * 0.35);

  drawTrailLayer();
  drawStarField(time, yaw, pitch);
  drawScanBeams(time, yaw, pitch, roll);
  drawRoseBloomLines(time, yaw, pitch, roll);
  drawRoseDustParticles(time, yaw, pitch, roll);
  drawRoseParticles(time, yaw, pitch, roll);
  drawSacredHalo(time, yaw, pitch, roll);
  drawScreenEffects(time);
  drawHUD(time);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingHUD();

    if (recFrameCount >= LOOP_FRAMES) {
      stopRecording();
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function roseRadius(theta, k, amp = 1) {
  return amp * Math.cos(k * theta);
}

function lissajousOffset(t, amp = 1) {
  return {
    x: amp * Math.sin(LISS_A * t + LISS_DELTA),
    y: amp * Math.sin(LISS_B * t),
  };
}


function transformPoint(p, yaw, pitch, roll) {
  const y1 = rotateAroundY(p, yaw);
  const x1 = rotateAroundX(y1, pitch);
  return rotateAroundZ(x1, roll);
}

function rotateAroundX(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);

  return {
    x: p.x,
    y: p.y * c - p.z * s,
    z: p.y * s + p.z * c,
  };
}

function rotateAroundY(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);

  return {
    x: p.x * c + p.z * s,
    y: p.y,
    z: -p.x * s + p.z * c,
  };
}

function rotateAroundZ(p, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);

  return {
    x: p.x * c - p.y * s,
    y: p.x * s + p.y * c,
    z: p.z,
  };
}

function fog(z) {
  const dist = Math.abs(camZ - z);
  return Math.exp(-dist / 3600);
}

function projectToScreen(p) {
  // Manual perspective projection for the 2D trail layer.
  // This avoids relying on p5.js screenX/screenY, which may be unavailable
  // depending on the p5 build or WEBGL context mode.
  const depth = Math.max(220, camZ - p.z);
  const scale = camZ / depth;

  return {
    x: W * 0.5 + p.x * scale,
    y: H * 0.5 + p.y * scale,
  };
}

// ---------------------------------------------------------------------------
// Afterimage layer
// ---------------------------------------------------------------------------
function drawTrailLayer() {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);

  tint(255, 34);
  image(trailLayer, -W / 2, -H / 2, W, H);
  noTint();

  trailLayer.noStroke();
  trailLayer.fill(BG[0], BG[1], BG[2], 17);
  trailLayer.rect(0, 0, W, H);

  pop();
}

function addTrailDot(x, y, size, alpha) {
  trailLayer.noStroke();
  trailLayer.fill(255, 255, 255, alpha);
  trailLayer.circle(x, y, size);
}

function addTrailLine(x1, y1, x2, y2, alpha) {
  trailLayer.stroke(255, 255, 255, alpha);
  trailLayer.strokeWeight(1);
  trailLayer.line(x1, y1, x2, y2);
}


// ---------------------------------------------------------------------------
// Clifford attractor paths
// ---------------------------------------------------------------------------
function drawRoseBloomLines(time, yaw, pitch, roll) {
  noFill();
  blendMode(ADD);

  for (let layer = 0; layer < BLOOM_LAYERS; layer++) {
    const lk = layer / (BLOOM_LAYERS - 1);
    const radiusBase = 240 + lk * 360;
    const zBase = map(lk, 0, 1, -300, 300);
    const phase = time * (0.16 + lk * 0.08) + lk * TAU;

    stroke(255, 255, 255, 18 + 58 * Math.pow(1 - lk, 1.35));
    strokeWeight(layer % 2 === 0 ? 2.2 : 1.15);

    beginShape();
    for (let i = 0; i <= BLOOM_STEPS; i++) {
      const t = (i / BLOOM_STEPS) * TAU;
      const rose = Math.abs(roseRadius(t + phase, ROSE_K, 1));
      const rr = radiusBase * (0.42 + 0.58 * rose);
      const liss = lissajousOffset(t + time * 0.45 + lk * TAU, 38 + lk * 26);
      const breathe = 1 + 0.045 * Math.sin(time * 2.0 + lk * TAU);

      const x = Math.cos(t) * rr * breathe + liss.x;
      const y = Math.sin(t) * rr * 0.92 * breathe + liss.y;
      const z = zBase + 64 * Math.sin(t * 2.0 + time + lk * TAU);

      const twisted = rotateAroundY({ x, y, z }, time * 0.09 + lk * 0.34);
      const p = transformPoint(twisted, yaw * 0.92, pitch + 0.02, roll + lk * 0.035);
      vertex(p.x, p.y, p.z);
    }
    endShape(CLOSE);
  }

  blendMode(BLEND);
}

// ---------------------------------------------------------------------------
// Clifford attractor particles
// ---------------------------------------------------------------------------
function buildRoseParticles(count) {
  const arr = [];

  for (let i = 0; i < count; i++) {
    const k = i / count;
    const layer = i % BLOOM_LAYERS;
    const layerK = layer / (BLOOM_LAYERS - 1);
    const theta = k * TAU * 18 + layerK * TAU;
    const phi = Math.acos(1 - 2 * ((i * PHI) % 1));
    const rose = Math.abs(roseRadius(theta, ROSE_K, 1));

    arr.push({
      theta,
      phi,
      rose,
      layer,
      seed: random(TAU),
      size: random(1.0, 3.4),
      glow: random(0.75, 1.35),
    });
  }

  return arr;
}

function buildRoseDustParticles(count) {
  const arr = [];

  for (let i = 0; i < count; i++) {
    const k = i / count;
    const layer = i % BLOOM_LAYERS;
    const layerK = layer / (BLOOM_LAYERS - 1);
    const theta = k * TAU * 26 + layerK * TAU * 0.5;
    const phi = Math.acos(1 - 2 * ((i * PHI * 1.7) % 1));
    const rose = Math.abs(roseRadius(theta, ROSE_K + 2, 1));

    arr.push({
      theta,
      phi,
      rose,
      layer,
      seed: random(TAU),
      size: random(0.45, 1.35),
      drift: random(0.65, 1.35),
    });
  }

  return arr;
}

function drawRoseDustParticles(time, yaw, pitch, roll) {
  noStroke();
  blendMode(ADD);

  for (let i = 0; i < dustParticles.length; i++) {
    const pt = dustParticles[i];
    const layerK = pt.layer / (BLOOM_LAYERS - 1);
    const t = pt.theta + time * (0.10 + layerK * 0.09) * pt.drift;
    const rose = Math.abs(roseRadius(t + time * 0.06, ROSE_K + 2, 1));
    const radius = (260 + layerK * 460) * (0.52 + 0.48 * rose);
    const spherical = 0.42 + 0.58 * Math.sin(pt.phi);

    const x = Math.cos(t) * radius * spherical;
    const y = Math.sin(t) * radius * 0.9 * spherical;
    const z = Math.cos(pt.phi + time * 0.18 + pt.seed) * (280 + layerK * 240)
            + 36 * Math.sin(t * 3.0 + time + pt.seed);

    const p0 = rotateAroundY({ x, y, z }, time * 0.075 + layerK * 0.45);
    const p = transformPoint(p0, yaw * 1.01, pitch, roll);
    const f = fog(p.z);
    const pulse = 0.55 + 0.45 * Math.sin(time * 2.6 + pt.seed);
    const size = pt.size * (1.0 + pulse * 1.6) * f;

    fill(255, 255, 255, 34 * f * pulse);
    circle(p.x, p.y, size * 4.4);

    fill(255, 255, 255, 92 * f);
    circle(p.x, p.y, size);
  }

  blendMode(BLEND);
}

function drawRoseParticles(time, yaw, pitch, roll) {
  noStroke();

  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    const layerK = pt.layer / (BLOOM_LAYERS - 1);
    const t = pt.theta + time * (0.18 + layerK * 0.12);
    const rose = Math.abs(roseRadius(t, ROSE_K, 1));
    const liss = lissajousOffset(t * 0.5 + time * 0.7 + pt.seed, 24 + layerK * 42);

    const radius = (210 + layerK * 390) * (0.48 + 0.52 * rose);
    const spherical = 0.55 + 0.45 * Math.sin(pt.phi);
    const breathe = 1 + 0.055 * Math.sin(time * 2.2 + pt.seed);

    const x = Math.cos(t) * radius * spherical * breathe + liss.x;
    const y = Math.sin(t) * radius * 0.92 * spherical * breathe + liss.y;
    const z = Math.cos(pt.phi + time * 0.28 + layerK * TAU) * (280 + layerK * 220)
            + 62 * Math.sin(t * 2.0 + time + pt.seed);

    const p0 = rotateAroundY({ x, y, z }, time * 0.11 + layerK * 0.6);
    const p = transformPoint(p0, yaw * 1.02, pitch, roll);
    const f = fog(p.z);
    const pulse = 0.58 + 0.42 * Math.sin(time * 3.0 + pt.seed);
    const size = pt.size * pt.glow * (1.05 + pulse * 1.55) * f;

    blendMode(ADD);
    fill(255, 255, 255, 72 * f * pulse);
    circle(p.x, p.y, size * 7.2);

    blendMode(BLEND);
    fill(255, 255, 255, 250 * f);
    circle(p.x, p.y, size);

    if (i % 11 === 0) {
      const sp = projectToScreen(p);
      addTrailDot(sp.x, sp.y, 4 + size * 2.8, 18);
    }
  }

  blendMode(BLEND);
}
// ---------------------------------------------------------------------------
// Sacred geometric halo
// ---------------------------------------------------------------------------
function drawSacredHalo(time, yaw, pitch, roll) {
  noFill();
  blendMode(ADD);

  const layers = 3;
  const petals = 8;

  for (let layer = 0; layer < layers; layer++) {
    const lk = layer / (layers - 1);
    const radius = 240 + lk * 160;
    const pulse = 1 + 0.035 * Math.sin(time * 2.0 + layer);

    stroke(255, 255, 255, 28 + 74 * Math.pow(1 - lk, 1.25));
    strokeWeight(layer === 0 ? 1.8 : 1.05);

    for (let p = 0; p < petals; p++) {
      const phase = (p / petals) * TAU + time * 0.08 * (layer % 2 === 0 ? 1 : -1);

      beginShape();
      for (let i = 0; i <= 72; i++) {
        const k = i / 72;
        const a = k * TAU;
        const rose = Math.abs(roseRadius(a + phase + time * 0.2, 6 + layer, 1));
        const localR = radius * pulse * (0.30 + 0.70 * rose);
        const x = Math.cos(a + phase) * localR + Math.cos(phase) * radius * 0.30;
        const y = Math.sin(a + phase) * localR * 0.72 + 14 * Math.sin(time + p);
        const z = Math.sin(a * 2.0 + phase + time) * 48 + lk * 82;
        const q = transformPoint({ x, y, z }, yaw * 0.72, pitch + 0.04, roll);
        vertex(q.x, q.y, q.z);
      }
      endShape(CLOSE);
    }
  }

  blendMode(BLEND);
}
// ---------------------------------------------------------------------------
// Central prism

// ---------------------------------------------------------------------------
// Central prism
// ---------------------------------------------------------------------------
function drawCentralPrism(time, yaw, pitch, roll) {
  push();

  const p = transformPoint({ x: 0, y: 0, z: 0 }, yaw, pitch, roll);
  translate(p.x, p.y, p.z);
  rotateY(time * 0.42);
  rotateX(time * 0.31);
  rotateZ(time * 0.18);

  noFill();
  stroke(255, 255, 255, 195);
  strokeWeight(1.55);

  const h = 220 + 24 * Math.sin(time * 2.0);
  const r = 68 + 9 * Math.cos(time * 1.5);

  beginShape();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * TAU;
    vertex(Math.cos(a) * r, -h * 0.5, Math.sin(a) * r);
  }
  endShape(CLOSE);

  beginShape();
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * TAU + 0.18;
    vertex(Math.cos(a) * r * 0.72, h * 0.5, Math.sin(a) * r * 0.72);
  }
  endShape(CLOSE);

  for (let i = 0; i < 6; i++) {
    const a1 = (i / 6) * TAU;
    const a2 = (i / 6) * TAU + 0.18;
    line(
      Math.cos(a1) * r,
      -h * 0.5,
      Math.sin(a1) * r,
      Math.cos(a2) * r * 0.72,
      h * 0.5,
      Math.sin(a2) * r * 0.72
    );
  }

  blendMode(ADD);
  noStroke();
  for (let i = 5; i >= 1; i--) {
    fill(255, 255, 255, 28 / i);
    sphere(22 * i, 24, 12);
  }
  blendMode(BLEND);

  pop();
}

// ---------------------------------------------------------------------------
// Scan beams and star field
// ---------------------------------------------------------------------------
function drawScanBeams(time, yaw, pitch, roll) {
  blendMode(ADD);
  noFill();

  for (let i = 0; i < BEAM_COUNT; i++) {
    const k = i / BEAM_COUNT;
    const a = k * TAU + time * 0.28;
    const radius = 790 + 135 * Math.sin(time * 1.2 + i);
    const y1 = -860 + 70 * Math.sin(time + i);
    const y2 = 860 + 70 * Math.cos(time * 0.8 + i);

    const p1 = transformPoint({ x: Math.cos(a) * radius, y: y1, z: Math.sin(a) * radius }, yaw, pitch, roll);
    const p2 = transformPoint({ x: Math.cos(a + 0.12) * radius, y: y2, z: Math.sin(a + 0.12) * radius }, yaw, pitch, roll);

    stroke(255, 255, 255, 10 + 28 * Math.sin(time * 2 + i));
    strokeWeight(i % 5 === 0 ? 1.8 : 0.48);
    line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
  }

  blendMode(BLEND);
}

function buildStars(count) {
  const arr = [];

  for (let i = 0; i < count; i++) {
    const a = random(TAU);
    const r = random(680, 1600);

    arr.push({
      x: Math.cos(a) * r,
      y: random(-1060, 1060),
      z: Math.sin(a) * r,
      s: random(0.45, 1.8),
      p: random(TAU),
    });
  }

  return arr;
}

function drawStarField(time, yaw, pitch) {
  noStroke();

  for (const s of stars) {
    const drift = rotateAroundY(s, time * 0.02);
    const p = transformPoint(drift, yaw * 0.10, pitch * 0.16, 0);
    const twinkle = 0.55 + 0.45 * Math.sin(time * 1.5 + s.p);
    const f = fog(p.z);

    fill(255, 255, 255, 38 * f * twinkle);
    circle(p.x, p.y, s.s);
  }
}

// ---------------------------------------------------------------------------
// Screen-space effects
// ---------------------------------------------------------------------------
function drawScreenEffects(time) {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);

  // Horizontal scanlines.
  strokeWeight(1);
  for (let y = -H / 2; y < H / 2; y += 24) {
    const k = (y + H / 2) / H;
    const alpha = 3 + 3 * Math.sin(time * 6 + k * TAU * 12);
    stroke(255, 255, 255, alpha);
    line(-W / 2, y, W / 2, y);
  }

  // Moving light slit.
  const slitY = map(Math.sin(time * 0.75), -1, 1, -H * 0.42, H * 0.42);
  blendMode(ADD);
  noStroke();
  for (let i = 0; i < 12; i++) {
    const a = 9 - i * 0.55;
    fill(255, 255, 255, a);
    rect(-W / 2, slitY - i * 5, W, 2 + i * 2);
  }
  blendMode(BLEND);

  // Vignette.
  noFill();
  const maxR = Math.hypot(W, H) * 0.64;
  strokeWeight(maxR / 30);
  for (let i = 0; i < 30; i++) {
    const k = i / 29;
    const alp = constrain(map(k, 0.62, 1, 0, 82), 0, 82);
    stroke(0, 0, 0, alp);
    circle(0, 0, maxR * 2 * k);
  }

  pop();
}

function drawHUD(time) {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);
  textFont('monospace');

  const x = -W / 2 + 34;
  const y = H / 2 - 34;

  noStroke();
  fill(255, 255, 255, 170);
  textAlign(LEFT, BOTTOM);
  textSize(31);
  text('Rose Lissajous Particle Bloom', x, y - 58);

  fill(255, 255, 255, 92);
  textSize(15);
  text('rose curve · Lissajous motion · spherical particle layers', x, y - 26);

  fill(255, 255, 255, 66);
  textSize(12);
  text('clean rose particles · soft trails · monochrome p5.js WEBGL', x, y);

  const cx = W / 2 - 55;
  const cy = H / 2 - 122;
  const values = ['R', 'L', '7'];

  for (let i = 0; i < values.length; i++) {
    const yy = cy - i * 34;
    const pulse = 0.55 + 0.45 * Math.sin(time * 2.0 + i * 0.9);

    stroke(255, 255, 255, 105 + 95 * pulse);
    strokeWeight(1.1);
    noFill();
    rectMode(CENTER);
    rect(cx, yy, 22 + i * 3, 22 + i * 3);

    noStroke();
    fill(255, 255, 255, 135 + 80 * pulse);
    textAlign(CENTER, CENTER);
    textSize(10);
    text(values[i], cx, yy + 0.5);
  }

  fill(255, 255, 255, 48);
  textAlign(RIGHT, TOP);
  textSize(11);
  text('rose curve k=7', W / 2 - 28, -H / 2 + 28);
  text('Lissajous 3:4', W / 2 - 28, -H / 2 + 46);

  pop();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function keyReleased() {
  if (key === 'r' || key === 'R') {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
    return false;
  }

  if (key === 's' || key === 'S') {
    saveCanvas('20260512_rose_lissajous_particle_bloom_' + timestamp(), 'png');
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Recording pipeline
// ---------------------------------------------------------------------------
function updateRecordingHUD() {
  if (!isRecording) return;

  const durEl    = document.getElementById('duration');
  const framesEl = document.getElementById('frameCount');
  const fillEl   = document.getElementById('progressFill');

  if (durEl)    durEl.textContent    = (recFrameCount / FPS).toFixed(1);
  if (framesEl) framesEl.textContent = recFrameCount;
  if (fillEl)   fillEl.style.width   = (100 * recFrameCount / LOOP_FRAMES).toFixed(2) + '%';
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;

  el.textContent = text;
  if (color) el.style.color = color;
}

function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    setStatus('WebCodecs unsupported · use Chrome', '#f44');
    return;
  }

  if (typeof Mp4Muxer === 'undefined') {
    setStatus('mp4-muxer not loaded', '#f44');
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: W,
      height: H,
    },
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

  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');

  if (startBtn) startBtn.disabled = true;
  if (stopBtn)  stopBtn.disabled  = false;

  setStatus('Recording…', '#fff');
  updateRecordingHUD();
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
  a.download = '20260512_rose_lissajous_particle_bloom_' + timestamp() + '.mp4';
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;

  setTimeout(() => URL.revokeObjectURL(url), 6000);

  const startBtn = document.getElementById('startBtn');
  const stopBtn  = document.getElementById('stopBtn');

  if (startBtn) startBtn.disabled = false;
  if (stopBtn)  stopBtn.disabled  = true;

  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;

  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1000000 / FPS),
  });

  encoder.encode(frame, {
    keyFrame: recFrameCount % FPS === 0,
  });

  frame.close();
}

function timestamp() {
  const d = new Date();

  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_`
       + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}
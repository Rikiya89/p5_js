'use strict';

// ---------------------------------------------------------------------------
// 3D Generative Art — Limited Diffusion Aggregation Monolith
// Based on Generative Gestaltung P_2_2_4_02
// Black / White, 1080 × 1920, WEBGL, capture-ready
// ---------------------------------------------------------------------------

const W = 1080;
const H = 1920;
const FPS = 60;
const LOOP_SECONDS = 24;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

const BG = [0, 0, 0];
const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) * 0.5;

// Original DLA-inspired system
const MAX_COUNT = 4400;
const BUILD_PER_FRAME = 46;
const SEED_RADIUS = 420;
const MIN_R = 1.4;
const MAX_R = 8.6;
const FIELD_W = 780;
const FIELD_H = 1280;
const BEAUTY_ROTATION = 0.42;
const BREATH_AMOUNT = 0.075;
const RIBBON_COUNT = 7;

let currentCount = 1;
let aggX = [];
let aggY = [];
let aggZ = [];
let aggR = [];
let ghostX = [];
let ghostY = [];
let parentIndex = [];
let generation = [];

let stars = [];
let orbitDust = [];
let drawGhosts = false;

let trailLayer;
let canvasEl;
let camZ = 2360;

// Capture state
let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;
let captureInProgress = false;

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

  initAggregation();
  stars = buildStars(220);
  orbitDust = buildOrbitDust(520);

  setupCaptureUI();
}

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const time = loop * TAU;

  background(BG[0], BG[1], BG[2]);

  camZ = 2360;
  camera(0, 0, camZ, 0, 0, 0, 0, 1, 0);
  perspective(PI / 5.4, W / H, 10, 9000);

  if (currentCount < MAX_COUNT) {
    for (let i = 0; i < BUILD_PER_FRAME; i++) {
      addAggregationCircle();
      if (currentCount >= MAX_COUNT) break;
    }
  }

  const cinematicEase = 0.5 - 0.5 * Math.cos(time);
  const yaw = time * BEAUTY_ROTATION + 0.22 * Math.sin(time * 0.5);
  const pitch = 0.66 + 0.105 * Math.sin(time * 0.7 + cinematicEase * 0.7);
  const roll = 0.075 * Math.sin(time * 0.35) + 0.035 * Math.sin(time * 1.15);

  drawTrailLayer();
  drawStarField(time, yaw, pitch);
  drawStructuralGrid(time, yaw, pitch, roll);
  drawHarmonicRibbons(time, yaw, pitch, roll);
  drawAggregationGhosts(time, yaw, pitch, roll);
  drawAggregationBody(time, yaw, pitch, roll);
  drawOrbitDust(time, yaw, pitch, roll);
  drawLightRain(time, yaw, pitch, roll);
  drawCentralPulse(time, yaw, pitch, roll);
  drawScreenEffects(time);
  drawHUD(time);

  if (isRecording && !captureInProgress) {
    captureInProgress = true;
    captureFrame()
      .then(() => {
        recFrameCount++;
        updateRecordingHUD();
        if (recFrameCount >= LOOP_FRAMES) stopRecording();
      })
      .catch(e => { console.error(e); stopRecording(); })
      .finally(() => { captureInProgress = false; });
  }
}

// ---------------------------------------------------------------------------
// Limited diffusion aggregation
// ---------------------------------------------------------------------------
function initAggregation() {
  currentCount = 1;

  aggX = [];
  aggY = [];
  aggZ = [];
  aggR = [];
  ghostX = [];
  ghostY = [];
  parentIndex = [];
  generation = [];

  aggX[0] = 0;
  aggY[0] = 0;
  aggZ[0] = 0;
  aggR[0] = SEED_RADIUS;

  ghostX[0] = 0;
  ghostY[0] = 0;
  parentIndex[0] = -1;
  generation[0] = 0;
}

function addAggregationCircle() {
  const newR = random(MIN_R, MAX_R);
  const angleField = random(TAU);
  const radialBias = Math.pow(random(), 0.58);

  const newX = Math.cos(angleField) * FIELD_W * 0.5 * radialBias + random(-70, 70);
  const newY = Math.sin(angleField) * FIELD_H * 0.5 * radialBias + random(-110, 110);

  let closestDist = Number.MAX_VALUE;
  let closestIndex = 0;

  for (let i = 0; i < currentCount; i++) {
    const dx = newX - aggX[i];
    const dy = newY - aggY[i];
    const d = Math.sqrt(dx * dx + dy * dy);

    if (d < closestDist) {
      closestDist = d;
      closestIndex = i;
    }
  }

  const a = Math.atan2(newY - aggY[closestIndex], newX - aggX[closestIndex]);
  const attachDist = aggR[closestIndex] + newR * 1.04;

  ghostX[currentCount] = newX;
  ghostY[currentCount] = newY;

  aggX[currentCount] = aggX[closestIndex] + Math.cos(a) * attachDist;
  aggY[currentCount] = aggY[closestIndex] + Math.sin(a) * attachDist;

  const depthWave = Math.sin(a * 3.0 + closestIndex * 0.013) * 120;
  const spiralLift = Math.cos(a * 5.0 + currentCount * 0.021) * 42;
  const inheritedDepth = aggZ[closestIndex] * 0.975;
  aggZ[currentCount] = inheritedDepth + depthWave * 0.09 + spiralLift * 0.18 + random(-7, 7);

  aggR[currentCount] = newR;
  parentIndex[currentCount] = closestIndex;
  generation[currentCount] = generation[closestIndex] + 1;

  currentCount++;
}

// ---------------------------------------------------------------------------
// Transform helpers
// ---------------------------------------------------------------------------
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
  return Math.exp(-dist / 3500);
}

function projectToScreen(p) {
  const depth = Math.max(240, camZ - p.z);
  const scale = camZ / depth;

  return {
    x: W * 0.5 + p.x * scale,
    y: H * 0.5 + p.y * scale,
  };
}

// ---------------------------------------------------------------------------
// Trail layer
// ---------------------------------------------------------------------------
function drawTrailLayer() {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);

  tint(255, 28);
  image(trailLayer, -W / 2, -H / 2, W, H);
  noTint();

  trailLayer.noStroke();
  trailLayer.fill(0, 0, 0, 22);
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
// Main aggregation render
// ---------------------------------------------------------------------------
function drawAggregationBody(time, yaw, pitch, roll) {
  blendMode(ADD);
  noFill();

  for (let i = 1; i < currentCount; i += 2) {
    const pIndex = parentIndex[i];
    if (pIndex < 0) continue;

    const waveA = time * 0.72 + generation[i] * 0.034;
    const breathA = 1 + BREATH_AMOUNT * Math.sin(time * 1.15 + generation[i] * 0.045);
    const breathB = 1 + BREATH_AMOUNT * Math.sin(time * 1.15 + generation[pIndex] * 0.045);

    const p1 = transformPoint({
      x: aggX[i] * breathA,
      y: aggY[i] * breathA,
      z: aggZ[i] + 46 * Math.sin(waveA),
    }, yaw, pitch, roll);

    const p2 = transformPoint({
      x: aggX[pIndex] * breathB,
      y: aggY[pIndex] * breathB,
      z: aggZ[pIndex] + 46 * Math.sin(waveA + 0.6),
    }, yaw, pitch, roll);

    const f = fog((p1.z + p2.z) * 0.5);

    const currentPulse = 0.5 + 0.5 * Math.sin(time * 2.8 + i * 0.017);
    stroke(255, 255, 255, 7 + 42 * f * currentPulse);
    strokeWeight(i % 13 === 0 ? 1.28 : 0.46);
    line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);

    if (i % 19 === 0) {
      const s1 = projectToScreen(p1);
      const s2 = projectToScreen(p2);
      addTrailLine(s1.x, s1.y, s2.x, s2.y, 9);
    }
  }

  noStroke();

  for (let i = 1; i < currentCount; i++) {
    const k = i / MAX_COUNT;
    const gen = generation[i];

    const pulse = 0.58 + 0.42 * Math.sin(time * 2.8 + gen * 0.11 + i * 0.01);
    const breathingScale = 1 + BREATH_AMOUNT * Math.sin(time * 1.15 + gen * 0.045);
    const drift = 7.5 * Math.sin(time * 1.6 + i * 0.033);
    const zWave = 58 * Math.sin(time * 1.2 + aggX[i] * 0.009 + aggY[i] * 0.004);

    const p = transformPoint({
      x: aggX[i] * breathingScale + Math.cos(gen * 0.21) * drift,
      y: aggY[i] * breathingScale + Math.sin(gen * 0.18) * drift,
      z: aggZ[i] + zWave,
    }, yaw, pitch, roll);

    const f = fog(p.z);
    const rr = aggR[i] * (0.76 + pulse * 0.42) * (1.0 + k * 0.28);

    fill(255, 255, 255, 8 * f * pulse);
    circle(p.x, p.y, rr * 6.4);

    fill(255, 255, 255, 36 * f);
    circle(p.x, p.y, rr * 2.15);

    fill(255, 255, 255, 145 * f);
    circle(p.x, p.y, Math.max(1.2, rr * 0.58));

    if (i % 23 === 0) {
      const sp = projectToScreen(p);
      addTrailDot(sp.x, sp.y, rr * 2.8, 14);
    }
  }

  const seed = transformPoint({ x: 0, y: 0, z: 0 }, yaw, pitch, roll);

  stroke(255, 255, 255, 90);
  strokeWeight(1.2);
  noFill();
  circle(seed.x, seed.y, SEED_RADIUS * 1.48);

  blendMode(BLEND);
}

function drawAggregationGhosts(time, yaw, pitch, roll) {
  if (!drawGhosts) return;

  blendMode(ADD);
  noFill();

  for (let i = 1; i < currentCount; i += 6) {
    const p1 = transformPoint({
      x: ghostX[i],
      y: ghostY[i],
      z: -360 + 60 * Math.sin(time + i),
    }, yaw, pitch, roll);

    const p2 = transformPoint({
      x: aggX[i],
      y: aggY[i],
      z: aggZ[i],
    }, yaw, pitch, roll);

    stroke(255, 255, 255, 20);
    strokeWeight(0.4);
    line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);

    stroke(255, 255, 255, 36);
    circle(p1.x, p1.y, aggR[i] * 1.6);
  }

  blendMode(BLEND);
}

// ---------------------------------------------------------------------------
// Supporting visual systems
// ---------------------------------------------------------------------------
function drawStructuralGrid(time, yaw, pitch, roll) {
  blendMode(ADD);
  noFill();

  const rings = 11;

  for (let j = 0; j < rings; j++) {
    const k = j / (rings - 1);
    const radiusX = 170 + k * 560;
    const radiusY = 280 + k * 780;
    const z = -460 + k * 920;
    const spin = time * (0.035 + k * 0.045);

    stroke(255, 255, 255, 7 + 20 * (1 - k));
    strokeWeight(j % 3 === 0 ? 1.0 : 0.38);

    beginShape();
    for (let i = 0; i <= 220; i++) {
      const a = (i / 220) * TAU;
      const harmonic = Math.sin(a * 6 + time * 1.2 + j) * Math.cos(a * 3 - time * 0.6);
      const w = 1 + 0.035 * harmonic;

      const p = transformPoint({
        x: Math.cos(a + spin) * radiusX * w,
        y: Math.sin(a) * radiusY * w,
        z: z + 42 * Math.sin(a * 2 + time + j),
      }, yaw * 0.72, pitch + 0.02, roll);

      vertex(p.x, p.y, p.z);
    }
    endShape(CLOSE);
  }

  blendMode(BLEND);
}

function drawHarmonicRibbons(time, yaw, pitch, roll) {
  blendMode(ADD);
  noFill();

  for (let band = 0; band < RIBBON_COUNT; band++) {
    const bandK = band / Math.max(1, RIBBON_COUNT - 1);
    const phase = bandK * TAU;
    const radius = 260 + bandK * 520;
    const height = 860 - bandK * 120;

    stroke(255, 255, 255, 10 + 18 * (1 - bandK));
    strokeWeight(band === 0 || band === RIBBON_COUNT - 1 ? 0.9 : 0.48);

    beginShape();
    for (let i = 0; i <= 260; i++) {
      const t = i / 260;
      const a = t * TAU * 2.0 + time * (0.35 + bandK * 0.25) + phase;
      const petal = Math.sin(a * 3.0 + time) * 0.18 + Math.sin(a * 5.0 - time * 0.7) * 0.08;
      const rr = radius * (1 + petal);
      const y = map(t, 0, 1, -height * 0.5, height * 0.5);

      const p = transformPoint({
        x: Math.cos(a) * rr,
        y,
        z: Math.sin(a) * rr * 0.72 + 90 * Math.sin(t * TAU + time + phase),
      }, yaw * 1.12, pitch, roll);

      vertex(p.x, p.y, p.z);
    }
    endShape();
  }

  blendMode(BLEND);
}

function buildOrbitDust(count) {
  const arr = [];

  for (let i = 0; i < count; i++) {
    const k = i / count;

    arr.push({
      a: k * TAU * 16 + random(-0.1, 0.1),
      radius: random(220, 760),
      y: random(-720, 720),
      z: random(-540, 540),
      size: random(0.45, 1.7),
      speed: random(0.18, 0.72),
      phase: random(TAU),
    });
  }

  return arr;
}

function drawOrbitDust(time, yaw, pitch, roll) {
  blendMode(ADD);
  noStroke();

  for (const d of orbitDust) {
    const a = d.a + time * d.speed;
    const breathe = 1 + 0.08 * Math.sin(time * 1.4 + d.phase);

    const p = transformPoint({
      x: Math.cos(a) * d.radius * breathe,
      y: d.y + 34 * Math.sin(time * 1.2 + d.phase),
      z: Math.sin(a) * d.radius + d.z * 0.22,
    }, yaw * 1.08, pitch, roll);

    const f = fog(p.z);
    const twinkle = 0.5 + 0.5 * Math.sin(time * 4.0 + d.phase);
    const burst = Math.pow(0.5 + 0.5 * Math.sin(time * 1.4 + d.a), 4.0);

    fill(255, 255, 255, 22 * f * twinkle);
    circle(p.x, p.y, d.size * 7.0);

    fill(255, 255, 255, 80 * f * twinkle + 90 * f * burst);
    circle(p.x, p.y, d.size * 1.35);
  }

  blendMode(BLEND);
}

function drawLightRain(time, yaw, pitch, roll) {
  blendMode(ADD);
  strokeWeight(0.55);

  for (let i = 0; i < 90; i++) {
    const k = i / 90;
    const a = k * TAU * PHI + time * 0.22;
    const radius = 360 + 460 * Math.sin(k * TAU * 2.0 + time * 0.3) ** 2;
    const y = -880 + ((k * 1760 + time * 180) % 1760);
    const z = 340 * Math.sin(k * TAU * 3.0 + time * 0.6);

    const p1 = transformPoint({
      x: Math.cos(a) * radius,
      y,
      z: Math.sin(a) * radius * 0.42 + z,
    }, yaw * 0.92, pitch, roll);

    const p2 = transformPoint({
      x: Math.cos(a) * radius,
      y: y + 34,
      z: Math.sin(a) * radius * 0.42 + z + 18,
    }, yaw * 0.92, pitch, roll);

    const f = fog((p1.z + p2.z) * 0.5);
    stroke(255, 255, 255, 10 + 30 * f);
    line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
  }

  blendMode(BLEND);
}

function drawCentralPulse(time, yaw, pitch, roll) {
  blendMode(ADD);
  noFill();

  const p = transformPoint({ x: 0, y: 0, z: 0 }, yaw, pitch, roll);
  const pulse = 0.5 + 0.5 * Math.sin(time * 2.0);

  stroke(255, 255, 255, 84 + 62 * pulse);
  strokeWeight(1.4);
  circle(p.x, p.y, 52 + pulse * 42);

  noStroke();
  fill(255, 255, 255, 22);
  circle(p.x, p.y, 180 + pulse * 120);

  fill(255, 255, 255, 180);
  circle(p.x, p.y, 7 + pulse * 6);

  blendMode(BLEND);
}

function buildStars(count) {
  const arr = [];

  for (let i = 0; i < count; i++) {
    const a = random(TAU);
    const r = random(820, 1800);

    arr.push({
      x: Math.cos(a) * r,
      y: random(-1120, 1120),
      z: Math.sin(a) * r,
      s: random(0.35, 1.6),
      p: random(TAU),
    });
  }

  return arr;
}

function drawStarField(time, yaw, pitch) {
  noStroke();

  for (const s of stars) {
    const drift = rotateAroundY(s, time * 0.018);
    const p = transformPoint(drift, yaw * 0.12, pitch * 0.18, 0);
    const twinkle = 0.45 + 0.55 * Math.sin(time * 1.4 + s.p);
    const f = fog(p.z);

    fill(255, 255, 255, 42 * f * twinkle);
    circle(p.x, p.y, s.s);
  }
}

// ---------------------------------------------------------------------------
// Screen effects
// ---------------------------------------------------------------------------
function drawScreenEffects(time) {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);

  blendMode(BLEND);
  noFill();

  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    const alpha = 5 + k * 14;

    stroke(255, 255, 255, alpha);
    strokeWeight(1);
    rect(
      -W * 0.5 + 42 + k * 28,
      -H * 0.5 + 72 + k * 34,
      W - 84 - k * 56,
      H - 144 - k * 68
    );
  }

  noStroke();

  for (let i = 0; i < 80; i++) {
    const y = -H * 0.5 + i * 24 + ((time * 18) % 24);
    fill(255, 255, 255, i % 8 === 0 ? 5 : 1.5);
    rect(-W * 0.5, y, W, 1);
  }

  for (let i = 0; i < 44; i++) {
    const k = i / 44;
    const x = -W * 0.5 + k * W;
    const alpha = 3 + 8 * Math.sin(k * TAU + time) ** 2;
    fill(255, 255, 255, alpha);
    rect(x, -H * 0.5, 1, H);
  }

  pop();
}

function drawHUD(time) {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);

  noStroke();
  fill(255, 255, 255, 155);
  textFont('monospace');
  textSize(18);
  textAlign(LEFT, TOP);
  text('LIMITED DIFFUSION AGGREGATION', -W * 0.5 + 54, -H * 0.5 + 56);

  fill(255, 255, 255, 92);
  textSize(13);
  text('BLACK / WHITE SYSTEM  |  COUNT ' + nf(currentCount, 4) + ' / ' + MAX_COUNT, -W * 0.5 + 54, -H * 0.5 + 86);

  if (isRecording) {
    fill(255, 255, 255, 170 + 70 * Math.sin(time * 8));
    text('REC ' + nf(recFrameCount, 4) + ' / ' + LOOP_FRAMES, -W * 0.5 + 54, -H * 0.5 + 112);
  }

  pop();
}

// ---------------------------------------------------------------------------
// Capture helpers — WebCodecs + mp4-muxer
// ---------------------------------------------------------------------------
function setupCaptureUI() {
  const el = (id) => document.getElementById(id);
  if (el('maxDuration'))  el('maxDuration').textContent  = LOOP_SECONDS;
  if (el('maxFrames'))    el('maxFrames').textContent    = LOOP_FRAMES;
  if (el('canvasSize'))   el('canvasSize').textContent   = `${W}×${H} / ${FPS}fps`;
}

function updateRecordingHUD() {
  const pf  = document.getElementById('progressFill');
  const dur = document.getElementById('duration');
  const fc  = document.getElementById('frameCount');
  const st  = document.getElementById('status');
  const p   = Math.min(recFrameCount / LOOP_FRAMES, 1);
  if (pf)  pf.style.width  = `${(p * 100).toFixed(1)}%`;
  if (dur) dur.textContent = (recFrameCount / FPS).toFixed(1);
  if (fc)  fc.textContent  = recFrameCount;
  if (st && isRecording) st.textContent = `Recording… ${(p * 100).toFixed(0)}%`;
}

async function startRecording() {
  if (isRecording) return;
  if (!window.VideoEncoder || !window.Mp4Muxer) {
    alert('VideoEncoder or Mp4Muxer unavailable. Use Chrome/Edge.');
    return;
  }

  recFrameCount = 0;
  captureInProgress = false;

  const sb = document.getElementById('startBtn');
  const rb = document.getElementById('stopBtn');
  if (sb) sb.disabled = true;
  if (rb) rb.disabled = false;

  const st = document.getElementById('status');
  if (st) st.textContent = `Recording ${W}×${H} / ${FPS}fps`;

  initAggregation();
  trailLayer.clear();

  try {
    muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      fastStart: 'in-memory',
    });

    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error:  (e) => { console.error(e); stopRecording(); },
    });

    encoder.configure({
      codec: 'avc1.64002A', width: W, height: H,
      bitrate: 14_000_000, bitrateMode: 'constant',
      framerate: FPS, avc: { format: 'avc' }, latencyMode: 'quality',
    });

    isRecording = true;
  } catch (e) {
    console.error(e);
    encoder = muxer = null;
    if (sb) sb.disabled = false;
    if (rb) rb.disabled = true;
    const st2 = document.getElementById('status');
    if (st2) st2.textContent = 'Setup failed. See console.';
  }
}

async function captureFrame() {
  if (!encoder || !canvasEl) return;
  const bitmap = await createImageBitmap(canvasEl);
  const frame  = new VideoFrame(bitmap, {
    timestamp: Math.round((recFrameCount * 1_000_000) / FPS),
    duration:  Math.round(1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
  bitmap.close();
}

async function stopRecording() {
  if (!isRecording && !encoder) return;
  isRecording = false;
  captureInProgress = false;

  const st = document.getElementById('status');
  if (st) st.textContent = 'Finalizing MP4…';

  try {
    if (encoder) await encoder.flush();
    if (muxer) {
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = 'limited-diffusion-aggregation-monolith.mp4';
      a.click();
      URL.revokeObjectURL(url);
    }
    if (st) st.textContent = 'Done — MP4 saved.';
  } catch (e) {
    console.error(e);
    if (st) st.textContent = 'Export failed. See console.';
  } finally {
    encoder = muxer = null;
    const sb = document.getElementById('startBtn');
    const rb = document.getElementById('stopBtn');
    if (sb) sb.disabled = false;
    if (rb) rb.disabled = true;
    updateRecordingHUD();
  }
}

// ---------------------------------------------------------------------------
// Keyboard controls
// ---------------------------------------------------------------------------
function keyReleased() {
  if (key === 's' || key === 'S') {
    saveCanvas('limited-diffusion-aggregation-monolith', 'png');
  }

  if (key === '1') {
    drawGhosts = !drawGhosts;
  }

  if (key === 'r' || key === 'R') {
    initAggregation();
    trailLayer.clear();
  }
}
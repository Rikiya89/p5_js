'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

// ─── Speed ────────────────────────────────────────────────────────────────────
const LOOP_FRAMES  = FPS * 8;    // 8-second loop (was 20s)
const GLOBAL_RATE  = 2;        // phase/rotation multiplier

// ─── Palette ──────────────────────────────────────────────────────────────────
// Set useBio = true for Bio-Synthetic (acid green / cyan / violet / hot pink).
// Set useBio = false for monochrome.
const useBio = false;

const MONO = { bg: [0, 0, 0] };
const BIO  = {
  bg:   [4, 4, 12],
  cols: [
    [0,   255, 159],   // acid green
    [0,   207, 255],   // cyan
    [139,   0, 255],   // violet
    [255,   0, 110],   // hot pink
  ],
};

function getBG()       { return useBio ? BIO.bg : MONO.bg; }
function bioCol(ci)    { return useBio ? BIO.cols[ci % 4] : [255, 255, 255]; }

const TRAIL_ALPHA = 36;

// ─── Math constants ───────────────────────────────────────────────────────────
const PHI = 1.61803398875;
const SQ2 = Math.sqrt(2);
const TAU = Math.PI * 2;

// ─── State ────────────────────────────────────────────────────────────────────
let trailLayer = null;
let grainLayer = null;
let webglLayer = null;

let phaseA = 0, phaseB = 0, phaseC = 0;
let particles  = [];
let qcLattice  = [];

let muxer         = null;
let encoder       = null;
let isRecording   = false;
let recFrameCount = 0;
let canvasEl      = null;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl  = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  noFill();
  strokeCap(ROUND);

  const bg = getBG();

  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  trailLayer.colorMode(RGB, 255, 255, 255, 255);
  trailLayer.strokeCap(ROUND);
  trailLayer.background(bg[0], bg[1], bg[2]);

  webglLayer = createGraphics(W, H, WEBGL);
  webglLayer.pixelDensity(1);
  webglLayer.colorMode(RGB, 255, 255, 255, 255);
  webglLayer.noFill();
  webglLayer.strokeCap(ROUND);
  webglLayer.strokeJoin(ROUND);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseedPattern(floor(random(100000)));

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
function reseedPattern(seed) {
  randomSeed(seed);
  noiseSeed(seed);
  phaseA = random(TAU);
  phaseB = random(TAU);
  phaseC = random(TAU);
  particles = createParticles(120);
  qcLattice = createQuasicrystalLattice();
  const bg = getBG();
  if (trailLayer) trailLayer.background(bg[0], bg[1], bg[2]);
}

function createParticles(count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    arr.push({
      radius: 0.30 + Math.sqrt(u) * 1.58,
      angle:  i * Math.PI * (3 - Math.sqrt(5)),
      lane:   i % 5,
      lift:   random(-0.8, 0.8),
      size:   random(1.0, 2.5),
      ci:     i % 4,
    });
  }
  return arr;
}

// 5-fold quasicrystal lattice
function createQuasicrystalLattice() {
  const arr = [];
  for (let ring = 1; ring <= 8; ring++) {
    const count  = ring * 5;
    const radius = map(ring, 1, 8, 0.18, 1.62);
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * TAU + (ring % 2) * Math.PI / count;
      arr.push({ radius, theta, ring, index: i, count, ci: ring % 4 });
    }
  }
  return arr;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const la   = loop * TAU * GLOBAL_RATE;
  const bg   = getBG();

  trailLayer.noStroke();
  trailLayer.fill(bg[0], bg[1], bg[2], TRAIL_ALPHA);
  trailLayer.rect(0, 0, W, H);

  renderGaussianScene(la, loop);

  background(bg[0], bg[1], bg[2]);
  image(trailLayer, 0, 0);

  push();
  tint(255, 16);
  image(grainLayer, 0, 0);
  noTint();
  pop();

  drawCornerBrackets();
  drawHUD(la, loop);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderGaussianScene(la, loop) {
  webglLayer.clear();
  webglLayer.push();
  webglLayer.background(0, 0, 0, 0);
  webglLayer.noFill();

  const camZ = 840 + 18 * Math.sin(la + phaseC);
  const camX = 42  * Math.sin(la * 0.5 + phaseA * 0.2);
  const camY = -142 + 8 * Math.cos(la * 0.5 + phaseB * 0.2);

  webglLayer.camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);
  webglLayer.perspective(Math.PI / 3.75, W / H, 0.1, 5000);

  webglLayer.rotateX(-0.56 + 0.018 * Math.sin(la * 0.5));
  webglLayer.rotateZ( la   * 0.095 + 0.018 * Math.sin(la * 0.5 + phaseB));
  webglLayer.scale(1.28 + 0.025 * Math.sin(la));

  drawRotatingCompass(la);
  drawLissajousCorona(la);
  drawAxes();
  drawEquipotentials(la);
  drawQuasicrystalField(la);
  drawOrbitalRings(la);
  drawMobiusRibbon(la);
  drawParticles(la);
  drawOriginSignal(la);

  webglLayer.pop();
  trailLayer.image(webglLayer, 0, 0);
}

// ─── Complex math ─────────────────────────────────────────────────────────────
function complexTransform(x, y, t) {
  const r     = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(y, x);
  const rot   = t * 0.11 + 0.04 * Math.sin(r * 2.0 - t);
  const xr    = x * Math.cos(rot) - y * Math.sin(rot);
  const yr    = x * Math.sin(rot) + y * Math.cos(rot);
  const h     = Math.sin(r * 3.45 - t * 1.05) * 23
              + Math.cos(theta * 6 + t * 0.58) * 13
              + Math.sin(t + theta) * (6 / (r + 0.46))
              + Math.sin(t * 0.5 + r * 1.3) * 8;
  return { x: xr, y: yr, r, theta, height: h };
}

function worldPoint(x, y, t, sc = 100) {
  const z = complexTransform(x, y, t);
  return { x: z.x * sc, y: z.y * sc, z: z.height };
}

// ─── Stroke helper ────────────────────────────────────────────────────────────
function inkStroke(alpha, ci = 0) {
  const c = bioCol(ci);
  webglLayer.stroke(c[0], c[1], c[2], alpha);
}

// ─── Rose curve ───────────────────────────────────────────────────────────────
function drawRoseCurve(k, br, amp, phase, al, sw, dir, ci = 0) {
  inkStroke(al, ci);
  webglLayer.strokeWeight(sw);
  webglLayer.beginShape();
  for (let i = 0; i <= 600; i++) {
    const u  = i / 600;
    const a  = u * TAU;
    const r  = (br + amp * Math.cos(k * a + phase)) * (1 + 0.032 * Math.sin(phase * 0.7 + a * 3 * dir));
    webglLayer.vertex(Math.cos(a) * r, Math.sin(a) * r, 10 * Math.sin(a * 3 * dir + phase * 0.8));
  }
  webglLayer.endShape();
}

// ─── Compass ──────────────────────────────────────────────────────────────────
function drawRotatingCompass(t) {
  webglLayer.push();
  webglLayer.rotateZ(t * 0.24);

  drawRoseCurve(6, 92, 30,  t * 0.95,  128, 1.00,  1, 0);
  drawRoseCurve(5, 76, 22, -t * 0.72,   72, 0.55, -1, 1);

  for (let i = 0; i < 18; i++) {
    const a     = (i / 18) * TAU;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.9 + i * PHI);
    const len   = lerp(80, 210, pulse);
    const major = i % 3 === 0;
    inkStroke(major ? 130 : 50, i % 4);
    webglLayer.strokeWeight(major ? 0.95 : 0.38);
    webglLayer.line(Math.cos(a) * 18, Math.sin(a) * 18, -5,
                    Math.cos(a) * len, Math.sin(a) * len, 9 * pulse);
  }

  for (let ring = 0; ring < 4; ring++) {
    const r = (48 + ring * 42) * (1 + 0.022 * Math.sin(t * 1.1 + ring * PHI))
            + 4 * Math.sin(t * 0.7 + ring);
    inkStroke(108 - ring * 20, ring);
    webglLayer.strokeWeight(ring === 1 ? 0.82 : 0.54);
    webglLayer.circle(0, 0, r * 2);
  }

  webglLayer.pop();
}

// ─── Lissajous corona ─────────────────────────────────────────────────────────
// Freq ratios 3:2 / 5:4 / 7:6 / 4:3 — parametric beating on the complex plane.
function drawLissajousCorona(t) {
  const cfgs = [
    { a: 3, b: 2, delta: Math.PI / 2, R: 155, ci: 0 },
    { a: 5, b: 4, delta: Math.PI / 3, R: 125, ci: 1 },
    { a: 7, b: 6, delta: Math.PI / 4, R: 92,  ci: 2 },
    { a: 4, b: 3, delta: Math.PI / 5, R: 108, ci: 3 },
  ];

  for (const cfg of cfgs) {
    const beat = 0.020 * Math.sin(t * PHI + cfg.ci);
    inkStroke(useBio ? 92 : 60, cfg.ci);
    webglLayer.strokeWeight(0.62);
    webglLayer.beginShape();
    for (let i = 0; i <= 520; i++) {
      const u = i / 520;
      const s = u * TAU;
      const x = Math.cos(cfg.a * s + cfg.delta + t * 0.08) * cfg.R * (1 + beat);
      const y = Math.sin(cfg.b * s + t * 0.05) * cfg.R * (1 + beat);
      const z = 13 * Math.sin(s * 2 + t * 0.7 + cfg.ci);
      webglLayer.vertex(x, y, z);
    }
    webglLayer.endShape();
  }
}

// ─── Axes ─────────────────────────────────────────────────────────────────────
function drawAxes() {
  inkStroke(80, 0);
  webglLayer.strokeWeight(0.62);
  webglLayer.line(-235, 0, 0, 235, 0, 0);
  webglLayer.line(0, -235, 0, 0, 235, 0);
}

// ─── Equipotentials ───────────────────────────────────────────────────────────
// Level sets of Im(z²) = 2xy = c — true complex analysis geometry.
function drawEquipotentials(t) {
  const levels = [-3, -2, -1, 1, 2, 3];
  for (let li = 0; li < levels.length; li++) {
    const c      = levels[li];
    const accent = li === 2 || li === 3;
    inkStroke(accent ? 96 : 40, li % 4);
    webglLayer.strokeWeight(accent ? 0.82 : 0.34);
    webglLayer.beginShape();
    let first = true;
    for (let i = 0; i <= 340; i++) {
      const xn = -1.72 + i * (3.44 / 340);
      if (Math.abs(xn) < 0.04) {
        first = true; webglLayer.endShape(); webglLayer.beginShape(); continue;
      }
      const yn = c / (2 * xn);
      if (Math.abs(yn * 88) > 175) {
        first = true; webglLayer.endShape(); webglLayer.beginShape(); continue;
      }
      const warp = 0.030 * Math.sin(t * 0.7 * PHI + li * PHI + i * 0.035);
      const br   = 1 + 0.018 * Math.sin(t * 0.9 + li * 1.2);
      const pr   = worldPoint(xn * (1 + warp) * br, yn * (1 + warp) * br, t, 88);
      if (first) { webglLayer.vertex(pr.x, pr.y, pr.z * 0.32); first = false; }
      else          webglLayer.vertex(pr.x, pr.y, pr.z * 0.32);
    }
    webglLayer.endShape();
  }
}

// ─── Quasicrystal field ───────────────────────────────────────────────────────
function drawQuasicrystalField(t) {
  for (let i = 0; i < qcLattice.length; i++) {
    const node  = qcLattice[i];
    const wave  = Math.sin(t * 0.8 + node.ring * 0.42 + node.index * 0.07);
    const theta = node.theta + 0.052 * wave;
    const r     = node.radius + 0.032 * Math.sin(t * SQ2 + node.index * 0.10);
    const pt    = worldPoint(r * Math.cos(theta), r * Math.sin(theta), t, 96);
    const alpha = map(node.ring, 1, 8, 150, 30);
    const sw    = map(node.ring, 1, 8, 1.02, 0.36);

    inkStroke(alpha, node.ci);
    webglLayer.strokeWeight(sw);
    webglLayer.line(pt.x, pt.y, -22, pt.x, pt.y, pt.z);

    if (node.index % Math.max(2, Math.floor(node.count / 7)) === 0) {
      inkStroke(alpha * 0.80, node.ci);
      webglLayer.strokeWeight(1.04);
      webglLayer.point(pt.x, pt.y, pt.z + 1.4);
    }
  }
}

// ─── Orbital rings ────────────────────────────────────────────────────────────
function drawOrbitalRings(t) {
  for (let ring = 0; ring < 5; ring++) {
    const rr    = 50 + ring * 36;
    const zBase = -10 + ring * 9;
    const twist = t * (0.13 + ring * 0.026) + ring * 0.62;
    const alpha = map(ring, 0, 4, 166, 54);

    webglLayer.push();
    webglLayer.rotateZ(twist);
    webglLayer.rotateX(0.026 * Math.sin(t * 0.8 + ring));
    inkStroke(alpha, ring);
    webglLayer.strokeWeight(ring === 0 ? 1.32 : 0.78);
    webglLayer.beginShape();
    for (let i = 0; i <= 280; i++) {
      const u      = i / 280;
      const th     = u * TAU;
      const lobes  = 1 + 0.048 * Math.sin(th * 5 + t * 0.9 + ring);
      const shimmer= 1 + 0.018 * Math.sin(th * 11 - t * 1.2 + ring);
      webglLayer.vertex(
        Math.cos(th) * rr * lobes * shimmer,
        Math.sin(th) * rr * lobes * shimmer,
        zBase + 8 * Math.sin(th * 3 + t * 0.6 + ring)
      );
    }
    webglLayer.endShape();
    webglLayer.pop();
  }
}

// ─── Möbius ribbon ────────────────────────────────────────────────────────────
// 6 cross-section bands, one half-twist per loop. Topologically correct.
function drawMobiusRibbon(t) {
  const bands  = 6;
  const W_half = 12;

  for (let b = 0; b < bands; b++) {
    const v  = lerp(-W_half, W_half, b / (bands - 1));
    const al = map(Math.abs(v), 0, W_half, 90, 44);
    inkStroke(al, b % 4);
    webglLayer.strokeWeight(0.58);
    webglLayer.beginShape();
    for (let i = 0; i <= 260; i++) {
      const u     = i / 260;
      const s     = u * TAU + t * 0.30;
      const twist = s / 2;
      const R     = 155;
      const x     = (R + v * Math.cos(twist)) * Math.cos(s);
      const y     = (R + v * Math.cos(twist)) * Math.sin(s);
      const z     = v * Math.sin(twist) + 11 * Math.sin(s * 2.6 + t * 0.68);
      webglLayer.vertex(x * 0.70, y * 0.70, z);
    }
    webglLayer.endShape();
  }
}

// ─── Particles ────────────────────────────────────────────────────────────────
function drawParticles(t) {
  for (let i = 0; i < particles.length; i++) {
    const p0    = particles[i];
    const angle = p0.angle + t * (0.042 + p0.lane * 0.006);
    const r     = p0.radius + 0.042 * Math.sin(t * 0.8 + i * 0.10);
    const pt    = worldPoint(r * Math.cos(angle), r * Math.sin(angle), t, 96);
    inkStroke(map(r, 0, 2.1, 130, 34, true), p0.ci);
    webglLayer.strokeWeight(p0.size * 0.42);
    webglLayer.point(pt.x, pt.y, pt.z + 12 * p0.lift);
  }
}

// ─── Origin interference ──────────────────────────────────────────────────────
// Two pulse families at freq ratio PHI — beat continuously, never phase-lock.
function drawOriginSignal(t) {
  webglLayer.push();
  webglLayer.translate(0, 0, 12 * Math.sin(t * 0.8));

  for (let i = 0; i < 6; i++) {
    const ph = t * 0.85 + i * (TAU / 6);
    const r  = 10 + i * 10 + 4.5 * Math.sin(ph);
    const al = Math.max(0, map(Math.cos(ph), -1, 1, 18, 178 - i * 22));
    inkStroke(al, i);
    webglLayer.strokeWeight(1.28 - i * 0.13);
    webglLayer.circle(0, 0, r * 2);
  }

  for (let i = 0; i < 4; i++) {
    const ph = t * 0.85 * PHI + i * (TAU / 4);
    const r  = 16 + i * 14 + 5 * Math.sin(ph * 1.1);
    const al = Math.max(0, map(Math.cos(ph), -1, 1, 8, 85 - i * 16));
    inkStroke(al, (i + 2) % 4);
    webglLayer.strokeWeight(0.50);
    webglLayer.circle(0, 0, r * 2);
  }

  inkStroke(222, 0);
  webglLayer.strokeWeight(1.9);
  webglLayer.point(0, 0, 0);
  webglLayer.pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(la, loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');

  fill(255, 255, 255, 185);
  textSize(13);
  textAlign(LEFT, TOP);
  text('GAUSS PLANE  ·  z² FIELD', 52, 54);

  fill(255, 255, 255, 90);
  textSize(10);
  text(useBio ? 'BIO-SYNTHETIC PALETTE' : 'z = x + iy  |  Im(z²) = 2xy', 52, 74);

  const phase = (loop).toFixed(3);

  fill(255, 255, 255, 100);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text('r = sqrt(x²+y²)    θ = atan2(y,x)    phase = ' + phase, 52, H - 54);

  textAlign(RIGHT, BOTTOM);
  fill(255, 255, 255, 72);
  text('20260424 · rotating complex plane', W - 52, H - 54);

  // Loop progress bar
  const barW = (W - 104) * loop;
  noFill();
  stroke(255, 255, 255, 34);
  strokeWeight(1);
  line(52, H - 36, W - 52, H - 36);
  stroke(255, 255, 255, 108);
  line(52, H - 36, 52 + barW, H - 36);

  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push();
  noFill();
  stroke(255, 255, 255, 66);
  strokeWeight(0.9);
  const m = 32, L = 28;
  line(m,     m,     m + L, m    );  line(m,     m,     m,     m + L);
  line(W - m, m,     W-m-L, m    );  line(W - m, m,     W - m, m + L);
  line(m,     H - m, m + L, H - m);  line(m,     H - m, m,     H-m-L);
  line(W - m, H - m, W-m-L, H - m);  line(W - m, H - m, W - m, H-m-L);
  pop();
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function renderGrain() {
  if (!grainLayer) return;
  grainLayer.clear();
  grainLayer.noStroke();
  const count = floor(W * H * 0.0011);
  for (let i = 0; i < count; i++) {
    const v = random(60, 210);
    grainLayer.fill(v, v, v, random(3, 12));
    grainLayer.circle(random(W), random(H), random(0.3, 1.4));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 60;
  const maxR  = dist(W / 2, H / 2, 0, 0) * 1.08;
  const sw    = (maxR / steps) * 2 + 2;
  strokeWeight(sw);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.78, 1.0, 0, 95, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() {
  reseedPattern(floor(random(100000)));
}

function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('20260424_gauss_plane_' + timestampString(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseedPattern(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome or Edge.'); return; }
  if (typeof Mp4Muxer    === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video:  { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });

  encoder.configure({
    codec:     'avc1.640028',
    width:     W,
    height:    H,
    bitrate:   18_000_000,
    framerate: FPS,
  });

  recFrameCount = 0;
  isRecording   = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording…', '#fff');
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
  a.href     = url;
  a.download = '20260424_gauss_plane_' + timestampString() + '.mp4';
  a.click();

  encoder.close();
  encoder = null;
  muxer   = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);

  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color  = color;
}
function updateRecordingUI() {
  const dEl = document.getElementById('duration');
  const fEl = document.getElementById('frameCount');
  if (dEl) dEl.textContent = (recFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent  = recFrameCount;
}
function updateCanvasInfo() {
  const el = document.getElementById('canvasSize');
  if (el) el.textContent = W + ' × ' + H;
}
function timestampString() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_`
       + `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}
'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 16;

// ─── Math constants ───────────────────────────────────────────────────────────
const PHI   = 1.61803398875;
const TAU   = Math.PI * 2;
const SQRT3 = Math.sqrt(3);

// ─── Layers ───────────────────────────────────────────────────────────────────
let webglLayer = null;
let grainLayer = null;
let canvasEl   = null;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Seed ─────────────────────────────────────────────────────────────────────
let seedPhase = 0;
let hexCenters = [];

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  webglLayer = createGraphics(W, H, WEBGL);
  webglLayer.pixelDensity(1);
  webglLayer.colorMode(RGB, 255, 255, 255, 255);
  webglLayer.noFill();
  webglLayer.strokeCap(ROUND);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseed(floor(random(100000)));

  document.getElementById('maxDuration').textContent = MAX_DURATION;
  document.getElementById('canvasSize').textContent  = W + ' × ' + H;
}

function reseed(s) {
  randomSeed(s);
  noiseSeed(s);
  seedPhase = random(TAU);
  buildHexCenters();
}

function buildHexCenters() {
  const R = 130, LAYERS = 3;
  const seen = new Map();
  const add = (qf, rf) => {
    const q = Math.round(qf), r = Math.round(rf);
    const key = q * 10000 + r;
    if (seen.has(key)) return;
    const [cx, cy] = axialToXY(q, r, R);
    const d = Math.hypot(cx, cy);
    seen.set(key, { cx, cy, layer: Math.round(d / R), theta: Math.atan2(cy, cx), d });
  };
  add(0, 0);
  for (let L = 1; L <= LAYERS; L++)
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < L; j++) {
        const [dq, dr] = hexRingStep(i, j, L);
        add(dq, dr);
      }
  hexCenters = [...seen.values()];
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const t    = loop * TAU;

  background(0);
  drawCenterGlow();
  renderScene(t, loop);

  push(); tint(255, 6); image(grainLayer, 0, 0); noTint(); pop();

  drawCornerBrackets();
  drawFormulaHUD(t, loop);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    document.getElementById('duration').textContent   = (recFrameCount / FPS).toFixed(1);
    document.getElementById('frameCount').textContent = recFrameCount;
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Scene ────────────────────────────────────────────────────────────────────
function renderScene(t, loop) {
  webglLayer.clear();
  webglLayer.push();
  webglLayer.background(0, 0, 0, 0);
  webglLayer.noFill();

  // 非常にゆっくりしたカメラ呼吸のみ — ドラマなし
  const camZ = 1420 + 60 * Math.sin(t * 0.25 + seedPhase);
  webglLayer.camera(0, 0, camZ, 0, 0, 0, 0, 1, 0);
  webglLayer.perspective(Math.PI / 4.8, W / H, 0.1, 8000);

  // Master breath — whole mandala inhales and exhales as one organism
  const masterBreath = 1 + 0.018 * Math.sin(t * 0.7);
  webglLayer.scale(masterBreath);

  webglLayer.push();
  webglLayer.rotateZ(-t * 0.55);
  drawLightRays(t);
  drawOuterDots(t);
  webglLayer.pop();

  webglLayer.push();
  webglLayer.rotateZ(t * 0.95);
  drawHaloRings(t);
  drawFlowerOfLife(t);
  drawLotusPetals(t);
  drawDevaLights(t);
  webglLayer.pop();

  webglLayer.push();
  webglLayer.rotateZ(-t * 0.45);
  drawSriYantra(t);
  drawVesicaPiscis(t);
  drawSeedOfLife(t);
  drawBindu(t);
  webglLayer.pop();

  webglLayer.pop();
  image(webglLayer, 0, 0);
}

// ─── Halo rings ───────────────────────────────────────────────────────────────
// 静かに呼吸するだけ。パルスなし。
function drawHaloRings(t) {
  const rings = [
    { r: 310, alpha: 42, sw: 0.55 },
    { r: 400, alpha: 28, sw: 0.38 },
    { r: 510, alpha: 18, sw: 0.32 },
    { r: 640, alpha: 11, sw: 0.28 },
    { r: 800, alpha:  6, sw: 0.22 },
  ];
  webglLayer.push();
  for (let i = 0; i < rings.length; i++) {
    const { r, alpha, sw } = rings[i];
    // 各リングが少しずつ異なる位相でゆっくり呼吸
    const breath = 1 + 0.008 * Math.sin(t * 0.9 + i * 1.1);
    webglLayer.stroke(255, 255, 255, alpha);
    webglLayer.strokeWeight(sw);
    drawCircle2D(0, 0, r * breath);
    // グロー（一段階のみ・薄く）
    webglLayer.stroke(255, 255, 255, alpha * 0.22);
    webglLayer.strokeWeight(sw + 2.5);
    drawCircle2D(0, 0, r * breath);
  }
  webglLayer.pop();
}

// ─── Flower of Life ───────────────────────────────────────────────────────────
// 各円が φ 位相でゆっくり呼吸。高周波成分なし。
function drawFlowerOfLife(t) {
  const R = 130;
  webglLayer.push();
  hexCenters.forEach(({ cx, cy, layer, theta }) => {
    // 呼吸はとても穏やか（振幅0.018、周期 φ で割ってさらにゆっくり）
    const breath = 1 + 0.018 * Math.sin(t / PHI + theta * 1.4);
    const r      = R * breath;

    const bodyAlpha = layer === 0 ? 185 : layer === 1 ? 120 : layer === 2 ? 60 : 22;
    const glowAlpha = bodyAlpha * 0.16;

    // グロー
    webglLayer.stroke(255, 255, 255, glowAlpha);
    webglLayer.strokeWeight(3.5);
    drawCircle2D(cx, cy, r);

    // ボディ
    webglLayer.stroke(255, 255, 255, bodyAlpha);
    webglLayer.strokeWeight(layer === 0 ? 1.0 : layer === 1 ? 0.65 : 0.40);
    drawCircle2D(cx, cy, r);

    // シャープエッジ
    webglLayer.stroke(255, 255, 255, Math.min(255, bodyAlpha * 1.3));
    webglLayer.strokeWeight(0.25);
    drawCircle2D(cx, cy, r * 0.994);
  });
  webglLayer.pop();
}

// ─── Sri Yantra ───────────────────────────────────────────────────────────────
// 各ティアが独自の一定速度でゆっくり回転するだけ。フラッシュなし。
// 速度は φ の冪で割って、常に非公約数 → 永遠に同じ形にならない。
function drawSriYantra(t) {
  const tiers = [
    { r: 245, dir:  1, al: 32 },
    { r: 210, dir: -1, al: 42 },
    { r: 175, dir:  1, al: 54 },
    { r: 145, dir: -1, al: 66 },
    { r: 116, dir:  1, al: 80 },
    { r:  90, dir: -1, al: 98 },
    { r:  67, dir:  1, al: 118 },
    { r:  46, dir: -1, al: 142 },
    { r:  28, dir:  1, al: 170 },
  ];

  webglLayer.push();

  for (let i = 0; i < tiers.length; i++) {
    const { r, dir, al } = tiers[i];
    // 各ティアの回転速度: 一定、ゆっくり、互いに素
    const omega = dir * 0.35 / Math.pow(PHI, i * 0.3);
    const rot   = omega * t + i * (TAU / 9);
    const baseA = dir === 1 ? -Math.PI / 2 : Math.PI / 2;

    webglLayer.push();
    webglLayer.rotateZ(rot);

    // グロー
    webglLayer.stroke(255, 255, 255, al * 0.14);
    webglLayer.strokeWeight(3.5);
    webglLayer.beginShape();
    for (let v = 0; v <= 3; v++) {
      const a = baseA + (v / 3) * TAU;
      webglLayer.vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    webglLayer.endShape();

    // ボディ
    webglLayer.stroke(255, 255, 255, al);
    webglLayer.strokeWeight(0.60);
    webglLayer.beginShape();
    for (let v = 0; v <= 3; v++) {
      const a = baseA + (v / 3) * TAU;
      webglLayer.vertex(Math.cos(a) * r, Math.sin(a) * r, 0);
    }
    webglLayer.endShape();

    // エッジ
    webglLayer.stroke(255, 255, 255, Math.min(255, al * 1.35));
    webglLayer.strokeWeight(0.25);
    webglLayer.beginShape();
    for (let v = 0; v <= 3; v++) {
      const a = baseA + (v / 3) * TAU;
      webglLayer.vertex(Math.cos(a) * r * 0.996, Math.sin(a) * r * 0.996, 0);
    }
    webglLayer.endShape();

    webglLayer.pop();
  }

  // ロータスリング
  webglLayer.stroke(255, 255, 255, 50);
  webglLayer.strokeWeight(0.50);
  drawCircle2D(0, 0, 268);
  webglLayer.stroke(255, 255, 255, 12);
  webglLayer.strokeWeight(3.0);
  drawCircle2D(0, 0, 268);

  webglLayer.pop();
}

// ─── Seed of Life ─────────────────────────────────────────────────────────────
// 7 circles at the absolute center — the genesis geometry.
// Counter-rotates against Vesica Piscis for cross-rotation depth.
function drawSeedOfLife(t) {
  const r = 14, offset = 14;
  webglLayer.push();
  webglLayer.rotateZ(-t * 1.2);

  const centers = [[0, 0]];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    centers.push([Math.cos(a) * offset, Math.sin(a) * offset]);
  }

  centers.forEach(([cx, cy], i) => {
    const breath = 1 + 0.025 * Math.sin(t * 0.6 + i * (TAU / 6));
    const cr = r * breath;

    webglLayer.stroke(255, 255, 255, 22);
    webglLayer.strokeWeight(4.0);
    drawCircle2D(cx, cy, cr);

    webglLayer.stroke(255, 255, 255, i === 0 ? 200 : 140);
    webglLayer.strokeWeight(0.65);
    drawCircle2D(cx, cy, cr);

    webglLayer.stroke(255, 255, 255, i === 0 ? 255 : 180);
    webglLayer.strokeWeight(0.22);
    drawCircle2D(cx, cy, cr * 0.993);
  });

  webglLayer.pop();
}

// ─── Bindu ────────────────────────────────────────────────────────────────────
// Star-glow radiating point — the dimensionless source of all form.
function drawBindu(t) {
  webglLayer.push();

  // expanding breath rings
  for (let i = 0; i < 3; i++) {
    const ph = (t * 0.60 + i * (TAU / 3)) % TAU;
    const k  = (Math.sin(ph) + 1) / 2;
    const r  = lerp(4, 52, k);
    const al = 80 * (1 - k);
    webglLayer.stroke(255, 255, 255, al);
    webglLayer.strokeWeight(0.45);
    drawCircle2D(0, 0, r);
  }

  // star glow — 4 concentric halos
  const halos = [
    { r: 38, al: 18, sw: 0.5 },
    { r: 18, al: 50, sw: 1.0 },
    { r:  8, al: 120, sw: 2.0 },
    { r:  3, al: 255, sw: 3.5 },
  ];
  halos.forEach(({ r, al, sw }) => {
    webglLayer.stroke(255, 255, 255, al);
    webglLayer.strokeWeight(sw);
    webglLayer.point(0, 0, 0);
    drawCircle2D(0, 0, r);
  });

  webglLayer.pop();
}

// ─── Divine light rays ────────────────────────────────────────────────────────
// 12 rays (zodiac/cosmic completeness). Drawn first, sit behind everything.
// Rotate very slowly — feels eternal compared to the faster inner forms.
function drawLightRays(t) {
  const N = 12, maxLen = 720;
  webglLayer.push();
  webglLayer.rotateZ(t * 0.018);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    for (let j = 0; j < 3; j++) {
      const sw  = [4.5, 1.8, 0.5][j];
      const al  = [5,   11,  20][j];
      webglLayer.stroke(255, 255, 255, al);
      webglLayer.strokeWeight(sw);
      webglLayer.line(0, 0, Math.cos(a) * maxLen, Math.sin(a) * maxLen);
    }
  }
  webglLayer.pop();
}

// ─── 108 outer dots ───────────────────────────────────────────────────────────
// 108 = sacred dharmic number (Sun/Moon distance:diameter ratio ≈ 108).
// Static ring; global rotation carries them — no per-dot animation needed.
function drawOuterDots(t) {
  const N = 108, ringR = 860;
  webglLayer.push();
  webglLayer.stroke(255, 255, 255, 72);
  webglLayer.strokeWeight(2.2);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU;
    webglLayer.point(Math.cos(a) * ringR, Math.sin(a) * ringR, 0);
  }
  // faint ring connecting them
  webglLayer.stroke(255, 255, 255, 14);
  webglLayer.strokeWeight(0.4);
  drawCircle2D(0, 0, ringR);
  webglLayer.pop();
}

// ─── 8-petal lotus ────────────────────────────────────────────────────────────
// Ashta-dala padma — canonical Sri Yantra outer ring. Each petal is a lens
// (two arcs) pointing outward. Rotates contemplatively at t * 0.04.
function drawLotusPetals(t) {
  const N = 8, petalR = 62, orbitR = 298;
  webglLayer.push();
  webglLayer.rotateZ(t * 0.04);

  for (let i = 0; i < N; i++) {
    const a   = (i / N) * TAU;
    const pcx = Math.cos(a) * orbitR;
    const pcy = Math.sin(a) * orbitR;

    webglLayer.push();
    webglLayer.translate(pcx, pcy, 0);
    webglLayer.rotateZ(a + Math.PI / 2);

    const offset = petalR * 0.52;

    // Glow
    webglLayer.stroke(255, 255, 255, 16);
    webglLayer.strokeWeight(4.5);
    drawCircle2D( offset, 0, petalR);
    drawCircle2D(-offset, 0, petalR);

    // Body
    webglLayer.stroke(255, 255, 255, 88);
    webglLayer.strokeWeight(0.55);
    drawCircle2D( offset, 0, petalR);
    drawCircle2D(-offset, 0, petalR);

    // Crisp edge
    webglLayer.stroke(255, 255, 255, 118);
    webglLayer.strokeWeight(0.22);
    drawCircle2D( offset, 0, petalR * 0.995);
    drawCircle2D(-offset, 0, petalR * 0.995);

    webglLayer.pop();
  }
  webglLayer.pop();
}

// ─── Deva lights ──────────────────────────────────────────────────────────────
// 3 bright focal points orbiting the lotus ring at φ-spaced angles.
// The eye latches onto their motion against the static structure.
function drawDevaLights(t) {
  const orbitR = 298;
  webglLayer.push();
  for (let i = 0; i < 3; i++) {
    const a = t * 0.28 + i * (TAU / PHI);
    const px = Math.cos(a) * orbitR;
    const py = Math.sin(a) * orbitR;

    // outer glow
    webglLayer.stroke(255, 255, 255, 18);
    webglLayer.strokeWeight(14);
    webglLayer.point(px, py, 0);

    // mid glow
    webglLayer.stroke(255, 255, 255, 55);
    webglLayer.strokeWeight(6);
    webglLayer.point(px, py, 0);

    // bright core
    webglLayer.stroke(255, 255, 255, 230);
    webglLayer.strokeWeight(2.5);
    webglLayer.point(px, py, 0);
  }
  webglLayer.pop();
}

// ─── Center glow (2D, static radial light) ───────────────────────────────────
function drawCenterGlow() {
  push();
  noFill();
  const cx = W / 2, cy = H / 2;
  const layers = 40, maxR = 340;
  for (let i = layers; i > 0; i--) {
    const k = i / layers;
    const r = maxR * k;
    const a = Math.pow(1 - k, 2.2) * 22;
    if (a < 0.5) continue;
    stroke(255, 255, 255, a);
    strokeWeight(3);
    circle(cx, cy, r * 2);
  }
  pop();
}

// ─── Vesica Piscis (WEBGL, inside Sri Yantra) ────────────────────────────────
// Two overlapping circles, intersection arcs only — the primordial sacred lens.
function drawVesicaPiscis(t) {
  const breath = 1 + 0.045 * Math.sin(t * 0.5);
  const r = 82 * breath;
  const offset = r * 0.5;

  webglLayer.push();
  webglLayer.rotateZ(t * 0.85);

  // Glow pass
  webglLayer.stroke(255, 255, 255, 18);
  webglLayer.strokeWeight(4.5);
  drawCircle2D( offset, 0, r);
  drawCircle2D(-offset, 0, r);

  // Body
  webglLayer.stroke(255, 255, 255, 95);
  webglLayer.strokeWeight(0.55);
  drawCircle2D( offset, 0, r);
  drawCircle2D(-offset, 0, r);

  // Crisp edge
  webglLayer.stroke(255, 255, 255, 130);
  webglLayer.strokeWeight(0.22);
  drawCircle2D( offset, 0, r * 0.995);
  drawCircle2D(-offset, 0, r * 0.995);

  webglLayer.pop();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function axialToXY(q, r, size) {
  return [size * (3 / 2 * q), size * (SQRT3 / 2 * q + SQRT3 * r)];
}
function hexRingStep(i, j, L) {
  const dirs = [[1,-1],[1,0],[0,1],[-1,1],[-1,0],[0,-1]];
  const s = [dirs[(i + 4) % 6][0] * L, dirs[(i + 4) % 6][1] * L];
  return [s[0] + dirs[i][0] * j, s[1] + dirs[i][1] * j];
}
function drawCircle2D(cx, cy, r, segs = 80) {
  webglLayer.beginShape();
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * TAU;
    webglLayer.vertex(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0);
  }
  webglLayer.endShape();
}

// ─── Formula HUD ──────────────────────────────────────────────────────────────
function drawFormulaHUD(t, loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');

  fill(255, 255, 255, 180);
  textSize(13);
  textAlign(LEFT, TOP);
  text('SACRED GEOMETRY  ·  B&W', 52, 52);

  const formulas = [
    'Flower of Life:  r(t) = R·(1 + 0.018·sin(t/φ + θᵢ))',
    'Golden ratio:    φ = (1+√5)/2 ≈ ' + PHI.toFixed(8),
    'Sri Yantra:      9 △  Śiva↑(4) ∩ Śakti↓(5)  =  bindu',
    'Rotation:        ωᵢ = ±0.012 / φ^(i·0.3)',
  ];
  const idx0 = Math.floor(loop * formulas.length);
  const idx1 = (idx0 + 1) % formulas.length;
  const frac  = (loop * formulas.length) % 1;

  fill(255, 255, 255, 100 * (1 - frac));
  textSize(10);
  text(formulas[idx0], 52, 76);
  fill(255, 255, 255, 100 * frac);
  text(formulas[idx1], 52, 76);

  fill(255, 255, 255, 65);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text('φ=' + PHI.toFixed(6) + '   loop=' + loop.toFixed(3), 52, H - 52);

  textAlign(RIGHT, BOTTOM);
  text('20260501 · 108 · ॐ · φ', W - 52, H - 52);


  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push();
  noFill();
  stroke(255, 255, 255, 55);
  strokeWeight(0.8);
  const m = 32, L = 26;
  line(m, m, m+L, m);   line(m, m, m, m+L);
  line(W-m, m, W-m-L, m); line(W-m, m, W-m, m+L);
  line(m, H-m, m+L, H-m); line(m, H-m, m, H-m-L);
  line(W-m, H-m, W-m-L, H-m); line(W-m, H-m, W-m, H-m-L);
  pop();
}

// ─── Film grain ───────────────────────────────────────────────────────────────
function renderGrain() {
  grainLayer.clear();
  grainLayer.noStroke();
  const count = floor(W * H * 0.0008);
  for (let i = 0; i < count; i++) {
    const v = random(80, 200);
    grainLayer.fill(v, v, v, random(2, 8));
    grainLayer.circle(random(W), random(H), random(0.3, 1.2));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 60;
  const maxR  = dist(W/2, H/2, 0, 0) * 1.08;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.80, 1.0, 0, 100, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W/2, H/2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(floor(random(100000))); }
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('20260501_sacred_' + ts(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseed(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome or Edge.'); return; }
  if (typeof Mp4Muxer    === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
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
  a.href = url; a.download = '20260501_sacred_' + ts() + '.mp4'; a.click();
  encoder.close();
  encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(t, c) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = t; el.style.color = c;
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_`
       + `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

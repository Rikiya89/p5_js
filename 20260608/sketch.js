'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS          = 60;
const MAX_DURATION = 30;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 30;

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;

// ─── Existing monochrome palette ─────────────────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

// ─── Artwork parameters ──────────────────────────────────────────────────────
const PARAMS = {
  symmetryCount: 12,
  layerCount: 9,
  rotationSpeed: 1.0,
  breathingAmplitude: 0.062,
  lineThickness: 1.38,
  geometryScale: 1.02,
  glowStrength: 0.90,
  animationSpeed: 1.0,
  pulseStrength: 0.42,
  sweepStrength: 0.72,
  orbitCount: 24,
  verticalSpread: 1.26,
};

const CENTER_X = W * 0.5;
const CENTER_Y = H * 0.50;
const BASE_RADIUS = W * 0.47 * PARAMS.geometryScale;

let pg;        // crisp line pass
let glowPg;    // soft glow pass
let halfPg;    // half-res scratch for blurred glow
let grainPg;   // baked film grain, composited once per frame
let canvasEl = null;

let flowerCenters = [];
let metatronNodes = [];
let metatronLines = [];
let goldenAngles = [];
let roseAngles = [];
let lissajousT = [];
let polygonRadii = [];
let currentSeed = 0;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);

  glowPg = createGraphics(W, H);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);

  // Half-res buffer for cheap blur: draw glowPg scaled down then back up.
  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  halfPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  grainPg.colorMode(RGB, 255, 255, 255, 255);

  precomputeSacredGeometry();
  reseed(20260608);

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(s) {
  currentSeed = s;
  randomSeed(s);
  noiseSeed(s);
  bakeGrain();
}

// ─── Precomputed Geometry ────────────────────────────────────────────────────
function precomputeSacredGeometry() {
  flowerCenters = [];
  metatronNodes = [];
  metatronLines = [];
  goldenAngles = [];
  roseAngles = [];
  lissajousT = [];
  polygonRadii = [];

  // Flower of Life: hex-lattice circle centers, stored normalized.
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= 2) {
        flowerCenters.push({
          x: q + r * 0.5,
          y: r * Math.sqrt(3) * 0.5,
          ring: Math.max(Math.abs(q), Math.abs(r), Math.abs(s)),
        });
      }
    }
  }

  // Metatron's Cube: center plus two hexagonal rings, then all near chords.
  metatronNodes.push({ x: 0, y: 0, ring: 0 });
  for (let ring = 1; ring <= 2; ring++) {
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      metatronNodes.push({
        x: Math.cos(a) * ring,
        y: Math.sin(a) * ring,
        ring,
      });
    }
  }

  for (let i = 0; i < metatronNodes.length; i++) {
    for (let j = i + 1; j < metatronNodes.length; j++) {
      const dx = metatronNodes[i].x - metatronNodes[j].x;
      const dy = metatronNodes[i].y - metatronNodes[j].y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= 2.05 || Math.abs(d - Math.sqrt(3)) < 0.05 || Math.abs(d - Math.sqrt(7)) < 0.05) {
        metatronLines.push({ a: i, b: j, d });
      }
    }
  }

  for (let i = 0; i <= 380; i++) roseAngles.push(i / 380 * TAU);
  for (let i = 0; i <= 540; i++) lissajousT.push(i / 540 * TAU);
  for (let i = 0; i < 250; i++) goldenAngles.push(i * TAU * (1 - 1 / PHI));
  for (let i = 0; i < PARAMS.layerCount; i++) polygonRadii.push(BASE_RADIUS * (0.20 + i * 0.064));
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  const count = floor(W * H * 0.0014);
  for (let i = 0; i < count; i++) {
    const v = random(100, 200);
    grainPg.fill(v, v, v, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.22, 0.85));
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  renderFrame(loop);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    const el = id => document.getElementById(id);
    if (el('duration'))   el('duration').textContent   = (recFrameCount / FPS).toFixed(1);
    if (el('frameCount')) el('frameCount').textContent = recFrameCount;
    const pf = document.getElementById('progressFill');
    if (pf) pf.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderFrame(loop) {
  const phase = loop * TAU * PARAMS.animationSpeed;

  pg.clear();
  glowPg.clear();

  drawSacredGeometry(glowPg, phase, true);
  drawSacredGeometry(pg, phase, false);
  composite();

  drawHUD(loop);
  drawCornerBrackets();
  drawVignette();
}

// Composite: bg -> blurred glow (screen) -> sharp lines (screen) -> grain.
function composite() {
  background(BG_R, BG_G, BG_B);

  halfPg.clear();
  halfPg.image(glowPg, 0, 0, W >> 1, H >> 1);

  drawingContext.globalCompositeOperation = 'screen';
  image(halfPg, 0, 0, W, H);
  image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 9);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

// ─── Sacred Geometry System ──────────────────────────────────────────────────
function drawSacredGeometry(g, phase, isGlow) {
  const breath = 1
    + Math.sin(phase) * PARAMS.breathingAmplitude
    + Math.sin(phase * 2) * PARAMS.breathingAmplitude * 0.22;
  const innerBreath = 1
    + Math.sin(phase + Math.PI) * PARAMS.breathingAmplitude * 0.62
    + Math.cos(phase * 3) * PARAMS.breathingAmplitude * 0.12;

  g.push();
  g.translate(CENTER_X, CENTER_Y);
  g.noFill();
  g.strokeCap(ROUND);
  g.strokeJoin(ROUND);

  drawVerticalAxis(g, phase, breath, isGlow);
  drawRadialSweep(g, phase, breath, isGlow);
  drawFlowerOfLife(g, phase, breath, isGlow);
  drawVesicaLayer(g, phase, innerBreath, isGlow);
  drawMetatronCube(g, phase, breath, isGlow);
  drawCentralSeal(g, phase, innerBreath, isGlow);
  drawLayeredPolygons(g, phase, breath, isGlow);
  drawRoseCurves(g, phase, innerBreath, isGlow);
  drawLissajousHalo(g, phase, breath, isGlow);
  drawGoldenSpirals(g, phase, breath, isGlow);
  drawOrbitingSigils(g, phase, breath, isGlow);
  drawFibonacciSeeds(g, phase, breath, isGlow);

  g.pop();
}

function applyStroke(g, isGlow, alpha, weight) {
  const a = alpha * (isGlow ? PARAMS.glowStrength : 1);
  const w = weight * PARAMS.lineThickness * (isGlow ? 6.6 : 1);
  g.stroke(INK_R, INK_G, INK_B, a);
  g.strokeWeight(w);
}

function drawVerticalAxis(g, phase, breath, isGlow) {
  const span = BASE_RADIUS * PARAMS.verticalSpread * breath;
  const nodeR = BASE_RADIUS * 0.16;
  const smallR = BASE_RADIUS * 0.072;
  const pulse = 0.88 + 0.12 * Math.sin(phase * 2);

  g.push();
  applyStroke(g, isGlow, isGlow ? 15 : 66, 0.68);

  // Portrait-frame axis: mirrored nodes extend the mandala into the 9:16 reel space.
  g.line(0, -span * 1.18, 0, span * 1.18);
  g.line(-smallR * 0.62, -span * 0.78, smallR * 0.62, -span * 0.78);
  g.line(-smallR * 0.62,  span * 0.78, smallR * 0.62,  span * 0.78);

  for (let side = -1; side <= 1; side += 2) {
    const y = side * span;
    const counter = -side * phase;

    g.push();
    g.translate(0, y);
    g.rotate(counter);
    applyStroke(g, isGlow, isGlow ? 18 : 90, 0.78);
    g.circle(0, 0, nodeR * 2 * pulse);
    g.circle(0, 0, nodeR * 1.22);

    for (let i = 0; i < PARAMS.symmetryCount; i++) {
      const a = i * TAU / PARAMS.symmetryCount;
      const r = nodeR * (0.66 + 0.16 * Math.sin(phase * 3 + i));
      g.line(Math.cos(a) * smallR, Math.sin(a) * smallR, Math.cos(a) * r, Math.sin(a) * r);
    }

    applyStroke(g, isGlow, isGlow ? 13 : 58, 0.58);
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6 + phase * side;
      const x = Math.cos(a) * nodeR * 0.58;
      const yy = Math.sin(a) * nodeR * 0.58;
      g.circle(x, yy, smallR * 1.08);
    }
    g.pop();
  }

  g.pop();
}

function drawRadialSweep(g, phase, breath, isGlow) {
  const inner = BASE_RADIUS * 0.16 * breath;
  const outer = BASE_RADIUS * 0.92 * breath;
  const ringA = BASE_RADIUS * 0.62 * breath;
  const ringB = BASE_RADIUS * 0.78 * breath;

  g.push();
  g.rotate(Math.sin(phase * 2) * 0.025);
  applyStroke(g, isGlow, isGlow ? 12 : 56, 0.66);

  // Harmonic radial sweep: cosine gates brighten each ray as the phase passes it.
  for (let i = 0; i < PARAMS.symmetryCount * 2; i++) {
    const a = i * TAU / (PARAMS.symmetryCount * 2);
    const gate = 0.5 + 0.5 * Math.cos(a * 3 - phase * 3);
    const alpha = (isGlow ? 9 : 38) * (0.22 + gate * PARAMS.sweepStrength);
    g.stroke(INK_R, INK_G, INK_B, alpha);
    g.line(Math.cos(a) * inner, Math.sin(a) * inner, Math.cos(a) * outer, Math.sin(a) * outer);
  }

  applyStroke(g, isGlow, isGlow ? 15 : 72, 0.72);
  for (let i = 0; i < PARAMS.symmetryCount; i++) {
    const a = i * TAU / PARAMS.symmetryCount + phase / PARAMS.symmetryCount;
    const span = TAU / PARAMS.symmetryCount * (0.36 + 0.12 * Math.sin(phase * 4 + i));
    const alpha = isGlow ? 10 : 52;
    g.stroke(INK_R, INK_G, INK_B, alpha);
    g.arc(0, 0, ringA * 2, ringA * 2, a - span * 0.5, a + span * 0.5);
    g.arc(0, 0, ringB * 2, ringB * 2, -a - span * 0.5, -a + span * 0.5);
  }

  g.pop();
}

function drawFlowerOfLife(g, phase, breath, isGlow) {
  const circleR = BASE_RADIUS * 0.185 * breath;
  const spacing = circleR;
  const rot = Math.sin(phase * 2) * 0.08 * PARAMS.rotationSpeed;

  g.push();
  g.rotate(rot);
  applyStroke(g, isGlow, isGlow ? 18 : 88, 1.02);

  for (let i = 0; i < flowerCenters.length; i++) {
    const c = flowerCenters[i];
    const ringFade = c.ring === 0 ? 1 : c.ring === 1 ? 0.9 : 0.54;
    const pulse = 1 + Math.sin(phase * 3 + c.ring * 0.9 + c.x * 0.4) * PARAMS.pulseStrength * 0.34;
    g.stroke(INK_R, INK_G, INK_B, (isGlow ? 22 : 96) * ringFade * pulse);
    g.circle(c.x * spacing, c.y * spacing, circleR * 2 * pulse);
  }

  g.pop();
}

function drawVesicaLayer(g, phase, breath, isGlow) {
  const r = BASE_RADIUS * 0.245 * breath;
  const offset = r * (0.47 + Math.sin(phase * 2) * 0.045);
  const rot = -phase * 2 + Math.sin(phase * 3) * 0.055 * PARAMS.rotationSpeed;

  g.push();
  g.rotate(rot);
  applyStroke(g, isGlow, isGlow ? 22 : 112, 0.92);

  // Vesica Piscis: two equal-radius circles whose centers lie on each other's circumference.
  for (let i = 0; i < PARAMS.symmetryCount; i++) {
    const a = i * TAU / PARAMS.symmetryCount;
    const x = Math.cos(a) * offset;
    const y = Math.sin(a) * offset;
    const pulse = 0.94 + 0.06 * Math.sin(phase * 4 + i * TAU / PARAMS.symmetryCount);
    g.circle(x, y, r * 2 * pulse);
  }

  g.pop();
}

function drawMetatronCube(g, phase, breath, isGlow) {
  const scale = BASE_RADIUS * 0.168 * breath;
  const rot = phase + Math.sin(phase * 2) * 0.045 * PARAMS.rotationSpeed;

  g.push();
  g.rotate(rot);
  applyStroke(g, isGlow, isGlow ? 16 : 100, 0.98);

  for (let i = 0; i < metatronLines.length; i++) {
    const ln = metatronLines[i];
    const a = metatronNodes[ln.a];
    const b = metatronNodes[ln.b];
    const nearAlpha = ln.d <= 1.1 ? 0.88 : ln.d <= 1.8 ? 0.66 : 0.38;
    const pulse = 0.76 + 0.24 * Math.sin(phase * 5 + ln.a * 0.8 + ln.b * 0.35);
    g.stroke(INK_R, INK_G, INK_B, (isGlow ? 20 : 118) * nearAlpha * pulse);
    g.line(a.x * scale, a.y * scale, b.x * scale, b.y * scale);
  }

  applyStroke(g, isGlow, isGlow ? 22 : 146, 1.02);
  for (let i = 0; i < metatronNodes.length; i++) {
    const n = metatronNodes[i];
    const d = (n.ring === 0 ? 8.8 : n.ring === 1 ? 5.8 : 4.0) * (0.88 + 0.12 * Math.sin(phase * 4 + i));
    g.circle(n.x * scale, n.y * scale, d);
  }

  g.pop();
}

function drawCentralSeal(g, phase, breath, isGlow) {
  const r0 = BASE_RADIUS * 0.070 * breath;
  const r1 = BASE_RADIUS * 0.135 * breath;
  const r2 = BASE_RADIUS * 0.205 * breath;

  g.push();
  g.rotate(-phase * 2);
  applyStroke(g, isGlow, isGlow ? 24 : 132, 1.18);

  // Concentric seal: a stable luminous anchor so thicker outer motion stays composed.
  g.circle(0, 0, r0 * 2);
  g.circle(0, 0, r1 * 2);

  applyStroke(g, isGlow, isGlow ? 16 : 86, 0.82);
  g.beginShape();
  for (let i = 0; i <= PARAMS.symmetryCount; i++) {
    const a = i * TAU / PARAMS.symmetryCount - Math.PI / 2;
    const rr = i % 2 === 0 ? r2 : r1 * 0.72;
    g.vertex(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  g.endShape();

  applyStroke(g, isGlow, isGlow ? 18 : 104, 0.76);
  for (let i = 0; i < PARAMS.symmetryCount; i++) {
    const a = i * TAU / PARAMS.symmetryCount + phase;
    const pulse = 0.78 + 0.22 * Math.sin(phase * 4 + i);
    g.line(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r2 * pulse, Math.sin(a) * r2 * pulse);
  }

  g.pop();
}

function drawLayeredPolygons(g, phase, breath, isGlow) {
  g.push();
  applyStroke(g, isGlow, isGlow ? 14 : 62, 0.82);

  for (let layer = 0; layer < polygonRadii.length; layer++) {
    const sides = 6 + layer;
    const r = polygonRadii[layer] * breath * (1 + Math.sin(phase * (layer % 3 + 1) + layer * 0.7) * 0.032);
    const direction = layer % 2 === 0 ? 1 : -1;
    const rot = direction * phase * (layer % 4 + 1) / sides + Math.sin(phase * 2 + layer) * 0.035;
    const alpha = isGlow ? 16 + layer * 2.3 : 54 + layer * 8.4;

    g.push();
    g.rotate(rot);
    g.stroke(INK_R, INK_G, INK_B, alpha);
    regularPolygon(g, sides, r);
    g.pop();
  }

  g.pop();
}

function regularPolygon(g, sides, radius) {
  g.beginShape();
  for (let i = 0; i <= sides; i++) {
    const a = i * TAU / sides - Math.PI / 2;
    g.vertex(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  g.endShape();
}

function drawRoseCurves(g, phase, breath, isGlow) {
  const kA = 5;
  const kB = 8;
  const rA = BASE_RADIUS * 0.54 * breath;
  const rB = BASE_RADIUS * 0.40 * (1 + Math.sin(phase * 2 + Math.PI * 0.5) * 0.052);

  g.push();
  g.rotate(-phase + Math.sin(phase * 3) * 0.04);
  applyStroke(g, isGlow, isGlow ? 28 : 156, 1.30);

  // Rose curve: r = a * cos(k * theta).
  g.beginShape();
  for (let i = 0; i < roseAngles.length; i++) {
    const theta = roseAngles[i];
    const r = rA * Math.cos(kA * theta + Math.sin(phase * 2) * 0.20);
    g.vertex(Math.cos(theta) * r, Math.sin(theta) * r);
  }
  g.endShape();

  applyStroke(g, isGlow, isGlow ? 18 : 94, 0.82);
  g.beginShape();
  for (let i = 0; i < roseAngles.length; i++) {
    const theta = roseAngles[i];
    const r = rB * Math.cos(kB * theta - Math.sin(phase * 3) * 0.22);
    g.vertex(Math.cos(theta) * r, Math.sin(theta) * r);
  }
  g.endShape();

  g.pop();
}

function drawLissajousHalo(g, phase, breath, isGlow) {
  const aFreq = 3;
  const bFreq = 4;
  const ax = BASE_RADIUS * 0.88 * breath;
  const by = BASE_RADIUS * 0.55 * breath;
  const delta = Math.PI / 2 + Math.sin(phase * 2) * 0.34;

  g.push();
  g.rotate(phase * 2 + Math.cos(phase * 3) * 0.025);
  applyStroke(g, isGlow, isGlow ? 20 : 104, 0.98);

  // Lissajous curve: x = A * sin(a*t + delta), y = B * sin(b*t).
  g.beginShape();
  for (let i = 0; i < lissajousT.length; i++) {
    const t = lissajousT[i];
    const x = ax * Math.sin(aFreq * t + delta);
    const y = by * Math.sin(bFreq * t);
    g.vertex(x, y);
  }
  g.endShape();

  g.pop();
}

function drawGoldenSpirals(g, phase, breath, isGlow) {
  const arms = 12;
  const maxTheta = Math.PI * 4.55;
  const b = Math.log(PHI) / (Math.PI / 2);
  const a0 = BASE_RADIUS * 0.012 * breath;

  g.push();
  applyStroke(g, isGlow, isGlow ? 21 : 100, 0.92);

  // Golden spiral: r = a * exp(b * theta), mirrored through rotational symmetry.
  for (let arm = 0; arm < arms; arm++) {
    const armRot = arm * TAU / arms + phase * (arm % 2 === 0 ? 1 : -1);
    g.beginShape();
    for (let i = 0; i <= 180; i++) {
      const theta = i / 180 * maxTheta;
      const easedTheta = theta + Math.sin(phase * 3 + arm * 0.4) * 0.070;
      const r = a0 * Math.exp(b * theta) * (1 + Math.sin(phase * 2 + theta) * 0.018);
      const x = Math.cos(easedTheta + armRot) * r;
      const y = Math.sin(easedTheta + armRot) * r;
      g.vertex(x, y);
    }
    g.endShape();
  }

  g.pop();
}

function drawOrbitingSigils(g, phase, breath, isGlow) {
  const orbitR = BASE_RADIUS * 0.50 * breath;
  const smallR = BASE_RADIUS * 0.040;
  const count = PARAMS.orbitCount;

  g.push();
  g.rotate(-phase);
  applyStroke(g, isGlow, isGlow ? 18 : 86, 0.82);

  // Small orbiting vesicas give the loop visible motion without introducing randomness.
  for (let i = 0; i < count; i++) {
    const a = i * TAU / count;
    const localPhase = phase * 4 + i * TAU / count;
    const pulse = 0.70 + 0.30 * Math.sin(localPhase);
    const x = Math.cos(a) * orbitR;
    const y = Math.sin(a) * orbitR;

    g.push();
    g.translate(x, y);
    g.rotate(a + phase * 2);
    g.stroke(INK_R, INK_G, INK_B, (isGlow ? 12 : 70) * pulse);
    g.circle(-smallR * 0.28, 0, smallR * 1.22 * pulse);
    g.circle( smallR * 0.28, 0, smallR * 1.22 * pulse);
    g.line(-smallR * 0.72, 0, smallR * 0.72, 0);
    g.pop();
  }

  g.pop();
}

function drawFibonacciSeeds(g, phase, breath, isGlow) {
  const count = goldenAngles.length;
  const maxR = BASE_RADIUS * 0.80 * breath;
  const spin = -phase + Math.sin(phase * 2) * 0.045;

  g.push();
  g.rotate(spin);
  g.noStroke();

  // Fibonacci distribution: angle = n * golden angle, radius proportional to sqrt(n).
  for (let i = 0; i < count; i++) {
    const k = i / (count - 1);
    if (k < 0.22) continue;
    const a = goldenAngles[i] + Math.sin(phase * 2 + i * 0.03) * 0.018;
    const r = Math.sqrt(k) * maxR * (1 + Math.sin(phase * 3 + i * 0.05) * 0.026);
    const pulse = 0.52 + 0.48 * Math.sin(phase * 4 + i * 0.11);
    const alpha = isGlow ? 14 * PARAMS.glowStrength * pulse : 58 * (1 - k * 0.42) * pulse;
    const d = isGlow ? 10.4 : 2.6 + (1 - k) * 2.8;
    g.fill(INK_R, INK_G, INK_B, alpha);
    g.circle(Math.cos(a) * r, Math.sin(a) * r, d);
  }

  g.pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');
  fill(255, 255, 255, 155);
  textSize(13);
  textAlign(LEFT, TOP);
  text('SACRED GEOMETRY · METATRON LOOP', 52, 52);
  fill(255, 255, 255, 70);
  textSize(10);
  text('sym=' + PARAMS.symmetryCount + '  layers=' + PARAMS.layerCount + '  loop=' + loop.toFixed(3), 52, 76);
  fill(255, 255, 255, 45);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text(W + '×' + H + ' · ' + FPS + 'fps', 52, H - 52);
  textAlign(RIGHT, BOTTOM);
  text('20260608 · SACRED GEOMETRY · B&W', W - 52, H - 52);
  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push();
  noFill();
  stroke(255, 255, 255, 42);
  strokeWeight(0.7);
  const m = 32, L = 26;
  line(m, m, m + L, m); line(m, m, m, m + L);
  line(W - m, m, W - m - L, m); line(W - m, m, W - m, m + L);
  line(m, H - m, m + L, H - m); line(m, H - m, m, H - m - L);
  line(W - m, H - m, W - m - L, H - m); line(W - m, H - m, W - m, H - m - L);
  pop();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 70, maxR = dist(W / 2, H / 2, 0, 0) * 1.10;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.72, 1.0, 0, 115, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(floor(random(100000))); }
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('sacred_geometry_' + ts(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseed(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { console.error(e); isRecording = false; setStatus('Error', '#f44'); } });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording = true;
  const el = id => document.getElementById(id);
  if (el('duration')) el('duration').textContent = '0.0';
  if (el('frameCount')) el('frameCount').textContent = '0';
  if (el('startBtn')) el('startBtn').disabled = true;
  if (el('stopBtn')) el('stopBtn').disabled = false;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Recording…', '#fff');
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus('Finalizing…', '#ccc');
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sacred_geometry_' + ts() + '.mp4';
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn')) el('stopBtn').disabled = true;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(txt, c) {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = txt;
    el.style.color = c;
  }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

'use strict';

// ─── Canvas / export ─────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS          = 60;
const MAX_DURATION = 30;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 30;

const TAU = Math.PI * 2;

// ─── Existing monochrome palette ─────────────────────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const PARAMS = {
  glowStrength:   1.18,
  animationSpeed: 1.0,
};

// ─── Gauss-plane system ────────────────────────────────────────────────────────
const FIELD = {
  GRID:             23,   // density: GRID² transformed complex points
  DOMAIN:           1.18,
  BASE_SCALE:       255,
  TRANSFORM_SCALE:  190,
  PLANE_Y:          135,
  HEIGHT_SCALE:     118,  // depth: |z²| elevation
  WAVE_HEIGHT:      32,
  CONNECTOR_STEP:   2,
  FLOW_STEP:        3,    // animated particles travelling from z to z²
  CONTOUR_COUNT:    4,    // luminous |z| contours on the transformed field
  AXIS_LENGTH:      390,
  DUST_COUNT:       130,
  CAM_RADIUS:       1120,
  CAM_HEIGHT:      -410,
  CAM_ORBIT:        1.0,  // camera revolutions per loop
  CAM_FOV:          0.80,
  FOG_NEAR:         620,
  FOG_FAR:         2500,
};

let pg, glowPg, halfPg, quartPg, eighthPg, sixteenthPg, grainPg;
let canvasEl = null;
let fieldNodes = [];
let fieldPositions = [];
let flowNodes = [];
let dustSeeds = [];
let camEye = { x: 0, y: 0, z: 0 };
const scratchPosition = { x: 0, y: 0, z: 0, argumentLight: 0, energy: 0 };

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  pg          = createGraphics(W, H, WEBGL); pg.pixelDensity(1);     pg.colorMode(RGB,255,255,255,255);
  glowPg      = createGraphics(W, H, WEBGL); glowPg.pixelDensity(1); glowPg.colorMode(RGB,255,255,255,255);
  halfPg      = createGraphics(W>>1, H>>1);  halfPg.pixelDensity(1);
  quartPg     = createGraphics(W>>2, H>>2);  quartPg.pixelDensity(1);
  eighthPg    = createGraphics(W>>3, H>>3);  eighthPg.pixelDensity(1);
  sixteenthPg = createGraphics(W>>4, H>>4);  sixteenthPg.pixelDensity(1);
  grainPg     = createGraphics(W, H);        grainPg.pixelDensity(1);

  reseed(20260715);

  const el = id => document.getElementById(id);
  if (el('startBtn'))    el('startBtn').onclick = startRecording;
  if (el('stopBtn'))     el('stopBtn').onclick  = stopRecording;
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(seed) {
  randomSeed(seed);
  noiseSeed(seed);
  bakeComplexField();
  bakeDust();
  bakeGrain();
}

// Static complex values are calculated once. Draw only updates their looped pose.
function bakeComplexField() {
  fieldNodes = [];
  fieldPositions = [];
  flowNodes = [];
  const n = FIELD.GRID;
  for (let row = 0; row < n; row++) {
    const yi = map(row, 0, n - 1, -FIELD.DOMAIN, FIELD.DOMAIN);
    for (let col = 0; col < n; col++) {
      const x = map(col, 0, n - 1, -FIELD.DOMAIN, FIELD.DOMAIN);
      const squared = complexSquare(x, yi);
      fieldNodes.push({
        x, yi,
        wr: squared.re,
        wi: squared.im,
        magnitude: complexMagnitude(squared.re, squared.im),
        argument: complexArgument(squared.re, squared.im),
        radial: Math.sqrt(x * x + yi * yi),
        row, col,
      });
      fieldPositions.push({ x: 0, y: 0, z: 0, argumentLight: 0, energy: 0 });
      if (row % FIELD.FLOW_STEP === 1 && col % FIELD.FLOW_STEP === 1) {
        flowNodes.push({ node: fieldNodes[fieldNodes.length - 1], offset: random() });
      }
    }
  }
}

function bakeDust() {
  dustSeeds = [];
  for (let i = 0; i < FIELD.DUST_COUNT; i++) {
    const az = random(TAU);
    const radius = random(470, 1050);
    dustSeeds.push({
      x: Math.cos(az) * radius,
      y: random(-440, 360),
      z: Math.sin(az) * radius,
      phase: random(TAU),
      harmonic: 1 + Math.floor(random(4)),
    });
  }
}

function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  for (let i = 0, n = Math.floor(W * H * 0.0016); i < n; i++) {
    const v = random(110, 200);
    grainPg.fill(v, v, v, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.15, 0.85));
  }
  for (let i = 0, n = Math.floor(W * H * 0.000035); i < n; i++) {
    const v = random(210, 255);
    grainPg.fill(v, v, v, random(12, 34));
    grainPg.circle(random(W), random(H), random(0.4, 1.2));
  }
}

// ─── Complex arithmetic ───────────────────────────────────────────────────────────
function complexSquare(re, im) {
  return { re: re * re - im * im, im: 2 * re * im };
}

function complexMagnitude(re, im) {
  return Math.sqrt(re * re + im * im);
}

function complexArgument(re, im) {
  return Math.atan2(im, re);
}

// z and z² share one visible trajectory. Height is |z²|; the moving
// brightness lobe and small wave are arg(z²). All terms are periodic in phase.
function transformComplex(node, phase, target = scratchPosition) {
  const morph = 0.62 + 0.16 * Math.cos(phase);
  const baseX = node.x * FIELD.BASE_SCALE;
  const baseZ = node.yi * FIELD.BASE_SCALE;
  const mappedX = node.wr * FIELD.TRANSFORM_SCALE;
  const mappedZ = node.wi * FIELD.TRANSFORM_SCALE;
  const argumentWave = Math.sin(node.argument * 2 - phase);
  const energyWave = Math.cos(TAU * node.radial / FIELD.DOMAIN - phase * 2);

  target.x = lerp(baseX, mappedX, morph);
  target.y = FIELD.PLANE_Y - node.magnitude * FIELD.HEIGHT_SCALE
             - argumentWave * FIELD.WAVE_HEIGHT - energyWave * 10;
  target.z = lerp(baseZ, mappedZ, morph);
  target.argumentLight = 0.5 + 0.5 * Math.cos(node.argument - phase);
  target.energy = 0.5 + 0.5 * energyWave;
  return target;
}

function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const progress = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  renderFrame(progress);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderFrame(progress) {
  const phase = progress * TAU * PARAMS.animationSpeed;
  pg.clear();
  glowPg.clear();
  prepBuffer(pg, phase);
  prepBuffer(glowPg, phase);
  drawScene(glowPg, phase, true);
  drawScene(pg, phase, false);
  composite(phase);
  drawHUD(progress);
  drawCornerBrackets();
  drawVignette();
}

function prepBuffer(g, phase) {
  g.blendMode(ADD);
  g.drawingContext.enable(g.drawingContext.DEPTH_TEST);
  updateCamera(g, phase);
}

function updateCamera(g, phase) {
  const azimuth = phase * FIELD.CAM_ORBIT - Math.PI * 0.22;
  const radius = FIELD.CAM_RADIUS + 42 * Math.cos(phase * 2);
  camEye.x = Math.cos(azimuth) * radius;
  camEye.y = FIELD.CAM_HEIGHT + 34 * Math.sin(phase * 2);
  camEye.z = Math.sin(azimuth) * radius;
  g.perspective(FIELD.CAM_FOV, W / H, 10, 5000);
  const roll = 0.018 * Math.sin(phase);
  g.camera(camEye.x, camEye.y, camEye.z, 0, -55, 0, roll, 1, 0);
}

function fogFactor(x, y, z) {
  const dx = x - camEye.x, dy = y - camEye.y, dz = z - camEye.z;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const t = constrain((distance - FIELD.FOG_NEAR) / (FIELD.FOG_FAR - FIELD.FOG_NEAR), 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

function drawScene(g, phase, isGlow) {
  drawAtmosphere(g, phase, isGlow);
  drawBasePlane(g, phase, isGlow);
  drawTransformationLinks(g, phase, isGlow);
  drawComplexField(g, phase, isGlow);
  drawMagnitudeContours(g, phase, isGlow);
  drawTransformationFlow(g, phase, isGlow);
  drawAxes(g, phase, isGlow);
  drawOrigin(g, phase, isGlow);
}

function drawBasePlane(g, phase, isGlow) {
  const n = FIELD.GRID;
  const planeAlpha = isGlow ? 3 : 15;
  const axis = FIELD.DOMAIN * FIELD.BASE_SCALE;
  g.push();
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, planeAlpha);
  g.strokeWeight(isGlow ? 3.2 : 0.8);
  for (let i = 0; i < n; i++) {
    const p = map(i, 0, n - 1, -axis, axis);
    g.line(-axis, FIELD.PLANE_Y, p, axis, FIELD.PLANE_Y, p);
    g.line(p, FIELD.PLANE_Y, -axis, p, FIELD.PLANE_Y, axis);
  }

  // Radial energy wave makes the original Gaussian plane visibly alive.
  const ringCount = 4;
  for (let ring = 0; ring < ringCount; ring++) {
    const radius = ((phase / TAU + ring / ringCount) % 1) * axis * 1.2;
    const fade = 1 - radius / (axis * 1.2);
    g.stroke(INK_R, INK_G, INK_B, (isGlow ? 12 : 36) * fade);
    g.strokeWeight(isGlow ? 6 : 1.4);
    g.beginShape();
    for (let s = 0; s <= 80; s++) {
      const a = s / 80 * TAU;
      g.vertex(Math.cos(a) * radius, FIELD.PLANE_Y - 1, Math.sin(a) * radius);
    }
    g.endShape();
  }
  g.pop();
}

function drawTransformationLinks(g, phase, isGlow) {
  const n = FIELD.GRID;
  const step = FIELD.CONNECTOR_STEP;
  g.push();
  g.noFill();
  g.strokeWeight(isGlow ? 4.5 : 0.85);
  for (let row = 0; row < n; row += step) {
    for (let col = 0; col < n; col += step) {
      const node = fieldNodes[row * n + col];
      const p = transformComplex(node, phase, scratchPosition);
      const baseX = node.x * FIELD.BASE_SCALE;
      const baseZ = node.yi * FIELD.BASE_SCALE;
      const fog = fogFactor(p.x, p.y, p.z);
      const alpha = (isGlow ? 6 : 30) * fog * (0.35 + 0.65 * p.energy);
      g.stroke(INK_R, INK_G, INK_B, alpha);
      g.line(baseX, FIELD.PLANE_Y, baseZ, p.x, p.y, p.z);
    }
  }
  g.pop();
}

function drawComplexField(g, phase, isGlow) {
  const n = FIELD.GRID;
  const positions = fieldPositions;
  for (let i = 0; i < fieldNodes.length; i++) transformComplex(fieldNodes[i], phase, positions[i]);

  g.push();
  g.noFill();
  g.strokeWeight(isGlow ? 5.2 : 1.25);

  // Structured rows and columns become a folded z² surface.
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n - 1; col++) drawFieldEdge(g, positions[row * n + col], positions[row * n + col + 1], isGlow);
  }
  for (let col = 0; col < n; col++) {
    for (let row = 0; row < n - 1; row++) drawFieldEdge(g, positions[row * n + col], positions[(row + 1) * n + col], isGlow);
  }

  g.noStroke();
  const stride = isGlow ? 2 : 1;
  for (let i = 0; i < fieldNodes.length; i += stride) {
    const p = positions[i];
    const fog = fogFactor(p.x, p.y, p.z);
    const focus = 0.28 + 0.72 * p.argumentLight;
    const alpha = (isGlow ? 28 : 130) * fog * focus;
    const radius = (isGlow ? 5.8 : 2.35) + p.energy * (isGlow ? 3.5 : 1.4);
    if (alpha < 1) continue;
    g.push();
    g.translate(p.x, p.y, p.z);
    g.fill(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
    g.sphere(radius, isGlow ? 7 : 9, isGlow ? 5 : 7);
    g.pop();
  }
  g.pop();
}

function drawFieldEdge(g, a, b, isGlow) {
  const fog = fogFactor((a.x + b.x) * 0.5, (a.y + b.y) * 0.5, (a.z + b.z) * 0.5);
  const light = (a.argumentLight + b.argumentLight) * 0.5;
  const alpha = (isGlow ? 8 : 43) * fog * (0.30 + 0.70 * light);
  if (alpha < 1) return;
  g.stroke(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
  g.line(a.x, a.y, a.z, b.x, b.y, b.z);
}

// Circles |z| = r remain circles under z² while their radius becomes r².
// Four animated contours expose that property as luminous rings embedded in the
// folded field. The bright head moves at twice the input angle: arg(z²)=2arg(z).
function drawMagnitudeContours(g, phase, isGlow) {
  const segments = 112;
  const morph = 0.62 + 0.16 * Math.cos(phase);

  g.push();
  g.noFill();
  for (let ring = 0; ring < FIELD.CONTOUR_COUNT; ring++) {
    const inputRadius = 0.30 + ring * 0.22;
    const magnitude = inputRadius * inputRadius;
    const baseRadius = inputRadius * FIELD.BASE_SCALE;
    const mappedRadius = magnitude * FIELD.TRANSFORM_SCALE;
    const radius = lerp(baseRadius, mappedRadius, morph);

    for (let s = 0; s < segments; s++) {
      const inputAngle0 = s / segments * TAU;
      const inputAngle1 = (s + 1) / segments * TAU;
      const outputAngle0 = inputAngle0 * 2;
      const outputAngle1 = inputAngle1 * 2;
      const headDistance = angularDistance(outputAngle0, phase * 2 + ring * 0.72);
      const head = Math.exp(-headDistance * headDistance * 3.2);
      const wave0 = Math.sin(outputAngle0 * 2 - phase);
      const wave1 = Math.sin(outputAngle1 * 2 - phase);
      const x0 = Math.cos(outputAngle0) * radius;
      const z0 = Math.sin(outputAngle0) * radius;
      const x1 = Math.cos(outputAngle1) * radius;
      const z1 = Math.sin(outputAngle1) * radius;
      const y0 = FIELD.PLANE_Y - magnitude * FIELD.HEIGHT_SCALE - wave0 * FIELD.WAVE_HEIGHT;
      const y1 = FIELD.PLANE_Y - magnitude * FIELD.HEIGHT_SCALE - wave1 * FIELD.WAVE_HEIGHT;
      const fog = fogFactor((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5);
      const alpha = (isGlow ? 10 : 48) * fog * (0.35 + head * 1.8);
      g.stroke(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
      g.strokeWeight((isGlow ? 5.5 : 1.25) + head * (isGlow ? 8 : 2.1));
      g.line(x0, y0, z0, x1, y1, z1);
    }
  }
  g.pop();
}

function angularDistance(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

// A deterministic stream of light travels along selected z → z² connectors.
// The arched interpolation keeps every particle visible above the line while its
// integer two-cycle timing closes exactly at the end of the Reel loop.
function drawTransformationFlow(g, phase, isGlow) {
  const loop = phase / TAU;
  const stride = isGlow ? 2 : 1;
  g.push();
  g.noStroke();
  for (let i = 0; i < flowNodes.length; i += stride) {
    const flow = flowNodes[i];
    const node = flow.node;
    const end = transformComplex(node, phase, scratchPosition);
    const startX = node.x * FIELD.BASE_SCALE;
    const startY = FIELD.PLANE_Y;
    const startZ = node.yi * FIELD.BASE_SCALE;
    const t = (flow.offset + loop * 2) % 1;
    const eased = t * t * (3 - 2 * t);
    const arc = Math.sin(Math.PI * t) * (28 + node.radial * 18);
    const x = lerp(startX, end.x, eased);
    const y = lerp(startY, end.y, eased) - arc;
    const z = lerp(startZ, end.z, eased);
    const tail = Math.sin(Math.PI * t);
    const fog = fogFactor(x, y, z);
    const alpha = (isGlow ? 58 : 215) * tail * fog;
    if (alpha < 1) continue;

    g.push();
    g.translate(x, y, z);
    g.fill(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
    g.sphere((isGlow ? 7.5 : 2.8) + tail * (isGlow ? 5 : 1.8), isGlow ? 7 : 10, isGlow ? 5 : 7);
    g.pop();
  }
  g.pop();
}

function drawAxes(g, phase, isGlow) {
  const L = FIELD.AXIS_LENGTH;
  const pulse = 0.82 + 0.18 * Math.cos(phase * 2);
  g.push();
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, (isGlow ? 30 : 178) * pulse);
  g.strokeWeight(isGlow ? 9 : 2.6);
  g.line(-L, FIELD.PLANE_Y - 2, 0, L, FIELD.PLANE_Y - 2, 0); // real axis x
  g.line(0, FIELD.PLANE_Y - 2, -L, 0, FIELD.PLANE_Y - 2, L); // imaginary axis yi

  const tick = FIELD.BASE_SCALE * FIELD.DOMAIN / 5;
  g.strokeWeight(isGlow ? 5 : 1.4);
  for (let i = -5; i <= 5; i++) {
    if (i === 0) continue;
    const p = i * tick;
    g.line(p, FIELD.PLANE_Y - 8, 0, p, FIELD.PLANE_Y + 8, 0);
    g.line(0, FIELD.PLANE_Y - 8, p, 0, FIELD.PLANE_Y + 8, p);
  }
  g.pop();
}

function drawOrigin(g, phase, isGlow) {
  const pulse = 0.5 + 0.5 * Math.cos(phase * 3);
  const layers = isGlow
    ? [{ r: 18 + pulse * 5, a: 60 }, { r: 32 + pulse * 8, a: 18 }]
    : [{ r: 6 + pulse * 2, a: 255 }, { r: 13 + pulse * 3, a: 72 }];
  g.push();
  g.translate(0, FIELD.PLANE_Y - 4, 0);
  g.noStroke();
  for (const layer of layers) {
    g.fill(INK_R, INK_G, INK_B, layer.a);
    g.sphere(layer.r, isGlow ? 10 : 14, isGlow ? 7 : 10);
  }
  g.pop();
}

function drawAtmosphere(g, phase, isGlow) {
  const stride = isGlow ? 4 : 2;
  for (let i = 0; i < dustSeeds.length; i += stride) {
    const d = dustSeeds[i];
    const fog = fogFactor(d.x, d.y, d.z);
    const twinkle = Math.pow(0.5 + 0.5 * Math.sin(d.harmonic * phase + d.phase), 2);
    const alpha = (isGlow ? 7 : 25) * fog * (0.2 + 0.8 * twinkle);
    if (alpha < 1) continue;
    g.push();
    g.translate(d.x, d.y, d.z);
    g.noStroke();
    g.fill(INK_R, INK_G, INK_B, alpha);
    g.sphere(isGlow ? 3.5 : 1.1, 5, 4);
    g.pop();
  }
}

// ─── Bloom / finishing ─────────────────────────────────────────────────────────
function composite(phase) {
  background(BG_R, BG_G, BG_B);
  halfPg.clear();      halfPg.image(glowPg, 0, 0, W>>1, H>>1);
  quartPg.clear();     quartPg.image(halfPg, 0, 0, W>>2, H>>2);
  eighthPg.clear();    eighthPg.image(quartPg, 0, 0, W>>3, H>>3);
  sixteenthPg.clear(); sixteenthPg.image(eighthPg, 0, 0, W>>4, H>>4);

  const bloomBreath = 0.88 + 0.12 * Math.cos(phase * 2);
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, Math.round(42 * bloomBreath));  image(sixteenthPg, 0, 0, W, H);
  tint(255, Math.round(72 * bloomBreath));  image(eighthPg, 0, 0, W, H);
  tint(255, Math.round(142 * bloomBreath)); image(quartPg, 0, 0, W, H);
  tint(255, Math.round(225 * bloomBreath)); image(halfPg, 0, 0, W, H);
  noTint();
  image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 16); image(grainPg, 0, 0); noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

function drawHUD(progress) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');
  textAlign(LEFT, TOP);
  fill(255, 255, 255, 205);
  textSize(22);
  text('GAUSS PLANE', 70, 385);
  fill(255, 255, 255, 104);
  textSize(13);
  text('z = x + yi', 70, 422);
  text('f(z) = z²', 70, 446);

  fill(255, 255, 255, 58);
  textSize(10);
  text('HEIGHT  |z²|', 70, 486);
  text('LIGHT   arg(z²)', 70, 504);

  textAlign(RIGHT, TOP);
  fill(255, 255, 255, 115);
  text('Re(z)  →  x', W - 70, 402);
  text('Im(z)  →  yi', W - 70, 422);

  fill(255, 255, 255, 44);
  textAlign(LEFT, BOTTOM);
  text(W + '×' + H + ' · ' + FPS + 'fps', 52, H - 52);
  textAlign(RIGHT, BOTTOM);
  text('20260715 · LOOP ' + progress.toFixed(3), W - 52, H - 52);
  pop();
}

function drawCornerBrackets() {
  push(); noFill(); stroke(255, 255, 255, 38); strokeWeight(0.7);
  const m = 34, L = 24;
  line(m,m,m+L,m); line(m,m,m,m+L);
  line(W-m,m,W-m-L,m); line(W-m,m,W-m,m+L);
  line(m,H-m,m+L,H-m); line(m,H-m,m,H-m-L);
  line(W-m,H-m,W-m-L,H-m); line(W-m,H-m,W-m,H-m-L);
  pop();
}

function drawVignette() {
  push(); noFill();
  const steps = 80, maxR = dist(W / 2, H / 2, 0, 0) * 1.12;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const alpha = map(k, 0.60, 1, 0, 150, true);
    if (alpha <= 0) continue;
    stroke(0, 0, 0, alpha);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction / recording ─────────────────────────────────────────────────────────
function mousePressed() { reseed(Math.floor(random(100000))); }

function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('gauss_plane_' + ts(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseed(Math.floor(random(100000))); return false; }
  return true;
}

function updateRecordingUI() {
  const el = id => document.getElementById(id);
  if (el('duration'))   el('duration').textContent   = (recFrameCount / FPS).toFixed(1);
  if (el('frameCount')) el('frameCount').textContent = recFrameCount;
  const fill = el('progressFill');
  if (fill) fill.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
}

function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory', firstTimestampBehavior: 'offset',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: error => { console.error(error); isRecording = false; setStatus('Error', '#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording = true;
  const el = id => document.getElementById(id);
  if (el('duration'))   el('duration').textContent = '0.0';
  if (el('frameCount')) el('frameCount').textContent = '0';
  if (el('startBtn'))   el('startBtn').disabled = true;
  if (el('stopBtn'))    el('stopBtn').disabled = false;
  if (el('progressFill')) el('progressFill').style.width = '0%';
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
  a.download = 'gauss_plane_' + ts() + '.mp4';
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn'))  el('stopBtn').disabled = true;
  if (el('progressFill')) el('progressFill').style.width = '0%';
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(textValue, colorValue) {
  const el = document.getElementById('status');
  if (el) { el.textContent = textValue; el.style.color = colorValue; }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

if (typeof window !== 'undefined') {
  window.startRecording = startRecording;
  window.stopRecording = stopRecording;
}

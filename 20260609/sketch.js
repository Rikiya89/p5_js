'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;
const TAU = Math.PI * 2;

// ─── Layout ───────────────────────────────────────────────────────────────────
const FORMULA_H = 960;
const SIM_Y = FORMULA_H;
const SIM_H = H - FORMULA_H;
const SIM_CENTER_Y = FORMULA_H + SIM_H / 2;
const SIM_PAD = 80;

// ─── Presets ──────────────────────────────────────────────────────────────────
const PRESETS = [
  { R: 5,  r: 3, d: 5, zFrequency: 2, zAmplitude: 1.8, label: '5 : 3 : 5' },
  { R: 7,  r: 3, d: 5, zFrequency: 3, zAmplitude: 2.0, label: '7 : 3 : 5' },
  { R: 8,  r: 3, d: 5, zFrequency: 4, zAmplitude: 2.2, label: '8 : 3 : 5' },
  { R: 9,  r: 4, d: 6, zFrequency: 5, zAmplitude: 2.4, label: '9 : 4 : 6' },
  { R: 10, r: 3, d: 7, zFrequency: 6, zAmplitude: 2.6, label: '10 : 3 : 7' },
  { R: 12, r: 5, d: 8, zFrequency: 7, zAmplitude: 2.8, label: '12 : 5 : 8' },
];
const PRESET_FRAMES = FPS * 5;
const TOTAL_LOOP = PRESET_FRAMES * PRESETS.length;
const POINT_COUNT = 1800;
const RING_POINTS = 5;
const TOTAL_POINTS = POINT_COUNT * RING_POINTS;
const CAMERA_ORBIT_RATE = 0.18;
const LOCAL_ROTATE_RATE = 0.02;
const CLOUD_VIEW_SCALE = 0.58;

// ─── Point-cloud cache ────────────────────────────────────────────────────────
let cachedPresetIndex = -1;
let cachedCloud = null;

// ─── Buffers ──────────────────────────────────────────────────────────────────
let overlayPg, grainPg;
let canvasEl = null;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  if (typeof setAttributes === 'function') {
    setAttributes({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  }

  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) wrap.appendChild(canvasEl);

  overlayPg = createGraphics(W, H);
  overlayPg.pixelDensity(1);
  overlayPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  bakeGrain();

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('maxFrames')) el('maxFrames').textContent = MAX_FRAMES;
}

// ─── Point generation ─────────────────────────────────────────────────────────
const COL_R = [255, 190, 50];
const COL_r = [80, 220, 255];
const COL_D = [255, 70, 150];
const COL_W = [255, 255, 255];

function gcd(a, b) {
  while (b !== 0) {
    const temp = b;
    b = a % b;
    a = temp;
  }
  return Math.abs(a);
}

function lerpColor3(cA, cB, t) {
  return [
    cA[0] + (cB[0] - cA[0]) * t,
    cA[1] + (cB[1] - cA[1]) * t,
    cA[2] + (cB[2] - cA[2]) * t,
  ];
}

function pointColorAt(t) {
  if (t < 0.25) return lerpColor3(COL_R, COL_W, t / 0.25);
  if (t < 0.50) return lerpColor3(COL_W, COL_r, (t - 0.25) / 0.25);
  if (t < 0.75) return lerpColor3(COL_r, COL_W, (t - 0.50) / 0.25);
  return lerpColor3(COL_W, COL_D, (t - 0.75) / 0.25);
}

function hypotrochoidPoint(preset, t, phase) {
  const k = (preset.R - preset.r) / preset.r;
  const x = (preset.R - preset.r) * Math.cos(t) + preset.d * Math.cos(k * t);
  const y = (preset.R - preset.r) * Math.sin(t) - preset.d * Math.sin(k * t);
  let z = preset.zAmplitude * Math.sin(preset.zFrequency * t + phase);
  z += preset.zAmplitude * 0.25 * Math.sin((preset.zFrequency + 1.0) * t - phase * 0.5);
  return { x, y, z };
}

function buildPointCloud(preset) {
  const positions = new Float32Array(TOTAL_POINTS * 3);
  const progress = new Float32Array(TOTAL_POINTS);
  const sizes = new Float32Array(TOTAL_POINTS);
  const colors = new Float32Array(TOTAL_POINTS * 3);
  const depth = new Float32Array(TOTAL_POINTS);
  const curvePositions = new Float32Array(POINT_COUNT * 3);
  const turns = preset.r / gcd(preset.R, preset.r);
  const maxT = TAU * turns;
  const phase = turns * 0.37;
  const raw = new Float32Array(TOTAL_POINTS * 3);
  const rawCurve = new Float32Array(POINT_COUNT * 3);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < POINT_COUNT; i++) {
    const p = i / (POINT_COUNT - 1);
    const t = p * maxT;
    const center = hypotrochoidPoint(preset, t, phase);
    const ahead = hypotrochoidPoint(preset, Math.min(maxT, t + maxT / POINT_COUNT), phase);
    const tx = ahead.x - center.x;
    const ty = ahead.y - center.y;
    const tangentAngle = Math.atan2(ty, tx) + Math.PI / 2;
    const thickness = 0.135 * (preset.R + preset.d) * (0.65 + 0.35 * Math.sin(t * 3.0 + phase));

    rawCurve[i * 3] = center.x;
    rawCurve[i * 3 + 1] = center.y;
    rawCurve[i * 3 + 2] = center.z;

    for (let j = 0; j < RING_POINTS; j++) {
      const ringAngle = (j / RING_POINTS) * TAU + p * TAU * 0.5;
      const localX = Math.cos(tangentAngle) * Math.cos(ringAngle) * thickness;
      const localY = Math.sin(tangentAngle) * Math.cos(ringAngle) * thickness;
      const localZ = Math.sin(ringAngle + t) * thickness;
      const idx = i * RING_POINTS + j;
      const x = center.x + localX;
      const y = center.y + localY;
      const z = center.z + localZ;
      raw[idx * 3] = x;
      raw[idx * 3 + 1] = y;
      raw[idx * 3 + 2] = z;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const centerZ = (minZ + maxZ) * 0.5;
  const rawW = maxX - minX || 1;
  const rawH = maxY - minY || 1;
  const rawD = maxZ - minZ || 1;
  const targetW = W - SIM_PAD * 2;
  const targetH = SIM_H - SIM_PAD * 2;
  const targetD = 360;
  const scale = Math.min(targetW / rawW, targetH / rawH, targetD / rawD);

  for (let i = 0; i < TOTAL_POINTS; i++) {
    const x = (raw[i * 3] - centerX) * scale;
    const y = (raw[i * 3 + 1] - centerY) * scale;
    const z = (raw[i * 3 + 2] - centerZ) * scale;
    const p = Math.floor(i / RING_POINTS) / (POINT_COUNT - 1);
    const [cr, cg, cb] = pointColorAt(p);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    progress[i] = p;
    sizes[i] = 1.0 + 1.2 * (0.5 + 0.5 * Math.sin(p * TAU * 6.0 + phase));
    colors[i * 3] = cr;
    colors[i * 3 + 1] = cg;
    colors[i * 3 + 2] = cb;
    depth[i] = rawD === 0 ? 0.5 : (raw[i * 3 + 2] - minZ) / rawD;
  }

  for (let i = 0; i < POINT_COUNT; i++) {
    curvePositions[i * 3] = (rawCurve[i * 3] - centerX) * scale;
    curvePositions[i * 3 + 1] = (rawCurve[i * 3 + 1] - centerY) * scale;
    curvePositions[i * 3 + 2] = (rawCurve[i * 3 + 2] - centerZ) * scale;
  }

  return { positions, progress, sizes, colors, depth, curvePositions, count: TOTAL_POINTS, curveCount: POINT_COUNT, scale };
}

function getPointCloud(preset, presetIndex) {
  if (presetIndex !== cachedPresetIndex || cachedCloud === null) {
    cachedCloud = buildPointCloud(preset);
    cachedPresetIndex = presetIndex;
  }
  return cachedCloud;
}

// ─── Camera ──────────────────────────────────────────────────────────────────
function getCurrentPresetTiming() {
  const sourceFrame = isRecording ? recFrameCount : frameCount;
  const fc = sourceFrame % TOTAL_LOOP;
  const presetIndex = floor(fc / PRESET_FRAMES);
  const localFrame = fc % PRESET_FRAMES;
  const localProgress = localFrame / PRESET_FRAMES;
  return {
    fc,
    presetIndex,
    localFrame,
    localProgress,
    phase: localProgress * TAU,
    preset: PRESETS[presetIndex],
  };
}

function setupSimulationCamera(timing) {
  const orbitAngle = timing.localProgress * TAU * CAMERA_ORBIT_RATE;
  const cameraRadius = 980;
  const cameraX = Math.sin(orbitAngle) * cameraRadius;
  const cameraZ = Math.cos(orbitAngle) * cameraRadius;
  const cameraY = -64 + Math.sin(orbitAngle * 2.0) * 28;
  perspective(PI / 6.4, W / H, 10, 4000);
  camera(cameraX, cameraY, cameraZ, 0, 0, 0, 0, 1, 0);
}

function resetScreenCamera() {
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10000, 10000);
  camera(0, 0, 1000, 0, 0, 0, 0, 1, 0);
  resetMatrix();
}

// ─── Point rendering ─────────────────────────────────────────────────────────
function draw() {
  const timing = getCurrentPresetTiming();

  background(0);
  push();
  setupSimulationCamera(timing);
  translate(0, SIM_CENTER_Y - H / 2, 0);
  drawPointCloud(timing);
  pop();

  resetScreenCamera();
  drawScreenOverlay(timing);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function drawPointCloud(timing) {
  const cloud = getPointCloud(timing.preset, timing.presetIndex);
  const revealProgress = constrain(timing.localProgress * 1.15, 0, 1);
  const tracerIndex = Math.min(POINT_COUNT - 1, Math.floor(timing.localProgress * (POINT_COUNT - 1)));
  const breathe = CLOUD_VIEW_SCALE * (1.0 + 0.018 * Math.sin(timing.phase));

  push();
  rotateX(-0.25);
  rotateY(timing.localProgress * TAU * LOCAL_ROTATE_RATE);
  rotateZ(Math.sin(timing.phase) * 0.018);
  blendMode(ADD);

  renderCloudPass(cloud, revealProgress, breathe, 2.4, 0.95, true);
  renderCloudPass(cloud, revealProgress, breathe, 1.55, 1.0, false);
  drawTracer(cloud, tracerIndex, breathe, timing.phase);

  blendMode(BLEND);
  pop();
}

function renderCloudPass(cloud, revealProgress, breathe, sizeMul, alphaMul, isGlow) {
  const maxIndex = Math.min(cloud.count, Math.floor(cloud.count * revealProgress));
  for (let group = 0; group < 3; group++) {
    const baseWeight = isGlow ? 3.2 + group * 1.2 : 1.55 + group * 0.72;
    strokeWeight(baseWeight * sizeMul);
    beginShape(POINTS);
    for (let i = group; i < maxIndex; i += 3) {
      const depthPulse = Math.sin(cloud.progress[i] * TAU * 4.0) * 4.0;
      const r = cloud.colors[i * 3];
      const g = cloud.colors[i * 3 + 1];
      const b = cloud.colors[i * 3 + 2];
      const alphaBase = isGlow ? 48 : 145 + cloud.depth[i] * 95;
      stroke(r, g, b, alphaBase * alphaMul);
      vertex(
        cloud.positions[i * 3] * breathe,
        cloud.positions[i * 3 + 1] * breathe,
        cloud.positions[i * 3 + 2] * breathe + depthPulse
      );
    }
    endShape();
  }
}

function drawTracer(cloud, tracerIndex, breathe, phase) {
  const tailCount = 54;
  for (let t = tailCount; t >= 1; t--) {
    const idx = Math.max(0, tracerIndex - t);
    const k = 1 - t / tailCount;
    const x = cloud.curvePositions[idx * 3] * breathe;
    const y = cloud.curvePositions[idx * 3 + 1] * breathe;
    const z = cloud.curvePositions[idx * 3 + 2] * breathe + Math.sin(idx / POINT_COUNT * TAU * 4.0 + phase) * 4.0;
    strokeWeight(3.2 + k * 3.4);
    stroke(225, 248, 255, 70 + k * 170);
    point(x, y, z);
  }

  const x = cloud.curvePositions[tracerIndex * 3] * breathe;
  const y = cloud.curvePositions[tracerIndex * 3 + 1] * breathe;
  const z = cloud.curvePositions[tracerIndex * 3 + 2] * breathe;
  strokeWeight(22);
  stroke(80, 220, 255, 82);
  point(x, y, z);
  strokeWeight(14);
  stroke(255, 190, 50, 84);
  point(x, y, z);
  strokeWeight(9.5);
  stroke(255, 255, 255, 245);
  point(x, y, z);
}

// ─── Formula zone ────────────────────────────────────────────────────────────
function drawScreenOverlay(timing) {
  overlayPg.clear();
  drawFormulaZone(timing);
  drawDivider();
  drawGrain();
  drawVignette();
  image(overlayPg, -W / 2, -H / 2, W, H);
}

function drawFormulaZone(timing) {
  const pg = overlayPg;
  const ctx = pg.drawingContext;
  pg.noStroke();
  pg.fill(6, 6, 10, 250);
  pg.rect(0, 0, W, FORMULA_H);

  ctx.save();
  ctx.font = 'normal 52px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('HYPOTROCHOID POINT CLOUD', W / 2, 60);
  ctx.restore();

  const WHITE = 'rgba(255,255,255,0.86)';
  const AMBER = 'rgba(255,190,50,0.96)';
  const CYAN = 'rgba(80,220,255,0.94)';
  const PINK = 'rgba(255,70,150,0.94)';
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
  const MATH = '"Times New Roman", serif';

  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  function setTokenFont(token, size, family) {
    ctx.font = `${token.italic ? 'italic' : 'normal'} ${size}px ${family}`;
  }

  function measureTokens(tokens, size, family) {
    let total = 0;
    for (const token of tokens) {
      setTokenFont(token, size, family);
      total += ctx.measureText(token.text).width;
    }
    return total;
  }

  function fitTokenSize(tokens, startSize, minSize, maxWidth, family) {
    let size = startSize;
    while (size > minSize && measureTokens(tokens, size, family) > maxWidth) size -= 1;
    return size;
  }

  function drawTokensCentered(tokens, y, size, family) {
    let x = (W - measureTokens(tokens, size, family)) / 2;
    for (const token of tokens) {
      setTokenFont(token, size, family);
      ctx.fillStyle = token.color;
      ctx.fillText(token.text, x, y);
      x += ctx.measureText(token.text).width;
    }
  }

  const eq1 = [
    { text: 'x(t) = (', color: WHITE, italic: false },
    { text: 'R', color: AMBER, italic: true },
    { text: ' − ', color: WHITE, italic: false },
    { text: 'r', color: CYAN, italic: true },
    { text: ') cos(t) + ', color: WHITE, italic: false },
    { text: 'd', color: PINK, italic: true },
    { text: ' cos(((', color: WHITE, italic: false },
    { text: 'R', color: AMBER, italic: true },
    { text: ' − ', color: WHITE, italic: false },
    { text: 'r', color: CYAN, italic: true },
    { text: ') / ', color: WHITE, italic: false },
    { text: 'r', color: CYAN, italic: true },
    { text: ')t)', color: WHITE, italic: false },
  ];
  const eq2 = [
    { text: 'y(t) = (', color: WHITE, italic: false },
    { text: 'R', color: AMBER, italic: true },
    { text: ' − ', color: WHITE, italic: false },
    { text: 'r', color: CYAN, italic: true },
    { text: ') sin(t) − ', color: WHITE, italic: false },
    { text: 'd', color: PINK, italic: true },
    { text: ' sin(((', color: WHITE, italic: false },
    { text: 'R', color: AMBER, italic: true },
    { text: ' − ', color: WHITE, italic: false },
    { text: 'r', color: CYAN, italic: true },
    { text: ') / ', color: WHITE, italic: false },
    { text: 'r', color: CYAN, italic: true },
    { text: ')t)', color: WHITE, italic: false },
  ];
  const eq3 = [
    { text: 'z(t) = ', color: WHITE, italic: false },
    { text: 'A', color: CYAN, italic: true },
    { text: ' sin(', color: WHITE, italic: false },
    { text: 'f', color: PINK, italic: true },
    { text: 't + ', color: WHITE, italic: false },
    { text: 'φ', color: AMBER, italic: true },
    { text: ')', color: WHITE, italic: false },
  ];
  const eqSize = Math.min(
    fitTokenSize(eq1, 45, 34, W - 110, MATH),
    fitTokenSize(eq2, 45, 34, W - 110, MATH)
  );
  drawTokensCentered(eq1, 190, eqSize, MATH);
  drawTokensCentered(eq2, 292, eqSize, MATH);
  drawTokensCentered(eq3, 394, 54, MATH);

  const valueSize = 52;
  drawTokensCentered([
    { text: 'R = ' + timing.preset.R, color: AMBER, italic: false },
    { text: '    ', color: WHITE, italic: false },
    { text: 'r = ' + timing.preset.r, color: CYAN, italic: false },
    { text: '    ', color: WHITE, italic: false },
    { text: 'd = ' + timing.preset.d, color: PINK, italic: false },
  ], 500, valueSize, MONO);
  drawTokensCentered([
    { text: 'A = ' + timing.preset.zAmplitude.toFixed(1), color: CYAN, italic: false },
    { text: '    ', color: WHITE, italic: false },
    { text: 'f = ' + timing.preset.zFrequency, color: PINK, italic: false },
  ], 576, valueSize, MONO);

  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  const barX = 80, barY = 668, barW = W - 160, barH = 10;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,200,60,0.85)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW * timing.localProgress, barH, 5); ctx.fill();

  const rY = barY + 60;
  ctx.font = `normal 48px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('R : r : d  =  ' + timing.preset.label, W / 2, rY);
  ctx.restore();

  const dotSpacing = 88;
  const dotsX = W / 2 - (PRESETS.length - 1) * dotSpacing / 2;
  for (let i = 0; i < PRESETS.length; i++) {
    const dx = dotsX + i * dotSpacing;
    const dy = rY + 80;
    pg.noStroke();
    if (i === timing.presetIndex) {
      pg.fill(255, 200, 60, 240);
      pg.circle(dx, dy, 28);
    } else if (i < timing.presetIndex) {
      pg.fill(255, 255, 255, 80);
      pg.circle(dx, dy, 20);
    } else {
      pg.fill(255, 255, 255, 25);
      pg.circle(dx, dy, 20);
    }
  }
}

// ─── Overlay effects ─────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  const count = floor(W * H * 0.0009);
  for (let i = 0; i < count; i++) {
    const v = random(130, 210);
    grainPg.fill(v, v, v, random(2, 6));
    grainPg.circle(random(W), random(H), random(0.2, 0.75));
  }
}

function drawGrain() {
  overlayPg.push();
  overlayPg.blendMode(SCREEN);
  overlayPg.tint(255, 7);
  overlayPg.image(grainPg, 0, 0);
  overlayPg.noTint();
  overlayPg.blendMode(BLEND);
  overlayPg.pop();
}

function drawDivider() {
  overlayPg.push();
  overlayPg.stroke(255, 255, 255, 28);
  overlayPg.strokeWeight(1);
  overlayPg.line(54, FORMULA_H, W - 54, FORMULA_H);
  overlayPg.pop();
}

function drawVignette() {
  overlayPg.push();
  overlayPg.noFill();
  const steps = 55;
  const maxR = dist(W / 2, H / 2, 0, 0) * 1.1;
  overlayPg.strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.70, 1.0, 0, 92, true);
    if (a <= 0) continue;
    overlayPg.stroke(0, 0, 0, a);
    overlayPg.circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  overlayPg.pop();
}

function resetCloudState() {
  cachedPresetIndex = -1;
  cachedCloud = null;
}

// ─── Interaction ─────────────────────────────────────────────────────────────
function keyReleased() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('hypotrochoid_point_cloud_' + ts(), 'png');
    return false;
  }
  return true;
}

// ─── Recording implementation ────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { console.error(e); isRecording = false; setStatus('Error', '#f44'); } });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording = true;
  frameCount = 0;
  resetCloudState();
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = true;
  if (el('stopBtn')) el('stopBtn').disabled = false;
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
  a.download = 'hypotrochoid_point_cloud_' + ts() + '.mp4';
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

function updateRecordingUi() {
  const el = id => document.getElementById(id);
  if (el('duration')) el('duration').textContent = (recFrameCount / FPS).toFixed(1);
  if (el('frameCount')) el('frameCount').textContent = recFrameCount;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
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

window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.ts = ts;

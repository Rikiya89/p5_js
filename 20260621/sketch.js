'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = FPS * 10;
const TAU = Math.PI * 2;

// ─── Layout ───────────────────────────────────────────────────────────────────
const FORMULA_H = 560;
const SAFE_X = 112;
const PLOT = {
  left: SAFE_X,
  right: W - SAFE_X,
  top: 660,
  bottom: 1570,
  xMin: -2.15,
  xMax: 2.15,
  yMin: -4.9,
  yMax: 6.8,
};
const AXIS_Y = yToScreen(0);

// ─── Palette ──────────────────────────────────────────────────────────────────
const BG = [6, 6, 10];
const COL_AMBER = [255, 190, 50];
const COL_CYAN = [80, 220, 255];
const COL_PINK = [255, 70, 150];
const COL_WHITE = [255, 255, 255];
const SEED_COLORS = [COL_AMBER, COL_CYAN, COL_PINK, [255, 236, 190], [178, 244, 255], [255, 158, 210], COL_WHITE];

// ─── Newton setup ─────────────────────────────────────────────────────────────
const NEWTON = {
  samples: 720,
  iterations: 6,
  starts: [-1.95, -1.45, -0.55, 0.55, 1.05, 1.55, 2.10],
};
let paths = [];

// ─── Buffers ──────────────────────────────────────────────────────────────────
let pg, glowPg, halfPg, quartPg, grainPg;
let canvasEl = null;

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

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) wrap.appendChild(canvasEl);

  pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);

  glowPg = createGraphics(W, H);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);

  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  halfPg.colorMode(RGB, 255, 255, 255, 255);

  quartPg = createGraphics(W >> 2, H >> 2);
  quartPg.pixelDensity(1);
  quartPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  grainPg.colorMode(RGB, 255, 255, 255, 255);

  bakeGrain();
  paths = NEWTON.starts.map((start, i) => buildNewtonPath(start, i));

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('maxFrames')) el('maxFrames').textContent = MAX_FRAMES;
}

// ─── Math ─────────────────────────────────────────────────────────────────────
function f(x) {
  return x * x * x - 2 * x + 0.5;
}

function df(x) {
  return 3 * x * x - 2;
}

function newtonNext(x) {
  const d = df(x);
  if (Math.abs(d) < 0.001) return x;
  return x - f(x) / d;
}

function buildNewtonPath(start, index) {
  const xs = [start];
  for (let i = 0; i < NEWTON.iterations; i++) {
    xs.push(newtonNext(xs[xs.length - 1]));
  }
  return {
    xs,
    color: SEED_COLORS[index % SEED_COLORS.length],
    phaseOffset: index / NEWTON.starts.length * 0.52,
    radius: 7.0 + (index % 3) * 1.4,
  };
}

function xToScreen(x) {
  return mapLinear(x, PLOT.xMin, PLOT.xMax, PLOT.left, PLOT.right);
}

function yToScreen(y) {
  return mapLinear(y, PLOT.yMin, PLOT.yMax, PLOT.bottom, PLOT.top);
}

function screenToX(px) {
  return mapLinear(px, PLOT.left, PLOT.right, PLOT.xMin, PLOT.xMax);
}

function mapLinear(value, inMin, inMax, outMin, outMax) {
  return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
}

function smoothstep(t) {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

function easeInOut(t) {
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function lerpColor3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function colorForCurve(t) {
  if (t < 0.35) return lerpColor3(COL_AMBER, COL_WHITE, t / 0.35);
  if (t < 0.70) return lerpColor3(COL_WHITE, COL_CYAN, (t - 0.35) / 0.35);
  return lerpColor3(COL_CYAN, COL_PINK, (t - 0.70) / 0.30);
}

// ─── Grain ───────────────────────────────────────────────────────────────────
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

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  const phase = loop * TAU;

  pg.clear();
  glowPg.clear();
  renderNewtonScene(loop, phase);
  compositeFrame();
  drawFormulaZone(loop);
  drawDivider();
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderNewtonScene(loop, phase) {
  drawAmbientField(glowPg, phase);
  drawSolutionField(glowPg, phase, true);
  drawSolutionField(pg, phase, false);
  drawPlotFrame(glowPg, true);
  drawPlotFrame(pg, false);
  drawFunctionCurve(glowPg, true);
  drawFunctionCurve(pg, false);
  drawRootMarkers(glowPg, true);
  drawRootMarkers(pg, false);

  for (const path of paths) drawNewtonPath(glowPg, path, loop, phase, true);
  for (const path of paths) drawNewtonPath(pg, path, loop, phase, false);
}

function drawAmbientField(g, phase) {
  g.push();
  g.blendMode(ADD);
  g.noStroke();
  for (let i = 0; i < 120; i++) {
    const a = i * 2.399963 + phase * 0.08;
    const r = 80 + Math.sqrt(i / 120) * 500;
    const x = W / 2 + Math.cos(a) * r * 0.78;
    const y = 1115 + Math.sin(a) * r * 0.92;
    const tw = 0.45 + 0.55 * Math.sin(phase * (1 + (i % 3)) + i);
    g.fill(255, 255, 255, 2.2 + tw * 5.5);
    g.circle(x, y, 1.2 + (i % 5) * 0.45);
  }
  g.pop();
}

function drawSolutionField(g, phase, isGlow) {
  g.push();
  g.blendMode(isGlow ? ADD : BLEND);
  const count = 84;
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const x = PLOT.xMin + (PLOT.xMax - PLOT.xMin) * t;
    const y = f(x);
    if (y < PLOT.yMin || y > PLOT.yMax) continue;

    const sx = xToScreen(x);
    const sy = yToScreen(y);
    const [r, gg, b] = colorForCurve(t);
    const shimmer = 0.55 + 0.45 * Math.sin(phase * 2 + i * 0.42);
    const h = Math.abs(sy - AXIS_Y);
    const alpha = (isGlow ? 7 : 18) * (0.25 + 0.75 * Math.min(1, h / 360)) * shimmer;
    g.stroke(r, gg, b, alpha);
    g.strokeWeight(isGlow ? 4.8 : 0.65);
    g.line(sx, AXIS_Y, sx, sy);

    if (!isGlow && i % 6 === 0) {
      g.noStroke();
      g.fill(r, gg, b, 18 * shimmer);
      g.circle(sx, sy, 4.5);
    }
  }
  g.pop();
}

function drawPlotFrame(g, isGlow) {
  g.push();
  g.noFill();
  g.blendMode(isGlow ? ADD : BLEND);

  const axisAlpha = isGlow ? 10 : 46;
  const gridAlpha = isGlow ? 4 : 11;
  const axisWeight = isGlow ? 6 : 1.05;
  const gridWeight = isGlow ? 3.8 : 0.75;

  g.stroke(255, 255, 255, gridAlpha);
  g.strokeWeight(gridWeight);
  for (let x = -2; x <= 2; x += 0.5) {
    const sx = xToScreen(x);
    g.line(sx, PLOT.top, sx, PLOT.bottom);
  }
  for (let y = -4; y <= 6; y += 1) {
    const sy = yToScreen(y);
    g.line(PLOT.left, sy, PLOT.right, sy);
  }

  g.stroke(255, 255, 255, axisAlpha);
  g.strokeWeight(axisWeight);
  g.line(PLOT.left - 28, AXIS_Y, PLOT.right + 28, AXIS_Y);
  const yAxis = xToScreen(0);
  g.line(yAxis, PLOT.top + 12, yAxis, PLOT.bottom - 12);

  g.stroke(255, 255, 255, isGlow ? 7 : 30);
  g.strokeWeight(isGlow ? 4 : 0.9);
  const k = 72;
  g.line(PLOT.left, PLOT.top, PLOT.left + k, PLOT.top);
  g.line(PLOT.left, PLOT.top, PLOT.left, PLOT.top + k);
  g.line(PLOT.right, PLOT.top, PLOT.right - k, PLOT.top);
  g.line(PLOT.right, PLOT.top, PLOT.right, PLOT.top + k);
  g.line(PLOT.left, PLOT.bottom, PLOT.left + k, PLOT.bottom);
  g.line(PLOT.left, PLOT.bottom, PLOT.left, PLOT.bottom - k);
  g.line(PLOT.right, PLOT.bottom, PLOT.right - k, PLOT.bottom);
  g.line(PLOT.right, PLOT.bottom, PLOT.right, PLOT.bottom - k);
  g.pop();
}

function drawFunctionCurve(g, isGlow) {
  g.push();
  g.noFill();
  g.blendMode(isGlow ? ADD : BLEND);
  if (!isGlow) drawCurveEchoes(g);
  const step = (PLOT.right - PLOT.left) / NEWTON.samples;
  for (let i = 0; i < NEWTON.samples; i++) {
    const px0 = PLOT.left + i * step;
    const px1 = PLOT.left + (i + 1) * step;
    const x0 = screenToX(px0);
    const x1 = screenToX(px1);
    const y0 = yToScreen(f(x0));
    const y1 = yToScreen(f(x1));
    if (y0 < PLOT.top - 160 || y0 > PLOT.bottom + 160 || y1 < PLOT.top - 160 || y1 > PLOT.bottom + 160) continue;
    const t = i / NEWTON.samples;
    const [r, gg, b] = colorForCurve(t);
    g.stroke(r, gg, b, isGlow ? 28 : 172);
    g.strokeWeight(isGlow ? 10.5 : 1.85);
    g.line(px0, y0, px1, y1);
  }
  g.pop();
}

function drawCurveEchoes(g) {
  const step = (PLOT.right - PLOT.left) / 260;
  const echoes = [
    { off: -18, alpha: 20, weight: 0.95 },
    { off: 22, alpha: 16, weight: 0.75 },
    { off: 46, alpha: 9, weight: 0.55 },
  ];
  for (const echo of echoes) {
    for (let i = 0; i < 260; i++) {
      const px0 = PLOT.left + i * step;
      const px1 = PLOT.left + (i + 1) * step;
      const x0 = screenToX(px0);
      const x1 = screenToX(px1);
      const y0 = yToScreen(f(x0)) + echo.off;
      const y1 = yToScreen(f(x1)) + echo.off;
      if (y0 < PLOT.top - 120 || y0 > PLOT.bottom + 120 || y1 < PLOT.top - 120 || y1 > PLOT.bottom + 120) continue;
      const [r, gg, b] = colorForCurve(i / 260);
      g.stroke(r, gg, b, echo.alpha);
      g.strokeWeight(echo.weight);
      g.line(px0, y0, px1, y1);
    }
  }
}

function drawRootMarkers(g, isGlow) {
  const roots = [-1.525687, 0.258652, 1.267035];
  g.push();
  g.blendMode(isGlow ? ADD : BLEND);
  for (let i = 0; i < roots.length; i++) {
    const sx = xToScreen(roots[i]);
    const c = SEED_COLORS[(i * 2) % SEED_COLORS.length];
    if (isGlow) {
      g.noStroke();
      g.fill(c[0], c[1], c[2], 28);
      g.circle(sx, AXIS_Y, 52);
    } else {
      g.noFill();
      g.stroke(c[0], c[1], c[2], 150);
      g.strokeWeight(1.4);
      g.circle(sx, AXIS_Y, 18);
      g.stroke(255, 255, 255, 42);
      g.line(sx, AXIS_Y - 28, sx, AXIS_Y + 28);
    }
  }
  g.pop();
}

function drawNewtonPath(g, path, loop, phase, isGlow) {
  const local = (loop + path.phaseOffset) % 1;
  const fadeIn = smoothstep(local / 0.10);
  const fadeOut = 1 - smoothstep((local - 0.86) / 0.14);
  const alphaScale = fadeIn * fadeOut;
  if (alphaScale <= 0.001) return;

  const travel = clamp01(local / 0.82);
  const scaled = travel * NEWTON.iterations;
  const stepIndex = Math.min(NEWTON.iterations - 1, Math.floor(scaled));
  const stepT = easeInOut(scaled - stepIndex);
  const c = path.color;

  g.push();
  g.blendMode(isGlow ? ADD : BLEND);
  drawCompletedIterations(g, path, stepIndex, alphaScale, isGlow);
  drawCurrentNewtonStep(g, path, stepIndex, stepT, alphaScale, phase, isGlow);

  const lastX = path.xs[path.xs.length - 1];
  const finalPulse = smoothstep((travel - 0.72) / 0.16) * alphaScale;
  if (finalPulse > 0) {
    const sx = xToScreen(lastX);
    const pulse = 0.5 + 0.5 * Math.sin(phase * 2 + path.phaseOffset * TAU);
    if (isGlow) {
      g.noStroke();
      g.fill(c[0], c[1], c[2], 40 * finalPulse);
      g.circle(sx, AXIS_Y, 76 + pulse * 22);
    } else {
      g.noFill();
      g.stroke(c[0], c[1], c[2], 130 * finalPulse);
      g.strokeWeight(1.2);
      g.circle(sx, AXIS_Y, 38 + pulse * 8);
    }
  }
  g.pop();
}

function drawCompletedIterations(g, path, stepIndex, alphaScale, isGlow) {
  const c = path.color;
  for (let i = 0; i < stepIndex; i++) {
    const x0 = path.xs[i];
    const x1 = path.xs[i + 1];
    const p0 = { x: xToScreen(x0), y: yToScreen(f(x0)) };
    const p1 = { x: xToScreen(x1), y: AXIS_Y };
    const axis0 = { x: xToScreen(x0), y: AXIS_Y };
    const a = alphaScale * (1 - i / (NEWTON.iterations + 1));

    g.stroke(c[0], c[1], c[2], (isGlow ? 15 : 74) * a);
    g.strokeWeight(isGlow ? 6.5 : 1.15);
    g.line(axis0.x, axis0.y, p0.x, p0.y);
    g.line(p0.x, p0.y, p1.x, p1.y);

    if (!isGlow) {
      drawIterationBeads(g, axis0, p0, p1, c, a);
      g.noStroke();
      g.fill(255, 255, 255, 54 * a);
      g.circle(p1.x, p1.y, 5.5);
    }
  }
}

function drawIterationBeads(g, axis0, curve0, axis1, color, alphaScale) {
  const pts = [
    axis0,
    curve0,
    axis1,
  ];
  g.noStroke();
  for (let seg = 0; seg < 2; seg++) {
    const a = pts[seg];
    const b = pts[seg + 1];
    for (let j = 1; j <= 3; j++) {
      const t = j / 4;
      const px = lerp(a.x, b.x, t);
      const py = lerp(a.y, b.y, t);
      g.fill(color[0], color[1], color[2], 34 * alphaScale * (1 - j * 0.13));
      g.circle(px, py, 3.6 - j * 0.35);
    }
  }
}

function drawCurrentNewtonStep(g, path, stepIndex, stepT, alphaScale, phase, isGlow) {
  const x0 = path.xs[stepIndex];
  const x1 = path.xs[stepIndex + 1];
  const y0 = f(x0);
  const slope = df(x0);
  const c = path.color;
  const axis0 = { x: xToScreen(x0), y: AXIS_Y };
  const curve0 = { x: xToScreen(x0), y: yToScreen(y0) };
  const axis1 = { x: xToScreen(x1), y: AXIS_Y };
  const tangentPoint = {
    x: lerp(curve0.x, axis1.x, stepT),
    y: lerp(curve0.y, axis1.y, stepT),
  };
  const currentAxis = {
    x: lerp(axis0.x, axis1.x, stepT),
    y: AXIS_Y,
  };

  const tx0 = clamp(x0 - 0.85, PLOT.xMin, PLOT.xMax);
  const tx1 = clamp(x0 + 0.85, PLOT.xMin, PLOT.xMax);
  const ty0 = y0 + slope * (tx0 - x0);
  const ty1 = y0 + slope * (tx1 - x0);

  g.stroke(c[0], c[1], c[2], (isGlow ? 32 : 156) * alphaScale);
  g.strokeWeight(isGlow ? 10 : 1.8);
  g.line(xToScreen(tx0), yToScreen(ty0), xToScreen(tx1), yToScreen(ty1));

  g.stroke(255, 255, 255, (isGlow ? 14 : 70) * alphaScale);
  g.strokeWeight(isGlow ? 5 : 0.9);
  g.line(axis0.x, axis0.y, curve0.x, curve0.y);
  g.line(currentAxis.x, AXIS_Y - 18, currentAxis.x, AXIS_Y + 18);

  const beadPulse = 0.72 + 0.28 * Math.sin(phase * 2 + path.phaseOffset * TAU);
  if (isGlow) {
    g.noStroke();
    g.fill(c[0], c[1], c[2], 50 * alphaScale);
    g.circle(tangentPoint.x, tangentPoint.y, (40 + path.radius * 3) * beadPulse);
    g.fill(255, 255, 255, 30 * alphaScale);
    g.circle(curve0.x, curve0.y, 38);
  } else {
    drawMovingAfterimage(g, curve0, axis1, stepT, c, alphaScale);
    g.noStroke();
    g.fill(255, 255, 255, 235 * alphaScale);
    g.circle(tangentPoint.x, tangentPoint.y, path.radius + 4);
    g.fill(c[0], c[1], c[2], 210 * alphaScale);
    g.circle(currentAxis.x, currentAxis.y, path.radius);
    g.fill(255, 255, 255, 180 * alphaScale);
    g.circle(curve0.x, curve0.y, 7);
  }
}

function drawMovingAfterimage(g, from, to, t, color, alphaScale) {
  g.noStroke();
  for (let i = 1; i <= 7; i++) {
    const tt = clamp01(t - i * 0.045);
    if (tt <= 0 && t < 0.08) continue;
    const falloff = 1 - i / 8;
    const x = lerp(from.x, to.x, tt);
    const y = lerp(from.y, to.y, tt);
    g.fill(color[0], color[1], color[2], 52 * alphaScale * falloff);
    g.circle(x, y, 8.5 * falloff);
  }
}

// ─── Composite ────────────────────────────────────────────────────────────────
function compositeFrame() {
  background(BG[0], BG[1], BG[2]);

  halfPg.clear();
  halfPg.image(glowPg, 0, 0, W >> 1, H >> 1);
  quartPg.clear();
  quartPg.image(halfPg, 0, 0, W >> 2, H >> 2);

  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 80);
  image(quartPg, 0, 0, W, H);
  tint(255, 210);
  image(halfPg, 0, 0, W, H);
  noTint();
  image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 8);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

// ─── Formula zone ────────────────────────────────────────────────────────────
function drawFormulaZone(loop) {
  noStroke();
  fill(6, 6, 10, 238);
  rect(0, 0, W, FORMULA_H);

  const ctx = drawingContext;
  const WHITE = 'rgba(255,255,255,0.86)';
  const DIM = 'rgba(255,255,255,0.42)';
  const AMBER = 'rgba(255,190,50,0.96)';
  const CYAN = 'rgba(80,220,255,0.94)';
  const PINK = 'rgba(255,70,150,0.94)';
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
  const MATH = '"Times New Roman", serif';

  ctx.save();
  ctx.font = `normal 52px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('NEWTON METHOD FIELD', W / 2, 62);
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  function drawTokensCentered(tokens, y, size, family) {
    let total = 0;
    for (const token of tokens) {
      ctx.font = `${token.italic ? 'italic' : 'normal'} ${size}px ${family}`;
      total += ctx.measureText(token.text).width;
    }
    let x = (W - total) / 2;
    for (const token of tokens) {
      ctx.font = `${token.italic ? 'italic' : 'normal'} ${size}px ${family}`;
      ctx.fillStyle = token.color;
      ctx.fillText(token.text, x, y);
      x += ctx.measureText(token.text).width;
    }
  }

  drawTokensCentered([
    { text: 'x', color: AMBER, italic: true },
    { text: 'ₙ₊₁', color: AMBER, italic: false },
    { text: ' = x', color: WHITE, italic: true },
    { text: 'ₙ', color: WHITE, italic: false },
    { text: ' − ', color: WHITE, italic: false },
    { text: 'f(x', color: CYAN, italic: true },
    { text: 'ₙ', color: CYAN, italic: false },
    { text: ') / ', color: WHITE, italic: false },
    { text: "f'(x", color: PINK, italic: true },
    { text: 'ₙ', color: PINK, italic: false },
    { text: ')', color: PINK, italic: true },
  ], 194, 92, MATH);

  drawTokensCentered([
    { text: 'f(x) = ', color: WHITE, italic: false },
    { text: 'x³', color: CYAN, italic: true },
    { text: ' − 2x + ', color: WHITE, italic: false },
    { text: '0.5', color: PINK, italic: false },
    { text: '     ', color: WHITE, italic: false },
    { text: "f'(x) = ", color: DIM, italic: false },
    { text: '3x² − 2', color: AMBER, italic: true },
  ], 318, 52, MATH);
  ctx.restore();

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  ctx.font = `normal 38px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.46)';
  ctx.fillText('tangent projection  →  root convergence', W / 2, 396);

  const barX = 112, barY = 470, barW = W - 224, barH = 9;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,190,50,0.84)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW * loop, barH, 5); ctx.fill();
  ctx.restore();
}

function drawDivider() {
  push();
  stroke(255, 255, 255, 24);
  strokeWeight(1);
  line(70, FORMULA_H, W - 70, FORMULA_H);
  pop();
}

function drawVignette() {
  push();
  noFill();
  const steps = 55;
  const maxR = dist(W / 2, H / 2, 0, 0) * 1.1;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.68, 1.0, 0, 100, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ─────────────────────────────────────────────────────────────
function keyReleased() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('newtons_method_field_' + ts(), 'png');
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
  a.download = 'newtons_method_field_' + ts() + '.mp4';
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

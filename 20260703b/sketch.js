'use strict';

// ─── Canvas ──────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = FPS * 10;
const TAU = Math.PI * 2;

// ─── Palette ─────────────────────────────────────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

// Per-cevian colors — tied to the matching HUD ratio label
const COL_AD = { r: 0,   g: 229, b: 255 };  // cyan   — cevian A-D, ratio BD/DC
const COL_BE = { r: 255, g: 61,  b: 191 };  // magenta — cevian B-E, ratio CE/EA
const COL_CF = { r: 182, g: 255, b: 61  };  // acid-green — cevian C-F, ratio AF/FB

// ─── Ceva's Theorem constants ──────────────────────────────────────────────────
const CEVA = {
  TRI_SCALE: 185,   // circumradius-ish, px (sized to fit the visible band at CAM_DIST=900, FOV=0.55)
  ORBIT_R:   0.24,  // orbit radius in barycentric space
  CAM_FOV:   0.55,
  CAM_DIST:  900,
};

// ─── Buffers ──────────────────────────────────────────────────────────────────
let pg, glowPg, halfPg, quartPg, eighthPg, grainPg, overlayPg;
let canvasEl = null;

// ─── Simulation state ─────────────────────────────────────────────────────────
let A, B, C;            // triangle vertices, fixed for the whole loop, {x,y,z:0}
let orbitTrailPts = [];  // precomputed closed path of P, world-space {x,y}

// ─── Recording ───────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  if (typeof setAttributes === 'function') {
    setAttributes({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  }

  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) wrap.appendChild(canvasEl);

  pg = createGraphics(W, H, WEBGL);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);

  glowPg = createGraphics(W, H, WEBGL);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);

  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  halfPg.colorMode(RGB, 255, 255, 255, 255);

  quartPg = createGraphics(W >> 2, H >> 2);
  quartPg.pixelDensity(1);
  quartPg.colorMode(RGB, 255, 255, 255, 255);

  eighthPg = createGraphics(W >> 3, H >> 3);
  eighthPg.pixelDensity(1);
  eighthPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  grainPg.colorMode(RGB, 255, 255, 255, 255);

  overlayPg = createGraphics(W, H);
  overlayPg.pixelDensity(1);
  overlayPg.colorMode(RGB, 255, 255, 255, 255);

  bakeGrain();
  initTriangle();

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

// ─── Triangle + orbit trail initialisation ───────────────────────────────────
function initTriangle() {
  const S = CEVA.TRI_SCALE;
  A = { x: 0,               y: -S * 0.62, z: 0 };  // apex, above center
  B = { x: -S * 0.58,       y:  S * 0.42, z: 0 };  // base-left
  C = { x:  S * 0.58,       y:  S * 0.42, z: 0 };  // base-right

  orbitTrailPts = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    const loop = i / N;
    const bary = getBary(loop);
    const P = baryToWorld(bary.a, bary.b, bary.g);
    orbitTrailPts.push({ x: P.x, y: P.y });
  }
}

// ─── Barycentric orbit path — closed, integer-k periodic (seamless loop) ─────
// u, v: orthonormal basis of the plane a+b+g=0 (tangent plane of the 2-simplex)
const U_BASIS = { x: 1 / Math.SQRT2, y: -1 / Math.SQRT2, z: 0 };
const V_BASIS = { x: 1 / Math.sqrt(6), y: 1 / Math.sqrt(6), z: -2 / Math.sqrt(6) };

function getBary(loop) {
  const t = TAU * loop;
  const r = CEVA.ORBIT_R;
  const co = Math.cos(t), si = Math.sin(t);
  const a = 1 / 3 + r * (co * U_BASIS.x + si * V_BASIS.x);
  const b = 1 / 3 + r * (co * U_BASIS.y + si * V_BASIS.y);
  const g = 1 / 3 + r * (co * U_BASIS.z + si * V_BASIS.z);
  return { a, b, g };
}

function baryToWorld(a, b, g) {
  return {
    x: a * A.x + b * B.x + g * C.x,
    y: a * A.y + b * B.y + g * C.y,
    z: 0,
  };
}

// ─── Cevian feet (D, E, F) and ratios — proves Ceva's theorem live ───────────
function computeCevianFeet(bary) {
  const { a, b, g } = bary;
  const D = { x: (b * B.x + g * C.x) / (b + g), y: (b * B.y + g * C.y) / (b + g), z: 0 };
  const E = { x: (g * C.x + a * A.x) / (g + a), y: (g * C.y + a * A.y) / (g + a), z: 0 };
  const F = { x: (a * A.x + b * B.x) / (a + b), y: (a * A.y + b * B.y) / (a + b), z: 0 };
  return { D, E, F };
}

function computeRatios(bary) {
  const { a, b, g } = bary;
  const bdDc = g / b;
  const ceEa = a / g;
  const afFb = b / a;
  const product = bdDc * ceEa * afFb;
  return { bdDc, ceEa, afFb, product };
}

// ─── Math helpers ─────────────────────────────────────────────────────────────
function smoothstep(t) { const k = clamp01(t); return k * k * (3 - 2 * k); }
function clamp01(t)     { return Math.max(0, Math.min(1, t)); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  const count = Math.floor(W * H * 0.0009);
  for (let i = 0; i < count; i++) {
    const v = 130 + Math.random() * 80;
    grainPg.fill(v, v, v, 2 + Math.random() * 4);
    grainPg.circle(Math.random() * W, Math.random() * H, 0.2 + Math.random() * 0.55);
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop  = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  const phase = loop * TAU;

  const bary = getBary(loop);
  const P = baryToWorld(bary.a, bary.b, bary.g);
  const { D, E, F } = computeCevianFeet(bary);
  const ratios = computeRatios(bary);

  pg.clear();
  glowPg.clear();
  overlayPg.clear();

  renderCevaScene(loop, phase, P, D, E, F);
  drawHUD(loop, bary, ratios);
  drawVignette();
  compositeFrame();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Scene rendering ──────────────────────────────────────────────────────────
function renderCevaScene(loop, phase, P, D, E, F) {
  prepCameraStatic(glowPg);
  prepCameraStatic(pg);

  // Glow pass
  glowPg.push();
  glowPg.blendMode(ADD);
  drawOrbitTrail(glowPg, true);
  drawTriangleEdges(glowPg, true);
  drawCevians(glowPg, P, D, E, F, true);
  drawVertexMarkers(glowPg, P, D, E, F, true);
  glowPg.pop();

  // Sharp pass
  pg.push();
  pg.blendMode(BLEND);
  drawOrbitTrail(pg, false);
  drawTriangleEdges(pg, false);
  drawCevians(pg, P, D, E, F, false);
  drawVertexMarkers(pg, P, D, E, F, false);
  pg.pop();
}

function prepCameraStatic(g) {
  const gl = g.drawingContext;
  gl.enable(gl.DEPTH_TEST);
  g.resetMatrix();

  // Scene visible zone: from y=HUD_TOP_H to y=H-HUD_BOT_H
  // Mid of that zone in pixels: (HUD_TOP_H + H - HUD_BOT_H) / 2
  // Canvas centre in pixels: H / 2
  // Offset in pixels, converted to world-Y at cam distance, shifts the
  // look-at target so the scene renders centred in the visible band.
  const sceneMidPx  = (HUD_TOP_H + (H - HUD_BOT_H)) / 2;
  const canvasMidPx = H / 2;
  const pixelOffset = sceneMidPx - canvasMidPx;
  const fovHalfTan  = Math.tan(CEVA.CAM_FOV / 2);
  const worldOffset = pixelOffset * (2 * fovHalfTan * CEVA.CAM_DIST) / H;

  g.perspective(CEVA.CAM_FOV, W / H, 10, 4000);
  g.camera(0, -140, CEVA.CAM_DIST, 0, worldOffset, 0, 0, 1, 0);
}

// ─── 1. Triangle edges ────────────────────────────────────────────────────────
function drawTriangleEdges(g, isGlow) {
  const alpha = isGlow ? 14 : 90;
  const wt    = isGlow ? 7 : 1.6;
  g.push();
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, alpha);
  g.strokeWeight(wt);
  g.line(A.x, A.y, A.z, B.x, B.y, B.z);
  g.line(B.x, B.y, B.z, C.x, C.y, C.z);
  g.line(C.x, C.y, C.z, A.x, A.y, A.z);
  g.pop();
}

// ─── 2. Cevians AD, BE, CF — each color-coded to its HUD ratio label ─────────
function drawCevians(g, P, D, E, F, isGlow) {
  const alpha = isGlow ? 22 : 92;
  const wt    = isGlow ? 6 : 1.4;
  g.push();
  g.noFill();
  g.strokeWeight(wt);

  g.stroke(COL_AD.r, COL_AD.g, COL_AD.b, alpha);
  g.line(A.x, A.y, A.z, D.x, D.y, D.z);

  g.stroke(COL_BE.r, COL_BE.g, COL_BE.b, alpha);
  g.line(B.x, B.y, B.z, E.x, E.y, E.z);

  g.stroke(COL_CF.r, COL_CF.g, COL_CF.b, alpha);
  g.line(C.x, C.y, C.z, F.x, F.y, F.z);

  g.pop();
}

// ─── 3. Vertex / foot / P markers ─────────────────────────────────────────────
function drawVertexMarkers(g, P, D, E, F, isGlow) {
  const corners = [A, B, C];
  // Each foot colored to match its own cevian: D on AD (cyan), E on BE (magenta), F on CF (green)
  const feet    = [{ v: D, c: COL_AD }, { v: E, c: COL_BE }, { v: F, c: COL_CF }];

  g.push();
  g.noStroke();

  for (const v of corners) {
    g.push();
    g.translate(v.x, v.y, v.z);
    g.fill(INK_R, INK_G, INK_B, isGlow ? 20 : 200);
    g.sphere(isGlow ? 16 : 6);
    g.pop();
  }

  for (const { v, c } of feet) {
    g.push();
    g.translate(v.x, v.y, v.z);
    g.fill(c.r, c.g, c.b, isGlow ? 24 : 220);
    g.sphere(isGlow ? 13 : 5.5);
    g.pop();
  }

  // P — the concurrency point, brightest marker in the scene
  g.push();
  g.translate(P.x, P.y, P.z);
  if (isGlow) {
    g.fill(INK_R, INK_G, INK_B, 55);
    g.sphere(30);
  } else {
    g.fill(INK_R, INK_G, INK_B, 255);
    g.sphere(9);
  }
  g.pop();

  g.pop();
}

// ─── 4. Orbit trail of P (fixed closed curve, drawn identically every frame) ─
function drawOrbitTrail(g, isGlow) {
  const alpha = isGlow ? 5 : 34;
  const wt    = isGlow ? 4 : 0.6;
  g.push();
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, alpha);
  g.strokeWeight(wt);
  const n = orbitTrailPts.length;
  for (let i = 0; i < n; i++) {
    if (i % 2 === 1) continue;  // dashed look
    const p0 = orbitTrailPts[i];
    const p1 = orbitTrailPts[(i + 1) % n];
    g.line(p0.x, p0.y, 0, p1.x, p1.y, 0);
  }
  g.pop();
}

// ─── Composite ────────────────────────────────────────────────────────────────
function compositeFrame() {
  background(BG_R, BG_G, BG_B);

  halfPg.clear();
  halfPg.image(glowPg, 0, 0, W >> 1, H >> 1);
  quartPg.clear();
  quartPg.image(halfPg, 0, 0, W >> 2, H >> 2);
  eighthPg.clear();
  eighthPg.image(quartPg, 0, 0, W >> 3, H >> 3);

  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 55);
  image(eighthPg, 0, 0, W, H);
  tint(255, 90);
  image(quartPg, 0, 0, W, H);
  tint(255, 190);
  image(halfPg, 0, 0, W, H);
  noTint();
  image(pg, 0, 0, W, H);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 9);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();

  image(overlayPg, 0, 0, W, H);
}

// ─── HUD overlay ─────────────────────────────────────────────────────────────
// Layout constants for HUD panels
// IG safe-zone margins (2026 organic feed/Reels): keep critical text out of the
// top ~220-270px and bottom ~450-480px, since Instagram's own UI (nav/username
// bar up top, caption+like/comment/share row at bottom) overlaps those bands.
const HUD_TOP_H    = 300;  // height of dark top strip (was 280)
const HUD_BOT_H    = 480;  // height of dark bottom strip (was 400)
const SAFE_TOP     = 90;   // extra pixels pushed down from true top edge before any text starts
const SAFE_BOT     = 60;   // extra pixels pulled up from true bottom edge before any text ends

// Draws a tight inline sequence of tokens (equation-style), each optionally
// colored, centered as one group on canvas x = W/2 at the given y (top baseline).
function drawColoredEquationRow(ctx, y, tokens, whiteAlpha) {
  const widths = tokens.map(t => ctx.measureText(t.text).width);
  const total  = widths.reduce((a, b) => a + b, 0);
  let x = W / 2 - total / 2;
  ctx.textAlign = 'left';
  for (let i = 0; i < tokens.length; i++) {
    const { text, c } = tokens[i];
    ctx.fillStyle = c ? `rgba(${c.r},${c.g},${c.b},${whiteAlpha})` : `rgba(255,255,255,${whiteAlpha})`;
    ctx.fillText(text, x, y);
    x += widths[i];
  }
}

// Draws space-separated colored tokens (each token its own color), centered
// as one group on canvas x = W/2 at the given y (alphabetic baseline).
function drawColoredTokenRow(ctx, mono, y, tokens) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `normal 20px ${mono}`;
  const gap = 28;
  const widths = tokens.map(t => ctx.measureText(t.text).width);
  const total  = widths.reduce((a, b) => a + b, 0) + gap * (tokens.length - 1);
  let x = W / 2 - total / 2;
  ctx.textAlign = 'left';
  for (let i = 0; i < tokens.length; i++) {
    const { text, c } = tokens[i];
    ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},0.85)`;
    ctx.fillText(text, x, y);
    x += widths[i] + gap;
  }
  ctx.restore();
}

function drawHUD(loop, bary, ratios) {
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const ctx  = overlayPg.drawingContext;
  const bm   = 52;   // bracket / text margin from canvas edge
  const bk   = 60;   // bracket arm length

  // ── Dark top panel
  ctx.save();
  ctx.fillStyle = `rgba(${BG_R},${BG_G},${BG_B},0.82)`;
  ctx.fillRect(0, 0, W, HUD_TOP_H);
  ctx.restore();

  // ── Dark bottom panel
  ctx.save();
  ctx.fillStyle = `rgba(${BG_R},${BG_G},${BG_B},0.82)`;
  ctx.fillRect(0, H - HUD_BOT_H, W, HUD_BOT_H);
  ctx.restore();

  // ── Separator lines
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.moveTo(72, HUD_TOP_H); ctx.lineTo(W - 72, HUD_TOP_H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(72, H - HUD_BOT_H); ctx.lineTo(W - 72, H - HUD_BOT_H); ctx.stroke();
  ctx.restore();

  // ── Corner brackets — top-left
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(bm + bk, bm); ctx.lineTo(bm, bm); ctx.lineTo(bm, bm + bk);
  ctx.stroke();
  ctx.restore();

  // ── Corner brackets — top-right
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(W - bm - bk, bm); ctx.lineTo(W - bm, bm); ctx.lineTo(W - bm, bm + bk);
  ctx.stroke();
  ctx.restore();

  // ── Corner brackets — bottom-left
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(bm + bk, H - bm); ctx.lineTo(bm, H - bm); ctx.lineTo(bm, H - bm - bk);
  ctx.stroke();
  ctx.restore();

  // ── Corner brackets — bottom-right
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.4;
  ctx.beginPath();
  ctx.moveTo(W - bm - bk, H - bm); ctx.lineTo(W - bm, H - bm); ctx.lineTo(W - bm, H - bm - bk);
  ctx.stroke();
  ctx.restore();

  // ── Top strip: title — two rows, ASCII only for reliable rendering
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.font         = `normal 30px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.82)';
  ctx.fillText("CEVA'S THEOREM", W / 2, 52 + SAFE_TOP);
  ctx.font      = `normal 19px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.36)';
  ctx.fillText('CONCURRENT CEVIAN SIMULATOR', W / 2, 94 + SAFE_TOP);
  ctx.restore();

  // ── Top strip: formula rows — all ASCII, no Unicode math glyphs
  const loopStr = loop.toFixed(3);
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = `normal 20px ${MONO}`;
  drawColoredEquationRow(ctx, 132 + SAFE_TOP, [
    { text: 'BD/DC', c: COL_AD },
    { text: ' * ',    c: null },
    { text: 'CE/EA', c: COL_BE },
    { text: ' * ',    c: null },
    { text: 'AF/FB', c: COL_CF },
    { text: ' = 1',   c: null },
  ], 0.50);
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.font      = `normal 17px ${MONO}`;
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.fillText(`loop=${loopStr}`, W / 2, 165 + SAFE_TOP);
  ctx.restore();
  ctx.restore();

  // ── Top strip: loop progress bar
  const pbX = 112, pbY = 230 + SAFE_TOP, pbW = W - 224, pbH = 4;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.roundRect(pbX, pbY, pbW, pbH, 3); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.60)';
  ctx.beginPath(); ctx.roundRect(pbX, pbY, pbW * loop, pbH, 3); ctx.fill();
  ctx.restore();

  // ── Bottom strip: layout built from the bottom upward
  const footY   = H - 48 - SAFE_BOT;   // baseline for footer row, pulled up out of IG's caption/button zone
  const rowsY   = footY - 46;        // ratio breakdown rows above footer
  const prodY   = rowsY - 96;        // big product number above ratio rows
  const lblY    = prodY - 100;       // section label above product number

  // Footer text — barycentric coords left, date+title right
  ctx.save();
  ctx.font         = `normal 22px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.65)';
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  const baryStr = `(a,b,g)=(${bary.a.toFixed(2)}, ${bary.b.toFixed(2)}, ${bary.g.toFixed(2)})`;
  ctx.fillText(baryStr, 72, footY);

  ctx.textAlign = 'right';
  ctx.fillText("20260703  CEVA'S THEOREM", W - 72, footY);
  ctx.restore();

  // Ratio breakdown row — each term colored to match its cevian
  drawColoredTokenRow(ctx, MONO, rowsY, [
    { text: `BD/DC=${ratios.bdDc.toFixed(4)}`, c: COL_AD },
    { text: `CE/EA=${ratios.ceEa.toFixed(4)}`, c: COL_BE },
    { text: `AF/FB=${ratios.afFb.toFixed(4)}`, c: COL_CF },
  ]);

  // Big product readout
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font         = `normal 64px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.92)';
  ctx.fillText(ratios.product.toFixed(5), W / 2, prodY);
  ctx.restore();

  // Section label above product number
  ctx.save();
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  ctx.font         = `normal 19px ${MONO}`;
  ctx.fillStyle    = 'rgba(255,255,255,0.36)';
  ctx.fillText('product of ratios', W / 2, lblY);
  ctx.restore();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  overlayPg.push();
  overlayPg.noFill();
  const steps = 55;
  const maxR  = dist(W / 2, H / 2, 0, 0) * 1.1;
  overlayPg.strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.68, 1.0, 0, 100, true);
    if (a <= 0) continue;
    overlayPg.stroke(0, 0, 0, a);
    overlayPg.circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  overlayPg.pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function keyReleased() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('ceva_theorem_' + ts(), 'png');
    return false;
  }
  return true;
}

// ─── Recording implementation ─────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer    === 'undefined') { alert('mp4-muxer not loaded.');     return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video:  { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (e)           => { console.error(e); isRecording = false; setStatus('Error', '#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording   = true;
  frameCount    = 0;
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = true;
  if (el('stopBtn'))  el('stopBtn').disabled  = false;
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
  a.download = 'ceva_theorem_' + ts() + '.mp4';
  a.click();
  encoder.close();
  encoder = null;
  muxer   = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn'))  el('stopBtn').disabled  = true;
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
  if (el('duration'))   el('duration').textContent   = (recFrameCount / FPS).toFixed(1);
  if (el('frameCount')) el('frameCount').textContent = recFrameCount;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
}

function setStatus(txt, c) {
  const el = document.getElementById('status');
  if (el) { el.textContent = txt; el.style.color = c; }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

window.startRecording = startRecording;
window.stopRecording  = stopRecording;
window.ts             = ts;

"use strict";

// ── Recording ─────────────────────────────────────────────────────────────
const CANVAS_W = 1080, CANVAS_H = 1920;
const FPS = 60, MAX_DURATION = 24, MAX_FRAMES = FPS * MAX_DURATION;
const ELLIPSE_STEPS = 220, HYPERBOLA_STEPS = 160;

// ── Palette ───────────────────────────────────────────────────────────────
const BG    = [10,  15,  13 ];
const MINT  = [0,   255, 135];
const CYAN  = [0,   212, 255];
const VIO   = [123, 47,  255];
const MAG   = [255, 45,  122];
const ECHO  = [176, 255, 232];
const ICE   = [224, 247, 255];
const NAVY  = [26,  26,  46 ];
const ABYSS = [13,  33,  55 ];
const BIOGRN= [13,  59,  46 ];

let W, H;
let muxer = null, encoder = null;
let isRecording = false, recordingFrameCount = 0;
let canvasEl;
let fc = 0, pg;
let families = [];

// ──────────────────────────────────────────────────────────────────────────
//  CONFOCAL CONIC FAMILIES
//  Ellipses:   x²/a² + y²/b² = 1   b² = a²−c²   (a > c)
//  Hyperbolas: x²/a² − y²/b² = 1   b² = c²−a²   (c > a)
//  Same c → same two foci → the grid is always orthogonal at intersections
// ──────────────────────────────────────────────────────────────────────────

function buildFamilies() {
  const cx = W * 0.5, cy = H * 0.5, sc = Math.min(W, H);
  families = [
    { ellCol: MINT,  hypCol: VIO,
      cOrbR: sc*.08, cOrbSp: 0.0009, cOrbPh: 0,
      axSp:  0.0006, axPh:  0,
      cBase: sc*.14, cAmp:  sc*.040, cSp: 0.0011, cPh: 0,
      ellN:  7,      hypN:  6,  cx, cy },

    { ellCol: CYAN,  hypCol: MAG,
      cOrbR: sc*.06, cOrbSp: 0.0013, cOrbPh: Math.PI*.7,
      axSp:  0.0009, axPh:  Math.PI*1.2,
      cBase: sc*.11, cAmp:  sc*.030, cSp: 0.0015, cPh: Math.PI*.5,
      ellN:  6,      hypN:  5,  cx, cy },

    { ellCol: ECHO,  hypCol: ICE,
      cOrbR: sc*.12, cOrbSp: 0.0007, cOrbPh: Math.PI*1.4,
      axSp:  0.0004, axPh:  Math.PI*.6,
      cBase: sc*.17, cAmp:  sc*.050, cSp: 0.0008, cPh: Math.PI*1.1,
      ellN:  8,      hypN:  6,  cx, cy },
  ];
}

function evalFam(fam) {
  const ox  = fam.cx + fam.cOrbR * Math.cos(fam.cOrbSp * fc + fam.cOrbPh);
  const oy  = fam.cy + fam.cOrbR * Math.sin(fam.cOrbSp * fc + fam.cOrbPh);
  const ax  = fam.axSp * fc + fam.axPh;
  const c   = fam.cBase + fam.cAmp * Math.sin(fam.cSp * fc + fam.cPh);
  const cA  = Math.cos(ax), sA = Math.sin(ax);
  return { ox, oy, cA, sA, c,
           f1x: ox + c*cA, f1y: oy + c*sA,
           f2x: ox - c*cA, f2y: oy - c*sA };
}

// ── Setup ─────────────────────────────────────────────────────────────────
function setup() {
  W = CANVAS_W;
  H = CANVAS_H;
  canvasEl = createCanvas(W, H).elt;
  pixelDensity(1); frameRate(FPS); colorMode(RGB, 255);
  strokeJoin(ROUND); strokeCap(ROUND);

  pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255);
  pg.strokeJoin(ROUND); pg.strokeCap(ROUND);
  buildFamilies();
  seedBackground();

  const el = document.getElementById("maxDuration");
  if (el) el.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function seedBackground() {
  const cx = W*.5, cy = H*.5, sc = Math.min(W, H);
  const rng = makeRng(20260304);
  pg.background(...BG);
  pg.noStroke();

  const ctx = pg.drawingContext;
  ctx.save();

  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0.00, "rgba(26, 26, 46, 0.34)");
  wash.addColorStop(0.42, "rgba(13, 59, 46, 0.10)");
  wash.addColorStop(1.00, "rgba(13, 33, 55, 0.38)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  const coreGlow = ctx.createRadialGradient(cx, cy, sc * 0.08, cx, cy, sc * 0.84);
  coreGlow.addColorStop(0.00, "rgba(13, 59, 46, 0.30)");
  coreGlow.addColorStop(0.30, "rgba(26, 26, 46, 0.18)");
  coreGlow.addColorStop(0.72, "rgba(13, 33, 55, 0.08)");
  coreGlow.addColorStop(1.00, "rgba(10, 15, 13, 0.00)");
  ctx.fillStyle = coreGlow;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  for (let r = sc*.92; r > 0; r -= 18) {
    const t = r / (sc*.92);
    const col = t > .45
      ? mixColor(NAVY, BIOGRN, (t - .45) / .55)
      : mixColor(BIOGRN, ABYSS, t / .45);
    pg.fill(...col, map(r, 0, sc*.92, 24, 0));
    pg.ellipse(cx, cy, r*2.05, r*1.42);
  }

  pg.push();
  pg.translate(cx - W * 0.06, cy - H * 0.05);
  pg.rotate(-0.34);
  pg.fill(...NAVY, 24);
  pg.ellipse(0, 0, sc * 1.28, sc * 0.42);
  pg.fill(...BIOGRN, 14);
  pg.ellipse(sc * 0.06, sc * 0.02, sc * 0.96, sc * 0.22);
  pg.pop();

  pg.push();
  pg.translate(cx + W * 0.08, cy + H * 0.08);
  pg.rotate(0.62);
  pg.fill(...ABYSS, 22);
  pg.ellipse(0, 0, sc * 0.92, sc * 0.30);
  pg.pop();

  const dustCols = [MINT, CYAN, ECHO, ICE, VIO];
  for (let i = 0; i < 240; i++) {
    const ang = rng() * TWO_PI;
    const rad = Math.pow(rng(), 0.82) * sc * 0.92;
    const sx = 0.62 + rng() * 0.58;
    const sy = 0.58 + rng() * 0.66;
    const x = cx + Math.cos(ang) * rad * sx + (rng() - 0.5) * W * 0.04;
    const y = cy + Math.sin(ang) * rad * sy + (rng() - 0.5) * H * 0.04;
    const col = dustCols[Math.floor(rng() * dustCols.length)];
    const alpha = 5 + rng() * 15;
    const size = rng() < 0.14 ? 2.2 : 1.2;

    pg.fill(...col, alpha);
    pg.circle(x, y, size);
    if (rng() < 0.14) {
      pg.fill(...col, alpha * 0.25);
      pg.circle(x, y, size * 3.8);
    }
  }

  // Faint static confocal skeleton baked into background
  const c0 = sc * 0.14, ang = Math.PI * 0.25;
  const cA0 = Math.cos(ang), sA0 = Math.sin(ang);
  pg.noFill();
  for (let i = 0; i < 6; i++) {
    const a = c0*(1.2 + i*.65), b = Math.sqrt(a*a - c0*c0);
    pg.stroke(...MINT, 4 + i * 0.4); pg.strokeWeight(0.35);
    pgEllipse(cx, cy, a, b, cA0, sA0);
  }
  for (let i = 0; i < 5; i++) {
    const a = c0*(.08 + i*.22), b = Math.sqrt(c0*c0 - a*a);
    pg.stroke(...VIO, 3.5 + i * 0.35); pg.strokeWeight(0.35);
    pgHyperbola(cx, cy, a, b, cA0, sA0);
  }

  ctx.save();
  const vignette = ctx.createRadialGradient(cx, cy, sc * 0.16, cx, cy, Math.max(W, H) * 0.82);
  vignette.addColorStop(0.00, "rgba(10, 15, 13, 0.00)");
  vignette.addColorStop(0.68, "rgba(10, 15, 13, 0.08)");
  vignette.addColorStop(1.00, "rgba(10, 15, 13, 0.74)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  pg.noStroke();
}

// Pg-context conic helpers
function pgEllipse(cx, cy, a, b, cA, sA) {
  pg.beginShape();
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const t = (i/ELLIPSE_STEPS)*TWO_PI;
    const lx = a*Math.cos(t), ly = b*Math.sin(t);
    pg.vertex(cx + lx*cA - ly*sA, cy + lx*sA + ly*cA);
  }
  pg.endShape(CLOSE);
}

function pgHyperbola(cx, cy, a, b, cA, sA) {
  const T = 2.8;
  for (let sg = 1; sg >= -1; sg -= 2) {
    let open = false;
    for (let i = 0; i <= HYPERBOLA_STEPS; i++) {
      const t  = -T + (i/HYPERBOLA_STEPS)*T*2;
      const lx = sg * a * Math.cosh(t), ly = b * Math.sinh(t);
      const x  = cx + lx*cA - ly*sA, y = cy + lx*sA + ly*cA;
      const ok = x > -50 && x < W+50 && y > -50 && y < H+50;
      if (ok) { if (!open) { pg.beginShape(); open = true; } pg.vertex(x, y); }
      else if (open) { pg.endShape(); open = false; }
    }
    if (open) pg.endShape();
  }
}

// ── Draw ──────────────────────────────────────────────────────────────────
function draw() {
  const phase = (fc % MAX_FRAMES) / MAX_FRAMES;
  const t     = phase * TWO_PI;
  fc++;

  image(pg, 0, 0);
  noFill();

  const states = families.map(evalFam);

  blendMode(ADD);
  for (let fi = 0; fi < families.length; fi++) {
    drawFieldAura(families[fi], states[fi], t, fi);
  }
  blendMode(BLEND);

  for (let fi = 0; fi < families.length; fi++) {
    drawFamily(families[fi], states[fi], fi);
  }

  blendMode(ADD);
  for (let fi = 0; fi < families.length; fi++) {
    drawTravelers(families[fi], states[fi], t, fi);
  }
  blendMode(BLEND);

  for (let fi = 0; fi < families.length; fi++) {
    const { f1x, f1y, f2x, f2y } = states[fi];
    drawFocus(f1x, f1y, families[fi].ellCol, t);
    drawFocus(f2x, f2y, families[fi].ellCol, t);
  }

  drawHUD(phase);

  if (isRecording) {
    captureFrame(); recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ── Conic family renderer ─────────────────────────────────────────────────
function drawFieldAura(fam, { ox, oy, cA, sA, c }, t, index) {
  const axis = Math.atan2(sA, cA);
  const breath = 0.84 + 0.16 * Math.sin(t * 1.7 + index * 1.3);

  push();
  translate(ox, oy);
  rotate(axis);
  noStroke();
  fill(...fam.ellCol, 6 * breath);
  ellipse(0, 0, c * (4.4 + index * 0.12), c * 1.24);
  fill(...fam.hypCol, 4 * breath);
  ellipse(0, 0, c * 1.36, c * 3.9);
  stroke(...fam.hypCol, 10 * breath);
  strokeWeight(Math.max(1, Math.min(W, H) * 0.0011));
  line(-c * 1.75, 0, c * 1.75, 0);
  pop();
}

function drawFamily(fam, { ox, oy, cA, sA, c }, index) {
  const [er, eg, eb] = fam.ellCol;
  const [hr, hg, hb] = fam.hypCol;
  const sc = Math.min(W, H);
  const pulse = 0.72 + 0.28 * Math.sin(fc * 0.032 + index * 0.8);
  const wave  = fc * 0.026 + index * 0.95;
  const glowW = Math.max(6, sc * 0.011);
  const filamentW = Math.max(1.35, sc * 0.0024);
  const coreW = Math.max(0.72, sc * 0.0011);

  for (let i = 0; i < fam.ellN; i++) {
    const tt = i / (fam.ellN - 1);
    const a  = c * (1.12 + tt * 2.40);
    const b  = Math.sqrt(a*a - c*c);
    const al = pulse * (1 - tt * .55) * (0.78 + 0.22 * Math.sin(wave - i * 0.58));

    stroke(er, eg, eb,   5 * al); strokeWeight(glowW - tt * sc * 0.0018); mEllipse(ox, oy, a, b, cA, sA);
    stroke(er, eg, eb,  22 * al); strokeWeight(filamentW + (1 - tt) * 0.55); mEllipse(ox, oy, a, b, cA, sA);
    stroke(er, eg, eb, 102 * al); strokeWeight(coreW); mEllipse(ox, oy, a, b, cA, sA);
    stroke(...ICE, 6 * al * (1 - tt * 0.45)); strokeWeight(coreW * 0.72); mEllipse(ox, oy, a, b, cA, sA);
  }

  for (let i = 0; i < fam.hypN; i++) {
    const tt = i / (fam.hypN - 1);
    const a  = c * (0.06 + tt * .88);
    const b  = Math.sqrt(c*c - a*a);
    const al = pulse * (.45 + tt * .55) * (0.78 + 0.22 * Math.sin(wave - i * 0.78 + 1.1));

    stroke(hr, hg, hb,  5 * al); strokeWeight(glowW * 0.92 - tt * sc * 0.0015); mHyperbola(ox, oy, a, b, cA, sA);
    stroke(hr, hg, hb, 20 * al); strokeWeight(filamentW + tt * 0.45); mHyperbola(ox, oy, a, b, cA, sA);
    stroke(hr, hg, hb, 94 * al); strokeWeight(coreW); mHyperbola(ox, oy, a, b, cA, sA);
    stroke(...ICE, 5 * al * (0.3 + tt * 0.4)); strokeWeight(coreW * 0.7); mHyperbola(ox, oy, a, b, cA, sA);
  }

  noStroke();
}

// Main-canvas conic helpers
function mEllipse(cx, cy, a, b, cA, sA) {
  beginShape();
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const t  = (i/ELLIPSE_STEPS)*TWO_PI;
    const lx = a*Math.cos(t), ly = b*Math.sin(t);
    vertex(cx + lx*cA - ly*sA, cy + lx*sA + ly*cA);
  }
  endShape(CLOSE);
}

function mHyperbola(cx, cy, a, b, cA, sA) {
  const T = 2.8;
  for (let sg = 1; sg >= -1; sg -= 2) {
    let open = false;
    for (let i = 0; i <= HYPERBOLA_STEPS; i++) {
      const t  = -T + (i/HYPERBOLA_STEPS)*T*2;
      const lx = sg * a * Math.cosh(t), ly = b * Math.sinh(t);
      const x  = cx + lx*cA - ly*sA, y = cy + lx*sA + ly*cA;
      const ok = x > -50 && x < W+50 && y > -50 && y < H+50;
      if (ok) { if (!open) { beginShape(); open = true; } vertex(x, y); }
      else if (open) { endShape(); open = false; }
    }
    if (open) endShape();
  }
}

function drawTravelers(fam, { ox, oy, cA, sA, c }, t, index) {
  const ellipseBands = [0.14, 0.46, 0.78];
  for (let i = 0; i < ellipseBands.length; i++) {
    const tt = ellipseBands[i];
    const a  = c * (1.12 + tt * 2.40);
    const b  = Math.sqrt(a*a - c*c);
    const ang = t * (1.06 + i * 0.16) + index * 1.7 + tt * TWO_PI;
    const pt = rotatePoint(ox, oy, a * Math.cos(ang), b * Math.sin(ang), cA, sA);
    glowDot(pt.x, pt.y, fam.ellCol, 2.4, 16 + i * 3, 0.82);
  }

  const hyperBands = [0.26, 0.68];
  for (let i = 0; i < hyperBands.length; i++) {
    const tt = hyperBands[i];
    const a  = c * (0.06 + tt * 0.88);
    const b  = Math.sqrt(c*c - a*a);
    const u  = 1.24 * Math.sin(t * (0.92 + i * 0.18) + index * 1.05 + i * 0.7);

    for (const sg of [1, -1]) {
      const pt = rotatePoint(ox, oy, sg * a * Math.cosh(u), b * Math.sinh(u), cA, sA);
      if (pt.x > -24 && pt.x < W + 24 && pt.y > -24 && pt.y < H + 24) {
        glowDot(pt.x, pt.y, fam.hypCol, 2.0, 13 + i * 3, 0.64);
      }
    }
  }
}

function rotatePoint(ox, oy, lx, ly, cA, sA) {
  return {
    x: ox + lx * cA - ly * sA,
    y: oy + lx * sA + ly * cA,
  };
}

function glowDot(x, y, col, core, glow, alpha) {
  noStroke();
  fill(col[0], col[1], col[2], 10 * alpha);
  ellipse(x, y, glow, glow);
  fill(col[0], col[1], col[2], 38 * alpha);
  ellipse(x, y, core * 2.4, core * 2.4);
  fill(255, 255, 255, 118 * alpha);
  ellipse(x, y, core, core);
}

// ── Focus marker ──────────────────────────────────────────────────────────
function drawFocus(x, y, col, t) {
  const [cr, cg, cb] = col;
  const p = 0.65 + 0.35 * Math.sin(t * 3.1 + x * 0.01);
  noStroke();
  fill(cr, cg, cb, 12*p); ellipse(x, y, 30, 30);
  fill(cr, cg, cb, 34*p); ellipse(x, y, 12, 12);
  noFill();
  stroke(cr, cg, cb, 48*p); strokeWeight(0.8);
  ellipse(x, y, 9.5, 9.5);
  stroke(255, 255, 255, 42*p);
  const s = 5.5;
  line(x-s, y, x+s, y); line(x, y-s, x, y+s);
  noStroke();
  fill(255, 255, 255, 118*p); ellipse(x, y, 2.2, 2.2);
}

// ── HUD ───────────────────────────────────────────────────────────────────
function drawHUD(phase) {
  noStroke(); textFont("monospace");
  fill(...MINT, 18 + 6*Math.sin(fc*.04));
  textSize(13); textAlign(RIGHT, TOP);
  text("CONFOCAL FIELDS", W - 26, 24);

  fill(...ICE, 11); textSize(10);
  text("x\u00B2/a\u00B2 + y\u00B2/b\u00B2 = 1   \u22A5   x\u00B2/a\u00B2 \u2212 y\u00B2/b\u00B2 = 1", W - 26, 42);

  fill(...ICE, 8); textSize(10);
  text("shared foci  \u00B7  orthogonal conic mesh", W - 26, 56);

  fill(...ICE, 17); textSize(10); textAlign(LEFT, BOTTOM);
  text("phase " + nf(phase * 100, 2, 0) + "%   \u00B7   time " + nf(phase*MAX_DURATION, 2, 1) + "s", 24, H - 26);
}

// ── Resize / keys ─────────────────────────────────────────────────────────
function windowResized() {
  updateCanvasInfo();
}
function keyPressed() {
  if (key === "r" || key === "R") isRecording ? stopRecording() : startRecording();
}

function mixColor(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// ── MP4 Recording ─────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported. Use Chrome/Edge."); return; }
  if (typeof Mp4Muxer    === "undefined") { alert("mp4-muxer failed to load."); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory", firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (err) => { console.error(err); setStatus("Encoder error", "#ff2d7a"); isRecording = false; },
  });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 16_000_000, framerate: FPS });
  fc = 0; recordingFrameCount = 0; isRecording = true;
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled  = false;
  setStatus("Recording MP4\u2026", "#00ff87");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus("Finalizing\u2026", "#aaa");
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "confocal_fields_20260304.mp4"; a.click();
  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled  = true;
  setStatus("Complete \u2713", "#00ff87");
  setTimeout(() => setStatus("Ready", "#aaa"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, color) {
  const el = document.getElementById("status");
  if (!el) return; el.textContent = text; el.style.color = color;
}
function updateRecordingUI() {
  const dEl = document.getElementById("duration"), fEl = document.getElementById("frameCount");
  if (dEl) dEl.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recordingFrameCount;
}
function updateCanvasInfo() {
  const el = document.getElementById("canvasSize");
  if (el) el.textContent = W + " \u00D7 " + H;
}

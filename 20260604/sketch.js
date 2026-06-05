'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W           = 1080;
const H           = 1920;
const FPS         = 60;
const MAX_DURATION = 30;
const MAX_FRAMES  = FPS * MAX_DURATION;
const TAU         = Math.PI * 2;

// ─── Layout ───────────────────────────────────────────────────────────────────
const FORMULA_H   = 960;          // formula zone height (top of canvas)
const SIM_Y       = FORMULA_H;
const SIM_H       = H - FORMULA_H;
const SIM_CX      = W / 2;
const SIM_CY      = SIM_Y + SIM_H / 2;
const SIM_R       = 440;

// ─── Lissajous ratios ─────────────────────────────────────────────────────────
const RATIOS = [
  { a: 1, b: 1, label: '1 : 1' },
  { a: 1, b: 2, label: '1 : 2' },
  { a: 2, b: 3, label: '2 : 3' },
  { a: 3, b: 4, label: '3 : 4' },
  { a: 3, b: 5, label: '3 : 5' },
  { a: 5, b: 6, label: '5 : 6' },
];
const RATIO_FRAMES = FPS * 5;
const TOTAL_LOOP   = RATIO_FRAMES * RATIOS.length;

// ─── Buffers ──────────────────────────────────────────────────────────────────
let pg, glowPg, halfPg, grainPg;
let prevX = null, prevY = null;
let canvasEl = null;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl  = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  const wrap = document.getElementById('canvas-wrap');
  if (wrap) wrap.appendChild(canvasEl);

  pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);
  pg.background(0);

  glowPg = createGraphics(W, H);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);
  glowPg.background(0);

  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  halfPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  bakeGrain();

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
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
  const fc     = frameCount % TOTAL_LOOP;
  const ridx   = floor(fc / RATIO_FRAMES);
  const rframe = fc % RATIO_FRAMES;
  const delta  = (rframe / RATIO_FRAMES) * TAU;
  const { a, b, label } = RATIOS[ridx];

  if (rframe === 0) {
    pg.background(0);
    glowPg.background(0);
    prevX = null; prevY = null;
  }

  // Fade sim zone trails
  pg.noStroke();
  pg.fill(0, 0, 0, 9);
  pg.rect(0, SIM_Y, W, SIM_H);

  glowPg.noStroke();
  glowPg.fill(0, 0, 0, 5);
  glowPg.rect(0, SIM_Y, W, SIM_H);

  drawLissajousPoint(a, b, delta);
  compositeFrame();
  drawFormulaZone(a, b, delta, label, ridx);
  drawDivider();
  drawVignette();

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

// ─── Lissajous ────────────────────────────────────────────────────────────────
// Accent colors match formula zone: amber = δ (phase), pink = b (y-freq)
const COL_A = [255, 190,  50];  // amber — matches δ label
const COL_B = [255,  70, 150];  // pink  — matches b label
const COL_C = [ 80, 220, 255];  // cyan accent

function lerpColor3(cA, cB, t) {
  return [
    cA[0] + (cB[0] - cA[0]) * t,
    cA[1] + (cB[1] - cA[1]) * t,
    cA[2] + (cB[2] - cA[2]) * t,
  ];
}

function drawLissajousPoint(a, b, delta) {
  const STEPS = 720;
  pg.strokeWeight(0.6);
  pg.noFill();

  // Pre-compute all vertices
  const xs = new Float32Array(STEPS + 1);
  const ys = new Float32Array(STEPS + 1);
  for (let i = 0; i <= STEPS; i++) {
    const tt = (i / STEPS) * TAU;
    xs[i] = SIM_CX + SIM_R * Math.sin(a * tt + delta);
    ys[i] = SIM_CY + SIM_R * Math.sin(b * tt);
  }

  // Draw segments with color interpolated amber → white → pink
  for (let i = 0; i < STEPS; i++) {
    const t = i / (STEPS - 1);
    let r, g, bl;
    if (t < 0.5) {
      [r, g, bl] = lerpColor3(COL_A, [255, 255, 255], t * 2);
    } else {
      [r, g, bl] = lerpColor3([255, 255, 255], COL_B, (t - 0.5) * 2);
    }
    pg.stroke(r, g, bl, 12);
    pg.line(xs[i], ys[i], xs[i + 1], ys[i + 1]);
  }

  const cx = SIM_CX + SIM_R * Math.sin(a * delta + delta);
  const cy = SIM_CY + SIM_R * Math.sin(b * delta);

  for (let r = 18; r >= 2; r -= 2) {
    glowPg.noStroke();
    glowPg.fill(255, 255, 255, map(r, 18, 2, 4, 60));
    glowPg.circle(cx, cy, r * 2);
  }

  pg.noStroke();
  pg.fill(255, 255, 255, 240);
  pg.circle(cx, cy, 7);

  if (prevX !== null) {
    pg.stroke(220, 220, 220, 180);
    pg.strokeWeight(1.8);
    pg.line(prevX, prevY, cx, cy);

    glowPg.stroke(200, 200, 200, 40);
    glowPg.strokeWeight(8);
    glowPg.line(prevX, prevY, cx, cy);
  }
  prevX = cx; prevY = cy;
}

// ─── Composite ────────────────────────────────────────────────────────────────
function compositeFrame() {
  noStroke();
  fill(0);
  rect(0, SIM_Y, W, SIM_H);

  halfPg.clear();
  halfPg.image(glowPg, 0, SIM_Y >> 1, W >> 1, SIM_H >> 1, 0, SIM_Y, W, SIM_H);

  drawingContext.globalCompositeOperation = 'screen';
  image(halfPg, 0, SIM_Y, W, SIM_H, 0, SIM_Y >> 1, W >> 1, SIM_H >> 1);
  image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 7);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

// ─── Formula zone (drawn on canvas → included in recording) ───────────────────
// All sizes are in canvas pixels. Canvas is 1080px wide, displayed at ~540px
// so multiply any "screen px" target by 2.
function drawFormulaZone(a, b, delta, ratioLabel, ridx) {
  noStroke();
  fill(6, 6, 10);
  rect(0, 0, W, FORMULA_H);

  push();
  textAlign(CENTER, CENTER);

  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

  // ── Section label  (screen ~26px → canvas 52px)
  const ctx = drawingContext;
  ctx.save();
  ctx.font      = `normal 52px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('LISSAJOUS FIGURE', W / 2, 60);
  ctx.restore();

  // ── Formula: use drawingContext for reliable sizing ───────────────────────────
  ctx.save();

  const SZ       = 110;   // screen ~55px  (110 * 540/1080)
  const FRAC_SZ  = 80;    // screen ~40px  for num/den
  const LINE_H   = 240;   // vertical spacing between the two formula lines
  const CY1      = 200;   // center-y of line 1
  const CY2      = CY1 + LINE_H;

  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';

  // draw fraction helper — returns total width consumed
  function drawFrac(num, den, x, cy) {
    ctx.font = `italic ${FRAC_SZ}px "Times New Roman", serif`;
    const nw  = ctx.measureText(num).width;
    const dw  = ctx.measureText(den).width;
    const fw  = Math.max(nw, dw) + 10;
    const gap = FRAC_SZ * 0.15;

    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillText(num, x + (fw - nw) / 2, cy - gap - FRAC_SZ * 0.52);
    ctx.fillText(den, x + (fw - dw) / 2, cy + gap + FRAC_SZ * 0.52);

    // fraction bar
    ctx.fillRect(x, cy - 1.5, fw, 3);
    return fw;
  }

  // inline text helper — returns new x
  function drawInl(str, x, cy, sz, color, italic) {
    ctx.font = `${italic ? 'italic' : 'normal'} ${sz}px "Times New Roman", serif`;
    ctx.fillStyle = color;
    ctx.fillText(str, x, cy);
    return x + ctx.measureText(str).width;
  }

  // ── Measure line 1 total width to center it
  ctx.font = `italic ${FRAC_SZ}px "Times New Roman", serif`;
  const fw1 = Math.max(ctx.measureText('dx').width, ctx.measureText('dt').width) + 10;
  ctx.font = `normal ${SZ}px "Times New Roman", serif`;
  const rest1 = ctx.measureText(' = sin(').width
              + ctx.measureText(String(a)).width
              + ctx.measureText('t + δ)').width;
  let cx = (W - fw1 - rest1) / 2;
  cx += drawFrac('dx', 'dt', cx, CY1);
  cx  = drawInl(' = sin(', cx, CY1, SZ, 'rgba(255,255,255,0.85)', false);
  cx  = drawInl(String(a), cx, CY1, SZ, 'rgba(255,255,255,1)',    true);
  cx  = drawInl('t + ',    cx, CY1, SZ, 'rgba(255,255,255,0.85)', false);
  cx  = drawInl('δ',  cx, CY1, SZ, 'rgba(255,200,60,1)',     true);
       drawInl(')',        cx, CY1, SZ, 'rgba(255,255,255,0.85)', false);

  // ── Measure line 2 total width to center it
  ctx.font = `italic ${FRAC_SZ}px "Times New Roman", serif`;
  const fw2 = Math.max(ctx.measureText('dy').width, ctx.measureText('dt').width) + 10;
  ctx.font = `normal ${SZ}px "Times New Roman", serif`;
  const rest2 = ctx.measureText(' = sin(').width
              + ctx.measureText(String(b)).width
              + ctx.measureText('t)').width;
  cx = (W - fw2 - rest2) / 2;
  cx += drawFrac('dy', 'dt', cx, CY2);
  cx  = drawInl(' = sin(', cx, CY2, SZ, 'rgba(255,255,255,0.85)', false);
  cx  = drawInl(String(b), cx, CY2, SZ, 'rgba(255,80,160,1)',     true);
       drawInl('t)',       cx, CY2, SZ, 'rgba(255,255,255,0.85)', false);

  ctx.restore();

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'center';

  // ── δ live value  (screen ~44px → canvas 88px)
  const dY = CY2 + 130;
  ctx.font      = `italic 88px "Times New Roman", serif`;
  ctx.fillStyle = 'rgba(255,200,60,0.85)';
  ctx.fillText('δ = ' + delta.toFixed(3) + ' rad', W / 2, dY);

  // ── Progress bar
  const barX = 80, barY = dY + 116, barW = W - 160, barH = 10;
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,200,60,0.85)';
  ctx.beginPath(); ctx.roundRect(barX, barY, barW * (delta / TAU), barH, 5); ctx.fill();

  // ── Ratio label  (screen ~24px → canvas 48px)
  const rY = barY + 60;
  ctx.font      = `normal 48px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('a : b  =  ' + ratioLabel, W / 2, rY);

  ctx.restore();

  // ── Ratio dots
  const dotSpacing = 88;
  const dotsX = W / 2 - (RATIOS.length - 1) * dotSpacing / 2;
  for (let i = 0; i < RATIOS.length; i++) {
    const dx = dotsX + i * dotSpacing;
    const dy = rY + 80;
    noStroke();
    if (i === ridx)    { fill(255, 200, 60, 240); circle(dx, dy, 28); }
    else if (i < ridx) { fill(255, 255, 255, 80);  circle(dx, dy, 20); }
    else               { fill(255, 255, 255, 25);  circle(dx, dy, 20); }
  }

  pop();
}

// ─── Divider ──────────────────────────────────────────────────────────────────
function drawDivider() {
  push();
  stroke(255, 255, 255, 28); strokeWeight(1);
  line(54, FORMULA_H, W - 54, FORMULA_H);
  pop();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push(); noFill();
  const steps = 55, maxR = dist(W / 2, H / 2, 0, 0) * 1.1;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.68, 1.0, 0, 100, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a); circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('lissajous_' + ts(), 'png'); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer     === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer   = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { console.error(e); isRecording = false; setStatus('Error', '#f44'); } });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0; isRecording = true;
  frameCount = 0;
  pg.background(0); glowPg.background(0);
  prevX = null; prevY = null;
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = true;
  if (el('stopBtn'))  el('stopBtn').disabled  = false;
  setStatus('Recording…', '#fff');
}
async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus('Finalizing…', '#ccc');
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'lissajous_' + ts() + '.mp4'; a.click();
  encoder.close(); encoder = null; muxer = null;
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
function setStatus(txt, c) { const el = document.getElementById('status'); if (el) { el.textContent = txt; el.style.color = c; } }
function ts() { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`; }

window.startRecording = startRecording;
window.stopRecording  = stopRecording;
window.ts             = ts;

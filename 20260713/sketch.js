'use strict';

// ─── Canvas / loop ───────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;

// ─── Existing project palette (unchanged) ───────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;
const CYAN    = { r: 0,   g: 229, b: 255 };
const MAGENTA = { r: 255, g: 61,  b: 191 };
const ACID    = { r: 182, g: 255, b: 61  };

const FIELD = { cx: W / 2, cy: 895, radius: 490, domain: 1.12 };
const HUD_TOP_H = 300;
const HUD_BOT_H = 430;

let sharpPg, glowPg, halfPg, quartPg, eighthPg, grainPg, overlayPg;
let canvasEl = null;
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;
let gammaDomainAngle = 0;
let gammaDomainShiftX = 0, gammaDomainShiftY = 0;

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

  sharpPg = makeLayer(W, H);
  glowPg = makeLayer(W, H);
  halfPg = makeLayer(W >> 1, H >> 1);
  quartPg = makeLayer(W >> 2, H >> 2);
  eighthPg = makeLayer(W >> 3, H >> 3);
  grainPg = makeLayer(W, H);
  overlayPg = makeLayer(W, H);
  bakeGrain();

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('maxFrames')) el('maxFrames').textContent = MAX_FRAMES;
}

function makeLayer(w, h) {
  const g = createGraphics(w, h);
  g.pixelDensity(1);
  g.colorMode(RGB, 255, 255, 255, 255);
  g.strokeCap(ROUND);
  g.strokeJoin(ROUND);
  return g;
}

// z represents one point x + yi on the Gauss plane.
// Main transformation: f(z) = e^(i*phi) * (z^3 - a) / (1 - a*z^3).
// phi makes the whole field rotate; a controls how strongly it folds inward.
function transformComplex(x, y, phi, a) {
  const z2r = x * x - y * y;
  const z2i = 2 * x * y;
  const z3r = z2r * x - z2i * y;
  const z3i = z2r * y + z2i * x;
  const nr = z3r - a, ni = z3i;
  const dr = 1 - a * z3r, di = -a * z3i;
  const den = dr * dr + di * di;
  const qr = (nr * dr + ni * di) / den;
  const qi = (ni * dr - nr * di) / den;
  const c = Math.cos(phi), s = Math.sin(phi);
  return { x: qr * c - qi * s, y: qr * s + qi * c };
}

function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  const pulse = 0.5 - 0.5 * Math.cos(TAU * loop);
  const phi = TAU * loop;
  const a = 0.44 + 0.22 * Math.sin(Math.PI * loop) ** 2;

  sharpPg.clear(); glowPg.clear(); overlayPg.clear();
  renderField(glowPg, loop, phi, a, true);
  renderField(sharpPg, loop, phi, a, false);
  drawOverlay(loop, phi, a, pulse);
  compositeFrame();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderField(g, loop, phi, a, glow) {
  drawGammaSurface(g, loop, glow);
}

function getGammaAnimationState(loop) {
  const t = TAU * loop;
  return {
    // Fixed camera: only the mathematics moves.
    theta: 0,
    // Closed figure-eight translation makes the Gamma poles rise in sequence.
    shiftX: 0.48 * Math.sin(t),
    shiftY: 0.24 * Math.sin(2 * t),
    azimuth: -0.76,
    elevation: 0.69,
  };
}

// The domain point is z = x + yi. Height is log(1 + |Gamma(z)|), capped only
// for display. The moving parameter is the camera azimuth; Gamma itself stays exact.
function drawGammaSurface(g, loop, glow) {
  const nx = 50, ny = 42;
  const state = getGammaAnimationState(loop);
  // The camera remains fixed so every visible change is caused by the formula.
  const azimuth = state.azimuth;
  const elevation = state.elevation;
  // Translation moves every pole; rotation is intentionally disabled.
  gammaDomainAngle = state.theta;
  // A closed complex translation also moves the pole at z=0, which rotation
  // alone can never move. Both components return exactly to zero at the loop.
  gammaDomainShiftX = state.shiftX;
  gammaDomainShiftY = state.shiftY;
  const cells = [];

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const x0 = lerp(-4.6, 4.6, ix / nx), x1 = lerp(-4.6, 4.6, (ix + 1) / nx);
      const y0 = lerp(-3.6, 3.6, iy / ny), y1 = lerp(-3.6, 3.6, (iy + 1) / ny);
      const q = [gammaVertex(x0,y0,azimuth,elevation), gammaVertex(x1,y0,azimuth,elevation),
                 gammaVertex(x1,y1,azimuth,elevation), gammaVertex(x0,y1,azimuth,elevation)];
      cells.push({ q, depth: q.reduce((s,v) => s + v.depth, 0) / 4 });
    }
  }
  cells.sort((a0, b0) => b0.depth - a0.depth);

  g.push();
  g.translate(FIELD.cx, FIELD.cy + 78);
  for (const cell of cells) {
    const q = cell.q;
    const h = q.reduce((s,v) => s + v.h, 0) / 4;
    const phase = q.reduce((s,v) => s + v.phase, 0) / 4;
    const col = phaseColor(phase, h);
    g.stroke(col.r, col.g, col.b, glow ? 20 : 80);
    g.strokeWeight(glow ? 5.5 : .72);
    g.fill(col.r, col.g, col.b, glow ? 7 : 34 + h * 12);
    g.beginShape();
    for (const v of q) g.vertex(v.sx, v.sy);
    g.endShape(CLOSE);
  }
  drawGammaAxes(g, azimuth, elevation, glow);
  g.pop();
}

function gammaVertex(x, y, azimuth, elevation) {
  const cd = Math.cos(gammaDomainAngle), sd = Math.sin(gammaDomainAngle);
  const inputX = x * cd - y * sd + gammaDomainShiftX;
  const inputY = x * sd + y * cd + gammaDomainShiftY;
  const gam = complexGamma(inputX, inputY);
  const rawMag = Math.hypot(gam.r, gam.i);
  const mag = Number.isFinite(rawMag) ? rawMag : 1e12;
  const h = Math.min(6.3, Math.log1p(mag) * 1.22);
  const rawPhase = Math.atan2(gam.i, gam.r);
  const phase = Number.isFinite(rawPhase) ? rawPhase : 0;
  const ca = Math.cos(azimuth), sa = Math.sin(azimuth);
  const rx = x * ca - y * sa;
  const depth = x * sa + y * ca;
  const ce = Math.cos(elevation), se = Math.sin(elevation);
  const scale = 76;
  return { sx: rx * scale, sy: (depth * se - h * ce) * scale, depth, h, phase };
}

// Lanczos approximation of Gamma(z), with the reflection formula for Re(z)<0.5.
function complexGamma(x, y) {
  const p = [0.9999999999998099, 676.5203681218851, -1259.1392167224028,
    771.3234287776531, -176.6150291621406, 12.5073432786869,
    -0.13857109526572, 9.98436957801957e-6, 1.50563273514931e-7];
  if (x < 0.5) {
    const piZ = { r: Math.PI * x, i: Math.PI * y };
    const sinZ = cSin(piZ);
    const reflected = complexGamma(1 - x, -y);
    return cDiv({ r: Math.PI, i: 0 }, cMul(sinZ, reflected));
  }
  let z = { r: x - 1, i: y }, sum = { r: p[0], i: 0 };
  for (let k = 1; k < p.length; k++) sum = cAdd(sum, cDiv({ r: p[k], i: 0 }, { r: z.r + k, i: z.i }));
  const t = { r: z.r + 7.5, i: z.i };
  return cMul({ r: Math.sqrt(TAU), i: 0 }, cMul(cPow(t, { r: z.r + .5, i: z.i }), cMul(cExp({ r: -t.r, i: -t.i }), sum)));
}

function cAdd(a,b){ return { r:a.r+b.r, i:a.i+b.i }; }
function cMul(a,b){ return { r:a.r*b.r-a.i*b.i, i:a.r*b.i+a.i*b.r }; }
function cDiv(a,b){ const d=b.r*b.r+b.i*b.i; return { r:(a.r*b.r+a.i*b.i)/d, i:(a.i*b.r-a.r*b.i)/d }; }
function cExp(z){ const e=Math.exp(z.r); return { r:e*Math.cos(z.i), i:e*Math.sin(z.i) }; }
function cPow(a,b){ const l={r:Math.log(Math.hypot(a.r,a.i)),i:Math.atan2(a.i,a.r)}; return cExp(cMul(b,l)); }
function cSin(z){ return { r:Math.sin(z.r)*Math.cosh(z.i), i:Math.cos(z.r)*Math.sinh(z.i) }; }

function phaseColor(phase, h) {
  const t = ((phase / TAU + 1) % 1 + 1) % 1;
  const cols = [CYAN, MAGENTA, ACID, CYAN];
  const u = t * 3, k = Math.floor(u), f = u - k;
  const a = cols[k], b = cols[k + 1];
  const lift = .72 + .28 * Math.min(1, h / 4);
  return { r: lerp(a.r,b.r,f)*lift, g: lerp(a.g,b.g,f)*lift, b: lerp(a.b,b.b,f)*lift };
}

function drawGammaAxes(g, azimuth, elevation, glow) {
  const origin = gammaVertex(-4.6, -3.6, azimuth, elevation);
  const realEnd = gammaVertex(4.9, -3.6, azimuth, elevation);
  const imagEnd = gammaVertex(-4.6, 3.9, azimuth, elevation);
  origin.sy = gammaFloorY(-4.6,-3.6,azimuth,elevation); realEnd.sy = gammaFloorY(4.9,-3.6,azimuth,elevation); imagEnd.sy = gammaFloorY(-4.6,3.9,azimuth,elevation);
  g.noFill(); g.strokeWeight(glow ? 10 : 2.2);
  g.stroke(CYAN.r,CYAN.g,CYAN.b,glow ? 28 : 210); g.line(origin.sx,origin.sy,realEnd.sx,realEnd.sy);
  g.stroke(MAGENTA.r,MAGENTA.g,MAGENTA.b,glow ? 28 : 210); g.line(origin.sx,origin.sy,imagEnd.sx,imagEnd.sy);
}

function gammaFloorY(x,y,azimuth,elevation){ return (x*Math.sin(azimuth)+y*Math.cos(azimuth))*Math.sin(elevation)*76; }

function toScreen(z) {
  return { x: z.x * FIELD.radius, y: -z.y * FIELD.radius };
}

function drawMappedCurve(g, sampler, steps, phi, a) {
  let drawing = false;
  g.beginShape();
  for (let i = 0; i <= steps; i++) {
    const z = sampler(i / steps);
    const w = transformComplex(z.x, z.y, phi, a);
    const valid = Number.isFinite(w.x) && Number.isFinite(w.y) && Math.hypot(w.x, w.y) < 1.32;
    if (!valid) {
      if (drawing) { g.endShape(); g.beginShape(); drawing = false; }
      continue;
    }
    const p = toScreen(w);
    g.vertex(p.x, p.y);
    drawing = true;
  }
  g.endShape();
}

function drawMappedCartesianGrid(g, phi, a, glow) {
  g.noFill();
  const values = [-1, -.8, -.6, -.4, -.2, .2, .4, .6, .8, 1];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const col = i % 2 ? MAGENTA : CYAN;
    g.stroke(col.r, col.g, col.b, glow ? 18 : 52);
    g.strokeWeight(glow ? 8 : 1.25);
    drawMappedCurve(g, t => ({ x: -FIELD.domain + 2 * FIELD.domain * t, y: v }), 150, phi, a);
    g.stroke(col.r, col.g, col.b, glow ? 18 : 52);
    drawMappedCurve(g, t => ({ x: v, y: -FIELD.domain + 2 * FIELD.domain * t }), 150, phi, a);
  }
}

function drawMappedPolarGrid(g, phi, a, glow) {
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, glow ? 11 : 31);
  g.strokeWeight(glow ? 6 : .85);
  for (let r = .18; r <= 1.02; r += .14) {
    drawMappedCurve(g, t => ({ x: r * Math.cos(TAU * t), y: r * Math.sin(TAU * t) }), 180, phi, a);
  }
  for (let k = 0; k < 18; k++) {
    const angle = k * TAU / 18;
    drawMappedCurve(g, t => ({ x: 1.08 * t * Math.cos(angle), y: 1.08 * t * Math.sin(angle) }), 100, phi, a);
  }
}

function drawAxes(g, phi, a, glow) {
  g.noFill();
  g.strokeWeight(glow ? 12 : 2.7);
  g.stroke(CYAN.r, CYAN.g, CYAN.b, glow ? 35 : 215);
  drawMappedCurve(g, t => ({ x: -1.08 + 2.16 * t, y: 0 }), 180, phi, a);
  g.stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, glow ? 35 : 215);
  drawMappedCurve(g, t => ({ x: 0, y: -1.08 + 2.16 * t }), 180, phi, a);
}

function drawBoundary(g, glow) {
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, glow ? 16 : 54);
  g.strokeWeight(glow ? 9 : 1.2);
  g.circle(0, 0, FIELD.radius * 2);
  g.circle(0, 0, FIELD.radius * 1.965);
}

function drawRootOrbits(g, loop, phi, a, glow) {
  const colors = [CYAN, MAGENTA, ACID];
  const sourceAngle = TAU * loop;
  for (let k = 0; k < 3; k++) {
    const angle = sourceAngle / 3 + k * TAU / 3;
    const z = { x: .78 * Math.cos(angle), y: .78 * Math.sin(angle) };
    const w = transformComplex(z.x, z.y, phi, a);
    const p = toScreen(w), col = colors[k];
    g.noStroke();
    g.fill(col.r, col.g, col.b, glow ? 38 : 245);
    g.circle(p.x, p.y, glow ? 42 : 13);
    if (!glow) {
      g.stroke(col.r, col.g, col.b, 105);
      g.strokeWeight(1.2);
      g.line(0, 0, p.x, p.y);
    }
  }
}

function drawOverlay(loop, phi, a) {
  const g = overlayPg;
  const ctx = g.drawingContext;
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const state = getGammaAnimationState(loop);
  const domainTheta = state.theta;
  const shiftX = state.shiftX;
  const shiftY = state.shiftY;
  const shiftSign = shiftY < 0 ? '-' : '+';
  g.noStroke();
  g.fill(BG_R, BG_G, BG_B, 222); g.rect(0, 0, W, HUD_TOP_H);
  g.fill(BG_R, BG_G, BG_B, 225); g.rect(0, H - HUD_BOT_H, W, HUD_BOT_H);
  g.stroke(255, 255, 255, 32); g.strokeWeight(1);
  g.line(72, HUD_TOP_H, W - 72, HUD_TOP_H);
  g.line(72, H - HUD_BOT_H, W - 72, H - HUD_BOT_H);
  drawCorners(g);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `30px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.88)';
  ctx.fillText('COMPLEX GAMMA LANDSCAPE', W / 2, 130);
  ctx.font = `19px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.fillText('BUILT FROM COMPLEX NUMBERS', W / 2, 178);
  ctx.font = `22px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.72)';
  ctx.fillText("z = x + yi", W / 2, 224);

  const baseY = H - HUD_BOT_H + 78;
  ctx.font = `18px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.34)';
  ctx.fillText('ONE COMPLEX RULE', W / 2, baseY);
  ctx.font = `25px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.90)';
  ctx.fillText(`z' = z + (${shiftX.toFixed(2)} ${shiftSign} ${Math.abs(shiftY).toFixed(2)}i)`, W / 2, baseY + 43);
  ctx.font = `21px ${mono}`; ctx.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.92)`;
  ctx.fillText(`height = log(1 + |Gamma(z')|)`, W / 2, baseY + 88);

  ctx.textAlign = 'left'; ctx.font = `20px ${mono}`;
  ctx.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.82)`;
  ctx.fillText(`REAL AXIS   Re(z)`, 76, baseY + 144);
  ctx.fillStyle = `rgba(${MAGENTA.r},${MAGENTA.g},${MAGENTA.b},.82)`;
  ctx.fillText(`IMAG AXIS   Im(z)`, 76, baseY + 184);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.48)';
  ctx.fillText(`c(t)=${shiftX.toFixed(2)}${shiftSign}${Math.abs(shiftY).toFixed(2)}i`, W - 76, baseY + 184);

  ctx.textAlign = 'left'; ctx.font = `17px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.34)';
  ctx.fillText('POLES  z = 0, -1, -2, -3, ...', 76, H - 115);
  ctx.textAlign = 'right';
  ctx.fillText('20260713  #RikiCodeArt', W - 76, H - 115);
  ctx.restore();
  drawVignette(g);
}

function drawCorners(g) {
  const m = 52, arm = 60;
  g.noFill(); g.stroke(255, 255, 255, 82); g.strokeWeight(1.4);
  g.line(m, m + arm, m, m); g.line(m, m, m + arm, m);
  g.line(W - m - arm, m, W - m, m); g.line(W - m, m, W - m, m + arm);
  g.line(m, H - m - arm, m, H - m); g.line(m, H - m, m + arm, H - m);
  g.line(W - m - arm, H - m, W - m, H - m); g.line(W - m, H - m - arm, W - m, H - m);
}

function drawVignette(g) {
  g.push(); g.noFill();
  const steps = 42, maxR = Math.hypot(W, H) * .58;
  g.strokeWeight(maxR / steps * 2 + 2);
  for (let i = 27; i < steps; i++) {
    const k = i / (steps - 1);
    g.stroke(0, 0, 0, map(k, .64, 1, 0, 90, true));
    g.circle(W / 2, H / 2, maxR * 2 * k);
  }
  g.pop();
}

function compositeFrame() {
  background(BG_R, BG_G, BG_B);
  halfPg.clear(); halfPg.image(glowPg, 0, 0, halfPg.width, halfPg.height);
  quartPg.clear(); quartPg.image(halfPg, 0, 0, quartPg.width, quartPg.height);
  eighthPg.clear(); eighthPg.image(quartPg, 0, 0, eighthPg.width, eighthPg.height);
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 62); image(eighthPg, 0, 0, W, H);
  tint(255, 100); image(quartPg, 0, 0, W, H);
  tint(255, 195); image(halfPg, 0, 0, W, H);
  noTint(); image(sharpPg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';
  tint(255, 10); image(grainPg, 0, 0); noTint();
  image(overlayPg, 0, 0);
}

function bakeGrain() {
  grainPg.clear(); grainPg.noStroke(); randomSeed(20260713);
  for (let i = 0; i < 1900; i++) {
    const v = random(130, 210);
    grainPg.fill(v, v, v, random(2, 6));
    grainPg.circle(random(W), random(H), random(.2, .8));
  }
}

function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('gauss_plane_' + ts(), 'png'); return false; }
  return true;
}

// ─── Existing MP4 capture/export workflow ───────────────────────────────────
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
    error: e => { console.error(e); isRecording = false; setStatus('Error', '#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0; isRecording = true; frameCount = 0;
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = true;
  if (el('stopBtn')) el('stopBtn').disabled = false;
  setStatus('Recording…', '#fff');
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus('Finalizing…', '#ccc');
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = 'gauss_plane_' + ts() + '.mp4'; a.click();
  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn')) el('stopBtn').disabled = true;
  const pf = el('progressFill'); if (pf) pf.style.width = '0%';
  setStatus('Complete', '#fff'); setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 }); frame.close();
}

function updateRecordingUi() {
  const el = id => document.getElementById(id);
  if (el('duration')) el('duration').textContent = (recFrameCount / FPS).toFixed(1);
  if (el('frameCount')) el('frameCount').textContent = recFrameCount;
  if (el('progressFill')) el('progressFill').style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
}

function setStatus(txt, c) {
  const el = document.getElementById('status');
  if (el) { el.textContent = txt; el.style.color = c; }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.ts = ts;

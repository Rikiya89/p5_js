'use strict';

// ─── Canvas / loop (inherited project values) ────────────────────────────────
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

const PARAMS = {
  exponent: 5,
  radius: 1.0,
  theta: 0,
  pointCount: 240,
  trailLength: 120,
  layerCount: 12,
  depthSpacing: 45,
  animationSpeed: 1.0,
  cameraDistance: 900,
  autoRotate: true,
  animateExponent: true,
  showAxes: true,
  showUnitCircle: true,
  showPowerTrail: true,
  showRootsOfUnity: true,
  showConnections: true,
  glowStrength: 1.0,
};

const WORLD_SCALE = 295;
const FIELD_Y = -20;
const HUD_TOP_H = 300;
const HUD_BOT_H = 430;

let sharpPg, glowPg, halfPg, quartPg, eighthPg, grainPg, overlayPg;
let canvasEl = null;
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;
let simFrame = 0;
let isPaused = false;

function setup() {
  if (typeof setAttributes === 'function') {
    setAttributes({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  }
  // The mathematical field is rendered by the WEBGL graphics layers below.
  // A 2D master canvas keeps p5's image compositor and WebCodecs capture stable.
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  const wrap = document.getElementById('canvas-wrap');
  if (wrap) wrap.appendChild(canvasEl);

  sharpPg = makeWebglLayer(W, H);
  glowPg = makeWebglLayer(W, H);
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

function makeWebglLayer(w, h) {
  const g = createGraphics(w, h, WEBGL);
  g.pixelDensity(1);
  g.colorMode(RGB, 255, 255, 255, 255);
  g.strokeCap(ROUND);
  g.strokeJoin(ROUND);
  return g;
}

function draw() {
  const frame = isRecording ? recFrameCount : simFrame;
  const loop = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  const theta = PARAMS.theta + TAU * loop * PARAMS.animationSpeed;
  const exponentState = getExponentState(loop);

  sharpPg.clear();
  glowPg.clear();
  overlayPg.clear();
  renderDeMoivreField(glowPg, loop, theta, exponentState, true);
  renderDeMoivreField(sharpPg, loop, theta, exponentState, false);
  drawOverlay(loop, theta, exponentState);
  compositeFrame();

  if (!isPaused && !isRecording) simFrame++;
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function getExponentState(loop) {
  if (!PARAMS.animateExponent) {
    return { from: PARAMS.exponent, to: PARAMS.exponent, mix: 0, current: PARAMS.exponent };
  }
  const sequence = [5, 6, 7, 8, 7, 6, 5, 4, 3, 4, 5];
  const phase = loop * (sequence.length - 1);
  const segment = Math.min(sequence.length - 2, Math.floor(phase));
  const local = phase - segment;
  const transition = constrain(map(local, 0.32, 0.82, 0, 1), 0, 1);
  const mix = transition * transition * (3 - 2 * transition);
  const from = sequence[segment];
  const to = sequence[segment + 1];
  return { from, to, mix, current: mix < 0.5 ? from : to };
}

function renderDeMoivreField(g, loop, theta, exponentState, glow) {
  const cameraPhase = PARAMS.autoRotate ? TAU * loop : 0;
  g.push();
  g.translate(0, FIELD_Y, 0);
  g.scale(900 / PARAMS.cameraDistance);
  g.rotateX(-0.53 + 0.06 * Math.sin(cameraPhase));
  g.rotateZ(-0.12);
  g.rotateY(cameraPhase * 0.72);

  drawStackedPlanes(g, theta, exponentState.current, glow);
  if (PARAMS.showPowerTrail) drawPowerTrajectory(g, theta, glow);
  drawPhaseRibbon(g, theta, exponentState.from, 1 - exponentState.mix, glow);
  if (exponentState.to !== exponentState.from) {
    drawPhaseRibbon(g, theta, exponentState.to, exponentState.mix, glow);
  }
  drawActivePowerPlane(g, theta, exponentState, glow);
  g.pop();
}

function complexPower(r, theta, n) {
  const magnitude = Math.pow(r, n);
  const angle = n * theta;
  return {
    magnitude,
    angle,
    x: magnitude * Math.cos(angle),
    y: magnitude * Math.sin(angle),
  };
}

function depthForExponent(n) {
  return (n - (PARAMS.layerCount + 1) / 2) * PARAMS.depthSpacing;
}

function vertexComplex(g, x, y, z, scale = WORLD_SCALE) {
  g.vertex(x * scale, y * scale, z);
}

function drawStackedPlanes(g, theta, activeExponent, glow) {
  const layers = PARAMS.layerCount;
  for (let n = 1; n <= layers; n++) {
    const z = depthForExponent(n);
    const active = n === activeExponent;
    const col = n % 3 === 1 ? CYAN : n % 3 === 2 ? MAGENTA : ACID;
    const alpha = active ? (glow ? 42 : 145) : (glow ? 11 : 31);

    if (PARAMS.showUnitCircle) {
      g.noFill();
      g.stroke(col.r, col.g, col.b, alpha);
      g.strokeWeight(glow ? (active ? 7 : 3) : (active ? 1.7 : 0.65));
      g.beginShape();
      for (let i = 0; i <= PARAMS.pointCount; i++) {
        const a = TAU * i / PARAMS.pointCount;
        vertexComplex(g, Math.cos(a), Math.sin(a), z);
      }
      g.endShape();
    }

    if (PARAMS.showAxes && (n === 1 || active || n === layers)) {
      drawPlaneAxes(g, z, glow, active);
    }

    const p = complexPower(PARAMS.radius, theta, n);
    drawPoint3D(g, p.x * WORLD_SCALE, p.y * WORLD_SCALE, z, col, glow, active ? 17 : 9);

    if (PARAMS.showConnections && (active || n === 1)) {
      g.stroke(col.r, col.g, col.b, glow ? 24 : 115);
      g.strokeWeight(glow ? 6 : 1.2);
      g.line(0, 0, z, p.x * WORLD_SCALE, p.y * WORLD_SCALE, z);
    }
  }
}

function drawPlaneAxes(g, z, glow, active) {
  const a = active ? (glow ? 35 : 150) : (glow ? 12 : 46);
  const length = WORLD_SCALE * 1.16;
  g.strokeWeight(glow ? (active ? 6 : 3) : (active ? 1.25 : 0.7));
  g.stroke(CYAN.r, CYAN.g, CYAN.b, a);
  g.line(-length, 0, z, length, 0, z);
  g.stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, a);
  g.line(0, -length, z, 0, length, z);
}

function drawPowerTrajectory(g, theta, glow) {
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, glow ? 38 * PARAMS.glowStrength : 185);
  g.strokeWeight(glow ? 9 * PARAMS.glowStrength : 2.2);
  g.beginShape();
  for (let n = 1; n <= PARAMS.layerCount; n++) {
    const p = complexPower(PARAMS.radius, theta, n);
    vertexComplex(g, p.x, p.y, depthForExponent(n));
  }
  g.endShape();

  if (!PARAMS.showConnections) return;
  for (let n = 1; n < PARAMS.layerCount; n++) {
    const p0 = complexPower(PARAMS.radius, theta, n);
    const p1 = complexPower(PARAMS.radius, theta, n + 1);
    const col = n % 2 ? CYAN : MAGENTA;
    g.stroke(col.r, col.g, col.b, glow ? 22 : 72);
    g.strokeWeight(glow ? 4 : 0.75);
    g.line(p0.x * WORLD_SCALE, p0.y * WORLD_SCALE, depthForExponent(n),
      p1.x * WORLD_SCALE, p1.y * WORLD_SCALE, depthForExponent(n + 1));
  }
}

// A theorem-derived ribbon: each rail samples z(theta)^n as theta advances.
function drawPhaseRibbon(g, theta, n, opacity, glow) {
  if (opacity <= 0.001) return;
  const steps = PARAMS.trailLength;
  const z = depthForExponent(n);
  const span = TAU / Math.max(2, n);
  g.noFill();
  for (let rail = 0; rail < 3; rail++) {
    const col = rail === 0 ? CYAN : rail === 1 ? MAGENTA : ACID;
    g.stroke(col.r, col.g, col.b, (glow ? 18 : 72) * opacity);
    g.strokeWeight(glow ? 5 : 0.9);
    g.beginShape();
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const sampleTheta = theta - span + span * 2 * u + rail * TAU / (n * 3);
      const p = complexPower(PARAMS.radius, sampleTheta, n);
      const ribbonZ = z + (u - 0.5) * PARAMS.depthSpacing * 1.5;
      vertexComplex(g, p.x, p.y, ribbonZ);
    }
    g.endShape();
  }
}

function drawActivePowerPlane(g, theta, exponentState, glow) {
  const z = lerp(depthForExponent(exponentState.from), depthForExponent(exponentState.to), exponentState.mix) + 1;
  drawPowerPolygon(g, theta, exponentState.from, z, 1 - exponentState.mix, glow);
  if (exponentState.to !== exponentState.from) {
    drawPowerPolygon(g, theta, exponentState.to, z, exponentState.mix, glow);
  }

  // Input z and its angle arc live on the first complex plane.
  const inputZ = depthForExponent(1) - 1;
  const input = complexPower(PARAMS.radius, theta, 1);
  g.stroke(CYAN.r, CYAN.g, CYAN.b, glow ? 38 : 205);
  g.strokeWeight(glow ? 8 : 2.1);
  g.line(0, 0, inputZ, input.x * WORLD_SCALE, input.y * WORLD_SCALE, inputZ);
  drawPoint3D(g, input.x * WORLD_SCALE, input.y * WORLD_SCALE, inputZ, CYAN, glow, 16);

  const arcSteps = 42;
  g.noFill();
  g.stroke(MAGENTA.r, MAGENTA.g, MAGENTA.b, glow ? 30 : 180);
  g.strokeWeight(glow ? 6 : 1.6);
  g.beginShape();
  for (let i = 0; i <= arcSteps; i++) {
    const a = theta * i / arcSteps;
    vertexComplex(g, 0.24 * Math.cos(a), 0.24 * Math.sin(a), inputZ);
  }
  g.endShape();
}

function drawPowerPolygon(g, theta, n, z, opacity, glow) {
  if (opacity <= 0.001) return;
  const baseTheta = theta * n;
  const roots = [];

  for (let k = 0; k < n; k++) {
    const angle = baseTheta + TAU * k / n;
    roots.push({ x: Math.cos(angle), y: Math.sin(angle) });
  }

  if (PARAMS.showRootsOfUnity) {
    g.noFill();
    g.stroke(ACID.r, ACID.g, ACID.b, (glow ? 44 : 202) * opacity);
    g.strokeWeight(glow ? 10 * PARAMS.glowStrength : 2.5);
    g.beginShape();
    for (const root of roots) vertexComplex(g, root.x, root.y, z);
    if (roots.length) vertexComplex(g, roots[0].x, roots[0].y, z);
    g.endShape();

    for (let k = 0; k < roots.length; k++) {
      const root = roots[k];
      const col = k % 2 ? MAGENTA : CYAN;
      drawPoint3D(g, root.x * WORLD_SCALE, root.y * WORLD_SCALE, z, col, glow, 13, opacity);
      if (PARAMS.showConnections) {
        g.stroke(col.r, col.g, col.b, (glow ? 17 : 58) * opacity);
        g.strokeWeight(glow ? 4 : 0.7);
        g.line(0, 0, z, root.x * WORLD_SCALE, root.y * WORLD_SCALE, z);
      }
    }
  }

}

function drawPoint3D(g, x, y, z, col, glow, diameter, opacity = 1) {
  g.push();
  g.translate(x, y, z);
  g.noStroke();
  g.fill(col.r, col.g, col.b, (glow ? 42 * PARAMS.glowStrength : 245) * opacity);
  g.sphere(glow ? diameter * 1.9 : diameter * 0.5, glow ? 6 : 8, glow ? 4 : 6);
  g.pop();
}

function drawOverlay(loop, theta, exponentState) {
  const g = overlayPg;
  const ctx = g.drawingContext;
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const n = exponentState.current;
  const result = complexPower(PARAMS.radius, theta, n);
  const thetaDeg = ((theta * 180 / Math.PI) % 360 + 360) % 360;

  g.noStroke();
  g.fill(BG_R, BG_G, BG_B, 226); g.rect(0, 0, W, HUD_TOP_H);
  g.fill(BG_R, BG_G, BG_B, 230); g.rect(0, H - HUD_BOT_H, W, HUD_BOT_H);
  g.stroke(255, 255, 255, 32); g.strokeWeight(1);
  g.line(72, HUD_TOP_H, W - 72, HUD_TOP_H);
  g.line(72, H - HUD_BOT_H, W - 72, H - HUD_BOT_H);
  drawCorners(g);

  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `30px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillText('DE MOIVRE FIELD', W / 2, 124);
  ctx.font = `18px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.38)';
  ctx.fillText('POWER · PHASE · ROTATIONAL SYMMETRY', W / 2, 174);
  ctx.font = `22px ${mono}`; ctx.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.9)`;
  ctx.fillText('(r · (cos θ + i sin θ))ⁿ', W / 2, 222);

  const baseY = H - HUD_BOT_H + 58;
  ctx.font = `17px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.34)';
  ctx.fillText('DE MOIVRE\'S THEOREM', W / 2, baseY);
  ctx.font = `24px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.fillText(`= rⁿ · (cos(nθ) + i sin(nθ))`, W / 2, baseY + 39);
  ctx.font = `20px ${mono}`; ctx.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.9)`;
  const transitionLabel = PARAMS.animateExponent ? `    ${exponentState.from}→${exponentState.to}` : '';
  ctx.fillText(`n = ${n}${transitionLabel}    θ = ${thetaDeg.toFixed(1)}°    |zⁿ| = ${result.magnitude.toFixed(3)}`, W / 2, baseY + 86);

  ctx.textAlign = 'left'; ctx.font = `18px ${mono}`;
  ctx.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.78)`;
  ctx.fillText('CYAN   INPUT / REAL AXIS', 76, baseY + 139);
  ctx.fillStyle = `rgba(${MAGENTA.r},${MAGENTA.g},${MAGENTA.b},.78)`;
  ctx.fillText('MAGENTA   PHASE / IMAG AXIS', 76, baseY + 174);
  ctx.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.82)`;
  ctx.fillText(`ACID   ${n} ROOTS / ${n}-FOLD POLYGON`, 76, baseY + 209);

  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.46)';
  ctx.fillText(`zⁿ = ${result.x.toFixed(3)} ${result.y < 0 ? '−' : '+'} ${Math.abs(result.y).toFixed(3)}i`, W - 76, baseY + 174);
  ctx.fillText(`layers ${PARAMS.layerCount}  ·  depth ${PARAMS.depthSpacing}`, W - 76, baseY + 209);

  ctx.textAlign = 'left'; ctx.font = `16px ${mono}`; ctx.fillStyle = 'rgba(255,255,255,.30)';
  ctx.fillText('1–9 FIX POWER  ·  M MORPH  ·  R ROOTS  ·  A AXES  ·  C LINKS', 76, H - 112);
  ctx.textAlign = 'right';
  ctx.fillText('20260720  #RikiCodeArt', W - 76, H - 112);
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
  const steps = 42, maxR = Math.hypot(W, H) * 0.58;
  g.strokeWeight(maxR / steps * 2 + 2);
  for (let i = 27; i < steps; i++) {
    const k = i / (steps - 1);
    g.stroke(0, 0, 0, map(k, 0.64, 1, 0, 90, true));
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
  grainPg.clear(); grainPg.noStroke(); randomSeed(20260720);
  for (let i = 0; i < 1900; i++) {
    const v = random(130, 210);
    grainPg.fill(v, v, v, random(2, 6));
    grainPg.circle(random(W), random(H), random(0.2, 0.8));
  }
}

function keyReleased() {
  if (key >= '1' && key <= '9') {
    PARAMS.exponent = Number(key); PARAMS.animateExponent = false; return false;
  }
  if (key === 'm' || key === 'M') { PARAMS.animateExponent = !PARAMS.animateExponent; return false; }
  if (key === 'r' || key === 'R') { PARAMS.showRootsOfUnity = !PARAMS.showRootsOfUnity; return false; }
  if (key === 'a' || key === 'A') { PARAMS.showAxes = !PARAMS.showAxes; return false; }
  if (key === 'c' || key === 'C') { PARAMS.showConnections = !PARAMS.showConnections; return false; }
  if (key === 'v' || key === 'V') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('de_moivre_field_' + ts(), 'png'); return false; }
  if (key === ' ') { isPaused = !isPaused; setStatus(isPaused ? 'Paused' : 'Ready', '#ccc'); return false; }
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
  recFrameCount = 0; isRecording = true; isPaused = false; frameCount = 0;
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
  a.href = url; a.download = 'de_moivre_field_' + ts() + '.mp4'; a.click();
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

window.PARAMS = PARAMS;
window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.ts = ts;

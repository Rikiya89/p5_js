"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP = MAX_FRAMES;
const FLOWER_MS = 116;

// Preview runs lighter for interaction; recording uses full detail.
const PREVIEW_QUALITY = Object.freeze({
  fibStride: 2,
  knotStride: 2,
  flowerHaloSteps: 64,
  flowerCircleSteps: 80,
  innerTraceSteps: 24,
  outerTraceSteps: 18,
  centerTraceSteps: 16,
  nodeRingSteps: 16,
  formulaPts: 220,
  formulaBeads: 12,
  yantraCircleSteps: 48,
  spiralPts: 320,
  pentagramCircleSteps: 56
});

const RECORD_QUALITY = Object.freeze({
  fibStride: 1,
  knotStride: 1,
  flowerHaloSteps: 128,
  flowerCircleSteps: 128,
  innerTraceSteps: 42,
  outerTraceSteps: 34,
  centerTraceSteps: 26,
  nodeRingSteps: 28,
  formulaPts: 420,
  formulaBeads: 18,
  yantraCircleSteps: 84,
  spiralPts: 500,
  pentagramCircleSteps: 80
});

// ── Mathematical Constants ─────────────────────────────────────────────────
const PHI     = (1 + Math.sqrt(5)) / 2; // Golden ratio ≈ 1.618
const PHI_INV = 1 / PHI;                // ≈ 0.618

// ── Global State ───────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recordingFrameCount = 0, fc = 0;
let canvasEl = null;

// ── Geometry Cache (computed once in precompute()) ─────────────────────────
let fibSphere   = [];  // [x,y,z] on unit sphere, fibonacci lattice
let torusKnot   = [];  // (3,5) torus knot vertices [x,y,z]
let icosaVerts  = [];  // Icosahedron 12 vertices (normalized)
let icosaEdges  = [];  // Icosahedron 30 edges [i,j]
let metatronPts = [];  // Metatron's Cube 13 node positions [x,y]

// ── Precomputation ─────────────────────────────────────────────────────────
function precompute() {

  // 1. Fibonacci sphere — golden angle distributes points uniformly on sphere
  //    Formula: goldenAngle = π(3−√5), y_i = 1 − 2i/(N−1), r_i = √(1−y_i²)
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.399 rad
  for (let i = 0; i < 380; i++) {
    const y = 1 - (i / 379) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    fibSphere.push([r * Math.cos(theta), y, r * Math.sin(theta)]);
  }

  // 2. Torus knot (p=3, q=5) — winds 3× around torus, 5× through hole
  //    x = (cos(qt/p)+2)·cos(t),  y = (cos(qt/p)+2)·sin(t),  z = −sin(qt/p)
  const TK_STEPS = 1500, kp = 3, kq = 5;
  for (let i = 0; i <= TK_STEPS; i++) {
    const t   = (i / TK_STEPS) * Math.PI * 2 * kp;
    const phi = kq * t / kp;
    const R   = Math.cos(phi) + 2;
    torusKnot.push([R * Math.cos(t), R * Math.sin(t), -Math.sin(phi)]);
  }

  // 3. Icosahedron — 12 vertices built from three mutually perpendicular golden rectangles
  //    (0, ±1, ±φ), (±1, ±φ, 0), (±φ, 0, ±1)
  const tau = PHI;
  const rawV = [
    [0, 1, tau], [0,-1, tau], [0, 1,-tau], [0,-1,-tau],
    [1, tau, 0], [-1, tau, 0], [1,-tau, 0], [-1,-tau, 0],
    [tau, 0, 1], [-tau, 0, 1], [tau, 0,-1], [-tau, 0,-1]
  ];
  const vLen  = Math.sqrt(1 + tau * tau);
  icosaVerts  = rawV.map(v => [v[0]/vLen, v[1]/vLen, v[2]/vLen]);

  const faces = [
    [0,1,8],[0,8,4],[0,4,5],[0,5,9],[0,9,1],
    [1,6,8],[8,10,4],[4,2,5],[5,11,9],[9,7,1],
    [3,10,6],[3,6,7],[3,7,11],[3,11,2],[3,2,10],
    [6,10,8],[10,2,4],[2,11,5],[11,7,9],[7,6,1]
  ];
  const seen = new Set();
  for (const [a, b, c] of faces) {
    for (const [u, v] of [[a,b],[b,c],[a,c]]) {
      const key = Math.min(u,v) + ',' + Math.max(u,v);
      if (!seen.has(key)) { seen.add(key); icosaEdges.push([u, v]); }
    }
  }

  // 4. Metatron's Cube — 13 nodes: center + 6 inner (radius 1) + 6 outer (radius √3)
  metatronPts.push([0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    metatronPts.push([Math.cos(a), Math.sin(a)]);
  }
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3 + Math.PI / 6;
    metatronPts.push([Math.cos(a) * Math.sqrt(3), Math.sin(a) * Math.sqrt(3)]);
  }
}

// ── Setup ──────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1); // Large FPS win on HiDPI displays; keeps logical canvas size unchanged.
  frameRate(FPS);
  document.getElementById('maxDuration').textContent = MAX_DURATION;
  // Disable depth test so translucent layers blend in draw-order (dreamlike compositing)
  drawingContext.disable(drawingContext.DEPTH_TEST);
  precompute();
}

// ── Draw ───────────────────────────────────────────────────────────────────
function draw() {
  background(0);

  const t     = (fc % LOOP) / LOOP;  // 0 → 1 over 24 s, perfect loop
  const theta = t * Math.PI * 2;

  // Global breathing pulse (3 cycles per loop)
  const pulse = 0.5 + 0.5 * Math.sin(theta * 3);
  const q = isRecording ? RECORD_QUALITY : PREVIEW_QUALITY;

  // ── Layer 1 ─ Sparse star sphere (quiet depth) ────────────────────────────
  push();
  rotateY(theta * 0.08);
  rotateX(theta * 0.05);
  rotateZ(theta * 0.03);
  strokeWeight(1.6);
  stroke(255, 255, 255, 18 + 10 * pulse);
  beginShape(POINTS);
  const starR = 940;
  const starStride = Math.max(1, q.fibStride * 2);
  for (let i = 0; i < fibSphere.length; i += starStride) {
    const [x, y, z] = fibSphere[i];
    vertex(x * starR, y * starR, z * starR);
  }
  endShape();
  strokeWeight(2.2);
  for (let i = 0; i < 18; i++) {
    const idx = (Math.floor(fc * 0.7) + i * 19) % fibSphere.length;
    const [x, y, z] = fibSphere[idx];
    const tw = 0.5 + 0.5 * Math.sin(theta * 4.0 + i);
    stroke(255, 255, 255, 40 + 50 * tw);
    point(x * (starR - 40), y * (starR - 40), z * (starR - 40));
  }
  pop();

  // ── Layer 2 ─ 3D aureole rings (clean ceremonial frame) ───────────────────
  push();
  noFill();
  rotateY(theta * 0.22);
  rotateX(theta * 0.13);
  rotateZ(theta * 0.05);
  strokeWeight(1.05);
  stroke(255, 255, 255, 36 + 18 * pulse);
  drawCircle3D(0, 0, 0, 520, q.yantraCircleSteps);
  rotateX(Math.PI * 0.5);
  drawCircle3D(0, 0, 0, 520, q.yantraCircleSteps);
  rotateY(Math.PI * 0.5);
  drawCircle3D(0, 0, 0, 520, q.yantraCircleSteps);
  pop();

  // ── Layer 3 ─ Sacred geometry core (Flower of Life + Yantra + formula) ───
  push();
  translate(0, 0, 20 * Math.sin(theta * 1.2));
  rotateZ(theta * 0.06);
  scale(1.01 + 0.014 * Math.sin(theta * 2.0));
  drawSacredCore(theta, pulse, q);
  pop();

  // ── Layer 4 ─ Icosahedron shell (soft wireframe depth) ────────────────────
  push();
  rotateY(-theta * 0.95);
  rotateX(0.55 + theta * 0.24);
  rotateZ(theta * 0.11);
  strokeWeight(1.25);
  stroke(255, 255, 255, 100 + 36 * pulse);
  drawIcosahedronWireframe(338);
  pop();

  // ── Layer 5 ─ Merkaba (minimal, bright accent) ────────────────────────────
  push();
  noFill();
  translate(0, 0, -38);
  rotateY(theta * 1.22);
  rotateX(0.42 + 0.12 * Math.sin(theta * 1.8));
  rotateZ(-theta * 0.08);
  strokeWeight(1.55);
  stroke(255, 255, 255, 140 + 54 * pulse);
  drawTetrahedron3D(188,  1);
  drawTetrahedron3D(188, -1);
  pop();

  // ── Recording ─────────────────────────────────────────────────────────────
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

// ──────────────────────────────────────────────────────────────────────────
// Geometry Helpers
// ──────────────────────────────────────────────────────────────────────────

function drawSacredCore(theta, pulse, q) {
  const mS = FLOWER_MS;
  const flowerSteps = q.flowerCircleSteps;
  const ringSteps = q.yantraCircleSteps;

  noFill();

  // Quiet Metatron scaffold
  strokeWeight(0.55);
  stroke(255, 255, 255, 28 + 16 * pulse);
  for (let i = 0; i < metatronPts.length; i++) {
    for (let j = i + 1; j < metatronPts.length; j++) {
      const [ax, ay] = metatronPts[i];
      const [bx, by] = metatronPts[j];
      line(ax * mS, ay * mS, 0, bx * mS, by * mS, 0);
    }
  }

  // Flower of Life circles
  push();
  scale(1.006);
  strokeWeight(0.8);
  stroke(255, 255, 255, 42 + 18 * pulse);
  for (let k = 0; k < 7; k++) {
    const [cx, cy] = metatronPts[k];
    drawCircle3D(cx * mS, cy * mS, 0, mS, Math.max(48, q.flowerHaloSteps));
  }
  pop();

  strokeWeight(1.35);
  stroke(255, 255, 255, 170 + 36 * pulse);
  for (let k = 0; k < 7; k++) {
    const [cx, cy] = metatronPts[k];
    drawCircle3D(cx * mS, cy * mS, 0, mS, flowerSteps);
  }

  strokeWeight(0.9);
  stroke(255, 255, 255, 72 + 24 * pulse);
  for (let k = 7; k < 13; k++) {
    const [cx, cy] = metatronPts[k];
    drawCircle3D(cx * mS, cy * mS, 0, mS, flowerSteps);
  }

  // Yantra frame around the flower
  strokeWeight(1.05);
  stroke(255, 255, 255, 112 + 22 * pulse);
  drawCircle3D(0, 0, 0, mS * 2.05, ringSteps);
  strokeWeight(0.8);
  stroke(255, 255, 255, 52 + 18 * pulse);
  drawCircle3D(0, 0, 0, mS * 2.45, ringSteps);
  drawRegularPolygon3D(0, 0, 0, mS * 2.05, 6, Math.PI / 6);
  strokeWeight(1.05);
  stroke(255, 255, 255, 126 + 20 * pulse);
  drawHexagram3D(mS * 1.70, 0, theta * 0.05);

  // Luxury mystical crown (restrained): aureole, dodecagram, pearl orbit, vesica veil
  const crownR = mS * 2.92;
  strokeWeight(0.9);
  stroke(255, 255, 255, 40 + 16 * pulse);
  drawCircle3D(0, 0, 0, crownR, ringSteps);
  strokeWeight(0.65);
  stroke(255, 255, 255, 24 + 10 * pulse);
  drawCircle3D(0, 0, 0, crownR * 1.08, ringSteps);

  strokeWeight(0.95);
  stroke(255, 255, 255, 92 + 20 * pulse);
  drawStarPolygon3D(crownR, 12, 5, 0, theta * 0.035);
  strokeWeight(0.55);
  stroke(255, 255, 255, 34 + 12 * pulse);
  drawRegularPolygon3D(0, 0, 0, crownR, 12, theta * 0.035 + Math.PI / 12);

  // Pearl orbit (quality-aware count)
  const beadN = q.formulaBeads;
  for (let i = 0; i < beadN; i++) {
    const a = theta * 0.26 + i * (Math.PI * 2 / beadN);
    const tw = 0.5 + 0.5 * Math.sin(theta * 3.8 + i * 0.7);
    const bx = crownR * Math.cos(a);
    const by = crownR * Math.sin(a);
    strokeWeight(0.75);
    stroke(255, 255, 255, 26 + 22 * tw);
    drawCircle3D(bx, by, 0, 2.8 + 1.0 * tw, Math.max(10, Math.floor(q.nodeRingSteps * 0.7)));
    strokeWeight(1.7 + 0.9 * tw);
    stroke(255, 255, 255, 62 + 62 * tw);
    point(bx, by, 0);
  }

  // Vesica / moon veil (offset circles + moving arc tracers)
  strokeWeight(0.75);
  stroke(255, 255, 255, 30 + 14 * pulse);
  drawCircle3D(-mS * 0.58, 0, 0, mS * 1.85, Math.max(42, ringSteps));
  drawCircle3D( mS * 0.58, 0, 0, mS * 1.85, Math.max(42, ringSteps));
  strokeWeight(1.1);
  stroke(255, 255, 255, 82 + 22 * pulse);
  const veilHead = theta * 0.92;
  drawArc3D(-mS * 0.58, 0, 0, mS * 1.85, veilHead - 0.22, veilHead + 0.22, Math.max(12, q.centerTraceSteps));
  drawArc3D( mS * 0.58, 0, 0, mS * 1.85, -veilHead - 0.22, -veilHead + 0.22, Math.max(12, q.centerTraceSteps));

  // Animated tracing arcs (inner and outer circles)
  const trace = theta * 2.0;
  strokeWeight(1.4);
  stroke(255, 255, 255, 132 + 32 * pulse);
  for (let k = 0; k < 7; k++) {
    const [cx, cy] = metatronPts[k];
    const head = trace + k * 0.72;
    drawArc3D(
      cx * mS, cy * mS, 0, mS,
      head - 0.22, head + 0.22,
      Math.max(14, q.innerTraceSteps)
    );
  }

  strokeWeight(1.0);
  stroke(255, 255, 255, 62 + 20 * pulse);
  for (let k = 7; k < 13; k++) {
    const [cx, cy] = metatronPts[k];
    const head = -trace * 0.75 + (k - 7) * 0.95;
    drawArc3D(
      cx * mS, cy * mS, 0, mS,
      head - 0.12, head + 0.12,
      Math.max(10, q.outerTraceSteps)
    );
  }

  // Formula rosette (minimal, elegant) r = a cos((n/d)θ)
  strokeWeight(1.15);
  stroke(255, 255, 255, 124 + 24 * pulse);
  drawRoseCurve3D(mS * 0.42, 5, 2, 0, Math.max(80, q.flowerCircleSteps));
  const [rx, ry] = rosePoint(mS * 0.42, 5, 2, theta * 2.3);
  strokeWeight(2.35);
  stroke(255, 255, 255, 160 + 52 * pulse);
  point(rx, ry, 0);

  // Pearl nodes
  for (let k = 0; k < 7; k++) {
    const [cx, cy] = metatronPts[k];
    const px = cx * mS;
    const py = cy * mS;
    const tw = 0.5 + 0.5 * Math.sin(theta * 3.6 + k * 0.8);
    strokeWeight(0.9);
    stroke(255, 255, 255, 28 + 24 * tw);
    drawCircle3D(px, py, 0, 4.3 + 1.4 * tw, Math.max(12, q.nodeRingSteps));
    strokeWeight(2.1);
    stroke(255, 255, 255, 78 + 64 * tw);
    point(px, py, 0);
  }
}

function drawIcosahedronWireframe(size) {
  noFill();
  for (const [a, b] of icosaEdges) {
    const va = icosaVerts[a];
    const vb = icosaVerts[b];
    line(
      va[0] * size, va[1] * size, va[2] * size,
      vb[0] * size, vb[1] * size, vb[2] * size
    );
  }
}

// Circle in the XY plane at (cx, cy, cz) with radius r
function drawCircle3D(cx, cy, cz, r, steps = 56) {
  noFill();
  beginShape();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    vertex(cx + r * Math.cos(a), cy + r * Math.sin(a), cz);
  }
  endShape(CLOSE);
}

// Arc in the XY plane (wire only)
function drawArc3D(cx, cy, cz, r, a0, a1, steps = 42) {
  noFill();
  const TAU = Math.PI * 2;
  let start = a0;
  let end = a1;
  if (end < start) end += TAU;
  beginShape();
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const a = start + (end - start) * p;
    vertex(cx + r * Math.cos(a), cy + r * Math.sin(a), cz);
  }
  endShape();
}

// Regular polygon in XY plane
function drawRegularPolygon3D(cx, cy, cz, r, sides, rot = 0) {
  noFill();
  beginShape();
  for (let i = 0; i <= sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    vertex(cx + r * Math.cos(a), cy + r * Math.sin(a), cz);
  }
  endShape(CLOSE);
}

// Star polygon (n/k), used for a restrained dodecagram crown
function drawStarPolygon3D(r, sides, step, z = 0, rot = 0) {
  noFill();
  if (sides < 3) return;
  let idx = 0;
  beginShape();
  for (let i = 0; i <= sides; i++) {
    const a = rot + (idx / sides) * Math.PI * 2;
    vertex(r * Math.cos(a), r * Math.sin(a), z);
    idx = (idx + step) % sides;
  }
  endShape(CLOSE);
}

// Hexagram from two equilateral triangles
function drawHexagram3D(r, z = 0, rot = 0) {
  drawRegularPolygon3D(0, 0, z, r, 3, rot - Math.PI / 2);
  drawRegularPolygon3D(0, 0, z, r, 3, rot + Math.PI / 2);
}

// Polar rose curve: r = a cos((n/d)θ)
function rosePoint(a, n, d, t) {
  const k = n / d;
  const rr = a * Math.cos(k * t);
  return [rr * Math.cos(t), rr * Math.sin(t)];
}

function drawRoseCurve3D(a, n, d, z = 0, pts = 180) {
  noFill();
  const loops = Math.PI * 2 * d;
  beginShape();
  for (let i = 0; i <= pts; i++) {
    const tt = (i / pts) * loops;
    const [x, y] = rosePoint(a, n, d, tt);
    vertex(x, y, z);
  }
  endShape();
}

// Regular tetrahedron: dir=+1 apex up, dir=-1 apex down
function drawTetrahedron3D(r, dir) {
  const h = r * Math.sqrt(2 / 3);
  const bR = r / Math.sqrt(3);
  const v = [
    [0, dir * (-2 * h / 3), 0],
    [bR, dir * (h / 3), 0],
    [bR * Math.cos(Math.PI * 2 / 3), dir * (h / 3), bR * Math.sin(Math.PI * 2 / 3)],
    [bR * Math.cos(Math.PI * 4 / 3), dir * (h / 3), bR * Math.sin(Math.PI * 4 / 3)]
  ];
  for (const [i, j] of [[0,1],[0,2],[0,3],[1,2],[2,3],[3,1]]) {
    line(v[i][0], v[i][1], v[i][2], v[j][0], v[j][1], v[j][2]);
  }
}

// ── Recording ─────────────────────────────────────────────────────────────

function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome/Edge.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { console.error(e); setStatus('Encoder error', '#f66'); isRecording = false; }
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 12_000_000, framerate: FPS });

  fc = 0;
  isRecording = true;
  recordingFrameCount = 0;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording MP4...', '#fff');
  updateRecordingUI();
}

async function stopRecording() {
  if (!isRecording || !encoder || !muxer) return;
  isRecording = false;
  setStatus('Finalizing...', '#aaa');
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'sacred_geometry_20260224.mp4'; a.click();
  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete!', '#fff');
  setTimeout(() => setStatus('Ready', '#aaa'), 3000);
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = canvasEl || document.querySelector('canvas');
  if (!canvasEl && canvas) canvasEl = canvas;
  if (!canvas) return;
  const frame = new VideoFrame(canvas, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text; el.style.color = color;
}

function updateRecordingUI() {
  const d = document.getElementById('duration');
  const f = document.getElementById('frameCount');
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}

// ── Key shortcut ───────────────────────────────────────────────────────────
function keyPressed() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
  }
}

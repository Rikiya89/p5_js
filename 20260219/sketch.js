// Serial Geometry — 3D Mathematical Generative Art
// Torus Knot × Superformula Grid × Icosahedron × Dodecahedron
// Canvas: 1080 × 1920 (portrait 9:16)

const W = 1080;
const H = 1920;

// Deep-space palette (background, solids, grid)
const PAL = [
  [54,  45,  120],  // 0  deep violet
  [82,  63,  163],  // 1  medium violet
  [145, 108, 204],  // 2  lavender
  [189, 161, 229],  // 3  light lavender
  [200, 192, 233],  // 4  pale violet
  [132, 186, 231],  // 5  sky blue
  [81,  106, 212],  // 6  cornflower blue
  [51,   63, 135],  // 7  navy
];

// Vivid gradient used for torus knot chromatic pass
const GRAD = [
  [110,  85, 235],   // violet
  [ 85, 170, 250],   // sky blue
  [200, 140, 255],   // orchid
  [100, 225, 235],   // cyan
  [170, 100, 255],   // purple
  [ 70, 140, 245],   // deep blue
];

// ─── Mathematical constants ───────────────────────────────────────────────
const PHI = (1 + Math.sqrt(5)) / 2;   // Golden ratio ≈ 1.618

// ─── Recording state ──────────────────────────────────────────────────────
let encoder = null, muxer = null;
let isRecording         = false;
let recordingFrameCount = 0;
const FPS        = 60;
const MAX_FRAMES = FPS * 30;

let t = 0;

// ═════════════════════════════════════════════════════════════════════════
// Recording — WebCodecs + mp4-muxer
// ═════════════════════════════════════════════════════════════════════════
async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('WebCodecs API is not supported in this browser.\nUse Chrome ≥ 94.');
    return;
  }
  t = 0;
  isRecording = true;
  recordingFrameCount = 0;

  muxer = new Mp4Muxer.Muxer({
    target:                 new Mp4Muxer.ArrayBufferTarget(),
    video:                  { codec: 'avc', width: W, height: H },
    fastStart:              'in-memory',
    firstTimestampBehavior: 'offset'
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (e) => console.error('Encoder error:', e)
  });
  encoder.configure({
    codec: 'avc1.640028', width: W, height: H,
    bitrate: 12_000_000, framerate: FPS
  });

  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  const s = document.getElementById('status');
  s.textContent = 'Recording…'; s.style.color = '#ff6b6b';
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'serial_geometry.mp4';
  a.click();

  encoder = null; muxer = null;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  const s = document.getElementById('status');
  s.textContent = 'Complete!';
  setTimeout(() => { s.textContent = 'Ready'; s.style.color = '#84bae7'; }, 3000);
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector('canvas');
  const frame  = new VideoFrame(canvas, {
    timestamp: recordingFrameCount * (1_000_000 / FPS)
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

function updateUI() {
  const d = document.getElementById('duration');
  const f = document.getElementById('frameCount');
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}

// ═════════════════════════════════════════════════════════════════════════
// Mathematical helpers
// ═════════════════════════════════════════════════════════════════════════

function dist3(a, b) {
  return Math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2);
}

// Torus knot:  x=(R+r·cos(q/p·u))·cos(u),  y=(R+r·cos(q/p·u))·sin(u),  z=r·sin(q/p·u)
function torusKnot(u, p, q, R, r) {
  const w  = (q / p) * u;
  const cx = R + r * Math.cos(w);
  return [cx * Math.cos(u), cx * Math.sin(u), r * Math.sin(w)];
}

// Smooth colour interpolation through GRAD (wraps at end)
function gradColor(frac) {
  const n   = GRAD.length;
  const pos = ((frac % 1 + 1) % 1) * (n - 1);
  const i0  = Math.floor(pos);
  const i1  = (i0 + 1) % n;
  const f   = pos - i0;
  return [
    GRAD[i0][0] + (GRAD[i1][0] - GRAD[i0][0]) * f,
    GRAD[i0][1] + (GRAD[i1][1] - GRAD[i0][1]) * f,
    GRAD[i0][2] + (GRAD[i1][2] - GRAD[i0][2]) * f,
  ];
}

// ═════════════════════════════════════════════════════════════════════════
// p5.js lifecycle
// ═════════════════════════════════════════════════════════════════════════
function setup() {
  setAttributes('antialias', true);
  createCanvas(W, H, WEBGL);
  frameRate(FPS);
  colorMode(RGB);
  smooth();
}

function draw() {
  if (isRecording) {
    recordingFrameCount++;
    updateUI();
    if (recordingFrameCount >= MAX_FRAMES) { stopRecording(); return; }
  }

  t += 0.007;

  background(4, 3, 16);

  // Camera orbits gently around the y-axis
  const orb  = t * 0.05;
  const camX =  380 * Math.sin(orb);
  const camY = -80  * Math.sin(t * 0.09);
  const camZ =  900 * Math.cos(orb);
  camera(camX, camY, camZ,  0, 0, 0,  0, 1, 0);

  // Three-point lighting: violet key + orbiting blue + orbiting warm rim
  ambientLight(22, 18, 50);
  pointLight(145, 108, 204,  0,   0,   420);
  pointLight(132, 186, 231,  300 * cos(t * 0.30),  200 * sin(t * 0.30), 250);
  pointLight(255, 210, 130, -280 * sin(t * 0.20), -180 * cos(t * 0.20), 150);

  // Gentle global scale breath — ties all elements together
  const breathe = 1 + 0.03 * sin(t * 0.35);
  scale(breathe);

  drawArmillaryRings(); // outer framing rings
  drawHopfFibration();  // 14 interlocking Hopf fiber circles
  drawVivianiCurve();   // figure-8 on a sphere
  drawLissajous3D();    // 3D Lissajous + orbiting particles
  drawTorusKnots();     // torus knots
  drawNestedSolids();   // icosahedron + dodecahedron

  if (isRecording) captureFrame();
}

// ─── Hopf fibration fibers ────────────────────────────────────────────────
// π: S³ → S² maps each point on the 2-sphere to a circle (fiber) in S³.
// Every pair of fibers is topologically linked exactly once — like chain rings.
// We draw 14 fibers for equatorial base points (θ=π/2, φ = k·2π/14):
//   a = cos(α)/√2,  b = sin(α)/√2
//   c = cos(α+φ)/√2,  d = sin(α+φ)/√2
//   Stereographic: (a,b,c)/(1+d) × R
// For θ=π/2: denom ≥ 1−1/√2 ≈ 0.29 — no singularities.
function drawHopfFibration() {
  push();
  rotateX(t * 0.030);
  rotateY(t * 0.042);
  rotateZ(t * 0.018);

  noFill();
  const M = 14;
  const R = 90;
  const S = 1 / Math.sqrt(2);

  for (let k = 0; k < M; k++) {
    const phi = (k / M) * TWO_PI;
    const [cr, cg, cb] = gradColor(k / M + t * 0.04);
    strokeWeight(1.1);
    stroke(cr, cg, cb, 78);

    beginShape();
    for (let i = 0; i <= 100; i++) {
      const alpha = (i / 100) * TWO_PI;
      const a = S * cos(alpha);
      const b = S * sin(alpha);
      const c = S * cos(alpha + phi);
      const d = S * sin(alpha + phi);
      const denom = 1 + d;
      vertex(R * a / denom, R * b / denom, R * c / denom);
    }
    endShape(CLOSE);
  }

  pop();
}

// ─── Viviani's curve ──────────────────────────────────────────────────────
// Intersection of sphere x²+y²+z²=4R² and cylinder (x−R)²+y²=R²:
//   x = R(1+cos t),  y = R·sin t,  z = 2R·sin(t/2)
// The curve traces a figure-8 on the sphere's surface and closes at t=2π.
function drawVivianiCurve() {
  push();
  rotateX(t * 0.09);
  rotateY(t * 0.12);
  rotateZ(t * 0.05);

  const R = 150;
  const [cr, cg, cb] = gradColor(t * 0.04 + 0.85);

  noFill();
  strokeWeight(1.7);
  stroke(cr, cg, cb, 175);

  translate(-R, 0, 0);  // centre the figure-8 at origin

  beginShape();
  for (let i = 0; i <= 500; i++) {
    const u = (i / 500) * TWO_PI;
    vertex(
      R * (1 + cos(u)),
      R * sin(u),
      2 * R * sin(u / 2)
    );
  }
  endShape(CLOSE);

  pop();
}

// ─── Armillary rings ──────────────────────────────────────────────────────
// Four great circles at different inclinations, each precessing (rotateY)
// at its own speed — like the gimbals of an armillary sphere or gyroscope.
function drawArmillaryRings() {
  push();
  noFill();

  const R = 430;
  const rings = [
    { ax:  0,        az: 0,        wy:  0.060 },
    { ax:  PI / 3,   az: 0,        wy: -0.042 },
    { ax:  PI / 5,   az: PI / 4,   wy:  0.051 },
    { ax: -PI / 4,   az: PI * 0.6, wy: -0.033 },
  ];

  for (let ri = 0; ri < rings.length; ri++) {
    const { ax, az, wy } = rings[ri];
    push();
    rotateY(t * wy);
    rotateX(ax);
    rotateZ(az);

    const [cr, cg, cb] = gradColor(t * 0.04 + ri * 0.25);
    strokeWeight(1.1);
    stroke(cr, cg, cb, 65);

    beginShape();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TWO_PI;
      vertex(R * cos(a), R * sin(a), 0);
    }
    endShape(CLOSE);
    pop();
  }

  pop();
}

// ─── 3D Lissajous figure ──────────────────────────────────────────────────
// x = A·sin(3u),  y = A·sin(2u + π/4),  z = A·sin(u)·0.65
// Integer frequency ratios 3:2:1 guarantee the curve closes at u = 2π.
function drawLissajous3D() {
  push();
  rotateX(t * 0.08);
  rotateY(t * 0.05);
  rotateZ(t * 0.03);

  const A = 320;
  const [cr, cg, cb] = gradColor(t * 0.04 + 0.60);

  noFill();
  strokeWeight(1.5);
  stroke(cr, cg, cb, 155);

  beginShape();
  for (let i = 0; i <= 500; i++) {
    const u = (i / 500) * TWO_PI;
    vertex(
      A * sin(3 * u),
      A * sin(2 * u + QUARTER_PI),
      A * sin(u) * 0.65
    );
  }
  endShape(CLOSE);

  // 36 particles orbit along the curve at slightly different speeds —
  // irrational speed offsets keep them from ever bunching into a pattern.
  const N = 36;
  for (let i = 0; i < N; i++) {
    const frac  = i / N;
    const speed = 1.0 + 0.12 * sin(frac * 7.3);
    const u     = TWO_PI * frac + t * speed;
    const [pr, pg, pb] = gradColor(frac + t * 0.06);
    strokeWeight(5);
    stroke(pr, pg, pb, 220);
    point(
      A * sin(3 * u),
      A * sin(2 * u + QUARTER_PI),
      A * sin(u) * 0.65
    );
  }

  pop();
}

// ─── Torus knots with chromatic bloom ────────────────────────────────────
// Two knots: (2,3) trefoil and (3,5) cinquefoil.
// One soft glow pass (beginShape) + chromatic sharp core (per-segment line).
function drawTorusKnots() {
  const knots = [
    { p: 2, q: 3, R: 200, r: 60, speed: 1.00, phase: 0.00 },
    { p: 3, q: 5, R: 300, r: 42, speed: 0.55, phase: 0.50 },
  ];

  for (const { p, q, R, r, speed, phase } of knots) {
    push();
    rotateX(t * 0.17 * speed);
    rotateY(t * 0.23 * speed);
    rotateZ(t * 0.10 * speed);

    const steps = 480;
    const [cr, cg, cb] = gradColor(phase + t * 0.06);  // slowly drifts hue
    // R pulses slowly — each knot breathes at a different phase
    const Rp = R + 18 * sin(t * 0.28 + phase * TWO_PI);
    noFill();
    strokeWeight(2.0);
    stroke(cr, cg, cb, 240);
    beginShape();
    for (let i = 0; i <= steps; i++) {
      vertex(...torusKnot((i / steps) * TWO_PI * p, p, q, Rp, r));
    }
    endShape(CLOSE);

    pop();
  }
}

// ─── Nested solids — icosahedron + dodecahedron ───────────────────────────
// Mathematical duals sharing the same golden-ratio vertex coordinates.
// Icosahedron: (0, ±a, ±b) and cyclic, where b = φ·a
// Dodecahedron: (±ds, ±ds, ±ds), (0, ±ds/φ, ±φ·ds) and cyclic
function drawNestedSolids() {
  push();
  rotateX(t * 0.27);
  rotateY(t * 0.34);
  rotateZ(t * 0.16);

  const sc = 115;
  const a  = sc / sqrt(1 + PHI * PHI);
  const b  = PHI * a;

  const IV = [
    [ 0,  a,  b], [ 0, -a,  b], [ 0,  a, -b], [ 0, -a, -b],
    [ b,  0,  a], [-b,  0,  a], [ b,  0, -a], [-b,  0, -a],
    [ a,  b,  0], [-a,  b,  0], [ a, -b,  0], [-a, -b,  0]
  ];
  const icoEdge = dist3(IV[0], IV[4]);

  const ds  = sc * 1.55 / Math.sqrt(3);
  const dp  = PHI * ds;
  const dp1 = ds / PHI;
  const DV  = [
    [ ds,  ds,  ds], [ ds,  ds, -ds], [ ds, -ds,  ds], [ ds, -ds, -ds],
    [-ds,  ds,  ds], [-ds,  ds, -ds], [-ds, -ds,  ds], [-ds, -ds, -ds],
    [   0,  dp1,  dp], [   0,  dp1, -dp], [   0, -dp1,  dp], [   0, -dp1, -dp],
    [  dp,    0,  dp1], [  dp,    0, -dp1], [ -dp,    0,  dp1], [ -dp,    0, -dp1],
    [ dp1,   dp,    0], [ dp1,  -dp,    0], [-dp1,   dp,    0], [-dp1,  -dp,    0],
  ];
  const dodEdge = ds * 2 / PHI;

  noFill();

  // Dodecahedron — hue drifts offset from knots
  const [dc1, dc2, dc3] = gradColor(t * 0.04 + 0.25);
  strokeWeight(1.0);
  stroke(dc1, dc2, dc3, 90);
  for (let i = 0; i < DV.length; i++) {
    for (let j = i + 1; j < DV.length; j++) {
      if (Math.abs(dist3(DV[i], DV[j]) - dodEdge) < 2) {
        line(...DV[i], ...DV[j]);
      }
    }
  }

  // Icosahedron — brighter, hue drifts opposite direction
  const [ic1, ic2, ic3] = gradColor(t * 0.04 + 0.75);
  strokeWeight(2.2);
  stroke(ic1, ic2, ic3, 245);
  for (let i = 0; i < IV.length; i++) {
    for (let j = i + 1; j < IV.length; j++) {
      if (Math.abs(dist3(IV[i], IV[j]) - icoEdge) < 1.5) {
        line(...IV[i], ...IV[j]);
      }
    }
  }

  pop();
}

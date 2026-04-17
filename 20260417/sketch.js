'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const LOOP_SECONDS = 20;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

// ─── Palette (black & white only) ─────────────────────────────────────────────
const BG = [0, 0, 0];
const INK = [255, 255, 255];
const TRAIL_ALPHA = 22;   // higher = shorter trail

// ─── Hopf fibration params ────────────────────────────────────────────────────
// The Hopf map takes unit quaternions (points on S³) to points on S²:
//   (a, b, c, d) ∈ S³  ↦  (2(ac + bd), 2(bc − ad), a²+b²−c²−d²) ∈ S²
// The preimage of a single point on S² is a circle (a Hopf fiber) on S³.
// We sample a family of base points on S² and, for each, sweep a parameter
// t ∈ [0, 2π) to trace its fiber — a great circle on S³. Stereographic
// projection to ℝ³ turns those circles into linked Villarceau circles nested
// on tori. The whole set fills S³ with pairwise-linked loops.

const FIBER_COUNT = 96;        // how many linked rings we draw
const FIBER_STEPS = 240;       // samples per ring
const STEREO_SCALE = 0.72;     // screen-size factor for stereographic projection

// Depth fog range — nearer samples brighter, farther samples darker
const FOG_NEAR = -1.6;
const FOG_FAR  = 1.6;

// ─── State ────────────────────────────────────────────────────────────────────
let trailLayer = null;
let grainLayer = null;

let motionSeed = 0;
let phaseA = 0, phaseB = 0, phaseC = 0;

// Camera orbit
let camAz = 0;
let camEl = 0;

let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;
let canvasEl = null;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  noFill();
  strokeCap(ROUND);

  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  trailLayer.colorMode(RGB, 255, 255, 255, 255);
  trailLayer.background(BG[0], BG[1], BG[2]);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseedPattern(floor(random(100000)));

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function reseedPattern(seed) {
  motionSeed = seed;
  randomSeed(motionSeed);
  noiseSeed(motionSeed);
  phaseA = random(TWO_PI);
  phaseB = random(TWO_PI);
  phaseC = random(TWO_PI);
  if (trailLayer) trailLayer.background(BG[0], BG[1], BG[2]);
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const la = loop * TWO_PI;

  // Fade trail toward black (long-exposure motion blur)
  trailLayer.noStroke();
  trailLayer.fill(BG[0], BG[1], BG[2], TRAIL_ALPHA);
  trailLayer.rect(0, 0, W, H);

  // Camera orbit — slow, seamless loop (wider vertical sweep for 9:16)
  camAz = la * 0.5 + phaseA;
  camEl = sin(la + phaseB) * 0.60;

  // Draw every Hopf fiber to the trail layer
  for (let i = 0; i < FIBER_COUNT; i++) {
    const u = i / FIBER_COUNT;               // 0..1
    drawHopfFiber(u, la);
  }

  // Structural skeletons: two counter-rotating torus knots threading the cloud
  drawTorusKnot(la, 3, 2, 0.24, 0.08, 1.0);
  drawTorusKnot(la, 2, 5, 0.30, 0.05, -0.7);

  // Composite trail to WEBGL canvas
  background(BG[0], BG[1], BG[2]);
  push();
  translate(-W / 2, -H / 2, 0);
  image(trailLayer, 0, 0);
  pop();

  // Film grain overlay
  push();
  translate(-W / 2, -H / 2, 0);
  tint(255, 40);
  image(grainLayer, 0, 0);
  noTint();
  pop();

  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Hopf fiber drawing ───────────────────────────────────────────────────────
// For a base point (X, Y, Z) on S², its preimage under the Hopf map is:
//   (a, b, c, d) = [ (1 + Z)⁻¹ᐟ² / √2 ] · ( cos t, sin t, X cos t + Y sin t, X sin t − Y cos t )
// evaluated for t ∈ [0, 2π). We then stereographically project (a, b, c, d)
// from S³ ⊂ ℝ⁴ into ℝ³ via: (x, y, z) = (b, c, d) / (1 − a).

function drawHopfFiber(u, la) {
  // ── Choose this fiber's base point on S² ─────────────────────────────────
  // Fibonacci sphere: i-th point at height z = 1 − 2i/N, rotated by golden angle.
  // Uniform on S², no banding, no south-pole pile-up.
  const GOLDEN = PI * (3 - Math.sqrt(5));
  const idx = u * FIBER_COUNT;
  const zS = 1 - (2 * idx + 1) / FIBER_COUNT;
  const rS = Math.sqrt(Math.max(0, 1 - zS * zS));
  const theta = idx * GOLDEN + la * 0.6 + phaseC;
  const X = rS * cos(theta);
  const Y = rS * sin(theta);
  const Z = zS;

  // Denominator guard: when Z → −1 the projection blows up.
  // Nudge Z away from the south pole.
  const zSafe = Z < -0.985 ? -0.985 : Z;
  const k = 1 / Math.sqrt(2 * (1 + zSafe));

  // ── Sample the fiber circle in S³, project to ℝ³, then to screen ────────
  const pts = [];
  const depths = [];
  for (let s = 0; s <= FIBER_STEPS; s++) {
    const t = (s / FIBER_STEPS) * TWO_PI;
    const ct = cos(t), st = sin(t);

    // Point on S³ (unit quaternion, lies on Hopf fiber over (X,Y,Z))
    const a = k * (1 + zSafe) * ct;
    const b = k * (1 + zSafe) * st;
    const c = k * (X * ct + Y * st);
    const d = k * (X * st - Y * ct);

    // Stereographic projection from (1,0,0,0)-antipode onto ℝ³
    const denom = 1 - a;
    const x3 = b / denom;
    const y3 = c / denom;
    const z3 = d / denom;

    // Scale to canvas — use geometric mean so 9:16 reads as tall, not cramped
    const geoMean = Math.sqrt(W * H);
    let px = x3 * geoMean * STEREO_SCALE * 0.25;
    let py = y3 * geoMean * STEREO_SCALE * 0.25;
    let pz = z3 * geoMean * STEREO_SCALE * 0.25;

    // Camera orbit — yaw around Y then pitch around X
    let x = px * cos(camAz) + pz * sin(camAz);
    let z = -px * sin(camAz) + pz * cos(camAz);
    let y = py;
    const y2 = y * cos(camEl) - z * sin(camEl);
    const z2 = y * sin(camEl) + z * cos(camEl);
    y = y2; z = z2;

    // Perspective divide
    const FOV = geoMean * 1.1;
    const persp = FOV / (FOV + z + geoMean * 0.9);
    pts.push([W * 0.5 + x * persp, H * 0.5 + y * persp]);
    depths.push(z3);  // use pre-camera z for stable fog
  }

  // ── Render: segment-by-segment, shaded by depth ─────────────────────────
  // Each segment gets a shade between black and white based on its own depth.
  // This is what makes the 3D structure legible without color.
  trailLayer.noFill();
  for (let i = 1; i <= FIBER_STEPS; i++) {
    const a = i - 1, b = i;
    const zAvg = (depths[a] + depths[b]) * 0.5;
    // Fog: near (small z) → bright, far → dark
    const fog = constrain(map(zAvg, FOG_NEAR, FOG_FAR, 1, 0), 0, 1);
    const shade = INK[0] * Math.pow(fog, 1.4);
    const alpha = 40 + 180 * Math.pow(fog, 1.1);
    const sw = 0.4 + 1.6 * fog;

    trailLayer.strokeWeight(sw);
    trailLayer.stroke(shade, shade, shade, alpha);
    trailLayer.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
  }
}

// ─── Torus knot (structural overlay) ──────────────────────────────────────────
// Parametric (p, q) torus knot, breathing with la, counter-rotated per-instance.
// Two-pass render: a wide soft halo then a crisp core — grayscale only.
const KNOT_STEPS = 720;

function drawTorusKnot(la, p, q, rBase, tubeFrac, dir) {
  const geoMean = Math.sqrt(W * H);
  const breathe = 0.92 + 0.08 * sin(la * 2 + dir);
  const R = geoMean * rBase * breathe;
  const r = geoMean * tubeFrac * (0.9 + 0.1 * sin(la * 3 + dir * 1.7));
  const FOV = geoMean * 1.1;
  const spin = la * dir;

  const pts = [];
  const depths = [];
  for (let i = 0; i <= KNOT_STEPS; i++) {
    const t = (i / KNOT_STEPS) * TWO_PI + spin;
    let px = (R + r * cos(q * t)) * cos(p * t);
    let py = (R + r * cos(q * t)) * sin(p * t);
    let pz = r * sin(q * t);

    let x = px * cos(camAz) + pz * sin(camAz);
    let z = -px * sin(camAz) + pz * cos(camAz);
    let y = py;
    const y2 = y * cos(camEl) - z * sin(camEl);
    const z2 = y * sin(camEl) + z * cos(camEl);
    y = y2; z = z2;

    const persp = FOV / (FOV + z + geoMean * 0.9);
    pts.push([W * 0.5 + x * persp, H * 0.5 + y * persp]);
    depths.push(z);
  }

  trailLayer.noFill();

  // Pass 1: wide halo (low-alpha gray bloom)
  for (let i = 1; i <= KNOT_STEPS; i++) {
    const a = i - 1, b = i;
    const zAvg = (depths[a] + depths[b]) * 0.5;
    const fog = constrain(map(zAvg, -geoMean * 0.3, geoMean * 0.3, 1, 0), 0, 1);
    const shade = 200 * Math.pow(fog, 1.2);
    trailLayer.strokeWeight(6 * fog + 1.5);
    trailLayer.stroke(shade, shade, shade, 28 * fog);
    trailLayer.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
  }

  // Pass 2: crisp core (near-white ink line)
  for (let i = 1; i <= KNOT_STEPS; i++) {
    const a = i - 1, b = i;
    const zAvg = (depths[a] + depths[b]) * 0.5;
    const fog = constrain(map(zAvg, -geoMean * 0.3, geoMean * 0.3, 1, 0), 0, 1);
    const shade = 255 * Math.pow(fog, 0.8);
    const alpha = 100 + 155 * Math.pow(fog, 1.0);
    const sw = 0.7 + 1.8 * fog;
    trailLayer.strokeWeight(sw);
    trailLayer.stroke(shade, shade, shade, alpha);
    trailLayer.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
  }
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function renderGrain() {
  if (!grainLayer) return;
  grainLayer.clear();
  grainLayer.noStroke();
  const count = floor(W * H * 0.004);
  for (let i = 0; i < count; i++) {
    const v = random(60, 210);
    grainLayer.fill(v, v, v, random(4, 14));
    grainLayer.circle(random(W), random(H), random(0.3, 1.4));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 60;
  const maxR = dist(0, 0, W / 2, H / 2) * 1.08;
  const sw = (maxR / steps) * 2 + 2;
  strokeWeight(sw);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.55, 1.0, 0, 220, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    const r = lerp(0, maxR, k);
    circle(0, 0, r * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseedPattern(floor(random(100000))); }

function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('20260417_' + timestampString(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseedPattern(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome or Edge.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W, height: H,
    bitrate: 18_000_000,
    framerate: FPS,
  });

  recFrameCount = 0;
  isRecording = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
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
  a.download = '20260417_' + timestampString() + '.mp4';
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

function updateRecordingUI() {
  const dEl = document.getElementById('duration');
  const fEl = document.getElementById('frameCount');
  if (dEl) dEl.textContent = (recFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recFrameCount;
}

function updateCanvasInfo() {
  const el = document.getElementById('canvasSize');
  if (el) el.textContent = W + ' × ' + H;
}

function timestampString() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

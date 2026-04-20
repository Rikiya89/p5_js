'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const LOOP_SECONDS = 20;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

// ─── Palette (monochrome) ─────────────────────────────────────────────────────
// Black & white only. Plane identity is conveyed by stroke pattern, not hue:
//   XY → solid    XZ → dashed    YZ → dotted
const BG   = [0, 0, 0];
const INK  = [255, 255, 255];

// Semantic aliases (kept so call sites don't care about the palette swap)
const MINT = INK;   // X axis / YZ plane
const CYAN = INK;   // Y axis / XZ plane
const VIO  = INK;   // Z axis / XY plane
const MAG  = INK;   // lattice points

const TRAIL_ALPHA = 20;

// ─── Cartesian scene params ───────────────────────────────────────────────────
// The scene lives in a cube [-1, 1]³. Three coordinate planes (XY at z=0,
// YZ at x=0, XZ at y=0) are drawn as grids. A lattice of points floats inside;
// each point (x, y, z) casts three orthogonal projection lines onto the three
// coordinate planes — the geometric meaning of "a point is three numbers."

const LATTICE_N = 5;              // points per axis → N³ total
const GRID_DIVS = 8;              // grid lines per plane
const CUBE_HALF = 1.0;            // half-extent of the Cartesian box

// Depth fog
const FOG_NEAR = -1.8;
const FOG_FAR  =  1.8;

// ─── State ────────────────────────────────────────────────────────────────────
let trailLayer = null;
let grainLayer = null;

let motionSeed = 0;
let phaseA = 0, phaseB = 0, phaseC = 0;

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

  // Fade trail
  trailLayer.noStroke();
  trailLayer.fill(BG[0], BG[1], BG[2], TRAIL_ALPHA);
  trailLayer.rect(0, 0, W, H);

  // Camera orbit — slow tilted tour around the cube
  camAz = la * 0.5 + phaseA;
  camEl = sin(la + phaseB) * 0.45 + 0.15;

  // 1. Three coordinate planes (grids) — distinguished by stroke pattern
  drawCoordinatePlane('XY', 'solid',  la);
  drawCoordinatePlane('XZ', 'dashed', la);
  drawCoordinatePlane('YZ', 'dotted', la);

  // 2. The three Cartesian axes — brighter, thicker
  drawAxis([1,0,0], la);
  drawAxis([0,1,0], la);
  drawAxis([0,0,1], la);

  // 3. Lattice of points + their projection lines
  drawLattice(la);

  // Composite trail
  background(BG[0], BG[1], BG[2]);
  push();
  translate(-W / 2, -H / 2, 0);
  image(trailLayer, 0, 0);
  pop();

  // Grain
  push();
  translate(-W / 2, -H / 2, 0);
  tint(255, 38);
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

// ─── Projection: world (x,y,z) ∈ ℝ³ → screen pixels ───────────────────────────
// Shared by every drawing routine. Returns { sx, sy, depth } where depth is
// the camera-space z, used for fog.
function project(x, y, z) {
  const geoMean = Math.sqrt(W * H);
  const scale = geoMean * 0.28;   // world unit → pixels before perspective
  let px = x * scale;
  let py = y * scale;
  let pz = z * scale;

  // Camera: yaw around Y, then pitch around X
  let rx = px * cos(camAz) + pz * sin(camAz);
  let rz = -px * sin(camAz) + pz * cos(camAz);
  let ry = py;
  const y2 = ry * cos(camEl) - rz * sin(camEl);
  const z2 = ry * sin(camEl) + rz * cos(camEl);
  ry = y2; rz = z2;

  const FOV = geoMean * 1.15;
  const persp = FOV / (FOV + rz + geoMean * 0.95);
  return {
    sx: W * 0.5 + rx * persp,
    sy: H * 0.5 + ry * persp,
    depth: rz / scale,   // normalized back to world units
  };
}

function fogShade(depth) {
  return constrain(map(depth, FOG_NEAR, FOG_FAR, 1, 0.15), 0.15, 1);
}

// ─── Coordinate planes ────────────────────────────────────────────────────────
// Draws one of the three coordinate planes (XY, XZ, YZ) as a grid of lines.
// In monochrome, the three planes are distinguished by stroke pattern:
//   XY → solid    XZ → dashed    YZ → dotted
// Each plane sits at the "0" of its missing axis — the mathematical
// definition of a coordinate plane.
function drawCoordinatePlane(which, pattern, la) {
  const H2 = CUBE_HALF;
  const divs = GRID_DIVS;
  trailLayer.noFill();

  for (let i = 0; i <= divs; i++) {
    const t = map(i, 0, divs, -H2, H2);

    // Two line families per plane
    let a1, a2, b1, b2;
    if (which === 'XY') {
      a1 = [t, -H2, 0]; a2 = [t,  H2, 0];
      b1 = [-H2, t, 0]; b2 = [ H2, t, 0];
    } else if (which === 'XZ') {
      a1 = [t, 0, -H2]; a2 = [t, 0,  H2];
      b1 = [-H2, 0, t]; b2 = [ H2, 0, t];
    } else { // YZ
      a1 = [0, t, -H2]; a2 = [0, t,  H2];
      b1 = [0, -H2, t]; b2 = [0,  H2, t];
    }

    drawWorldLine(a1, a2, INK, 0.65, 46, pattern);
    drawWorldLine(b1, b2, INK, 0.65, 46, pattern);
  }
}

// Per-pattern parameters (in world units — CUBE_HALF = 1 unit):
//   solid  → one continuous segment
//   dashed → draw/skip bands of equal length
//   dotted → very short draw with a long skip
const DASH_LEN = 0.10;
const DOT_LEN  = 0.02;
const DOT_GAP  = 0.10;

function drawWorldLine(pA, pB, col, sw, alpha, pattern) {
  const steps = 16;   // subdivide for per-segment depth shading
  const mode  = pattern || 'solid';

  const segLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]);
  let prev = project(pA[0], pA[1], pA[2]);

  for (let i = 1; i <= steps; i++) {
    const tA = (i - 1) / steps;
    const tB = i / steps;
    const t  = tB;
    const x = lerp(pA[0], pB[0], t);
    const y = lerp(pA[1], pB[1], t);
    const z = lerp(pA[2], pB[2], t);
    const cur = project(x, y, z);

    // Pattern gating — decide whether this sub-segment should render
    let show = true;
    if (mode === 'dashed') {
      const midDist = (tA + tB) * 0.5 * segLen;
      show = (Math.floor(midDist / DASH_LEN) % 2) === 0;
    } else if (mode === 'dotted') {
      const midDist = (tA + tB) * 0.5 * segLen;
      const period  = DOT_LEN + DOT_GAP;
      show = (midDist % period) < DOT_LEN;
    }

    if (show) {
      const fog = fogShade((prev.depth + cur.depth) * 0.5);
      trailLayer.strokeWeight(sw * (0.6 + 0.8 * fog));
      trailLayer.stroke(col[0] * fog, col[1] * fog, col[2] * fog, alpha * fog);
      trailLayer.line(prev.sx, prev.sy, cur.sx, cur.sy);
    }
    prev = cur;
  }
}

// ─── Axes ─────────────────────────────────────────────────────────────────────
// Draws one axis from -1.25 to +1.25 along a unit direction, brighter and
// thicker than the grid lines so the coordinate frame reads clearly.
function drawAxis(dir, la) {
  const L = CUBE_HALF * 1.25;
  const pA = [-dir[0] * L, -dir[1] * L, -dir[2] * L];
  const pB = [ dir[0] * L,  dir[1] * L,  dir[2] * L];
  drawWorldLine(pA, pB, INK, 1.9, 210, 'solid');
}

// ─── Lattice + projections ────────────────────────────────────────────────────
// For every lattice index (i, j, k), the base position is a uniform Cartesian
// grid point in [-1, 1]³. `latticeOffset()` adds motion. Each point is drawn
// as a small cross; three orthogonal projection lines drop to the three
// coordinate planes, coloured by the plane they hit.
function drawLattice(la) {
  for (let i = 0; i < LATTICE_N; i++) {
    for (let j = 0; j < LATTICE_N; j++) {
      for (let k = 0; k < LATTICE_N; k++) {
        const u = LATTICE_N === 1 ? 0.5 : i / (LATTICE_N - 1);
        const v = LATTICE_N === 1 ? 0.5 : j / (LATTICE_N - 1);
        const w = LATTICE_N === 1 ? 0.5 : k / (LATTICE_N - 1);
        const bx = lerp(-CUBE_HALF, CUBE_HALF, u);
        const by = lerp(-CUBE_HALF, CUBE_HALF, v);
        const bz = lerp(-CUBE_HALF, CUBE_HALF, w);

        const [ox, oy, oz] = latticeOffset(i, j, k, bx, by, bz, la);
        const x = bx + ox;
        const y = by + oy;
        const z = bz + oz;

        // Projections onto the three coordinate planes — pattern matches
        // the host plane so you can still trace which drop goes where.
        drawWorldLine([x, y, z], [x, y, 0], INK, 0.55, 110, 'solid');   // XY
        drawWorldLine([x, y, z], [x, 0, z], INK, 0.55, 110, 'dashed');  // XZ
        drawWorldLine([x, y, z], [0, y, z], INK, 0.55, 110, 'dotted');  // YZ

        // Projected footprints (small squares on each plane)
        drawFootprint([x, y, 0]);
        drawFootprint([x, 0, z]);
        drawFootprint([0, y, z]);

        // The lattice point itself — magenta cross
        drawLatticePoint(x, y, z);
      }
    }
  }
}

function drawFootprint(p) {
  const s = project(p[0], p[1], p[2]);
  const fog = fogShade(s.depth);
  const r = 2.0 + 2.0 * fog;
  trailLayer.noStroke();
  trailLayer.fill(INK[0], INK[1], INK[2], 130 * fog);
  trailLayer.rect(s.sx - r * 0.5, s.sy - r * 0.5, r, r);
}

function drawLatticePoint(x, y, z) {
  const s = project(x, y, z);
  const fog = fogShade(s.depth);
  const r = 2.8 + 4.2 * fog;

  // Halo — kept very low alpha so pure white doesn't flood the frame.
  trailLayer.noStroke();
  for (let h = 3; h >= 1; h--) {
    const rr = r * (1 + h * 0.9);
    trailLayer.fill(INK[0], INK[1], INK[2], 10 * fog);
    trailLayer.circle(s.sx, s.sy, rr * 2);
  }

  // Core
  trailLayer.fill(255, 255, 255, 220 * fog + 35);
  trailLayer.circle(s.sx, s.sy, r);

  // Tiny cross — emphasizes "this is a coordinate point"
  trailLayer.stroke(INK[0], INK[1], INK[2], 220);
  trailLayer.strokeWeight(0.8);
  const cs = r * 1.6;
  trailLayer.line(s.sx - cs, s.sy, s.sx + cs, s.sy);
  trailLayer.line(s.sx, s.sy - cs, s.sx, s.sy + cs);
}

// ─── Lattice motion ───────────────────────────────────────────────────────────
// TODO(user): Implement the per-point offset. This is the decision that most
// shapes the feel of the piece — see the design-decision message for options.
//
// Parameters:
//   i, j, k    : integer indices (0..LATTICE_N-1) on each axis
//   bx, by, bz : base position in world units (each in [-CUBE_HALF, CUBE_HALF])
//   la         : loop angle, 0..TWO_PI, seamless over LOOP_SECONDS
//
// Return: an [ox, oy, oz] triple — the offset to add to (bx, by, bz).
//
// Constraints for a clean result:
//   • Keep each component roughly within ±0.25 so points don't escape the cube.
//   • Make it a function of `la` that returns to its start at la = TWO_PI
//     (i.e. use sin/cos of la, not raw time), so the recording loops.
//   • Use i, j, k (or bx, by, bz) to break symmetry across the lattice.
//
// Reference globals you can use: phaseA, phaseB, phaseC (random per-seed).
function latticeOffset(i, j, k, bx, by, bz, la) {
  // TODO: replace this placeholder (a gentle uniform wave) with your design.
  const ox = 0.12 * sin(la + bx * 2 + phaseA);
  const oy = 0.12 * sin(la + by * 2 + phaseB);
  const oz = 0.12 * sin(la + bz * 2 + phaseC);
  return [ox, oy, oz];
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
  if (key === 's' || key === 'S') { saveCanvas('20260420_' + timestampString(), 'png'); return false; }
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
  a.download = '20260420_' + timestampString() + '.mp4';
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

'use strict';

// -----------------------------------------------------------------------------
// FLOWER CLOUD — Rose curve + Fibonacci sunflower point cloud / 3D
// Canvas: 1080×1920 / 30fps / 30s loop / Bio-Synthetic palette
// -----------------------------------------------------------------------------

const W = 1080;
const H = 1920;

const FPS            = 30;
const LOOP_SECS      = 30;
const LOOP_FRAMES    = FPS * LOOP_SECS;
const VIDEO_BITRATE  = 20_000_000;
const VIDEO_FILENAME = 'flower_cloud_1080x1920_30s_30fps.mp4';

const TAU = Math.PI * 2;
const CX  = W * 0.5;
const CY  = H * 0.5;
const FOV = 2400;

// Black & White palette — RGB
const C_BG   = [0,   0,   0  ];
const C_MINT = [255, 255, 255];
const C_CYAN = [255, 255, 255];
const C_VIO  = [255, 255, 255];
const C_MAG  = [255, 255, 255];

// ---------------------------------------------------------------------------
// Fibonacci sunflower point cloud
// Golden angle: φ = 137.507764°  →  the irrational that produces no aliasing
// Points are distributed on a hemisphere then mirrored to form a sphere shell.
// Each point's radius follows the rose surface: |cos(k·θ_i)| so the sphere
// is "dented" into petals.
// ---------------------------------------------------------------------------
const N_FIB   = 4800;    // total points
const GOLDEN  = 137.507764 * (Math.PI / 180);

// Precomputed base positions — rebuilt each DEL key
let fibPts = [];   // { theta, phi, col }

function buildFibCloud() {
  fibPts = [];
  for (let i = 0; i < N_FIB; i++) {
    // Fibonacci sphere: uniform UV sampling via golden angle
    const t   = i / N_FIB;
    const phi = Math.acos(1 - 2 * t);           // polar angle 0→π
    const th  = i * GOLDEN;                     // azimuth — wraps quasiperiodically

    // Assign color by azimuth quadrant — 4 petal zones
    const zone = Math.floor(((th % TAU) / TAU) * 4);
    const col  = [C_MINT, C_CYAN, C_VIO, C_MAG][zone];

    fibPts.push({ phi, th, col });
  }
}

// ---------------------------------------------------------------------------
// Projection — shared by all layers
// ---------------------------------------------------------------------------
function project(x, y, z, rx, ry) {
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const x1 =  x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const y2 =  y * cosX - z1 * sinX;
  const z2 =  y * sinX + z1 * cosX;
  const s  = FOV / (FOV + z2);
  return { sx: CX + x1 * s, sy: CY + y2 * s * 1.26, depth: z2, scale: s };
}

// ---------------------------------------------------------------------------
// Rose surface radius — r = |cos(k·theta)|^exp
// k controls petal count; non-integer → merging/splitting animation
// ---------------------------------------------------------------------------
function roseR(k, theta, exp) {
  return Math.pow(Math.abs(Math.cos(k * theta)), exp);
}

// ---------------------------------------------------------------------------
// Draw Fibonacci sunflower point cloud
// Each point sits on the rose-deformed sphere surface
// ---------------------------------------------------------------------------
function drawFibCloud(loop, rotX, rotY, master) {
  // k morphs: 2→3→5→3→2 — non-integer values give intermediate petal counts
  const kBase = 2 + loop * 3;
  const k     = kBase + 0.5 * Math.sin(loop * TAU * 0.7);

  // Sphere radius pulses gently
  const R    = 420 * (1 + 0.06 * Math.sin(loop * TAU));
  const Rmin = 60;                   // minimum radius at petal troughs

  // Slow axial spin of the whole flower independent of camera orbit
  const selfRot = loop * TAU * 0.18;

  const maxDepth = R * 2.2;

  // Collect for painter sort
  const pts = new Array(fibPts.length);

  for (let i = 0; i < fibPts.length; i++) {
    const { phi, th, col } = fibPts[i];
    // Animate each point's azimuth slightly for breathing motion
    const thAnim = th + selfRot + 0.08 * Math.sin(loop * TAU + phi * 3.1);

    // Rose surface deformation: radius shrinks toward petal base
    const rm     = roseR(k, thAnim, 0.55);
    const radius = Rmin + (R - Rmin) * rm;

    // Spherical → Cartesian
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const st = Math.sin(thAnim), ct = Math.cos(thAnim);
    const wx = radius * sp * ct;
    const wy = radius * cp;
    const wz = radius * sp * st;

    const pr  = project(wx, wy, wz, rotX, rotY);
    const t   = Math.max(0, Math.min(1, (pr.depth + maxDepth) / (maxDepth * 2)));
    const fog = Math.pow(t, 1.4);

    // Brightness: tip of petal (rm≈1) glows brightest
    const tip   = Math.pow(rm, 0.7);
    const alpha = tip * fog * 160 * master;
    const sz    = (1.0 + 4.5 * tip * fog) * pr.scale;

    pts[i] = { x: pr.sx, y: pr.sy, depth: pr.depth, alpha, sz, fog, tip, col };
  }

  // Painter's sort — back to front
  pts.sort((a, b) => a.depth - b.depth);

  blendMode(ADD);
  noStroke();

  for (const p of pts) {
    const a = Math.max(0, Math.min(255, p.alpha));
    if (a < 1.5) continue;
    const [r, g, b] = p.col;

    // Wide outer nebula
    fill(r, g, b, a * 0.012);
    circle(p.x, p.y, p.sz * 18);

    // Mid halo
    fill(r, g, b, a * 0.038);
    circle(p.x, p.y, p.sz * 7);

    // Bright inner ring at petal tips
    if (p.tip > 0.5 && p.fog > 0.25) {
      fill(r, g, b, a * 0.13);
      circle(p.x, p.y, p.sz * 2.5);
      fill(r, g, b, Math.min(255, a * 0.32));
      circle(p.x, p.y, p.sz * 1.4);
    }

    // Core
    fill(r, g, b, Math.min(255, a * 1.05));
    circle(p.x, p.y, p.sz);

    // Trail stamp — only petal tips leave ghosts
    if (p.tip > 0.52 && a > 65) {
      trail.noStroke();
      trail.fill(r, g, b, a * 0.16);
      trail.circle(p.x, p.y, p.sz * 3.8);
    }
  }
}

// ---------------------------------------------------------------------------
// Rose curve spine — the explicit parametric curve r=cos(kθ) in 3D
// Drawn as a glowing line/point trail on top of the cloud
// Cycling through MINT→CYAN→VIO→MAG per petal arc
// ---------------------------------------------------------------------------
const ROSE_STEPS = 4000;

function drawRoseSpine(loop, rotX, rotY, master) {
  const kBase = 2 + loop * 3;
  const k     = kBase + 0.5 * Math.sin(loop * TAU * 0.7);
  const selfRot = loop * TAU * 0.18;
  const scale   = 420 * (1 + 0.06 * Math.sin(loop * TAU));
  const scaleZ  = 200;            // depth of the 3D twist
  const nPetals = Math.ceil(k);
  const maxDepth = scale * 2.2;

  const PALETTE = [C_MINT, C_CYAN, C_VIO, C_MAG];

  blendMode(ADD);
  noStroke();

  for (let i = 0; i <= ROSE_STEPS; i++) {
    const theta = (i / ROSE_STEPS) * TAU * nPetals + selfRot;
    const r     = Math.cos(k * theta);
    if (r < 0) continue;

    const rx3 = r * Math.cos(theta) * scale;
    const ry3 = r * Math.sin(theta) * scale;
    // Z gives each petal a gentle 3D ribbon twist
    const rz3 = Math.sin(k * theta * 0.7) * r * scaleZ;

    const pr  = project(rx3, ry3, rz3, rotX, rotY);
    const t   = Math.max(0, Math.min(1, (pr.depth + maxDepth) / (maxDepth * 2)));
    const fog = 0.2 + 0.8 * Math.pow(t, 1.1);

    const tipBright = Math.pow(r, 0.55);
    const alpha     = tipBright * fog * 220 * master;
    const sz        = (1.2 + 3.5 * tipBright * fog) * pr.scale;

    const a = Math.max(0, Math.min(255, alpha));
    if (a < 1.5) continue;

    // Color cycles per petal — use azimuth sector of the point
    const sector = ((theta % TAU) / TAU * 4 | 0) % 4;
    const [cr, cg, cb] = PALETTE[sector];

    // Outer glow
    fill(cr, cg, cb, a * 0.018);
    circle(pr.sx, pr.sy, sz * 12);
    fill(cr, cg, cb, a * 0.055);
    circle(pr.sx, pr.sy, sz * 5);

    if (tipBright > 0.5) {
      fill(cr, cg, cb, a * 0.18);
      circle(pr.sx, pr.sy, sz * 2.2);
      fill(cr, cg, cb, Math.min(255, a * 0.38));
      circle(pr.sx, pr.sy, sz * 1.3);
    }

    fill(cr, cg, cb, Math.min(255, a * 1.1));
    circle(pr.sx, pr.sy, sz);

    if (tipBright > 0.48 && a > 80) {
      trail.noStroke();
      trail.fill(cr, cg, cb, a * 0.20);
      trail.circle(pr.sx, pr.sy, sz * 4.0);
    }
  }
}

// ---------------------------------------------------------------------------
// p5 setup / draw
// ---------------------------------------------------------------------------
let trail;
let canvasEl;
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0, captureInProgress = false;

buildFibCloud();

function setup() {
  const cnv = createCanvas(W, H);
  canvasEl  = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  trail = createGraphics(W, H);
  trail.pixelDensity(1);
  trail.colorMode(RGB, 255, 255, 255, 255);
  trail.clear();

  setupCaptureUI();
}

function draw() {
  const cf   = isRecording ? recFrameCount : frameCount;
  const loop = (cf % LOOP_FRAMES) / LOOP_FRAMES;

  // Camera — slow orbital path + gentle tilt
  const rotY = loop * TAU * 0.5 + 0.22 * Math.sin(loop * TAU * 1.8);
  const rotX = 0.20 * Math.sin(loop * TAU * 0.6 + 0.9);

  const fadeIn  = smoothstep(0.00, 0.05, loop);
  const fadeOut = 1 - smoothstep(0.94, 1.00, loop);
  const master  = Math.min(fadeIn, fadeOut);

  background(0);

  // Trail composite + decay
  image(trail, 0, 0);
  trail.noStroke();
  trail.fill(0, 0, 0, 14);
  trail.rect(0, 0, W, H);

  // ---- Fibonacci sunflower cloud ----
  drawFibCloud(loop, rotX, rotY, master);

  // ---- Rose spine overlay ----
  drawRoseSpine(loop, rotX, rotY, master);

  blendMode(BLEND);

  // ---- Film grain ----
  drawGrain(master);

  // ---- Master fade ----
  if (master < 1) {
    noStroke();
    fill(0, 0, 0, 255 * (1 - master));
    rect(0, 0, W, H);
  }

  // ---- HUD ----
  noStroke();
  fill(255, 255, 255, 22 * master);
  textSize(10);
  textFont('monospace');
  textAlign(LEFT, BOTTOM);
  text(`FLOWER CLOUD  ${nf(loop * 100, 2, 1)}%  ${W}×${H}`, 18, H - 18);

  // ---- Capture ----
  if (isRecording && !captureInProgress) {
    captureInProgress = true;
    captureFrame()
      .then(() => {
        recFrameCount++;
        if (recFrameCount >= LOOP_FRAMES) stopRecording();
      })
      .catch(e => { console.error(e); updateStatus('Capture error.'); stopRecording(); })
      .finally(() => { captureInProgress = false; });
  }
}

// ---------------------------------------------------------------------------
// Film grain
// ---------------------------------------------------------------------------
function drawGrain(master) {
  blendMode(ADD);
  noStroke();
  const count = Math.floor(W * H * 0.0012);
  for (let i = 0; i < count; i++) {
    const v = random(2, 10) * master;
    fill(255, 255, 255, v);
    rect(Math.floor(random(W)), Math.floor(random(H)), 1, 1);
  }
  blendMode(BLEND);
}

function smoothstep(e0, e1, x) {
  const n = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return n * n * (3 - 2 * n);
}

// ---------------------------------------------------------------------------
// Capture pipeline
// ---------------------------------------------------------------------------
function setupCaptureUI() {
  updateStatus('Ready');
  const el = (id) => document.getElementById(id);
  if (el('canvasSize'))  el('canvasSize').textContent  = `${W}×${H} / ${FPS}fps`;
  if (el('maxDuration')) el('maxDuration').textContent = LOOP_SECS;
  if (el('maxFrames'))   el('maxFrames').textContent   = LOOP_FRAMES;
}

async function startRecording() {
  if (isRecording) return;
  if (!window.VideoEncoder || !window.Mp4Muxer) { alert('VideoEncoder or Mp4Muxer unavailable.'); return; }
  recFrameCount = 0; captureInProgress = false; trail.clear();
  const sb = document.getElementById('startBtn'), rb = document.getElementById('stopBtn');
  if (sb) sb.disabled = true; if (rb) rb.disabled = false;
  updateStatus(`Recording ${W}×${H} / ${FPS}fps`);
  try {
    muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      fastStart: 'in-memory',
    });
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error:  (e) => { console.error(e); updateStatus('Encoder error.'); stopRecording(); },
    });
    encoder.configure({
      codec: 'avc1.64002A', width: W, height: H,
      bitrate: VIDEO_BITRATE, bitrateMode: 'constant',
      framerate: FPS, avc: { format: 'avc' }, latencyMode: 'quality',
    });
    isRecording = true;
  } catch (e) {
    console.error(e); encoder = muxer = null; isRecording = captureInProgress = false;
    if (sb) sb.disabled = false; if (rb) rb.disabled = true;
    updateStatus('Setup failed. See console.');
  }
}

async function captureFrame() {
  if (!encoder) throw new Error('Encoder not initialized.');
  const bitmap = await createImageBitmap(canvasEl);
  const frame  = new VideoFrame(bitmap, {
    timestamp: Math.round((recFrameCount * 1_000_000) / FPS),
    duration:  Math.round(1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close(); bitmap.close();
  updateProgress();
}

async function stopRecording() {
  if (!isRecording && !encoder) return;
  isRecording = false; captureInProgress = false;
  updateStatus('Finalizing MP4…');
  try {
    if (encoder) await encoder.flush();
    if (muxer) {
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = VIDEO_FILENAME; a.click();
      URL.revokeObjectURL(url);
    }
    updateStatus('Done — MP4 saved.');
  } catch (e) { console.error(e); updateStatus('Export failed.'); }
  finally {
    encoder = muxer = null;
    const sb = document.getElementById('startBtn'), rb = document.getElementById('stopBtn');
    if (sb) sb.disabled = false; if (rb) rb.disabled = true;
    updateProgress();
  }
}

function updateStatus(msg) { const e = document.getElementById('status'); if (e) e.textContent = msg; }

function updateProgress() {
  const pf  = document.getElementById('progressFill');
  const dur = document.getElementById('duration');
  const fc  = document.getElementById('frameCount');
  const p   = Math.max(0, Math.min(1, recFrameCount / LOOP_FRAMES));
  if (pf)  pf.style.width  = `${(p * 100).toFixed(1)}%`;
  if (dur) dur.textContent = (recFrameCount / FPS).toFixed(1);
  if (fc)  fc.textContent  = recFrameCount;
}

function keyPressed() {
  if (key === 'r' || key === 'R') startRecording();
  if (key === 's' || key === 'S') saveCanvas('flower_cloud_still', 'png');
  if (keyCode === DELETE || keyCode === BACKSPACE) { buildFibCloud(); trail.clear(); updateStatus('Reseeded'); }
}

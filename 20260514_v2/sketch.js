'use strict';

// -----------------------------------------------------------------------------
// WAVE BOX v2 — 3D Point Cloud Wave Simulator / 1080×1920 / 30s / 30fps / B&W
// Grid particles + mesh fabric + trail buffer + depth fog inside wireframe box
// -----------------------------------------------------------------------------

const W = 1080;
const H = 1920;

const FPS          = 30;
const LOOP_SECS    = 30;
const LOOP_FRAMES  = FPS * LOOP_SECS;
const VIDEO_BITRATE  = 20_000_000;
const VIDEO_FILENAME = 'wave_box_v2_1080x1920_30s_30fps.mp4';

const TAU = Math.PI * 2;
const CX  = W * 0.5;
const CY  = H * 0.5;

// Grid resolution — COLS × ROWS × LAYERS
// Reduced slightly so mesh lines stay performant
const COLS   = 22;
const ROWS   = 22;
const LAYERS = 14;

// Box half-extents
const BX = 340;
const BY = 520;
const BZ = 340;

const FOV = 2400;

// ---------------------------------------------------------------------------
// Wave parameters — 3 overlapping sine waves
// ---------------------------------------------------------------------------
const WAVES = [
  { kx: 1.8,  ky: 0.0,  kz: 1.2,  omega: 1.00, amp: 1.00, phase: 0.00 },
  { kx: -1.1, ky: 0.0,  kz: 2.3,  omega: 1.57, amp: 0.60, phase: 1.05 },
  { kx: 2.4,  ky: 0.0,  kz: -0.9, omega: 0.79, amp: 0.40, phase: 2.30 },
];

// ---------------------------------------------------------------------------
// Projection
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
// Wave displacement at grid position — ky=0 so waves travel horizontally
// Y-displacement only → readable as surface waves
// ---------------------------------------------------------------------------
function waveDisplace(nx, nz, t) {
  let d = 0, totalAmp = 0;
  for (const w of WAVES) {
    d += w.amp * Math.sin(w.kx * nx * TAU + w.kz * nz * TAU + w.omega * t * TAU + w.phase);
    totalAmp += w.amp;
  }
  return d / totalAmp;  // [−1..1]
}

// ---------------------------------------------------------------------------
// Particle grid — each LAYER is a horizontal sheet; wave displaces it in Y
// ---------------------------------------------------------------------------
let particles = [];

function buildGrid() {
  particles = [];
  for (let iz = 0; iz < LAYERS; iz++) {
    for (let iy = 0; iy < ROWS; iy++) {
      for (let ix = 0; ix < COLS; ix++) {
        const nx = ix / (COLS   - 1);
        const ny = iy / (ROWS   - 1);
        const nz = iz / (LAYERS - 1);
        particles.push({
          rx: (nx - 0.5) * 2 * BX,
          ry: (ny - 0.5) * 2 * BY,
          rz: (nz - 0.5) * 2 * BZ,
          nx, ny, nz,
          ix, iy, iz,
          // index into the flat array for fast neighbour lookup
          idx: iz * ROWS * COLS + iy * COLS + ix,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Box wireframe
// ---------------------------------------------------------------------------
function drawBox(rx, ry, master) {
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    corners.push(project(sx * BX, sy * BY, sz * BZ, rx, ry));

  const edges = [
    [0,1],[2,3],[4,5],[6,7],
    [0,2],[1,3],[4,6],[5,7],
    [0,4],[1,5],[2,6],[3,7],
  ];
  blendMode(BLEND);
  noFill(); strokeCap(ROUND);
  for (const [a, b] of edges) {
    const fog = constrain(((corners[a].depth + corners[b].depth) * 0.5 + BZ * 2) / (BZ * 4), 0.25, 1.0);
    stroke(255, 255, 255, 48 * fog * master);
    strokeWeight(0.7);
    line(corners[a].sx, corners[a].sy, corners[b].sx, corners[b].sy);
  }
}

// ---------------------------------------------------------------------------
// p5 setup / draw
// ---------------------------------------------------------------------------
let trail;
let canvasEl;
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0, captureInProgress = false;

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

  buildGrid();
  setupCaptureUI();
}

function draw() {
  const cf   = isRecording ? recFrameCount : frameCount;
  const loop = (cf % LOOP_FRAMES) / LOOP_FRAMES;
  const t    = loop;

  const rotY = loop * TAU * 0.5;
  const rotX = 0.18 * Math.sin(loop * TAU * 0.5 + 0.4);

  const fadeIn  = smoothstep(0.00, 0.05, loop);
  const fadeOut = 1 - smoothstep(0.94, 1.00, loop);
  const master  = Math.min(fadeIn, fadeOut);

  background(0);

  // Trail buffer: composite previous then decay
  image(trail, 0, 0);
  trail.noStroke();
  trail.fill(0, 0, 0, 22);
  trail.rect(0, 0, W, H);

  // ---- Box ----
  drawBox(rotX, rotY, master);

  // ---- Compute all particle positions ----
  // Store projected results for mesh line pass
  const proj  = new Array(particles.length);
  const disp  = new Float32Array(particles.length);
  const waveAmp = BY * 0.68;

  for (let i = 0; i < particles.length; i++) {
    const p  = particles[i];
    const d  = waveDisplace(p.nx, p.nz, t);
    disp[i]  = d;
    const py = constrain(p.ry + d * waveAmp, -BY, BY);
    proj[i]  = project(p.rx, py, p.rz, rotX, rotY);
  }

  // ---- Mesh fabric lines (X and Z neighbours, within same Y layer) ----
  blendMode(ADD);
  noFill(); strokeCap(ROUND);

  for (let i = 0; i < particles.length; i++) {
    const p  = particles[i];
    const pa = proj[i];
    const da = Math.abs(disp[i]);

    // Only draw from front-facing positions
    const fogA = constrain((pa.depth + BZ * 2) / (BZ * 4), 0, 1);
    if (fogA < 0.15) continue;

    // +X neighbour (same iy, iz row)
    if (p.ix < COLS - 1) {
      const j  = i + 1;
      const pb = proj[j];
      const db = Math.abs(disp[j]);
      const avgMag  = (da + db) * 0.5;
      const fogB    = constrain((pb.depth + BZ * 2) / (BZ * 4), 0, 1);
      const avgFog  = (fogA + fogB) * 0.5;
      const baseAlpha = (0.10 + Math.pow(avgMag, 1.3) * 0.90);
      const lineAlpha = baseAlpha * 82 * avgFog * master;
      if (lineAlpha > 1.0) {
        stroke(255, 255, 255, constrain(lineAlpha, 0, 255));
        strokeWeight(1.6);
        line(pa.sx, pa.sy, pb.sx, pb.sy);
      }
    }

    // +Z neighbour (same ix, iy — step by COLS)
    if (p.iz < LAYERS - 1) {
      const j  = i + ROWS * COLS;
      const pb = proj[j];
      const db = Math.abs(disp[j]);
      const avgMag  = (da + db) * 0.5;
      const fogB    = constrain((pb.depth + BZ * 2) / (BZ * 4), 0, 1);
      const avgFog  = (fogA + fogB) * 0.5;
      const baseAlpha = (0.10 + Math.pow(avgMag, 1.3) * 0.90);
      const lineAlpha = baseAlpha * 66 * avgFog * master;
      if (lineAlpha > 1.0) {
        stroke(255, 255, 255, constrain(lineAlpha, 0, 255));
        strokeWeight(1.3);
        line(pa.sx, pa.sy, pb.sx, pb.sy);
      }
    }

    // +Y neighbour (vertical column connections)
    if (p.iy < ROWS - 1) {
      const j  = i + COLS;
      const pb = proj[j];
      const db = Math.abs(disp[j]);
      const avgMag  = (da + db) * 0.5;
      const fogB    = constrain((pb.depth + BZ * 2) / (BZ * 4), 0, 1);
      const avgFog  = (fogA + fogB) * 0.5;
      const baseAlpha = (0.08 + Math.pow(avgMag, 1.4) * 0.92);
      const lineAlpha = baseAlpha * 48 * avgFog * master;
      if (lineAlpha > 1.0) {
        stroke(255, 255, 255, constrain(lineAlpha, 0, 255));
        strokeWeight(1.0);
        line(pa.sx, pa.sy, pb.sx, pb.sy);
      }
    }
  }

  // ---- Collect & sort particles (painter's sort) ----
  const drawList = new Array(particles.length);
  for (let i = 0; i < particles.length; i++) {
    const p   = particles[i];
    const d   = disp[i];
    const pr  = proj[i];
    const mag = Math.abs(d);

    // Sharp contrast: crests bright, troughs near-zero
    const brightness = Math.pow(mag, 1.55);
    const fog        = Math.pow(constrain((pr.depth + BZ * 2) / (BZ * 4), 0, 1), 1.5);
    const alpha      = 210 * brightness * fog * master;
    const sz         = (2.0 + 5.5 * brightness) * pr.scale;

    drawList[i] = { x: pr.sx, y: pr.sy, depth: pr.depth, alpha, sz, brightness };
  }
  drawList.sort((a, b) => a.depth - b.depth);

  // ---- Draw particles ----
  noStroke();
  for (const p of drawList) {
    const a = constrain(p.alpha, 0, 255);
    if (a < 2) continue;

    // Glow layers on crests
    if (p.brightness > 0.55 && a > 55) {
      fill(255, 255, 255, a * 0.035);
      circle(p.x, p.y, p.sz * 9.5);
      fill(255, 255, 255, a * 0.09);
      circle(p.x, p.y, p.sz * 4.0);
      fill(255, 255, 255, a * 0.20);
      circle(p.x, p.y, p.sz * 2.0);
    }

    fill(255, 255, 255, a);
    circle(p.x, p.y, p.sz);

    // Trail stamp — only the brightest crests leave ghosts
    if (p.brightness > 0.75 && a > 140) {
      trail.noStroke();
      trail.fill(255, 255, 255, a * 0.09);
      trail.circle(p.x, p.y, p.sz * 2.8);
    }
  }

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
  fill(255, 255, 255, 26 * master);
  textSize(10);
  textFont('monospace');
  textAlign(LEFT, BOTTOM);
  text(`WAVE BOX v2  ${nf(loop * 100, 2, 1)}%  ${W}×${H}`, 18, H - 18);

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
  const count = Math.floor(W * H * 0.0016);
  for (let i = 0; i < count; i++) {
    fill(255, 255, 255, random(3, 13) * master);
    rect(Math.floor(random(W)), Math.floor(random(H)), 1, 1);
  }
  blendMode(BLEND);
}

function smoothstep(e0, e1, x) {
  const n = constrain((x - e0) / (e1 - e0), 0, 1);
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
  const p   = constrain(recFrameCount / LOOP_FRAMES, 0, 1);
  if (pf)  pf.style.width  = `${(p * 100).toFixed(1)}%`;
  if (dur) dur.textContent = (recFrameCount / FPS).toFixed(1);
  if (fc)  fc.textContent  = recFrameCount;
}

function keyPressed() {
  if (key === 'r' || key === 'R') startRecording();
  if (key === 's' || key === 'S') saveCanvas('wave_box_v2_still', 'png');
  if (keyCode === DELETE || keyCode === BACKSPACE) { buildGrid(); updateStatus('Reseeded'); }
}

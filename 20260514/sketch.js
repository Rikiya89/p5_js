'use strict';

// -----------------------------------------------------------------------------
// FLORAL VOID v2 — 3D Point Cloud Flower / 1080×1920 / 30s / 30fps / B&W
// Rhodonea × Gielis Superformula × constellation web × depth fog × bloom glow
// -----------------------------------------------------------------------------

const W = 1080;
const H = 1920;

const FPS         = 30;
const LOOP_SECS   = 30;
const LOOP_FRAMES = FPS * LOOP_SECS;
const VIDEO_BITRATE  = 20_000_000;
const VIDEO_FILENAME = 'floral_void_v2_1080x1920_30s_30fps.mp4';

const TAU          = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const CX = W * 0.5;
const CY = H * 0.5;

// Point counts
const BLOOM_PTS = 3600;
const DUST_PTS  = 600;
const RING_SEGS = 9;
const RING_PTS_PER = 90;

// Gielis superformula — r(φ) = (|cos(mφ/4)/a|^n2 + |sin(mφ/4)/b|^n3)^(-1/n1)
// Maps φ → radius modifier [0..1]
function superformula(phi, m, n1, n2, n3, a = 1, b = 1) {
  const t1 = Math.pow(Math.abs(Math.cos(m * phi / 4) / a), n2);
  const t2 = Math.pow(Math.abs(Math.sin(m * phi / 4) / b), n3);
  return Math.pow(t1 + t2, -1 / n1);
}

// Normalize a superformula to [0..1] range using its max across phi
function normSuperformula(phi, m, n1, n2, n3) {
  const r = superformula(phi, m, n1, n2, n3);
  // Clamp runaway values (n1<1 can explode near zeros)
  return Math.min(r / 2.4, 1.0);
}

// Rhodonea: r = |cos(k·phi)|^exp, normalized
function rhodonea(phi, k, exp) {
  return Math.pow(Math.abs(Math.cos(k * phi)), exp);
}

// Blend two petal functions
function petalBlend(phi, t) {
  // Animate n1 of superformula: petals "open" over first 15s, hold, then close
  const n1 = 0.30 + 0.45 * Math.abs(Math.sin(t * 0.5));
  const sf  = normSuperformula(phi, 6, n1, 0.6, 0.6);
  const rh  = rhodonea(phi, 5, 0.60);
  const mix = 0.5 + 0.5 * Math.sin(t * 0.33);
  return mix * sf + (1 - mix) * rh;
}

// 3D orthographic projection with rotX / rotY
function project(p, rx, ry) {
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const x1 =  p.x * cosY + p.z * sinY;
  const z1 = -p.x * sinY + p.z * cosY;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const y2 =  p.y * cosX - z1 * sinX;
  const z2 =  p.y * sinX + z1 * cosX;
  // Perspective (mild)
  const fov  = 2200;
  const scale = fov / (fov + z2);
  return { sx: CX + x1 * scale, sy: CY + y2 * scale * 1.28, depth: z2 };
}

// ---------------------------------------------------------------------------
// Point cloud data
// ---------------------------------------------------------------------------
let bloomCloud = [];
let dustCloud  = [];
let ringCloud  = [];

// nearest-neighbor edge list built at cloud creation (for constellation web)
let edges = [];

function buildClouds() {
  bloomCloud = [];
  dustCloud  = [];
  ringCloud  = [];
  edges      = [];

  // Three rose layers, each with different petal formula weight
  const layers = [
    { k: 3, exp: 0.55, baseR: 340, sfM: 6, sfN1: 0.35, sfN2: 0.6,  sfN3: 0.6,  count: Math.floor(BLOOM_PTS * 0.38) },
    { k: 5, exp: 0.70, baseR: 295, sfM: 8, sfN1: 0.42, sfN2: 0.55, sfN3: 0.55, count: Math.floor(BLOOM_PTS * 0.35) },
    { k: 7, exp: 0.45, baseR: 370, sfM: 5, sfN1: 0.28, sfN2: 0.7,  sfN3: 0.7,  count: Math.floor(BLOOM_PTS * 0.27) },
  ];

  layers.forEach((cfg, li) => {
    for (let i = 0; i < cfg.count; i++) {
      const phi   = i * GOLDEN_ANGLE;
      const theta = Math.acos(1 - 2 * (i + 0.5) / cfg.count);

      const petalRho = rhodonea(phi, cfg.k, cfg.exp);
      const petalSF  = normSuperformula(phi, cfg.sfM, cfg.sfN1, cfg.sfN2, cfg.sfN3);
      const petal    = 0.5 * petalRho + 0.5 * petalSF;

      const r = cfg.baseR * (0.28 + 0.72 * petal);
      const x = r * Math.sin(theta) * Math.cos(phi);
      const y = r * Math.sin(theta) * Math.sin(phi);
      const z = r * Math.cos(theta);

      bloomCloud.push({
        x0: x, y0: y, z0: z,  // rest position
        baseR: cfg.baseR,
        k: cfg.k, exp: cfg.exp,
        sfM: cfg.sfM, sfN1: cfg.sfN1, sfN2: cfg.sfN2, sfN3: cfg.sfN3,
        phi, theta,
        phase:  random(TAU),
        size:   random(1.4, 3.8),
        bright: random(0.58, 1.0),
        layer: li,
      });
    }
  });

  // Build constellation edges: for each point, connect to 2 nearest neighbours
  // (sampled — only check every 4th pair to keep build time fast)
  const N = bloomCloud.length;
  for (let i = 0; i < N; i++) {
    const a = bloomCloud[i];
    let best1 = Infinity, best2 = Infinity, j1 = -1, j2 = -1;
    for (let j = i + 1; j < N; j += 4) {
      const dx = a.x0 - bloomCloud[j].x0;
      const dy = a.y0 - bloomCloud[j].y0;
      const dz = a.z0 - bloomCloud[j].z0;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best1) { best2 = best1; j2 = j1; best1 = d2; j1 = j; }
      else if (d2 < best2) { best2 = d2; j2 = j; }
    }
    if (j1 >= 0 && best1 < 70 * 70) edges.push([i, j1]);
    if (j2 >= 0 && best2 < 70 * 70) edges.push([i, j2]);
  }

  // Ambient dust — sparse shell
  for (let i = 0; i < DUST_PTS; i++) {
    const r     = random(430, 640);
    const theta = random(Math.PI);
    const phi   = random(TAU);
    dustCloud.push({
      x: r * Math.sin(theta) * Math.cos(phi),
      y: r * Math.sin(theta) * Math.sin(phi),
      z: r * Math.cos(theta),
      phase: random(TAU),
      size: random(0.7, 1.6),
    });
  }

  // Tilted rings
  for (let ring = 0; ring < RING_SEGS; ring++) {
    const ringR = 110 + ring * 56;
    const tilt  = random(-0.55, 0.55);
    const twist = random(TAU);
    const speed = (ring % 2 === 0 ? 1 : -1) * random(0.004, 0.010);
    for (let j = 0; j < RING_PTS_PER; j++) {
      const phi = (j / RING_PTS_PER) * TAU + twist;
      ringCloud.push({
        x: ringR * Math.cos(phi),
        y: ringR * Math.sin(phi) * Math.cos(tilt),
        z: ringR * Math.sin(phi) * Math.sin(tilt),
        phi, ring,
        speed,
        tilt, twist, ringR,
        phase: random(TAU),
        size: 1.0 + ring * 0.14,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Compute animated 3D position of bloom point at time t
// ---------------------------------------------------------------------------
function animBloom(p, t) {
  const bt      = t + p.phase * 0.04;
  const breathe = 1 + 0.07 * Math.sin(bt * 2.0 + p.phase);
  const dynPhi  = p.phi + t * 0.018;

  const petalRho = rhodonea(dynPhi, p.k, p.exp);
  const petalSF  = normSuperformula(dynPhi, p.sfM, p.sfN1, p.sfN2, p.sfN3);
  const petal    = 0.5 * petalRho + 0.5 * petalSF;

  const r = p.baseR * (0.28 + 0.72 * petal) * breathe;
  return {
    x: r * Math.sin(p.theta) * Math.cos(p.phi),
    y: r * Math.sin(p.theta) * Math.sin(p.phi),
    z: r * Math.cos(p.theta),
  };
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
  trail.clear();

  randomSeed(888);
  noiseSeed(888);
  buildClouds();
  setupCaptureUI();
}

function draw() {
  const cf   = isRecording ? recFrameCount : frameCount;
  const loop = (cf % LOOP_FRAMES) / LOOP_FRAMES;
  const t    = loop * TAU;

  // One exact full rotation per loop — no seam jump
  const rotY = t;
  const rotX = 0.20 * Math.sin(t * 0.5);   // gentle tilt oscillation

  const opening = smoothstep(0.00, 0.06, loop);
  const bloom   = smoothstep(0.05, 0.38, loop);
  const fadeOut = 1 - smoothstep(0.93, 1.00, loop);
  const master  = Math.min(opening, fadeOut);

  background(0);

  // Trail decay
  image(trail, 0, 0);
  trail.noStroke();
  trail.fill(0, 0, 0, 14);
  trail.rect(0, 0, W, H);

  // ---- Project all points ----
  const projBloom = new Array(bloomCloud.length);
  for (let i = 0; i < bloomCloud.length; i++) {
    const anim = animBloom(bloomCloud[i], t);
    projBloom[i] = project(anim, rotX, rotY);
  }

  // ---- Constellation web (drawn before points for layering) ----
  blendMode(ADD);
  noFill();
  strokeCap(ROUND);

  for (let e = 0; e < edges.length; e++) {
    const [ia, ib] = edges[e];
    const pa = projBloom[ia], pb = projBloom[ib];
    const depthA = constrain((pa.depth + 600) / 1200, 0, 1);
    const depthB = constrain((pb.depth + 600) / 1200, 0, 1);
    const avgDepth = (depthA + depthB) * 0.5;
    if (avgDepth < 0.42) continue;   // only front-facing edges visible
    const a = Math.pow(avgDepth, 2.2) * 28 * master * bloom;
    if (a < 1) continue;
    stroke(255, 255, 255, constrain(a, 0, 255));
    strokeWeight(0.55);
    line(pa.sx, pa.sy, pb.sx, pb.sy);
  }

  // ---- Project rings & dust, collect all into draw list ----
  const drawList = [];

  for (let i = 0; i < bloomCloud.length; i++) {
    const p     = bloomCloud[i];
    const proj  = projBloom[i];
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.5 + p.phase);
    const depthNorm = Math.pow(constrain((proj.depth + 600) / 1200, 0, 1), 1.8);
    const alpha = (80 + 175 * pulse) * p.bright * master * bloom * (0.38 + 0.62 * depthNorm);
    const sz    = p.size * (0.55 + 0.65 * depthNorm) * (1 + pulse * 0.50);
    drawList.push({ x: proj.sx, y: proj.sy, depth: proj.depth, alpha, sz, type: 'bloom' });
  }

  for (let i = 0; i < dustCloud.length; i++) {
    const p    = dustCloud[i];
    const proj = project(p, rotX, rotY);
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + p.phase);
    const depthNorm = Math.pow(constrain((proj.depth + 600) / 1200, 0, 1), 1.8);
    const alpha = (12 + 28 * pulse) * master * opening * depthNorm;
    drawList.push({ x: proj.sx, y: proj.sy, depth: proj.depth, alpha, sz: p.size * (0.4 + 0.6 * depthNorm), type: 'dust' });
  }

  for (let i = 0; i < ringCloud.length; i++) {
    const p     = ringCloud[i];
    const phi   = p.phi + t * p.speed * TAU;
    const rp    = {
      x: p.ringR * Math.cos(phi),
      y: p.ringR * Math.sin(phi) * Math.cos(p.tilt),
      z: p.ringR * Math.sin(phi) * Math.sin(p.tilt),
    };
    const proj  = project(rp, rotX, rotY);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + p.phase + p.ring * 0.9);
    const depthNorm = Math.pow(constrain((proj.depth + 600) / 1200, 0, 1), 1.8);
    const alpha = (50 + 100 * pulse) * master * bloom * depthNorm;
    drawList.push({ x: proj.sx, y: proj.sy, depth: proj.depth, alpha, sz: p.size, type: 'ring' });
  }

  // Painter's sort
  drawList.sort((a, b) => a.depth - b.depth);

  // ---- Draw points with 3-layer bloom glow ----
  noStroke();

  for (let i = 0; i < drawList.length; i++) {
    const p = drawList[i];
    const a = constrain(p.alpha, 0, 255);
    if (a < 1) continue;

    if (p.type === 'bloom' && a > 90) {
      // Outer aura layers (far-back rendered first)
      fill(255, 255, 255, a * 0.025);
      circle(p.x, p.y, p.sz * 9.0);
      fill(255, 255, 255, a * 0.065);
      circle(p.x, p.y, p.sz * 4.2);
      fill(255, 255, 255, a * 0.16);
      circle(p.x, p.y, p.sz * 2.2);
    }

    // Core point
    fill(255, 255, 255, a);
    circle(p.x, p.y, p.sz);

    // Trail stamp for brightest stars
    if (p.type === 'bloom' && a > 150 && i % 5 === 0) {
      trail.noStroke();
      trail.fill(255, 255, 255, a * 0.07);
      trail.circle(p.x, p.y, p.sz * 2.4);
    }
  }

  blendMode(BLEND);

  // center pulse removed

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
  fill(255, 255, 255, 32 * master);
  textSize(10);
  textFont('monospace');
  textAlign(LEFT, BOTTOM);
  text(`FLORAL VOID v2  ${nf(loop * 100, 2, 1)}%  ${W}×${H}`, 18, H - 18);

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
// Central concentric pulse
// ---------------------------------------------------------------------------
function drawCenterPulse(t, master, bloom) {
  blendMode(ADD);
  noFill();
  strokeCap(ROUND);

  const p1 = 0.5 + 0.5 * Math.sin(t * 2.0);
  const p2 = 0.5 + 0.5 * Math.sin(t * 3.3 + 1.1);

  for (let i = 0; i < 7; i++) {
    const r     = 48 + i * 42 + p1 * 16;
    const alpha = (68 - i * 7) * master * bloom * (0.55 + 0.45 * p2);
    stroke(255, 255, 255, constrain(alpha, 0, 255));
    strokeWeight(Math.max(0.4, 1.6 - i * 0.17));
    ellipse(CX, CY, r * 2, r * 2);
  }

  // Soft halo around center
  noStroke();
  for (let i = 3; i >= 0; i--) {
    fill(255, 255, 255, constrain((28 - i * 6) * master * bloom * p1, 0, 255));
    circle(CX, CY, 340 - i * 70);
  }

  // Hard core dot
  fill(255, 255, 255, constrain(210 * master * bloom * (0.7 + 0.3 * p1), 0, 255));
  circle(CX, CY, 8 + p1 * 7);

  blendMode(BLEND);
}

// ---------------------------------------------------------------------------
// Film grain — 0.3% random pixel flashes each frame
// ---------------------------------------------------------------------------
function drawGrain(master) {
  blendMode(ADD);
  noStroke();
  const grainCount = Math.floor(W * H * 0.003);
  for (let i = 0; i < grainCount; i++) {
    const gx = Math.floor(random(W));
    const gy = Math.floor(random(H));
    fill(255, 255, 255, random(4, 18) * master);
    rect(gx, gy, 1, 1);
  }
  blendMode(BLEND);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
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
  if (el('canvasSize'))   el('canvasSize').textContent   = `${W}×${H} / ${FPS}fps`;
  if (el('maxDuration'))  el('maxDuration').textContent  = LOOP_SECS;
  if (el('maxFrames'))    el('maxFrames').textContent    = LOOP_FRAMES;
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
  const pf = document.getElementById('progressFill');
  const dur = document.getElementById('duration');
  const fc  = document.getElementById('frameCount');
  const p   = constrain(recFrameCount / LOOP_FRAMES, 0, 1);
  if (pf)  pf.style.width   = `${(p * 100).toFixed(1)}%`;
  if (dur) dur.textContent  = (recFrameCount / FPS).toFixed(1);
  if (fc)  fc.textContent   = recFrameCount;
}

function keyPressed() {
  if (key === 'r' || key === 'R') startRecording();
  if (key === 's' || key === 'S') saveCanvas('floral_void_v2_still', 'png');
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    randomSeed(Math.floor(random(999999)));
    noiseSeed(Math.floor(random(999999)));
    trail.clear(); buildClouds(); updateStatus('Reseeded');
  }
}

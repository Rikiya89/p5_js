'use strict';

// ----------------------------------------------------------------------------
// 3D generative art — logarithmic shell organism
// Same canvas / palette / mp4 pipeline as the previous piece. The form is now
// a true 3D parametric surface drawn in WEBGL, sampled as a point cloud and
// wrapped by helical strands. All motion is loop-perfect (period = LOOP_FRAMES).
// ----------------------------------------------------------------------------

// Canvas / export — UNCHANGED from previous piece.
const W = 1080;
const H = 1920;
const FPS = 60;
const LOOP_SECONDS = 24;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

// Pure black-and-white palette — UNCHANGED.
const BG = [0, 0, 0];
const INK = [255, 255, 255];

// Shell sampling resolution. (turns × angularSamples) controls point density.
const SHELL_TURNS = 4.6;        // how many full revolutions of the spiral
const SHELL_ANGULAR_SAMPLES = 520; // samples per turn → ~2400 surface points
const SHELL_TUBE_SAMPLES = 32;     // ribs per cross-section ring (higher = crisp flutes)
const HELIX_STRANDS = 7;
const ORBIT_DOT_COUNT = 1100;
const STARFIELD_COUNT = 380;

let canvasEl;
let starfield = [];
let orbitDots = [];
let helices = [];

// Recording state. Press R to record, S to save a still.
let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;

function setup() {
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  setAttributes('antialias', true);
  smooth();

  randomSeed(2707);
  noiseSeed(2707);

  buildStarfield();
  buildOrbitDots();
  buildHelices();

  // Initialize HUD readouts (DOM panel — never captured into the MP4).
  const maxDurEl = document.getElementById('maxDuration');
  const maxFramesEl = document.getElementById('maxFrames');
  const canvasSizeEl = document.getElementById('canvasSize');
  if (maxDurEl) maxDurEl.textContent = LOOP_SECONDS;
  if (maxFramesEl) maxFramesEl.textContent = LOOP_FRAMES;
  if (canvasSizeEl) canvasSizeEl.textContent = W + ' × ' + H;
}

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const time = loop * TWO_PI;

  background(BG[0], BG[1], BG[2]);

  drawStarfield(time);

  // Camera orbits the form so we see front → side → back over one loop.
  const camRadius = 980;
  const camYaw = time;                            // full revolution per loop
  const camPitch = sin(time) * 0.32;              // gentle nodding
  const camX = sin(camYaw) * camRadius * cos(camPitch);
  const camY = sin(camPitch) * camRadius * 0.6;
  const camZ = cos(camYaw) * camRadius * cos(camPitch);
  camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);
  perspective(PI / 3.2, W / H, 10, 4000);

  // Soft additive blending so overlapping white dots glow on black.
  blendMode(ADD);

  drawShellPointCloud(time);
  drawHelixStrands(time);
  drawOrbitDots(time);

  blendMode(BLEND);

  // Vignette — drawn directly in screen space with an ortho camera so it
  // never appears as a flat textured quad floating inside the 3D scene.
  drawScreenSpaceVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingHUD();
    if (recFrameCount >= LOOP_FRAMES) stopRecording();
  }
}

// ---------------------------------------------------------------------------
// Shell point cloud
//
// Core formula (logarithmic / equiangular spiral lifted into a helical cone):
//
//   r(t) = a · e^(b · t)
//   x = r(t) · cos(t) · cos(c · t)
//   y = r(t) · sin(t)
//   z = r(t) · cos(t) · sin(c · t)
//
// Around each spine point we sweep a small circular cross-section to give the
// shell a tube — that turns a 1D curve into a 2D parametric surface.
// ---------------------------------------------------------------------------

// Fluted ammonite parameters.
// The spine is a flat (c≈0) logarithmic spiral; the *tube* is sculpted with
// axial ridges and a flattened (elliptical) cross-section, so the silhouette
// reads as a carved fossil rather than a smooth pipe.
function shellParameters(time) {
  return {
    a: 11,                                          // initial radius
    b: 0.135,                                       // tight ammonite growth
    c: 0.04 * sin(time),                            // ≈ flat, with the tiniest 3D nod
    tubeRadius: 26,                                 // base tube; growth handled below
    // Cross-section sculpting:
    flutes: 8,                                      // number of ridges
    fluteDepth: 0.16 + 0.04 * sin(time),            // breathing of the ridges
    fluteTwist: 0.06,                               // ridges sweep helically
    aspect: 0.78,                                   // elliptical squish (ry / rx)
    // D'Arcy Thompson growth: tube radius grows with the same law as spine.
    tubeGrowthRate: 0.085
  };
}

function shellSpine(t, params) {
  // t is the spiral parameter (radians along the spiral, not normalized).
  const r = params.a * Math.exp(params.b * t);
  const x = r * Math.cos(t) * Math.cos(params.c * t);
  const y = r * Math.sin(t);
  const z = r * Math.cos(t) * Math.sin(params.c * t);
  return { x, y, z };
}

function shellSpineTangent(t, params) {
  // Numerical tangent — small step around t.
  const eps = 0.001;
  const a = shellSpine(t - eps, params);
  const b = shellSpine(t + eps, params);
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const m = Math.hypot(dx, dy, dz) || 1;
  return { x: dx / m, y: dy / m, z: dz / m };
}

function orthonormalFrame(tangent) {
  // Build a stable normal/binormal frame around the tangent. Pick an "up"
  // that is least parallel to tangent to avoid degeneracies.
  const up = Math.abs(tangent.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  // normal = tangent × up
  let nx = tangent.y * up.z - tangent.z * up.y;
  let ny = tangent.z * up.x - tangent.x * up.z;
  let nz = tangent.x * up.y - tangent.y * up.x;
  let m = Math.hypot(nx, ny, nz) || 1;
  nx /= m; ny /= m; nz /= m;
  // binormal = tangent × normal
  const bx = tangent.y * nz - tangent.z * ny;
  const by = tangent.z * nx - tangent.x * nz;
  const bz = tangent.x * ny - tangent.y * nx;
  return { n: { x: nx, y: ny, z: nz }, b: { x: bx, y: by, z: bz } };
}

function shellSurfacePoint(t, phi, params) {
  // (t, phi) → 3D point on the sculpted tube surface.
  const spine = shellSpine(t, params);
  const tan = shellSpineTangent(t, params);
  const frame = orthonormalFrame(tan);

  // D'Arcy Thompson growth — tube grows exponentially along the spiral, the
  // same law as the spiral's own radius. This is what makes real shells feel
  // self-similar rather than just tapered.
  const grow = Math.exp(params.tubeGrowthRate * t) * 0.22;
  const baseR = params.tubeRadius * grow;

  // Axial flutes — radius modulated by sin(flutes·φ). Adding a small phase
  // proportional to t makes the ridges sweep helically along the length so
  // they catch the orbiting camera nicely.
  const fluted = baseR * (1 + params.fluteDepth * Math.sin(params.flutes * phi + params.fluteTwist * t));

  // Elliptical cross-section: flatten the tube along the binormal so the
  // shell reads as a disc rather than a pipe.
  const cx = Math.cos(phi) * fluted;
  const cy = Math.sin(phi) * fluted * params.aspect;

  return {
    x: spine.x + frame.n.x * cx + frame.b.x * cy,
    y: spine.y + frame.n.y * cx + frame.b.y * cy,
    z: spine.z + frame.n.z * cx + frame.b.z * cy
  };
}

function drawShellPointCloud(time) {
  const params = shellParameters(time);
  const tMax = SHELL_TURNS * TWO_PI;
  // Skip the very young end of the spiral — at t≈0 the exponential growth
  // collapses many samples into a few pixels and they accumulate into a
  // bright block. Starting further along solves it cleanly.
  const tMin = tMax * 0.18;

  // Surface point cloud — the visible "skin" of the shell.
  noFill();
  strokeWeight(2.0);
  beginShape(POINTS);
  for (let i = 0; i < SHELL_ANGULAR_SAMPLES; i++) {
    const u = i / SHELL_ANGULAR_SAMPLES;
    const t = lerp(tMin, tMax, u);
    // Extra apex fade so the first revolution still tapers smoothly to nothing.
    const apexFade = constrain(map(u, 0, 0.18, 0, 1), 0, 1);
    const a = 95 * apexFade;
    stroke(INK[0], INK[1], INK[2], a);
    for (let j = 0; j < SHELL_TUBE_SAMPLES; j++) {
      const phi = (j / SHELL_TUBE_SAMPLES) * TWO_PI
                + sin(time + i * 0.013) * 0.18;       // shimmer
      const p = shellSurfacePoint(t, phi, params);
      vertex(p.x, p.y - 60, p.z);                      // -60 lifts to center
    }
  }
  endShape();

  // Brighter spiral spine drawn as a continuous line — gives the form
  // backbone without making it heavy. Starts from tMin to avoid the bright apex.
  noFill();
  strokeWeight(1.4);
  beginShape();
  for (let i = 0; i <= 600; i++) {
    const u = i / 600;
    const t = lerp(tMin, tMax, u);
    const p = shellSpine(t, params);
    // p5's stroke applies to the whole shape, so we approximate the apex
    // fade by skipping the first few vertices of the curve.
    if (u < 0.04) continue;
    curveVertex(p.x, p.y - 60, p.z);
  }
  stroke(INK[0], INK[1], INK[2], 170);
  endShape();

  // Sparse rib rings — every Nth cross-section drawn as a faint loop. This
  // makes the geometry legible from any camera angle.
  strokeWeight(0.8);
  for (let i = 12; i < SHELL_ANGULAR_SAMPLES; i += 22) {
    const u = i / SHELL_ANGULAR_SAMPLES;
    const t = lerp(tMin, tMax, u);
    const apexFade = constrain(map(u, 0, 0.18, 0, 1), 0, 1);
    stroke(INK[0], INK[1], INK[2], 55 * apexFade);
    noFill();
    beginShape();
    for (let j = 0; j <= SHELL_TUBE_SAMPLES; j++) {
      const phi = (j / SHELL_TUBE_SAMPLES) * TWO_PI;
      const p = shellSurfacePoint(t, phi, params);
      curveVertex(p.x, p.y - 60, p.z);
    }
    endShape(CLOSE);
  }
}

// ---------------------------------------------------------------------------
// Helical strands wrapping the shell — secondary organic layer.
// Each strand spirals around the spine with its own phase and turn count.
// ---------------------------------------------------------------------------

function buildHelices() {
  helices = [];
  for (let i = 0; i < HELIX_STRANDS; i++) {
    helices.push({
      turnsExtra: random(0.4, 1.6) * (random() < 0.5 ? -1 : 1),
      offset: random(8, 26),
      phase: random(TWO_PI),
      alpha: random(80, 150),
      weight: random(0.8, 1.6)
    });
  }
}

function drawHelixStrands(time) {
  const params = shellParameters(time);
  const tMax = SHELL_TURNS * TWO_PI;
  const tMin = tMax * 0.18;

  noFill();
  for (const h of helices) {
    stroke(INK[0], INK[1], INK[2], h.alpha);
    strokeWeight(h.weight);
    beginShape();
    for (let i = 0; i <= 240; i++) {
      const u = i / 240;
      const t = lerp(tMin, tMax, u);
      const phi = h.turnsExtra * TWO_PI * u + h.phase + time * 0.6;
      const spine = shellSpine(t, params);
      const tan = shellSpineTangent(t, params);
      const frame = orthonormalFrame(tan);
      // Strands track the tube's exponential growth so they stay glued to
      // the shell surface as it widens toward the mouth.
      const grow = Math.exp(params.tubeGrowthRate * t) * 0.22;
      const r = params.tubeRadius * grow + h.offset;
      const cx = Math.cos(phi) * r;
      const cy = Math.sin(phi) * r * params.aspect;
      curveVertex(
        spine.x + frame.n.x * cx + frame.b.x * cy,
        spine.y + frame.n.y * cx + frame.b.y * cy - 60,
        spine.z + frame.n.z * cx + frame.b.z * cy
      );
    }
    endShape();
  }
}

// ---------------------------------------------------------------------------
// Orbit dots — drift in 3D space around the shell, like specimen particles
// suspended in fluid. Sampled on a torus, slowly rotated.
// ---------------------------------------------------------------------------

function buildOrbitDots() {
  orbitDots = [];
  for (let i = 0; i < ORBIT_DOT_COUNT; i++) {
    orbitDots.push({
      majorR: random(220, 520),
      minorR: random(20, 180),
      theta: random(TWO_PI),
      phi: random(TWO_PI),
      twinkle: floor(random(1, 4)),
      phase: random(TWO_PI),
      alpha: random(20, 80),
      size: random(1.0, 2.6)
    });
  }
}

function drawOrbitDots(time) {
  noFill();
  beginShape(POINTS);
  for (const d of orbitDots) {
    const theta = d.theta + time * 0.18 + sin(time + d.phase) * 0.2;
    const phi = d.phi + time * 0.07;
    const x = (d.majorR + d.minorR * Math.cos(phi)) * Math.cos(theta);
    const y = d.minorR * Math.sin(phi) + sin(time + d.phase) * 14;
    const z = (d.majorR + d.minorR * Math.cos(phi)) * Math.sin(theta);
    const blink = 0.5 + 0.5 * Math.sin(time * d.twinkle + d.phase);
    stroke(INK[0], INK[1], INK[2], d.alpha * blink);
    strokeWeight(d.size);
    vertex(x, y, z);
  }
  endShape();
}

// ---------------------------------------------------------------------------
// Starfield — a thin distant point cloud, drawn far behind the camera origin
// so it parallaxes correctly as the camera orbits.
// ---------------------------------------------------------------------------

function buildStarfield() {
  starfield = [];
  for (let i = 0; i < STARFIELD_COUNT; i++) {
    // Sample uniformly on a large sphere.
    const u = random(-1, 1);
    const a = random(TWO_PI);
    const r = 1800;
    const s = Math.sqrt(1 - u * u);
    starfield.push({
      x: r * s * Math.cos(a),
      y: r * u,
      z: r * s * Math.sin(a),
      alpha: random(8, 50),
      size: random(1.0, 2.4),
      twinkle: floor(random(1, 4)),
      phase: random(TWO_PI)
    });
  }
}

function drawStarfield(time) {
  noFill();
  beginShape(POINTS);
  for (const s of starfield) {
    const blink = 0.5 + 0.5 * Math.sin(time * s.twinkle + s.phase);
    stroke(INK[0], INK[1], INK[2], s.alpha * blink);
    strokeWeight(s.size);
    vertex(s.x, s.y, s.z);
  }
  endShape();
}

// ---------------------------------------------------------------------------
// Vignette overlay — drawn into a 2D graphics buffer and composited last.
// ---------------------------------------------------------------------------

function drawScreenSpaceVignette() {
  // Switch to a 2D orthographic projection so circles drawn here sit on
  // top of everything in flat screen space (no depth, no texture quad).
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);
  noFill();
  const maxR = Math.hypot(W * 0.5, H * 0.5) * 1.1;
  strokeWeight(maxR / 34);
  for (let i = 0; i < 34; i++) {
    const k = i / 33;
    const alpha = constrain(map(k, 0.58, 1, 0, 130), 0, 130);
    stroke(0, 0, 0, alpha);
    circle(0, 0, maxR * 2 * k);
  }
  pop();
}

function updateRecordingHUD() {
  // DOM-only — these elements live outside the canvas, so they never appear
  // in the MP4 capture. Update every frame while recording.
  if (!isRecording) return;
  const durEl = document.getElementById('duration');
  const framesEl = document.getElementById('frameCount');
  const fillEl = document.getElementById('progressFill');
  if (durEl) durEl.textContent = (recFrameCount / FPS).toFixed(1);
  if (framesEl) framesEl.textContent = recFrameCount;
  if (fillEl) fillEl.style.width = (100 * recFrameCount / LOOP_FRAMES).toFixed(2) + '%';
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  if (color) el.style.color = color;
}

// ---------------------------------------------------------------------------
// Recording (UNCHANGED API: R toggles, S saves still, Backspace reseeds)
// ---------------------------------------------------------------------------

function mousePressed() {
  randomSeed(floor(random(100000)));
  noiseSeed(floor(random(100000)));
  buildStarfield();
  buildOrbitDots();
  buildHelices();
}

function keyReleased() {
  if (key === 'r' || key === 'R') {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('20260509_shell_organism_' + timestamp(), 'png');
    return false;
  }
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    randomSeed(floor(random(100000)));
    noiseSeed(floor(random(100000)));
    buildStarfield();
    buildOrbitDots();
    buildHelices();
    return false;
  }
  return true;
}

function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    setStatus('WebCodecs unsupported · use Chrome', '#f44');
    return;
  }
  if (typeof Mp4Muxer === 'undefined') {
    setStatus('mp4-muxer not loaded', '#f44');
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      console.error(err);
      isRecording = false;
      setStatus('Encoder error', '#f44');
    }
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W,
    height: H,
    bitrate: 18_000_000,
    framerate: FPS
  });

  recFrameCount = 0;
  isRecording = true;

  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  setStatus('Recording…', '#fff');
  updateRecordingHUD();
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
  a.download = '20260509_shell_organism_' + timestamp() + '.mp4';
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
  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1000000 / FPS)
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_`
       + `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

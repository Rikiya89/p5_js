// Mathematical Geometry - Black & White 3D Generative Art
// Featuring: Trefoil Knots, Parametric Surfaces, Lissajous Curves

const W = 1080;
const H = 1920;

// Animation
let time = 0;

// Mathematical constants
const PHI = (1 + Math.sqrt(5)) / 2; // Golden ratio
const TAU = Math.PI * 2;

// Geometric systems
let trefoilPoints = [];
let lissajousPoints = [];
let gridPoints = [];
let sphericalHarmonics = [];

// Configuration
const TREFOIL_RESOLUTION = 400;
const LISSAJOUS_TRAILS = 8;
const LISSAJOUS_LENGTH = 150;
const GRID_SIZE = 12;
const HARMONIC_POINTS = 2000;

// Recording
let encoder = null;
let muxer = null;
let isRecording = false;
let recordingFrameCount = 0;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;

// ─────────────────────────────────────────────────────────────
// Mathematical Functions
// ─────────────────────────────────────────────────────────────

/**
 * Trefoil Knot - A beautiful mathematical knot
 * Parametric equations:
 * x = sin(t) + 2*sin(2t)
 * y = cos(t) - 2*cos(2t)
 * z = -sin(3t)
 */
function getTrefoilPoint(t, scale = 1) {
  const x = (Math.sin(t) + 2 * Math.sin(2 * t)) * scale;
  const y = (Math.cos(t) - 2 * Math.cos(2 * t)) * scale;
  const z = -Math.sin(3 * t) * scale;
  return { x, y, z };
}

/**
 * 3D Lissajous Curve
 * Beautiful harmonic curves in 3D space
 */
function getLissajousPoint(t, a, b, c, deltaX, deltaY, deltaZ, scale = 1) {
  const x = Math.sin(a * t + deltaX) * scale;
  const y = Math.sin(b * t + deltaY) * scale;
  const z = Math.sin(c * t + deltaZ) * scale;
  return { x, y, z };
}

/**
 * Spherical Harmonics - Creates organic mathematical forms
 * Using simplified spherical harmonic function
 */
function getSphericalHarmonicPoint(theta, phi, m, time) {
  // Base radius with harmonic modulation
  let r = 1;

  // Add spherical harmonic perturbations
  r += 0.3 * Math.sin(m * phi) * Math.cos(m * theta);
  r += 0.2 * Math.sin(2 * m * phi + time) * Math.cos(theta);
  r += 0.15 * Math.sin(3 * theta + time * 0.5);

  const x = r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.sin(phi) * Math.sin(theta);
  const z = r * Math.cos(phi);

  return { x, y, z };
}

/**
 * Superellipse equation for interesting 2D cross-sections
 */
function superellipse(angle, n, a = 1, b = 1) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const x = Math.sign(cosA) * a * Math.pow(Math.abs(cosA), 2/n);
  const y = Math.sign(sinA) * b * Math.pow(Math.abs(sinA), 2/n);
  return { x, y };
}

// ─────────────────────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────────────────────

function initGeometry() {
  // Initialize Lissajous trails
  lissajousPoints = [];
  for (let i = 0; i < LISSAJOUS_TRAILS; i++) {
    lissajousPoints.push({
      // Different harmonic ratios for variety
      a: 2 + (i % 3),
      b: 3 + ((i + 1) % 4),
      c: 5 + ((i + 2) % 3),
      deltaX: (i / LISSAJOUS_TRAILS) * TAU,
      deltaY: ((i + 2) / LISSAJOUS_TRAILS) * TAU,
      deltaZ: ((i + 4) / LISSAJOUS_TRAILS) * TAU,
      trail: [],
      scale: 180 + i * 15
    });
  }

  // Initialize 3D grid points
  gridPoints = [];
  const spacing = 100;
  const halfGrid = GRID_SIZE / 2;

  for (let x = -halfGrid; x <= halfGrid; x++) {
    for (let y = -halfGrid; y <= halfGrid; y++) {
      for (let z = -halfGrid; z <= halfGrid; z++) {
        // Only add points on edges of cube
        const onEdge =
          (Math.abs(x) === halfGrid ? 1 : 0) +
          (Math.abs(y) === halfGrid ? 1 : 0) +
          (Math.abs(z) === halfGrid ? 1 : 0);

        if (onEdge >= 2) {
          gridPoints.push({
            baseX: x * spacing,
            baseY: y * spacing,
            baseZ: z * spacing,
            phase: Math.random() * TAU
          });
        }
      }
    }
  }

  // Initialize spherical harmonic surface points using Fibonacci sphere
  sphericalHarmonics = [];
  for (let i = 0; i < HARMONIC_POINTS; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / HARMONIC_POINTS);
    const theta = Math.PI * PHI * 2 * i;

    sphericalHarmonics.push({
      theta: theta % TAU,
      phi: phi,
      index: i
    });
  }
}

function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);
  initGeometry();

  // Update UI if elements exist
  const maxDurEl = document.getElementById('maxDuration');
  if (maxDurEl) maxDurEl.textContent = MAX_DURATION;
}

// ─────────────────────────────────────────────────────────────
// Drawing Functions
// ─────────────────────────────────────────────────────────────

function drawTrefoilKnot(t, baseScale, strokeW) {
  push();

  // Rotate the knot slowly
  rotateX(t * 0.2);
  rotateY(t * 0.15);
  rotateZ(t * 0.1);

  // Draw the trefoil as connected points
  stroke(255);
  strokeWeight(strokeW);
  noFill();

  beginShape();
  for (let i = 0; i <= TREFOIL_RESOLUTION; i++) {
    const angle = (i / TREFOIL_RESOLUTION) * TAU;
    const p = getTrefoilPoint(angle, baseScale);

    // Add subtle breathing animation
    const breath = 1 + 0.05 * Math.sin(t * 2 + angle * 3);
    vertex(p.x * breath, p.y * breath, p.z * breath);
  }
  endShape(CLOSE);

  // Draw points along the knot for emphasis
  strokeWeight(3);
  for (let i = 0; i < TREFOIL_RESOLUTION; i += 10) {
    const angle = (i / TREFOIL_RESOLUTION) * TAU;
    const p = getTrefoilPoint(angle, baseScale);
    const breath = 1 + 0.05 * Math.sin(t * 2 + angle * 3);

    // Vary opacity based on z-depth for 3D effect
    const alpha = map(p.z * breath, -baseScale, baseScale, 80, 255);
    stroke(255, alpha);
    point(p.x * breath, p.y * breath, p.z * breath);
  }

  pop();
}

function drawLissajousCurves(t) {
  push();

  // Update and draw each Lissajous trail
  for (let curve of lissajousPoints) {
    // Calculate new head position
    const headPos = getLissajousPoint(
      t * 0.5,
      curve.a, curve.b, curve.c,
      curve.deltaX, curve.deltaY, curve.deltaZ,
      curve.scale
    );

    // Add to trail
    curve.trail.unshift({ ...headPos });
    if (curve.trail.length > LISSAJOUS_LENGTH) {
      curve.trail.pop();
    }

    // Draw trail with fading opacity
    noFill();
    beginShape();
    for (let i = 0; i < curve.trail.length; i++) {
      const p = curve.trail[i];
      const alpha = map(i, 0, curve.trail.length, 200, 0);
      const weight = map(i, 0, curve.trail.length, 2.5, 0.5);

      stroke(255, alpha);
      strokeWeight(weight);
      vertex(p.x, p.y, p.z);
    }
    endShape();
  }

  pop();
}

function drawSphericalHarmonics(t, scale) {
  push();

  // Slow rotation
  rotateX(t * 0.1);
  rotateY(t * 0.15);

  stroke(255, 150);
  strokeWeight(1.5);

  const m = 4; // Harmonic mode

  for (let pt of sphericalHarmonics) {
    const p = getSphericalHarmonicPoint(
      pt.theta + t * 0.1,
      pt.phi,
      m,
      t
    );

    // Calculate alpha based on position for depth
    const depth = p.z;
    const alpha = map(depth, -1, 1, 50, 200);

    stroke(255, alpha);
    point(p.x * scale, p.y * scale, p.z * scale);
  }

  pop();
}

function drawRotatingGrid(t) {
  push();

  // Rotate grid
  rotateX(t * 0.05);
  rotateY(t * 0.08);
  rotateZ(t * 0.03);

  stroke(255, 60);
  strokeWeight(1);

  for (let gp of gridPoints) {
    // Animate points with wave motion
    const wave = Math.sin(t + gp.phase) * 20;
    const x = gp.baseX + wave * Math.sin(gp.phase);
    const y = gp.baseY + wave * Math.cos(gp.phase);
    const z = gp.baseZ + wave * Math.sin(gp.phase * 2);

    // Draw point
    const dist = Math.sqrt(x*x + y*y + z*z);
    const alpha = map(dist, 0, 800, 100, 30);
    stroke(255, alpha);
    strokeWeight(2);
    point(x, y, z);
  }

  // Draw some connecting lines
  stroke(255, 20);
  strokeWeight(0.5);

  for (let i = 0; i < gridPoints.length - 1; i += 3) {
    const p1 = gridPoints[i];
    const p2 = gridPoints[(i + 7) % gridPoints.length];

    const wave1 = Math.sin(t + p1.phase) * 20;
    const wave2 = Math.sin(t + p2.phase) * 20;

    line(
      p1.baseX + wave1 * Math.sin(p1.phase),
      p1.baseY + wave1 * Math.cos(p1.phase),
      p1.baseZ + wave1 * Math.sin(p1.phase * 2),
      p2.baseX + wave2 * Math.sin(p2.phase),
      p2.baseY + wave2 * Math.cos(p2.phase),
      p2.baseZ + wave2 * Math.sin(p2.phase * 2)
    );
  }

  pop();
}

function drawConcentricRings(t, centerY) {
  push();
  translate(0, centerY, 0);
  rotateX(HALF_PI);

  noFill();

  for (let r = 0; r < 8; r++) {
    const radius = 100 + r * 60;
    const alpha = map(r, 0, 8, 150, 40);
    const weight = map(r, 0, 8, 2, 0.5);

    stroke(255, alpha);
    strokeWeight(weight);

    beginShape();
    for (let a = 0; a <= TAU; a += 0.05) {
      // Modulate radius with sine waves
      const mod = radius +
        20 * Math.sin(a * 6 + t * 2) +
        10 * Math.sin(a * 12 - t);

      const x = Math.cos(a) * mod;
      const z = Math.sin(a) * mod;
      const y = 10 * Math.sin(a * 3 + t + r);

      vertex(x, y, z);
    }
    endShape(CLOSE);
  }

  pop();
}

function drawMoebiusStrip(t, yOffset, scale) {
  push();
  translate(0, yOffset, 0);
  rotateX(t * 0.1);
  rotateZ(t * 0.15);

  stroke(255, 180);
  strokeWeight(1);
  noFill();

  // Möbius strip parametric surface
  const uSteps = 100;
  const vSteps = 10;

  for (let v = -1; v <= 1; v += 2/vSteps) {
    beginShape();
    for (let u = 0; u <= TAU; u += TAU/uSteps) {
      // Möbius strip equations
      const x = (1 + (v/2) * Math.cos(u/2)) * Math.cos(u) * scale;
      const y = (1 + (v/2) * Math.cos(u/2)) * Math.sin(u) * scale;
      const z = (v/2) * Math.sin(u/2) * scale;

      vertex(x, z, y); // Swap y and z for better viewing angle
    }
    endShape();
  }

  // Cross-sections
  for (let u = 0; u < TAU; u += TAU/20) {
    beginShape();
    for (let v = -1; v <= 1; v += 0.2) {
      const x = (1 + (v/2) * Math.cos(u/2)) * Math.cos(u) * scale;
      const y = (1 + (v/2) * Math.cos(u/2)) * Math.sin(u) * scale;
      const z = (v/2) * Math.sin(u/2) * scale;

      vertex(x, z, y);
    }
    endShape();
  }

  pop();
}

// ─────────────────────────────────────────────────────────────
// Main Draw Loop
// ─────────────────────────────────────────────────────────────

function draw() {
  // Pure black background
  background(0);

  // Subtle fog effect for depth
  // perspective(PI/3, width/height, 0.1, 5000);

  // Center camera
  translate(0, 0, 0);

  // Global slow rotation for dynamic view
  rotateY(sin(time * 0.2) * 0.1);
  rotateX(cos(time * 0.15) * 0.05);

  // Layer 1: Background grid (far)
  push();
  translate(0, 0, -400);
  drawRotatingGrid(time);
  pop();

  // Layer 2: Concentric rings (top area)
  drawConcentricRings(time, -500);

  // Layer 3: Spherical harmonics (center-back)
  push();
  translate(0, 0, -200);
  drawSphericalHarmonics(time, 250);
  pop();

  // Layer 4: Möbius strip (center)
  drawMoebiusStrip(time, 0, 150);

  // Layer 5: Main trefoil knot (foreground)
  push();
  translate(0, 200, 100);
  drawTrefoilKnot(time, 80, 2);
  pop();

  // Layer 6: Lissajous curves (flowing throughout)
  push();
  translate(0, -100, 0);
  drawLissajousCurves(time);
  pop();

  // Layer 7: Concentric rings (bottom area)
  drawConcentricRings(time * 0.8, 500);

  // Additional small trefoil knots as decoration
  push();
  translate(-200, -350, 50);
  rotateZ(time * 0.3);
  drawTrefoilKnot(time + PI, 30, 1);
  pop();

  push();
  translate(200, 400, -50);
  rotateZ(-time * 0.25);
  drawTrefoilKnot(time + HALF_PI, 35, 1);
  pop();

  // Update time
  time += 0.02;

  // Recording logic
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;

    const elapsed = (Date.now() - recordingStartTime) / 1000;
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = `Recording: ${elapsed.toFixed(1)}s / ${MAX_DURATION}s`;
    }

    if (recordingFrameCount >= MAX_FRAMES) {
      stopRecording();
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Recording Functions
// ─────────────────────────────────────────────────────────────

async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('Your browser does not support WebCodecs API.');
    return;
  }

  isRecording = true;
  recordingFrameCount = 0;
  time = 0;
  recordingStartTime = Date.now();

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory'
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error('Encoder error:', e)
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W, height: H,
    bitrate: 12_000_000,
    framerate: FPS
  });

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');

  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  if (statusEl) {
    statusEl.textContent = 'Recording...';
    statusEl.style.color = '#ff6b6b';
  }
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  await encoder.flush();
  muxer.finalize();

  let blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  let a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mathematical_geometry.mp4';
  a.click();

  encoder = null;
  muxer = null;

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');

  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (statusEl) {
    statusEl.textContent = 'Complete!';
    setTimeout(() => {
      statusEl.textContent = 'Ready';
      statusEl.style.color = '#84bae7';
    }, 3000);
  }
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector('canvas');
  const frame = new VideoFrame(canvas, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

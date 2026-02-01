// Canvas dimensions
const W = 1080;
const H = 1920;

// Animation settings
const FPS = 60;
const MAX_DURATION = 15;
const MAX_FRAMES = FPS * MAX_DURATION;

// Recording variables
let isRecording = false;
let recordingFrameCount = 0;
let encoder = null;
let muxer = null;
let recordingStartTime = 0;

// Animation variables
let time = 0;
const PHI = (1 + Math.sqrt(5)) / 2; // Golden ratio
const TAU = Math.PI * 2;

// Hexagon systems
const hexLayers = [];
const floatingHexagons = [];
const spiralHexagons = [];
const particles = [];

// Start recording with MP4 encoding
async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('Your browser does not support WebCodecs API. Please use Chrome or Edge.');
    return;
  }

  isRecording = true;
  recordingFrameCount = 0;
  time = 0;
  recordingStartTime = Date.now();

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: W,
      height: H
    },
    fastStart: 'in-memory'
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error('Encoder error:', e)
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W,
    height: H,
    bitrate: 8_000_000,
    framerate: FPS
  });

  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  document.getElementById('status').textContent = 'Recording...';
  document.getElementById('status').style.color = '#ff6b6b';
}

// Stop recording and download MP4
async function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  document.getElementById('status').textContent = 'Processing...';
  document.getElementById('status').style.color = '#84bae7';

  await encoder.flush();
  muxer.finalize();

  let buffer = muxer.target.buffer;
  let blob = new Blob([buffer], { type: 'video/mp4' });

  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = 'hexagon_3d_generative.mp4';
  a.click();
  URL.revokeObjectURL(url);

  encoder = null;
  muxer = null;

  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('status').textContent = 'Download started!';
  document.getElementById('status').style.color = '#916ccc';

  setTimeout(() => {
    document.getElementById('status').textContent = 'Ready';
    document.getElementById('status').style.color = '#84bae7';
  }, 3000);
}

// Capture frame for MP4 encoding
function captureFrame() {
  if (!isRecording || !encoder) return;

  const canvas = document.querySelector('canvas');
  const timestamp = recordingFrameCount * (1_000_000 / FPS);

  const frame = new VideoFrame(canvas, {
    timestamp: timestamp
  });

  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

// Easing functions for smooth animations
function easeInOutSine(x) {
  return -(cos(PI * x) - 1) / 2;
}

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2;
}

// Hyperbolic functions for elegant curves
function sinh(x) {
  return (exp(x) - exp(-x)) / 2;
}

function cosh(x) {
  return (exp(x) + exp(-x)) / 2;
}

// Draw a perfect hexagon
function drawHexagon(size, strokeW = 1) {
  strokeWeight(strokeW);
  beginShape();
  for (let i = 0; i < 6; i++) {
    const angle = TAU / 6 * i - PI / 6;
    vertex(cos(angle) * size, sin(angle) * size);
  }
  endShape(CLOSE);
}

// Draw hexagon with inner details
function drawDetailedHexagon(size, detail = 3, t = 0) {
  for (let d = 0; d < detail; d++) {
    const s = size * (1 - d * 0.25);
    const alpha = map(d, 0, detail, 255, 80);
    push();
    rotateZ(d * PI / 12 + t * 0.1 * (d % 2 === 0 ? 1 : -1));
    stroke(alpha);
    noFill();
    drawHexagon(s, 1.5 - d * 0.3);
    pop();
  }
}

// Möbius-like transformation
function mobiusTransform(x, y, t) {
  const a = cos(t);
  const b = sin(t);
  const denom = pow(x * b + 1, 2) + pow(y * b, 2);
  const newX = (x * a + (1 - y * y - x * x) * b / 2) / sqrt(denom);
  const newY = y * a / sqrt(denom);
  return { x: newX * 300, y: newY * 300 };
}

// Particle class with Perlin noise flow
class Particle {
  constructor(i) {
    this.id = i;
    this.reset();
    this.z = random(-500, 500);
  }

  reset() {
    this.x = random(-600, 600);
    this.y = random(-1000, 1000);
    this.z = random(-500, 500);
    this.size = random(1, 4);
    this.speed = random(0.5, 2);
  }

  update(t) {
    // Curl noise movement
    const noiseScale = 0.002;
    const angle = noise(this.x * noiseScale, this.y * noiseScale, t * 0.3) * TAU * 2;

    this.x += cos(angle) * this.speed;
    this.y += sin(angle) * this.speed - 0.5;
    this.z += sin(t + this.id * 0.1) * 0.5;

    if (this.y < -1000 || this.y > 1000 || abs(this.x) > 700) {
      this.reset();
      this.y = 1000;
    }
  }

  draw() {
    const depthFade = map(this.z, -500, 500, 30, 150);
    const sizeMod = map(this.z, -500, 500, 0.5, 1.5);

    push();
    translate(this.x, this.y, this.z);
    noStroke();
    fill(depthFade);
    sphere(this.size * sizeMod);
    pop();
  }
}

// Floating hexagon with complex motion
class FloatingHexagon {
  constructor(i, total) {
    this.index = i;
    this.total = total;
    this.theta = (TAU / total) * i;
    this.radius = 200 + (i % 5) * 60;
    this.size = 25 + random(20);
    this.zOffset = random(-200, 200);
    this.phaseX = random(TAU);
    this.phaseY = random(TAU);
    this.phaseZ = random(TAU);
    this.rotSpeed = random(0.2, 0.8) * (random() > 0.5 ? 1 : -1);
  }

  draw(t) {
    // Logarithmic spiral position
    const spiralGrowth = 0.1;
    const dynamicTheta = this.theta + t * 0.3;
    const r = this.radius * exp(spiralGrowth * sin(t * 0.5 + this.index));

    // Fourier series position modulation
    let x = r * cos(dynamicTheta);
    let y = r * sin(dynamicTheta);

    // Add harmonic oscillations
    x += sin(t * 2 + this.phaseX) * 30 + sin(t * 3.17 + this.phaseX) * 15;
    y += cos(t * 2.5 + this.phaseY) * 30 + cos(t * 2.83 + this.phaseY) * 15;

    // Vertical wave with hyperbolic influence
    const z = this.zOffset + sin(t + this.phaseZ) * 100 + sinh(sin(t * 0.3)) * 30;

    // Brightness from interference pattern
    const wave1 = sin(t * 1.5 + this.index * 0.5);
    const wave2 = sin(t * 2.1 + this.index * 0.3);
    const wave3 = sin(t * 0.7 + this.index * 0.7);
    const brightness = map((wave1 + wave2 + wave3) / 3, -1, 1, 60, 255);

    push();
    translate(x, y, z);

    // Complex rotation using Euler angles
    rotateX(sin(t * 0.5 + this.phaseX) * 0.5);
    rotateY(cos(t * 0.4 + this.phaseY) * 0.5);
    rotateZ(t * this.rotSpeed);

    stroke(brightness);
    noFill();
    drawDetailedHexagon(this.size, 3, t);

    // Inner glow hexagon
    fill(brightness * 0.15);
    stroke(brightness * 0.5);
    drawHexagon(this.size * 0.4, 0.5);

    pop();
  }
}

// Spiral tower of hexagons
class SpiralHexagon {
  constructor(i, total) {
    this.index = i;
    this.total = total;
    this.baseY = map(i, 0, total, 600, -600);
    this.baseAngle = (TAU / 6) * i;
    this.size = 40 - (i % 10) * 2;
  }

  draw(t) {
    // DNA helix inspired double spiral
    const helixRadius = 150 + sin(t * 0.5 + this.index * 0.2) * 30;
    const twist = this.index * 0.3 + t * 0.8;

    const x1 = cos(twist) * helixRadius;
    const z1 = sin(twist) * helixRadius;

    const x2 = cos(twist + PI) * helixRadius;
    const z2 = sin(twist + PI) * helixRadius;

    const breathe = sin(t * 2 + this.index * 0.1) * 0.2 + 1;
    const brightness = map(sin(t + this.index * 0.3), -1, 1, 80, 255);

    // First helix strand
    push();
    translate(x1, this.baseY, z1);
    rotateY(twist);
    rotateX(sin(t + this.index) * 0.3);

    stroke(brightness);
    noFill();
    drawHexagon(this.size * breathe, 1.5);

    fill(brightness * 0.1);
    drawHexagon(this.size * breathe * 0.5, 0.5);
    pop();

    // Second helix strand
    push();
    translate(x2, this.baseY, z2);
    rotateY(twist + PI);
    rotateX(-sin(t + this.index) * 0.3);

    stroke(brightness * 0.7);
    noFill();
    drawHexagon(this.size * breathe * 0.8, 1);
    pop();

    // Connecting line between helixes
    if (this.index % 4 === 0) {
      stroke(brightness * 0.3);
      strokeWeight(0.5);
      line(x1, this.baseY, z1, x2, this.baseY, z2);
    }
  }
}

// Sacred geometry mandala
function drawMandala(t) {
  push();
  translate(0, 0, 300);
  rotateX(PI / 6);

  const layers = 6;

  for (let l = 0; l < layers; l++) {
    push();
    rotateZ(t * 0.3 * (l % 2 === 0 ? 1 : -1) + l * PI / 12);

    const numHex = 6 + l * 6;
    const radius = 50 + l * 45;
    const hexSize = 20 - l * 1.5;
    const brightness = map(l, 0, layers, 255, 100);

    for (let i = 0; i < numHex; i++) {
      const angle = (TAU / numHex) * i;
      const x = cos(angle) * radius;
      const y = sin(angle) * radius;
      const pulse = sin(t * 3 + i * 0.5 + l) * 0.2 + 1;

      push();
      translate(x, y, sin(t + i + l) * 20);
      rotateZ(angle + PI / 2 + t * 0.2);

      stroke(brightness * pulse);
      noFill();
      drawHexagon(hexSize * pulse, 1.2);

      if (l < 3) {
        fill(brightness * 0.1);
        drawHexagon(hexSize * pulse * 0.4, 0.3);
      }
      pop();
    }
    pop();
  }

  // Center piece
  push();
  rotateZ(-t * 0.5);
  for (let i = 0; i < 3; i++) {
    rotateZ(PI / 3);
    stroke(255 - i * 40);
    noFill();
    drawHexagon(30 - i * 5, 2 - i * 0.5);
  }
  pop();

  pop();
}

// Flowing curves using Lissajous
function drawLissajousCurves(t) {
  const curves = [
    { a: 3, b: 4, delta: 0, radius: 200, z: -200 },
    { a: 5, b: 4, delta: PI/4, radius: 180, z: 100 },
    { a: 7, b: 6, delta: PI/3, radius: 160, z: 0 }
  ];

  for (const curve of curves) {
    push();
    translate(0, 0, curve.z);
    rotateY(t * 0.2);
    rotateX(sin(t * 0.3) * 0.2);

    const brightness = map(curve.z, -200, 100, 60, 150);
    stroke(brightness);
    strokeWeight(1.5);
    noFill();

    beginShape();
    for (let i = 0; i <= 200; i++) {
      const angle = (TAU / 200) * i + t;
      const x = sin(curve.a * angle + curve.delta + t * 0.5) * curve.radius;
      const y = sin(curve.b * angle) * curve.radius;
      const z = sin(angle * 2 + t) * 50;
      vertex(x, y, z);
    }
    endShape();
    pop();
  }
}

// Central flower of life
function drawFlowerOfLife(t) {
  push();
  translate(0, -350, 100);
  rotateX(PI / 3);
  rotateZ(t * 0.2);

  const baseRadius = 50;
  const brightness = map(sin(t * 2), -1, 1, 150, 255);

  // Center circle as hexagon
  stroke(brightness);
  strokeWeight(1.5);
  noFill();
  drawHexagon(baseRadius, 1.5);

  // Surrounding hexagons
  for (let ring = 1; ring <= 2; ring++) {
    const numInRing = 6 * ring;
    for (let i = 0; i < numInRing; i++) {
      const angle = (TAU / numInRing) * i + t * 0.1 * ring;
      const r = baseRadius * ring * 1.7;
      const x = cos(angle) * r;
      const y = sin(angle) * r;
      const pulse = sin(t * 2 + i + ring) * 0.15 + 1;

      push();
      translate(x, y, sin(t + i) * 10);
      rotateZ(t * 0.1 * (i % 2 === 0 ? 1 : -1));

      stroke(brightness * (1 - ring * 0.2) * pulse);
      drawHexagon(baseRadius * pulse, 1.2 - ring * 0.3);
      pop();
    }
  }
  pop();
}

// Ethereal light beams
function drawLightBeams(t) {
  const numBeams = 12;

  for (let i = 0; i < numBeams; i++) {
    const angle = (TAU / numBeams) * i + t * 0.1;
    const length = 800 + sin(t * 2 + i) * 200;
    const brightness = map(sin(t + i * 0.5), -1, 1, 10, 40);

    push();
    rotateY(angle);
    rotateX(PI / 2);

    stroke(brightness);
    strokeWeight(map(sin(t * 3 + i), -1, 1, 0.5, 2));
    line(0, 0, 0, 0, length, 0);
    pop();
  }
}

// Initialize
function setup() {
  createCanvas(W, H, WEBGL);
  frameRate(FPS);
  noiseSeed(42);

  // Create floating hexagons
  for (let i = 0; i < 40; i++) {
    floatingHexagons.push(new FloatingHexagon(i, 40));
  }

  // Create spiral hexagons
  for (let i = 0; i < 50; i++) {
    spiralHexagons.push(new SpiralHexagon(i, 50));
  }

  // Create particles
  for (let i = 0; i < 150; i++) {
    particles.push(new Particle(i));
  }
}

function draw() {
  background(0);

  // Smooth camera movement - cinematic path
  const camRadius = 900 + sin(time * 0.2) * 200;
  const camAngle = time * 0.15;
  const camHeight = sin(time * 0.25) * 300;

  const camX = sin(camAngle) * camRadius * 0.3;
  const camY = camHeight;
  const camZ = cos(camAngle) * camRadius;

  // Look at point oscillates slightly
  const lookY = sin(time * 0.3) * 100;

  camera(camX, camY, camZ, 0, lookY, 0, 0, 1, 0);

  // Subtle ambient lighting
  ambientLight(30);

  // Draw light beams first (background)
  drawLightBeams(time);

  // Update and draw particles
  for (const p of particles) {
    p.update(time);
    p.draw();
  }

  // Draw Lissajous curves
  drawLissajousCurves(time);

  // Draw spiral DNA helix
  push();
  translate(0, 0, 0);
  for (const hex of spiralHexagons) {
    hex.draw(time);
  }
  pop();

  // Draw floating hexagons
  for (const hex of floatingHexagons) {
    hex.draw(time);
  }

  // Draw sacred geometry mandala
  drawMandala(time);

  // Draw flower of life
  drawFlowerOfLife(time);

  // Update time with smooth progression
  time += 0.016;

  // Handle recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;

    const duration = recordingFrameCount / FPS;
    document.getElementById('duration').textContent = duration.toFixed(1);
    document.getElementById('frameCount').textContent = recordingFrameCount;

    if (recordingFrameCount >= MAX_FRAMES) {
      stopRecording();
    }
  }
}


// Canvas dimensions
const W = 1080;
const H = 1920;

// Recording
let encoder = null;
let muxer = null;
let isRecording = false;
let recordingFrameCount = 0;
let recordingStartTime = 0;
const FPS = 60;
const MAX_DURATION = 30; // Extended from 15 to 30 seconds
const MAX_FRAMES = FPS * MAX_DURATION; // 1800 frames

// Animation
let time = 0;

// Particle systems
let morphParticles = [];
let trailParticles = [];
let waveRings = [];

const NUM_MORPH = 6000;
const NUM_TRAILS = 12;
const TRAIL_LENGTH = 60;
const NUM_WAVE_RINGS = 8;

const PHI = (1 + Math.sqrt(5)) / 2;

// Recording functions
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

  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  document.getElementById('status').textContent = 'Recording...';
  document.getElementById('status').style.color = '#ff6b6b';
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  await encoder.flush();
  muxer.finalize();

  let blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  let a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'liquid_geometry.mp4';
  a.click();

  encoder = null;
  muxer = null;

  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('status').textContent = 'Complete!';

  setTimeout(() => {
    document.getElementById('status').textContent = 'Ready';
    document.getElementById('status').style.color = '#84bae7';
  }, 3000);
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector('canvas');
  const frame = new VideoFrame(canvas, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

// Smooth interpolation
function smoothstep(a, b, t) {
  t = constrain(t, 0, 1);
  t = t * t * (3 - 2 * t);
  return lerp(a, b, t);
}

// 3D shapes for morphing
function getSpherePoint(u, v, radius) {
  return {
    x: radius * sin(v) * cos(u),
    y: radius * sin(v) * sin(u),
    z: radius * cos(v)
  };
}

function getTorusPoint(u, v, R, r) {
  return {
    x: (R + r * cos(v)) * cos(u),
    y: (R + r * cos(v)) * sin(u),
    z: r * sin(v)
  };
}

function getFlowerPoint(u, v, radius, petals) {
  let r = radius * (0.5 + 0.5 * cos(petals * u)) * sin(v);
  return {
    x: r * cos(u),
    y: r * sin(u),
    z: radius * cos(v) * 0.6
  };
}

function getHelixPoint(u, v, radius, turns) {
  let t = v / PI;
  let r = radius * sin(v) * (0.8 + 0.2 * cos(u * 6));
  return {
    x: r * cos(u + t * turns * TWO_PI),
    y: r * sin(u + t * turns * TWO_PI),
    z: (v - PI/2) * radius * 0.5
  };
}

// Initialize particles
function initParticles() {
  // Morphing surface particles
  morphParticles = [];

  for (let i = 0; i < NUM_MORPH; i++) {
    // Fibonacci sphere distribution
    let phi = acos(1 - 2 * (i + 0.5) / NUM_MORPH);
    let theta = PI * PHI * 2 * i;

    morphParticles.push({
      u: theta % TWO_PI,
      v: phi,
      index: i,
      phase: random(TWO_PI),
      x: 0, y: 0, z: 0,
      targetX: 0, targetY: 0, targetZ: 0,
      velX: 0, velY: 0, velZ: 0
    });
  }

  // Flowing trail particles - like ink ribbons
  trailParticles = [];

  for (let t = 0; t < NUM_TRAILS; t++) {
    let trail = {
      baseAngle: (t / NUM_TRAILS) * TWO_PI,
      points: [],
      hue: t / NUM_TRAILS,
      speed: 0.6 + random(0.6), // Faster trails (was 0.3 + 0.4)
      amplitude: 100 + random(80),
      frequency: 2 + random(2),
      phase: random(TWO_PI)
    };

    // Initialize trail points
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      trail.points.push({ x: 0, y: 0, z: 0 });
    }

    trailParticles.push(trail);
  }

  // Wave rings
  waveRings = [];

  for (let r = 0; r < NUM_WAVE_RINGS; r++) {
    let ring = {
      baseRadius: 150 + r * 50,
      points: [],
      phase: r * 0.5,
      speed: 1.5 - r * 0.08 // Faster waves (was 0.8 - r * 0.05)
    };

    let numPoints = 200 + r * 30;
    for (let i = 0; i < numPoints; i++) {
      ring.points.push({
        angle: (i / numPoints) * TWO_PI,
        offset: random(TWO_PI)
      });
    }

    waveRings.push(ring);
  }
}

function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);
  initParticles();
  document.getElementById('maxDuration').textContent = MAX_DURATION;
}

function draw() {
  background(0);

  time += 0.015; // Faster animation (was 0.006)

  // Morphing cycle - faster transitions
  let morphCycle = (time * 0.25) % 4; // Faster shape changes (was 0.15)
  let morphPhase = morphCycle % 1;
  let currentShape = floor(morphCycle);
  let nextShape = (currentShape + 1) % 4;

  // Breathing - faster pulse
  let breath = 1 + 0.1 * sin(time * PHI * 2);

  // Camera - faster orbit
  let camDist = 550;
  let camAngle = time * 0.2; // Faster rotation (was 0.1)
  let camFloat = sin(time * 0.15) * 0.2; // Faster float (was 0.07)
  let camX = camDist * sin(camAngle) * cos(camFloat);
  let camY = 100 * sin(time * 0.08) + camDist * sin(camFloat) * 0.5;
  let camZ = camDist * cos(camAngle) * cos(camFloat);
  camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);

  let baseRadius = 180 * breath;

  // ===== MORPHING SURFACE =====
  noFill();

  for (let p of morphParticles) {
    // Get positions from current and next shapes
    let pos1, pos2;

    // Current shape
    switch(currentShape) {
      case 0: pos1 = getSpherePoint(p.u, p.v, baseRadius); break;
      case 1: pos1 = getTorusPoint(p.u, p.v, baseRadius * 0.7, baseRadius * 0.35); break;
      case 2: pos1 = getFlowerPoint(p.u, p.v, baseRadius, 6); break;
      case 3: pos1 = getHelixPoint(p.u, p.v, baseRadius * 0.9, 2); break;
    }

    // Next shape
    switch(nextShape) {
      case 0: pos2 = getSpherePoint(p.u, p.v, baseRadius); break;
      case 1: pos2 = getTorusPoint(p.u, p.v, baseRadius * 0.7, baseRadius * 0.35); break;
      case 2: pos2 = getFlowerPoint(p.u, p.v, baseRadius, 6); break;
      case 3: pos2 = getHelixPoint(p.u, p.v, baseRadius * 0.9, 2); break;
    }

    // Smooth morph with easing
    let ease = smoothstep(0, 1, morphPhase);
    p.targetX = lerp(pos1.x, pos2.x, ease);
    p.targetY = lerp(pos1.y, pos2.y, ease);
    p.targetZ = lerp(pos1.z, pos2.z, ease);

    // Add organic noise movement
    let noiseTime = time * 0.5;
    let noiseScale = 0.02;
    let noiseAmp = 15 * sin(morphPhase * PI); // More noise during transition

    p.targetX += (noise(p.u * noiseScale, p.v * noiseScale, noiseTime) - 0.5) * noiseAmp;
    p.targetY += (noise(p.u * noiseScale + 100, p.v * noiseScale, noiseTime) - 0.5) * noiseAmp;
    p.targetZ += (noise(p.u * noiseScale, p.v * noiseScale + 100, noiseTime) - 0.5) * noiseAmp;

    // Smooth follow with velocity (creates fluid motion)
    let smoothing = 0.15;
    p.velX += (p.targetX - p.x) * smoothing;
    p.velY += (p.targetY - p.y) * smoothing;
    p.velZ += (p.targetZ - p.z) * smoothing;

    // Damping
    p.velX *= 0.85;
    p.velY *= 0.85;
    p.velZ *= 0.85;

    p.x += p.velX;
    p.y += p.velY;
    p.z += p.velZ;

    // Depth-based rendering
    let distFromCam = dist(p.x, p.y, p.z, camX, camY, camZ);
    let brightness = map(distFromCam, 150, 800, 255, 50);
    brightness = constrain(brightness, 50, 255);

    // Add shimmer based on velocity
    let vel = sqrt(p.velX * p.velX + p.velY * p.velY + p.velZ * p.velZ);
    brightness += vel * 3;
    brightness = constrain(brightness, 50, 255);

    let size = map(distFromCam, 150, 800, 2.5, 0.8);

    // Glow effect for bright particles
    if (brightness > 200) {
      stroke(255, brightness * 0.3);
      strokeWeight(size + 2);
      point(p.x, p.y, p.z);
    }

    stroke(brightness);
    strokeWeight(size);
    point(p.x, p.y, p.z);
  }

  // ===== FLOWING INK TRAILS =====
  for (let trail of trailParticles) {
    // Calculate new head position
    let flowTime = time * trail.speed + trail.phase;
    let angle = trail.baseAngle + sin(flowTime * 0.3) * 0.5;

    // Spiral outward then inward
    let radiusOscillation = sin(flowTime * 0.5);
    let r = 200 + radiusOscillation * trail.amplitude;

    // 3D wave motion
    let waveZ = trail.amplitude * 0.8 * sin(flowTime * trail.frequency);
    let waveOffset = 30 * sin(flowTime * 2 + trail.phase);

    let headX = r * cos(angle) + waveOffset * cos(angle + HALF_PI);
    let headY = r * sin(angle) + waveOffset * sin(angle + HALF_PI);
    let headZ = waveZ;

    // Rotate around Y axis - faster
    let rotY = time * 0.12; // (was 0.05)
    let cosR = cos(rotY);
    let sinR = sin(rotY);
    let newX = headX * cosR - headZ * sinR;
    let newZ = headX * sinR + headZ * cosR;
    headX = newX;
    headZ = newZ;

    // Shift trail points (newest at front)
    for (let i = trail.points.length - 1; i > 0; i--) {
      trail.points[i].x = trail.points[i-1].x;
      trail.points[i].y = trail.points[i-1].y;
      trail.points[i].z = trail.points[i-1].z;
    }
    trail.points[0].x = headX;
    trail.points[0].y = headY;
    trail.points[0].z = headZ;

    // Draw trail with fading
    for (let i = 0; i < trail.points.length - 1; i++) {
      let p1 = trail.points[i];
      let p2 = trail.points[i + 1];

      // Skip if points are at origin (not initialized)
      if (p2.x === 0 && p2.y === 0 && p2.z === 0) continue;

      let t = i / trail.points.length;
      let alpha = (1 - t) * (1 - t); // Quadratic falloff

      let distFromCam = dist(p1.x, p1.y, p1.z, camX, camY, camZ);
      let brightness = map(distFromCam, 150, 700, 220, 60);
      brightness *= alpha;

      let weight = map(t, 0, 1, 2.5, 0.3);

      stroke(255, brightness);
      strokeWeight(weight);
      line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }

    // Glowing head
    let head = trail.points[0];
    for (let g = 0; g < 3; g++) {
      stroke(255, 150 - g * 40);
      strokeWeight(4 - g);
      point(head.x, head.y, head.z);
    }
  }

  // ===== WAVE RINGS =====
  for (let ring of waveRings) {
    let ringTime = time * ring.speed + ring.phase;

    for (let p of ring.points) {
      // Animated radius with wave
      let wave = 20 * sin(p.angle * 8 + ringTime * 3 + p.offset);
      let breathWave = 10 * sin(ringTime + p.angle * 2);
      let r = (ring.baseRadius + wave + breathWave) * breath;

      // Gentle z-wave
      let z = 25 * sin(p.angle * 4 + ringTime * 2);

      let x = r * cos(p.angle + ringTime * 0.1);
      let y = r * sin(p.angle + ringTime * 0.1);

      let distFromCam = dist(x, y, z, camX, camY, camZ);
      let brightness = map(distFromCam, 200, 800, 120, 20);

      // Fade outer rings
      brightness *= map(ring.baseRadius, 150, 500, 1, 0.4);

      stroke(brightness);
      strokeWeight(0.8);
      point(x, y, z);
    }
  }

  // ===== CENTRAL CORE =====
  let coreSize = 60 * breath;
  let corePulse = 1 + 0.2 * sin(time * 3);

  for (let i = 0; i < 400; i++) {
    let phi = acos(1 - 2 * (i + 0.5) / 400);
    let theta = PI * PHI * 2 * i + time * 2; // Faster core spin

    let r = coreSize * corePulse * (0.3 + 0.7 * pow(sin(phi), 0.3));

    let x = r * sin(phi) * cos(theta);
    let y = r * sin(phi) * sin(theta);
    let z = r * cos(phi);

    let distFromCam = dist(x, y, z, camX, camY, camZ);
    let brightness = map(distFromCam, 50, 500, 255, 150);

    // Multi-glow
    stroke(255, brightness * 0.4);
    strokeWeight(4);
    point(x, y, z);

    stroke(brightness);
    strokeWeight(2);
    point(x, y, z);
  }

  // ===== SUBTLE GEOMETRY GUIDES =====
  stroke(255, 8);
  strokeWeight(0.3);
  noFill();

  // Rotating triangular frame
  let frameR = 320 * breath;
  let frameRot = time * 0.08; // Faster frame rotation (was 0.03)

  beginShape();
  for (let i = 0; i <= 3; i++) {
    let angle = (i / 3) * TWO_PI + frameRot;
    let x = frameR * cos(angle);
    let y = frameR * sin(angle);
    let z = 30 * sin(time + i);
    vertex(x, y, z);
  }
  endShape(CLOSE);

  // Counter-rotating hexagon
  beginShape();
  for (let i = 0; i <= 6; i++) {
    let angle = (i / 6) * TWO_PI - frameRot * 0.5;
    let x = frameR * 0.8 * cos(angle);
    let y = frameR * 0.8 * sin(angle);
    let z = -20 * sin(time * 0.8 + i * 0.5);
    vertex(x, y, z);
  }
  endShape(CLOSE);

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;

    document.getElementById('duration').textContent =
      ((Date.now() - recordingStartTime) / 1000).toFixed(1);
    document.getElementById('frameCount').textContent = recordingFrameCount;

    if (recordingFrameCount >= MAX_FRAMES) {
      stopRecording();
    }
  }
}

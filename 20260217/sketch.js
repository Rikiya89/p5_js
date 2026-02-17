const W = 1080;
const H = 1920;

// ─── Recording ───
let encoder = null;
let muxer = null;
let isRecording = false;
let recordingFrameCount = 0;
let recordingStartTime = 0;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;

// ─── Art State ───
let t = 0;
let canvasEl = null;
let stopPending = false;
let ringLayers = [];
let dustCloud = [];
let spineNodes = [];
let silkRibbons = [];
let haloOrbits = [];

function setup() {
  const c = createCanvas(W, H, WEBGL);
  canvasEl = c.elt;
  pixelDensity(1);
  frameRate(FPS);

  generateComposition();
  syncInfoUi();
}

function draw() {
  const time = t;
  t += 1 / FPS;

  background(0);
  ambientLight(26);
  pointLight(255, 255, 255, 0, -560, 680);
  pointLight(110, 110, 110, 0, 520, -360);

  push();
  rotateX(0.28 + sin(time * 0.18) * 0.06);
  rotateY(time * 0.12 + sin(time * 0.07) * 0.08);
  rotateZ(sin(time * 0.11) * 0.1);

  drawHaloOrbits(time);
  drawDust(time);
  drawSilkRibbons(time);
  drawSpine(time);
  drawRings(time);
  drawCore(time);
  drawLightRays(time);
  pop();

  if (isRecording) {
    captureFrame();
    recordingFrameCount += 1;
    syncInfoUi();

    if (recordingFrameCount >= MAX_FRAMES && !stopPending) {
      stopPending = true;
      stopRecording().finally(() => {
        stopPending = false;
      });
    }
  }
}

function generateComposition() {
  randomSeed(floor(random(1_000_000_000)));
  noiseSeed(floor(random(1_000_000_000)));

  ringLayers = [];
  dustCloud = [];
  spineNodes = [];
  silkRibbons = [];
  haloOrbits = [];

  const layerCount = 18;
  for (let i = 0; i < layerCount; i += 1) {
    const n = i / (layerCount - 1);
    ringLayers.push({
      baseRadius: lerp(118, 540, n),
      petals: floor(random(5, 13)),
      amplitude: random(24, 98) * (1 - n * 0.3),
      depth: random(18, 88),
      phase: random(TWO_PI),
      speed: random(0.2, 0.88),
      weight: random(0.75, 1.9),
      tilt: random(-0.38, 0.38),
      alpha: lerp(164, 22, n)
    });
  }

  const dustCount = 640;
  for (let i = 0; i < dustCount; i += 1) {
    const theta = random(TWO_PI);
    const phi = acos(random(-1, 1));
    const radius = random(300, 1040);
    const sx = sin(phi);

    const x = radius * sx * cos(theta);
    const y = radius * sx * sin(theta);
    const z = radius * cos(phi);

    dustCloud.push({
      x,
      y,
      z,
      radius,
      drift: random(4, 20),
      speed: random(0.1, 0.56),
      phase: random(TWO_PI),
      size: random(0.5, 2.1)
    });
  }

  const nodes = 200;
  for (let i = 0; i < nodes; i += 1) {
    const p = i / (nodes - 1);
    const centerFalloff = 1 - abs(p - 0.5) * 1.45;

    spineNodes.push({
      y: lerp(-520, 520, p),
      radius: random(18, 88) * max(0.14, centerFalloff),
      wobble: random(4, 22),
      phase: random(TWO_PI),
      spin: random(0.7, 1.6)
    });
  }

  const ribbonCount = 9;
  for (let i = 0; i < ribbonCount; i += 1) {
    silkRibbons.push({
      phase: random(TWO_PI),
      turns: random(1.4, 3.2),
      speed: random(0.18, 0.44),
      radius: random(110, 320),
      amp: random(22, 88),
      height: random(230, 520),
      wave: random(14, 48),
      weight: random(0.8, 2.2),
      alpha: random(36, 110),
      baseYaw: random(TWO_PI),
      tiltX: random(-0.65, 0.65)
    });
  }

  const haloCount = 11;
  for (let i = 0; i < haloCount; i += 1) {
    const n = i / max(1, haloCount - 1);
    haloOrbits.push({
      phase: random(TWO_PI),
      radius: lerp(250, 860, n),
      flatten: random(0.35, 0.86),
      spin: random(0.03, 0.13),
      alpha: lerp(70, 14, n),
      weight: lerp(1.8, 0.6, n)
    });
  }
}

function drawHaloOrbits(time) {
  noFill();
  for (let i = 0; i < haloOrbits.length; i += 1) {
    const h = haloOrbits[i];
    push();
    rotateY(h.phase + time * h.spin);
    rotateX(PI * 0.5 * h.flatten + sin(time * 0.1 + h.phase) * 0.08);
    stroke(255, h.alpha + 8 * sin(time * 0.6 + h.phase));
    strokeWeight(h.weight);
    ellipse(0, 0, h.radius, h.radius * h.flatten);
    pop();
  }
}

function drawDust(time) {
  for (let i = 0; i < dustCloud.length; i += 1) {
    const d = dustCloud[i];
    const wobble = sin(time * d.speed + d.phase) * d.drift;

    const nx = d.x / d.radius;
    const ny = d.y / d.radius;
    const nz = d.z / d.radius;

    const alpha = map(d.radius, 300, 1040, 124, 14);
    stroke(255, alpha);
    strokeWeight(d.size);
    point(
      d.x + nx * wobble,
      d.y + ny * wobble,
      d.z + nz * wobble
    );
  }
}

function drawSilkRibbons(time) {
  noFill();
  for (let i = 0; i < silkRibbons.length; i += 1) {
    const ribbon = silkRibbons[i];
    const twirl = ribbon.phase + time * ribbon.speed;

    push();
    rotateY(ribbon.baseYaw + sin(time * 0.12 + ribbon.phase) * 0.3);
    rotateX(ribbon.tiltX + sin(time * 0.17 + ribbon.phase) * 0.08);
    strokeWeight(ribbon.weight);
    stroke(255, ribbon.alpha + 20 * sin(time * 0.8 + ribbon.phase));

    beginShape();
    const segments = 170;
    for (let s = 0; s <= segments; s += 1) {
      const p = s / segments;
      const pathAngle = p * TWO_PI * ribbon.turns + twirl;
      const breathe = 1 + 0.18 * sin(time * 0.75 + ribbon.phase + p * TWO_PI);
      const radius = ribbon.radius + sin(pathAngle * 1.25) * ribbon.amp;
      const x = cos(pathAngle) * radius * breathe;
      const z = sin(pathAngle) * radius * breathe;
      const y = lerp(-ribbon.height, ribbon.height, p) + sin(pathAngle * 0.7 + time) * ribbon.wave;
      vertex(x, y, z);
    }
    endShape();
    pop();
  }
}

function drawSpine(time) {
  noFill();
  stroke(255, 92);
  strokeWeight(1);
  beginShape();
  for (let i = 0; i < spineNodes.length; i += 1) {
    const n = spineNodes[i];
    const a = time * n.spin + n.phase;
    const r = n.radius + sin(time * 0.92 + n.phase) * n.wobble;
    vertex(cos(a) * r, n.y, sin(a) * r);
  }
  endShape();

  stroke(255, 175);
  strokeWeight(1.6);
  for (let i = 0; i < spineNodes.length; i += 4) {
    const n = spineNodes[i];
    const a = time * n.spin + n.phase;
    const r = n.radius + sin(time * 0.92 + n.phase) * n.wobble;
    point(cos(a) * r, n.y, sin(a) * r);
  }
}

function drawRings(time) {
  const steps = 240;

  for (let i = 0; i < ringLayers.length; i += 1) {
    const layer = ringLayers[i];
    const alphaPulse = layer.alpha + 18 * sin(time * 0.55 + layer.phase);

    push();
    rotateZ(layer.phase + time * layer.speed * 0.45);
    rotateX(layer.tilt + sin(time * 0.26 + layer.phase) * 0.08);

    stroke(255, constrain(alphaPulse, 12, 220));
    strokeWeight(layer.weight);
    noFill();

    beginShape();
    for (let s = 0; s <= steps; s += 1) {
      const a = (s / steps) * TWO_PI;
      const petalPulse = sin(a * layer.petals + time * layer.speed + layer.phase);
      const bloom = 1 + 0.2 * petalPulse;
      const grain = noise(
        cos(a) * 0.72 + i * 0.13 + time * 0.05,
        sin(a) * 0.72 + i * 0.11
      );
      const radialWobble = map(grain, 0, 1, -layer.amplitude * 0.22, layer.amplitude * 0.22);
      const radius = layer.baseRadius + layer.amplitude * petalPulse + radialWobble;
      const z = layer.depth * sin(a * (layer.petals * 0.45) - time * layer.speed + layer.phase);

      vertex(
        radius * cos(a) * bloom,
        radius * sin(a) * bloom,
        z
      );
    }
    endShape(CLOSE);
    pop();
  }
}

function drawCore(time) {
  const coreRadius = 72 + sin(time * 1.1) * 8;

  push();
  noStroke();
  fill(245);
  sphere(coreRadius, 30, 24);
  pop();

  push();
  noFill();
  stroke(255, 78);
  strokeWeight(1.1);
  sphere(coreRadius * 2.15, 18, 12);
  pop();

  for (let i = 0; i < 12; i += 1) {
    push();
    rotateX((PI / 13) * i + time * 0.11);
    rotateY((PI / 10) * i - time * 0.13);
    noFill();
    stroke(255, 62);
    strokeWeight(0.9);
    ellipse(0, 0, coreRadius * 2.7 + i * 20, coreRadius * 2.7 + i * 20);
    pop();
  }
}

function drawLightRays(time) {
  stroke(255, 28);
  strokeWeight(0.95);
  for (let i = 0; i < 42; i += 1) {
    const n = i / 42;
    const a = n * TWO_PI + time * 0.14;
    const r = 620 + 120 * sin(time * 0.44 + i * 0.75);
    const tip = 980 + 110 * sin(time * 0.31 + i * 0.37);
    line(
      cos(a) * r * 0.2,
      sin(a) * r * 0.2,
      sin(a * 2 + time) * 110,
      cos(a) * tip,
      sin(a) * tip,
      cos(a * 3 - time) * 260
    );
  }
}

function syncInfoUi() {
  const durationEl = document.getElementById('duration');
  const frameCountEl = document.getElementById('frameCount');
  const maxDurationEl = document.getElementById('maxDuration');

  if (durationEl) durationEl.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (frameCountEl) frameCountEl.textContent = String(recordingFrameCount);
  if (maxDurationEl) maxDurationEl.textContent = String(MAX_DURATION);
}

function keyPressed() {
  if (key === 'r' || key === 'R') {
    generateComposition();
    t = 0;
  }

  if (key === ' ') {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
    return false;
  }
}

// ═══════════════════════════════════════════
// Recording (WebCodecs + mp4-muxer)
// ═══════════════════════════════════════════
async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('Your browser does not support WebCodecs API.');
    return;
  }

  t = 0;
  isRecording = true;
  stopPending = false;
  recordingFrameCount = 0;
  recordingStartTime = Date.now();
  syncInfoUi();

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

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sacred_geometry.mp4';
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
      statusEl.style.color = '#aaaaaa';
    }, 3000);
  }
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const frame = new VideoFrame(canvasEl || document.querySelector('canvas'), {
    timestamp: recordingFrameCount * (1_000_000 / FPS)
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

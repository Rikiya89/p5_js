'use strict';

// Canvas / export settings
const W = 1080;
const H = 1920;
const FPS = 60;
const LOOP_SECONDS = 18;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

// Creature proportions
const SPINE_POINTS = 96;
const RIB_COUNT = 76;
const FILAMENT_COUNT = 44;
const DOTTED_TRAIL_COUNT = 46;
const ORBIT_ARC_COUNT = 18;
const HELIX_COUNT = 9;
const BODY_DOT_COUNT = 1450;
const PARTICLE_COUNT = 420;
const CAMERA_DISTANCE = 760;

// Pure black-and-white palette.
const BG_TOP = [0, 0, 0];
const BG_BOTTOM = [0, 0, 0];

let particles = [];
let bodyDots = [];
let filaments = [];
let dottedTrails = [];
let orbitArcs = [];
let helices = [];
let seedValue = 2707;
let canvasEl;

// Recording state. Press R to record, S to save a still.
let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;

function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  strokeCap(ROUND);
  strokeJoin(ROUND);
  reseed(seedValue);
}

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const time = loop * TWO_PI;

  drawBackground();
  drawParticles(time);
  drawCreature(time);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    if (recFrameCount >= LOOP_FRAMES) stopRecording();
  }
}

function drawCreature(time) {
  push();
  translate(W * 0.54, H * 0.51);

  // Slow drift and rotation make the structure feel suspended in fluid.
  const driftX = sin(time) * 28 + sin(time * 2 + 1.2) * 9;
  const driftY = cos(time + 0.8) * 34;
  translate(driftX, driftY);
  rotate(-0.08 + sin(time) * 0.055 + sin(time * 2 + 0.4) * 0.018);

  // Breathing scale: tiny expansion, enough to make the point cloud live.
  const breath = 1.0 + sin(time) * 0.025 + sin(time * 2 + 0.7) * 0.006;
  scale(breath);

  drawOrbitArcs(time);
  drawHelicalMembranes(time);
  drawDottedTrails(time);
  drawFilaments(time);
  drawRibs(time);
  drawSpinePointCloud(time);
  drawCentralSpineMask(time);
  pop();
}

function drawDottedTrails(time) {
  // Long dotted tendrils are sampled as beads along noisy quadratic curves.
  // This is the main point-cloud language from the reference image.
  blendMode(ADD);
  noStroke();

  for (const tr of dottedTrails) {
    const root = spinePoint(tr.u, time);
    const dir = spineNormal(tr.u, time).mult(tr.side);
    const tangent = spineTangent(tr.u, time);

    for (let j = 0; j < tr.dots; j++) {
      const u = j / max(1, tr.dots - 1);
      const curl = sin(u * PI + tr.phase) * tr.arc + sin(time * 2 + tr.phase + u * 4) * 18;
      const fall = (u - 0.12) * tr.drop;
      const reach = tr.length * sin(u * HALF_PI);
      const breathe = 1 + sin(time + tr.phase) * 0.035;
      const x = root.x + dir.x * reach * breathe + tangent.x * fall + dir.x * curl;
      const y = root.y + dir.y * reach * breathe + tangent.y * fall + dir.y * curl;
      const z = root.z + tr.side * reach * tr.depth + sin(u * PI + tr.phase) * 90;
      const pr = projectPoint(x, y, z, time);
      const fade = pow(1 - u, 0.45);
      const blink = 0.65 + 0.35 * sin(time * tr.twinkle + tr.phase + j * 0.37);
      const size = tr.dotSize * (0.55 + fade * 0.9) * pr.scale;
      fill(255, 255, 255, tr.alpha * fade * blink * pr.fog);
      circle(pr.x, pr.y, size);
    }
  }

  blendMode(BLEND);
}

function drawOrbitArcs(time) {
  // Sparse bead arcs replace the broad glow: cleaner, darker, and more elegant.
  blendMode(ADD);
  noStroke();

  for (const arc of orbitArcs) {
    for (let i = 0; i < arc.dots; i++) {
      const u = i / max(1, arc.dots - 1);
      const a = arc.start + arc.span * u + sin(time + arc.phase) * 0.08;
      const squeeze = arc.squeeze + sin(time * 2 + arc.phase) * 0.035;
      const x = cos(a) * arc.rx + sin(u * PI + arc.phase) * arc.wave;
      const y = sin(a) * arc.ry * squeeze + arc.y;
      const z = arc.z + sin(a + arc.phase) * arc.depth;
      const pr = projectPoint(x, y, z, time);
      const edgeFade = sin(u * PI);
      const shimmer = 0.72 + 0.28 * sin(time * arc.twinkle + i * 0.31 + arc.phase);
      fill(255, 255, 255, arc.alpha * edgeFade * shimmer * pr.fog);
      circle(pr.x, pr.y, arc.size * pr.scale);
    }
  }

  blendMode(BLEND);
}

function drawHelicalMembranes(time) {
  // Helical strands wrap around the spine and reveal the changing camera angle.
  // Each bead has its own depth, so the organism reads more like a 3D specimen.
  blendMode(ADD);
  noFill();

  for (const h of helices) {
    const strandPoints = [];
    for (let i = 0; i < h.steps; i++) {
      const u = i / (h.steps - 1);
      const p = spinePoint(u, time);
      const n = spineNormal(u, time);
      const t = spineTangent(u, time);
      const coil = h.turns * TWO_PI * u + h.phase + sin(time + h.phase) * 0.28;
      const radius = h.radius * (0.32 + sin(u * PI) * 0.92);
      const breathe = 1 + sin(time * 2 + h.phase + u * TWO_PI) * 0.055;
      const side = cos(coil) * radius * breathe;
      const z = p.z + sin(coil) * radius * h.depth + h.zShift;
      const x = p.x + n.x * side + t.x * h.slant * sin(u * PI);
      const y = p.y + n.y * side + t.y * h.slant * sin(u * PI);
      const pr = projectPoint(x, y, z, time);
      strandPoints.push({ x: pr.x, y: pr.y, s: pr.scale, fog: pr.fog, u });
    }

    stroke(255, 255, 255, h.alpha * 0.55);
    strokeWeight(h.weight);
    beginShape();
    for (const p of strandPoints) curveVertex(p.x, p.y);
    endShape();

    noStroke();
    for (let i = 0; i < strandPoints.length; i += h.beadStep) {
      const p = strandPoints[i];
      const fade = sin(p.u * PI);
      const shimmer = 0.7 + 0.3 * sin(time * h.twinkle + i * 0.4 + h.phase);
      fill(255, 255, 255, h.alpha * fade * shimmer * p.fog);
      circle(p.x, p.y, h.beadSize * p.s);
    }
    noFill();
  }

  blendMode(BLEND);
}

function drawFilaments(time) {
  // Brighter continuous tendrils attach to the spine like primitive nerves.
  noFill();
  blendMode(ADD);

  for (const f of filaments) {
    const root = spinePoint(f.u, time);
    const dir = spineNormal(f.u, time).mult(f.side);
    const tangent = spineTangent(f.u, time);
    stroke(255, 255, 255, f.alpha);
    strokeWeight(f.weight);

    beginShape();
    for (let i = 0; i <= 18; i++) {
      const u = i / 18;
      const reach = f.length * sin(u * HALF_PI);
      const fall = f.drop * u;
      const wave = sin(time * 2 + f.phase + u * 5) * f.wave * u;
      const x = root.x + dir.x * (reach + wave) + tangent.x * fall;
      const y = root.y + dir.y * (reach + wave) + tangent.y * fall;
      const z = root.z + f.side * reach * f.depth + sin(u * PI + f.phase) * 70;
      const pr = projectPoint(x, y, z, time);
      curveVertex(pr.x, pr.y);
    }
    endShape();
  }

  blendMode(BLEND);
}

function drawRibs(time) {
  // Short repeated ribs make the organism feel like a biological scan.
  blendMode(ADD);
  noFill();

  for (let i = 0; i < RIB_COUNT; i++) {
    const u = i / (RIB_COUNT - 1);
    if (u < 0.06 || u > 0.94) continue;

    const p = spinePoint(u, time);
    const n = spineNormal(u, time);
    const side = i % 2 === 0 ? 1 : -1;
    const len = (70 + 150 * sin(u * PI)) * (0.65 + noise(i * 0.1, seedValue * 0.01) * 0.55);
    const bend = sin(time * 2 + i * 0.27) * 18;
    const alpha = 65 + 120 * sin(u * PI);

    noFill();
    stroke(255, 255, 255, alpha);
    strokeWeight(1.05 + 1.1 * sin(u * PI));
    beginShape();
    for (let j = 0; j <= 8; j++) {
      const k = j / 8;
      const outward = n.copy().mult(side * len * k);
      const sag = spineTangent(u, time).mult((k - 0.25) * bend);
      const z = p.z + side * len * k * 0.82 + sin(k * PI + i) * 24;
      const pr = projectPoint(p.x + outward.x + sag.x, p.y + outward.y + sag.y, z, time);
      curveVertex(pr.x, pr.y);
    }
    endShape();

    if (i % 3 === 0) {
      for (let j = 0; j < 9; j++) {
        const k = j / 8;
        const outward = n.copy().mult(side * len * k);
        const sag = spineTangent(u, time).mult((k - 0.25) * bend);
        const z = p.z + side * len * k * 0.82 + sin(k * PI + i) * 24;
        const pr = projectPoint(p.x + outward.x + sag.x, p.y + outward.y + sag.y, z, time);
        fill(255, 255, 255, alpha * (1 - k * 0.55) * pr.fog);
        noStroke();
        circle(pr.x, pr.y, (2.0 - k * 0.6) * pr.scale);
      }
    }
  }

  blendMode(BLEND);
}

function drawSpinePointCloud(time) {
  // Point cloud surrounding the central axis; density follows the organism's
  // silhouette, not a closed blob.
  blendMode(ADD);
  noStroke();

  const visibleDots = [];
  for (const d of bodyDots) {
    const p = spinePoint(d.u, time);
    const n = spineNormal(d.u, time);
    const t = spineTangent(d.u, time);
    const breathing = 1 + sin(time + d.phase) * 0.045;
    const sideDistance = d.side * d.spread * breathing;
    const drift = sin(time * d.freq + d.phase) * d.float;
    const x = p.x + n.x * (sideDistance + drift) + t.x * d.offset;
    const y = p.y + n.y * (sideDistance + drift) + t.y * d.offset;
    const z = p.z + d.side * d.depth + sin(time * d.freq + d.phase) * 22;
    const pr = projectPoint(x, y, z, time);
    const pulse = 0.55 + 0.45 * sin(time * d.pulseRate + d.phase);
    const core = sin(d.u * PI);
    const alpha = d.alpha * pulse * (0.45 + core * 0.8) * pr.fog;
    visibleDots.push({
      x: pr.x,
      y: pr.y,
      z: pr.depth,
      size: d.size * pr.scale,
      alpha
    });
  }

  visibleDots.sort((a, b) => b.z - a.z);
  for (const d of visibleDots) {
    fill(255, 255, 255, d.alpha);
    circle(d.x, d.y, d.size);
  }

  blendMode(BLEND);
}

function drawCentralSpineMask(time) {
  // The central bone is drawn as layered white strokes with a narrow dark
  // separator behind it, so the core remains visible against the filaments.
  noFill();
  stroke(0, 0, 0, 210);
  strokeWeight(20);
  beginShape();
  for (let i = 0; i < SPINE_POINTS; i++) {
    const p = spinePoint(i / (SPINE_POINTS - 1), time);
    const pr = projectPoint(p.x, p.y, p.z, time);
    curveVertex(pr.x, pr.y);
  }
  endShape();

  blendMode(ADD);
  stroke(255, 255, 255, 34);
  strokeWeight(8);
  beginShape();
  for (let i = 0; i < SPINE_POINTS; i++) {
    const p = spinePoint(i / (SPINE_POINTS - 1), time);
    const pr = projectPoint(p.x, p.y, p.z, time);
    curveVertex(pr.x, pr.y);
  }
  endShape();

  stroke(255, 255, 255, 180);
  strokeWeight(5.2);
  beginShape();
  for (let i = 0; i < SPINE_POINTS; i++) {
    const p = spinePoint(i / (SPINE_POINTS - 1), time);
    const pr = projectPoint(p.x, p.y, p.z, time);
    curveVertex(pr.x, pr.y);
  }
  endShape();

  noStroke();
  for (let i = 0; i < 42; i++) {
    const u = i / 41;
    const p = spinePoint(u, time);
    const pr = projectPoint(p.x, p.y, p.z, time);
    const pulse = 0.72 + 0.28 * sin(time * 2 + i * 0.55);
    fill(255, 255, 255, (120 + 90 * sin(u * PI)) * pulse * pr.fog);
    circle(pr.x, pr.y, (4.5 + 2.5 * sin(u * PI)) * pr.scale);
  }

  stroke(255, 255, 255, 120);
  strokeWeight(1.1);
  beginShape();
  for (let i = 0; i < SPINE_POINTS; i++) {
    const u = i / (SPINE_POINTS - 1);
    const p = spinePoint(u, time);
    const n = spineNormal(u, time).mult(18);
    const pr = projectPoint(p.x + n.x, p.y + n.y, p.z + 16, time);
    curveVertex(pr.x, pr.y);
  }
  endShape();
  blendMode(BLEND);
}

function spinePoint(u, time) {
  const y = map(u, 0, 1, -680, 690);
  const wave = sin(u * PI * 2.2 + time) * 86
             + sin(u * PI * 5.0 - time * 2) * 34
             + sin(u * PI * 8.0 + 1.1) * 12;
  const depth = sin(u * PI * 2.7 - time) * 150
              + sin(u * PI * 6.1 + time * 2) * 42;
  const taperLean = map(u, 0, 1, 70, -40);
  return createVector(wave + taperLean, y, depth);
}

function spineTangent(u, time) {
  const a = spinePoint(max(0, u - 0.006), time);
  const b = spinePoint(min(1, u + 0.006), time);
  return p5.Vector.sub(b, a).normalize();
}

function spineNormal(u, time) {
  const t = spineTangent(u, time);
  return createVector(-t.y, t.x).normalize();
}

function projectPoint(x, y, z, time) {
  // Rotate around vertical and horizontal axes before projection. This creates
  // changing front/side/above angles while staying in simple 2D p5 drawing.
  const yaw = sin(time) * 1.12 + sin(time * 2 + 0.8) * 0.32;
  const pitch = sin(time * 2 - 0.4) * 0.24;
  const cy = cos(yaw);
  const sy = sin(yaw);
  const cp = cos(pitch);
  const sp = sin(pitch);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const scale = CAMERA_DISTANCE / (CAMERA_DISTANCE + z2);
  const fog = constrain(map(z2, -420, 420, 1.24, 0.34), 0.28, 1.34);
  return {
    x: x1 * scale,
    y: y2 * scale,
    scale,
    fog,
    depth: z2
  };
}

function drawParticles(time) {
  noStroke();
  blendMode(ADD);
  for (const p of particles) {
    const x = (p.x + sin(time * p.sx + p.phase) * p.wobble + W) % W;
    const y = (p.y + sin(time + p.phase) * p.speed * 24 + cos(time * p.sy + p.phase) * p.wobble + H) % H;
    const pulse = 0.55 + 0.45 * sin(time * p.twinkle + p.phase);
    const alpha = p.alpha * pulse;
    const r = p.size * (0.85 + p.depth * 0.9);

    fill(255, 255, 255, alpha);
    circle(x, y, r);

    if (p.depth > 0.72) {
      fill(255, 255, 255, alpha * 0.035);
      circle(x, y, r * 2.6);
    }
  }
  blendMode(BLEND);
}

function drawBackground() {
  noFill();
  for (let y = 0; y < H; y += 4) {
    const k = y / H;
    const r = lerp(BG_TOP[0], BG_BOTTOM[0], k);
    const g = lerp(BG_TOP[1], BG_BOTTOM[1], k);
    const b = lerp(BG_TOP[2], BG_BOTTOM[2], k);
    stroke(r, g, b);
    strokeWeight(4);
    line(0, y, W, y);
  }
}

function drawVignette() {
  noFill();
  const maxR = dist(W * 0.5, H * 0.5, 0, 0) * 1.1;
  strokeWeight(maxR / 34);
  for (let i = 0; i < 34; i++) {
    const k = i / 33;
    const alpha = map(k, 0.58, 1, 0, 118, true);
    stroke(0, 0, 0, alpha);
    circle(W * 0.5, H * 0.5, maxR * 2 * k);
  }
}

function reseed(s) {
  seedValue = s;
  randomSeed(seedValue);
  noiseSeed(seedValue);
  particles = [];
  bodyDots = [];
  filaments = [];
  dottedTrails = [];
  orbitArcs = [];
  helices = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: random(W),
      y: random(H),
      size: random(0.8, 3.2),
      alpha: random(6, 28),
      speed: random(0.12, 0.62),
      wobble: random(5, 28),
      sx: floor(random(1, 4)),
      sy: floor(random(1, 4)),
      twinkle: floor(random(1, 4)),
      phase: random(TWO_PI),
      depth: random()
    });
  }

  for (let i = 0; i < BODY_DOT_COUNT; i++) {
    const u = random();
    const core = sin(u * PI);
    const side = random() < 0.5 ? -1 : 1;
    bodyDots.push({
      u,
      side,
      spread: random(14, 230) * (0.35 + core * 0.95),
      offset: random(-26, 26),
      depth: random(8, 230) * (0.35 + core * 0.9),
      size: random(0.8, 3.2) * (0.7 + core * 0.7),
      alpha: random(8, 48),
      phase: random(TWO_PI),
      freq: floor(random(1, 4)),
      pulseRate: floor(random(1, 4)),
      float: random(1.0, 18.0)
    });
  }

  for (let i = 0; i < FILAMENT_COUNT; i++) {
    const u = random(0.08, 0.93);
    const core = sin(u * PI);
    filaments.push({
      u,
      side: random() < 0.5 ? -1 : 1,
      length: random(90, 340) * (0.5 + core),
      depth: random(0.35, 1.25),
      drop: random(-160, 210),
      wave: random(8, 38),
      phase: random(TWO_PI),
      alpha: random(42, 150),
      weight: random(0.7, 2.4)
    });
  }

  for (let i = 0; i < DOTTED_TRAIL_COUNT; i++) {
    const u = random(0.03, 0.97);
    const core = sin(u * PI);
    dottedTrails.push({
      u,
      side: random() < 0.5 ? -1 : 1,
      length: random(120, 430) * (0.45 + core),
      depth: random(0.25, 1.15),
      drop: random(-300, 380),
      arc: random(-90, 120),
      dots: floor(random(22, 74)),
      dotSize: random(1.2, 3.6),
      alpha: random(28, 92),
      twinkle: floor(random(1, 4)),
      phase: random(TWO_PI)
    });
  }

  for (let i = 0; i < ORBIT_ARC_COUNT; i++) {
    orbitArcs.push({
      rx: random(260, 520),
      ry: random(410, 820),
      y: random(-180, 180),
      z: random(-180, 180),
      depth: random(120, 360),
      squeeze: random(0.24, 0.58),
      start: random(TWO_PI),
      span: random(PI * 0.35, PI * 1.15) * (random() < 0.5 ? -1 : 1),
      wave: random(-42, 42),
      dots: floor(random(26, 78)),
      size: random(1.0, 2.4),
      alpha: random(10, 38),
      twinkle: floor(random(1, 4)),
      phase: random(TWO_PI)
    });
  }

  for (let i = 0; i < HELIX_COUNT; i++) {
    helices.push({
      turns: random(1.45, 3.35) * (random() < 0.5 ? -1 : 1),
      radius: random(80, 250),
      depth: random(0.78, 1.38),
      zShift: random(-120, 120),
      slant: random(-80, 80),
      steps: floor(random(72, 120)),
      beadStep: floor(random(4, 8)),
      beadSize: random(1.4, 3.5),
      alpha: random(16, 58),
      weight: random(0.45, 1.2),
      twinkle: floor(random(1, 4)),
      phase: random(TWO_PI)
    });
  }
}

function mousePressed() {
  reseed(floor(random(100000)));
}

function keyReleased() {
  if (key === 'r' || key === 'R') {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('20260507_primitive_organism_' + timestamp(), 'png');
    return false;
  }
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    reseed(floor(random(100000)));
    return false;
  }
  return true;
}

function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    console.warn('WebCodecs is not supported in this browser.');
    return;
  }
  if (typeof Mp4Muxer === 'undefined') {
    console.warn('mp4-muxer is not loaded.');
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
}

async function stopRecording() {
  if (!encoder || !muxer) return;

  isRecording = false;
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '20260507_primitive_organism_' + timestamp() + '.mp4';
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
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

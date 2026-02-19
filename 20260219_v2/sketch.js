// Sacred Geometry — 3D Generative Art
// Theme: Flower of Life shell + Metatron lattice + Merkaba + Phi helixes
// Canvas: 1080 × 1920 (portrait 9:16)

const W = 1080;
const H = 1920;

const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;
const PHI = (1 + Math.sqrt(5)) / 2;

const PALETTE_HEX = [
  "#362d78",
  "#523fa3",
  "#916ccc",
  "#bda1e5",
  "#c8c0e9",
  "#84bae7",
  "#516ad4",
  "#333f87",
  "#293039",
  "#283631"
];

const STAR_COUNT = 340;
const ORBITER_COUNT = 54;
const PRAYER_PARTICLE_COUNT = 130;
const CHAKRA_COUNT = 7;
const TETRA_VERTS = [
  [1, 1, 1],
  [-1, -1, 1],
  [-1, 1, -1],
  [1, -1, -1]
];
const TETRA_EDGES = [
  [0, 1], [0, 2], [0, 3],
  [1, 2], [1, 3], [2, 3]
];

let palette = [];
let stars = [];
let orbiters = [];
let prayerParticles = [];
let encoder = null;
let muxer = null;
let isRecording = false;
let recordingFrameCount = 0;
let t = 0;

function setup() {
  pixelDensity(1);
  setAttributes("antialias", true);
  createCanvas(W, H, WEBGL);
  frameRate(FPS);
  colorMode(RGB);
  smooth();

  palette = PALETTE_HEX.map((c) => color(c));
  initStars();
  initOrbiters();
  initPrayerParticles();

  const maxDurationEl = document.getElementById("maxDuration");
  if (maxDurationEl) {
    maxDurationEl.textContent = MAX_DURATION;
  }
}

function draw() {
  if (isRecording && recordingFrameCount >= MAX_FRAMES) {
    stopRecording();
  }

  background(8, 9, 24);
  applyCamera();
  applyLights();
  drawStellarField();

  push();
  const breathe = 1 + 0.035 * sin(t * 0.5);
  scale(breathe);
  drawFlowerOfLifeShell();
  drawMetatronLattice();
  drawVesicaGateways();
  drawHarmonicHalos();
  drawChakraColumn();
  drawPrayerParticles();
  drawMerkaba();
  drawOrbitingSigils();
  drawPhiHelixes();
  pop();

  t += 0.0075;

  if (isRecording && encoder) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
  }
}

function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
}

function initStars() {
  randomSeed(20260219);
  noiseSeed(20260219);
  stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const theta = random(TWO_PI);
    const phi = acos(random(-1, 1));
    const radius = random(680, 1450);
    stars.push({
      x: radius * sin(phi) * cos(theta),
      y: radius * sin(phi) * sin(theta),
      z: radius * cos(phi),
      weight: random(0.8, 2.7),
      hueOffset: random()
    });
  }
}

function initOrbiters() {
  orbiters = [];
  for (let i = 0; i < ORBITER_COUNT; i++) {
    orbiters.push({
      theta0: random(TWO_PI),
      phi0: acos(random(-1, 1)),
      speed: random(0.3, 1.05) * (i % 2 === 0 ? 1 : -1),
      radialPhase: random(TWO_PI),
      size: random(3.2, 8.4),
      hueOffset: i / ORBITER_COUNT,
      tilt: random(-0.7, 0.7)
    });
  }
}

function initPrayerParticles() {
  prayerParticles = [];
  for (let i = 0; i < PRAYER_PARTICLE_COUNT; i++) {
    prayerParticles.push({
      phase: random(TWO_PI),
      riseOffset: random(),
      speed: random(0.55, 1.3),
      radius: random(58, 230),
      wobble: random(0.3, 1.2),
      size: random(1.6, 4.6),
      hueOffset: random(),
      drift: random(-0.85, 0.85)
    });
  }
}

function paletteColor(frac) {
  const n = palette.length;
  const pos = ((frac % 1 + 1) % 1) * (n - 1);
  const i0 = floor(pos);
  const i1 = (i0 + 1) % n;
  const f = pos - i0;
  return lerpColor(palette[i0], palette[i1], f);
}

function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs API is not supported in this browser.\nUse Chrome or Edge.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer failed to load. Refresh and try again.");
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error("Encoder error:", e);
      setStatus("Encoder error", "#ff6b6b");
      isRecording = false;
    }
  });
  encoder.configure({
    codec: "avc1.640028",
    width: W,
    height: H,
    bitrate: 12_000_000,
    framerate: FPS
  });

  t = 0;
  isRecording = true;
  recordingFrameCount = 0;

  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;

  setStatus("Recording MP4...", "#ff6b6b");
  updateRecordingUI();
}

async function stopRecording() {
  if (!isRecording || !encoder || !muxer) return;

  isRecording = false;
  setStatus("Finalizing MP4...", "#84bae7");

  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sacred_geometry_20260219_v2.mp4";
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;

  setStatus("Complete!", "#84bae7");
  setTimeout(() => {
    setStatus("Ready", "#84bae7");
  }, 3000);
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector("canvas");
  if (!canvas) return;

  const frame = new VideoFrame(canvas, {
    timestamp: recordingFrameCount * (1_000_000 / FPS)
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, colorHex) {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = text;
  status.style.color = colorHex;
}

function updateRecordingUI() {
  const durationEl = document.getElementById("duration");
  const frameCountEl = document.getElementById("frameCount");
  if (durationEl) durationEl.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (frameCountEl) frameCountEl.textContent = recordingFrameCount;
}

function applyCamera() {
  const orbit = t * 0.11;
  const zoomPulse = 0.5 + 0.5 * sin(t * 0.35);
  const radius = 780 + 190 * zoomPulse * zoomPulse;

  const camX = radius * sin(orbit) + 220 * sin(t * 0.31);
  const camY = 160 * sin(t * 0.23) - 90 * cos(t * 0.08) + 65 * sin(t * 0.57);
  const camZ = radius * cos(orbit * (0.82 + 0.12 * sin(t * 0.12))) + 170 * cos(t * 0.27);

  const targetX = 75 * sin(t * 0.19);
  const targetY = 42 * cos(t * 0.22) + 30 * sin(t * 0.5);
  const targetZ = 60 * sin(t * 0.13);

  camera(camX, camY, camZ, targetX, targetY, targetZ, 0, 1, 0);
}

function applyLights() {
  ambientLight(22, 20, 45);

  const key = paletteColor(t * 0.05 + 0.1);
  const fill = paletteColor(t * 0.05 + 0.45);
  const rim = paletteColor(t * 0.05 + 0.78);

  pointLight(red(key), green(key), blue(key), 0, -420, 360);
  pointLight(
    red(fill), green(fill), blue(fill),
    420 * sin(t * 0.45), 280 * cos(t * 0.33), -240
  );
  directionalLight(
    red(rim), green(rim), blue(rim),
    -0.4 + 0.3 * sin(t * 0.2), 0.25, -1
  );
}

function drawStellarField() {
  push();
  rotateY(-t * 0.03);
  rotateX(t * 0.01);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const twinkle = 0.35 + 0.65 * abs(sin(t * 1.8 + s.hueOffset * TWO_PI));
    const c = paletteColor(s.hueOffset + t * 0.05);
    stroke(red(c), green(c), blue(c), 22 + 120 * twinkle);
    strokeWeight(s.weight * (0.45 + twinkle));
    point(s.x, s.y, s.z);
  }
  pop();
}

function drawFlowerOfLifeShell() {
  const layers = 6;
  const centerDistance = 132;
  const ringRadius = 84;
  const tubeRadius = 3.2;

  for (let layer = 0; layer < layers; layer++) {
    const z = map(layer, 0, layers - 1, -260, 260) + 26 * sin(t * 1.2 + layer);
    const c = paletteColor(layer / layers + t * 0.06);
    const liveCenterDistance = centerDistance + 16 * sin(t * 0.95 + layer * 0.9);
    const liveRingRadius = ringRadius + 7 * sin(t * 1.45 + layer * 0.8);

    push();
    translate(0, 0, z);
    rotateZ(layer * PI / 6 + t * (layer % 2 === 0 ? 0.08 : -0.09));
    rotateX(0.16 * sin(t * 0.4 + layer * 0.7));
    rotateY(0.11 * sin(t * 0.55 + layer * 1.1));

    specularMaterial(red(c), green(c), blue(c));
    shininess(12);
    noStroke();

    for (let i = 0; i < 7; i++) {
      let px = 0;
      let py = 0;
      if (i > 0) {
        const a = (i - 1) * TWO_PI / 6;
        px = liveCenterDistance * cos(a);
        py = liveCenterDistance * sin(a);
      }
      push();
      translate(px, py, 0);
      rotateX(HALF_PI);
      torus(liveRingRadius, tubeRadius, 34, 12);
      pop();
    }
    pop();
  }
}

function drawMetatronLattice() {
  push();
  rotateY(t * 0.2);
  rotateX(t * 0.16);
  rotateZ(t * 0.08);

  const nodeRadius = 96;
  const nodes = [createVector(0, 0, 0)];

  for (let i = 0; i < 6; i++) {
    const a = i * TWO_PI / 6 + PI / 6;
    nodes.push(createVector(
      nodeRadius * cos(a),
      nodeRadius * sin(a),
      72 * sin(t * 1.1 + a * 2.3)
    ));
  }
  for (let i = 0; i < 6; i++) {
    const a = i * TWO_PI / 6;
    nodes.push(createVector(
      nodeRadius * 2 * cos(a),
      nodeRadius * 2 * sin(a),
      102 * cos(t * 1.1 + a * 2.0)
    ));
  }

  const edges = [];
  strokeWeight(1.15);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = p5.Vector.dist(nodes[i], nodes[j]);
      const intensity = constrain(map(d, 70, 320, 1, 0.08), 0.08, 1);
      const c = paletteColor(i / nodes.length + t * 0.04 + j * 0.017);
      stroke(red(c), green(c), blue(c), 20 + 118 * intensity);
      line(
        nodes[i].x, nodes[i].y, nodes[i].z,
        nodes[j].x, nodes[j].y, nodes[j].z
      );
      if (d < 320) {
        edges.push([i, j]);
      }
    }
  }

  drawEdgePulseTravellers(nodes, edges);

  noStroke();
  for (let i = 0; i < nodes.length; i++) {
    const c = paletteColor(i / nodes.length + t * 0.08);
    push();
    translate(nodes[i].x, nodes[i].y, nodes[i].z);
    emissiveMaterial(red(c) * 0.65, green(c) * 0.65, blue(c) * 0.65);
    sphere(5.6 + 1.8 * sin(t * 2 + i), 8, 7);
    pop();
  }

  pop();
}

function drawEdgePulseTravellers(nodes, edges) {
  if (edges.length === 0) return;

  const pulseCount = 24;
  for (let p = 0; p < pulseCount; p++) {
    const edgeIndex = (p * 11 + floor(t * 38)) % edges.length;
    const [i0, i1] = edges[edgeIndex];
    const v0 = nodes[i0];
    const v1 = nodes[i1];
    const speed = 0.45 + 0.07 * (p % 6);
    const travel = (t * speed + p * 0.17) % 1;
    const tail = max(0, travel - 0.09);

    const hx = lerp(v0.x, v1.x, travel);
    const hy = lerp(v0.y, v1.y, travel);
    const hz = lerp(v0.z, v1.z, travel);
    const tx = lerp(v0.x, v1.x, tail);
    const ty = lerp(v0.y, v1.y, tail);
    const tz = lerp(v0.z, v1.z, tail);

    const c = paletteColor(travel + p * 0.07 + t * 0.1);
    stroke(red(c), green(c), blue(c), 160);
    strokeWeight(1.05);
    line(tx, ty, tz, hx, hy, hz);

    push();
    translate(hx, hy, hz);
    noStroke();
    emissiveMaterial(red(c) * 0.8, green(c) * 0.8, blue(c) * 0.8);
    sphere(2.7 + 1.4 * sin(t * 5 + p), 7, 6);
    pop();
  }
}

function drawHarmonicHalos() {
  push();
  rotateX(HALF_PI + 0.2 * sin(t * 0.42));
  rotateY(t * 0.19);
  rotateZ(t * 0.14);
  noFill();

  const haloCount = 6;
  for (let i = 0; i < haloCount; i++) {
    const rr = 210 + i * 44 + 11 * sin(t * 1.35 + i * 0.7);
    const waveAmp = 10 + i * 1.7;
    const c = paletteColor(t * 0.06 + i * 0.14);
    stroke(red(c), green(c), blue(c), 68 + i * 15);
    strokeWeight(0.8 + i * 0.14);

    beginShape();
    for (let j = 0; j <= 130; j++) {
      const a = (j / 130) * TWO_PI;
      const wobble = waveAmp * sin(3 * a + t * 1.2 + i * 0.9);
      vertex(rr * cos(a), rr * sin(a), wobble);
    }
    endShape(CLOSE);
  }
  pop();
}

function drawVesicaGateways() {
  push();
  rotateY(t * 0.13);
  rotateX(0.12 * sin(t * 0.4));
  noFill();

  const gateCount = 5;
  for (let g = 0; g < gateCount; g++) {
    const y = map(g, 0, gateCount - 1, 260, -260);
    const ringR = 88 + g * 22 + 8 * sin(t * 1.2 + g * 0.8);
    const centerGap = ringR * (0.62 + 0.04 * sin(t * 0.9 + g));
    const c = paletteColor(0.1 + g * 0.13 + t * 0.05);
    stroke(red(c), green(c), blue(c), 120);
    strokeWeight(1.15 + g * 0.14);

    push();
    translate(0, y, 0);
    rotateZ(t * (g % 2 === 0 ? 0.18 : -0.16) + g * 0.3);
    rotateX(0.18 * sin(t * 0.7 + g * 0.6));

    push();
    translate(-centerGap, 0, 0);
    rotateX(HALF_PI);
    drawCircleWire(ringR, 120);
    pop();

    push();
    translate(centerGap, 0, 0);
    rotateX(HALF_PI);
    drawCircleWire(ringR, 120);
    pop();

    const lensGlow = paletteColor(0.2 + g * 0.17 + t * 0.07);
    noStroke();
    emissiveMaterial(red(lensGlow) * 0.45, green(lensGlow) * 0.45, blue(lensGlow) * 0.45);
    sphere(4 + 2.6 * sin(t * 2.2 + g), 8, 7);
    pop();
  }
  pop();
}

function drawCircleWire(radius, steps) {
  beginShape();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TWO_PI;
    vertex(radius * cos(a), radius * sin(a), 0);
  }
  endShape(CLOSE);
}

function drawChakraColumn() {
  push();
  rotateY(t * 0.11);
  rotateX(0.08 * sin(t * 0.28));
  noFill();

  const top = -320;
  const bottom = 320;
  const beamC = paletteColor(0.62 + t * 0.03);
  stroke(red(beamC), green(beamC), blue(beamC), 118);
  strokeWeight(2.4);
  line(0, top, 0, 0, bottom, 0);

  for (let i = 0; i < CHAKRA_COUNT; i++) {
    const y = map(i, 0, CHAKRA_COUNT - 1, bottom * 0.82, top * 0.82);
    const pulse = 0.5 + 0.5 * sin(t * 2.1 + i * 0.75);
    const nodeRadius = 8 + 7 * pulse;
    const haloRadius = 28 + 21 * pulse + i * 3;
    const c = paletteColor(i / CHAKRA_COUNT + t * 0.045);

    stroke(red(c), green(c), blue(c), 82 + pulse * 110);
    strokeWeight(1.0 + 0.35 * pulse);
    push();
    translate(0, y, 0);
    rotateX(HALF_PI);
    drawCircleWire(haloRadius, 84);
    pop();

    push();
    translate(0, y, 0);
    noStroke();
    emissiveMaterial(red(c) * 0.8, green(c) * 0.8, blue(c) * 0.8);
    sphere(nodeRadius, 12, 10);
    pop();
  }
  pop();
}

function drawPrayerParticles() {
  push();
  rotateY(t * 0.23);
  rotateX(-0.07 + 0.03 * sin(t * 0.36));

  for (let i = 0; i < prayerParticles.length; i++) {
    const p = prayerParticles[i];
    const cycle = (p.riseOffset + t * 0.06 * p.speed) % 1;
    const prevCycle = (cycle - 0.035 + 1) % 1;

    const y = map(cycle, 0, 1, 360, -360);
    const py = map(prevCycle, 0, 1, 360, -360);

    const ang = p.phase + t * (1.1 + p.wobble) + p.drift * cycle * 2.3;
    const prevAng = p.phase + (t - 0.035) * (1.1 + p.wobble) + p.drift * prevCycle * 2.3;

    const radialBreath = p.radius * (0.72 + 0.28 * sin(t * 1.4 + p.phase));
    const radialDrift = 24 * sin(t * 2.2 + p.phase * 2.4);
    const r = radialBreath + radialDrift;

    const x = r * cos(ang);
    const z = r * sin(ang);
    const px = r * cos(prevAng);
    const pz = r * sin(prevAng);

    const c = paletteColor(p.hueOffset + t * 0.08 + cycle * 0.25);
    stroke(red(c), green(c), blue(c), 95 + 120 * (1 - cycle));
    strokeWeight(0.6 + p.size * 0.15);
    line(px, py, pz, x, y, z);

    push();
    translate(x, y, z);
    noStroke();
    emissiveMaterial(red(c) * 0.9, green(c) * 0.9, blue(c) * 0.9);
    sphere(p.size * (0.8 + 0.6 * (1 - cycle)), 7, 6);
    pop();
  }

  pop();
}

function drawMerkaba() {
  push();
  rotateY(t * 0.24);
  rotateX(-t * 0.17);
  rotateZ(t * 0.11);

  const s = 245 + 18 * sin(t * 0.53);
  drawTetrahedronWire(s, paletteColor(t * 0.05 + 0.22), 205, 2.1);

  push();
  rotateX(PI);
  rotateY(PI / 3 + t * 0.12);
  drawTetrahedronWire(s, paletteColor(t * 0.05 + 0.67), 205, 2.1);
  pop();

  noStroke();
  const core = paletteColor(t * 0.08 + 0.88);
  ambientMaterial(red(core), green(core), blue(core));
  sphere(34, 20, 15);
  pop();
}

function drawTetrahedronWire(scaleAmount, strokeColor, alpha, weight) {
  const s = scaleAmount / sqrt(3);
  stroke(red(strokeColor), green(strokeColor), blue(strokeColor), alpha);
  strokeWeight(weight);
  noFill();

  for (let i = 0; i < TETRA_EDGES.length; i++) {
    const [a, b] = TETRA_EDGES[i];
    const v0 = TETRA_VERTS[a];
    const v1 = TETRA_VERTS[b];
    line(
      v0[0] * s, v0[1] * s, v0[2] * s,
      v1[0] * s, v1[1] * s, v1[2] * s
    );
  }
}

function drawPhiHelixes() {
  push();
  rotateX(-PI / 10 + 0.08 * sin(t * 0.16));
  rotateZ(t * 0.06);

  noFill();
  const strands = 3;
  const turns = 5;
  const steps = 420;

  for (let strand = 0; strand < strands; strand++) {
    const baseRadius = 92 * pow(PHI, strand * 0.46);
    const c = paletteColor(t * 0.04 + strand / strands);
    stroke(red(c), green(c), blue(c), 170);
    strokeWeight(1.65);

    beginShape();
    for (let i = 0; i <= steps; i++) {
      const u = map(i, 0, steps, 0, TWO_PI * turns);
      const ripple = 14 * sin(6 * u + t * 1.8 + strand);
      const radius = baseRadius + ripple;
      const phase = strand * TWO_PI / strands + t * 0.3;
      const x = radius * cos(u + phase);
      const y = radius * sin(u + phase);
      const z = map(i, 0, steps, -370, 370) + 24 * sin(2 * u + strand + t);
      vertex(x, y, z);
    }
    endShape();
  }

  pop();
}

function drawOrbitingSigils() {
  push();
  rotateY(t * 0.18);
  rotateX(-0.08 + 0.05 * sin(t * 0.3));

  const baseRadius = 332 + 24 * sin(t * 0.8);
  for (let i = 0; i < orbiters.length; i++) {
    const o = orbiters[i];
    const ang = o.theta0 + t * o.speed;
    const elev = o.phi0 + 0.26 * sin(t * 0.72 + o.radialPhase);
    const radius = baseRadius + 68 * sin(t * 1.28 + o.radialPhase);

    const x = radius * sin(elev) * cos(ang);
    const y = radius * cos(elev) * 0.78;
    const z = radius * sin(elev) * sin(ang);

    const prevAng = ang - 0.08 * o.speed;
    const px = radius * sin(elev) * cos(prevAng);
    const py = radius * cos(elev) * 0.78;
    const pz = radius * sin(elev) * sin(prevAng);

    const c = paletteColor(o.hueOffset + t * 0.09);
    stroke(red(c), green(c), blue(c), 115);
    strokeWeight(0.65 + o.size * 0.08);
    line(px, py, pz, x, y, z);

    push();
    translate(x, y, z);
    rotateY(ang + HALF_PI);
    rotateX(o.tilt + t * 0.42);
    noStroke();
    emissiveMaterial(red(c) * 0.8, green(c) * 0.8, blue(c) * 0.8);
    box(o.size * 0.35, o.size, o.size * 1.6);
    pop();
  }

  pop();
}

"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const BLACK = [0, 0, 0];
const VOID = [8, 8, 8];
const SHADE = [22, 22, 22];
const GRAPHITE = [54, 54, 54];
const SILVER = [132, 132, 132];
const PEARL = [210, 210, 210];
const WHITE = [255, 255, 255];

const MAGIC_SUM = 15;
const LOSHU = [
  [8, 1, 6],
  [3, 5, 7],
  [4, 9, 2],
];
const LINE_GROUPS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";

let fc = 0;
let bgLayer = null;
let overlayLayer = null;
let labelTextures = {};
let cellData = [];
let lineData = [];
let ambientDust = [];
let orbiters = [];
let lineParticles = [];

function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs not supported. Use Chrome or Edge.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer failed to load.");
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      console.error(err);
      setStatus("Encoder error", "#f2f2f2");
      isRecording = false;
    },
  });

  encoder.configure({
    codec: "avc1.640028",
    width: W,
    height: H,
    bitrate: 16_000_000,
    framerate: FPS,
  });

  fc = 0;
  recordingFrameCount = 0;
  isRecording = true;
  clearDownloadLink();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  setStatus("Recording MP4...", "#ffffff");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;

  isRecording = false;
  setStatus("Finalizing...", "#d8d8d8");
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  setDownloadLink(url, "lo_shu_magic_square_20260310.mp4");
  const a = document.createElement("a");
  a.href = url;
  a.download = "lo_shu_magic_square_20260310.mp4";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();

  encoder.close();
  encoder = null;
  muxer = null;

  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("Complete - use Download MP4 if the browser blocked auto-save.", "#ffffff");
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, {
    timestamp: recordingFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, color) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

function updateRecordingUI() {
  const dEl = document.getElementById("duration");
  const fEl = document.getElementById("frameCount");
  if (dEl) dEl.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recordingFrameCount;
}

function updateCanvasInfo() {
  const el = document.getElementById("canvasSize");
  if (el) el.textContent = W + " x " + H;
}

function setDownloadLink(url, filename) {
  const link = document.getElementById("downloadLink");
  if (!link) return;
  link.href = url;
  link.download = filename;
  link.hidden = false;
  link.textContent = "Download MP4";
}

function clearDownloadLink() {
  if (latestRecordingUrl) {
    URL.revokeObjectURL(latestRecordingUrl);
    latestRecordingUrl = "";
  }
  const link = document.getElementById("downloadLink");
  if (!link) return;
  link.hidden = true;
  link.removeAttribute("href");
}

function setup() {
  pixelDensity(1);
  setAttributes("antialias", true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  textFont("monospace");

  buildScene();
  buildLabelTextures();
  buildBackdrop();
  buildOverlay();

  const maxDurationEl = document.getElementById("maxDuration");
  if (maxDurationEl) maxDurationEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function draw() {
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const theta = loopT * TWO_PI;
  const slowPulse = 0.5 + 0.5 * sin(theta * (MAGIC_SUM / 5));
  const linePulse = 0.5 + 0.5 * cos(theta * (MAGIC_SUM / 3));

  background(...BLACK);
  drawBackdrop();
  setSceneCamera(theta);
  setSceneLights(theta, slowPulse);

  drawOuterShell(theta, slowPulse);
  drawSquarePlatform(theta, slowPulse);
  drawMagicLines(theta, linePulse);
  drawCellTowers(theta, slowPulse);

  blendMode(ADD);
  noLights();
  drawOrbiters(theta, linePulse);
  drawLineParticles(theta, linePulse);
  drawAmbientDust(theta);
  blendMode(BLEND);

  drawHud(theta, slowPulse);

  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }

  fc++;
}

function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  return true;
}

function buildScene() {
  cellData = [];
  lineData = [];
  ambientDust = [];
  orbiters = [];
  lineParticles = [];

  const gridSpacing = 240;
  const rng = makeRng(20260310);
  let index = 0;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const value = LOSHU[row][col];
      const x = (col - 1) * gridSpacing;
      const z = (row - 1) * gridSpacing;
      const segments = 2 + floor(value * 0.55);
      const cell = {
        index,
        row,
        col,
        value,
        x,
        z,
        baseY: 170,
        padSize: 170,
        padHeight: 24,
        towerWidth: 44 + value * 5,
        towerHeight: 120 + value * 30,
        ringCount: 1 + floor(value / 3),
        orbitSpeed: 0.32 + value * 0.085,
        glowAlpha: 62 + value * 12,
        labelScale: 0.68 + value * 0.015,
        segments,
        pulsePhase: (value / 9) * TWO_PI,
      };
      cellData.push(cell);

      let count = 2 + floor(value / 3);
      if (value === 5) count += 5;
      for (let i = 0; i < count; i++) {
        orbiters.push({
          cellIndex: index,
          angleOffset: (i / count) * TWO_PI,
          radius: 58 + i * 8 + value * 2.2,
          heightBias: 18 + i * 7,
          speed: cell.orbitSpeed * (0.75 + i * 0.08),
          bob: 10 + value * 1.6 + i * 2.2,
          size: value === 5 ? 4.4 + i * 0.28 : 3.1 + i * 0.22,
          phase: rng() * TWO_PI,
        });
      }

      index++;
    }
  }

  LINE_GROUPS.forEach((indices, lineIndex) => {
    const sum = indices.reduce((acc, idx) => acc + cellData[idx].value, 0);
    const line = {
      indices,
      lineIndex,
      sum,
      phase: lineIndex * (PI / 4),
      pulseShift: lineIndex % 2 === 0 ? 1 : -1,
      lift: 32 + lineIndex * 8,
    };
    lineData.push(line);

    const particleCount = 4 + (lineIndex % 3);
    for (let i = 0; i < particleCount; i++) {
      lineParticles.push({
        lineIndex,
        t: i / particleCount,
        speed: 0.08 + lineIndex * 0.01 + i * 0.005,
        size: 3 + (lineIndex % 3) * 0.7,
        phase: rng() * TWO_PI,
      });
    }
  });

  for (let i = 0; i < 980; i++) {
    const radius = 360 + pow(rng(), 0.68) * 760;
    const angle = rng() * TWO_PI;
    const y = -320 + rng() * 760;
    ambientDust.push({
      radius,
      angle,
      y,
      size: rng() < 0.1 ? 2.6 : 1.1 + rng() * 1.2,
      alpha: 12 + rng() * 40,
      drift: 10 + rng() * 34,
      speed: 0.12 + rng() * 0.55,
    });
  }
}

function buildLabelTextures() {
  labelTextures = {};
  for (let value = 1; value <= 9; value++) {
    const g = createGraphics(220, 220);
    g.pixelDensity(1);
    g.clear();
    g.noStroke();
    g.fill(0, 0, 0, 168);
    g.rect(24, 24, 172, 172, 22);
    g.noFill();
    g.stroke(255, 255, 255, value === 5 ? 220 : 170);
    g.strokeWeight(value === 5 ? 4 : 3);
    g.rect(34, 34, 152, 152, 18);
    g.stroke(255, 255, 255, 64);
    g.strokeWeight(1);
    g.line(52, 110, 168, 110);
    g.line(110, 52, 110, 168);
    g.noStroke();
    g.fill(255);
    g.textAlign(CENTER, CENTER);
    g.textFont("monospace");
    g.textSize(value === 5 ? 118 : 108);
    g.textStyle(BOLD);
    g.text(String(value), 110, 114);
    labelTextures[value] = g;
  }
}

function buildBackdrop() {
  bgLayer = createGraphics(W, H);
  bgLayer.pixelDensity(1);
  bgLayer.background(...BLACK);

  const ctx = bgLayer.drawingContext;
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0.0, rgba(BLACK, 1));
  wash.addColorStop(0.42, rgba(VOID, 1));
  wash.addColorStop(0.72, rgba(SHADE, 0.9));
  wash.addColorStop(1.0, rgba(BLACK, 1));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  const bloom = ctx.createRadialGradient(W * 0.5, H * 0.46, 60, W * 0.5, H * 0.48, H * 0.54);
  bloom.addColorStop(0.0, rgba(WHITE, 0.16));
  bloom.addColorStop(0.2, rgba(PEARL, 0.09));
  bloom.addColorStop(0.48, rgba(GRAPHITE, 0.07));
  bloom.addColorStop(1.0, rgba(BLACK, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  bgLayer.noFill();
  bgLayer.stroke(255, 255, 255, 20);
  bgLayer.strokeWeight(2);
  bgLayer.rect(40, 40, W - 80, H - 80, 16);
  bgLayer.stroke(255, 255, 255, 8);
  bgLayer.rect(84, 84, W - 168, H - 168, 8);

  bgLayer.strokeWeight(1);
  for (let y = 0; y < H; y += 5) {
    bgLayer.stroke(255, 255, 255, y % 20 === 0 ? 6 : 2);
    bgLayer.line(0, y, W, y);
  }

  const rng = makeRng(3141592);
  bgLayer.noStroke();
  for (let i = 0; i < 1800; i++) {
    const alpha = rng() < 0.14 ? 24 : 8;
    const size = rng() < 0.08 ? 2.4 : 1.1;
    bgLayer.fill(255, 255, 255, alpha);
    bgLayer.circle(rng() * W, rng() * H, size);
  }
}

function buildOverlay() {
  overlayLayer = createGraphics(W, H);
  overlayLayer.pixelDensity(1);
  overlayLayer.clear();

  const ctx = overlayLayer.drawingContext;
  const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.1, W * 0.5, H * 0.5, H * 0.76);
  vignette.addColorStop(0.0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.68, "rgba(0,0,0,0.1)");
  vignette.addColorStop(1.0, "rgba(0,0,0,0.74)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  const rng = makeRng(2718281);
  overlayLayer.strokeWeight(1);
  for (let y = 0; y < H; y += 3) {
    overlayLayer.stroke(255, 255, 255, y % 9 === 0 ? 4 : 1);
    overlayLayer.line(0, y, W, y);
  }

  overlayLayer.noStroke();
  for (let i = 0; i < 2200; i++) {
    overlayLayer.fill(255, 255, 255, rng() * 9);
    overlayLayer.rect(rng() * W, rng() * H, 1, 1);
  }
}

function drawBackdrop() {
  disableDepthTest();
  push();
  resetMatrix();
  translate(-W * 0.5, -H * 0.5);
  image(bgLayer, 0, 0, W, H);
  pop();
  enableDepthTest();
}

function setSceneCamera(theta) {
  perspective(PI / 3.2, W / H, 20, 7000);
  const camX = sin(theta * 0.75) * 190;
  const camY = -210 + sin(theta * 2) * 70;
  const camZ = 1120 + cos(theta * 0.75) * 110;
  camera(camX, camY, camZ, 0, -30, 0, 0, 1, 0);
}

function setSceneLights(theta, pulse) {
  ambientLight(36, 36, 36);
  directionalLight(255, 255, 255, -0.2, 0.1, -1);
  directionalLight(150, 150, 150, 0.34, -0.45, -0.25);
  pointLight(255, 255, 255, 0, -260 + 90 * pulse, 280 + 70 * sin(theta * 2));
  pointLight(180, 180, 180, 420 * sin(theta), -80 + 80 * cos(theta * 1.5), 320 * cos(theta));
}

function drawOuterShell(theta, pulse) {
  push();
  noFill();
  rotateY(-theta * 0.42);
  rotateX(0.24 + sin(theta) * 0.08);
  rotateZ(theta * 0.05);

  stroke(255, 255, 255, 48 + 22 * pulse);
  strokeWeight(1.2);
  drawWireCube(860, 520, 860);

  stroke(255, 255, 255, 24 + 12 * pulse);
  strokeWeight(1);
  drawSquareLoop(690, -110);
  drawSquareLoop(760, 110);
  pop();
}

function drawSquarePlatform(theta, pulse) {
  push();
  rotateY(theta * 0.16);
  rotateX(0.02 * sin(theta * 2));

  stroke(255, 255, 255, 20);
  strokeWeight(1);
  for (let i = -1; i <= 1; i++) {
    const pos = i * 240;
    line(-360, 170, pos, 360, 170, pos);
    line(pos, 170, -360, pos, 170, 360);
  }

  for (const cell of cellData) {
    const floatY = sin(theta * (MAGIC_SUM / 5) + cell.pulsePhase) * 5;
    const labelLift = cell.value === 5 ? 14 : 0;

    push();
    translate(cell.x, cell.baseY + floatY, cell.z);
    stroke(255, 255, 255, 66 + cell.glowAlpha * 0.2);
    strokeWeight(cell.value === 5 ? 1.8 : 1.3);
    ambientMaterial(18, 18, 18);
    fill(12, 12, 12, 220);
    box(cell.padSize, cell.padHeight, cell.padSize);
    pop();

    push();
    translate(cell.x, cell.baseY - cell.padHeight * 0.5 - 1 + floatY, cell.z);
    rotateX(HALF_PI);
    noStroke();
    texture(labelTextures[cell.value]);
    plane(cell.padSize * cell.labelScale, cell.padSize * cell.labelScale);
    pop();

    push();
    translate(cell.x, cell.baseY + floatY - 16 - labelLift, cell.z);
    noFill();
    stroke(255, 255, 255, 22 + 18 * pulse);
    strokeWeight(1);
    drawSquareLoop(cell.padSize * 0.84, 0);
    pop();
  }

  pop();
}

function drawCellTowers(theta, pulse) {
  for (const cell of cellData) {
    const height = currentTowerHeight(cell, theta);
    const centerY = cell.baseY - cell.padHeight * 0.5 - height * 0.5;
    const topY = centerY - height * 0.5;

    push();
    translate(cell.x, centerY, cell.z);
    rotateY(theta * 0.18 + cell.pulsePhase * 0.2);
    stroke(255, 255, 255, 78 + cell.glowAlpha * 0.3);
    strokeWeight(cell.value === 5 ? 1.9 : 1.2);
    ambientMaterial(30, 30, 30);
    fill(22, 22, 22, 230);
    box(cell.towerWidth, height, cell.towerWidth);

    stroke(255, 255, 255, 28 + cell.glowAlpha * 0.16);
    strokeWeight(1);
    for (let i = 1; i < cell.segments; i++) {
      const y = map(i, 0, cell.segments, -height * 0.5, height * 0.5);
      line(-cell.towerWidth * 0.56, y, -cell.towerWidth * 0.56, cell.towerWidth * 0.56, y, -cell.towerWidth * 0.56);
      line(-cell.towerWidth * 0.56, y, cell.towerWidth * 0.56, cell.towerWidth * 0.56, y, cell.towerWidth * 0.56);
      line(-cell.towerWidth * 0.56, y, -cell.towerWidth * 0.56, -cell.towerWidth * 0.56, y, cell.towerWidth * 0.56);
      line(cell.towerWidth * 0.56, y, -cell.towerWidth * 0.56, cell.towerWidth * 0.56, y, cell.towerWidth * 0.56);
    }
    pop();

    for (let ring = 0; ring < cell.ringCount; ring++) {
      const rise = topY - 22 - ring * 18;
      const loopSize = cell.towerWidth * (1.5 + ring * 0.32) + pulse * 10;
      push();
      translate(cell.x, rise, cell.z);
      rotateY(theta * (0.22 + ring * 0.04) * (ring % 2 === 0 ? 1 : -1));
      noFill();
      stroke(255, 255, 255, 34 + cell.glowAlpha * 0.22 - ring * 5);
      strokeWeight(ring === 0 ? 1.4 : 1);
      drawSquareLoop(loopSize, 0);
      pop();
    }
  }
}

function drawMagicLines(theta, pulse) {
  for (const line of lineData) {
    const points = line.indices.map((index) => getLineAnchor(cellData[index], theta, line));
    const alpha = 34 + pulse * 42 + abs(sin(theta * (MAGIC_SUM / 5) + line.phase)) * 24;

    noFill();
    strokeWeight(4.5);
    stroke(255, 255, 255, alpha * 0.12);
    drawPolyline(points);

    strokeWeight(1.35);
    stroke(255, 255, 255, alpha);
    drawPolyline(points);

    strokeWeight(1);
    stroke(210, 210, 210, alpha * 0.72);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      push();
      translate(p.x, p.y, p.z);
      rotateX(HALF_PI);
      drawSquareLoop(18 + pulse * 6, 0);
      pop();
    }
  }
}

function drawOrbiters(theta, pulse) {
  for (const orbiter of orbiters) {
    const cell = cellData[orbiter.cellIndex];
    const height = currentTowerHeight(cell, theta);
    const angle = orbiter.angleOffset + theta * orbiter.speed + orbiter.phase;
    const ringRadius = orbiter.radius + sin(theta * 2 + orbiter.phase) * 8;
    const y = cell.baseY - cell.padHeight * 0.5 - height * 0.35 - orbiter.heightBias
      + sin(theta * 3 + orbiter.phase) * orbiter.bob;
    const x = cell.x + cos(angle) * ringRadius;
    const z = cell.z + sin(angle) * (ringRadius * 0.86);
    const alpha = cell.value === 5 ? 138 + pulse * 70 : 84 + pulse * 40;

    stroke(255, 255, 255, alpha);
    strokeWeight(orbiter.size);
    point(x, y, z);

    push();
    translate(x, y, z);
    emissiveMaterial(255, 255, 255);
    sphere(orbiter.size * 0.68, 6, 5);
    pop();
  }
}

function drawLineParticles(theta, pulse) {
  for (const particle of lineParticles) {
    const line = lineData[particle.lineIndex];
    const progress = (particle.t + theta * particle.speed / TWO_PI + 0.5 + 0.5 * sin(theta + particle.phase)) % 1;
    const pointOnLine = samplePolyline(line.indices.map((index) => getLineAnchor(cellData[index], theta, line)), progress);
    const alpha = 90 + pulse * 80;

    stroke(255, 255, 255, alpha);
    strokeWeight(particle.size);
    point(pointOnLine.x, pointOnLine.y, pointOnLine.z);
  }
}

function drawAmbientDust(theta) {
  for (const mote of ambientDust) {
    const angle = mote.angle + theta * mote.speed;
    const radius = mote.radius + sin(theta * 2 + mote.angle) * mote.drift;
    const x = cos(angle) * radius;
    const y = mote.y + sin(theta * 2.4 + mote.angle) * 22;
    const z = sin(angle) * radius;
    stroke(255, 255, 255, mote.alpha);
    strokeWeight(mote.size);
    point(x, y, z);
  }
}

function drawHud(theta, pulse) {
  disableDepthTest();
  push();
  resetMatrix();
  translate(-W * 0.5, -H * 0.5);
  image(overlayLayer, 0, 0, W, H);

  noStroke();
  fill(255, 255, 255, 120);
  textAlign(LEFT, TOP);
  textSize(18);
  text("LO SHU MAGIC SQUARE", 34, H - 116);

  fill(210, 210, 210, 84);
  textSize(13);
  text("Lo Shu 3x3  |  rows / columns / diagonals = 15", 34, H - 86);

  fill(255, 255, 255, 64 + 28 * pulse);
  text("1080 x 1920  |  WEBGL  |  MP4", 34, H - 64);

  fill(160, 160, 160, 82 + 24 * abs(sin(theta * 2)));
  text("black / white  |  center = 5  |  sum = " + MAGIC_SUM, 34, H - 42);
  pop();
  enableDepthTest();
}

function currentTowerHeight(cell, theta) {
  return cell.towerHeight * (0.92 + 0.08 * sin(theta * (MAGIC_SUM / 5) + cell.pulsePhase));
}

function getLineAnchor(cell, theta, line) {
  const towerHeight = currentTowerHeight(cell, theta);
  return {
    x: cell.x,
    y: cell.baseY - cell.padHeight * 0.5 - towerHeight - line.lift - sin(theta * 2 + cell.pulsePhase + line.phase) * 10,
    z: cell.z,
  };
}

function drawPolyline(points) {
  beginShape();
  for (const pointData of points) {
    vertex(pointData.x, pointData.y, pointData.z);
  }
  endShape();
}

function samplePolyline(points, t) {
  if (points.length === 1) return points[0];
  const scaled = constrain(t, 0, 0.999999) * (points.length - 1);
  const index = floor(scaled);
  const amt = scaled - index;
  const a = points[index];
  const b = points[index + 1];
  return {
    x: lerp(a.x, b.x, amt),
    y: lerp(a.y, b.y, amt),
    z: lerp(a.z, b.z, amt),
  };
}

function drawSquareLoop(size, y) {
  beginShape();
  vertex(-size * 0.5, y, -size * 0.5);
  vertex(size * 0.5, y, -size * 0.5);
  vertex(size * 0.5, y, size * 0.5);
  vertex(-size * 0.5, y, size * 0.5);
  endShape(CLOSE);
}

function drawWireCube(widthValue, heightValue, depthValue) {
  const x = widthValue * 0.5;
  const y = heightValue * 0.5;
  const z = depthValue * 0.5;

  line(-x, -y, -z, x, -y, -z);
  line(x, -y, -z, x, -y, z);
  line(x, -y, z, -x, -y, z);
  line(-x, -y, z, -x, -y, -z);

  line(-x, y, -z, x, y, -z);
  line(x, y, -z, x, y, z);
  line(x, y, z, -x, y, z);
  line(-x, y, z, -x, y, -z);

  line(-x, -y, -z, -x, y, -z);
  line(x, -y, -z, x, y, -z);
  line(x, -y, z, x, y, z);
  line(-x, -y, z, -x, y, z);
}

function disableDepthTest() {
  const gl = drawingContext;
  if (gl && typeof gl.disable === "function" && gl.DEPTH_TEST !== undefined) {
    gl.disable(gl.DEPTH_TEST);
  }
}

function enableDepthTest() {
  const gl = drawingContext;
  if (gl && typeof gl.enable === "function" && gl.DEPTH_TEST !== undefined) {
    gl.enable(gl.DEPTH_TEST);
  }
}

function rgba(rgb, alpha) {
  return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
}

function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

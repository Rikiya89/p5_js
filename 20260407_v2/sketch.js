'use strict';

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const TILE_COUNT_X = 10;
const TILE_COUNT_Y = 10;
const LOOP_SECONDS = 12;
const LOOP_FRAMES = FPS * LOOP_SECONDS;
const MIN_CIRCLES = 5;
const MAX_CIRCLES = 24;
const PAPER_DOTS = 18000;
const PAPER_FIBERS = 260;

let tileWidth = 0;
let tileHeight = 0;

let circleCount = 0;
let endSize = 0;
let endOffset = 0;

let actRandomSeed = 0;
let modules = [];
let paperLayer = null;

let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;
let canvasEl = null;

function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  tileWidth = width / TILE_COUNT_X;
  tileHeight = height / TILE_COUNT_Y;

  paperLayer = createGraphics(W, H);
  paperLayer.pixelDensity(1);

  resetScene();
  updateCanvasInfo();

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
}

function resetScene() {
  reseedPattern(floor(random(100000)));
  background(255);
}

function reseedPattern(seed) {
  actRandomSeed = seed;
  randomSeed(actRandomSeed);
  noiseSeed(actRandomSeed);

  modules = [];
  for (let gridY = 0; gridY <= TILE_COUNT_Y; gridY++) {
    for (let gridX = 0; gridX <= TILE_COUNT_X; gridX++) {
      modules.push({
        turn: floor(random(4)),
        phase: random(TWO_PI),
        sway: random(0.7, 1.5),
        weightBias: random(0.85, 1.2),
        mirror: random() > 0.5 ? -1 : 1,
        offsetBias: random(-0.16, 0.18),
        ghostGap: random(0.12, 0.3),
        pulse: random(0.85, 1.4),
      });
    }
  }

  renderPaperTexture();
}

function draw() {
  background(255, 255, 255, 52);

  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const loopAngle = loop * TWO_PI;
  const autoX = map(sin(loopAngle), -1, 1, 0.12, 0.96);
  const autoY = map(cos(loopAngle * 1.5 - PI * 0.25), -1, 1, 0.08, 0.95);

  const mouseActive = mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
  const pointerX = mouseActive ? constrain(mouseX / width, 0, 1) : autoX;
  const pointerY = mouseActive ? constrain(mouseY / height, 0, 1) : autoY;
  const controlX = mouseActive ? lerp(autoX, pointerX, 0.35) : autoX;
  const controlY = mouseActive ? lerp(autoY, pointerY, 0.35) : autoY;

  circleCount = floor(lerp(MIN_CIRCLES, MAX_CIRCLES, controlX));
  endSize = lerp(tileWidth * 0.5, tileWidth * 0.06, controlX);
  endOffset = lerp(0, (tileWidth - endSize) * 0.5, controlY);

  push();
  translate(
    width * 0.5 + sin(loopAngle - PI * 0.35) * tileWidth * 0.14,
    height * 0.5 + cos(loopAngle * 0.65 - PI * 0.2) * tileHeight * 0.1
  );
  scale(0.935 + sin(loopAngle * 2.0) * 0.012);
  translate(-width * 0.5 + tileWidth / 2, -height * 0.5 + tileHeight / 2);

  let index = 0;
  for (let gridY = 0; gridY <= TILE_COUNT_Y; gridY++) {
    for (let gridX = 0; gridX <= TILE_COUNT_X; gridX++) {
      drawTile(gridX, gridY, index, loopAngle, controlY);
      index++;
    }
  }
  pop();

  tint(255, 92);
  image(paperLayer, 0, 0);
  noTint();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function drawTile(gridX, gridY, index, loopAngle, controlY) {
  const module = modules[index];
  const centerX = tileWidth * gridX;
  const centerY = tileHeight * gridY;
  const distanceToCenter = dist(gridX, gridY, TILE_COUNT_X * 0.5, TILE_COUNT_Y * 0.5);
  const maxDistance = dist(0, 0, TILE_COUNT_X * 0.5, TILE_COUNT_Y * 0.5);
  const distanceRatio = constrain(distanceToCenter / maxDistance, 0, 1);
  const focus = pow(1 - distanceRatio, 1.4);
  const wave = sin(loopAngle * 2.0 - distanceToCenter * 0.68 + module.phase);
  const ripple = cos(loopAngle * module.sway + (gridX - gridY) * 0.45 + module.phase);
  const shimmer = sin(loopAngle * module.pulse - distanceRatio * 3.4 + module.phase);

  const localCount = max(4, floor(circleCount + wave * 4 + focus * 4));
  const localEndSize = constrain(
    endSize + map(wave, -1, 1, tileWidth * 0.18, -tileWidth * 0.14) + focus * tileWidth * 0.08,
    tileWidth * 0.04,
    tileWidth * 0.92
  );
  const localMaxOffset = max(0, (tileWidth - localEndSize) * 0.5);
  const localEndOffset = constrain(
    endOffset + map(ripple, -1, 1, -tileWidth * 0.08, tileWidth * 0.18) + module.offsetBias * tileWidth,
    0,
    localMaxOffset
  );

  const swing = sin(loopAngle + module.phase + distanceToCenter * 0.3) * (PI / 13);
  const stretch = (tileHeight / tileWidth) * (1 + ripple * 0.1 + focus * 0.05);
  const breathing = 1 + shimmer * 0.045;
  const driftX = sin(loopAngle * 0.8 + module.phase) * tileWidth * 0.045 * (0.25 + focus);
  const driftY = cos(loopAngle * 0.9 - module.phase) * tileHeight * 0.022 * (0.2 + focus);

  push();
  translate(centerX + driftX, centerY + driftY);
  rotate(module.turn * HALF_PI + swing);
  scale(module.mirror * breathing, stretch / breathing);
  drawModule(
    localCount,
    localEndSize,
    localEndOffset,
    wave,
    ripple,
    shimmer,
    controlY,
    focus,
    module.weightBias,
    module.ghostGap
  );
  pop();
}

function drawModule(localCount, localEndSize, localEndOffset, wave, ripple, shimmer, controlY, focus, weightBias, ghostGap) {
  const depthShift = map(controlY, 0, 1, -tileWidth * 0.04, tileWidth * 0.04);
  const ghostShift = tileWidth * ghostGap;

  for (let i = 0; i < localCount; i++) {
    const progress = localCount === 1 ? 0 : i / (localCount - 1);
    const diameter = lerp(tileWidth, localEndSize, progress);
    const offset = lerp(0, localEndOffset, progress);
    const drift = sin(progress * TWO_PI + wave * 1.2 + ripple) * tileWidth * 0.03;
    const y = depthShift + drift;
    const alpha = lerp(210, 24, progress) * lerp(0.72, 1.1, focus);
    const echoAlpha = alpha * lerp(0.12, 0.34, 1 - progress);
    const innerScale = 1 - 0.08 * sin(progress * PI + shimmer);

    strokeWeight(lerp(6.2, 0.9, progress) * weightBias);
    stroke(255, 180);
    ellipse(offset + ghostShift * 0.3, y + ghostShift * 0.14, diameter * 1.015, diameter * 1.015);

    strokeWeight(lerp(3.6, 0.7, progress) * weightBias);
    stroke(0, echoAlpha);
    ellipse(offset + ghostShift, y + ghostShift * 0.1, diameter, diameter);

    strokeWeight(lerp(2.1, 0.35, progress) * weightBias);
    stroke(0, alpha);
    ellipse(offset, y, diameter, diameter);

    if (i % 2 === 0) {
      strokeWeight(0.75 * weightBias);
      stroke(0, alpha * 0.18);
      ellipse(offset * 0.74, -y * 0.35, diameter * 0.86 * innerScale, diameter * 0.86 * innerScale);
    }
  }
}

function renderPaperTexture() {
  if (!paperLayer) return;

  paperLayer.clear();
  paperLayer.background(255, 0);
  paperLayer.noStroke();

  for (let i = 0; i < PAPER_DOTS; i++) {
    const shade = random() > 0.18 ? 0 : 255;
    const alpha = shade === 0 ? random(4, 12) : random(4, 10);
    paperLayer.fill(shade, alpha);
    paperLayer.circle(random(W), random(H), random(0.35, 1.8));
  }

  paperLayer.stroke(0, 8);
  for (let i = 0; i < PAPER_FIBERS; i++) {
    const x = random(W);
    const y = random(H);
    const len = random(18, 140);
    paperLayer.line(x, y, x + random(-8, 8), y + len);
  }
}

function mousePressed() {
  resetScene();
}

function keyReleased() {
  if (key === 'r' || key === 'R') {
    isRecording ? stopRecording() : startRecording();
    return false;
  }

  if (key === 's' || key === 'S') {
    saveCanvas('20260407_v2_' + timestampString(), 'png');
    return false;
  }

  if (keyCode === DELETE || keyCode === BACKSPACE) {
    resetScene();
    return false;
  }

  return true;
}

function timestampString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('WebCodecs not supported. Use Chrome or Edge.');
    return;
  }

  if (typeof Mp4Muxer === 'undefined') {
    alert('mp4-muxer failed to load.');
    return;
  }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => {
      console.error(err);
      isRecording = false;
      setStatus('Encoder error', '#f44');
    },
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W,
    height: H,
    bitrate: 18_000_000,
    framerate: FPS,
  });

  recFrameCount = 0;
  isRecording = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  setStatus('Recording…', '#fff');
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
  a.download = 'p_2_2_2_01_20260407.mp4';
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
    timestamp: recFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
}

function updateRecordingUI() {
  const dEl = document.getElementById('duration');
  const fEl = document.getElementById('frameCount');
  if (dEl) dEl.textContent = (recFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recFrameCount;
}

function updateCanvasInfo() {
  const el = document.getElementById('canvasSize');
  if (el) el.textContent = W + ' × ' + H;
}

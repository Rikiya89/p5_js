'use strict';

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const LOOP_SECONDS = 32;
const LOOP_FRAMES = FPS * LOOP_SECONDS;

const POINT_COUNT = 1000;
const PAPER_DOTS = 16000;
const PAPER_FIBERS = 180;

let lissajousPoints = [];

let freqX = 4;
let freqY = 7;
let phi = 15;
let modFreqX = 3;
let modFreqY = 2;

let lineWeight = 0.2;
let lineAlpha = 96;
let connectionRadius = 112;
let connectionRamp = 6;

let motionSeed = 0;
let motionPhaseA = 0;
let motionPhaseB = 0;
let motionPhaseC = 0;
let motionPhaseD = 0;
let motionPhaseE = 0;
let motionPhaseF = 0;

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

  paperLayer = createGraphics(W, H);
  paperLayer.pixelDensity(1);
  paperLayer.colorMode(RGB, 255, 255, 255, 255);

  for (let i = 0; i <= POINT_COUNT; i++) {
    lissajousPoints.push(createVector());
  }

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
  motionSeed = seed;
  randomSeed(motionSeed);
  noiseSeed(motionSeed);

  motionPhaseA = random(TWO_PI);
  motionPhaseB = random(TWO_PI);
  motionPhaseC = random(TWO_PI);
  motionPhaseD = random(TWO_PI);
  motionPhaseE = random(TWO_PI);
  motionPhaseF = random(TWO_PI);

  renderPaperTexture();
}

function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const loopAngle = loop * TWO_PI;

  const autoX = map(sin(loopAngle * 0.32 + motionPhaseA), -1, 1, 0.28, 0.72);
  const autoY = map(cos(loopAngle * 0.42 + motionPhaseB), -1, 1, 0.24, 0.76);

  const mouseActive = mouseX >= 0 && mouseX <= width && mouseY >= 0 && mouseY <= height;
  const pointerX = mouseActive ? constrain(mouseX / width, 0, 1) : autoX;
  const pointerY = mouseActive ? constrain(mouseY / height, 0, 1) : autoY;
  const controlX = mouseActive ? lerp(autoX, pointerX, 0.22) : autoX;
  const controlY = mouseActive ? lerp(autoY, pointerY, 0.22) : autoY;

  background(255, 18);

  calculateLissajousPoints(loopAngle, controlX, controlY);

  push();
  translate(
    width * 0.5 + sin(loopAngle * 0.2 + motionPhaseC) * width * 0.012,
    height * 0.5 + cos(loopAngle * 0.24 + motionPhaseD) * height * 0.009
  );
  rotate(sin(loopAngle * 0.22 + motionPhaseE) * 0.045 + map(controlX, 0, 1, -0.02, 0.02));
  scale(0.975 + sin(loopAngle * 0.9 + motionPhaseF) * 0.007);

  drawLissajousNetwork(loopAngle, controlX, controlY);
  drawOrbiters(loopAngle, controlX, controlY);
  drawContour(loopAngle);
  pop();

  tint(255, 86);
  image(paperLayer, 0, 0);
  noTint();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function calculateLissajousPoints(loopAngle, controlX, controlY) {
  const animatedFreqX = freqX + sin(loopAngle * 0.34 + motionPhaseA) * 0.22 + map(controlX, 0, 1, -0.1, 0.14);
  const animatedFreqY = freqY + cos(loopAngle * 0.4 + motionPhaseB) * 0.24 + map(controlX, 0, 1, 0.12, -0.08);
  const animatedPhi = phi + sin(loopAngle * 0.72 + motionPhaseC) * 22 + map(controlY, 0, 1, -10, 10);
  const animatedModFreqX = modFreqX + sin(loopAngle * 0.28 + motionPhaseD) * 0.28;
  const animatedModFreqY = modFreqY + cos(loopAngle * 0.3 + motionPhaseE) * 0.24;

  const radiusX = width * 0.34;
  const radiusY = height * 0.37;
  const ribbonAmount = lerp(0.008, 0.016, controlY);

  for (let i = 0; i <= POINT_COUNT; i++) {
    const angle = map(i, 0, POINT_COUNT, 0, TAU);

    let x = sin(angle * animatedFreqX + radians(animatedPhi)) * cos(angle * animatedModFreqX + loopAngle * 0.12);
    let y = sin(angle * animatedFreqY + loopAngle * 0.08) * cos(angle * animatedModFreqY - loopAngle * 0.16);

    const radialPulse = 1 + sin(angle * 3.0 - loopAngle * 0.7 + motionPhaseF) * 0.05;
    const verticalPulse = 1 + cos(angle * 4.0 + loopAngle * 0.54 + motionPhaseA) * 0.045;
    const ribbonX = sin(angle * 7.0 - loopAngle * 0.62 + motionPhaseB) * width * ribbonAmount;
    const ribbonY = cos(angle * 5.0 + loopAngle * 0.7 + motionPhaseD) * height * ribbonAmount * 0.42;

    x *= radiusX * radialPulse;
    y *= radiusY * verticalPulse;

    x += ribbonX;
    y += ribbonY;

    lissajousPoints[i].set(x, y);
  }
}

function drawLissajousNetwork(loopAngle, controlX, controlY) {
  const dynamicRadius = connectionRadius * lerp(0.94, 1.08, 0.5 + 0.5 * sin(loopAngle * 0.42 + motionPhaseA));
  const radiusSq = dynamicRadius * dynamicRadius;
  const dynamicRamp = connectionRamp + sin(loopAngle * 0.34 + motionPhaseB) * 0.28;
  const dynamicAlpha = lineAlpha * lerp(0.96, 1.18, controlY);
  const cellSize = max(24, dynamicRadius * 0.95);
  const buckets = new Map();

  strokeWeight(lineWeight + lerp(0.04, 0.14, controlX));

  for (let i = 0; i <= POINT_COUNT; i++) {
    const pointA = lissajousPoints[i];
    const gridX = floor((pointA.x + width * 0.5) / cellSize);
    const gridY = floor((pointA.y + height * 0.5) / cellSize);

    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const key = `${gridX + offsetX},${gridY + offsetY}`;
        const bucket = buckets.get(key);
        if (!bucket) continue;

        for (const indexB of bucket) {
          const pointB = lissajousPoints[indexB];
          const dx = pointA.x - pointB.x;
          const dy = pointA.y - pointB.y;
          const distanceSq = dx * dx + dy * dy;

          if (distanceSq === 0 || distanceSq > radiusSq) continue;

          const distance = sqrt(distanceSq);
          const closeness = pow(1 / (distance / dynamicRadius + 1), dynamicRamp);
          const sequenceGap = abs(i - indexB) / POINT_COUNT;
          const thread = pow(1 - sequenceGap, 0.9);
          const flicker = 0.88 + 0.12 * sin(loopAngle * 0.9 + (i + indexB) * 0.017 + motionPhaseC);
          const alpha = closeness * thread * flicker * dynamicAlpha;

          if (alpha < 1.2) continue;

          stroke(0, alpha);
          line(pointA.x, pointA.y, pointB.x, pointB.y);
        }
      }
    }

    const ownKey = `${gridX},${gridY}`;
    if (!buckets.has(ownKey)) buckets.set(ownKey, []);
    buckets.get(ownKey).push(i);
  }
}

function drawOrbiters(loopAngle, controlX, controlY) {
  const orbiterCount = 6;

  for (let i = 0; i < orbiterCount; i++) {
    const travel = (frameCount * (0.0007 + i * 0.00012) + i / orbiterCount) % 1;
    const index = floor(travel * POINT_COUNT);
    const point = lissajousPoints[index];
    const pulse = 0.5 + 0.5 * sin(loopAngle * 1.5 - i * 0.9 + motionPhaseE);
    const ringSize = lerp(10, 40, pulse) * lerp(0.84, 1.08, controlY);

    noFill();
    strokeWeight(lerp(0.8, 1.9, pulse));
    stroke(0, lerp(36, 132, pulse));
    circle(point.x, point.y, ringSize);

    strokeWeight(0.8);
    stroke(0, 44);
    circle(point.x, point.y, ringSize * 1.65);

    fill(0, lerp(120, 220, pulse));
    noStroke();
    circle(point.x, point.y, lerp(2.5, 7.2, controlX));
  }

  noFill();
}

function drawContour(loopAngle) {
  push();
  noFill();
  stroke(0, 56);
  strokeWeight(0.9);
  drawingContext.setLineDash([10, 18]);
  drawingContext.lineDashOffset = -frameCount * 0.6;
  beginShape();
  for (let i = 0; i <= POINT_COUNT; i += 2) {
    vertex(lissajousPoints[i].x, lissajousPoints[i].y);
  }
  endShape(CLOSE);
  drawingContext.setLineDash([]);
  pop();
}

function renderPaperTexture() {
  if (!paperLayer) return;

  paperLayer.clear();
  paperLayer.background(255, 0);
  paperLayer.noStroke();

  for (let i = 0; i < PAPER_DOTS; i++) {
    const shade = random() > 0.12 ? 0 : 255;
    const alpha = shade === 0 ? random(3, 12) : random(2, 8);
    paperLayer.fill(shade, alpha);
    paperLayer.circle(random(W), random(H), random(0.35, 1.8));
  }

  paperLayer.stroke(0, 7);
  for (let i = 0; i < PAPER_FIBERS; i++) {
    const x = random(W);
    const y = random(H);
    const len = random(22, 160);
    paperLayer.line(x, y, x + random(-9, 9), y + len);
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
    saveCanvas('20260407_v3_' + timestampString(), 'png');
    return false;
  }

  if (keyCode === DELETE || keyCode === BACKSPACE) {
    resetScene();
    return false;
  }

  let changed = false;

  if (key === '1') {
    freqX = max(freqX - 1, 1);
    changed = true;
  }
  if (key === '2') {
    freqX++;
    changed = true;
  }

  if (key === '3') {
    freqY = max(freqY - 1, 1);
    changed = true;
  }
  if (key === '4') {
    freqY++;
    changed = true;
  }

  if (keyCode === LEFT_ARROW) {
    phi -= 15;
    changed = true;
  }
  if (keyCode === RIGHT_ARROW) {
    phi += 15;
    changed = true;
  }

  if (key === '7') {
    modFreqX = max(modFreqX - 1, 1);
    changed = true;
  }
  if (key === '8') {
    modFreqX++;
    changed = true;
  }

  if (key === '9') {
    modFreqY = max(modFreqY - 1, 1);
    changed = true;
  }
  if (key === '0') {
    modFreqY++;
    changed = true;
  }

  if (changed) {
    background(255);
    console.log(
      'freqX: ' + freqX +
      ', freqY: ' + freqY +
      ', phi: ' + phi +
      ', modFreqX: ' + modFreqX +
      ', modFreqY: ' + modFreqY
    );
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

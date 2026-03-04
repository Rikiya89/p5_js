"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

const BG = [10, 15, 13];
const ABYSS = [13, 33, 55];
const NAVY = [26, 26, 46];
const BIO = [13, 59, 46];
const MINT = [0, 255, 135];
const CYAN = [0, 212, 255];
const VIO = [123, 47, 255];
const MAG = [255, 45, 122];
const ECHO = [176, 255, 232];
const ICE = [224, 247, 255];

const PALETTE = [MINT, CYAN, VIO, MAG, ECHO, ICE];
const EXPONENTS = [2, 3, 5, 7, 13, 17, 19, 31];
const MERSENNES = EXPONENTS.map((p) => 2 ** p - 1);

let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;

let fc = 0;
let bgLayer = null;
let overlayLayer = null;
let shells = [];
let towers = [];
let haloPoints = [];

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
      setStatus("Encoder error", "#ff2d7a");
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
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  setStatus("Recording MP4...", "#00ff87");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;

  isRecording = false;
  setStatus("Finalizing...", "#b0ffe8");
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mersenne_bloom_20260304.mp4";
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;

  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("Complete", "#00ff87");
  setTimeout(() => setStatus("Ready", "#b0ffe8"), 3000);
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

function setup() {
  pixelDensity(1);
  setAttributes("antialias", true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  textFont("monospace");

  buildScene();
  buildBackdrop();
  buildOverlay();

  const maxDurationEl = document.getElementById("maxDuration");
  if (maxDurationEl) maxDurationEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function draw() {
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const theta = loopT * TWO_PI;
  const pulse = 0.5 + 0.5 * sin(theta * 3);
  const surge = 0.5 + 0.5 * cos(theta * 5);

  background(...BG);
  drawBackdrop();
  setSceneCamera(theta);
  setSceneLights(theta, pulse);

  drawMonolithRing(theta);
  drawCore(theta, pulse, surge);

  noLights();
  blendMode(ADD);
  drawHaloField(theta);
  drawShells(theta);
  blendMode(BLEND);
  drawBitCrowns(theta);

  drawHud(theta);

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
  shells = EXPONENTS.map((exp, index) => {
    const value = MERSENNES[index];
    const colorA = PALETTE[index % PALETTE.length];
    const colorB = PALETTE[(index + 2) % PALETTE.length];
    return {
      exp,
      value,
      index,
      radius: 148 + index * 56,
      yScale: 0.28 + index * 0.05,
      tube: 22 + (value % 13) * 1.35,
      waveAmp: 14 + exp * 1.65,
      depthAmp: 28 + exp * 2.25,
      band: 2 + (exp % 5),
      twist: 3 + (value % 7),
      waveFreq: 1 + (index % 3),
      ridgeFreq: 2 + (index % 4),
      liftFreq: 1 + (exp % 4),
      pulseFreq: 2 + (index % 3),
      tiltFreq: 1 + (index % 4),
      spinY: 1 + (index % 3),
      spinZ: 1 + ((index + 1) % 2),
      orbitFreq: 2 + (index % 4),
      spokeCount: 10 + exp,
      orbiters: 3 + (exp % 6),
      phase: ((value % 541) / 541) * TWO_PI,
      tiltX: -0.6 + index * 0.14,
      tiltZ: -0.18 + index * 0.05,
      colorA,
      colorB,
      glow: mixRgb(colorA, colorB, 0.5),
    };
  });

  towers = shells.map((shell, index) => ({
    exp: shell.exp,
    phase: shell.phase,
    angle: map(index, 0, shells.length - 1, -PI * 0.88, PI * 0.88),
    orbitRadius: 320 + index * 38,
    height: 180 + shell.exp * 10,
    width: 34 + index * 6,
    depth: 18 + (shell.value % 11),
    strata: 4 + floor(shell.exp / 4),
    color: shell.colorA,
    accent: shell.colorB,
    edge: mixRgb(shell.colorB, ICE, 0.4),
    sway: 20 + index * 6,
    swayFreq: 2 + (shell.exp % 4),
    spin: (index % 2 === 0 ? 1 : -1) * (1 + (index % 3)),
  }));

  haloPoints = [];
  const rng = makeRng(20260304);
  const haloCount = 420;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < haloCount; i++) {
    const shell = shells[i % shells.length];
    const y = 1 - (i / (haloCount - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = goldenAngle * i + shell.phase;
    haloPoints.push({
      x: Math.cos(a) * r,
      y,
      z: Math.sin(a) * r,
      shellIndex: i % shells.length,
      phase: ((shell.value + i * 37) % 997) / 997 * TWO_PI,
      size: 1.1 + rng() * 1.7,
    });
  }
}

function buildBackdrop() {
  bgLayer = createGraphics(W, H);
  bgLayer.pixelDensity(1);
  bgLayer.background(...BG);
  bgLayer.noStroke();
  const rng = makeRng(202603041);

  const ctx = bgLayer.drawingContext;
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0.0, rgba(ABYSS, 0.98));
  wash.addColorStop(0.26, rgba(NAVY, 0.88));
  wash.addColorStop(0.62, rgba(BIO, 0.54));
  wash.addColorStop(1.0, rgba(BG, 1.0));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  const bloom = ctx.createRadialGradient(W * 0.5, H * 0.44, 60, W * 0.5, H * 0.48, H * 0.62);
  bloom.addColorStop(0.0, rgba(BIO, 0.36));
  bloom.addColorStop(0.28, rgba(ABYSS, 0.18));
  bloom.addColorStop(0.62, rgba(NAVY, 0.14));
  bloom.addColorStop(1.0, rgba(BG, 0.0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  for (let y = 0; y < H; y += 8) {
    bgLayer.stroke(176, 255, 232, y % 24 === 0 ? 5 : 2);
    bgLayer.strokeWeight(1);
    bgLayer.line(0, y, W, y);
  }

  for (let i = 0; i < 28; i++) {
    const x = randomRange(rng, 0, W);
    const width = randomRange(rng, 18, 88);
    const beam = ctx.createLinearGradient(x, 0, x + width, 0);
    beam.addColorStop(0.0, "rgba(0,0,0,0)");
    beam.addColorStop(0.5, rgba(PALETTE[i % PALETTE.length], 0.05));
    beam.addColorStop(1.0, "rgba(0,0,0,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(x, 0, width, H);
  }

  bgLayer.noStroke();
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const col = mixRgb(NAVY, BIO, t);
    bgLayer.fill(...col, 22 - i * 2);
    bgLayer.ellipse(
      W * 0.5 + cos(t * TWO_PI) * W * 0.05,
      H * (0.47 + t * 0.05),
      W * (0.94 - t * 0.12),
      H * (0.28 + t * 0.04)
    );
  }

  for (let i = 0; i < 520; i++) {
    const x = randomRange(rng, 0, W);
    const y = Math.pow(rng(), 0.82) * H;
    const col = PALETTE[(i + Math.floor(rng() * 3)) % PALETTE.length];
    const alpha = 6 + rng() * 18;
    const size = rng() < 0.08 ? 3.8 : 1.5;
    bgLayer.fill(...col, alpha);
    bgLayer.circle(x, y, size);
    if (rng() < 0.15) {
      bgLayer.fill(...col, alpha * 0.22);
      bgLayer.circle(x, y, size * 3.5);
    }
  }
}

function buildOverlay() {
  overlayLayer = createGraphics(W, H);
  overlayLayer.pixelDensity(1);
  overlayLayer.clear();

  const ctx = overlayLayer.drawingContext;
  const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.16, W * 0.5, H * 0.5, H * 0.82);
  vignette.addColorStop(0.0, "rgba(10,15,13,0)");
  vignette.addColorStop(0.72, "rgba(10,15,13,0.12)");
  vignette.addColorStop(1.0, "rgba(10,15,13,0.74)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  const rng = makeRng(31042026);
  overlayLayer.strokeWeight(1);
  for (let y = 0; y < H; y += 3) {
    overlayLayer.stroke(224, 247, 255, y % 9 === 0 ? 5 : 2);
    overlayLayer.line(0, y, W, y);
  }

  overlayLayer.noStroke();
  for (let i = 0; i < 2800; i++) {
    overlayLayer.fill(224, 247, 255, rng() * 12);
    overlayLayer.rect(rng() * W, rng() * H, 1, 1);
  }

  overlayLayer.noFill();
  overlayLayer.stroke(...ECHO, 24);
  overlayLayer.strokeWeight(2);
  overlayLayer.rect(22, 22, W - 44, H - 44, 18);
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
  perspective(PI / 3.15, W / H, 20, 6000);
  const camX = sin(theta) * 160;
  const camY = -90 + sin(theta * 2) * 110;
  const camZ = 1400 + cos(theta) * 80;
  camera(camX, camY, camZ, 0, -40, 0, 0, 1, 0);
}

function setSceneLights(theta, pulse) {
  ambientLight(16, 28, 24);
  directionalLight(224, 247, 255, -0.14, 0.18, -1);
  directionalLight(13, 59, 46, 0.24, -0.72, -0.4);
  pointLight(0, 212, 255, 420 * sin(theta * 2), -320 + 90 * sin(theta * 3), 640 * cos(theta * 2));
  pointLight(255, 45, 122, -520 * cos(theta * 3), 260 * sin(theta * 2), 420 * sin(theta * 3));
  pointLight(0, 255, 135, 0, -440, 280 + 160 * pulse);
}

function drawMonolithRing(theta) {
  for (const tower of towers) {
    const orbitRadius = tower.orbitRadius + tower.sway * sin(theta * tower.swayFreq + tower.phase);
    const angle = tower.angle + theta * tower.spin;
    const x = cos(angle) * orbitRadius;
    const z = sin(angle) * orbitRadius;
    const sliceH = tower.height / tower.strata;

    push();
    translate(x, 20 * sin(theta * 2 + tower.phase), z);
    rotateY(-angle + HALF_PI + theta);
    rotateX(0.08 * sin(theta * 4 + tower.phase));

    for (let i = 0; i < tower.strata; i++) {
      const y = map(i, 0, tower.strata - 1, -tower.height * 0.5, tower.height * 0.5);
      const breathe = 0.78 + 0.22 * sin(theta * (tower.exp % 7 + 1) + i * 0.8 + tower.phase);
      const width = tower.width * (0.84 + 0.18 * sin(theta * 2 + i + tower.phase));
      push();
      translate(0, y, 0);
      stroke(...tower.edge, 68);
      strokeWeight(1);
      ambientMaterial(...mixRgb(tower.color, tower.accent, 0.22 + 0.18 * breathe));
      box(width, sliceH * breathe, tower.depth);
      pop();
    }

    noFill();
    stroke(...tower.accent, 50);
    strokeWeight(1.1);
    drawCircle3D(0, -tower.height * 0.56, 0, tower.width * 0.9, 38);
    drawCircle3D(0, tower.height * 0.56, 0, tower.width * 0.9, 38);
    pop();
  }
}

function drawCore(theta, pulse, surge) {
  push();
  translate(0, -28 * sin(theta * 2), 0);
  rotateY(theta * 3);
  rotateX(0.45 + theta * 2);
  rotateZ(theta);

  push();
  stroke(...ECHO, 58);
  strokeWeight(1.2);
  ambientMaterial(...mixRgb(BIO, ABYSS, 0.55));
  sphere(92 + 18 * pulse, 20, 14);
  pop();

  noFill();
  strokeWeight(1.6);
  stroke(...MINT, 108);
  drawCircle3D(0, 0, 0, 152 + 10 * sin(theta * 2), 96);
  rotateX(HALF_PI);
  stroke(...CYAN, 82);
  drawCircle3D(0, 0, 0, 192 + 16 * surge, 96);
  rotateY(HALF_PI);
  stroke(...MAG, 74);
  drawCircle3D(0, 0, 0, 224 + 18 * pulse, 96);
  pop();

  push();
  noFill();
  rotateY(-theta * 2);
  rotateX(HALF_PI * 0.8);
  strokeWeight(1.1);
  for (let i = 0; i < 3; i++) {
    const r = 120 + i * 42 + 14 * sin(theta * (i + 2) + i);
    stroke(...mixRgb(VIO, CYAN, i / 2), 34 + i * 20);
    drawCircle3D(0, 0, 0, r, 72);
  }
  pop();
}

function drawHaloField(theta) {
  for (const pointData of haloPoints) {
    const shell = shells[pointData.shellIndex];
    const blink = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * sin(theta * shell.exp + pointData.phase), 2);
    const radius = 760 + shell.radius * 0.55 + 28 * sin(theta * shell.orbitFreq + pointData.phase);
    stroke(...mixRgb(shell.colorA, shell.colorB, blink * 0.5), 18 + 76 * blink);
    strokeWeight(pointData.size);
    point(pointData.x * radius, pointData.y * radius * 1.25, pointData.z * radius);
  }
}

function drawShells(theta) {
  noFill();
  for (const shell of shells) {
    push();
    rotateX(shell.tiltX + 0.18 * sin(theta * shell.tiltFreq + shell.phase));
    rotateY(theta * shell.spinY + shell.phase);
    rotateZ(shell.tiltZ + theta * shell.spinZ);

    strokeWeight(1.35);
    stroke(...shell.glow, 52);
    drawShellRibbon(shell, theta, 0.0, 1.0);

    strokeWeight(1.05);
    stroke(...shell.colorB, 94);
    drawShellRibbon(shell, theta, PI / shell.exp, 0.56);

    strokeWeight(0.82);
    stroke(...shell.colorA, 42);
    drawShellSpokes(shell, theta);

    for (let i = 0; i < shell.orbiters; i++) {
      const u = theta * shell.orbitFreq + i * TWO_PI / shell.orbiters + shell.phase;
      const p = evalRibbonPoint(shell, u, theta, PI / shell.exp, 0.56);
      push();
      translate(p.x, p.y, p.z);
      emissiveMaterial(...mixRgb(shell.colorB, ICE, 0.24));
      sphere(5.5 + 1.5 * sin(theta * 6 + i), 7, 5);
      pop();
    }
    pop();
  }
}

function drawShellRibbon(shell, theta, phaseOffset, ampScale) {
  beginShape();
  const steps = 220;
  for (let i = 0; i <= steps; i++) {
    const u = i / steps * TWO_PI;
    const p = evalRibbonPoint(shell, u, theta, phaseOffset, ampScale);
    vertex(p.x, p.y, p.z);
  }
  endShape();
}

function drawShellSpokes(shell, theta) {
  for (let i = 0; i < shell.spokeCount; i++) {
    const u = i / shell.spokeCount * TWO_PI;
    const a = evalRibbonPoint(shell, u, theta, 0.0, 1.0);
    const b = evalRibbonPoint(shell, u, theta, PI / shell.exp, 0.56);
    line(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

function evalRibbonPoint(shell, u, theta, phaseOffset, ampScale) {
  const wave = shell.waveAmp * ampScale * sin(u * shell.exp + theta * shell.waveFreq + phaseOffset);
  const ridge = shell.tube * cos(u * shell.band + theta * shell.ridgeFreq + phaseOffset);
  const lift = shell.depthAmp * ampScale * sin(u * shell.twist - theta * shell.liftFreq + phaseOffset);
  const radial = shell.radius + wave + ridge * 0.36;
  return {
    x: cos(u) * radial,
    y: sin(u * (1 + (shell.index % 2))) * (shell.radius * shell.yScale) + lift * 0.46 + 18 * cos(theta * shell.pulseFreq + u * shell.band),
    z: ridge + lift,
  };
}

function drawBitCrowns(theta) {
  strokeWeight(1.05);
  for (const shell of shells) {
    const y = map(shell.index, 0, shells.length - 1, -560, 560);
    const ringR = 44 + shell.exp * 4.8;

    push();
    translate(0, y, 0);
    rotateY(theta * (1 + (shell.index % 4)) + shell.phase);

    noFill();
    stroke(...shell.colorA, 40);
    drawCircle3D(0, 0, 0, ringR, Math.max(26, shell.exp * 3));

    for (let bit = 0; bit < shell.exp; bit++) {
      const a = bit / shell.exp * TWO_PI;
      const bob = 10 * sin(theta * (2 + (shell.index % 3)) + bit * 0.45);
      push();
      translate(cos(a) * ringR, bob, sin(a) * ringR);
      emissiveMaterial(...mixRgb(shell.colorB, ICE, 0.32));
      sphere(3.6 + 0.8 * sin(theta * 4 + bit), 6, 4);
      pop();
    }
    pop();
  }

  stroke(...ECHO, 38);
  strokeWeight(1.1);
  line(0, -640, 0, 0, 640, 0);
}

function drawHud(theta) {
  disableDepthTest();
  push();
  resetMatrix();
  translate(-W * 0.5, -H * 0.5);
  image(overlayLayer, 0, 0, W, H);

  noStroke();
  fill(...ECHO, 110);
  textSize(18);
  textAlign(LEFT, TOP);
  text("MERSENNE BLOOM", 34, H - 116);
  fill(...ICE, 62);
  textSize(13);
  text("M_p = 2^p - 1", 34, H - 86);
  text("p: " + EXPONENTS.join(", "), 34, H - 66);
  fill(...MINT, 56 + 18 * sin(theta * 4));
  text("1080 x 1920  |  WEBGL  |  MP4", 34, H - 46);
  pop();
  enableDepthTest();
}

function drawCircle3D(x, y, z, r, steps) {
  beginShape();
  for (let i = 0; i <= steps; i++) {
    const a = i / steps * TWO_PI;
    vertex(x + cos(a) * r, y + sin(a) * r, z);
  }
  endShape();
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

function mixRgb(a, b, t) {
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
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

function randomRange(rng, minValue, maxValue) {
  return minValue + (maxValue - minValue) * rng();
}

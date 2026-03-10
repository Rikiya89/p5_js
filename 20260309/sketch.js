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

let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;

let fc = 0;
let bgLayer = null;
let overlayLayer = null;
let rings = [];
let dust = [];
let struts = [];
let orbiters = [];

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
  const a = document.createElement("a");
  a.href = url;
  a.download = "napier_exponential_vortex_20260309.mp4";
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;

  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("Complete", "#ffffff");
  setTimeout(() => setStatus("Ready", "#d8d8d8"), 3000);
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
  const breathe = 0.5 + 0.5 * sin(theta * 2);
  const pulse = 0.5 + 0.5 * cos(theta * 3);

  background(...BLACK);
  drawBackdrop();
  setSceneCamera(theta);
  setSceneLights(theta, breathe);

  drawAxisSpine(theta);
  drawRingField(theta);
  drawArchitecturalStruts(theta);

  blendMode(ADD);
  noLights();
  drawDust(theta);
  drawOrbiters(theta, pulse);
  blendMode(BLEND);

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
  rings = [];
  dust = [];
  struts = [];
  orbiters = [];

  const rng = makeRng(20260309);
  const ringCount = 11;

  for (let i = 0; i < ringCount; i++) {
    const u = ringCount === 1 ? 0 : i / (ringCount - 1);
    const growth = normalizedExp(u, Math.E);
    const compression = normalizedLog(u, Math.E);
    const radius = 96 + growth * 280;
    const y = lerp(420, -420, compression);
    rings.push({
      index: i,
      radius,
      y,
      depth: 28 + growth * 84,
      wave: 6 + growth * 38,
      turns: 2 + floor(1 + growth * 5),
      detail: 96 + i * 16,
      strokeAlpha: 44 + i * 10,
      glowAlpha: 16 + i * 6,
      tiltX: -0.9 + growth * 1.7,
      tiltZ: -0.4 + compression * 0.85,
      spin: (i % 2 === 0 ? 1 : -1) * (0.35 + growth * 1.25),
      drift: 18 + compression * 70,
      phase: rng() * TWO_PI,
    });
  }

  const dustCount = 980;
  for (let i = 0; i < dustCount; i++) {
    const u = rng();
    const radial = 180 + normalizedExp(u, 5.2) * 560;
    const altitude = lerp(-620, 620, rng());
    dust.push({
      radial,
      altitude,
      theta: rng() * TWO_PI,
      spin: 0.2 + rng() * 1.1,
      size: 0.7 + rng() * 1.85,
      alpha: 20 + rng() * 72,
      wobble: 12 + rng() * 44,
    });
  }

  const strutCount = 24;
  for (let i = 0; i < strutCount; i++) {
    const u = i / strutCount;
    struts.push({
      angle: u * TWO_PI,
      radius: 268 + normalizedExp((i % 12) / 11, Math.E) * 118,
      width: 4 + (i % 3) * 2.5,
      height: 720 + (i % 5) * 60,
      phase: rng() * TWO_PI,
      sway: 12 + rng() * 28,
    });
  }

  for (const ring of rings) {
    const count = 4 + (ring.index % 4);
    for (let i = 0; i < count; i++) {
      orbiters.push({
        ringIndex: ring.index,
        angle: i / count * TWO_PI,
        radiusOffset: 16 + i * 6,
        bob: 14 + i * 4,
        size: 4.5 + i * 0.8,
        phase: rng() * TWO_PI,
      });
    }
  }
}

function buildBackdrop() {
  bgLayer = createGraphics(W, H);
  bgLayer.pixelDensity(1);
  bgLayer.background(...BLACK);
  bgLayer.noStroke();

  const ctx = bgLayer.drawingContext;
  const wash = ctx.createLinearGradient(0, 0, 0, H);
  wash.addColorStop(0.0, rgba(BLACK, 1.0));
  wash.addColorStop(0.3, rgba(VOID, 1.0));
  wash.addColorStop(0.68, rgba(SHADE, 0.94));
  wash.addColorStop(1.0, rgba(BLACK, 1.0));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  const bloom = ctx.createRadialGradient(W * 0.5, H * 0.46, 40, W * 0.5, H * 0.5, H * 0.48);
  bloom.addColorStop(0.0, rgba(WHITE, 0.15));
  bloom.addColorStop(0.22, rgba(PEARL, 0.08));
  bloom.addColorStop(0.55, rgba(GRAPHITE, 0.08));
  bloom.addColorStop(1.0, rgba(BLACK, 0.0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);

  bgLayer.strokeWeight(1);
  for (let y = 0; y < H; y += 6) {
    bgLayer.stroke(255, 255, 255, y % 24 === 0 ? 6 : 2);
    bgLayer.line(0, y, W, y);
  }

  const rng = makeRng(27182818);
  for (let i = 0; i < 320; i++) {
    const x = rng() * W;
    const y = Math.pow(rng(), 0.84) * H;
    const width = 24 + rng() * 82;
    const beam = ctx.createLinearGradient(x, 0, x + width, 0);
    beam.addColorStop(0.0, "rgba(255,255,255,0)");
    beam.addColorStop(0.45, rgba(PEARL, 0.035 + rng() * 0.035));
    beam.addColorStop(1.0, "rgba(255,255,255,0)");
    ctx.fillStyle = beam;
    ctx.fillRect(x, y * 0.1, width, H - y * 0.18);
  }

  bgLayer.noStroke();
  for (let i = 0; i < 1200; i++) {
    const x = rng() * W;
    const y = rng() * H;
    const alpha = rng() < 0.15 ? 36 : 12;
    const size = rng() < 0.08 ? 2.8 : 1.2;
    bgLayer.fill(255, 255, 255, alpha);
    bgLayer.circle(x, y, size);
  }

  bgLayer.noFill();
  bgLayer.stroke(255, 255, 255, 22);
  bgLayer.strokeWeight(1.5);
  bgLayer.rect(24, 24, W - 48, H - 48, 18);
}

function buildOverlay() {
  overlayLayer = createGraphics(W, H);
  overlayLayer.pixelDensity(1);
  overlayLayer.clear();

  const ctx = overlayLayer.drawingContext;
  const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.1, W * 0.5, H * 0.5, H * 0.74);
  vignette.addColorStop(0.0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.72, "rgba(0,0,0,0.14)");
  vignette.addColorStop(1.0, "rgba(0,0,0,0.72)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  const rng = makeRng(31415926);
  overlayLayer.strokeWeight(1);
  for (let y = 0; y < H; y += 3) {
    overlayLayer.stroke(255, 255, 255, y % 9 === 0 ? 5 : 2);
    overlayLayer.line(0, y, W, y);
  }

  overlayLayer.noStroke();
  for (let i = 0; i < 2400; i++) {
    overlayLayer.fill(255, 255, 255, rng() * 10);
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
  perspective(PI / 3.25, W / H, 20, 7000);
  const camX = sin(theta) * 150;
  const camY = -40 + sin(theta * 2) * 86;
  const camZ = 1180 + cos(theta) * 70;
  camera(camX, camY, camZ, 0, -40, 0, 0, 1, 0);
}

function setSceneLights(theta, breathe) {
  ambientLight(34, 34, 34);
  directionalLight(255, 255, 255, -0.18, 0.16, -1);
  directionalLight(160, 160, 160, 0.32, -0.55, -0.32);
  pointLight(255, 255, 255, 0, -280 + 90 * breathe, 260 + 80 * sin(theta * 2));
  pointLight(180, 180, 180, 420 * sin(theta), 120 * cos(theta * 2), 340 * cos(theta));
}

function drawAxisSpine(theta) {
  push();
  rotateY(theta * 0.7);

  for (let lane = 0; lane < 4; lane++) {
    beginShape();
    noFill();
    strokeWeight(lane === 0 ? 2.1 : 1.2);
    stroke(255, 255, 255, lane === 0 ? 128 : 72);

    const laneOffset = lane * HALF_PI;
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const growth = normalizedExp(u, Math.E);
      const lift = normalizedLog(u, Math.E);
      const radius = 58 + growth * 244;
      const y = lerp(450, -450, lift);
      const angle = theta * 2 + laneOffset + u * TWO_PI * (2.5 + growth * 2.2);
      const x = cos(angle) * radius;
      const z = sin(angle) * radius;
      vertex(x, y, z);
    }
    endShape();
  }

  stroke(255, 255, 255, 38);
  strokeWeight(1.1);
  line(0, -520, 0, 0, 520, 0);

  for (let i = 0; i < 11; i++) {
    const u = i / 10;
    const y = lerp(420, -420, normalizedLog(u, Math.E));
    const r = 20 + normalizedExp(u, Math.E) * 54;
    noFill();
    stroke(255, 255, 255, 28 + i * 6);
    drawCircle3D(0, y, 0, r, 42);
  }
  pop();
}

function drawRingField(theta) {
  for (const ring of rings) {
    push();
    translate(0, ring.y + sin(theta * 2 + ring.phase) * ring.drift, 0);
    rotateX(ring.tiltX + 0.12 * sin(theta * 2 + ring.phase));
    rotateY(theta * ring.spin + ring.phase);
    rotateZ(ring.tiltZ + 0.08 * cos(theta * 3 + ring.phase));

    noFill();
    strokeWeight(1.8);
    stroke(255, 255, 255, ring.strokeAlpha);
    drawWarpedRing(ring, theta, 1.0);

    strokeWeight(0.95);
    stroke(210, 210, 210, ring.strokeAlpha + 28);
    drawWarpedRing(ring, theta + PI / 6, 0.56);

    strokeWeight(0.8);
    stroke(255, 255, 255, ring.glowAlpha);
    for (let spoke = 0; spoke < 9; spoke++) {
      const a = spoke / 9 * TWO_PI + theta * 0.35;
      line(
        cos(a) * ring.radius * 0.62,
        sin(a * 2 + theta + ring.phase) * ring.wave * 0.4,
        sin(a) * ring.depth * 0.62,
        cos(a) * ring.radius * 1.04,
        sin(a * ring.turns + theta * 2 + ring.phase) * ring.wave,
        sin(a) * ring.depth
      );
    }
    pop();
  }
}

function drawArchitecturalStruts(theta) {
  strokeWeight(1);
  for (const strut of struts) {
    const sweep = strut.angle + theta;
    const x = cos(sweep) * (strut.radius + sin(theta * 2 + strut.phase) * strut.sway);
    const z = sin(sweep) * (strut.radius + cos(theta * 2 + strut.phase) * strut.sway);

    push();
    translate(x, 0, z);
    rotateY(-sweep + HALF_PI);
    rotateX(0.05 * sin(theta * 2 + strut.phase));
    stroke(255, 255, 255, 46);
    fill(20, 20, 20, 80);
    box(strut.width, strut.height, strut.width);
    pop();
  }
}

function drawDust(theta) {
  for (const mote of dust) {
    const a = mote.theta + theta * mote.spin;
    const x = cos(a) * (mote.radial + sin(theta * 3 + mote.theta) * mote.wobble);
    const y = mote.altitude + sin(theta * 2 + mote.theta * 2) * 34;
    const z = sin(a) * (mote.radial + cos(theta * 2 + mote.theta) * mote.wobble);
    stroke(255, 255, 255, mote.alpha);
    strokeWeight(mote.size);
    point(x, y, z);
  }
}

function drawOrbiters(theta, pulse) {
  for (const orbiter of orbiters) {
    const ring = rings[orbiter.ringIndex];
    const localA = orbiter.angle + theta * ring.spin + orbiter.phase;
    const y = ring.y + sin(localA * 2 + theta * 3) * orbiter.bob;
    const radial = ring.radius + ring.wave + orbiter.radiusOffset + 18 * pulse;
    const x = cos(localA) * radial;
    const z = sin(localA) * (ring.depth + orbiter.radiusOffset * 0.9);

    push();
    translate(x, y, z);
    emissiveMaterial(255, 255, 255);
    sphere(orbiter.size, 7, 6);
    pop();
  }
}

function drawWarpedRing(ring, theta, ampScale) {
  beginShape();
  const steps = ring.detail;
  for (let i = 0; i <= steps; i++) {
    const a = i / steps * TWO_PI;
    const radial = ring.radius + sin(a * ring.turns + theta * 2 + ring.phase) * ring.wave * ampScale;
    const y = sin(a * (ring.turns + 1) - theta + ring.phase) * ring.wave * 0.85 * ampScale;
    const z = sin(a) * ring.depth;
    vertex(cos(a) * radial, y, z);
  }
  endShape(CLOSE);
}

function drawHud(theta) {
  disableDepthTest();
  push();
  resetMatrix();
  translate(-W * 0.5, -H * 0.5);
  image(overlayLayer, 0, 0, W, H);

  noStroke();
  fill(255, 255, 255, 120);
  textAlign(LEFT, TOP);
  textSize(18);
  text("NAPIER EXPONENTIAL VORTEX", 34, H - 116);

  fill(210, 210, 210, 84);
  textSize(13);
  text("e^x  |  ln(x)  |  continuous growth / decay", 34, H - 86);

  fill(255, 255, 255, 64 + 28 * sin(theta * 4));
  text("1080 x 1350  |  WEBGL  |  MP4", 34, H - 64);

  fill(160, 160, 160, 82);
  text("e = " + Math.E.toFixed(6), 34, H - 42);
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

function normalizedExp(t, base) {
  const hi = Math.exp(base);
  return (Math.exp(t * base) - 1) / (hi - 1);
}

function normalizedLog(t, base) {
  return Math.log(1 + t * (base - 1)) / Math.log(base);
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

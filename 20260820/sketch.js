"use strict";

// SPHERE EVERSION / existing Reel and capture baseline (carried from Gauss–Bonnet sketch)
const W = 1080, H = 1920, FPS = 60, MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION, LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK = { r: 255, g: 255, b: 255 };
const CYAN = { r: 0, g: 229, b: 255 };
const MAGENTA = { r: 255, g: 61, b: 191 };
const ACID = { r: 182, g: 255, b: 61 };

const CONFIG = {
  uSegments: 72,
  vSegments: 38,
  sphereRadius: 300,
  corrugationLobes: 5,      // N: integer lobe count, must stay integer (C1-safe, loop-safe)
  corrugationAmount: 0.9,   // fold amount / wrinkle depth
  surfaceLineWeight: 1.15,
  glowLineWeight: 5.2,
  markerStrideU: 6,
  markerStrideV: 4,
  markerLength: 30,
  cameraRadius: 1510,
  cameraHeight: -95,
  fogDepthRange: 980,
  showInterface: true,
};

const LABELS = [
  { phase: "SPHERE", note: "CLEAN STATE" },
  { phase: "SPHERE EVERSION", note: "NO TEARING" },
  { phase: "SPHERE EVERSION", note: "SELF-INTERSECTION ALLOWED" },
  { phase: "INSIDE OUT", note: "ORIENTATION INVERTED" },
];

let canvasEl, hudPg, vignettePg, grainPg;
let muxer = null, encoder = null, isRecording = false;
let recFrameCount = 0, recordingStartFrame = 0;
let paused = false, frozenFrame = 0;
let isDragging = false, lastMouseX = 0, lastMouseY = 0;
let userYaw = 0, userPitch = 0, userZoomOffset = 0;
let showInterface = CONFIG.showInterface;

const loopState = {
  loopT: 0, phase: 0, evertT: 0, cameraAngle: -0.46,
  cameraRadius: CONFIG.cameraRadius, cameraHeight: CONFIG.cameraHeight,
};
const cameraEye = { x: 0, y: 0, z: 0 };

const pointCount = CONFIG.uSegments * CONFIG.vSegments;
const surface = {
  positions: new Float32Array(pointCount * 3),
  normals: new Float32Array(pointCount * 3),
  side: new Float32Array(pointCount), // +1 outward-facing, -1 inverted (drives color)
};

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function smooth01(value) { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// C1-continuous palindromic time map: loopT 0->1 becomes evertT 0->1->0.
// The zero velocity at both endpoints removes the visible hitch at the loop seam.
function palindromeT(loopT) { return 0.5 - 0.5 * Math.cos(loopT * TAU); }

function updateAutomaticTimeline(frameIndex) {
  const t = (((frameIndex % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  loopState.loopT = t;
  loopState.phase = t * TAU;
  loopState.evertT = palindromeT(t);
  // A closed, asymmetric camera path prevents the return pass reading as a
  // simple rewind while still landing exactly on its opening pose.
  loopState.cameraAngle = -0.46 + 0.28 * Math.sin(loopState.phase) + 0.06 * Math.sin(loopState.phase * 2);
  loopState.cameraRadius = CONFIG.cameraRadius + 36 * Math.sin(loopState.phase * 2);
  loopState.cameraHeight = CONFIG.cameraHeight + 52 * Math.sin(loopState.phase);
}

// Stylized rotate-the-profile-through-itself eversion study: a radial/axial
// profile is corrugated at the midpoint and rotated toward an inside-out pose.
// It visualizes the topology without claiming a numerically proven regular
// homotopy for every sampled intermediate frame. Broad plateau envelope (fade
// in, hold, fade out) instead of a narrow sine pulse, so the corrugation is
// visible across most of the eversion. Still 0 at evertT=0/1 for loop-safety.
function corrugationEnvelope(evertT) {
  const fadeIn = smooth01((evertT - 0.12) / (0.32 - 0.12));
  const fadeOut = 1 - smooth01((evertT - 0.7) / (0.9 - 0.7));
  return fadeIn * fadeOut;
}

function evertPosition(u, v, evertT) {
  const N = CONFIG.corrugationLobes;
  const amp = corrugationEnvelope(evertT);
  const wavePhase = evertT * TAU;
  const inv = evertT * Math.PI;

  const cv = Math.cos(v), sv = Math.sin(v);
  const corr = 1 + CONFIG.corrugationAmount * amp * Math.sin(N * u + wavePhase) * sv;
  const R = CONFIG.sphereRadius * corr;

  const radial = R * sv;
  const axial = R * cv;
  const ci = Math.cos(inv), si = Math.sin(inv);
  const radialR = radial * ci - axial * si;
  const axialR = radial * si + axial * ci;

  return [radialR * Math.cos(u), axialR, radialR * Math.sin(u)];
}

function paramIndex(i, j) {
  const u = (i + CONFIG.uSegments) % CONFIG.uSegments;
  return u * CONFIG.vSegments + clamp(j, 0, CONFIG.vSegments - 1);
}

function positionAt(i, j, c) { return surface.positions[paramIndex(i, j) * 3 + c]; }

function writePosition(index, x, y, z) {
  const o = index * 3;
  surface.positions[o] = x; surface.positions[o + 1] = y; surface.positions[o + 2] = z;
}

function updateEvertingSurface() {
  const du = TAU / CONFIG.uSegments;
  const dv = (Math.PI - 0.07) / (CONFIG.vSegments - 1);
  for (let i = 0; i < CONFIG.uSegments; i++) {
    for (let j = 0; j < CONFIG.vSegments; j++) {
      const u = i * du;
      const v = 0.035 + j * dv;
      const p = evertPosition(u, v, loopState.evertT);
      writePosition(paramIndex(i, j), p[0], p[1], p[2]);
    }
  }
  calculateNormalsAndSide(du, dv);
}

// Central-difference surface normal, oriented by dot with the local radial
// direction. side < 0 marks patches where the normal has flipped inward —
// exactly the region that has "turned inside out" at this frame.
function calculateNormalsAndSide(du, dv) {
  for (let i = 0; i < CONFIG.uSegments; i++) {
    for (let j = 1; j < CONFIG.vSegments - 1; j++) {
      const idx = paramIndex(i, j);
      const p = [positionAt(i, j, 0), positionAt(i, j, 1), positionAt(i, j, 2)];
      const ru = [
        (positionAt(i + 1, j, 0) - positionAt(i - 1, j, 0)) / (2 * du),
        (positionAt(i + 1, j, 1) - positionAt(i - 1, j, 1)) / (2 * du),
        (positionAt(i + 1, j, 2) - positionAt(i - 1, j, 2)) / (2 * du),
      ];
      const rv = [
        (positionAt(i, j + 1, 0) - positionAt(i, j - 1, 0)) / (2 * dv),
        (positionAt(i, j + 1, 1) - positionAt(i, j - 1, 1)) / (2 * dv),
        (positionAt(i, j + 1, 2) - positionAt(i, j - 1, 2)) / (2 * dv),
      ];
      const nx = ru[1] * rv[2] - ru[2] * rv[1];
      const ny = ru[2] * rv[0] - ru[0] * rv[2];
      const nz = ru[0] * rv[1] - ru[1] * rv[0];
      const invN = 1 / Math.max(1e-9, Math.hypot(nx, ny, nz));
      const ux = nx * invN, uy = ny * invN, uz = nz * invN;
      const o = idx * 3;
      surface.normals[o] = ux; surface.normals[o + 1] = uy; surface.normals[o + 2] = uz;
      surface.side[idx] = Math.sign(dot3([ux, uy, uz], p)) || 1;
    }
  }
  // pole rows inherit the neighboring ring's orientation (chart degenerates naturally there)
  for (let i = 0; i < CONFIG.uSegments; i++) {
    surface.side[paramIndex(i, 0)] = surface.side[paramIndex(i, 1)];
    surface.side[paramIndex(i, CONFIG.vSegments - 1)] = surface.side[paramIndex(i, CONFIG.vSegments - 2)];
  }
}

// CYAN = outward-facing (outside), MAGENTA = inverted (inside turned out).
// Under blendMode(ADD) overlapping strands wash toward white — the visual
// signature of the self-intersecting transitional phase.
function sideColor(side, alpha) {
  const target = side < 0 ? MAGENTA : CYAN;
  const mix = clamp(Math.abs(Math.sin(loopState.evertT * Math.PI * 0.5)) * 0.7 + 0.3, 0, 1);
  return [
    INK.r + (target.r - INK.r) * mix,
    INK.g + (target.g - INK.g) * mix,
    INK.b + (target.b - INK.b) * mix,
    alpha,
  ];
}

function depthAlpha(offset) {
  const dx = surface.positions[offset] - cameraEye.x;
  const dy = surface.positions[offset + 1] - cameraEye.y;
  const dz = surface.positions[offset + 2] - cameraEye.z;
  const distance = Math.hypot(dx, dy, dz);
  const near = loopState.cameraRadius - CONFIG.fogDepthRange * 0.45;
  const t = clamp((distance - near) / CONFIG.fogDepthRange, 0, 1);
  return 1 - smooth01(t) * 0.72;
}

function drawEvertingLines(alpha, glow) {
  noFill();
  strokeWeight(glow ? CONFIG.glowLineWeight : CONFIG.surfaceLineWeight);
  for (let i = 0; i < CONFIG.uSegments; i += 2) {
    const major = i % 12 === 0;
    strokeWeight((glow ? CONFIG.glowLineWeight : CONFIG.surfaceLineWeight) * (major ? 1.35 : 1));
    beginShape();
    for (let j = 0; j < CONFIG.vSegments; j++) {
      const idx = paramIndex(i, j), o = idx * 3;
      const hierarchy = major ? 1 : 0.72;
      const c = sideColor(surface.side[idx], alpha * (glow ? 22 : 205) * hierarchy * depthAlpha(o));
      stroke(c[0], c[1], c[2], c[3]);
      vertex(surface.positions[o], surface.positions[o + 1], surface.positions[o + 2]);
    }
    endShape();
  }
  for (let j = 0; j < CONFIG.vSegments; j += 2) {
    const major = j % 8 === 0;
    strokeWeight((glow ? CONFIG.glowLineWeight : CONFIG.surfaceLineWeight) * (major ? 1.18 : 0.82));
    beginShape();
    for (let i = 0; i <= CONFIG.uSegments; i++) {
      const idx = paramIndex(i, j), o = idx * 3;
      const c = sideColor(surface.side[idx], alpha * (glow ? 19 : 162) * (major ? 1 : 0.7) * depthAlpha(o));
      stroke(c[0], c[1], c[2], c[3]);
      vertex(surface.positions[o], surface.positions[o + 1], surface.positions[o + 2]);
    }
    endShape();
  }
}

function drawEvertingMarkers(alpha) {
  blendMode(ADD);
  for (let i = 0; i < CONFIG.uSegments; i += CONFIG.markerStrideU) {
    for (let j = 1; j < CONFIG.vSegments - 1; j += CONFIG.markerStrideV) {
      const idx = paramIndex(i, j), o = idx * 3;
      const c = sideColor(surface.side[idx], alpha * 182);
      stroke(c[0], c[1], c[2], c[3]);
      strokeWeight(2.1);
      line(
        surface.positions[o], surface.positions[o + 1], surface.positions[o + 2],
        surface.positions[o] + surface.normals[o] * CONFIG.markerLength,
        surface.positions[o + 1] + surface.normals[o + 1] * CONFIG.markerLength,
        surface.positions[o + 2] + surface.normals[o + 2] * CONFIG.markerLength,
      );
    }
  }
  blendMode(BLEND);
}

function renderEvertingSurface(alpha) {
  updateEvertingSurface();
  blendMode(ADD);
  drawEvertingLines(alpha, true);
  blendMode(BLEND);
  drawEvertingLines(alpha, false);
  drawEvertingMarkers(alpha);
}

function applyLoopingCamera() {
  const angle = loopState.cameraAngle + userYaw;
  const radius = loopState.cameraRadius + userZoomOffset;
  const height = loopState.cameraHeight + userPitch * 420;
  cameraEye.x = Math.sin(angle) * radius;
  cameraEye.y = height;
  cameraEye.z = Math.cos(angle) * radius;
  camera(cameraEye.x, cameraEye.y, cameraEye.z, 0, 0, 0, 0, 1, 0);
}

function drawEnvironment() {
  noFill();
  strokeWeight(0.7);
  for (let ring = 0; ring < 3; ring++) {
    const radius = 470 + ring * 92;
    stroke(INK.r, INK.g, INK.b, 12 - ring * 2.6);
    beginShape();
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * TAU;
      vertex(Math.cos(a) * radius, Math.sin(a) * radius, -365 - ring * 28);
    }
    endShape();
  }
  stroke(INK.r, INK.g, INK.b, 10);
  line(-690, 0, -420, 690, 0, -420);
  line(0, -690, -420, 0, 690, -420);
}

function createInterfaceLayers() {
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  vignettePg = createGraphics(W, H);
  vignettePg.pixelDensity(1);
  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  grainPg.clear();
  grainPg.noStroke();
  randomSeed(20260820);
  for (let i = 0; i < Math.floor(W * H * 0.0014); i++) {
    const value = random(130, 220);
    grainPg.fill(value, value, value, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.2, 0.9));
  }
  const context = vignettePg.drawingContext;
  const gradient = context.createRadialGradient(W / 2, H / 2, 250, W / 2, H / 2, 1040);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.72, "rgba(0,0,0,.04)");
  gradient.addColorStop(1, "rgba(0,0,0,.36)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, W, H);
}

function currentLabel() {
  const t = loopState.loopT;
  if (t < 0.08 || t > 0.94) return LABELS[0];
  if (loopState.evertT < 0.45) return LABELS[1];
  if (loopState.evertT < 0.85) return LABELS[2];
  return LABELS[3];
}

function renderSimulatorInterface() {
  if (!showInterface) return;
  const active = currentLabel();
  hudPg.clear();
  const context = hudPg.drawingContext;
  const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const top = 162, foot = H - 430;
  context.save();
  context.textBaseline = "top";
  context.textAlign = "left";
  context.font = `26px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.92)";
  context.fillText("SPHERE EVERSION", 72, top);
  context.font = `18px ${mono}`;
  context.fillStyle = `rgba(${CYAN.r},${CYAN.g},${CYAN.b},.84)`;
  context.fillText("TURNING A SPHERE INSIDE OUT", 72, top + 42);
  context.font = `16px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.46)";
  context.fillText("CYAN  OUTSIDE     WHITE  TRANSITION     MAGENTA  INSIDE", 72, top + 82);
  context.strokeStyle = "rgba(255,255,255,.12)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(72, top + 142); context.lineTo(W - 72, top + 142);
  context.moveTo(72, foot); context.lineTo(W - 72, foot);
  context.stroke();
  context.textAlign = "center";
  context.font = `16px ${mono}`;
  context.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.86)`;
  context.fillText(active.note, W / 2, foot + 38);
  context.font = `30px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.94)";
  context.fillText(active.phase, W / 2, foot + 78);
  context.font = `23px ${mono}`;
  context.fillText("CONTINUOUS SURFACE STUDY  ·  NO CUTS", W / 2, foot + 126);
  context.font = `16px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.42)";
  context.fillText("SELF-INTERSECTION VISUALIZED", W / 2, foot + 170);
  const trackY = foot + 235, trackLeft = 76, trackWidth = W - 152;
  context.strokeStyle = "rgba(255,255,255,.13)";
  context.beginPath(); context.moveTo(trackLeft, trackY); context.lineTo(trackLeft + trackWidth, trackY); context.stroke();
  for (const stop of [0, 0.5, 1]) {
    const x = trackLeft + stop * trackWidth;
    context.beginPath(); context.moveTo(x, trackY - 7); context.lineTo(x, trackY + 7); context.stroke();
  }
  const phaseX = trackLeft + loopState.loopT * trackWidth;
  context.strokeStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.76)`;
  context.lineWidth = 2;
  context.beginPath(); context.moveTo(trackLeft, trackY); context.lineTo(phaseX, trackY); context.stroke();
  context.fillStyle = `rgba(${ACID.r},${ACID.g},${ACID.b},.94)`;
  context.beginPath(); context.arc(phaseX, trackY, 4.5, 0, TAU); context.fill();
  context.font = `15px ${mono}`;
  context.fillStyle = "rgba(255,255,255,.3)";
  context.fillText("NO TEARING. NO CUTTING. JUST TOPOLOGY.", W / 2, foot + 272);
  context.restore();
  drawOverlayLayer(vignettePg);
  drawOverlayLayer(grainPg);
  drawOverlayLayer(hudPg);
}

function drawOverlayLayer(layer) {
  const gl = drawingContext;
  gl.disable(gl.DEPTH_TEST);
  const overlayZ = H / (2 * Math.tan(PI / 6));
  push();
  camera(0, 0, overlayZ, 0, 0, 0, 0, 1, 0);
  perspective(PI / 3, W / H, 10, 5000);
  imageMode(CENTER);
  image(layer, 0, 0, W, H);
  pop();
  gl.enable(gl.DEPTH_TEST);
}

function setup() {
  setAttributes({ alpha: false, antialias: true, preserveDrawingBuffer: true });
  const canvas = createCanvas(W, H, WEBGL);
  canvasEl = canvas.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  strokeCap(ROUND);
  document.getElementById("canvas-wrap").appendChild(canvasEl);
  document.getElementById("maxDuration").textContent = MAX_DURATION;
  document.getElementById("maxFrames").textContent = MAX_FRAMES;
  createInterfaceLayers();
  bindControls();
}

function renderScene() {
  applyLoopingCamera();
  drawEnvironment();
  push();
  rotateX(-0.16);
  rotateY(0.08 * Math.sin(loopState.phase));
  renderEvertingSurface(1);
  pop();
  renderSimulatorInterface();
}

function draw() {
  const sourceFrame = isRecording ? recordingStartFrame + recFrameCount : frameCount - 1;
  if (!paused || isRecording) frozenFrame = sourceFrame;
  updateAutomaticTimeline(frozenFrame);
  background(BG_R, BG_G, BG_B);
  perspective(PI / 3, W / H, 10, 5000);
  renderScene();
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUi();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function bindControls() {
  document.getElementById("startBtn").addEventListener("click", startRecording);
  document.getElementById("stopBtn").addEventListener("click", stopRecording);
  document.getElementById("pngBtn").addEventListener("click", () => saveCanvas("sphere_eversion_" + getTimestamp(), "png"));
}

function resetSimulation() {
  userYaw = 0; userPitch = 0; userZoomOffset = 0;
}

function mousePressed() {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  isDragging = true; lastMouseX = mouseX; lastMouseY = mouseY;
}
function mouseReleased() { isDragging = false; }
function mouseDragged() {
  if (!isDragging) return;
  userYaw += (mouseX - lastMouseX) * 0.006;
  userPitch = clamp(userPitch + (mouseY - lastMouseY) * 0.004, -0.7, 0.7);
  lastMouseX = mouseX; lastMouseY = mouseY;
  return false;
}
function mouseWheel(event) {
  userZoomOffset = clamp(userZoomOffset + event.delta * 0.55, -320, 520);
  return false;
}

function keyPressed() {
  if (key === " ") { paused = !paused; return false; }
  if (key === "r" || key === "R") { resetSimulation(); return false; }
  if (key === "h" || key === "H") { showInterface = !showInterface; return false; }
  if (key === "p" || key === "P") { saveCanvas("sphere_eversion_" + getTimestamp(), "png"); return false; }
  if (key === "c" || key === "C" || key === "e" || key === "E") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  return true;
}

// Preserved WebCodecs + mp4-muxer export pipeline.
function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported."); return; }
  if (typeof Mp4Muxer === "undefined") { alert("mp4-muxer not loaded."); return; }
  recordingStartFrame = 0;
  frozenFrame = 0;
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { console.error(error); isRecording = false; setStatus("Error", "#f44"); },
  });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  isRecording = true;
  paused = false;
  document.body.classList.add("recording");
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  document.getElementById("progressFill").style.width = "0%";
  setStatus("Recording…", "#fff");
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing…", "#ccc");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "sphere_eversion_" + getTimestamp() + ".mp4";
  anchor.click();
  encoder.close();
  encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.body.classList.remove("recording");
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  document.getElementById("progressFill").style.width = "0%";
  setStatus("Complete", "#fff");
  setTimeout(() => setStatus("Ready", "#ccc"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function updateRecordingUi() {
  document.getElementById("duration").textContent = (recFrameCount / FPS).toFixed(1);
  document.getElementById("frameCount").textContent = recFrameCount;
  document.getElementById("progressFill").style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
}
function setStatus(textValue, colorValue) {
  const element = document.getElementById("status");
  element.textContent = textValue;
  element.style.color = colorValue;
}

function getTimestamp() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

window.startRecording = startRecording;
window.stopRecording = stopRecording;
window.getTimestamp = getTimestamp;

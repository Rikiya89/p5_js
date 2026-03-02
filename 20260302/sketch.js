"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;
const PHI = (1 + Math.sqrt(5)) * 0.5;

let muxer = null;
let encoder = null;
let fc = 0;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;

let starPoints = [];
let geodesicPoints = [];

function setup() {
  canvasEl = createCanvas(W, H, WEBGL).elt;
  pixelDensity(1);
  frameRate(FPS);
  strokeCap(ROUND);
  strokeJoin(ROUND);

  buildPointFields();

  const maxDurEl = document.getElementById("maxDuration");
  if (maxDurEl) maxDurEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

function draw() {
  const phase = (fc % MAX_FRAMES) / MAX_FRAMES;
  const theta = phase * TWO_PI;
  const unit = min(width, height);

  fc++;
  background(0);

  configureCamera(theta, unit);
  drawBackdrop(theta, unit);
  drawGeodesicSphere(theta, unit);
  drawReferenceFrames(theta, unit);
  drawSuperformulaShell(theta, unit);
  drawKnotBands(theta, unit);
  drawAnalemma(theta, unit);
  drawWireBlossom(theta, unit);
  drawCore(theta, unit);
  drawField(theta, unit);

  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function configureCamera(theta, unit) {
  const camR = unit * 1.42;
  const camY = unit * 0.18 * sin(theta * 0.7);
  camera(
    camR * cos(theta * 0.31),
    camY,
    camR * sin(theta * 0.31),
    0,
    0,
    0,
    0,
    1,
    0
  );
  perspective(PI / 3.4, width / height, 1, unit * 12);
}

function drawBackdrop(theta, unit) {
  push();
  rotateX(HALF_PI);
  translate(0, 0, -unit * 0.95);

  const gridSpan = unit * 1.45;
  const step = unit * 0.18;
  strokeWeight(0.7);
  stroke(255, 18);

  for (let x = -gridSpan; x <= gridSpan; x += step) {
    line(x, -gridSpan, 0, x, gridSpan, 0);
  }

  for (let y = -gridSpan; y <= gridSpan; y += step) {
    line(-gridSpan, y, 0, gridSpan, y, 0);
  }

  stroke(255, 34);
  strokeWeight(1.05);
  const box = unit * 0.84;
  rectMode(CENTER);
  rotateZ(theta * 0.15);
  square(0, 0, box);
  rotateZ(-theta * 0.31);
  square(0, 0, box * 0.68);
  pop();
}

function drawGeodesicSphere(theta, unit) {
  const radius = unit * 0.35;
  const spin = theta * 0.43;

  push();
  rotateY(spin);
  rotateX(theta * 0.19);

  stroke(255, 116);
  strokeWeight(1.05);
  noFill();

  for (let latIdx = -5; latIdx <= 5; latIdx++) {
    const lat = (latIdx / 5) * (PI * 0.44);
    beginShape();
    for (let i = 0; i <= 90; i++) {
      const lon = (i / 90) * TWO_PI;
      const p = spherePoint(radius, lat, lon);
      vertex(p.x, p.y, p.z);
    }
    endShape();
  }

  stroke(255, 54);
  for (let lonIdx = 0; lonIdx < 12; lonIdx++) {
    const lon = (lonIdx / 12) * TWO_PI;
    beginShape();
    for (let i = 0; i <= 56; i++) {
      const lat = map(i, 0, 56, -PI * 0.5, PI * 0.5);
      const p = spherePoint(radius, lat, lon);
      vertex(p.x, p.y, p.z);
    }
    endShape();
  }

  strokeWeight(2.2);
  stroke(255, 162);
  for (let i = 0; i < geodesicPoints.length; i += 24) {
    const gp = geodesicPoints[i];
    point(gp.x * radius, gp.y * radius, gp.z * radius);
  }

  pop();
}

function drawReferenceFrames(theta, unit) {
  push();
  rotateX(theta * 0.22);
  rotateY(theta * 0.17);
  rotateZ(theta * 0.11);

  strokeWeight(1.25);
  stroke(255, 120);
  drawWireCube(unit * 0.54);

  stroke(255, 46);
  strokeWeight(0.9);
  drawWireCube(unit * 0.78);

  stroke(255, 132);
  strokeWeight(1);
  drawOctahedron(unit * 0.49);
  pop();
}

function drawSuperformulaShell(theta, unit) {
  const radius = unit * 0.2;
  const lonSteps = 60;
  const latSteps = 24;
  const m = 7 + 1.8 * sin(theta * 0.5);
  const n1 = 0.24 + 0.08 * sin(theta * 0.9 + 0.3);
  const n2 = 1.35 + 0.35 * sin(theta * 0.7 + 1.1);
  const n3 = 1.35 + 0.35 * cos(theta * 0.6 - 0.7);

  push();
  rotateY(theta * 0.67);
  rotateX(theta * 0.31 + 0.5);

  strokeWeight(1);
  stroke(255, 138);
  noFill();

  for (let latIdx = 0; latIdx <= latSteps; latIdx++) {
    const lat = map(latIdx, 0, latSteps, -HALF_PI, HALF_PI);
    beginShape();
    for (let lonIdx = 0; lonIdx <= lonSteps; lonIdx++) {
      const lon = map(lonIdx, 0, lonSteps, -PI, PI);
      const p = superformulaPoint(radius, lat, lon, m, n1, n2, n3);
      vertex(p.x, p.y, p.z);
    }
    endShape();
  }

  stroke(255, 72);
  for (let lonIdx = 0; lonIdx < lonSteps; lonIdx += 4) {
    const lon = map(lonIdx, 0, lonSteps, -PI, PI);
    beginShape();
    for (let latIdx = 0; latIdx <= latSteps; latIdx++) {
      const lat = map(latIdx, 0, latSteps, -HALF_PI, HALF_PI);
      const p = superformulaPoint(radius, lat, lon, m, n1, n2, n3);
      vertex(p.x, p.y, p.z);
    }
    endShape();
  }

  pop();
}

function drawKnotBands(theta, unit) {
  drawTorusKnot(unit * 0.39, unit * 0.058, 3, 5, theta * 0.95, 360, 255, 126, 1.2);
  drawTorusKnot(unit * 0.31, unit * 0.046, 5, 8, -theta * 0.78 + 1.2, 320, 255, 78, 0.95);
  drawTorusKnot(unit * 0.25, unit * 0.038, 7, 11, theta * 0.62 - 0.8, 280, 255, 52, 0.72);
}

function drawAnalemma(theta, unit) {
  const scale = unit * 0.32;

  push();
  rotateY(theta * 0.12);
  rotateX(0.92);

  stroke(255, 126);
  strokeWeight(1.15);
  noFill();
  beginShape();
  for (let i = 0; i <= 320; i++) {
    const t = map(i, 0, 320, 0, TWO_PI);
    const x = scale * 0.52 * sin(t);
    const y = scale * 0.92 * sin(t) * cos(t);
    const z = scale * 0.34 * sin(t * 2 + theta * 0.7);
    vertex(x, y, z);
  }
  endShape();

  stroke(255, 58);
  strokeWeight(0.9);
  beginShape();
  for (let i = 0; i <= 240; i++) {
    const t = map(i, 0, 240, 0, TWO_PI);
    const r = scale * 0.7 * sqrt(abs(cos(2 * t)));
    const x = r * cos(t);
    const y = r * sin(t);
    const z = scale * 0.12 * sin(3 * t - theta);
    vertex(x, y, z);
  }
  endShape();

  pop();
}

function drawWireBlossom(theta, unit) {
  const blossomRadius = unit * 0.25;

  push();
  rotateY(theta * 0.47);
  rotateX(0.72 + theta * 0.18);
  rotateZ(theta * 0.26);

  stroke(255, 168);
  strokeWeight(1.35);
  noFill();
  drawBlossomOutline(blossomRadius, 6, 240, 0.92, 0);

  stroke(255, 76);
  strokeWeight(0.95);
  drawBlossomOutline(blossomRadius * 1.04, 6, 180, 1.1, -unit * 0.022);

  stroke(255, 96);
  strokeWeight(0.95);
  drawBlossomMesh(blossomRadius * 0.97, 54, theta);

  stroke(255, 144);
  strokeWeight(1.1);
  ellipse(0, 0, blossomRadius * 0.34, blossomRadius * 0.34);

  stroke(255, 88);
  strokeWeight(0.95);
  for (let i = 0; i < 6; i++) {
    const angle = (TWO_PI * i) / 6 + theta * 0.1;
    line(0, 0, 0, cos(angle) * blossomRadius * 0.74, sin(angle) * blossomRadius * 0.74, 0);
  }

  stroke(255, 70);
  strokeWeight(0.9);
  drawHaloLoop(blossomRadius * 1.16, theta, unit * 0.018);

  pop();
}

function drawCore(theta, unit) {
  const core = unit * 0.07;
  const outer = core * 2.2;
  const inner = core * 0.86;

  push();
  rotateY(-theta * 1.3);
  rotateX(theta * 0.8);
  rotateZ(theta * 0.35);

  noFill();
  stroke(255, 154);
  strokeWeight(1.2);
  drawWireStar(outer, inner, 6, 0);

  push();
  rotateY(HALF_PI);
  rotateZ(theta * 0.55 + 0.6);
  stroke(255, 86);
  strokeWeight(0.95);
  drawWireStar(outer * 0.84, inner * 0.82, 6, 0);
  pop();

  stroke(255, 96);
  strokeWeight(0.95);
  drawStarChords(outer * 0.92, inner * 0.8, 6);

  stroke(255, 136);
  strokeWeight(1);
  drawOctahedron(core * 1.55);

  stroke(255, 116);
  strokeWeight(2.6);
  point(0, 0, 0);
  pop();
}

function drawField(theta, unit) {
  push();
  rotateY(-theta * 0.14);
  strokeWeight(1.7);

  for (let i = 0; i < starPoints.length; i++) {
    const star = starPoints[i];
    const wobble = 1 + 0.08 * sin(theta * star.freq + star.phase);
    const x = star.x * unit * wobble;
    const y = star.y * unit * wobble;
    const z = star.z * unit * wobble;
    stroke(255, star.alpha);
    point(x, y, z);
  }

  strokeWeight(0.72);
  stroke(255, 30);
  for (let i = 0; i < starPoints.length; i += 18) {
    const a = starPoints[i];
    const b = starPoints[(i + 23) % starPoints.length];
    line(
      a.x * unit * 0.9,
      a.y * unit * 0.9,
      a.z * unit * 0.9,
      b.x * unit * 0.9,
      b.y * unit * 0.9,
      b.z * unit * 0.9
    );
  }
  pop();
}

function drawTorusKnot(radius, tube, p, q, spin, segments, col, alpha, weight) {
  push();
  rotateX(spin * 0.37);
  rotateY(spin * 0.19);
  rotateZ(spin * 0.11);
  noFill();
  stroke(col, alpha);
  strokeWeight(weight);
  beginShape();
  for (let i = 0; i <= segments; i++) {
    const u = (i / segments) * TWO_PI;
    const k = radius + tube * cos(q * u + spin);
    const x = k * cos(p * u);
    const y = tube * sin(q * u + spin) * 1.45;
    const z = k * sin(p * u);
    vertex(x, y, z);
  }
  endShape();
  pop();
}

function drawBlossomOutline(radius, petals, segments, pinch, zOffset) {
  beginShape();
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * TWO_PI;
    const r = blossomRadiusAt(angle, radius, petals, pinch);
    vertex(cos(angle) * r, sin(angle) * r, zOffset);
  }
  endShape(CLOSE);
}

function drawBlossomMesh(radius, nodeCount, theta) {
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const angle = (i / nodeCount) * TWO_PI;
    const r = blossomRadiusAt(angle, radius, 6, 0.95) * (0.88 + 0.08 * sin(angle * 4 + theta));
    nodes.push({
      x: cos(angle) * r,
      y: sin(angle) * r,
      z: radius * 0.08 * sin(angle * 3 - theta * 1.5)
    });
  }

  for (let i = 0; i < nodeCount; i++) {
    const a = nodes[i];
    const b = nodes[(i * 11 + 7) % nodeCount];
    line(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  strokeWeight(1.55);
  stroke(255, 118);
  for (let i = 0; i < nodeCount; i += 9) {
    const a = nodes[i];
    point(a.x, a.y, a.z);
  }
}

function drawHaloLoop(radius, theta, zAmp) {
  beginShape();
  for (let i = 0; i <= 220; i++) {
    const a = (i / 220) * TWO_PI;
    const r = radius * (0.94 + 0.08 * sin(6 * a + theta * 1.4));
    const x = cos(a) * r;
    const y = sin(a) * r * (0.8 + 0.18 * cos(theta + a * 3));
    const z = zAmp * sin(a * 5 - theta * 1.2);
    vertex(x, y, z);
  }
  endShape(CLOSE);
}

function blossomRadiusAt(angle, radius, petals, pinch) {
  return radius * (0.28 + 0.72 * pow(abs(cos((petals * angle) / 2)), pinch));
}

function drawWireStar(outerRadius, innerRadius, points, zOffset) {
  beginShape();
  for (let i = 0; i <= points * 2; i++) {
    const angle = (i / (points * 2)) * TWO_PI - HALF_PI;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    vertex(cos(angle) * radius, sin(angle) * radius, zOffset);
  }
  endShape(CLOSE);
}

function drawStarChords(outerRadius, innerRadius, points) {
  const verts = [];
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * TWO_PI - HALF_PI;
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    verts.push({
      x: cos(angle) * radius,
      y: sin(angle) * radius,
      z: 0
    });
  }

  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 4) % verts.length];
    line(a.x, a.y, a.z, b.x, b.y, b.z);
  }
}

function drawWireCube(size) {
  const h = size * 0.5;
  const v = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]
  ];
  const e = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];

  for (const edge of e) {
    const a = v[edge[0]];
    const b = v[edge[1]];
    line(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
}

function drawOctahedron(radius) {
  const pts = [
    [radius, 0, 0], [-radius, 0, 0],
    [0, radius, 0], [0, -radius, 0],
    [0, 0, radius], [0, 0, -radius]
  ];
  const edges = [
    [0, 2], [0, 3], [0, 4], [0, 5],
    [1, 2], [1, 3], [1, 4], [1, 5],
    [2, 4], [2, 5], [3, 4], [3, 5]
  ];

  for (const edge of edges) {
    const a = pts[edge[0]];
    const b = pts[edge[1]];
    line(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
}

function buildPointFields() {
  starPoints = [];
  geodesicPoints = [];

  const starCount = 220;
  const geoCount = 140;
  const golden = PI * (3 - Math.sqrt(5));

  for (let i = 0; i < starCount; i++) {
    const y = 1 - (i / (starCount - 1)) * 2;
    const r = sqrt(max(0, 1 - y * y));
    const a = golden * i;
    starPoints.push({
      x: cos(a) * r * random(0.72, 1.18),
      y: y * random(0.72, 1.18),
      z: sin(a) * r * random(0.72, 1.18),
      alpha: random(28, 112),
      freq: random(0.6, 2.2),
      phase: random(TWO_PI)
    });
  }

  for (let i = 0; i < geoCount; i++) {
    const y = 1 - (i / (geoCount - 1)) * 2;
    const r = sqrt(max(0, 1 - y * y));
    const a = TWO_PI * i / PHI;
    geodesicPoints.push({
      x: cos(a) * r,
      y,
      z: sin(a) * r
    });
  }
}

function superformulaPoint(radius, lat, lon, m, n1, n2, n3) {
  const r1 = superFormula(lon, m, n1, n2, n3);
  const r2 = superFormula(lat, m, n1, n2, n3);
  const x = radius * r1 * cos(lon) * r2 * cos(lat);
  const y = radius * r1 * sin(lon) * r2 * cos(lat);
  const z = radius * r2 * sin(lat);
  return createVector(x, y, z);
}

function superFormula(angle, m, n1, n2, n3) {
  const t1 = pow(abs(cos((m * angle) / 4)), n2);
  const t2 = pow(abs(sin((m * angle) / 4)), n3);
  const denom = pow(t1 + t2, 1 / n1);
  if (denom === 0) return 0;
  return 1 / denom;
}

function spherePoint(radius, lat, lon) {
  return createVector(
    radius * cos(lat) * cos(lon),
    radius * sin(lat),
    radius * cos(lat) * sin(lon)
  );
}

function windowResized() {
  updateCanvasInfo();
}

function keyPressed() {
  if (key === "r" || key === "R") {
    isRecording ? stopRecording() : startRecording();
  }
}

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
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      console.error(error);
      setStatus("Encoder error", "#f66");
      isRecording = false;
    }
  });

  encoder.configure({
    codec: "avc1.640028",
    width,
    height,
    bitrate: 12_000_000,
    framerate: FPS
  });

  fc = 0;
  recordingFrameCount = 0;
  isRecording = true;

  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  setStatus("Recording MP4...", "#fff");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;

  isRecording = false;
  setStatus("Finalizing...", "#aaa");
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "analytic_geometry_20260302.mp4";
  a.click();

  encoder.close();
  encoder = null;
  muxer = null;

  setTimeout(() => URL.revokeObjectURL(url), 5000);
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("Complete", "#fff");
  setTimeout(() => setStatus("Ready", "#aaa"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, {
    timestamp: recordingFrameCount * (1_000_000 / FPS)
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
  const durationEl = document.getElementById("duration");
  const frameEl = document.getElementById("frameCount");
  if (durationEl) durationEl.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (frameEl) frameEl.textContent = recordingFrameCount;
}

function updateCanvasInfo() {
  const sizeEl = document.getElementById("canvasSize");
  if (!sizeEl) return;
  sizeEl.textContent = `${width} x ${height}`;
}

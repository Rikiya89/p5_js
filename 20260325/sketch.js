// Conclusion.
"use strict";

/* Canvas & Recording */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;

/* Palette */
const BG = [4, 2, 14];

const REAL_POS = [30, 160, 255];
const REAL_NEG = [255, 50, 80];
const IMAG_POS = [0, 255, 180];
const IMAG_NEG = [180, 60, 255];
const UNITY = [255, 210, 80];
const JULIA_COL = [255, 80, 190];
const EULER_COL = [80, 200, 255];
const DUST_COL = [160, 180, 255];

/* Sacred Geometry Composition */
const CONFIG = {
  focusY: -20,
  floorY: 360,
  dustCount: 96,
  dustRadiusMin: 520,
  dustRadiusMax: 980,
  innerSeedRadius: 88,
  outerSeedRadius: 178,
  seedCircleRadius: 112,
  haloTori: [
    { radius: 78, tube: 4, color: UNITY },
    { radius: 124, tube: 5, color: EULER_COL },
    { radius: 178, tube: 4, color: IMAG_POS },
  ],
  shellSpecs: [
    { p: 2, q: 3, radius: 156, tube: 18, lift: 12, tiltX: 0.92, tiltY: 0.10, tiltZ: 0.0, turns: 0.78, offset: 0.26, colorA: UNITY, colorB: EULER_COL },
    { p: 3, q: 5, radius: 246, tube: 11, lift: 18, tiltX: 0.34, tiltY: 0.74, tiltZ: 0.22, turns: 1.18, offset: 0.56, colorA: JULIA_COL, colorB: IMAG_NEG },
  ],
  orbiterCount: 6,
  orbiterBaseRadius: 244,
  archCount: 3,
  archRadius: 248,
  archHeight: 404,
};

/* Polyhedra */
const CUBE_POINTS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
const OCTA_POINTS = [
  [0, -1, 0], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1], [0, 1, 0],
];
const OCTA_EDGES = [
  [0, 1], [0, 2], [0, 3], [0, 4],
  [5, 1], [5, 2], [5, 3], [5, 4],
  [1, 2], [2, 3], [3, 4], [4, 1],
];

/* State */
let muxer = null, encoder = null, isRecording = false, recordingFrameCount = 0;
let canvasEl = null, latestRecordingUrl = "";
let latestRecordingFilename = "imaginary_lattice_20260325.mp4";
let fc = 0, captureCanvas = null, captureCtx = null;

let dustParticles = [];
let orbiters = [];
let metatronNodes = [];
let metatronEdges = [];
let floorRingRadii = [];

/* Recording Boilerplate */
function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported."); return; }
  if (typeof Mp4Muxer === "undefined") { alert("mp4-muxer failed."); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory", firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); setStatus("Encoder error"); isRecording = false; },
  });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 16_000_000, framerate: FPS });
  fc = 0; recordingFrameCount = 0; isRecording = true;
  clearDownloadLink();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  updateDownloadButton(false); setStatus("Recording..."); updateRecordingUI();
}
async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus("Finalizing...");
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  setDownloadLink(url, latestRecordingFilename); updateDownloadButton(true);
  triggerDownload(url, latestRecordingFilename);
  encoder.close(); encoder = null; muxer = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true; setStatus("MP4 ready.");
}
function captureFrame() {
  if (!encoder || !canvasEl) return;
  captureCtx.drawImage(canvasEl, 0, 0);
  const frame = new VideoFrame(captureCanvas, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}
function setStatus(t) { const e = document.getElementById("status"); if (e) e.textContent = t; }
function updateRecordingUI() {
  const d = document.getElementById("duration"), f = document.getElementById("frameCount");
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}
function updateCanvasInfo() { const e = document.getElementById("canvasSize"); if (e) e.textContent = W + " x " + H; }
function setDownloadLink(url, fn) { const l = document.getElementById("downloadLink"); if (!l) return; l.href = url; l.download = fn; l.hidden = false; l.textContent = "Direct Link"; }
function clearDownloadLink() {
  if (latestRecordingUrl) { URL.revokeObjectURL(latestRecordingUrl); latestRecordingUrl = ""; }
  const l = document.getElementById("downloadLink"); if (!l) return; l.hidden = true; l.removeAttribute("href"); updateDownloadButton(false);
}
function updateDownloadButton(on) { const b = document.getElementById("downloadBtn"); if (b) b.disabled = !on; }
function triggerDownload(url, fn) { const a = document.createElement("a"); a.href = url; a.download = fn; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); }
function downloadLatestRecording() { if (!latestRecordingUrl) { setStatus("No MP4 yet."); return; } triggerDownload(latestRecordingUrl, latestRecordingFilename); }

/* Utilities */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function mix(a, b, t) { return a + (b - a) * t; }
function loop01(v) { return ((v % 1) + 1) % 1; }
function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function osc(u, turns, phase) { return Math.sin(TWO_PI * (turns * u + phase)); }
function beat(u, turns, phase) { return 0.5 + 0.5 * osc(u, turns, phase); }
function mixColor(a, b, t) {
  return [
    mix(a[0], b[0], t),
    mix(a[1], b[1], t),
    mix(a[2], b[2], t),
  ];
}
function length3(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

/* Builders */
function buildDust() {
  const rng = makeRng(20260325);
  dustParticles = [];

  for (let i = 0; i < CONFIG.dustCount; i++) {
    const theta = rng() * TWO_PI;
    const phi = Math.acos(mix(-0.95, 0.95, rng()));
    const radius = mix(CONFIG.dustRadiusMin, CONFIG.dustRadiusMax, rng());

    dustParticles.push({
      x: Math.sin(phi) * Math.cos(theta) * radius,
      y: Math.cos(phi) * radius * 0.82,
      z: Math.sin(phi) * Math.sin(theta) * radius,
      size: 0.45 + rng() * 1.1,
      drift: 5 + rng() * 9,
      turns: 0.08 + rng() * 0.44,
      phase: rng(),
      brightness: 0.18 + rng() * 0.44,
    });
  }
}

function buildOrbiters() {
  const rng = makeRng(41024);
  orbiters = [];

  for (let i = 0; i < CONFIG.orbiterCount; i++) {
    orbiters.push({
      offset: i / CONFIG.orbiterCount,
      radius: CONFIG.orbiterBaseRadius + (i % 2 === 0 ? -18 : 22),
      height: -46 + (i % 3) * 42,
      turns: 0.52 + (i % 3) * 0.08,
      wobble: 0.9 + rng() * 0.45,
      drift: 5 + rng() * 6,
      rise: 8 + rng() * 7,
      colorA: i % 2 === 0 ? mixColor(UNITY, EULER_COL, 0.28) : mixColor(JULIA_COL, IMAG_NEG, 0.34),
      colorB: i % 2 === 0 ? mixColor(REAL_POS, IMAG_POS, 0.42) : mixColor(UNITY, REAL_NEG, 0.28),
      phase: rng(),
    });
  }
}

function buildMetatron() {
  metatronNodes = [];
  metatronEdges = [];
  floorRingRadii = [136, 238, 392];

  metatronNodes.push({ x: 0, y: 0, z: 0, ring: 0 });

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TWO_PI;
    metatronNodes.push({
      x: Math.cos(a) * CONFIG.innerSeedRadius,
      y: Math.sin(a) * CONFIG.innerSeedRadius,
      z: 0,
      ring: 1,
    });
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TWO_PI + Math.PI / 6;
    metatronNodes.push({
      x: Math.cos(a) * CONFIG.outerSeedRadius,
      y: Math.sin(a) * CONFIG.outerSeedRadius,
      z: 0,
      ring: 2,
    });
  }

  for (let i = 0; i < metatronNodes.length; i++) {
    for (let j = i + 1; j < metatronNodes.length; j++) {
      const a = metatronNodes[i];
      const b = metatronNodes[j];
      const d = length3(a.x - b.x, a.y - b.y, a.z - b.z);
      const close = d < CONFIG.outerSeedRadius * 1.06;
      const radial = (a.ring === 0 || b.ring === 0) && d < CONFIG.outerSeedRadius * 1.02;
      if (close || radial) metatronEdges.push([i, j]);
    }
  }
}

/* Geometry Helpers */
function buildCurvePoints(sampleFn, steps, reveal) {
  const points = [];
  const count = Math.max(2, Math.floor(steps * clamp01(reveal)));
  for (let i = 0; i <= count; i++) points.push(sampleFn(i / steps));
  return points;
}

function drawCurve(points, col, alpha, weight, closeShape) {
  if (points.length < 2) return;

  stroke(col[0], col[1], col[2], alpha * 0.18);
  strokeWeight(weight * 3.2);
  beginShape();
  for (const p of points) vertex(p.x, p.y, p.z);
  if (closeShape) endShape(CLOSE);
  else endShape();

  stroke(col[0], col[1], col[2], alpha);
  strokeWeight(weight);
  beginShape();
  for (const p of points) vertex(p.x, p.y, p.z);
  if (closeShape) endShape(CLOSE);
  else endShape();
}

function glowLine(x1, y1, z1, x2, y2, z2, col, alpha, weight) {
  stroke(col[0], col[1], col[2], alpha * 0.18);
  strokeWeight(weight * 3.1);
  line(x1, y1, z1, x2, y2, z2);

  stroke(col[0], col[1], col[2], alpha);
  strokeWeight(weight);
  line(x1, y1, z1, x2, y2, z2);
}

function glowSphere(x, y, z, baseR, col, intensity) {
  push();
  translate(x, y, z);
  noStroke();
  emissiveMaterial(col[0] * 0.025 * intensity, col[1] * 0.025 * intensity, col[2] * 0.025 * intensity);
  sphere(baseR * 3.8, 6, 5);
  emissiveMaterial(col[0] * 0.1 * intensity, col[1] * 0.1 * intensity, col[2] * 0.1 * intensity);
  sphere(baseR * 1.95, 7, 6);
  emissiveMaterial(col[0] * 0.58 * intensity, col[1] * 0.58 * intensity, col[2] * 0.58 * intensity);
  sphere(baseR, 8, 7);
  pop();
}

function drawPolyhedron(points, edges, scale, col, alpha, weight) {
  for (const edge of edges) {
    const a = points[edge[0]];
    const b = points[edge[1]];
    glowLine(
      a[0] * scale, a[1] * scale, a[2] * scale,
      b[0] * scale, b[1] * scale, b[2] * scale,
      col, alpha, weight
    );
  }
}

/* Timeline */
function getTiming(u) {
  return {
    // Every envelope is authored in normalized loop space so the 30-second progression is intentional.
    emerge: smoothstep(0.0, 0.14, u),
    lattice: smoothstep(0.1, 0.34, u),
    orbit: smoothstep(0.28, 0.62, u),
    bloom: smoothstep(0.58, 0.88, u),
    settle: 1 - smoothstep(0.94, 1.0, u),
  };
}

/* Sampling */
function sampleTorusKnot(spec, v, u, timing) {
  const a = TWO_PI * v;
  const phase = TWO_PI * (spec.turns * u + spec.offset);

  // Torus-knot curves provide the outer field while staying subordinate to the sacred center.
  const majorAngle = spec.p * a + phase;
  const minorAngle = spec.q * a - phase * 1.08;
  const majorRadius = spec.radius + spec.tube * Math.cos(minorAngle);

  return {
    x: majorRadius * Math.cos(majorAngle),
    y: spec.tube * Math.sin(minorAngle) * 1.35 + spec.lift * Math.sin(a * 2 + phase * 0.45) * (0.35 + 0.65 * timing.bloom),
    z: majorRadius * Math.sin(majorAngle),
  };
}

function sampleOrbiter(orbiter, u) {
  // Each orbiter completes an exact number of calm revolutions over the 30-second loop.
  const angle = TWO_PI * (orbiter.offset + orbiter.turns * u) + 0.06 * osc(u, orbiter.wobble, orbiter.phase);
  const radius = orbiter.radius + orbiter.drift * osc(u, orbiter.wobble + 0.25, orbiter.phase + 0.18);
  return {
    x: Math.cos(angle) * radius,
    y: orbiter.height + orbiter.rise * osc(u, orbiter.turns * 1.1, orbiter.phase + 0.42),
    z: Math.sin(angle) * radius,
  };
}

/* Draw Layers */
function drawDust(u, timing) {
  noStroke();
  for (const d of dustParticles) {
    const dx = d.x + Math.cos(TWO_PI * (d.turns * u + d.phase)) * d.drift;
    const dy = d.y + Math.sin(TWO_PI * (d.turns * 0.8 * u + d.phase * 1.3)) * d.drift * 0.45;
    const dz = d.z + Math.sin(TWO_PI * (d.turns * 0.6 * u + d.phase * 0.9)) * d.drift;
    const intensity = d.brightness * (0.4 + 0.6 * beat(u, d.turns * 3 + 0.18, d.phase)) * (0.2 + 0.8 * timing.lattice);
    if (intensity < 0.12) continue;

    push();
    translate(dx, dy, dz);
    emissiveMaterial(
      DUST_COL[0] * 0.12 * intensity,
      DUST_COL[1] * 0.12 * intensity,
      DUST_COL[2] * 0.12 * intensity
    );
    sphere(d.size, 4, 4);
    pop();
  }
}

function drawFloorMandala(u, timing) {
  push();
  noFill();

  for (let i = 0; i < floorRingRadii.length; i++) {
    const radius = floorRingRadii[i] * (0.97 + 0.03 * beat(u, 1.0 + i * 0.25, i * 0.08));
    const alpha = (4 + 8 * timing.lattice) * (1 - i * 0.18) * timing.settle;
    const col = mixColor(EULER_COL, IMAG_POS, i / Math.max(1, floorRingRadii.length - 1));

    const ring = buildCurvePoints((q) => {
      const a = TWO_PI * q;
      return {
        x: Math.cos(a) * radius,
        y: CONFIG.floorY + 5 * Math.sin(a * 6 + TWO_PI * (u * 0.8 + i * 0.04)) * timing.orbit,
        z: Math.sin(a) * radius,
      };
    }, 120, timing.emerge);

    drawCurve(ring, col, alpha, 0.16 + i * 0.03, true);
  }

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TWO_PI + TWO_PI * u * 0.03;
    const col = i % 2 === 0 ? REAL_POS : IMAG_POS;
    glowLine(
      Math.cos(a) * 72, CONFIG.floorY, Math.sin(a) * 72,
      Math.cos(a) * 426, CONFIG.floorY, Math.sin(a) * 426,
      col,
      (2 + 5 * timing.lattice) * timing.settle,
      0.08
    );
  }

  pop();
}

function drawCathedralArches(u, timing) {
  const reveal = smoothstep(0.08, 0.26, timing.lattice + timing.orbit * 0.08);
  if (reveal <= 0.01) return;

  for (let i = 0; i < CONFIG.archCount; i++) {
    push();
    rotateY((i / CONFIG.archCount) * (TWO_PI / CONFIG.archCount) + 0.04 * osc(u, 0.5, i * 0.12));

    const outerCol = i % 2 === 0 ? mixColor(UNITY, REAL_POS, 0.32) : mixColor(EULER_COL, IMAG_POS, 0.38);
    const innerCol = i % 2 === 0 ? mixColor(JULIA_COL, IMAG_NEG, 0.34) : mixColor(UNITY, EULER_COL, 0.42);

    const outer = buildCurvePoints((q) => {
      const a = mix(-HALF_PI, HALF_PI, q);
      return {
        x: Math.sin(a) * CONFIG.archRadius,
        y: -Math.cos(a) * CONFIG.archHeight + 44,
        z: 8 * Math.sin(a * 2 + TWO_PI * (u * 0.6 + i * 0.08)) * timing.orbit,
      };
    }, 144, reveal);
    drawCurve(outer, outerCol, (8 + 15 * reveal) * timing.settle, 0.18, false);

    const inner = buildCurvePoints((q) => {
      const a = mix(-HALF_PI, HALF_PI, q);
      return {
        x: Math.sin(a) * CONFIG.archRadius * 0.72,
        y: -Math.cos(a) * CONFIG.archHeight * 0.7 + 28,
        z: -6 * Math.sin(a * 3 - TWO_PI * (u * 0.5 + i * 0.07)) * timing.orbit,
      };
    }, 120, reveal);
    drawCurve(inner, innerCol, (5 + 9 * reveal) * timing.settle, 0.12, false);

    pop();
  }
}

function drawSeedOfLifePlanes(u, timing) {
  const reveal = smoothstep(0.12, 0.36, timing.lattice + timing.bloom * 0.1);
  if (reveal <= 0.01) return;

  for (let plane = 0; plane < 3; plane++) {
    push();
    rotateY((plane / 3) * TWO_PI / 2 + TWO_PI * u * (0.03 + plane * 0.01));
    rotateX(plane === 0 ? 0 : 0.48 + plane * 0.12 + 0.05 * osc(u, 0.9, plane * 0.17));
    rotateZ(plane === 2 ? TWO_PI * u * 0.04 : 0);

    const baseCol = plane === 0 ? mixColor(UNITY, EULER_COL, 0.34) : plane === 1 ? mixColor(REAL_POS, IMAG_POS, 0.4) : mixColor(JULIA_COL, IMAG_NEG, 0.34);

    // Center + 6 surrounding circles create the legible Seed / Flower of Life motif.
    for (let i = -1; i < 6; i++) {
      const angle = i >= 0 ? (i / 6) * TWO_PI : 0;
      const cx = i >= 0 ? Math.cos(angle) * CONFIG.seedCircleRadius : 0;
      const cy = i >= 0 ? Math.sin(angle) * CONFIG.seedCircleRadius : 0;
      const ring = buildCurvePoints((q) => {
        const a = TWO_PI * q;
        return {
          x: cx + Math.cos(a) * CONFIG.seedCircleRadius,
          y: cy + Math.sin(a) * CONFIG.seedCircleRadius,
          z: 0,
        };
      }, 120, reveal);
      drawCurve(ring, baseCol, (6 + 12 * reveal) * timing.settle, plane === 0 ? 0.15 : 0.12, true);
    }

    pop();
  }
}

function drawMetatronLattice(u, timing) {
  const reveal = smoothstep(0.16, 0.42, timing.lattice + timing.orbit * 0.12);
  if (reveal <= 0.01) return;

  push();
  rotateY(TWO_PI * u * 0.05);
  rotateX(0.12 * osc(u, 0.8, 0.1));

  for (let i = 0; i < metatronEdges.length; i++) {
    const edge = metatronEdges[i];
    const a = metatronNodes[edge[0]];
    const b = metatronNodes[edge[1]];
    const col = i % 3 === 0 ? mixColor(UNITY, EULER_COL, 0.4) : i % 3 === 1 ? mixColor(REAL_POS, IMAG_POS, 0.42) : mixColor(JULIA_COL, IMAG_NEG, 0.36);
    glowLine(a.x, a.y, 0, b.x, b.y, 0, col, (4 + 9 * reveal) * timing.settle, 0.09);
  }

  for (let i = 0; i < metatronNodes.length; i++) {
    const node = metatronNodes[i];
    const pulse = 0.45 + 0.55 * beat(u, 1.2 + node.ring * 0.4, i * 0.08);
    const col = node.ring === 0 ? EULER_COL : node.ring === 1 ? UNITY : mixColor(JULIA_COL, IMAG_NEG, 0.32);
    glowSphere(node.x, node.y, 0, node.ring === 0 ? 4.8 : 2.4 + node.ring * 0.6, col, pulse * (0.7 + 0.3 * timing.bloom));
  }

  pop();
}

function drawHaloTori(u, timing) {
  const intensity = 0.35 + 0.65 * timing.bloom;
  noStroke();

  for (let i = 0; i < CONFIG.haloTori.length; i++) {
    const ring = CONFIG.haloTori[i];
    push();
    rotateX(i === 0 ? 0 : HALF_PI * 0.5 + i * 0.18 + 0.08 * osc(u, 0.8 + i * 0.2, i * 0.11));
    rotateY(TWO_PI * u * (0.07 + i * 0.04));
    rotateZ(i === 2 ? TWO_PI * u * 0.1 : 0);
    emissiveMaterial(
      ring.color[0] * 0.13 * intensity,
      ring.color[1] * 0.13 * intensity,
      ring.color[2] * 0.13 * intensity
    );
    torus(ring.radius, ring.tube, 60, 20);
    pop();
  }
}

function drawOuterShells(u, timing) {
  for (const spec of CONFIG.shellSpecs) {
    const reveal = smoothstep(spec.offset, spec.offset + 0.18, timing.orbit + timing.bloom * 0.14);
    if (reveal <= 0.01) continue;

    const hue = 0.28 + 0.54 * beat(u, spec.turns * 0.75 + 0.38, spec.offset);
    const col = mixColor(spec.colorA, spec.colorB, hue);

    push();
    rotateX(spec.tiltX + 0.1 * osc(u, spec.turns * 0.55, spec.offset));
    rotateY(spec.tiltY + TWO_PI * spec.turns * u * 0.12);
    rotateZ(spec.tiltZ + 0.07 * osc(u, spec.turns * 0.7, spec.offset + 0.1));

    const curve = buildCurvePoints((q) => sampleTorusKnot(spec, q, u, timing), 220, reveal);
    drawCurve(curve, col, (6 + 12 * reveal + 8 * timing.bloom) * timing.settle, 0.14, reveal >= 0.999);

    const p = sampleTorusKnot(spec, loop01(spec.offset + u * spec.turns), u, timing);
    glowSphere(p.x, p.y, p.z, 2.1 + 1.0 * reveal, col, 0.48 + 0.3 * timing.bloom);
    pop();
  }
}

function drawOrbiters(u, timing) {
  const reveal = smoothstep(0.22, 0.52, timing.orbit + timing.bloom * 0.1);
  if (reveal <= 0.01) return;

  for (const orbiter of orbiters) {
    const col = mixColor(orbiter.colorA, orbiter.colorB, 0.28 + 0.72 * beat(u, orbiter.turns + 0.2, orbiter.phase));
    const trail = [];

    for (let i = 15; i >= 0; i--) {
      trail.push(sampleOrbiter(orbiter, loop01(u - i * 0.008)));
    }

    drawCurve(trail, col, (7 + 11 * reveal) * timing.settle, 0.13, false);
    const head = trail[trail.length - 1];
    glowSphere(head.x, head.y, head.z, 2.35 + 1.1 * timing.bloom, col, 0.58 + 0.34 * timing.bloom);
  }
}

function drawCentralCore(u, timing) {
  const axisCol = mixColor(IMAG_POS, EULER_COL, 0.5);
  const axisLen = 292 + 112 * timing.bloom;
  glowLine(0, -axisLen, 0, 0, axisLen, 0, axisCol, (8 + 12 * timing.lattice) * timing.settle, 0.16);

  for (let i = 0; i < 7; i++) {
    const f = i / 6;
    const y = mix(-214, 214, f);
    const pulse = 0.44 + 0.56 * beat(u, 1.4 + f * 0.6, i * 0.09);
    const r = mix(2.6, 6.0, 1 - Math.abs(f * 2 - 1)) + 1.2 * timing.bloom;
    const col = mixColor(mixColor(REAL_POS, IMAG_POS, f), mixColor(UNITY, JULIA_COL, f), 0.4);
    glowSphere(0, y, 0, r, col, pulse * (0.68 + 0.32 * timing.bloom));
  }

  push();
  rotateX(0.52 + 0.08 * osc(u, 0.9, 0.12));
  rotateY(TWO_PI * u * 0.16);
  rotateZ(0.22 + TWO_PI * u * 0.07);
  drawPolyhedron(CUBE_POINTS, CUBE_EDGES, 42 * (1 + 0.1 * timing.bloom), mixColor(EULER_COL, JULIA_COL, 0.34 + 0.22 * beat(u, 1.8, 0.04)), (8 + 10 * timing.bloom) * timing.settle, 0.14);
  pop();

  push();
  rotateY(-TWO_PI * u * 0.22);
  rotateX(0.24 + 0.07 * osc(u, 1.4, 0.2));
  rotateZ(0.36 + TWO_PI * u * 0.1);
  drawPolyhedron(OCTA_POINTS, OCTA_EDGES, 62 * (1 + 0.08 * timing.bloom), mixColor(UNITY, REAL_NEG, 0.28 + 0.2 * beat(u, 1.7, 0.11)), (9 + 12 * timing.bloom) * timing.settle, 0.16);
  pop();

  drawHaloTori(u, timing);

  push();
  noStroke();
  emissiveMaterial(EULER_COL[0] * 0.04 * beat(u, 4.0, 0.08), EULER_COL[1] * 0.04 * beat(u, 4.0, 0.08), EULER_COL[2] * 0.04 * beat(u, 4.0, 0.08));
  sphere(72 + 12 * beat(u, 3.0, 0.14), 18, 16);
  emissiveMaterial(UNITY[0] * 0.065 * beat(u, 5.0, 0.2), UNITY[1] * 0.065 * beat(u, 5.0, 0.2), UNITY[2] * 0.065 * beat(u, 5.0, 0.2));
  sphere(38 + 8 * beat(u, 4.0, 0.08), 16, 14);
  emissiveMaterial(EULER_COL[0] * 0.68, EULER_COL[1] * 0.68, EULER_COL[2] * 0.68);
  sphere(10, 12, 10);
  pop();
}

/* Camera & Light */
function setSceneCamera(u, timing) {
  const orbitAngle = mix(-0.12, 0.2, u) + 0.03 * osc(u, 2.0, 0.08);
  const orbitRadius = mix(748, 620, timing.lattice) + 76 * timing.bloom;
  const camY = mix(-540, -236, timing.emerge) + 24 * osc(u, 1.0, 0.18);
  const lookY = CONFIG.focusY - mix(0, 28, timing.bloom);

  camera(
    Math.sin(orbitAngle) * orbitRadius,
    camY,
    Math.cos(orbitAngle) * orbitRadius,
    0,
    lookY,
    0,
    0, 1, 0
  );
}

function setSceneLights(u, timing) {
  ambientLight(5 + 5 * timing.lattice, 7 + 4 * timing.lattice, 13 + 8 * timing.lattice);
  directionalLight(EULER_COL[0] * 0.12, EULER_COL[1] * 0.12, EULER_COL[2] * 0.12, 0.12, 0.92, -0.68);
  directionalLight(UNITY[0] * 0.08, UNITY[1] * 0.08, UNITY[2] * 0.08, -0.42, -1, 0.22);
  pointLight(EULER_COL[0] * 0.25, EULER_COL[1] * 0.25, EULER_COL[2] * 0.25, 0, -450, 0);
  pointLight(IMAG_POS[0] * 0.16, IMAG_POS[1] * 0.16, IMAG_POS[2] * 0.16, 320, -180, -320);
  pointLight(JULIA_COL[0] * 0.12, JULIA_COL[1] * 0.12, JULIA_COL[2] * 0.12, -280, 160, 280);
  pointLight(UNITY[0] * (0.06 + 0.04 * beat(u, 2.0, 0.15)), UNITY[1] * (0.06 + 0.04 * beat(u, 2.0, 0.15)), UNITY[2] * (0.06 + 0.04 * beat(u, 2.0, 0.15)), 0, 340, 0);
}

/* p5 Setup */
function setup() {
  pixelDensity(1);
  setAttributes("preserveDrawingBuffer", true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);
  perspective(PI / 4.25, W / H, 20, 4200);

  captureCanvas = document.createElement("canvas");
  captureCanvas.width = W;
  captureCanvas.height = H;
  captureCtx = captureCanvas.getContext("2d");

  buildDust();
  buildOrbiters();
  buildMetatron();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* Draw */
function draw() {
  const loopFrame = fc % MAX_FRAMES;
  const u = loopFrame / MAX_FRAMES;
  const timing = getTiming(u);

  background(BG[0], BG[1], BG[2]);
  setSceneCamera(u, timing);
  setSceneLights(u, timing);

  drawDust(u, timing);

  push();
  translate(0, CONFIG.focusY, 0);
  drawFloorMandala(u, timing);
  drawCathedralArches(u, timing);
  drawSeedOfLifePlanes(u, timing);
  drawMetatronLattice(u, timing);
  drawOuterShells(u, timing);
  drawOrbiters(u, timing);
  drawCentralCore(u, timing);
  pop();

  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }

  fc = (fc + 1) % MAX_FRAMES;
}

/* Input */
function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  return true;
}

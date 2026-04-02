"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette ───────────────────── */
const BG = [4, 2, 14];

const REAL_POS  = [30, 160, 255];   // deep blue
const REAL_NEG  = [255, 50, 80];    // coral
const IMAG_POS  = [0, 255, 180];    // jade
const IMAG_NEG  = [180, 60, 255];   // violet
const UNITY     = [255, 210, 80];   // amber
const JULIA_COL = [255, 80, 190];   // hot pink
const EULER_COL = [80, 200, 255];   // sky
const DUST_COL  = [160, 180, 255];  // ambient dust

/* ───────────────────── Crystal Config ───────────────────── */
const NUM_TOWERS = 7;
const TOWER_HEIGHT = 260;
const NUM_FILAMENTS = 18;
const NUM_SHARDS = 12;
const NUM_DUST = 350;
const NUM_LATTICE_NODES = 60;

/* ───────────────────── State ───────────────────── */
let muxer = null, encoder = null, isRecording = false, recordingFrameCount = 0;
let canvasEl = null, latestRecordingUrl = "";
let latestRecordingFilename = "crystal_nexus_20260326.mp4";
let fc = 0, captureCanvas = null, captureCtx = null;

let towers = [];
let filaments = [];
let shards = [];
let dustParticles = [];
let latticeNodes = [];

/* ───────────────────── Recording Boilerplate ───────────────────── */
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

/* ───────────────────── RNG ───────────────────── */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
}

/* ───────────────────── Smooth step ───────────────────── */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ───────────────────── Glowing Sphere ───────────────────── */
function glowSphere(x, y, z, baseR, col, intensity) {
  push();
  translate(x, y, z);
  noStroke();
  emissiveMaterial(col[0] * 0.03 * intensity, col[1] * 0.03 * intensity, col[2] * 0.03 * intensity);
  sphere(baseR * 3.5, 6, 6);
  emissiveMaterial(col[0] * 0.1 * intensity, col[1] * 0.1 * intensity, col[2] * 0.1 * intensity);
  sphere(baseR * 2.0, 7, 7);
  emissiveMaterial(col[0] * 0.4 * intensity, col[1] * 0.4 * intensity, col[2] * 0.4 * intensity);
  sphere(baseR, 8, 8);
  pop();
}

/* ───────────────────── Build Crystal Towers ───────────────────── */
function buildTowers() {
  const rng = makeRng(20260326);
  towers = [];
  const ringRadius = 160;

  for (let i = 0; i < NUM_TOWERS; i++) {
    const angle = (i / NUM_TOWERS) * TWO_PI;
    const x = Math.cos(angle) * ringRadius;
    const z = Math.sin(angle) * ringRadius;
    const h = TOWER_HEIGHT * (0.6 + rng() * 0.4);
    const facets = 4 + Math.floor(rng() * 4);
    const rotSpeed = (rng() - 0.5) * 0.3;
    const phase = rng() * TWO_PI;

    const f = i / NUM_TOWERS;
    const col = [
      lerp(EULER_COL[0], IMAG_POS[0], f),
      lerp(EULER_COL[1], IMAG_POS[1], f),
      lerp(EULER_COL[2], IMAG_POS[2], f),
    ];

    towers.push({ x, z, h, facets, rotSpeed, phase, col, angle });
  }
}

/* ───────────────────── Build Energy Filaments ───────────────────── */
function buildFilaments() {
  const rng = makeRng(99326);
  filaments = [];

  for (let i = 0; i < NUM_FILAMENTS; i++) {
    const startAngle = rng() * TWO_PI;
    const endAngle = startAngle + PI * (0.5 + rng() * 1.5);
    const startR = 40 + rng() * 120;
    const endR = 40 + rng() * 120;
    const startY = -200 + rng() * 400;
    const endY = -200 + rng() * 400;
    const speed = 0.2 + rng() * 0.6;
    const phase = rng() * TWO_PI;
    const segments = 30 + Math.floor(rng() * 30);

    const f = rng();
    const col = [
      lerp(JULIA_COL[0], IMAG_NEG[0], f),
      lerp(JULIA_COL[1], IMAG_NEG[1], f),
      lerp(JULIA_COL[2], IMAG_NEG[2], f),
    ];

    filaments.push({
      startAngle, endAngle, startR, endR,
      startY, endY, speed, phase, segments, col,
    });
  }
}

/* ───────────────────── Build Orbiting Shards ───────────────────── */
function buildShards() {
  const rng = makeRng(77326);
  shards = [];

  for (let i = 0; i < NUM_SHARDS; i++) {
    const orbitR = 220 + rng() * 180;
    const orbitSpeed = 0.08 + rng() * 0.15;
    const orbitPhase = rng() * TWO_PI;
    const size = 8 + rng() * 20;
    const spinSpeed = 0.5 + rng() * 2.0;
    const yOffset = (rng() - 0.5) * 300;

    const f = i / NUM_SHARDS;
    const col = [
      lerp(UNITY[0], REAL_NEG[0], f),
      lerp(UNITY[1], REAL_NEG[1], f),
      lerp(UNITY[2], REAL_NEG[2], f),
    ];

    shards.push({ orbitR, orbitSpeed, orbitPhase, size, spinSpeed, yOffset, col });
  }
}

/* ───────────────────── Build Lattice Nodes ───────────────────── */
function buildLatticeNodes() {
  const rng = makeRng(55326);
  latticeNodes = [];

  for (let i = 0; i < NUM_LATTICE_NODES; i++) {
    const theta = rng() * TWO_PI;
    const phi = Math.acos(2 * rng() - 1);
    const r = 100 + rng() * 250;

    latticeNodes.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: -300 + rng() * 600,
      z: r * Math.sin(phi) * Math.sin(theta),
      pulse: rng() * TWO_PI,
      speed: 0.3 + rng() * 0.8,
      size: 1.5 + rng() * 3,
    });
  }
}

/* ───────────────────── Build Dust ───────────────────── */
function buildDust() {
  const rng = makeRng(33326);
  dustParticles = [];
  for (let i = 0; i < NUM_DUST; i++) {
    const theta = rng() * TWO_PI;
    const phi = Math.acos(2 * rng() - 1);
    const r = 60 + rng() * 500;
    dustParticles.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: -500 + rng() * 1000,
      z: r * Math.sin(phi) * Math.sin(theta),
      size: 0.3 + rng() * 1.0,
      speed: 0.08 + rng() * 0.3,
      phase: rng() * TWO_PI,
      brightness: 0.2 + rng() * 0.8,
    });
  }
}

/* ───────────────────── Draw Dust ───────────────────── */
function drawDust(t) {
  noStroke();
  for (const d of dustParticles) {
    const flicker = 0.3 + 0.7 * Math.sin(t * d.speed * 2 + d.phase);
    const intensity = d.brightness * flicker;
    if (intensity < 0.12) continue;

    const dx = d.x + Math.sin(t * d.speed + d.phase) * 10;
    const dy = d.y + Math.cos(t * d.speed * 0.7 + d.phase * 1.3) * 8;
    const dz = d.z + Math.sin(t * d.speed * 0.5 + d.phase * 0.7) * 10;

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

/* ───────────────────── Draw Crystal Towers ───────────────────── */
function drawTowers(t) {
  push();

  for (const tw of towers) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.8 + tw.phase);
    const breathe = 1 + 0.05 * Math.sin(t * 0.3 + tw.phase);
    const rot = t * tw.rotSpeed;

    push();
    translate(tw.x * breathe, 0, tw.z * breathe);
    rotateY(rot + tw.angle);

    const r = 12 + 4 * pulse;
    const halfH = tw.h * 0.5;
    const taperTop = 0.3 + 0.2 * pulse;

    noFill();
    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (35 + 25 * pulse) : (8 + 6 * pulse);
      const weight = layer === 0 ? (0.5 + 0.3 * pulse) : (1.8 + 1.0 * pulse);
      stroke(tw.col[0], tw.col[1], tw.col[2], alpha);
      strokeWeight(weight);

      // Vertical edges
      for (let f = 0; f < tw.facets; f++) {
        const a1 = (f / tw.facets) * TWO_PI;
        const bx = Math.cos(a1) * r;
        const bz = Math.sin(a1) * r;
        const tx = Math.cos(a1) * r * taperTop;
        const tz = Math.sin(a1) * r * taperTop;
        line(bx, halfH, bz, tx, -halfH, tz);
      }

      // Horizontal rings at intervals
      for (let ring = 0; ring <= 6; ring++) {
        const ry = halfH - (ring / 6) * tw.h;
        const rf = lerp(1, taperTop, ring / 6);
        beginShape();
        for (let f = 0; f <= tw.facets; f++) {
          const a1 = ((f % tw.facets) / tw.facets) * TWO_PI;
          vertex(Math.cos(a1) * r * rf, ry, Math.sin(a1) * r * rf);
        }
        endShape();
      }
    }

    // Glowing tip
    glowSphere(0, -halfH - 10, 0, 4 + 3 * pulse, tw.col, 0.7 + 0.5 * pulse);
    // Base glow
    glowSphere(0, halfH + 5, 0, 3 + 2 * pulse, tw.col, 0.4 + 0.3 * pulse);

    pop();
  }

  pop();
}

/* ───────────────────── Draw Energy Filaments ───────────────────── */
function drawFilaments(t) {
  push();
  noFill();

  for (const fil of filaments) {
    const tOff = t * fil.speed + fil.phase;
    const reveal = smoothstep(0, 4, (tOff % 6));
    const fadeOut = 1 - smoothstep(4.5, 6, (tOff % 6));
    const maxSeg = Math.floor(reveal * fil.segments);

    for (let layer = 0; layer < 2; layer++) {
      const baseAlpha = layer === 0 ? 40 : 10;
      const weight = layer === 0 ? (0.4 + 0.3 * fadeOut) : (1.5 + 0.8 * fadeOut);
      stroke(
        fil.col[0] * fadeOut, fil.col[1] * fadeOut, fil.col[2] * fadeOut,
        baseAlpha * fadeOut
      );
      strokeWeight(weight);

      beginShape();
      for (let s = 0; s <= maxSeg; s++) {
        const f = s / fil.segments;
        const angle = lerp(fil.startAngle, fil.endAngle, f) + t * 0.02;
        const r = lerp(fil.startR, fil.endR, f);
        const y = lerp(fil.startY, fil.endY, f) + Math.sin(f * PI * 3 + tOff) * 30;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        vertex(x, y, z);
      }
      endShape();
    }

    // Traveling spark
    if (maxSeg > 0 && fadeOut > 0.3) {
      const f = maxSeg / fil.segments;
      const angle = lerp(fil.startAngle, fil.endAngle, f) + t * 0.02;
      const r = lerp(fil.startR, fil.endR, f);
      const y = lerp(fil.startY, fil.endY, f) + Math.sin(f * PI * 3 + tOff) * 30;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      glowSphere(x, y, z, 2.5, fil.col, fadeOut);
    }
  }

  pop();
}

/* ───────────────────── Draw Orbiting Shards ───────────────────── */
function drawShards(t) {
  push();

  for (const sh of shards) {
    const angle = t * sh.orbitSpeed + sh.orbitPhase;
    const x = Math.cos(angle) * sh.orbitR;
    const z = Math.sin(angle) * sh.orbitR;
    const y = sh.yOffset + Math.sin(angle * 2 + sh.orbitPhase) * 40;

    push();
    translate(x, y, z);
    rotateX(t * sh.spinSpeed);
    rotateY(t * sh.spinSpeed * 0.618);
    rotateZ(t * sh.spinSpeed * 0.382);

    const s = sh.size;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.5 + sh.orbitPhase);
    noFill();

    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (30 + 30 * pulse) : (8 + 5 * pulse);
      const weight = layer === 0 ? (0.4 + 0.2 * pulse) : (1.2 + 0.6 * pulse);
      stroke(sh.col[0], sh.col[1], sh.col[2], alpha);
      strokeWeight(weight);

      // Octahedron wireframe
      const top = [0, -s, 0];
      const bot = [0, s, 0];
      const pts = [[s, 0, 0], [0, 0, s], [-s, 0, 0], [0, 0, -s]];

      for (let i = 0; i < 4; i++) {
        const p = pts[i];
        const np = pts[(i + 1) % 4];
        line(top[0], top[1], top[2], p[0], p[1], p[2]);
        line(bot[0], bot[1], bot[2], p[0], p[1], p[2]);
        line(p[0], p[1], p[2], np[0], np[1], np[2]);
      }
    }

    // Inner glow
    noStroke();
    emissiveMaterial(sh.col[0] * 0.08 * pulse, sh.col[1] * 0.08 * pulse, sh.col[2] * 0.08 * pulse);
    sphere(s * 0.4, 6, 6);

    pop();
  }

  pop();
}

/* ───────────────────── Draw Lattice Connections ───────────────────── */
function drawLattice(t) {
  push();
  const connectionDist = 180;

  // Draw nodes
  noStroke();
  for (const nd of latticeNodes) {
    const pulse = 0.4 + 0.6 * Math.sin(t * nd.speed + nd.pulse);
    const dx = nd.x + Math.sin(t * 0.2 + nd.pulse) * 12;
    const dy = nd.y + Math.cos(t * 0.15 + nd.pulse * 1.3) * 10;
    const dz = nd.z + Math.sin(t * 0.18 + nd.pulse * 0.7) * 12;
    glowSphere(dx, dy, dz, nd.size * pulse, REAL_POS, pulse * 0.6);
  }

  // Connect nearby nodes
  noFill();
  for (let i = 0; i < latticeNodes.length; i++) {
    const a = latticeNodes[i];
    const ax = a.x + Math.sin(t * 0.2 + a.pulse) * 12;
    const ay = a.y + Math.cos(t * 0.15 + a.pulse * 1.3) * 10;
    const az = a.z + Math.sin(t * 0.18 + a.pulse * 0.7) * 12;

    for (let j = i + 1; j < latticeNodes.length; j++) {
      const b = latticeNodes[j];
      const bx = b.x + Math.sin(t * 0.2 + b.pulse) * 12;
      const by = b.y + Math.cos(t * 0.15 + b.pulse * 1.3) * 10;
      const bz = b.z + Math.sin(t * 0.18 + b.pulse * 0.7) * 12;

      const dx = ax - bx, dy = ay - by, dz = az - bz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > connectionDist) continue;

      const fade = 1 - dist / connectionDist;
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.3 + j * 0.2);
      const alpha = fade * pulse * 18;
      if (alpha < 1) continue;

      stroke(REAL_POS[0], REAL_POS[1], REAL_POS[2], alpha);
      strokeWeight(0.3 + fade * 0.3);
      line(ax, ay, az, bx, by, bz);
    }
  }

  pop();
}

/* ───────────────────── Draw Central Core ───────────────────── */
function drawCore(t) {
  push();
  const p1 = 0.5 + 0.5 * Math.sin(t * 1.1);
  const p2 = 0.5 + 0.5 * Math.sin(t * 1.7);
  const p3 = 0.5 + 0.5 * Math.sin(t * 0.6);

  noStroke();

  // Outer haze
  emissiveMaterial(EULER_COL[0] * 0.02 * p3, EULER_COL[1] * 0.02 * p3, EULER_COL[2] * 0.02 * p3);
  sphere(80 + 25 * p3, 14, 14);

  // Mid aura
  const ar = lerp(EULER_COL[0], JULIA_COL[0], p2 * 0.4);
  const ag = lerp(EULER_COL[1], JULIA_COL[1], p2 * 0.4);
  const ab = lerp(EULER_COL[2], JULIA_COL[2], p2 * 0.4);
  emissiveMaterial(ar * 0.06 * p1, ag * 0.06 * p1, ab * 0.06 * p1);
  sphere(45 + 15 * p1, 12, 12);

  // Inner glow
  emissiveMaterial(EULER_COL[0] * 0.15 * p2, EULER_COL[1] * 0.15 * p2, EULER_COL[2] * 0.15 * p2);
  sphere(25 + 6 * p2, 10, 10);

  // Bright core
  emissiveMaterial(EULER_COL[0] * 0.6, EULER_COL[1] * 0.6, EULER_COL[2] * 0.6);
  sphere(8, 12, 12);

  // 3 interlocked orbiting rings
  noFill();
  const ringColors = [IMAG_POS, JULIA_COL, UNITY];
  for (let r = 0; r < 3; r++) {
    const speed = 0.5 + r * 0.25;
    const a = t * speed + r * (TWO_PI / 3);
    const ringR = 35 + r * 15 + 6 * Math.sin(t * 0.4 + r * 1.8);
    const col = ringColors[r];

    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (30 + 20 * p1) : (8 + 5 * p1);
      const weight = layer === 0 ? (0.5 + 0.3 * p1) : (1.5 + 1.0 * p1);
      stroke(col[0], col[1], col[2], alpha);
      strokeWeight(weight);

      push();
      rotateX(a);
      rotateY(a * 0.618);
      rotateZ(a * 0.382);
      beginShape();
      for (let i = 0; i <= 60; i++) {
        const ang = (i / 60) * TWO_PI;
        vertex(Math.cos(ang) * ringR, 0, Math.sin(ang) * ringR);
      }
      endShape();
      pop();
    }
  }

  pop();
}

/* ───────────────────── Draw Helix Strands ───────────────────── */
function drawHelixStrands(t) {
  push();
  noFill();

  const numStrands = 3;
  const strandColors = [IMAG_POS, JULIA_COL, EULER_COL];

  for (let s = 0; s < numStrands; s++) {
    const phaseOff = (s / numStrands) * TWO_PI;
    const col = strandColors[s];

    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? 30 : 8;
      const weight = layer === 0 ? 0.5 : 1.5;
      stroke(col[0], col[1], col[2], alpha);
      strokeWeight(weight);

      beginShape();
      for (let i = 0; i <= 200; i++) {
        const f = i / 200;
        const y = -400 + f * 800;
        const helixAngle = f * TWO_PI * 4 + t * 0.3 + phaseOff;
        const r = 60 + 20 * Math.sin(f * PI * 2 + t * 0.2);
        const x = Math.cos(helixAngle) * r;
        const z = Math.sin(helixAngle) * r;
        vertex(x, y, z);
      }
      endShape();
    }
  }

  pop();
}

/* ───────────────────── Draw Ground Ripples ───────────────────── */
function drawRipples(t) {
  push();
  noFill();

  for (let w = 0; w < 5; w++) {
    const phase = (t * 0.06 + w * 0.2) % 1.0;
    const R = phase * 350;
    const alpha = (1 - phase) * 20;
    if (alpha < 1.5) continue;

    for (let layer = 0; layer < 2; layer++) {
      const lAlpha = layer === 0 ? alpha : alpha * 0.2;
      const lWeight = layer === 0 ? 0.3 : 1.0;
      stroke(EULER_COL[0], EULER_COL[1], EULER_COL[2], lAlpha);
      strokeWeight(lWeight);

      beginShape();
      for (let i = 0; i <= 80; i++) {
        const a = (i / 80) * TWO_PI;
        const wobble = Math.sin(a * 6 + t * 0.5 + w) * 5 * phase;
        vertex(Math.cos(a) * (R + wobble), 200, Math.sin(a) * (R + wobble));
      }
      endShape();
    }
  }

  pop();
}

/* ───────────────────── Draw Vertical Beams ───────────────────── */
function drawBeams(t) {
  push();
  noFill();

  for (let i = 0; i < NUM_TOWERS; i++) {
    const tw = towers[i];
    const pulse = 0.3 + 0.7 * Math.sin(t * 0.6 + tw.phase);
    const breathe = 1 + 0.05 * Math.sin(t * 0.3 + tw.phase);

    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (10 + 12 * pulse) : (3 + 4 * pulse);
      const weight = layer === 0 ? (0.3 + 0.2 * pulse) : (1.2 + 0.5 * pulse);
      stroke(tw.col[0], tw.col[1], tw.col[2], alpha);
      strokeWeight(weight);
      const bx = tw.x * breathe;
      const bz = tw.z * breathe;
      line(bx, -400, bz, bx, 300, bz);
    }
  }

  pop();
}

/* ───────────────────── p5 Setup ───────────────────── */
function setup() {
  pixelDensity(1);
  setAttributes("preserveDrawingBuffer", true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);

  captureCanvas = document.createElement("canvas");
  captureCanvas.width = W;
  captureCanvas.height = H;
  captureCtx = captureCanvas.getContext("2d");

  buildTowers();
  buildFilaments();
  buildShards();
  buildLatticeNodes();
  buildDust();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS;
  background(BG[0], BG[1], BG[2]);

  // Camera — slow cinematic orbit
  const camAngle = t * 0.04;
  const camR = 500 + 80 * Math.sin(t * 0.02);
  const camY = -120 - 150 * Math.sin(t * 0.035);
  const lookY = 0 + 50 * Math.sin(t * 0.025);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, lookY, 0,
    0, 1, 0
  );

  // Lighting
  ambientLight(5, 6, 14);
  pointLight(EULER_COL[0] * 0.2, EULER_COL[1] * 0.2, EULER_COL[2] * 0.2, 0, -400, 0);
  pointLight(IMAG_POS[0] * 0.15, IMAG_POS[1] * 0.15, IMAG_POS[2] * 0.15, 300, -100, -300);
  pointLight(JULIA_COL[0] * 0.15, JULIA_COL[1] * 0.15, JULIA_COL[2] * 0.15, -250, 100, 250);
  pointLight(UNITY[0] * 0.06, UNITY[1] * 0.06, UNITY[2] * 0.06, 0, 300, 0);

  // Draw all layers
  drawDust(t);
  drawRipples(t);
  drawBeams(t);
  drawLattice(t);
  drawTowers(t);
  drawHelixStrands(t);
  drawFilaments(t);
  drawShards(t);
  drawCore(t);

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

/* ───────────────────── Input ───────────────────── */
function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  return true;
}

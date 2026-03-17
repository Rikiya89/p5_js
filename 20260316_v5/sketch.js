"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette (black & white) ───────────────────── */
const BG = [0, 0, 0];
const WHITE = [255, 255, 255];
const LIGHT = [200, 200, 200];
const MID   = [140, 140, 140];
const DIM   = [90, 90, 90];
const DARK  = [50, 50, 50];
const COMMUNITY_COLORS = [WHITE, LIGHT, MID, WHITE, LIGHT, MID];

/* ───────────────────── Network Config ───────────────────── */
const NODE_COUNT = 80;
const COMMUNITY_COUNT = 5;
const SIGNAL_SPEED = 0.015;
const SIGNAL_SPAWN_RATE = 0.03;

/* ───────────────────── State ───────────────────── */
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "network_theory_20260316.mp4";

let fc = 0;
let captureCanvas = null;
let captureCtx = null;

let nodes = [];
let edges = [];
let signals = [];
let rng;

/* ───────────────────── Recording Boilerplate ───────────────────── */
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
    error: (err) => { console.error(err); setStatus("Encoder error"); isRecording = false; },
  });
  encoder.configure({
    codec: "avc1.640028", width: W, height: H,
    bitrate: 16_000_000, framerate: FPS,
  });
  fc = 0;
  recordingFrameCount = 0;
  isRecording = true;
  clearDownloadLink();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  updateDownloadButton(false);
  setStatus("Recording...");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing...");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  setDownloadLink(url, latestRecordingFilename);
  updateDownloadButton(true);
  triggerDownload(url, latestRecordingFilename);
  encoder.close(); encoder = null; muxer = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("MP4 ready.");
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

/* ───────────────────── Utilities ───────────────────── */
function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function dist3d(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/* ───────────────────── Network Construction ───────────────────── */
function buildNetwork() {
  rng = makeRng(20260316);
  nodes = [];
  edges = [];
  signals = [];

  // Community centers arranged in 3D
  const centers = [];
  for (let c = 0; c < COMMUNITY_COUNT; c++) {
    const angle = (c / COMMUNITY_COUNT) * TWO_PI + rng() * 0.4;
    const r = 120 + rng() * 100;
    const yOff = (rng() - 0.5) * 200;
    centers.push({
      x: Math.cos(angle) * r,
      y: yOff,
      z: Math.sin(angle) * r,
    });
  }

  // Distribute nodes around community centers
  for (let i = 0; i < NODE_COUNT; i++) {
    const community = Math.floor(rng() * COMMUNITY_COUNT);
    const ctr = centers[community];
    const spread = 80 + rng() * 60;

    // Spherical distribution
    const theta = rng() * TWO_PI;
    const phi = Math.acos(2 * rng() - 1);
    const r = spread * Math.cbrt(rng());

    nodes.push({
      x: ctr.x + r * Math.sin(phi) * Math.cos(theta),
      y: ctr.y + r * Math.sin(phi) * Math.sin(theta),
      z: ctr.z + r * Math.cos(phi),
      community,
      degree: 0,
      activation: 0,
      baseSize: 3 + rng() * 4,
      orbitSpeed: (rng() - 0.5) * 0.15,
      orbitRadius: rng() * 8,
      orbitPhase: rng() * TWO_PI,
    });
  }

  // Barabási–Albert preferential attachment
  const seedSize = 5;
  for (let i = 0; i < seedSize; i++) {
    for (let j = i + 1; j < seedSize; j++) {
      addEdge(i, j);
    }
  }

  for (let i = seedSize; i < NODE_COUNT; i++) {
    const edgesToAdd = Math.min(2 + Math.floor(rng() * 2), seedSize);
    const candidates = [];

    for (let j = 0; j < i; j++) {
      let weight = nodes[j].degree + 1;
      if (nodes[j].community === nodes[i].community) weight *= 3;
      const d = dist3d(nodes[i], nodes[j]);
      if (d < 250) weight *= 2;
      candidates.push({ index: j, weight });
    }

    const totalWeight = candidates.reduce((s, c) => s + c.weight, 0);
    const selected = new Set();

    for (let e = 0; e < edgesToAdd && selected.size < candidates.length; e++) {
      let pick = rng() * totalWeight;
      for (const c of candidates) {
        if (selected.has(c.index)) continue;
        pick -= c.weight;
        if (pick <= 0) {
          selected.add(c.index);
          addEdge(i, c.index);
          break;
        }
      }
    }
  }

  // Small-world bridge edges between communities
  for (let i = 0; i < NODE_COUNT; i++) {
    if (rng() < 0.08) {
      let bestJ = -1, bestDist = Infinity;
      for (let j = 0; j < NODE_COUNT; j++) {
        if (i === j || nodes[j].community === nodes[i].community) continue;
        const d = dist3d(nodes[i], nodes[j]);
        if (d < bestDist) { bestDist = d; bestJ = j; }
      }
      if (bestJ >= 0) addEdge(i, bestJ);
    }
  }
}

function addEdge(a, b) {
  for (const e of edges) {
    if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return;
  }
  edges.push({ a, b });
  nodes[a].degree++;
  nodes[b].degree++;
}

/* ───────────────────── Signal System ───────────────────── */
function spawnSignal() {
  if (edges.length === 0) return;
  const edgeIdx = Math.floor(rng() * edges.length);
  const e = edges[edgeIdx];
  const dir = rng() < 0.5 ? 1 : -1;
  signals.push({
    edge: edgeIdx,
    progress: dir > 0 ? 0 : 1,
    dir,
    color: COMMUNITY_COLORS[nodes[e.a].community],
    alive: true,
    speed: SIGNAL_SPEED * (0.7 + rng() * 0.6),
  });
}

function updateSignals() {
  for (let i = signals.length - 1; i >= 0; i--) {
    const s = signals[i];
    s.progress += s.dir * s.speed;

    if (s.progress >= 1 || s.progress <= 0) {
      const e = edges[s.edge];
      const destNode = s.dir > 0 ? e.b : e.a;
      nodes[destNode].activation = 1.0;

      // Cascade propagation (35% chance)
      if (rng() < 0.35) {
        const nextEdges = [];
        for (let j = 0; j < edges.length; j++) {
          if (j === s.edge) continue;
          if (edges[j].a === destNode || edges[j].b === destNode) {
            nextEdges.push(j);
          }
        }
        if (nextEdges.length > 0) {
          const pick = nextEdges[Math.floor(rng() * nextEdges.length)];
          const ne = edges[pick];
          const newDir = ne.a === destNode ? 1 : -1;
          signals.push({
            edge: pick,
            progress: newDir > 0 ? 0 : 1,
            dir: newDir,
            color: s.color,
            alive: true,
            speed: s.speed * 0.9,
          });
        }
      }
      s.alive = false;
    }
  }

  signals = signals.filter(s => s.alive);
  if (signals.length > 120) signals.splice(0, signals.length - 120);
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

  buildNetwork();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS;

  background(0);

  // Camera orbits the network
  const camAngle = t * 0.12;
  const camR = 480 + 60 * Math.sin(t * 0.08);
  const camY = -50 + 120 * Math.sin(t * 0.15);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, 0, 0,
    0, 1, 0
  );

  // Lighting (white-only for B&W)
  ambientLight(30);
  pointLight(220, 220, 220, 0, -300, 0);
  pointLight(120, 120, 120, 300, 100, -200);

  // Spawn signals
  if (Math.random() < SIGNAL_SPAWN_RATE) spawnSignal();
  if (Math.random() < SIGNAL_SPAWN_RATE * 0.5) spawnSignal();
  updateSignals();

  // Animate node positions (gentle drift)
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    n._dx = n.x + n.orbitRadius * Math.cos(t * n.orbitSpeed + n.orbitPhase);
    n._dy = n.y + n.orbitRadius * Math.sin(t * n.orbitSpeed * 0.7 + n.orbitPhase);
    n._dz = n.z + n.orbitRadius * Math.sin(t * n.orbitSpeed * 1.3 + n.orbitPhase + 1.0);
    n.activation *= 0.96;
  }

  // ── Edges ──
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const col = COMMUNITY_COLORS[na.community];
    const activity = Math.max(na.activation, nb.activation);
    const baseAlpha = 20 + activity * 60;

    stroke(col[0], col[1], col[2], baseAlpha);
    strokeWeight(0.5 + activity * 1.5);
    line(na._dx, na._dy, na._dz, nb._dx, nb._dy, nb._dz);
  }

  // ── Signals (traveling pulses) ──
  noStroke();
  for (const s of signals) {
    const e = edges[s.edge];
    const na = nodes[e.a];
    const nb = nodes[e.b];
    const p = s.progress;

    const sx = lerp(na._dx, nb._dx, p);
    const sy = lerp(na._dy, nb._dy, p);
    const sz = lerp(na._dz, nb._dz, p);

    const col = s.color;
    for (let g = 2; g >= 0; g--) {
      const size = 3 + g * 4;
      const a = g === 0 ? 220 : g === 1 ? 60 : 20;
      push();
      translate(sx, sy, sz);
      emissiveMaterial(col[0] * a / 255, col[1] * a / 255, col[2] * a / 255);
      ambientMaterial(col[0] * 0.1, col[1] * 0.1, col[2] * 0.1);
      sphere(size, 6, 6);
      pop();
    }
  }

  // ── Nodes ──
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const col = COMMUNITY_COLORS[n.community];
    const hubScale = 1.0 + Math.min(n.degree, 10) * 0.25;
    const size = n.baseSize * hubScale;
    const act = n.activation;
    const brightness = 0.3 + 0.7 * act;

    push();
    translate(n._dx, n._dy, n._dz);

    // Activation glow halo
    if (act > 0.1) {
      noStroke();
      const glowSize = size * (2 + act * 2);
      emissiveMaterial(col[0] * act * 0.3, col[1] * act * 0.3, col[2] * act * 0.3);
      ambientMaterial(0);
      sphere(glowSize, 6, 6);
    }

    // Core sphere
    noStroke();
    emissiveMaterial(
      col[0] * brightness * 0.5,
      col[1] * brightness * 0.5,
      col[2] * brightness * 0.5
    );
    ambientMaterial(col[0] * 0.4, col[1] * 0.4, col[2] * 0.4);
    sphere(size, 8, 8);

    // Hub ring for high-degree nodes
    if (n.degree >= 5) {
      rotateX(HALF_PI);
      rotateZ(t * 0.5 + i);
      noFill();
      stroke(col[0], col[1], col[2], 40 + act * 100);
      strokeWeight(0.6);
      torus(size * 1.8, 0.4, 16, 6);
    }

    pop();
  }

  // ── Ambient floating particles ──
  noStroke();
  for (let i = 0; i < 40; i++) {
    const seed = i * 7.31;
    const px = 300 * Math.sin(t * 0.05 + seed);
    const py = 300 * Math.cos(t * 0.07 + seed * 1.3) - 50;
    const pz = 300 * Math.sin(t * 0.06 + seed * 2.1);
    const flicker = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2 + seed));

    push();
    translate(px, py, pz);
    const v = 255 * flicker * 0.15;
    emissiveMaterial(v, v, v);
    ambientMaterial(0);
    sphere(1.2, 4, 4);
    pop();
  }

  // ── Central network core glow ──
  {
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.8);
    push();
    noStroke();
    const gv = 255 * 0.04 * pulse;
    emissiveMaterial(gv, gv, gv);
    ambientMaterial(0);
    sphere(40, 12, 12);
    pop();
  }

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

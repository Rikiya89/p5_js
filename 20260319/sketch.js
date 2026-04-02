"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette ───────────────────── */
const BG_DEEP   = [13, 31, 45];
const BG_FOREST = [10, 61, 46];
const BG_SLATE  = [41, 48, 57];
const BG_MOSS   = [40, 54, 49];

const MINT      = [0, 255, 135];
const CYAN      = [0, 212, 255];
const VIOLET    = [123, 47, 255];
const MAGENTA   = [255, 45, 122];
const PALE_MINT = [176, 255, 232];
const PALE_CYAN = [196, 240, 255];

// Erdős number shell colors: 0=core → 6=outer
const SHELL_COLORS = [
  MAGENTA,    // 0 — Erdős himself
  VIOLET,     // 1 — direct co-authors
  CYAN,       // 2
  MINT,       // 3
  PALE_CYAN,  // 4
  PALE_MINT,  // 5
  [220, 220, 240], // 6 — far periphery
];

/* ───────────────────── Graph Config ───────────────────── */
const NUM_SHELLS = 7;
const NODES_PER_SHELL = [1, 8, 18, 32, 48, 64, 80];
const SHELL_RADII = [0, 55, 115, 180, 250, 320, 395];
const EDGE_DENSITY = 0.35; // fraction of possible cross-shell edges

/* ───────────────────── State ───────────────────── */
let muxer = null, encoder = null, isRecording = false, recordingFrameCount = 0;
let canvasEl = null, latestRecordingUrl = "";
let latestRecordingFilename = "erdos_number_20260319.mp4";
let fc = 0, captureCanvas = null, captureCtx = null;

let nodes = [];   // { shell, idx, x,y,z, phase, freq, orbR }
let edges = [];   // { a, b } — indices into nodes[]
let flowParts = []; // particles traveling along edges

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

/* ───────────────────── Blend BG ───────────────────── */
function getBgColor(t) {
  const bgs = [BG_DEEP, BG_FOREST, BG_SLATE, BG_MOSS];
  const cycle = (t * 0.03) % bgs.length;
  const i0 = Math.floor(cycle) % bgs.length;
  const i1 = (i0 + 1) % bgs.length;
  const frac = cycle - Math.floor(cycle);
  const s = frac * frac * (3 - 2 * frac);
  return [
    bgs[i0][0] + (bgs[i1][0] - bgs[i0][0]) * s,
    bgs[i0][1] + (bgs[i1][1] - bgs[i0][1]) * s,
    bgs[i0][2] + (bgs[i1][2] - bgs[i0][2]) * s,
  ];
}

/* ───────────────────── Build Graph ───────────────────── */
function buildGraph() {
  const rng = makeRng(20260319);
  nodes = [];
  edges = [];

  // Create nodes on spherical shells
  for (let shell = 0; shell < NUM_SHELLS; shell++) {
    const n = NODES_PER_SHELL[shell];
    const R = SHELL_RADII[shell];
    for (let i = 0; i < n; i++) {
      // Fibonacci sphere distribution for even spacing
      const golden = (1 + Math.sqrt(5)) / 2;
      const theta = Math.acos(1 - 2 * (i + 0.5) / n);
      const phi = 2 * Math.PI * i / golden;
      // Add slight randomness for organic look
      const jitterT = (rng() - 0.5) * 0.15;
      const jitterP = (rng() - 0.5) * 0.3;
      const t = theta + jitterT;
      const p = phi + jitterP;

      nodes.push({
        shell,
        idx: i,
        baseX: R * Math.sin(t) * Math.cos(p),
        baseY: R * Math.cos(t),
        baseZ: R * Math.sin(t) * Math.sin(p),
        x: 0, y: 0, z: 0,
        phase: rng() * Math.PI * 2,
        freq: 0.2 + rng() * 0.4,
        orbR: 3 + rng() * 8,       // gentle orbital wobble
        breathPhase: rng() * Math.PI * 2,
        size: shell === 0 ? 12 : Math.max(2, 7 - shell),
      });
    }
  }

  // Build edges between adjacent shells
  for (let shell = 0; shell < NUM_SHELLS - 1; shell++) {
    const parentNodes = nodes.filter(n => n.shell === shell);
    const childNodes = nodes.filter(n => n.shell === shell + 1);

    for (const child of childNodes) {
      // Connect to 1-3 parent nodes (each mathematician has collaborators)
      const numConnections = 1 + Math.floor(rng() * 2.5);
      // Sort parents by distance and pick closest ones with some randomness
      const sorted = parentNodes
        .map(p => ({
          node: p,
          dist: Math.hypot(child.baseX - p.baseX, child.baseY - p.baseY, child.baseZ - p.baseZ),
        }))
        .sort((a, b) => a.dist - b.dist);

      for (let c = 0; c < Math.min(numConnections, sorted.length); c++) {
        const parentIdx = nodes.indexOf(sorted[c].node);
        const childIdx = nodes.indexOf(child);
        if (rng() < EDGE_DENSITY + (shell === 0 ? 0.6 : 0)) {
          edges.push({ a: parentIdx, b: childIdx });
        }
      }
    }

    // A few skip-connections (shell → shell+2) for visual richness
    if (shell < NUM_SHELLS - 2) {
      const grandchildren = nodes.filter(n => n.shell === shell + 2);
      for (const gc of grandchildren) {
        if (rng() < 0.06) {
          const sorted = parentNodes
            .map(p => ({
              node: p,
              dist: Math.hypot(gc.baseX - p.baseX, gc.baseY - p.baseY, gc.baseZ - p.baseZ),
            }))
            .sort((a, b) => a.dist - b.dist);
          if (sorted.length > 0) {
            edges.push({ a: nodes.indexOf(sorted[0].node), b: nodes.indexOf(gc) });
          }
        }
      }
    }
  }

  // Build flow particles along edges
  flowParts = [];
  for (let i = 0; i < 120; i++) {
    flowParts.push({
      edgeIdx: Math.floor(rng() * edges.length),
      t: rng(),
      speed: 0.003 + rng() * 0.008,
      size: 1.5 + rng() * 2.5,
      dir: rng() < 0.3 ? -1 : 1, // mostly outward, some inward
    });
  }
}

/* ───────────────────── Update node positions ───────────────────── */
function updateNodes(t) {
  for (const n of nodes) {
    const wobble = Math.sin(t * n.freq + n.phase) * n.orbR;
    const wobble2 = Math.cos(t * n.freq * 0.7 + n.phase * 1.3) * n.orbR * 0.6;
    const breathe = 1.0 + 0.04 * Math.sin(t * 0.15 + n.breathPhase) * (n.shell + 1);
    n.x = n.baseX * breathe + wobble;
    n.y = n.baseY * breathe + wobble2;
    n.z = n.baseZ * breathe + Math.sin(t * n.freq * 0.5 + n.phase * 2) * n.orbR * 0.4;
  }
}

/* ───────────────────── Draw Shells (transparent sphere outlines) ───────────────────── */
function drawShells(t) {
  push();
  noFill();

  for (let shell = 1; shell < NUM_SHELLS; shell++) {
    const col = SHELL_COLORS[shell];
    const R = SHELL_RADII[shell];
    const breathe = 1.0 + 0.04 * Math.sin(t * 0.15) * (shell + 1);
    const alpha = 12 + 6 * Math.sin(t * 0.2 + shell);

    // Draw latitude rings
    stroke(col[0], col[1], col[2], alpha);
    strokeWeight(0.5);
    for (let lat = 1; lat < 4; lat++) {
      const theta = (lat / 4) * Math.PI;
      const ringR = R * breathe * Math.sin(theta);
      const ringY = R * breathe * Math.cos(theta);
      beginShape();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * TWO_PI;
        vertex(Math.cos(a) * ringR, ringY, Math.sin(a) * ringR);
      }
      endShape();
    }

    // Equatorial ring brighter
    stroke(col[0], col[1], col[2], alpha * 2);
    strokeWeight(0.8);
    beginShape();
    for (let i = 0; i <= 80; i++) {
      const a = (i / 80) * TWO_PI;
      vertex(Math.cos(a) * R * breathe, 0, Math.sin(a) * R * breathe);
    }
    endShape();
  }

  pop();
}

/* ───────────────────── Draw Edges ───────────────────── */
function drawEdges(t) {
  push();
  noFill();

  for (const edge of edges) {
    const na = nodes[edge.a];
    const nb = nodes[edge.b];
    const shellA = na.shell;
    const shellB = nb.shell;

    // Color blend between the two shells
    const colA = SHELL_COLORS[shellA];
    const colB = SHELL_COLORS[shellB];

    // Pulse alpha based on time + position
    const midX = (na.x + nb.x) * 0.5;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.6 + midX * 0.01);
    const alpha = 25 + 30 * pulse;

    stroke(
      (colA[0] + colB[0]) * 0.5,
      (colA[1] + colB[1]) * 0.5,
      (colA[2] + colB[2]) * 0.5,
      alpha
    );
    strokeWeight(0.6 + 0.4 * pulse);

    // Draw as a slightly curved line (3-point bezier approximation)
    const mx = (na.x + nb.x) * 0.5;
    const my = (na.y + nb.y) * 0.5;
    const mz = (na.z + nb.z) * 0.5;
    // Push midpoint outward slightly for curve
    const dist = Math.hypot(mx, my, mz);
    const normF = dist > 0 ? 1.08 / dist : 0;
    const cx = mx * (1 + normF * 8);
    const cy = my * (1 + normF * 8);
    const cz = mz * (1 + normF * 8);

    beginShape();
    vertex(na.x, na.y, na.z);
    vertex(cx, cy, cz);
    vertex(nb.x, nb.y, nb.z);
    endShape();
  }

  pop();
}

/* ───────────────────── Draw Nodes ───────────────────── */
function drawNodes(t) {
  noStroke();

  for (const n of nodes) {
    const col = SHELL_COLORS[n.shell];
    const pulse = 0.6 + 0.4 * Math.sin(t * 1.2 + n.phase);

    push();
    translate(n.x, n.y, n.z);

    // Outer glow
    emissiveMaterial(
      col[0] * 0.12 * pulse,
      col[1] * 0.12 * pulse,
      col[2] * 0.12 * pulse
    );
    sphere(n.size * 1.8, 6, 6);

    // Core
    emissiveMaterial(
      col[0] * 0.4 * (0.7 + 0.3 * pulse),
      col[1] * 0.4 * (0.7 + 0.3 * pulse),
      col[2] * 0.4 * (0.7 + 0.3 * pulse)
    );
    sphere(n.size, 8, 8);

    pop();
  }
}

/* ───────────────────── Draw Erdős Core ───────────────────── */
function drawErdosCore(t) {
  const n = nodes[0]; // Erdős = first node
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.5);
  const pulse2 = 0.5 + 0.5 * Math.sin(t * 2.3);

  push();
  translate(n.x, n.y, n.z);

  // Large outer aura
  noStroke();
  emissiveMaterial(
    MAGENTA[0] * 0.06 * pulse,
    MAGENTA[1] * 0.06 * pulse,
    MAGENTA[2] * 0.06 * pulse
  );
  sphere(40 + 10 * pulse, 12, 12);

  // Mid glow
  emissiveMaterial(
    MAGENTA[0] * 0.15 * pulse2,
    MAGENTA[1] * 0.15 * pulse2,
    MAGENTA[2] * 0.15 * pulse2
  );
  sphere(22 + 5 * pulse2, 10, 10);

  // Bright core
  emissiveMaterial(
    MAGENTA[0] * 0.6,
    MAGENTA[1] * 0.6,
    MAGENTA[2] * 0.6
  );
  sphere(10, 10, 10);

  // Rotating rings around core
  noFill();
  for (let r = 0; r < 3; r++) {
    const a = t * (1.2 + r * 0.4) + r * 1.2;
    const ringR = 28 + r * 10 + 3 * Math.sin(t * 0.8 + r);
    const col = r === 0 ? MAGENTA : r === 1 ? VIOLET : CYAN;
    stroke(col[0], col[1], col[2], 50 + 30 * pulse);
    strokeWeight(1.0 + 0.5 * pulse);

    push();
    rotateX(a);
    rotateY(a * 0.7);
    beginShape();
    for (let i = 0; i <= 50; i++) {
      const ang = (i / 50) * TWO_PI;
      vertex(Math.cos(ang) * ringR, 0, Math.sin(ang) * ringR);
    }
    endShape();
    pop();
  }

  pop();
}

/* ───────────────────── Flow Particles ───────────────────── */
function drawFlowParticles(t) {
  noStroke();

  for (const p of flowParts) {
    // Advance along edge
    p.t += p.speed * p.dir;

    // Wrap or bounce
    if (p.t > 1) { p.t = 0; p.edgeIdx = (p.edgeIdx + Math.floor(Math.random() * 3) + 1) % edges.length; }
    if (p.t < 0) { p.t = 1; p.edgeIdx = (p.edgeIdx + Math.floor(Math.random() * 3) + 1) % edges.length; }

    const edge = edges[p.edgeIdx];
    if (!edge) continue;
    const na = nodes[edge.a];
    const nb = nodes[edge.b];

    // Interpolate position along edge with slight curve
    const tt = p.t;
    const mx = (na.x + nb.x) * 0.5;
    const my = (na.y + nb.y) * 0.5;
    const mz = (na.z + nb.z) * 0.5;
    const dist = Math.hypot(mx, my, mz);
    const normF = dist > 0 ? 1.08 / dist : 0;
    const cx = mx * (1 + normF * 8);
    const cy = my * (1 + normF * 8);
    const cz = mz * (1 + normF * 8);

    // Quadratic bezier: (1-t)²A + 2(1-t)tC + t²B
    const u = 1 - tt;
    const px = u * u * na.x + 2 * u * tt * cx + tt * tt * nb.x;
    const py = u * u * na.y + 2 * u * tt * cy + tt * tt * nb.y;
    const pz = u * u * na.z + 2 * u * tt * cz + tt * tt * nb.z;

    // Color from source shell
    const shellIdx = p.dir > 0 ? na.shell : nb.shell;
    const col = SHELL_COLORS[shellIdx];
    const flicker = 0.5 + 0.5 * Math.sin(t * 4 + p.edgeIdx * 1.7);

    push();
    translate(px, py, pz);
    emissiveMaterial(
      col[0] * 0.3 * flicker,
      col[1] * 0.3 * flicker,
      col[2] * 0.3 * flicker
    );
    sphere(p.size * flicker, 5, 5);
    pop();
  }
}

/* ───────────────────── Ripple Waves ───────────────────── */
function drawRipples(t) {
  push();
  noFill();

  // Expanding spherical ripples from center
  for (let w = 0; w < 4; w++) {
    const phase = (t * 0.15 + w * 0.25) % 1.0;
    const R = phase * 450;
    const alpha = (1 - phase) * 25;
    if (alpha < 2) continue;

    stroke(MAGENTA[0], MAGENTA[1], MAGENTA[2], alpha);
    strokeWeight(0.6);

    // Equatorial ring
    beginShape();
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * TWO_PI;
      vertex(Math.cos(a) * R, 0, Math.sin(a) * R);
    }
    endShape();

    // Vertical ring
    stroke(VIOLET[0], VIOLET[1], VIOLET[2], alpha * 0.7);
    beginShape();
    for (let i = 0; i <= 60; i++) {
      const a = (i / 60) * TWO_PI;
      vertex(Math.cos(a) * R, Math.sin(a) * R, 0);
    }
    endShape();
  }

  pop();
}

/* ───────────────────── Constellation Lines (within shells) ───────────────────── */
function drawConstellations(t) {
  push();
  noFill();

  for (let shell = 1; shell < NUM_SHELLS; shell++) {
    const shellNodes = nodes.filter(n => n.shell === shell);
    const col = SHELL_COLORS[shell];
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.3 + shell * 0.8);

    stroke(col[0], col[1], col[2], 8 + 6 * pulse);
    strokeWeight(0.3);

    // Connect nearby nodes within the same shell
    for (let i = 0; i < shellNodes.length; i++) {
      const ni = shellNodes[i];
      for (let j = i + 1; j < shellNodes.length; j++) {
        const nj = shellNodes[j];
        const d = Math.hypot(ni.x - nj.x, ni.y - nj.y, ni.z - nj.z);
        if (d < SHELL_RADII[shell] * 0.7) {
          line(ni.x, ni.y, ni.z, nj.x, nj.y, nj.z);
        }
      }
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

  buildGraph();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS;
  const bg = getBgColor(t);
  background(bg[0], bg[1], bg[2]);

  // Camera — slow orbit, gently rising and falling
  const camAngle = t * 0.08;
  const camR = 620 + 80 * Math.sin(t * 0.04);
  const camY = -200 - 120 * Math.sin(t * 0.06);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, 0, 0,
    0, 1, 0
  );

  // Lighting
  ambientLight(12, 20, 18);
  pointLight(CYAN[0] * 0.3, CYAN[1] * 0.3, CYAN[2] * 0.3, 0, -500, 0);
  pointLight(VIOLET[0] * 0.2, VIOLET[1] * 0.2, VIOLET[2] * 0.2, 400, -200, -400);
  pointLight(MAGENTA[0] * 0.25, MAGENTA[1] * 0.25, MAGENTA[2] * 0.25, -300, 200, 300);

  updateNodes(t);

  drawRipples(t);
  drawShells(t);
  drawConstellations(t);
  drawEdges(t);
  drawNodes(t);
  drawFlowParticles(t);
  drawErdosCore(t);

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

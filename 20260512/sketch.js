'use strict';

// ---------------------------------------------------------------------------
// 3D Generative Art — Metatron's Cube × Mersenne Prime
//
// One unified sacred-geometry form: Metatron's Cube lifted into 3D.
// 13 nodes (1 centre + 6 inner hex + 6 outer hex), all 78 pairwise edges.
// Edges weighted by which Platonic solid they belong to:
//   Tetrahedron  → thick  / brightest
//   Cube         → medium / bright
//   Octahedron   → medium / mid
//   Icosahedron  → thin   / dim
//   Other        → hairline / very dim
//
// Mersenne tie-in:
//   M₃ = 7 = centre + 6 inner nodes = the Seed of Life (pulsed distinctly).
//   Formula shown in HUD; binary rings on right edge.
//
// Palette: black + white only. Canvas: 1080 × 1920.
// ---------------------------------------------------------------------------

const W            = 1080;
const H            = 1920;
const FPS          = 60;
const LOOP_SECONDS = 24;
const LOOP_FRAMES  = FPS * LOOP_SECONDS;

const BG = [0, 0, 0];

// ---------------------------------------------------------------------------
// Build Metatron's Cube node positions.
//
// Classic 2D layout elevated into a 3D sphere:
//   Node 0        — centre
//   Nodes 1–6    — inner hexagonal ring, radius R, flat (y=0)
//   Nodes 7–12   — outer hexagonal ring, radius 2R, alternating ±tilt
//
// The outer ring is tilted ±elevation off the horizontal plane so the form
// reads as genuinely 3D, not just a flat disc viewed at an angle.
// ---------------------------------------------------------------------------
const R     = 280;   // inner ring radius
const ELEV  = 0.38;  // outer ring elevation (radians) — ~22°

function buildNodes() {
  const nodes = [];
  // Centre
  nodes.push({ x: 0, y: 0, z: 0, ring: 0 });

  // Inner ring — 6 nodes, flat
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    nodes.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R, ring: 1 });
  }

  // Outer ring — 6 nodes, alternating elevation
  for (let i = 0; i < 6; i++) {
    const a   = (i / 6) * Math.PI * 2 + Math.PI / 6; // offset 30°
    const alt = (i % 2 === 0 ? 1 : -1) * ELEV;
    const r2  = R * 2;
    nodes.push({
      x: Math.cos(a) * r2 * Math.cos(alt),
      y: Math.sin(alt) * r2,
      z: Math.sin(a) * r2 * Math.cos(alt),
      ring: 2,
    });
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// Build all 78 edges (every pair), classify by Platonic archetype.
//
// Classification by node ring membership + distance:
//   'tet'  — short inner-to-inner connections (Tetrahedron)
//   'cube' — centre-to-outer connections (Cube / Hexahedron)
//   'oct'  — inner-to-adjacent-outer (Octahedron)
//   'icos' — outer-to-outer long diagonals (Icosahedron)
//   'base' — everything else (Dodecahedron / Fruit-of-Life)
// ---------------------------------------------------------------------------
const EDGE_STYLE = {
  tet:  { w: 3.8, br: 255, alp: 255 },
  cube: { w: 2.4, br: 240, alp: 220 },
  oct:  { w: 1.8, br: 215, alp: 185 },
  icos: { w: 1.0, br: 185, alp: 140 },
  base: { w: 0.6, br: 155, alp:  90 },
};

function classifyEdge(a, b, nodes) {
  const rA = nodes[a].ring, rB = nodes[b].ring;
  const dx = nodes[a].x - nodes[b].x;
  const dy = nodes[a].y - nodes[b].y;
  const dz = nodes[a].z - nodes[b].z;
  const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);

  if (rA === 1 && rB === 1 && d < R * 1.2)       return 'tet';
  if ((rA === 0 && rB === 2) || (rA === 2 && rB === 0)) return 'cube';
  if ((rA === 1 && rB === 2) || (rA === 2 && rB === 1) && d < R * 1.7) return 'oct';
  if (rA === 2 && rB === 2 && d < R * 2.2)        return 'icos';
  return 'base';
}

function buildEdges(nodes) {
  const edges = [];
  for (let a = 0; a < nodes.length; a++) {
    for (let b = a + 1; b < nodes.length; b++) {
      edges.push({ a, b, type: classifyEdge(a, b, nodes) });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Slow 3D rotation — Euler angles driven by time.
// One full Y rotation per loop; gentle X wobble.
// ---------------------------------------------------------------------------
function rotatePoint(p, yaw, pitch) {
  // Rotate around Y then X
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
  const x1 =  p.x * cosY + p.z * sinY;
  const z1 = -p.x * sinY + p.z * cosY;

  const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
  const y2 =  p.y * cosP - z1 * sinP;
  const z2 =  p.y * sinP + z1 * cosP;

  return { x: x1, y: y2, z: z2 };
}

// ---------------------------------------------------------------------------
// Depth fog — exponential, relative to camera distance
// ---------------------------------------------------------------------------
let camZ = 900;
function fog(z) {
  const dist = Math.abs(camZ - z);
  return Math.exp(-dist / 3000);
}

// ---------------------------------------------------------------------------
// Draw all 78 edges with Platonic-class weighting + depth fog
// ---------------------------------------------------------------------------
function drawEdges(_nodes, edges, rotated) {
  noFill();
  for (const e of edges) {
    const rA = rotated[e.a], rB = rotated[e.b];
    const midZ  = (rA.z + rB.z) * 0.5;
    const f     = fog(midZ);
    const st    = EDGE_STYLE[e.type];
    const alpha = st.alp * f;
    if (alpha < 3) continue;
    stroke(st.br, st.br, st.br, alpha);
    strokeWeight(st.w);
    line(rA.x, rA.y, rA.z, rB.x, rB.y, rB.z);
  }
}

// ---------------------------------------------------------------------------
// Additive glow pass — same edges, wide soft halo
// ---------------------------------------------------------------------------
function drawEdgeGlow(_nodes, edges, rotated) {
  noFill();
  blendMode(ADD);
  for (const e of edges) {
    if (e.type === 'base' || e.type === 'icos') continue; // glow only hero edges
    const rA = rotated[e.a], rB = rotated[e.b];
    const midZ  = (rA.z + rB.z) * 0.5;
    const f     = fog(midZ);
    const st    = EDGE_STYLE[e.type];
    stroke(255, 255, 255, st.alp * 0.6 * f);
    strokeWeight(st.w * 7.0);
    line(rA.x, rA.y, rA.z, rB.x, rB.y, rB.z);
  }
  blendMode(BLEND);
}

// ---------------------------------------------------------------------------
// Draw nodes — Seed of Life (ring 0+1, 7 nodes = M₃) brighter than outer ring
// ---------------------------------------------------------------------------
function drawNodes(rotated, time) {
  noStroke();
  for (let i = 0; i < rotated.length; i++) {
    const n      = rotated[i];
    const f      = fog(n.z);
    const isSeed = i < 7; // centre + 6 inner = Seed of Life = M₃ = 7

    // Outer glow ring
    blendMode(ADD);
    const glowR  = isSeed ? 42 : 26;
    const glowA  = isSeed ? 110 : 60;
    fill(255, 255, 255, glowA * f);
    noStroke();
    circle(n.x, n.y, glowR);

    // Bright core
    blendMode(BLEND);
    const coreR  = isSeed ? 11 : 7;
    const coreA  = isSeed ? 255 : 220;
    const pulse  = isSeed ? 1 + 0.18 * Math.sin(time * 2.3 + i * 1.1) : 1;
    fill(255, 255, 255, coreA * f * pulse);
    circle(n.x, n.y, coreR * pulse);
  }
}

// ---------------------------------------------------------------------------
// Circle overlay — the 13 Circles of Metatron (screen-plane projection).
// Each circle is centred on a projected node with radius = projected R.
// Drawn very faintly so the edge skeleton reads first.
// ---------------------------------------------------------------------------
function drawMetatronCircles(rotated) {
  noFill();
  const projR = [0, R, R * 2]; // per ring radius
  for (let i = 0; i < rotated.length; i++) {
    const n   = rotated[i];
    const f   = fog(n.z);
    const r   = projR[rotated[i].ring ?? (i === 0 ? 0 : i < 7 ? 1 : 2)];
    // Use original-ring-relative radius foreshortened by depth
    const dr  = r * (camZ / (camZ - n.z + 0.01));
    const vis = dr < 10 || dr > 800 ? 0 : f;
    if (vis < 0.01) continue;
    stroke(255, 255, 255, 38 * vis);
    strokeWeight(0.6);
    // Draw in screen XY plane (no z rotation of circle — intended)
    circle(n.x, n.y, R * 0.95);
  }
}

// ---------------------------------------------------------------------------
// Vignette (screen-space)
// ---------------------------------------------------------------------------
function drawVignette() {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);
  noFill();
  const maxR = Math.hypot(W, H) * 0.6;
  strokeWeight(maxR / 28);
  for (let i = 0; i < 28; i++) {
    const k   = i / 27;
    const alp = constrain(map(k, 0.52, 1, 0, 180), 0, 180);
    stroke(0, 0, 0, alp);
    circle(0, 0, maxR * 2 * k);
  }
  pop();
}

// ---------------------------------------------------------------------------
// HUD — Mersenne formula + binary rings
// ---------------------------------------------------------------------------
function drawHUD(time) {
  push();
  resetMatrix();
  ortho(-W / 2, W / 2, -H / 2, H / 2, -10, 10);
  noStroke();
  textFont('monospace');

  // Bottom-left: formula block
  textAlign(LEFT, BOTTOM);
  const x = -W / 2 + 32;
  const y =  H / 2 - 32;

  fill(255, 255, 255, 130);
  textSize(22);
  text('M₃ = 2³ − 1 = 7', x, y - 56);

  fill(255, 255, 255, 200);
  textSize(32);
  text('Seed of Life', x, y - 18);

  fill(255, 255, 255, 80);
  textSize(13);
  text('₂111  ·  Metatron\'s Cube  ·  13 nodes · 78 edges', x, y);

  // Right edge: binary rings (n=3 bits for M₃=7=111₂)
  const cx    = W / 2 - 52;
  const baseY = H / 2 - 110;
  const step  = 26;
  for (let bit = 0; bit < 3; bit++) {
    const yy    = baseY - bit * step;
    const pulse = 0.55 + 0.45 * Math.sin(time * 2.2 + bit * 0.9);
    const alp   = 150 + 105 * pulse;
    stroke(255, 255, 255, alp);
    strokeWeight(1.3);
    noFill();
    circle(cx, yy, 18);
    fill(255, 255, 255, alp);
    noStroke();
    circle(cx, yy, 6);
  }

  // Top-right: node count label
  noStroke();
  fill(255, 255, 255, 55);
  textAlign(RIGHT, TOP);
  textSize(11);
  text('Mₙ = 2ⁿ − 1', W / 2 - 28, -H / 2 + 28);
  text('φ = (1+√5)/2', W / 2 - 28, -H / 2 + 46);

  pop();
}

// ---------------------------------------------------------------------------
// Thin great-circle arcs — three faint rotating rings enclosing the cube.
// These are drawn in 3D space as polyline approximations of circles.
// ---------------------------------------------------------------------------
function drawGreatCircles(yaw, pitch, time) {
  noFill();
  const segs   = 120;
  const radii  = [R * 2.1, R * 2.1, R * 2.1];
  // Three orthogonal planes: XY, XZ, YZ — each tilted by the main rotation
  const planes = [
    { ax: { x:1,y:0,z:0 }, ay: { x:0,y:1,z:0 } },
    { ax: { x:1,y:0,z:0 }, ay: { x:0,y:0,z:1 } },
    { ax: { x:0,y:1,z:0 }, ay: { x:0,y:0,z:1 } },
  ];

  for (let p = 0; p < 3; p++) {
    const r    = radii[p];
    const alp  = 45 + 25 * Math.sin(time * 0.7 + p * 1.3);
    stroke(255, 255, 255, alp);
    strokeWeight(0.8);
    beginShape();
    for (let s = 0; s <= segs; s++) {
      const a  = (s / segs) * Math.PI * 2;
      const pt = {
        x: planes[p].ax.x * Math.cos(a) * r + planes[p].ay.x * Math.sin(a) * r,
        y: planes[p].ax.y * Math.cos(a) * r + planes[p].ay.y * Math.sin(a) * r,
        z: planes[p].ax.z * Math.cos(a) * r + planes[p].ay.z * Math.sin(a) * r,
      };
      const rp = rotatePoint(pt, yaw, pitch);
      vertex(rp.x, rp.y, rp.z);
    }
    endShape(CLOSE);
  }
}

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------
const NODES = buildNodes();
const EDGES = buildEdges(NODES);

// Attach ring index to each node for drawNodes()
NODES.forEach((n, i) => { n.ringIdx = i === 0 ? 0 : i < 7 ? 1 : 2; });

// ---------------------------------------------------------------------------
// setup / draw
// ---------------------------------------------------------------------------
let canvasEl;
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

function setup() {
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl  = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  setAttributes('antialias', true);
  smooth();

  const maxDurEl     = document.getElementById('maxDuration');
  const maxFramesEl  = document.getElementById('maxFrames');
  const canvasSizeEl = document.getElementById('canvasSize');
  if (maxDurEl)     maxDurEl.textContent     = LOOP_SECONDS;
  if (maxFramesEl)  maxFramesEl.textContent  = LOOP_FRAMES;
  if (canvasSizeEl) canvasSizeEl.textContent = W + ' × ' + H;
}

function draw() {
  const loop  = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const time  = loop * TWO_PI;

  background(BG[0], BG[1], BG[2]);

  // Slow rotation: one full Y revolution per loop, gentle X pitch wobble
  const yaw   = time;                              // full 2π in 24 s
  const pitch = 0.28 + 0.14 * Math.sin(time * 0.5);

  // Camera — fixed, no orbit control (one clean hero shot)
  const camDist = 2200;
  camZ = camDist;
  camera(0, 0, camDist, 0, 0, 0, 0, 1, 0);
  perspective(PI / 5.2, W / H, 10, 10000);

  // Rotate all nodes
  const rotated = NODES.map(n => {
    const rp = rotatePoint(n, yaw, pitch);
    return { ...rp, ring: n.ringIdx };
  });

  // 1. Great-circle halos (very faint, behind structure)
  drawGreatCircles(yaw, pitch, time);

  // 2. Glow pass (ADD blend, hero edges only)
  drawEdgeGlow(NODES, EDGES, rotated);

  // 3. Metatron circles (faint overlay in screen plane)
  drawMetatronCircles(rotated);

  // 4. All 78 edges, Platonic-weighted
  drawEdges(NODES, EDGES, rotated);

  // 5. Nodes — Seed of Life pulsing brighter
  drawNodes(rotated, time);

  // 6. Screen-space overlays
  drawVignette();
  drawHUD(time);

  // Recording
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingHUD();
    if (recFrameCount >= LOOP_FRAMES) stopRecording();
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function keyReleased() {
  if (key === 'r' || key === 'R') {
    if (isRecording) stopRecording(); else startRecording();
    return false;
  }
  if (key === 's' || key === 'S') {
    saveCanvas('20260512_metatron_' + timestamp(), 'png');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Recording pipeline (unchanged)
// ---------------------------------------------------------------------------
function updateRecordingHUD() {
  if (!isRecording) return;
  const durEl    = document.getElementById('duration');
  const framesEl = document.getElementById('frameCount');
  const fillEl   = document.getElementById('progressFill');
  if (durEl)    durEl.textContent    = (recFrameCount / FPS).toFixed(1);
  if (framesEl) framesEl.textContent = recFrameCount;
  if (fillEl)   fillEl.style.width   = (100 * recFrameCount / LOOP_FRAMES).toFixed(2) + '%';
}

function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  if (color) el.style.color = color;
}

function startRecording() {
  if (typeof VideoEncoder === 'undefined') { setStatus('WebCodecs unsupported · use Chrome', '#f44'); return; }
  if (typeof Mp4Muxer    === 'undefined') { setStatus('mp4-muxer not loaded', '#f44'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); }
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W, height: H,
    bitrate: 18_000_000,
    framerate: FPS
  });

  recFrameCount = 0;
  isRecording   = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording…', '#fff');
  updateRecordingHUD();
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus('Finalizing…', '#ccc');
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = '20260512_metatron_' + timestamp() + '.mp4'; a.click();

  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1000000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function timestamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_`
       + `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

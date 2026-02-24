// Recursive Monolith — 3D Generative Art
// Theme: Black & White  |  Engine: p5.js 2.1  |  Canvas: 1080×1920

"use strict";

const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP = MAX_FRAMES;

// ── Recording state ───────────────────────────────────────────────────────────
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let fc = 0;

// ── Scene data ────────────────────────────────────────────────────────────────
let lattice = [];
let particles = [];
const NUM_PARTICLES = 180;
let icoVerts = [];
let icoFaces = [];

// ── Setup ─────────────────────────────────────────────────────────────────────
function setup() {
  createCanvas(W, H, WEBGL);
  frameRate(FPS);
  buildIcosahedron();
  buildLattice();
  for (let i = 0; i < NUM_PARTICLES; i++) particles.push(makeParticle());
}

// ── Main draw ─────────────────────────────────────────────────────────────────
function draw() {
  const phase = (fc % LOOP) / LOOP;
  fc++;

  background(0);

  // Camera — slow full orbit
  const camR   = 800;
  const camTh  = phase * TWO_PI;
  const camPhi = 0.30 + sin(phase * TWO_PI) * 0.10;
  camera(
    camR * sin(camPhi) * cos(camTh),
    -camR * cos(camPhi),
    camR * sin(camPhi) * sin(camTh),
    0, 0, 0,
    0, 1, 0
  );
  perspective(PI / 3.5, W / H, 1, 9000);

  noFill();

  // ── Central torus ─────────────────────────────────────────────────────────
  push();
  rotateX(phase * TWO_PI * 0.37);
  rotateY(phase * TWO_PI * 0.23);
  const pulse = 1 + 0.07 * sin(phase * TWO_PI * 4);
  drawTorus(220 * pulse, 48, 36, 12, 255, 255, 255, 255, 1.5);
  pop();

  // Inner torus
  push();
  rotateX(HALF_PI + phase * TWO_PI * 0.15);
  rotateZ(phase * TWO_PI * 0.29);
  drawTorus(115, 24, 28, 9, 200, 200, 200, 255, 1.0);
  pop();

  // ── Icosahedra ────────────────────────────────────────────────────────────
  push();
  rotateX(phase * TWO_PI * 0.09);
  rotateY(phase * TWO_PI * 0.14);
  rotateZ(phase * TWO_PI * 0.06);
  drawIco(295, 255, 255, 255, 230, 1.3);
  pop();

  push();
  rotateX(-phase * TWO_PI * 0.05);
  rotateY(-phase * TWO_PI * 0.08);
  drawIco(490, 255, 255, 255, 60, 0.8);
  pop();

  // ── Lattice cubes ─────────────────────────────────────────────────────────
  for (let c of lattice) {
    push();
    translate(c.x, c.y, c.z);
    rotateX(phase * TWO_PI * c.sx + c.ox);
    rotateY(phase * TWO_PI * c.sy + c.oy);
    rotateZ(phase * TWO_PI * c.sz + c.oz);
    stroke(255, 255, 255, c.alpha);
    strokeWeight(c.sw);
    drawBox(c.size);
    pop();
  }

  // ── Orbital rings ─────────────────────────────────────────────────────────
  drawRing(phase, 360, 56, 0,      255, 255, 255, 210, 1.5);
  drawRing(phase, 265, 42, PI/5,   255, 255, 255, 150, 1.1);
  drawRing(phase, 440, 68, PI/3,   255, 255, 255,  90, 0.9);

  // ── Particles ─────────────────────────────────────────────────────────────
  strokeWeight(3);
  for (let p of particles) {
    tickParticle(p);
    stroke(255, 255, 255, p.alpha);
    point(p.x, p.y, p.z);
  }

  // ── Ground grid ───────────────────────────────────────────────────────────
  drawGrid(phase);

  // ── Recording ─────────────────────────────────────────────────────────────
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ── Wireframe draw helpers (all use line()) ───────────────────────────────────

function drawBox(sz) {
  const h = sz / 2;
  const v = [
    [-h,-h,-h], [ h,-h,-h], [ h, h,-h], [-h, h,-h],
    [-h,-h, h], [ h,-h, h], [ h, h, h], [-h, h, h]
  ];
  // 12 edges
  line(v[0][0],v[0][1],v[0][2], v[1][0],v[1][1],v[1][2]);
  line(v[1][0],v[1][1],v[1][2], v[2][0],v[2][1],v[2][2]);
  line(v[2][0],v[2][1],v[2][2], v[3][0],v[3][1],v[3][2]);
  line(v[3][0],v[3][1],v[3][2], v[0][0],v[0][1],v[0][2]);
  line(v[4][0],v[4][1],v[4][2], v[5][0],v[5][1],v[5][2]);
  line(v[5][0],v[5][1],v[5][2], v[6][0],v[6][1],v[6][2]);
  line(v[6][0],v[6][1],v[6][2], v[7][0],v[7][1],v[7][2]);
  line(v[7][0],v[7][1],v[7][2], v[4][0],v[4][1],v[4][2]);
  line(v[0][0],v[0][1],v[0][2], v[4][0],v[4][1],v[4][2]);
  line(v[1][0],v[1][1],v[1][2], v[5][0],v[5][1],v[5][2]);
  line(v[2][0],v[2][1],v[2][2], v[6][0],v[6][1],v[6][2]);
  line(v[3][0],v[3][1],v[3][2], v[7][0],v[7][1],v[7][2]);
}

function drawTorus(R, r, sides, rings, sr, sg, sb, sa, sw) {
  stroke(sr, sg, sb, sa);
  strokeWeight(sw);
  for (let i = 0; i < rings; i++) {
    const a0 = (i / rings) * TWO_PI;
    const a1 = ((i + 1) / rings) * TWO_PI;
    for (let j = 0; j < sides; j++) {
      const b0 = (j / sides) * TWO_PI;
      const b1 = ((j + 1) / sides) * TWO_PI;
      const x00 = (R + r * cos(b0)) * cos(a0);
      const y00 =  r * sin(b0);
      const z00 = (R + r * cos(b0)) * sin(a0);
      const x01 = (R + r * cos(b1)) * cos(a0);
      const y01 =  r * sin(b1);
      const z01 = (R + r * cos(b1)) * sin(a0);
      const x10 = (R + r * cos(b0)) * cos(a1);
      const y10 =  r * sin(b0);
      const z10 = (R + r * cos(b0)) * sin(a1);
      line(x00, y00, z00, x01, y01, z01); // side ring
      line(x00, y00, z00, x10, y10, z10); // longitude
    }
  }
}

function drawIco(radius, sr, sg, sb, sa, sw) {
  stroke(sr, sg, sb, sa);
  strokeWeight(sw);
  for (let [ai, bi, ci] of icoFaces) {
    const a = icoVerts[ai], b = icoVerts[bi], c = icoVerts[ci];
    line(a.x*radius, a.y*radius, a.z*radius, b.x*radius, b.y*radius, b.z*radius);
    line(b.x*radius, b.y*radius, b.z*radius, c.x*radius, c.y*radius, c.z*radius);
    line(c.x*radius, c.y*radius, c.z*radius, a.x*radius, a.y*radius, a.z*radius);
  }
}

function drawRing(phase, radius, count, tilt, sr, sg, sb, sa, sw) {
  push();
  rotateX(tilt);
  rotateY(phase * TWO_PI * 0.20);
  stroke(sr, sg, sb, sa);
  strokeWeight(sw);
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * TWO_PI;
    pts.push([cos(a) * radius, sin(a) * radius * 0.20, sin(a) * radius]);
  }
  for (let i = 0; i < count; i++) {
    line(pts[i][0], pts[i][1], pts[i][2], pts[i+1][0], pts[i+1][1], pts[i+1][2]);
  }
  // Bright accent nodes
  strokeWeight(sw * 4);
  for (let i = 0; i < count; i += 5) {
    point(pts[i][0], pts[i][1], pts[i][2]);
  }
  pop();
}

function drawGrid(phase) {
  const Y    = 480;
  const STEP = 80;
  const COLS = 14;
  const ROWS = 22;
  const scroll = (phase * STEP * 2) % STEP;
  stroke(255, 255, 255, 35);
  strokeWeight(0.6);
  const ox = -(COLS / 2) * STEP;
  const oz = -(ROWS / 2) * STEP;
  for (let r = 0; r <= ROWS + 1; r++) {
    const z = oz + r * STEP - scroll;
    line(ox, Y, z,  ox + COLS * STEP, Y, z);
  }
  for (let c = 0; c <= COLS; c++) {
    const x = ox + c * STEP;
    line(x, Y, oz,  x, Y, oz + (ROWS + 1) * STEP);
  }
}

// ── Data builders ─────────────────────────────────────────────────────────────

function buildIcosahedron() {
  const t = (1 + sqrt(5)) / 2;
  const raw = [
    [-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],
    [0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],
    [t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]
  ];
  icoVerts = raw.map(v => {
    const len = sqrt(v[0]**2 + v[1]**2 + v[2]**2);
    return { x: v[0]/len, y: v[1]/len, z: v[2]/len };
  });
  icoFaces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
  ];
}

function buildLattice() {
  lattice = [];
  const corners = [
    [-1,-1,-1],[-1,-1,1],[-1,1,-1],[-1,1,1],
    [1,-1,-1],[1,-1,1],[1,1,-1],[1,1,1]
  ];
  for (let c of corners) {
    lattice.push({
      x:c[0]*240, y:c[1]*240, z:c[2]*240,
      size:195, alpha:210,
      sx:c[0]*0.07, sy:c[1]*0.05, sz:c[2]*0.06,
      ox:random(TWO_PI), oy:random(TWO_PI), oz:random(TWO_PI), sw:1.5
    });
  }
  const faces = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for (let f of faces) {
    lattice.push({
      x:f[0]*340, y:f[1]*340, z:f[2]*340,
      size:108, alpha:150,
      sx:random(-0.12,0.12), sy:random(-0.10,0.10), sz:random(-0.09,0.09),
      ox:random(TWO_PI), oy:random(TWO_PI), oz:random(TWO_PI), sw:1.0
    });
  }
  for (let i = 0; i < 22; i++) {
    const r  = random(140, 440);
    const th = random(TWO_PI);
    const ph = random(PI);
    lattice.push({
      x: r*sin(ph)*cos(th), y: r*cos(ph), z: r*sin(ph)*sin(th),
      size:44, alpha:90,
      sx:random(-0.18,0.18), sy:random(-0.15,0.15), sz:random(-0.13,0.13),
      ox:random(TWO_PI), oy:random(TWO_PI), oz:random(TWO_PI), sw:0.7
    });
  }
}

// ── Particles ─────────────────────────────────────────────────────────────────

function makeParticle() {
  const r  = random(80, 530);
  const th = random(TWO_PI);
  const ph = random(-HALF_PI, HALF_PI);
  return {
    x: r*cos(ph)*cos(th), y: r*sin(ph), z: r*cos(ph)*sin(th),
    vx:random(-0.5,0.5), vy:random(-0.35,0.35), vz:random(-0.5,0.5),
    alpha:random(80,230), sz:random(2,5),
    life:random(0.5,1.0), decay:random(0.003,0.009)
  };
}

function tickParticle(p) {
  p.x+=p.vx; p.y+=p.vy; p.z+=p.vz;
  p.life-=p.decay;
  p.alpha = p.life * 255;
  if (p.life<=0 || sqrt(p.x**2+p.y**2+p.z**2)>580) Object.assign(p, makeParticle());
}

// ── Input ──────────────────────────────────────────────────────────────────────
function keyPressed() {
  if (key==='r'||key==='R') isRecording ? stopRecording() : startRecording();
}

// ── Recording ────────────────────────────────────────────────────────────────

function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome/Edge.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { console.error(e); setStatus('Encoder error','#f66'); isRecording=false; }
  });
  encoder.configure({ codec:'avc1.640028', width:W, height:H, bitrate:12_000_000, framerate:FPS });

  fc = 0;
  isRecording = true;
  recordingFrameCount = 0;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording MP4...','#fff');
  updateRecordingUI();
}

async function stopRecording() {
  if (!isRecording||!encoder||!muxer) return;
  isRecording = false;
  setStatus('Finalizing...','#aaa');
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer],{type:'video/mp4'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download='recursive_monolith_20260224.mp4'; a.click();
  encoder.close(); encoder=null; muxer=null;
  setTimeout(()=>URL.revokeObjectURL(url),5000);
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete!','#fff');
  setTimeout(()=>setStatus('Ready','#aaa'),3000);
}

function captureFrame() {
  if (!isRecording||!encoder) return;
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  const frame = new VideoFrame(canvas,{timestamp: recordingFrameCount*(1_000_000/FPS)});
  encoder.encode(frame,{keyFrame: recordingFrameCount%FPS===0});
  frame.close();
}

function setStatus(text,color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent=text; el.style.color=color;
}

function updateRecordingUI() {
  const d=document.getElementById('duration');
  const f=document.getElementById('frameCount');
  if(d) d.textContent=(recordingFrameCount/FPS).toFixed(1);
  if(f) f.textContent=recordingFrameCount;
}

/*
 *  Forma II — Radiant Sacred Geometry  1080 × 1920
 *
 *  Controls:  R · record   Space · pause
 */

const FPS        = 60;
const MAX_FRAMES = FPS * 24;
const W = 1080;
const H = 1920;

let t      = 0;
let paused = false;
let recording     = false;
let recFrameCount = 0;
let muxer, encoder;

let knotPts  = [];
let lissPts  = [];
let icoEdges = [];
let dodEdges = [];
let stars    = [];
let beads    = [];   // energy beads travelling the knot

// ─── Setup ───────────────────────────────────────────────────
function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255);
  strokeCap(ROUND);

  buildTorusKnot(3, 2, 400, 68, 2400);
  buildLissajous();
  buildIcosahedron(530);
  buildDodecahedron(530);
  buildStars(500);
  buildBeads(60);
}

// ─── Draw ────────────────────────────────────────────────────
function draw() {
  if (paused) return;
  background(0);

  rotateY(t * 0.22);
  rotateX(sin(t * 0.09) * 0.22);
  rotateZ(sin(t * 0.05) * 0.06);

  drawStars();

  push();
  scale(1 + sin(t * 0.13) * 0.035);
  drawIco(32, 0.7);
  rotateY(t * 0.04);
  rotateX(t * 0.03);
  drawDod(18, 0.5);
  pop();

  push();
  drawLissajous();
  pop();

  push();
  drawTorusKnot();
  drawBeads();
  pop();

  t += 0.007;
  drawHUD();
  if (recording) captureFrame();
}

// ═══════════════════════════════════════════════════════════════
// STAR FIELD
// ═══════════════════════════════════════════════════════════════
function buildStars(n) {
  for (let i = 0; i < n; i++) {
    stars.push({
      x: random(-W * 0.9, W * 0.9),
      y: random(-H * 0.9, H * 0.9),
      z: random(-1800, 1800),
      r: random(0.8, 2.5),
      a: random(60, 180),
      twinkle: random(TWO_PI)
    });
  }
}

function drawStars() {
  noStroke();
  for (const s of stars) {
    const flicker = 0.7 + 0.3 * sin(t * 1.8 + s.twinkle);
    fill(255, 255, 255, s.a * flicker);
    push();
    translate(s.x, s.y, s.z);
    sphere(s.r, 4, 4);
    pop();
  }
}

// ═══════════════════════════════════════════════════════════════
// TORUS KNOT  (3,2) — hero
// ═══════════════════════════════════════════════════════════════
function buildTorusKnot(p, q, R, r, steps) {
  knotPts = [];
  for (let i = 0; i <= steps; i++) {
    const phi = (i / steps) * TWO_PI;
    knotPts.push(createVector(
      (R + r * cos(q * phi)) * cos(p * phi),
      (R + r * cos(q * phi)) * sin(p * phi),
      r * sin(q * phi)
    ));
  }
}

function drawTorusKnot() {
  const n = knotPts.length - 1;

  // 6-layer bloom: wide soft halo → razor core
  const passes = [
    { sw: 38, alpha: 8  },
    { sw: 22, alpha: 16 },
    { sw: 12, alpha: 30 },
    { sw: 6,  alpha: 60 },
    { sw: 2.5,alpha: 140 },
    { sw: 0.9,alpha: 255 },
  ];

  for (const pass of passes) {
    beginShape();
    noFill();
    for (let i = 0; i <= n; i++) {
      const v     = knotPts[i];
      const phase = (i / n) * TWO_PI * 3 - t * 5;
      const pulse = 0.6 + 0.4 * sin(phase);
      stroke(255, 255, 255, pass.alpha * pulse);
      strokeWeight(pass.sw);
      vertex(v.x, v.y, v.z);
    }
    endShape();
  }

  // Node spheres at knot crossings — bright flare points
  noStroke();
  for (let i = 0; i < n; i += 24) {
    const v     = knotPts[i];
    const phase = (i / n) * TWO_PI * 3 - t * 5;
    const pulse = 0.5 + 0.5 * sin(phase);

    // Outer glow sphere
    fill(255, 255, 255, 35 * pulse);
    push(); translate(v.x, v.y, v.z); sphere(14, 6, 6); pop();

    // Inner bright core
    fill(255, 255, 255, 220 * pulse);
    push(); translate(v.x, v.y, v.z); sphere(4, 5, 5); pop();
  }
}

// ═══════════════════════════════════════════════════════════════
// ENERGY BEADS — travel along the knot
// ═══════════════════════════════════════════════════════════════
function buildBeads(n) {
  for (let i = 0; i < n; i++) {
    beads.push({
      pos: random(1),       // 0-1 position along knot
      speed: random(0.0008, 0.003),
      size: random(3, 9),
      brightness: random(180, 255)
    });
  }
}

function drawBeads() {
  const n = knotPts.length - 1;
  noStroke();
  for (const b of beads) {
    b.pos = (b.pos + b.speed) % 1;
    const idx = floor(b.pos * n);
    const v   = knotPts[idx];

    // Outer halo
    fill(255, 255, 255, 30);
    push(); translate(v.x, v.y, v.z); sphere(b.size * 2.5, 5, 5); pop();

    // Core
    fill(255, 255, 255, b.brightness);
    push(); translate(v.x, v.y, v.z); sphere(b.size, 5, 5); pop();
  }
}

// ═══════════════════════════════════════════════════════════════
// LISSAJOUS RINGS — 6 orbits
// ═══════════════════════════════════════════════════════════════
function buildLissajous() {
  const configs = [
    { a: 3, b: 2, rx: 0,      ry: 0,      rz: 0,     R: 620 },
    { a: 5, b: 4, rx: PI/2,   ry: 0,      rz: 0,     R: 580 },
    { a: 4, b: 3, rx: 0,      ry: PI/2,   rz: 0,     R: 600 },
    { a: 5, b: 3, rx: PI/4,   ry: PI/4,   rz: 0,     R: 560 },
    { a: 7, b: 4, rx: PI/3,   ry: PI/6,   rz: PI/4,  R: 640 },
    { a: 3, b: 5, rx: PI/5,   ry: PI/3,   rz: PI/2,  R: 590 },
  ];

  lissPts = configs.map(cfg => {
    const pts = [];
    for (let i = 0; i <= 900; i++) {
      const phi = (i / 900) * TWO_PI;
      pts.push({
        x: cfg.R * sin(cfg.a * phi),
        y: cfg.R * sin(cfg.b * phi + PI / 4),
        z: cfg.R * cos(cfg.a * phi) * 0.45,
      });
    }
    return { pts, cfg };
  });
}

function drawLissajous() {
  for (let ri = 0; ri < lissPts.length; ri++) {
    const { pts, cfg } = lissPts[ri];
    const n = pts.length;

    push();
    rotateX(cfg.rx + t * (0.10 + ri * 0.025));
    rotateY(cfg.ry + t * (0.07 + ri * 0.018));
    rotateZ(cfg.rz + t * (0.04 + ri * 0.012));

    // 3 passes per ring: wide glow, mid, crisp
    for (const pass of [
      { sw: 5,   a: 22 },
      { sw: 2,   a: 55 },
      { sw: 0.6, a: 130 }
    ]) {
      beginShape();
      noFill();
      for (let i = 0; i <= n; i++) {
        const p    = pts[i % n];
        const fade = 0.45 + 0.55 * sin((i / n + t * 0.25) * TWO_PI);
        stroke(255, 255, 255, pass.a * fade);
        strokeWeight(pass.sw);
        vertex(p.x, p.y, p.z);
      }
      endShape();
    }
    pop();
  }
}

// ═══════════════════════════════════════════════════════════════
// ICOSAHEDRON + DODECAHEDRON WIREFRAMES
// ═══════════════════════════════════════════════════════════════
function buildIcosahedron(R) {
  const φ = (1 + sqrt(5)) / 2;
  const raw = [
    [0,1,φ],[0,-1,φ],[0,1,-φ],[0,-1,-φ],
    [1,φ,0],[-1,φ,0],[1,-φ,0],[-1,-φ,0],
    [φ,0,1],[-φ,0,1],[φ,0,-1],[-φ,0,-1],
  ];
  const verts = raw.map(v => {
    const l = sqrt(v[0]**2+v[1]**2+v[2]**2);
    return createVector(v[0]/l*R, v[1]/l*R, v[2]/l*R);
  });
  const edges = [
    [0,1],[0,4],[0,5],[0,8],[0,9],
    [1,6],[1,7],[1,8],[1,9],
    [2,3],[2,4],[2,5],[2,10],[2,11],
    [3,6],[3,7],[3,10],[3,11],
    [4,5],[4,8],[4,10],[5,9],[5,11],
    [6,7],[6,8],[6,10],[7,9],[7,11],[8,10],[9,11],
  ];
  icoEdges = edges.map(([a,b]) => [verts[a], verts[b]]);
}

function buildDodecahedron(R) {
  const φ = (1 + sqrt(5)) / 2;
  const iφ = 1 / φ;
  const raw = [
    [1,1,1],[1,1,-1],[1,-1,1],[1,-1,-1],
    [-1,1,1],[-1,1,-1],[-1,-1,1],[-1,-1,-1],
    [0,iφ,φ],[0,iφ,-φ],[0,-iφ,φ],[0,-iφ,-φ],
    [iφ,φ,0],[iφ,-φ,0],[-iφ,φ,0],[-iφ,-φ,0],
    [φ,0,iφ],[φ,0,-iφ],[-φ,0,iφ],[-φ,0,-iφ],
  ];
  const verts = raw.map(v => {
    const l = sqrt(v[0]**2+v[1]**2+v[2]**2);
    return createVector(v[0]/l*R, v[1]/l*R, v[2]/l*R);
  });
  // Connect vertices within distance threshold
  dodEdges = [];
  const thresh = R * 0.78;
  for (let i = 0; i < verts.length; i++)
    for (let j = i+1; j < verts.length; j++)
      if (p5.Vector.dist(verts[i], verts[j]) < thresh)
        dodEdges.push([verts[i], verts[j]]);
}

function drawIco(alpha, sw) {
  noFill();
  stroke(255, 255, 255, alpha);
  strokeWeight(sw);
  for (const [a,b] of icoEdges) line(a.x,a.y,a.z, b.x,b.y,b.z);
}

function drawDod(alpha, sw) {
  noFill();
  stroke(255, 255, 255, alpha);
  strokeWeight(sw);
  for (const [a,b] of dodEdges) line(a.x,a.y,a.z, b.x,b.y,b.z);
}

// ─── HUD ─────────────────────────────────────────────────────
function drawHUD() {
  push();
  ortho(-W/2, W/2, -H/2, H/2, -9999, 9999);
  resetMatrix();
  noStroke();
  fill(255, 60);
  textFont('monospace');
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(
    recording ? `\u25CF REC  ${nf(recFrameCount,4)} / ${MAX_FRAMES}` : 'R \u00B7 rec   Spc \u00B7 pause',
    -W/2+16, H/2-16
  );
  pop();
}

// ─── Keys ────────────────────────────────────────────────────
function keyPressed() {
  if (key==='r'||key==='R') recording ? stopRecording() : startRecording();
  if (key===' ') paused = !paused;
}

// ─── mp4-muxer ───────────────────────────────────────────────
function startRecording() {
  if (typeof Mp4Muxer==='undefined') { console.warn('Mp4Muxer not loaded'); return; }
  const target = new Mp4Muxer.ArrayBufferTarget();
  muxer = new Mp4Muxer.Muxer({ target, video:{ codec:'avc', width:W, height:H }, fastStart:'in-memory' });
  encoder = new VideoEncoder({
    output: (chunk,meta) => muxer.addVideoChunk(chunk,meta),
    error: e => console.error(e)
  });
  encoder.configure({ codec:'avc1.4d002a', width:W, height:H, bitrate:16_000_000, framerate:FPS });
  recFrameCount = 0;
  recording = true;
}

function captureFrame() {
  if (recFrameCount >= MAX_FRAMES) { stopRecording(); return; }
  const cnv = document.querySelector('canvas');
  const bitmap = cnv.transferToImageBitmap();
  const frame = new VideoFrame(bitmap, {
    timestamp: (recFrameCount/FPS)*1e6,
    duration:  (1/FPS)*1e6
  });
  encoder.encode(frame, { keyFrame: recFrameCount%(FPS*2)===0 });
  frame.close(); bitmap.close();
  recFrameCount++;
}

async function stopRecording() {
  recording = false;
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type:'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.download = `forma2_${d.getFullYear()}${nf(d.getMonth()+1,2)}${nf(d.getDate(),2)}.mp4`;
  a.href=url; a.click();
  URL.revokeObjectURL(url);
}

'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

// ─── Speed ────────────────────────────────────────────────────────────────────
const LOOP_FRAMES  = FPS * 8;    // 8-second loop (was 20s)
const GLOBAL_RATE  = 2;        // phase/rotation multiplier

// ─── Palette ──────────────────────────────────────────────────────────────────
// Set useBio = true for Bio-Synthetic (acid green / cyan / violet / hot pink).
// Set useBio = false for monochrome.
const useBio = false;

const MONO = { bg: [0, 0, 0] };
const BIO  = {
  bg:   [4, 4, 12],
  cols: [
    [0,   255, 159],   // acid green
    [0,   207, 255],   // cyan
    [139,   0, 255],   // violet
    [255,   0, 110],   // hot pink
  ],
};

function getBG()       { return useBio ? BIO.bg : MONO.bg; }
function bioCol(ci)    { return useBio ? BIO.cols[ci % 4] : [255, 255, 255]; }

const TRAIL_ALPHA = 36;

// ─── Math constants ───────────────────────────────────────────────────────────
const PHI = 1.61803398875;
const SQ2 = Math.sqrt(2);
const TAU = Math.PI * 2;

// ─── State ────────────────────────────────────────────────────────────────────
let trailLayer = null;
let grainLayer = null;
let webglLayer = null;

let phaseA = 0, phaseB = 0, phaseC = 0;
let particles  = [];
let qcLattice  = [];

let muxer         = null;
let encoder       = null;
let isRecording   = false;
let recFrameCount = 0;
let canvasEl      = null;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl  = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  noFill();
  strokeCap(ROUND);

  const bg = getBG();

  trailLayer = createGraphics(W, H);
  trailLayer.pixelDensity(1);
  trailLayer.colorMode(RGB, 255, 255, 255, 255);
  trailLayer.strokeCap(ROUND);
  trailLayer.background(bg[0], bg[1], bg[2]);

  webglLayer = createGraphics(W, H, WEBGL);
  webglLayer.pixelDensity(1);
  webglLayer.colorMode(RGB, 255, 255, 255, 255);
  webglLayer.noFill();
  webglLayer.strokeCap(ROUND);
  webglLayer.strokeJoin(ROUND);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseedPattern(floor(random(100000)));

  const maxEl = document.getElementById('maxDuration');
  if (maxEl) maxEl.textContent = MAX_DURATION;
  updateCanvasInfo();
}

// ─── Seed ─────────────────────────────────────────────────────────────────────
function reseedPattern(seed) {
  randomSeed(seed);
  noiseSeed(seed);
  phaseA = random(TAU);
  phaseB = random(TAU);
  phaseC = random(TAU);
  particles = createParticles(120);
  qcLattice = createQuasicrystalLattice();
  const bg = getBG();
  if (trailLayer) trailLayer.background(bg[0], bg[1], bg[2]);
}

function createParticles(count) {
  const arr = [];
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    arr.push({
      radius: 0.30 + Math.sqrt(u) * 1.58,
      angle:  i * Math.PI * (3 - Math.sqrt(5)),
      lane:   i % 5,
      lift:   random(-0.8, 0.8),
      size:   random(1.0, 2.5),
      ci:     i % 4,
    });
  }
  return arr;
}

// 5-fold quasicrystal lattice
function createQuasicrystalLattice() {
  const arr = [];
  for (let ring = 1; ring <= 8; ring++) {
    const count  = ring * 5;
    const radius = map(ring, 1, 8, 0.18, 1.62);
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * TAU + (ring % 2) * Math.PI / count;
      arr.push({ radius, theta, ring, index: i, count, ci: ring % 4 });
    }
  }
  return arr;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const la   = loop * TAU * GLOBAL_RATE;
  const bg   = getBG();

  trailLayer.clear();
  trailLayer.background(bg[0], bg[1], bg[2]);

  renderGaussianScene(la, loop);

  background(bg[0], bg[1], bg[2]);
  image(trailLayer, 0, 0);

  push();
  tint(255, 16);
  image(grainLayer, 0, 0);
  noTint();
  pop();

  drawCornerBrackets();
  drawHUD(la, loop);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderGaussianScene(la, loop) {
  webglLayer.clear();
  webglLayer.push();
  webglLayer.background(0, 0, 0, 0);
  webglLayer.noFill();

  const camZ = 840 + 18 * Math.sin(la + phaseC);
  const camX = 42  * Math.sin(la * 0.5 + phaseA * 0.2);
  const camY = -142 + 8 * Math.cos(la * 0.5 + phaseB * 0.2);

  webglLayer.camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);
  webglLayer.perspective(Math.PI / 3.75, W / H, 0.1, 5000);

  webglLayer.rotateX(-0.56 + 0.018 * Math.sin(la * 0.5));
  webglLayer.rotateZ( la   * 0.095 + 0.018 * Math.sin(la * 0.5 + phaseB));
  webglLayer.scale(1.28 + 0.025 * Math.sin(la));

  drawRotatingCompass(la);
  drawLissajousCorona(la);
  drawAxes(la);
  drawEquipotentials(la);
  drawQuasicrystalField(la);
  drawOrbitalRings(la);
  drawMobiusRibbon(la);
  drawParticles(la);
  drawOriginSignal(la);

  webglLayer.pop();
  trailLayer.image(webglLayer, 0, 0);
}

// ─── Complex math ─────────────────────────────────────────────────────────────
function complexTransform(x, y, t) {
  const r     = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(y, x);
  const rot   = t * 0.11 + 0.04 * Math.sin(r * 2.0 - t);
  const xr    = x * Math.cos(rot) - y * Math.sin(rot);
  const yr    = x * Math.sin(rot) + y * Math.cos(rot);
  const h     = Math.sin(r * 3.45 - t * 1.05) * 23
              + Math.cos(theta * 6 + t * 0.58) * 13
              + Math.sin(t + theta) * (6 / (r + 0.46))
              + Math.sin(t * 0.5 + r * 1.3) * 8;
  return { x: xr, y: yr, r, theta, height: h };
}

function worldPoint(x, y, t, sc = 100) {
  const z = complexTransform(x, y, t);
  return { x: z.x * sc, y: z.y * sc, z: z.height };
}

// ─── Stroke helper ────────────────────────────────────────────────────────────
function inkStroke(alpha, ci = 0) {
  const c = bioCol(ci);
  webglLayer.stroke(c[0], c[1], c[2], alpha);
}

// ─── Maurer Rose field ────────────────────────────────────────────────────────
function drawRotatingCompass(t) {
  const params = [
    { n: 3, d: 77, r: 120, sw: 0.4, al: 52 },
    { n: 5, d: 97, r: 140, sw: 0.4, al: 58 },
    { n: 4, d: 71, r: 110, sw: 0.3, al: 40 },
    { n: 6, d: 53, r: 100, sw: 0.3, al: 46 },
    { n: 2, d: 29, r: 130, sw: 0.4, al: 52 },
    { n: 3, d: 89, r: 155, sw: 0.3, al: 36 },
  ];

  for (let idx = 0; idx < params.length; idx++) {
    const p    = params[idx];
    const rotT = idx % 2 === 0 ? t * 0.08 : -t * 0.06;
    webglLayer.push();
    webglLayer.rotateZ(rotT);
    inkStroke(p.al, 0);
    webglLayer.strokeWeight(p.sw);
    webglLayer.beginShape();
    for (let k = 0; k <= 359; k++) {
      const theta = k * p.d * (Math.PI / 180);
      const r     = p.r * Math.cos(p.n * theta);
      webglLayer.vertex(r * Math.cos(theta), r * Math.sin(theta), 0);
    }
    webglLayer.endShape();
    webglLayer.pop();
  }
}

// ─── Epitrochoid corona ───────────────────────────────────────────────────────
function drawLissajousCorona(t) {
  const cfgs = [
    { R: 80,  r: 30, d: 45 },
    { R: 100, r: 37, d: 60 },
    { R: 120, r: 43, d: 70 },
    { R: 90,  r: 27, d: 55 },
    { R: 110, r: 41, d: 65 },
    { R: 70,  r: 23, d: 40 },
    { R: 130, r: 49, d: 80 },
    { R: 95,  r: 31, d: 50 },
  ];

  for (let i = 0; i < cfgs.length; i++) {
    const cfg   = cfgs[i];
    const alpha = Math.round(map(i, 0, 7, 38, 72));
    inkStroke(alpha, 0);
    webglLayer.strokeWeight(0.5);
    webglLayer.push();
    webglLayer.rotateZ(t * 0.03 * i);
    webglLayer.beginShape();
    for (let k = 0; k <= 400; k++) {
      const theta = (k / 400) * TAU;
      const x     = (cfg.R + cfg.r) * Math.cos(theta) - cfg.d * Math.cos((cfg.R + cfg.r) / cfg.r * theta);
      const y     = (cfg.R + cfg.r) * Math.sin(theta) - cfg.d * Math.sin((cfg.R + cfg.r) / cfg.r * theta);
      const z     = 15 * Math.sin(theta * 2 + t * 0.5 + i);
      webglLayer.vertex(x, y, z);
    }
    webglLayer.endShape();
    webglLayer.pop();
  }
}

// ─── Polar grid + star polygons ───────────────────────────────────────────────
function drawAxes(t) {
  for (let ci = 0; ci < 6; ci++) {
    const r = (ci + 1) * 40;
    inkStroke(45, 0);
    webglLayer.strokeWeight(0.3);
    webglLayer.circle(0, 0, r * 2);
  }

  for (let i = 0; i < 24; i++) {
    const a = i * (Math.PI / 12);
    inkStroke(32, 0);
    webglLayer.strokeWeight(0.25);
    webglLayer.line(0, 0, 0, Math.cos(a) * 240, Math.sin(a) * 240, 0);
  }

  // {12/5} star polygon
  webglLayer.push();
  webglLayer.rotateZ(t * 0.04);
  inkStroke(100, 0);
  webglLayer.strokeWeight(0.6);
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * TAU;
    const a1 = ((i + 5) / 12) * TAU;
    webglLayer.line(Math.cos(a0) * 200, Math.sin(a0) * 200, 0,
                    Math.cos(a1) * 200, Math.sin(a1) * 200, 0);
  }
  webglLayer.pop();

  // {8/3} star polygon
  webglLayer.push();
  webglLayer.rotateZ(-t * 0.055);
  inkStroke(100, 0);
  webglLayer.strokeWeight(0.6);
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * TAU;
    const a1 = ((i + 3) / 8) * TAU;
    webglLayer.line(Math.cos(a0) * 160, Math.sin(a0) * 160, 0,
                    Math.cos(a1) * 160, Math.sin(a1) * 160, 0);
  }
  webglLayer.pop();
}

// ─── Newton fractal level curves of z^3 - 1 ──────────────────────────────────
function drawEquipotentials(t) {
  const levels = [0.5, 1.0, 1.5, 2.0, 2.5];
  const alphas = [70,  100, 125, 155,  185];
  const cosRot = Math.cos(t * 0.04);
  const sinRot = Math.sin(t * 0.04);
  const GRID   = 38;
  const RANGE  = 2.2;
  const STEP   = (RANGE * 2) / GRID;

  for (let li = 0; li < levels.length; li++) {
    const c  = levels[li];
    const al = alphas[li];
    inkStroke(al, 0);
    webglLayer.strokeWeight(1.2);

    for (let gx = 0; gx < GRID; gx++) {
      for (let gy = 0; gy < GRID; gy++) {
        const rx = -RANGE + gx * STEP;
        const ry = -RANGE + gy * STEP;
        const zx = rx * cosRot - ry * sinRot;
        const zy = rx * sinRot + ry * cosRot;
        // z^3 via two multiplications
        const zx2 = zx * zx - zy * zy;
        const zy2 = 2 * zx * zy;
        const zx3 = zx * zx2 - zy * zy2;
        const zy3 = zx * zy2 + zy * zx2;
        const mag = Math.sqrt((zx3 - 1) * (zx3 - 1) + zy3 * zy3);
        if (Math.abs(mag - c) < 0.08) {
          const pt = worldPoint(rx, ry, t, 92);
          webglLayer.point(pt.x, pt.y, pt.z);
        }
      }
    }
  }
}

// ─── Penrose pentagrid ────────────────────────────────────────────────────────
function drawQuasicrystalField(t) {
  for (let k = 0; k < 5; k++) {
    const ang = k * 36 * (Math.PI / 180);
    const dx  = Math.cos(ang);
    const dy  = Math.sin(ang);
    const px  = -dy;
    const py  =  dx;

    for (let j = -4; j <= 4; j++) {
      const offset = j * 28 + 3 * Math.sin(t * 0.3 + k * PHI);
      const cx0    = px * offset;
      const cy0    = py * offset;
      const len    = 250;
      inkStroke(j === 0 ? 100 : 40, 0);
      webglLayer.strokeWeight(j === 0 ? 0.7 : 0.35);
      webglLayer.line(cx0 + dx * -len, cy0 + dy * -len, 0,
                      cx0 + dx *  len, cy0 + dy *  len, 0);
    }
  }

  // Intersection dots between different-family lines
  for (let a = 0; a < 5; a++) {
    for (let b = a + 1; b < 5; b++) {
      const angA = a * 36 * (Math.PI / 180);
      const angB = b * 36 * (Math.PI / 180);
      const dxA  = Math.cos(angA), dyA = Math.sin(angA);
      const dxB  = Math.cos(angB), dyB = Math.sin(angB);
      const denom = dxA * dyB - dyA * dxB;
      if (Math.abs(denom) < 0.001) continue;

      for (let ja = -1; ja <= 1; ja++) {
        for (let jb = -1; jb <= 1; jb++) {
          const offA = ja * 28 + 3 * Math.sin(t * 0.3 + a * PHI);
          const offB = jb * 28 + 3 * Math.sin(t * 0.3 + b * PHI);
          const pxA  = -dyA * offA, pyA = dxA * offA;
          const pxB  = -dyB * offB;
          const ex   = pxB - pxA, ey = -dxB * offB - pyA;
          const s    = (ex * dyB - ey * dxB) / denom;
          const ix   = pxA + dxA * s;
          const iy   = pyA + dyA * s;
          if (Math.abs(ix) < 280 && Math.abs(iy) < 280) {
            inkStroke(150, 0);
            webglLayer.strokeWeight(3.0);
            webglLayer.point(ix, iy, 0);
          }
        }
      }
    }
  }
}

// ─── Cassini ovals ────────────────────────────────────────────────────────────
function drawOrbitalRings(t) {
  const a      = 80;
  const bVals  = [60, 72, 80, 90, 100, 115];
  const alphas = [55, 68, 90, 100, 118, 145];
  const swVals = [0.7, 0.8, 1.1, 0.9, 0.8, 0.7];
  const a2     = a * a;
  const a4     = a2 * a2;

  for (let i = 0; i < bVals.length; i++) {
    const b    = bVals[i];
    const b4   = b * b * b * b;
    webglLayer.push();
    webglLayer.rotateZ(t * 0.05 * (i + 1) * 0.4);
    inkStroke(alphas[i], 0);
    webglLayer.strokeWeight(swVals[i]);

    // positive lobe
    webglLayer.beginShape();
    for (let k = 0; k <= 360; k++) {
      const theta  = (k / 360) * TAU;
      const cos2th = Math.cos(2 * theta);
      const disc   = a4 * cos2th * cos2th - a4 + b4;
      if (disc < 0) { webglLayer.endShape(); webglLayer.beginShape(); continue; }
      const r2 = a2 * cos2th + Math.sqrt(disc);
      if (r2 < 0) { webglLayer.endShape(); webglLayer.beginShape(); continue; }
      const r  = Math.sqrt(r2);
      webglLayer.vertex(r * Math.cos(theta), r * Math.sin(theta), 0);
    }
    webglLayer.endShape();

    // negative lobe (b < a only)
    if (b < a) {
      webglLayer.beginShape();
      for (let k = 0; k <= 360; k++) {
        const theta  = (k / 360) * TAU;
        const cos2th = Math.cos(2 * theta);
        const disc   = a4 * cos2th * cos2th - a4 + b4;
        if (disc < 0) continue;
        const r2 = a2 * cos2th - Math.sqrt(disc);
        if (r2 < 0) continue;
        const r  = Math.sqrt(r2);
        webglLayer.vertex(r * Math.cos(theta), r * Math.sin(theta), 0);
      }
      webglLayer.endShape();
    }

    webglLayer.pop();
  }
}

// ─── Trefoil knot + Seifert fibers ───────────────────────────────────────────
function drawMobiusRibbon(t) {
  const STEPS = 300;
  const SC    = 55;

  const knotPts = [];
  for (let i = 0; i <= STEPS; i++) {
    const s = (i / STEPS) * TAU;
    knotPts.push({
      x: (Math.sin(s) + 2 * Math.sin(2 * s)) * SC,
      y: (Math.cos(s) - 2 * Math.cos(2 * s)) * SC,
      z: (-Math.sin(3 * s)) * SC,
    });
  }

  webglLayer.push();
  webglLayer.rotateY(t * 0.18);
  webglLayer.rotateX(t * 0.07);

  inkStroke(150, 0);
  webglLayer.strokeWeight(1.0);
  webglLayer.beginShape();
  for (let i = 0; i < knotPts.length; i++) {
    const p = knotPts[i];
    webglLayer.vertex(p.x, p.y, p.z);
  }
  webglLayer.endShape();

  for (let f = 0; f < 8; f++) {
    const cosOff = Math.cos((f / 8) * TAU);
    const sinOff = Math.sin((f / 8) * TAU);
    inkStroke(65, 0);
    webglLayer.strokeWeight(0.4);
    webglLayer.beginShape();
    for (let i = 0; i < STEPS; i++) {
      const p  = knotPts[i];
      const pn = knotPts[(i + 1) % STEPS];
      const pp = knotPts[(i + 2) % STEPS];
      // tangent
      let tx = pn.x - p.x, ty = pn.y - p.y, tz = pn.z - p.z;
      const tl = Math.sqrt(tx*tx + ty*ty + tz*tz) + 1e-6;
      tx /= tl; ty /= tl; tz /= tl;
      // next tangent for normal approx
      let t2x = pp.x - pn.x, t2y = pp.y - pn.y, t2z = pp.z - pn.z;
      const t2l = Math.sqrt(t2x*t2x + t2y*t2y + t2z*t2z) + 1e-6;
      t2x /= t2l; t2y /= t2l; t2z /= t2l;
      let Nx = t2x - tx, Ny = t2y - ty, Nz = t2z - tz;
      const nl = Math.sqrt(Nx*Nx + Ny*Ny + Nz*Nz) + 1e-6;
      Nx /= nl; Ny /= nl; Nz /= nl;
      // binormal = T × N
      const Bx = ty*Nz - tz*Ny;
      const By = tz*Nx - tx*Nz;
      const Bz = tx*Ny - ty*Nx;
      webglLayer.vertex(
        p.x + Nx * 12 * cosOff + Bx * 12 * sinOff,
        p.y + Ny * 12 * cosOff + By * 12 * sinOff,
        p.z + Nz * 12 * cosOff + Bz * 12 * sinOff
      );
    }
    webglLayer.endShape();
  }

  webglLayer.pop();
}

// ─── Clifford attractor ───────────────────────────────────────────────────────
function drawParticles(t) {
  const a = -1.4 + 0.15 * Math.sin(t * 0.2);
  const b =  1.6 + 0.12 * Math.cos(t * 0.17);
  const c =  1.0;
  const d =  0.7;

  inkStroke(40, 0);
  webglLayer.strokeWeight(0.6);

  let cx = 0, cy = 0;
  for (let i = 0; i < 200; i++) {
    const nx = Math.sin(a * cy) + c * Math.cos(a * cx);
    const ny = Math.sin(b * cx) + d * Math.cos(b * cy);
    cx = nx; cy = ny;
  }
  for (let i = 0; i < 800; i++) {
    const nx = Math.sin(a * cy) + c * Math.cos(a * cx);
    const ny = Math.sin(b * cx) + d * Math.cos(b * cy);
    cx = nx; cy = ny;
    webglLayer.point(cx * 75, cy * 75, 18 * Math.sin(t * 0.6 + i * 0.003));
  }
}

// ─── Fresnel zone plate ───────────────────────────────────────────────────────
function drawOriginSignal(t) {
  const lambda = 22;
  const f      = 180;

  webglLayer.push();
  webglLayer.translate(0, 0, 12 * Math.sin(t * 0.8));

  for (let n = 1; n <= 14; n++) {
    if (n % 2 === 0) continue;
    const rn = Math.sqrt(n * lambda * f) * (1 + 0.04 * Math.sin(t * 0.9 + n * 0.3));
    inkStroke(85, 0);
    webglLayer.strokeWeight(0.7);
    webglLayer.circle(0, 0, rn * 2);
  }

  webglLayer.push();
  webglLayer.rotateZ(t * 0.15);
  for (let n = 1; n <= 14; n++) {
    if (n % 2 === 0) continue;
    const rn = Math.sqrt(n * lambda * f) * (1 + 0.04 * Math.sin(t * 0.9 + n * 0.3 + Math.PI));
    inkStroke(42, 0);
    webglLayer.strokeWeight(0.5);
    webglLayer.circle(0, 0, rn * 2);
  }
  webglLayer.pop();

  inkStroke(255, 0);
  webglLayer.strokeWeight(2.5);
  webglLayer.point(0, 0, 0);
  webglLayer.pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(la, loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');

  fill(255, 255, 255, 185);
  textSize(13);
  textAlign(LEFT, TOP);
  text('SCHWARZSCHILD MANDALA  ·  BW', 52, 54);

  fill(255, 255, 255, 90);
  textSize(10);
  text('Maurer roses · Cassini ovals · trefoil knot · Clifford attractor', 52, 74);

  const phase = (loop).toFixed(3);

  fill(255, 255, 255, 100);
  textSize(10);
  textAlign(LEFT, BOTTOM);
  text('Penrose grid · Newton fractal · Fresnel zones    phase = ' + phase, 52, H - 54);

  textAlign(RIGHT, BOTTOM);
  fill(255, 255, 255, 72);
  text('20260427 · schwarzschild mandala', W - 52, H - 54);

  // Loop progress bar
  const barW = (W - 104) * loop;
  noFill();
  stroke(255, 255, 255, 34);
  strokeWeight(1);
  line(52, H - 36, W - 52, H - 36);
  stroke(255, 255, 255, 108);
  line(52, H - 36, 52 + barW, H - 36);

  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push();
  noFill();
  stroke(255, 255, 255, 66);
  strokeWeight(0.9);
  const m = 32, L = 28;
  line(m,     m,     m + L, m    );  line(m,     m,     m,     m + L);
  line(W - m, m,     W-m-L, m    );  line(W - m, m,     W - m, m + L);
  line(m,     H - m, m + L, H - m);  line(m,     H - m, m,     H-m-L);
  line(W - m, H - m, W-m-L, H - m);  line(W - m, H - m, W - m, H-m-L);
  pop();
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function renderGrain() {
  if (!grainLayer) return;
  grainLayer.clear();
  grainLayer.noStroke();
  const count = floor(W * H * 0.0011);
  for (let i = 0; i < count; i++) {
    const v = random(60, 210);
    grainLayer.fill(v, v, v, random(3, 12));
    grainLayer.circle(random(W), random(H), random(0.3, 1.4));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push();
  noFill();
  const steps = 60;
  const maxR  = dist(W / 2, H / 2, 0, 0) * 1.08;
  const sw    = (maxR / steps) * 2 + 2;
  strokeWeight(sw);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.78, 1.0, 0, 95, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W / 2, H / 2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() {
  reseedPattern(floor(random(100000)));
}

function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('20260427_schwarzschild_' + timestampString(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseedPattern(floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported. Use Chrome or Edge.'); return; }
  if (typeof Mp4Muxer    === 'undefined') { alert('mp4-muxer failed to load.'); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video:  { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (err) => { console.error(err); isRecording = false; setStatus('Encoder error', '#f44'); },
  });

  encoder.configure({
    codec:     'avc1.640028',
    width:     W,
    height:    H,
    bitrate:   18_000_000,
    framerate: FPS,
  });

  recFrameCount = 0;
  isRecording   = true;
  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  setStatus('Recording…', '#fff');
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
  a.href     = url;
  a.download = '20260427_schwarzschild_' + timestampString() + '.mp4';
  a.click();

  encoder.close();
  encoder = null;
  muxer   = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);

  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready', '#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, {
    timestamp: recFrameCount * (1_000_000 / FPS),
  });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function setStatus(text, color) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = text;
  el.style.color  = color;
}
function updateRecordingUI() {
  const dEl = document.getElementById('duration');
  const fEl = document.getElementById('frameCount');
  if (dEl) dEl.textContent = (recFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent  = recFrameCount;
}
function updateCanvasInfo() {
  const el = document.getElementById('canvasSize');
  if (el) el.textContent = W + ' × ' + H;
}
function timestampString() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_`
       + `${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}
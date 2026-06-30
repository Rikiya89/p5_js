'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS          = 60;
const MAX_DURATION = 30;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 30;

const TAU = Math.PI * 2;
const PHI = (1 + Math.sqrt(5)) / 2;

// ─── Palette ──────────────────────────────────────────────────────────────────
const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

const PARAMS = {
  glowStrength:   1.18,
  animationSpeed: 1.0,
};

// ─── Scene constants ──────────────────────────────────────────────────────────
const HILBERT = {
  N_BASIS:      12,
  TUBE_COUNT:   10,
  PROJ_STEPS:   140,
  TUBE_SEGS:    16,
  TUBE_RADIUS:  6.2,

  // Hero: (3,2) torus knot
  KNOT_P:       3,
  KNOT_Q:       2,
  KNOT_R:       188,
  KNOT_r:       62,
  KNOT_TUBE:    5.8,
  KNOT_SEGS:    320,
  KNOT_SIDES:   14,

  // Icosahedron cage around knot
  ICOSA_R:      285,   // circumradius — encloses the knot

  // Ghost halos
  HALO_COUNT:   2,

  // Fibonacci lattice nodes — basis state markers
  NODE_COUNT:   12,    // Fibonacci sphere, like 20260627's basis vecs
  NODE_R:       310,   // radius from origin

  // Orbit rings — one per tube, at tube centroid
  ORBIT_RING_R: 28,    // ring radius (not the orbit, the ring itself)

  DUST_COUNT:   160,

  CAM_RADIUS:   1340,
  ROTATION_SPEED: 1,
  CAM_FOV:      0.88,
  FOG_NEAR:     620,
  FOG_FAR:      3800,

  SCALE_X:      390,
  SCALE_Y:      320,
  SCALE_Z:      240,

  COMPOSITION_Y: 0,
};

// Icosahedron — 12 vertices, 30 edges (pre-computed once)
const ICOSA_VERTS = (() => {
  const t = PHI;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1,-t, 0], [ 1,-t, 0],
    [ 0,-1, t], [0, 1, t], [ 0,-1,-t], [ 0, 1,-t],
    [ t, 0,-1], [t, 0, 1], [-t, 0,-1], [-t, 0, 1],
  ];
  return raw.map(v => {
    const l = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return [v[0]/l, v[1]/l, v[2]/l];
  });
})();

const ICOSA_EDGES = (() => {
  // The 30 edges of a regular icosahedron: connect vertices within distance ~1.05 (normalized)
  const edges = [];
  for (let i = 0; i < 12; i++)
    for (let j = i + 1; j < 12; j++) {
      const a = ICOSA_VERTS[i], b = ICOSA_VERTS[j];
      const dx = a[0]-b[0], dy = a[1]-b[1], dz = a[2]-b[2];
      const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < 1.12) edges.push([i, j]);
    }
  return edges;
})();

// Fibonacci sphere lattice for NODE_COUNT basis nodes
const FIBO_NODES = (() => {
  const N = HILBERT.NODE_COUNT;
  return Array.from({ length: N }, (_, i) => {
    const phi   = Math.acos(1 - 2 * (i + 0.5) / N);
    const theta = TAU * i * PHI;
    return {
      x: Math.sin(phi) * Math.cos(theta),
      y: Math.cos(phi),
      z: Math.sin(phi) * Math.sin(theta),
      phase: (i / N) * TAU,
      freq:  1 + (i % 3),   // integer → seamless pulse
    };
  });
})();

let pg, glowPg, halfPg, quartPg, eighthPg, sixteenthPg, grainPg;
let canvasEl = null;

let tubeSeeds  = [];
let dustSeeds  = [];
// Pre-computed tube centroids & mean normals for orbit rings (built in bakeSeeds)
let tubeCentroids = [];
let camEye     = { x: 0, y: 0, z: 0 };
let camYaw     = 0;
let breath     = 1.0;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  pg          = createGraphics(W, H, WEBGL); pg.pixelDensity(1);      pg.colorMode(RGB,255,255,255,255);
  glowPg      = createGraphics(W, H, WEBGL); glowPg.pixelDensity(1);  glowPg.colorMode(RGB,255,255,255,255);
  halfPg      = createGraphics(W>>1, H>>1);  halfPg.pixelDensity(1);
  quartPg     = createGraphics(W>>2, H>>2);  quartPg.pixelDensity(1);
  eighthPg    = createGraphics(W>>3, H>>3);  eighthPg.pixelDensity(1);
  sixteenthPg = createGraphics(W>>4, H>>4);  sixteenthPg.pixelDensity(1);
  grainPg     = createGraphics(W, H);        grainPg.pixelDensity(1);

  reseed(20260630);

  const el = id => document.getElementById(id);
  if (el('startBtn'))    el('startBtn').onclick = startRecording;
  if (el('stopBtn'))     el('stopBtn').onclick  = stopRecording;
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(s) {
  randomSeed(s); noiseSeed(s);
  bakeSeeds(); bakeGrain();
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear(); grainPg.noStroke();
  for (let i = 0, n = Math.floor(W * H * 0.0016); i < n; i++) {
    const v = random(110, 200);
    grainPg.fill(v, v, v, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.15, 0.85));
  }
  for (let i = 0, n = Math.floor(W * H * 0.000035); i < n; i++) {
    const v = random(210, 255);
    grainPg.fill(v, v, v, random(12, 34));
    grainPg.circle(random(W), random(H), random(0.4, 1.2));
  }
}

// ─── Hilbert Space Math ───────────────────────────────────────────────────────
function basisFn(n, t, phase) { return Math.sin(n * t + phase); }

function stateVector(amps, phases, t) {
  const v = new Float32Array(HILBERT.N_BASIS);
  for (let n = 0; n < HILBERT.N_BASIS; n++)
    v[n] = amps[n] * basisFn(n + 1, t, phases[n]);
  return v;
}

function innerProduct(f, g) {
  let s = 0;
  for (let n = 0; n < HILBERT.N_BASIS; n++) s += f[n] * g[n];
  return s;
}

function projectToWorld(v) {
  let x = 0, y = 0, z = 0;
  for (let n = 0; n < HILBERT.N_BASIS; n++) {
    const w = n / (HILBERT.N_BASIS - 1);
    x += v[n] * Math.exp(-5 * w * w);
    y += v[n] * Math.exp(-5 * (w - 0.5) * (w - 0.5));
    z += v[n] * Math.exp(-5 * (w - 1)   * (w - 1));
  }
  return { x: x * HILBERT.SCALE_X, y: y * HILBERT.SCALE_Y, z: z * HILBERT.SCALE_Z };
}

// ─── Seed baking ──────────────────────────────────────────────────────────────
function bakeSeeds() {
  tubeSeeds = []; dustSeeds = []; tubeCentroids = [];

  for (let i = 0; i < HILBERT.TUBE_COUNT; i++) {
    const amps   = new Float32Array(HILBERT.N_BASIS);
    const phases = new Float32Array(HILBERT.N_BASIS);
    for (let n = 0; n < HILBERT.N_BASIS; n++) {
      const decay = 1 / (1 + n * 0.85);
      amps[n]   = random(0.3, 1.0) * decay;
      phases[n] = random(TAU);
    }
    const fShift = 1 + Math.round(random(0, 1));
    tubeSeeds.push({ amps, phases, freqShift: fShift, phaseOff: random(TAU) });

    // Pre-compute centroid at loop=0 (static approximation for ring placement)
    let cx = 0, cy = 0, cz = 0;
    const S = 16;
    for (let k = 0; k <= S; k++) {
      const u = (k / S) * TAU;
      const ph = new Float32Array(HILBERT.N_BASIS);
      for (let n = 0; n < HILBERT.N_BASIS; n++) ph[n] = phases[n];
      const v  = stateVector(amps, ph, u);
      const pt = projectToWorld(v);
      cx += pt.x; cy += pt.y; cz += pt.z;
    }
    tubeCentroids.push({ x: cx/(S+1), y: cy/(S+1), z: cz/(S+1) });
  }

  for (let k = 0; k < HILBERT.DUST_COUNT; k++) {
    const th = random(TAU), el = random(-1, 1);
    const r  = 500 + Math.pow(random(), 0.6) * 950;
    const sq = Math.sqrt(Math.max(0, 1 - el * el));
    dustSeeds.push({
      x:   Math.cos(th) * sq * r,
      y:   el * r * 0.46,
      z:   Math.sin(th) * sq * r,
      tw:  random(TAU),
      twk: 2 + Math.floor(random(4)),
    });
  }
}

// ─── Fog ──────────────────────────────────────────────────────────────────────
function fogFactor(x, y, z) {
  const dx = x - camEye.x, dy = y - camEye.y, dz = z - camEye.z;
  const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);
  const k  = Math.max(0, Math.min(1, (d - HILBERT.FOG_NEAR) / (HILBERT.FOG_FAR - HILBERT.FOG_NEAR)));
  const s  = k * k * (3 - 2 * k);
  return Math.max(0, 1 - s);
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const frame = isRecording ? recFrameCount : frameCount;
  const loop  = (frame % LOOP_FRAMES) / LOOP_FRAMES;
  renderFrame(loop);

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    const el = id => document.getElementById(id);
    if (el('duration'))   el('duration').textContent   = (recFrameCount / FPS).toFixed(1);
    if (el('frameCount')) el('frameCount').textContent = recFrameCount;
    const pf = document.getElementById('progressFill');
    if (pf) pf.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function renderFrame(loop) {
  const phase = loop * TAU * PARAMS.animationSpeed;
  breath = 0.88 + 0.12 * Math.sin(2 * phase - Math.PI * 0.5);

  pg.clear(); glowPg.clear();
  prepBuffer(pg,     phase);
  prepBuffer(glowPg, phase);

  drawScene(glowPg, loop, phase, true);
  drawScene(pg,     loop, phase, false);
  composite();
  drawHUD(loop);
  drawCornerBrackets();
  drawVignette();
}

function prepBuffer(g, phase) {
  g.blendMode(ADD);
  g.drawingContext.disable(g.drawingContext.DEPTH_TEST);
  applyCamera(g, phase);
}

function applyCamera(g, ph) {
  camYaw = ph * HILBERT.ROTATION_SPEED;
  const r  = HILBERT.CAM_RADIUS + 55 * Math.sin(2 * ph);
  const ey = -60 + 110 * Math.sin(ph) + 38 * Math.sin(2 * ph + 0.8);
  camEye.x = Math.sin(camYaw) * r;
  camEye.y = ey;
  camEye.z = Math.cos(camYaw) * r;
  const lookY = 18 * Math.sin(2 * ph) + 10 * Math.sin(3 * ph);
  g.perspective(HILBERT.CAM_FOV, W / H, 10, 9000);
  g.camera(camEye.x, camEye.y, camEye.z, 0, lookY, 0, 0, 1, 0);
}

// ─── 4-pass bloom ────────────────────────────────────────────────────────────
function composite() {
  background(BG_R, BG_G, BG_B);
  halfPg.clear();      halfPg.image(glowPg,    0, 0, W>>1, H>>1);
  quartPg.clear();     quartPg.image(halfPg,    0, 0, W>>2, H>>2);
  eighthPg.clear();    eighthPg.image(quartPg,  0, 0, W>>3, H>>3);
  sixteenthPg.clear(); sixteenthPg.image(eighthPg, 0, 0, W>>4, H>>4);

  drawingContext.globalCompositeOperation = 'screen';
  tint(255, Math.round(48  * breath)); image(sixteenthPg, 0, 0, W, H);
  tint(255, Math.round(80  * breath)); image(eighthPg,    0, 0, W, H);
  tint(255, Math.round(152 * breath)); image(quartPg,     0, 0, W, H);
  tint(255, Math.round(235 * breath)); image(halfPg,      0, 0, W, H);
  noTint(); image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 16); image(grainPg, 0, 0); noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

// ─── Scene ────────────────────────────────────────────────────────────────────
function drawScene(g, loop, phase, isGlow) {
  g.push();
  g.translate(0, HILBERT.COMPOSITION_Y, 0);
  g.noStroke();

  drawDust(g, phase, isGlow);            // 1. peripheral star sparkle
  drawFibonacciNodes(g, phase, isGlow);  // 2. basis-state lattice nodes
  drawHaloTori(g, phase, isGlow);        // 3. ghost halos
  drawIcosahedronCage(g, phase, isGlow); // 4. crystal cage around knot
  drawOrbitRings(g, loop, phase, isGlow);// 5. orbit rings at tube centroids
  drawTubes(g, loop, phase, isGlow);     // 6. Lissajous tubes
  drawTorusKnot(g, phase, isGlow);       // 7. hero knot — drawn last

  g.pop();
}

// ─── Geometry: filled torus ───────────────────────────────────────────────────
function drawTorus(g, R, r, nseg, ntube, alpha, isGlow) {
  if (alpha < 1) return;
  g.noStroke();
  g.fill(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
  for (let i = 0; i < nseg; i++) {
    const a0 = (i / nseg) * TAU, a1 = ((i + 1) / nseg) * TAU;
    g.beginShape(TRIANGLE_STRIP);
    for (let j = 0; j <= ntube; j++) {
      const b = (j / ntube) * TAU, cb = Math.cos(b), sb = Math.sin(b);
      g.vertex((R + r*cb)*Math.cos(a0), r*sb, (R + r*cb)*Math.sin(a0));
      g.vertex((R + r*cb)*Math.cos(a1), r*sb, (R + r*cb)*Math.sin(a1));
    }
    g.endShape();
  }
}

// ─── Geometry: tube along arbitrary spine ────────────────────────────────────
function drawTube(g, pts, nsides, isGlow) {
  if (pts.length < 2) return;

  const frames = pts.map((p, i) => {
    let tx, ty, tz;
    if (i === 0) {
      tx = pts[1].x - p.x; ty = pts[1].y - p.y; tz = pts[1].z - p.z;
    } else if (i === pts.length - 1) {
      tx = p.x - pts[i-1].x; ty = p.y - pts[i-1].y; tz = p.z - pts[i-1].z;
    } else {
      tx = pts[i+1].x - pts[i-1].x;
      ty = pts[i+1].y - pts[i-1].y;
      tz = pts[i+1].z - pts[i-1].z;
    }
    const tl = Math.sqrt(tx*tx + ty*ty + tz*tz) + 1e-8;
    tx /= tl; ty /= tl; tz /= tl;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(ty) > 0.9) { ux = 0; uy = 0; uz = 1; }
    let bx = ty*uz - tz*uy, by = tz*ux - tx*uz, bz = tx*uy - ty*ux;
    const bl = Math.sqrt(bx*bx + by*by + bz*bz) + 1e-8;
    bx /= bl; by /= bl; bz /= bl;
    return { bx, by, bz, nx: by*tz - bz*ty, ny: bz*tx - bx*tz, nz: bx*ty - by*tx };
  });

  const rings = pts.map((p, i) => {
    const f = frames[i];
    return Array.from({ length: nsides + 1 }, (_, s) => {
      const ang = (s / nsides) * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
      return [
        p.x + p.r * (ca * f.bx + sa * f.nx),
        p.y + p.r * (ca * f.by + sa * f.ny),
        p.z + p.r * (ca * f.bz + sa * f.nz),
      ];
    });
  });

  g.noStroke();
  for (let i = 0; i < pts.length - 1; i++) {
    const a = ((pts[i].alpha + pts[i+1].alpha) * 0.5) * (isGlow ? PARAMS.glowStrength : 1);
    if (a < 1) continue;
    g.fill(INK_R, INK_G, INK_B, a);
    g.beginShape(TRIANGLE_STRIP);
    for (let s = 0; s <= nsides; s++) {
      const vA = rings[i][s], vB = rings[i+1][s];
      g.vertex(vA[0], vA[1], vA[2]);
      g.vertex(vB[0], vB[1], vB[2]);
    }
    g.endShape();
  }
}

// ─── Icosahedron cage ─────────────────────────────────────────────────────────
// 30 edges drawn as thin stroke lines, scaled to ICOSA_R.
// Very low alpha — purely structural, like a crystal lattice surrounding the knot.
// Slow precession spin (1 full rotation per loop, seamless).
function drawIcosahedronCage(g, ph, isGlow) {
  const R    = HILBERT.ICOSA_R;
  const fog  = fogFactor(0, 0, 0);
  const spin = ph;   // 1 revolution per loop
  const alpha = (isGlow ? 22 : 88) * fog * breath;
  if (alpha < 1) return;

  g.push();
  g.rotateY(spin);
  g.rotateX(0.18 + 0.04 * Math.sin(2 * ph));
  g.stroke(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
  g.strokeWeight(isGlow ? 5.5 : 1.1);
  g.noFill();

  for (const [i, j] of ICOSA_EDGES) {
    const a = ICOSA_VERTS[i], b = ICOSA_VERTS[j];
    g.line(a[0]*R, a[1]*R, a[2]*R, b[0]*R, b[1]*R, b[2]*R);
  }

  // Vertex markers
  g.noStroke();
  g.fill(INK_R, INK_G, INK_B, (isGlow ? 28 : 100) * fog * breath);
  for (const v of ICOSA_VERTS) {
    g.push();
    g.translate(v[0]*R, v[1]*R, v[2]*R);
    g.sphere(isGlow ? 9 : 3.8);
    g.pop();
  }
  g.pop();
}

// ─── Fibonacci lattice nodes ──────────────────────────────────────────────────
// 12 nodes on a Fibonacci sphere at NODE_R — the "basis vectors" of the space.
// Each pulses at an integer frequency and has a small ring in its tangent plane.
function drawFibonacciNodes(g, ph, isGlow) {
  const R = HILBERT.NODE_R;
  g.noStroke();

  for (let i = 0; i < FIBO_NODES.length; i++) {
    const n    = FIBO_NODES[i];
    const fog  = fogFactor(n.x * R, n.y * R * 0.55, n.z * R);
    if (fog < 0.05) continue;
    const pulse = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(n.freq * ph + n.phase), 1.8);
    const px = n.x * R, py = n.y * R * 0.55, pz = n.z * R;

    // Core sphere
    const aCore = (isGlow ? 10 : 40) * fog * pulse * breath;
    g.push();
    g.translate(px, py, pz);
    g.fill(INK_R, INK_G, INK_B, aCore * (isGlow ? PARAMS.glowStrength : 1));
    g.sphere(isGlow ? 8 + pulse * 6 : 2.2 + pulse * 1.4);

    // Tangent ring — like 20260627's subspace rings
    // Build tangent frame from node normal (n.x, n.y, n.z)
    const up = Math.abs(n.y) < 0.85 ? [0, 1, 0] : [1, 0, 0];
    const t1x = n.y*up[2] - n.z*up[1], t1y = n.z*up[0] - n.x*up[2], t1z = n.x*up[1] - n.y*up[0];
    const t1l = Math.sqrt(t1x*t1x + t1y*t1y + t1z*t1z) + 1e-8;
    const tx = t1x/t1l, ty2 = t1y/t1l, tz = t1z/t1l;
    const t2x = n.y*tz - n.z*ty2, t2y = n.z*tx - n.x*tz, t2z = n.x*ty2 - n.y*tx;

    const ringR = 16 + pulse * 8;
    const aRing = (isGlow ? 5 : 20) * fog * pulse * breath;
    if (aRing > 1) {
      g.stroke(INK_R, INK_G, INK_B, aRing * (isGlow ? PARAMS.glowStrength : 1));
      g.strokeWeight(isGlow ? 2.5 : 0.5);
      g.noFill();
      const segs = 24;
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * TAU, a1 = ((s+1) / segs) * TAU;
        const x0 = tx*Math.cos(a0)*ringR + t2x*Math.sin(a0)*ringR;
        const y0 = ty2*Math.cos(a0)*ringR + t2y*Math.sin(a0)*ringR;
        const z0 = tz*Math.cos(a0)*ringR + t2z*Math.sin(a0)*ringR;
        const x1 = tx*Math.cos(a1)*ringR + t2x*Math.sin(a1)*ringR;
        const y1 = ty2*Math.cos(a1)*ringR + t2y*Math.sin(a1)*ringR;
        const z1 = tz*Math.cos(a1)*ringR + t2z*Math.sin(a1)*ringR;
        if (s % 3 !== 2) g.line(x0, y0, z0, x1, y1, z1);  // dashed look
      }
      g.noStroke();
    }
    g.pop();
  }
}

// ─── Orbit rings ──────────────────────────────────────────────────────────────
// One thin ring at each tube's centroid, oriented in the XZ plane (perpendicular
// to the vertical, so they read as orbital tracks). Radius pulses with tube energy.
function drawOrbitRings(g, loop, ph, isGlow) {
  const stride = isGlow ? 3 : 1;
  g.noFill();

  for (let si = 0; si < HILBERT.TUBE_COUNT; si += stride) {
    const c   = tubeCentroids[si];
    const fog = fogFactor(c.x, c.y, c.z);
    if (fog < 0.06) continue;

    const shimmer = 0.5 + 0.5 * Math.sin(2 * ph + si * 0.72);
    const alpha   = (isGlow ? 6 : 22) * fog * shimmer * breath;
    if (alpha < 1) continue;

    // Orbit radius = distance from origin to centroid, projected to XZ
    const orbitR = Math.sqrt(c.x*c.x + c.z*c.z) * 0.9;
    if (orbitR < 10) continue;

    const segs = 36;
    g.push();
    g.translate(0, c.y, 0);
    g.stroke(INK_R, INK_G, INK_B, alpha * (isGlow ? PARAMS.glowStrength : 1));
    g.strokeWeight(isGlow ? 2.8 : 0.55);

    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * TAU, a1 = ((s+1) / segs) * TAU;
      if (s % 4 === 3) continue;  // dashed — every 4th segment skipped
      g.line(
        Math.cos(a0)*orbitR, 0, Math.sin(a0)*orbitR,
        Math.cos(a1)*orbitR, 0, Math.sin(a1)*orbitR
      );
    }
    g.pop();
  }
  g.noStroke();
}

// ─── Torus knot ───────────────────────────────────────────────────────────────
function torusKnotPoint(t, R, r, p, q) {
  const phi = p * t, theta = q * t;
  const cp  = Math.cos(phi), sp = Math.sin(phi), ct = Math.cos(theta);
  return {
    x: (R + r * ct) * cp,
    y: (R + r * ct) * sp,
    z: r * Math.sin(theta),
  };
}

function drawTorusKnot(g, ph, isGlow) {
  const H     = HILBERT;
  const spin  = ph;
  const pulse = 1 + 0.05 * Math.sin(2 * ph);

  const N   = H.KNOT_SEGS;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t    = (i / N) * TAU;
    const kp   = torusKnotPoint(t, H.KNOT_R * pulse, H.KNOT_r, H.KNOT_P, H.KNOT_Q);
    const fog2 = fogFactor(kp.x, kp.y, kp.z);
    pts.push({
      x: kp.x, y: kp.y, z: kp.z,
      r:     H.KNOT_TUBE * breath * (0.9 + 0.1 * Math.sin(3 * t)),
      alpha: (isGlow ? 38 : 130) * fog2 * breath,
    });
  }
  const f = pts[0];
  pts[pts.length - 1] = { x: f.x, y: f.y, z: f.z, r: f.r, alpha: f.alpha };

  g.push();
  g.rotateX(Math.PI * 0.22 + 0.06 * Math.sin(ph));
  g.rotateY(spin);
  g.rotateZ(0.08 * Math.sin(2 * ph));
  drawTube(g, pts, H.KNOT_SIDES, isGlow);
  g.pop();
}

// ─── Ghost halos ──────────────────────────────────────────────────────────────
function drawHaloTori(g, ph, isGlow) {
  const halos = [
    { rx: Math.PI * 0.52, rz:  0.36, R: 195, r: 4.2, segs: 72, tube: 10, alphaScale: 1.0 },
    { rx: Math.PI * 0.18, rz: -0.52, R: 155, r: 3.4, segs: 60, tube: 10, alphaScale: 0.65 },
  ];
  for (let i = 0; i < HILBERT.HALO_COUNT; i++) {
    const h   = halos[i];
    const fog = fogFactor(0, 0, 0);
    const drift = i * Math.PI;
    const alpha = (isGlow ? 7 : 22) * fog * breath * h.alphaScale;
    g.push();
    g.rotateX(h.rx + 0.04 * Math.sin(ph + drift));
    g.rotateZ(h.rz + 0.03 * Math.sin(ph * 2 + drift));
    drawTorus(g, h.R, h.r * breath, h.segs, h.tube, alpha, isGlow);
    g.pop();
  }
}

// ─── Raised-cosine taper ──────────────────────────────────────────────────────
function raisedCosine(prog, hold = 0.14) {
  if (prog < hold)      return 0.5 * (1 - Math.cos(Math.PI * prog / hold));
  if (prog > 1 - hold)  return 0.5 * (1 - Math.cos(Math.PI * (1 - prog) / hold));
  return 1;
}

// ─── Lissajous tubes ──────────────────────────────────────────────────────────
function drawTubes(g, loop, ph, isGlow) {
  const stride = isGlow ? 2 : 1;
  g.push();
  for (let si = 0; si < HILBERT.TUBE_COUNT; si += stride) {
    const seed  = tubeSeeds[si];
    const steps = isGlow ? 28 : HILBERT.PROJ_STEPS;

    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const u = (k / steps) * TAU;
      const phases = new Float32Array(HILBERT.N_BASIS);
      for (let n = 0; n < HILBERT.N_BASIS; n++)
        phases[n] = seed.phases[n] + n * loop * TAU * seed.freqShift + seed.phaseOff;

      const v       = stateVector(seed.amps, phases, u);
      const pt      = projectToWorld(v);
      const normVal = Math.sqrt(Math.abs(innerProduct(v, v)));
      const fog     = fogFactor(pt.x, pt.y, pt.z);
      const prog    = k / steps;
      const taper   = raisedCosine(prog, 0.14);
      const shimmer = 0.78 + 0.22 * Math.sin(2 * ph + si * 0.75);

      pts.push({
        x: pt.x, y: pt.y, z: pt.z,
        r:     HILBERT.TUBE_RADIUS * Math.min(1.25, normVal * 0.85) * taper * breath,
        alpha: (isGlow ? 11 : 48) * fog * shimmer * taper * breath,
      });
    }
    drawTube(g, pts, HILBERT.TUBE_SEGS, isGlow);
  }
  g.pop();
}

// ─── Dust ─────────────────────────────────────────────────────────────────────
function drawDust(g, ph, isGlow) {
  const stride = isGlow ? 5 : 2;
  for (let i = 0; i < dustSeeds.length; i += stride) {
    const d   = dustSeeds[i];
    const fog = fogFactor(d.x, d.y, d.z);
    if (fog < 0.04) continue;
    const tw    = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(d.twk * ph + d.tw), 2.2);
    const aBase = (isGlow ? 6 : 22) * tw * fog * breath;
    if (aBase < 1) continue;

    g.push();
    g.translate(d.x, d.y, d.z);
    g.rotateY(camYaw);

    g.noStroke();
    g.fill(INK_R, INK_G, INK_B, aBase * (isGlow ? PARAMS.glowStrength : 1));
    g.circle(0, 0, 1.6);

    if (!isGlow) {
      const arm = 3.8 * tw;
      g.noFill();
      g.stroke(INK_R, INK_G, INK_B, aBase * 0.55);
      g.strokeWeight(0.5);
      g.line(-arm, 0, arm, 0);
      g.line(0, -arm * 0.62, 0, arm * 0.62);
      g.noStroke();
    }
    g.pop();
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(loop) {
  push();
  noStroke();
  textFont('ui-monospace, Menlo, monospace');
  fill(255, 255, 255, 140);
  textSize(13); textAlign(LEFT, TOP);
  text('HILBERT SPACE · 3D PROJECTION', 52, 52);
  fill(255, 255, 255, 60);
  textSize(10);
  text('ψ_n(t)=sin(n·t+φ_n)  ⟨f,g⟩=Σf_n·g_n  basis='
    + HILBERT.N_BASIS + '  loop=' + loop.toFixed(3), 52, 74);
  fill(255, 255, 255, 45); textSize(10);
  textAlign(LEFT, BOTTOM);  text(W + '×' + H + ' · ' + FPS + 'fps', 52, H - 52);
  textAlign(RIGHT, BOTTOM); text('20260630 · HILBERT SPACE', W - 52, H - 52);
  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push(); noFill(); stroke(255, 255, 255, 38); strokeWeight(0.7);
  const m = 34, L = 24;
  line(m,m,m+L,m); line(m,m,m,m+L);
  line(W-m,m,W-m-L,m); line(W-m,m,W-m,m+L);
  line(m,H-m,m+L,H-m); line(m,H-m,m,H-m-L);
  line(W-m,H-m,W-m-L,H-m); line(W-m,H-m,W-m,H-m-L);
  pop();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push(); noFill();
  const steps = 80, maxR = dist(W/2, H/2, 0, 0) * 1.12;
  strokeWeight((maxR / steps) * 2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    const a = map(k, 0.60, 1.0, 0, 150, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W/2, H/2, lerp(0, maxR, k) * 2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(Math.floor(random(100000))); }
function keyReleased() {
  if (key === 'r' || key === 'R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key === 's' || key === 'S') { saveCanvas('hilbert_' + ts(), 'png'); return false; }
  if (keyCode === DELETE || keyCode === BACKSPACE) { reseed(Math.floor(random(100000))); return false; }
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === 'undefined') { alert('WebCodecs not supported.'); return; }
  if (typeof Mp4Muxer === 'undefined') { alert('mp4-muxer not loaded.'); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory', firstTimestampBehavior: 'offset',
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (e) => { console.error(e); isRecording = false; setStatus('Error','#f44'); },
  });
  encoder.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0; isRecording = true;
  const el = id => document.getElementById(id);
  if (el('duration'))   el('duration').textContent   = '0.0';
  if (el('frameCount')) el('frameCount').textContent = '0';
  if (el('startBtn'))   el('startBtn').disabled = true;
  if (el('stopBtn'))    el('stopBtn').disabled  = false;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Recording…', '#fff');
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus('Finalizing…', '#ccc');
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'hilbert_' + ts() + '.mp4'; a.click();
  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = id => document.getElementById(id);
  if (el('startBtn')) el('startBtn').disabled = false;
  if (el('stopBtn'))  el('stopBtn').disabled  = true;
  const pf = document.getElementById('progressFill');
  if (pf) pf.style.width = '0%';
  setStatus('Complete', '#fff');
  setTimeout(() => setStatus('Ready','#ccc'), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(txt, c) {
  const el = document.getElementById('status');
  if (el) { el.textContent = txt; el.style.color = c; }
}

function ts() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
}

if (typeof window !== 'undefined') {
  window.startRecording = startRecording;
  window.stopRecording  = stopRecording;
}

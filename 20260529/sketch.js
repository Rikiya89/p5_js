'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS          = 60;
const MAX_DURATION = 30;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 30;   // 30-second seamless loop

// ─── Math ─────────────────────────────────────────────────────────────────────
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈137.508° — the Fibonacci angle

function smoothstep(a, b, x) {
  const t = constrain((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// ─── Layers ───────────────────────────────────────────────────────────────────
let webglLayer = null;
let bloomLayer = null;
let grainLayer = null;
let canvasEl   = null;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Point cloud parameters ────────────────────────────────────────────────────
const N_POINTS   = 2600;   // points on the Fibonacci sphere
const BASE_R     = 430;    // sphere radius
let cloudPts = null;       // precomputed Fibonacci-sphere directions
let seedPhase = 0;

// Time-varying light direction
let LIGHT = [0.55, -0.7, 0.45];
function updateLight(t) {
  const baseY = -0.55;
  const r = Math.sqrt(1 - baseY * baseY);
  const a = t * 1.0 + seedPhase * 0.3;
  LIGHT = [r * Math.cos(a), baseY, r * Math.sin(a)];
}

// ─── Ambient cloud / stars / rays ──────────────────────────────────────────────
let cloud = [], stars = [], rays = [];
const N_CLOUD = 500, N_STARS = 90, N_RAYS = 22;

function buildCloud() {
  cloud = [];
  for (let i = 0; i < N_CLOUD; i++) {
    const a = random() * TAU, b = random() * TAU;
    const Rc = 340 + (random() - 0.5) * 260;
    const rc =  70 + (random() - 0.5) * 110;
    cloud.push({
      x: (Rc + rc * Math.cos(b)) * Math.cos(a),
      y:  rc * Math.sin(b) * 1.3,
      z: (Rc + rc * Math.cos(b)) * Math.sin(a),
      phase: random(TAU), scale: 0.5 + random(),
    });
  }
}
function buildStars() {
  stars = [];
  for (let i = 0; i < N_STARS; i++) {
    const u = random(), v = random();
    const th = u * TAU, ph = Math.acos(2 * v - 1);
    const r = 750 + random() * 260;
    stars.push({ x: r*Math.sin(ph)*Math.cos(th), y: r*Math.cos(ph), z: r*Math.sin(ph)*Math.sin(th), phase: random(TAU), scale: 0.6 + random() * 1.5 });
  }
}
function buildRays() {
  rays = [];
  for (let i = 0; i < N_RAYS; i++) {
    const u = random(), v = random();
    const th = u * TAU, ph = Math.acos(2 * v - 1);
    rays.push({ dx: Math.sin(ph)*Math.cos(th), dy: Math.cos(ph), dz: Math.sin(ph)*Math.sin(th), phase: random(TAU), length: 420 + random() * 200 });
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  webglLayer = createGraphics(W, H, WEBGL);
  webglLayer.pixelDensity(1);
  webglLayer.colorMode(RGB, 255, 255, 255, 255);
  webglLayer.noFill();
  webglLayer.strokeCap(ROUND);

  bloomLayer = createGraphics(W >> 1, H >> 1);
  bloomLayer.pixelDensity(1);
  bloomLayer.colorMode(RGB, 255, 255, 255, 255);

  grainLayer = createGraphics(W, H);
  grainLayer.pixelDensity(1);
  grainLayer.colorMode(RGB, 255, 255, 255, 255);
  renderGrain();

  reseed(floor(random(100000)));

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(s) {
  randomSeed(s); noiseSeed(s);
  seedPhase = random(TAU);
  cloudPts  = buildFibSphere(N_POINTS);
  buildCloud(); buildStars(); buildRays();
}

// ─── Fibonacci sphere ───────────────────────────────────────────────────────────
// Distributes N points near-uniformly on a unit sphere using the golden angle.
// Returns per-point base direction (unit vector) + the source index/phase so the
// displacement function downstream can stagger motion across the spiral.
function buildFibSphere(n) {
  const pts = new Array(n);
  for (let i = 0; i < n; i++) {
    // y sweeps linearly from +1 (north pole) to -1 (south pole) → equal-area bands
    const y = 1 - 2 * (i + 0.5) / n;
    const rxy = Math.sqrt(Math.max(0, 1 - y * y)); // radius of the latitude ring
    const a = i * GOLDEN_ANGLE;                    // golden-angle rotation per point
    const x = Math.cos(a) * rxy;
    const z = Math.sin(a) * rxy;
    pts[i] = {
      nx: x, ny: y, nz: z,        // base unit direction (surface normal)
      idx: i,
      u: i / (n - 1),             // 0 (north) → 1 (south)
      ringR: rxy,                 // distance from polar axis, 0 at poles → 1 at equator
      ang: a % TAU,               // azimuth along the spiral
      jit: random(TAU),           // per-point random phase for organic shimmer
    };
  }
  return pts;
}

// ─── Point displacement (the loop's "shape") ───────────────────────────────────
// TODO ── Master's contribution slot (5–10 lines).
// Given a Fibonacci-sphere point `p` and loop time `t` (0→TAU, period = one loop),
// return a RADIUS for that point this frame. Every term MUST be a function of `t`
// (sin/cos of t·k) so frame 0 == frame LOOP_FRAMES → seamless Reels loop.
//
// Parameters:
//   p  — { nx,ny,nz, u (0=north…1=south), ringR (0 pole…1 equator), ang, jit }
//   t  — loop time in radians (0 → TAU)
// Return: radius in world units (BASE_R ≈ 430 is the resting sphere surface)
//
// Ideas to play with (each is one term — combine 2–3):
//   • Latitude breathing wave:  Math.sin(p.u * Math.PI * K - t * S)   travels pole→pole
//   • Golden-spiral ripple:     Math.sin(p.ang * K - t * S)           spins around axis
//   • Global pulse:             Math.sin(t)                           whole sphere breathes
//   • Per-point shimmer:        Math.sin(t * S + p.jit)               twinkle (keep small)
// Envelope tip: multiply a wave by `p.ringR` to silence the poles and emphasise the equator.
// ─── Petal shape ────────────────────────────────────────────────────────────────
// STATIC angular flower profile (no t-drift): N_PETALS lobes around the polar axis,
// concentrated off the poles by a latitude envelope. Returns 0 (valley) → 1 (crest).
// Used for BOTH the radius bulge and the directional splay so they stay in sync.
const N_PETALS = 5;   // Fibonacci count — classic phyllotaxis bloom
function petalShape(p) {
  const lobe   = 0.5 + 0.5 * Math.cos(N_PETALS * p.ang);   // 5 fixed lobes, 0→1
  const latEnv = Math.sin(p.u * Math.PI);                  // 0 at poles → 1 at equator
  return lobe * latEnv;
}
// Bloom envelope: oscillates in [BLOOM_MIN, 1] once per loop — the flower breathes
// open↔mostly-open but NEVER collapses to a featureless sphere, so 5-fold petal
// structure is present the whole loop. Seamless: bloom(0)===bloom(TAU).
const BLOOM_MIN = 0.45;
function bloomEnv(t) { return BLOOM_MIN + (1 - BLOOM_MIN) * (0.5 - 0.5 * Math.cos(t)); }

function pointRadius(p, t) {
  const bloom = bloomEnv(t);

  // Petal crests push outward as the flower opens.
  const petal = petalShape(p) * bloom * 120;

  // Traveling ripple along the Fibonacci spiral index — the wave follows the
  // plant's own geometry so it looks organic, not mechanical.
  // Each point's position in the spiral (p.idx) gives it a natural phase offset.
  const spiralWave = Math.sin(p.idx * 0.08 - t * 3.0) * 18;

  // Per-petal sequential ripple: each of the 5 petals ripples slightly after the
  // previous one (phase = which petal lobe the point sits in).
  const petalPhase = Math.round(N_PETALS * p.ang / TAU) / N_PETALS * TAU;
  const petalRipple = petalShape(p) * Math.sin(t * 2.0 - petalPhase) * 14;

  // Global breath pulse + fine shimmer.
  const pulse   = Math.sin(t) * 16;
  const shimmer = Math.sin(t * 4.0 + p.jit) * 5;

  return BASE_R + petal + spiralWave + petalRipple + pulse + shimmer;
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const t    = loop * TAU;

  updateLight(t);
  background(2, 3, 8);
  renderScene(t, loop);
  applyBloom();

  push(); tint(255, 5); image(grainLayer, 0, 0); noTint(); pop();
  drawCornerBrackets();
  drawHUD(loop);
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    const el = id => document.getElementById(id);
    if (el('duration'))   el('duration').textContent   = (recFrameCount/FPS).toFixed(1);
    if (el('frameCount')) el('frameCount').textContent = recFrameCount;
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── 3D scene ─────────────────────────────────────────────────────────────────
let viewBasis = null;

function computeViewBasis(t) {
  // Organic yaw: one full rotation + a sine wobble (integer freq) that breathes the
  // speed — accelerates mid-loop, lingers at start/end. Feels alive, not mechanical.
  // Both terms are integer-frequency → camA(0) === camA(TAU), seamless.
  const camA = t * 1.0 + Math.sin(t * 2.0) * 0.25 + seedPhase;

  // The 5 petals (5-fold symmetry about Y) only read FACE-ON, so the camera stays
  // HIGH (near top-down) for the WHOLE loop — petals are legible the entire time.
  // It spins in yaw (looking down) and gently breathes in/out, but never drops to a
  // side view (which would hide the flower). bloomEnv is only used for the geometry.
  // Radius breathing: pull BACK as the flower opens so the splayed petals stay framed
  // (the bloom grows the silhouette, so backing off keeps the whole rosette in view).
  const breath = 0.5 - 0.5 * Math.cos(t);     // full 0→1→0 swing, seamless
  const camR = lerp(440, 600, breath);        // closed=near, open=pulled back
  // Persistent high elevation ≈ 78° above horizontal (tan78°≈4.7) → near top-down.
  const camY = camR * 4.7;

  const at  = [0, 0, 0];
  const eye = [camR * Math.cos(camA), camY, camR * Math.sin(camA)];
  const fx=at[0]-eye[0], fy=at[1]-eye[1], fz=at[2]-eye[2];
  const fm=Math.hypot(fx,fy,fz);
  const fwd=[fx/fm, fy/fm, fz/fm];
  // Looking down the whole time, so world-up is ~parallel to view (gimbal). Use the
  // orbit-plane horizontal as the up reference — stable, and spins the rosette with yaw.
  const up = [Math.cos(camA), 0, Math.sin(camA)];
  const rx=fwd[1]*up[2]-fwd[2]*up[1], ry=fwd[2]*up[0]-fwd[0]*up[2], rz=fwd[0]*up[1]-fwd[1]*up[0];
  const rm=Math.hypot(rx,ry,rz);
  const right=[rx/rm,ry/rm,rz/rm];
  const ux=right[1]*fwd[2]-right[2]*fwd[1], uy=right[2]*fwd[0]-right[0]*fwd[2], uz=right[0]*fwd[1]-right[1]*fwd[0];
  return { right, up:[ux,uy,uz], fwd, eye, at };
}

function viewDepth(x, y, z) {
  const { fwd, eye } = viewBasis;
  return (x-eye[0])*fwd[0] + (y-eye[1])*fwd[1] + (z-eye[2])*fwd[2];
}

function renderScene(t, _loop) {
  webglLayer.clear();
  webglLayer.push();
  webglLayer.background(0,0,0,0);
  webglLayer.noFill();

  viewBasis = computeViewBasis(t);
  const { eye, at } = viewBasis;
  webglLayer.camera(eye[0],eye[1],eye[2], at[0],at[1],at[2], 0,1,0);
  webglLayer.perspective(Math.PI/3.6, W/H, 0.1, 8000);

  // Slow scene drift — subtle current. Integer frequencies → seamless loop.
  webglLayer.rotateX(Math.sin(t*1.0)*0.04);
  webglLayer.rotateZ(Math.cos(t*1.0)*0.03);
  webglLayer.translate(0, 14*Math.sin(t*1.0), 0);

  drawHorizonRing(t);
  drawAxisGuides(t);
  drawStars(t);
  drawInnerRays(t);
  drawCloud(t);

  // The Fibonacci point cloud — exactly one full revolution per loop (seamless).
  // Rotation is applied in JS (not rotateY) so viewDepth/fog see true positions.
  drawPointCloud(t);

  webglLayer.pop();
  image(webglLayer, 0, 0);
}

// ─── Point cloud render ─────────────────────────────────────────────────────────
// Each Fibonacci-sphere point is pushed out to pointRadius() this frame, then
// drawn as a fog- and light-shaded glowing dot. The Y-rotation is applied here in
// JS (not via rotateY) so viewDepth/fog match the true on-screen position.
// Parastichy threads connect points at Fibonacci offsets (i+13, i+21) — these are
// the spiral arms the eye actually reads in a sunflower head, not the i→i+1 chords.
const PHI_OFFSETS = [13, 21];   // consecutive Fibonacci numbers → visible spirals
function drawPointCloud(t) {
  const pts = cloudPts;
  const { fwd } = viewBasis;
  const n = pts.length;
  const ca = Math.cos(t), sa = Math.sin(t);   // self-rotation about Y, 1 turn/loop

  // World positions for this frame (radius displacement + directional splay + Y-rot).
  const bloom = bloomEnv(t);
  const wx = new Float32Array(n), wy = new Float32Array(n), wz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const r = pointRadius(p, t);
    let x0 = p.nx * r, y0 = p.ny * r, z0 = p.nz * r;
    // Directional splay: petal crests flatten toward the equatorial plane as the
    // flower opens, so lobes SPLAY into a rosette instead of merely bulging radially.
    // Pull Y toward 0 and push outward in the XZ ring direction, scaled by crest×bloom.
    const splay = petalShape(p) * bloom;
    if (splay > 0.001 && p.ringR > 1e-3) {
      const ringMag = Math.hypot(x0, z0) || 1;
      const outX = x0 / ringMag, outZ = z0 / ringMag;   // unit XZ (radial-in-plane)
      const push = splay * 150;                          // how far crests fan outward
      x0 += outX * push;  z0 += outZ * push;
      y0 *= (1 - 0.55 * splay);                          // flatten toward face plane
    }
    wx[i] = x0 * ca + z0 * sa;   // rotateY
    wy[i] = y0;
    wz[i] = -x0 * sa + z0 * ca;
  }

  // Pass 1: parastichy spiral threads — faint, reveals the golden-ratio lattice.
  webglLayer.push();
  for (const off of PHI_OFFSETS) {
    for (let i = 0; i + off < n; i++) {
      const j = i + off;
      const mx=(wx[i]+wx[j])*0.5, my=(wy[i]+wy[j])*0.5, mz=(wz[i]+wz[j])*0.5;
      const fog = fogFactor(viewDepth(mx,my,mz));
      if (fog < 0.02) continue;
      webglLayer.stroke(255,255,255, 22*fog); webglLayer.strokeWeight(0.6);
      webglLayer.line(wx[i],wy[i],wz[i], wx[j],wy[j],wz[j]);
    }
  }
  webglLayer.pop();

  // Pass 2: the points themselves — light + fog + DEPTH shaded glowing dots.
  // ADD blending is order-independent, so no depth sort is needed.
  // Depth scales BOTH size and brightness → reads as a luminous 3D volume, not a
  // flat wireframe. A focal pole near the light direction gives the eye a rest point.
  // Near/far clip span used to normalise depth into a 0(far)→1(near) factor.
  const dNear = 700, dFar = 2100;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const x = wx[i], y = wy[i], z = wz[i];
    const d = viewDepth(x,y,z);
    const fog = fogFactor(d);
    if (fog < 0.02) continue;

    // depthK: 1 at the front, 0 at the back. With the persistent face-on camera the
    // depth spread is small, so keep its influence gentle (don't let it dim the image).
    const depthK = constrain((dFar - d) / (dFar - dNear), 0, 1);
    const sizeK  = 0.7 + 0.6 * depthK;     // mild size cue
    const briK   = 0.7 + 0.3 * depthK;     // mostly flat — face-on view has little depth

    // Diffuse from the surface normal (the base direction) + view-facing rim.
    const diff = 0.5 + 0.5 * (p.nx*LIGHT[0] + p.ny*LIGHT[1] + p.nz*LIGHT[2]);
    const dotV = Math.abs(p.nx*fwd[0] + p.ny*fwd[1] + p.nz*fwd[2]);
    const rim  = Math.pow(1 - dotV, 2.0);
    // Raised shade floor so ALL points are clearly visible, not just lit-side ones.
    const focal = Math.pow(Math.max(0, p.nx*LIGHT[0]+p.ny*LIGHT[1]+p.nz*LIGHT[2]), 2.0);
    const shade = 0.70 + 0.30 * diff + 0.20 * focal;
    const tw = 0.88 + 0.12 * Math.sin(t * 2.0 + p.jit);

    const petalGlow = 1 + 1.2 * petalShape(p) * bloom;
    const briBloom = 1 + 1.4 * (bloom - BLOOM_MIN) / (1 - BLOOM_MIN);
    const a = fog * shade * tw * briK * petalGlow * briBloom;
    // Doubled alphas — the object should read bright and immediate.
    webglLayer.stroke(255,255,255, 130*a); webglLayer.strokeWeight(9.0*sizeK); webglLayer.point(x,y,z);
    webglLayer.stroke(255,255,255, 255*a); webglLayer.strokeWeight(3.6*sizeK); webglLayer.point(x,y,z);
    // Rim glow: points on the petal silhouette edge get an extra brightness burst.
    webglLayer.stroke(255,255,255, (255 + 120*rim)*fog*tw*briK*petalGlow*briBloom); webglLayer.strokeWeight(1.8*sizeK); webglLayer.point(x,y,z);
  }
  webglLayer.pop();
}

// ─── Ambient ──────────────────────────────────────────────────────────────────
function drawCloud(t) {
  const buf=cloud.map(p=>({p,x:p.x+Math.sin(t*1.0+p.phase)*4,y:p.y+Math.cos(t*1.0+p.phase)*3,z:p.z,d:0}));
  buf.forEach(b=>b.d=viewDepth(b.x,b.y,b.z));
  buf.sort((a,b)=>b.d-a.d);
  webglLayer.push();
  buf.forEach(({p,x,y,z,d})=>{
    const fog=fogFactor(d);
    webglLayer.stroke(255,255,255,5*fog);  webglLayer.strokeWeight(3.5*p.scale); webglLayer.point(x,y,z);
    webglLayer.stroke(255,255,255,36*fog); webglLayer.strokeWeight(0.7*p.scale); webglLayer.point(x,y,z);
  });
  webglLayer.pop();
}
function drawStars(t) {
  webglLayer.push();
  stars.forEach(p=>{
    const k=0.5+0.5*Math.sin(t*2.0+p.phase*1.7);
    const fog=fogFactor(viewDepth(p.x,p.y,p.z));
    webglLayer.stroke(255,255,255,(16+44*k)*fog); webglLayer.strokeWeight(6*p.scale);  webglLayer.point(p.x,p.y,p.z);
    webglLayer.stroke(255,255,255,(130+170*k)*fog);webglLayer.strokeWeight(1.6*p.scale);webglLayer.point(p.x,p.y,p.z);
  });
  webglLayer.pop();
}
function drawInnerRays(t) {
  webglLayer.push();
  rays.forEach(r=>{
    const wob=0.06*Math.sin(t*1.0+r.phase);
    const len=r.length*(0.85+0.15*Math.sin(t*1.0+r.phase));
    const c=Math.cos(wob),s=Math.sin(wob);
    const dx=r.dx*c-r.dz*s, dz=r.dx*s+r.dz*c;
    const ex=dx*len, ey=r.dy*len, ez=dz*len;
    const fog=fogFactor(viewDepth(ex,ey,ez));
    // Dialed well down so the radial spokes whisper behind the sphere instead of
    // competing with it — the sphere stays the clear subject.
    webglLayer.stroke(255,255,255,1.4*fog); webglLayer.strokeWeight(3.2); webglLayer.line(0,0,0,ex,ey,ez);
    webglLayer.stroke(255,255,255,4*fog);   webglLayer.strokeWeight(0.9); webglLayer.line(0,0,0,ex,ey,ez);
    webglLayer.stroke(255,255,255,9*fog);   webglLayer.strokeWeight(0.3); webglLayer.line(0,0,0,ex,ey,ez);
  });
  webglLayer.pop();
}

function fogFactor(d) {
  return Math.pow(constrain((3200-d)/(3200-1100), 0, 1), 1.4);
}

// ─── Axis guides + horizon ring ───────────────────────────────────────────────
function drawAxisGuides(_t) {
  const r=340, segs=96;
  const ring=(axis)=>{
    webglLayer.beginShape();
    for(let i=0;i<=segs;i++){const a=(i/segs)*TAU,c=Math.cos(a)*r,s=Math.sin(a)*r;
      if(axis===0)webglLayer.vertex(0,c,s);else if(axis===1)webglLayer.vertex(c,0,s);else webglLayer.vertex(c,s,0);}
    webglLayer.endShape();
  };
  webglLayer.push();
  webglLayer.stroke(255,255,255,4);  webglLayer.strokeWeight(0.4); ring(0);ring(1);ring(2);
  webglLayer.stroke(255,255,255,2);  webglLayer.strokeWeight(2.4); ring(0);ring(1);ring(2);
  webglLayer.pop();
}
function drawHorizonRing(_t) {
  const r=720,segs=220;
  webglLayer.push();
  webglLayer.rotateX(Math.PI/2);
  webglLayer.stroke(255,255,255,7); webglLayer.strokeWeight(0.5);
  webglLayer.beginShape();
  for(let i=0;i<=segs;i++){const a=(i/segs)*TAU;webglLayer.vertex(Math.cos(a)*r,Math.sin(a)*r,0);}
  webglLayer.endShape();
  webglLayer.stroke(255,255,255,2); webglLayer.strokeWeight(3.5);
  webglLayer.beginShape();
  for(let i=0;i<=segs;i++){const a=(i/segs)*TAU;webglLayer.vertex(Math.cos(a)*r,Math.sin(a)*r,0);}
  webglLayer.endShape();
  webglLayer.pop();
}

// ─── Bloom ────────────────────────────────────────────────────────────────────
function applyBloom() {
  bloomLayer.clear();
  bloomLayer.push(); bloomLayer.image(webglLayer,0,0,W>>1,H>>1); bloomLayer.pop();
  push(); blendMode(ADD);
  const taps=[
    // Center
    {dx:0,  dy:0,  a:72},
    // Horizontal anamorphic streak — wider and stronger
    {dx:5,  dy:0,  a:52},{dx:-5,  dy:0, a:52},
    {dx:12, dy:0,  a:40},{dx:-12, dy:0, a:40},
    {dx:22, dy:0,  a:30},{dx:-22, dy:0, a:30},
    {dx:36, dy:0,  a:22},{dx:-36, dy:0, a:22},
    {dx:55, dy:0,  a:15},{dx:-55, dy:0, a:15},
    {dx:80, dy:0,  a:10},{dx:-80, dy:0, a:10},
    {dx:115,dy:0,  a: 6},{dx:-115,dy:0, a: 6},
    {dx:160,dy:0,  a: 3},{dx:-160,dy:0, a: 3},
    // Vertical soften
    {dx:0,  dy:3,  a:30},{dx:0, dy:-3,  a:30},
    {dx:0,  dy:7,  a:18},{dx:0, dy:-7,  a:18},
    {dx:0,  dy:14, a:10},{dx:0, dy:-14, a:10},
    {dx:0,  dy:24, a: 5},{dx:0, dy:-24, a: 5},
  ];
  taps.forEach(tap=>{tint(255,tap.a); image(bloomLayer,tap.dx,tap.dy,W,H);});
  noTint(); blendMode(BLEND); pop();
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(loop) {
  push(); noStroke(); textFont('ui-monospace, Menlo, monospace');
  fill(255,255,255,175); textSize(13); textAlign(LEFT,TOP);
  text('FIBONACCI FIELD · GOLDEN DRIFT', 52, 52);
  fill(255,255,255,90); textSize(10);
  text('points=' + N_POINTS + '  φ=137.508°  loop=' + loop.toFixed(3), 52, 76);
  fill(255,255,255,60); textSize(10);
  textAlign(LEFT,BOTTOM); text(W+'×'+H+' · '+FPS+'fps', 52, H-52);
  textAlign(RIGHT,BOTTOM); text('20260529 · POINT CLOUD · B&W', W-52, H-52);
  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push(); noFill(); stroke(255,255,255,50); strokeWeight(0.8);
  const m=32,L=26;
  line(m,m,m+L,m); line(m,m,m,m+L);
  line(W-m,m,W-m-L,m); line(W-m,m,W-m,m+L);
  line(m,H-m,m+L,H-m); line(m,H-m,m,H-m-L);
  line(W-m,H-m,W-m-L,H-m); line(W-m,H-m,W-m,H-m-L);
  pop();
}

// ─── Film grain ───────────────────────────────────────────────────────────────
function renderGrain() {
  grainLayer.clear(); grainLayer.noStroke();
  const count=floor(W*H*0.0013);
  for(let i=0;i<count;i++){
    const v=random(110,210);
    grainLayer.fill(v,v,v,random(2,6));
    grainLayer.circle(random(W),random(H),random(0.25,0.9));
  }
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push(); noFill();
  const steps=70, maxR=dist(W/2,H/2,0,0)*1.10;
  strokeWeight((maxR/steps)*2+2);
  for(let i=0;i<steps;i++){
    const k=i/(steps-1);
    const a=map(k,0.78,1.0,0,90,true);
    if(a<=0)continue;
    stroke(0,0,0,a); circle(W/2,H/2,lerp(0,maxR,k)*2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(floor(random(100000))); }
function keyReleased() {
  if(key==='r'||key==='R'){isRecording?stopRecording():startRecording();return false;}
  if(key==='s'||key==='S'){saveCanvas('fibfield_'+ts(),'png');return false;}
  if(keyCode===DELETE||keyCode===BACKSPACE){reseed(floor(random(100000)));return false;}
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if(typeof VideoEncoder==='undefined'){alert('WebCodecs not supported.');return;}
  if(typeof Mp4Muxer==='undefined'){alert('mp4-muxer not loaded.');return;}
  muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),video:{codec:'avc',width:W,height:H},fastStart:'in-memory',firstTimestampBehavior:'offset'});
  encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:(e)=>{console.error(e);isRecording=false;setStatus('Error','#f44');}});
  encoder.configure({codec:'avc1.640028',width:W,height:H,bitrate:18_000_000,framerate:FPS});
  recFrameCount=0; isRecording=true;
  const el=id=>document.getElementById(id);
  if(el('startBtn'))el('startBtn').disabled=true;
  if(el('stopBtn')) el('stopBtn').disabled=false;
  setStatus('Recording…','#fff');
}
async function stopRecording() {
  if(!encoder||!muxer)return;
  isRecording=false; setStatus('Finalizing…','#ccc');
  await encoder.flush(); muxer.finalize();
  const blob=new Blob([muxer.target.buffer],{type:'video/mp4'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='fibfield_'+ts()+'.mp4'; a.click();
  encoder.close(); encoder=null; muxer=null;
  setTimeout(()=>URL.revokeObjectURL(url),6000);
  const el=id=>document.getElementById(id);
  if(el('startBtn'))el('startBtn').disabled=false;
  if(el('stopBtn')) el('stopBtn').disabled=true;
  setStatus('Complete','#fff');
  setTimeout(()=>setStatus('Ready','#ccc'),3000);
}
function captureFrame() {
  if(!encoder||!canvasEl)return;
  const frame=new VideoFrame(canvasEl,{timestamp:recFrameCount*(1_000_000/FPS)});
  encoder.encode(frame,{keyFrame:recFrameCount%FPS===0});
  frame.close();
}
function setStatus(txt,c){const el=document.getElementById('status');if(el){el.textContent=txt;el.style.color=c;}}
function ts(){const d=new Date();return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;}

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

// ─── Layers ───────────────────────────────────────────────────────────────────
let webglLayer = null;
let bloomLayer = null;
let grainLayer = null;
let canvasEl   = null;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// Last proboscis tip world position — shared between drawProboscis and drawEyes
let probTip = { x: 0, y: 0, z: 0 };

// ─── Opabinia parameters ──────────────────────────────────────────────────────
const SPINE_SEGS = 120;
const RIB_SEGS   = 24;

let creature  = null;
let seedPhase = 0;

// Time-varying light direction
let LIGHT = [0.55, -0.7, 0.45];
function updateLight(t) {
  const baseY = -0.55;
  const r = Math.sqrt(1 - baseY * baseY);
  const a = t * 0.38 + seedPhase * 0.3;
  LIGHT = [r * Math.cos(a), baseY, r * Math.sin(a)];
}

// ─── Wake bubbles ─────────────────────────────────────────────────────────────
const N_WAKE = 180;
let wake = [];
function initWake() {
  wake = new Array(N_WAKE);
  for (let i = 0; i < N_WAKE; i++)
    wake[i] = { x:0, y:0, z:0, vx:0, vy:0, vz:0, life:0, maxLife:1 };
}

// ─── Ambient cloud / stars / rays ────────────────────────────────────────────
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

  initWake();
  reseed(floor(random(100000)));

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(s) {
  randomSeed(s); noiseSeed(s);
  seedPhase = random(TAU);
  creature  = buildCreature();
  buildCloud(); buildStars(); buildRays();
}

// ─── Opabinia anatomy ─────────────────────────────────────────────────────────
// Body is horizontal along X (head at u=0 left, tail at u=1 right).
// Dorso-ventrally flattened: wide laterally (Z), thin vertically (Y).
function buildCreature() {
  const bodyLen = 760;
  const bodyW   = 165;   // lateral half-width
  const bodyH   =  62;   // dorsoventral half-height
  const half    = bodyLen * 0.5;
  const spine   = new Array(SPINE_SEGS);

  for (let i = 0; i < SPINE_SEGS; i++) {
    const u  = i / (SPINE_SEGS - 1);
    const x  = lerp(-half, half, u);
    const y  = -55 * Math.sin(u * Math.PI) * 0.30;   // gentle dorsal arch
    const z  = 0;

    const u2 = Math.min(1, u + 1 / SPINE_SEGS);
    const x2 = lerp(-half, half, u2);
    const y2 = -55 * Math.sin(u2 * Math.PI) * 0.30;
    let tx = x2-x, ty = y2-y, tz = z-z;
    const tm = Math.hypot(tx,ty,tz)||1; tx/=tm; ty/=tm; tz/=tm;

    // Normal = world-up projected perpendicular to tangent (dorsal)
    let nx=0, ny=1, nz=0;
    const dot = nx*tx+ny*ty+nz*tz;
    nx-=dot*tx; ny-=dot*ty; nz-=dot*tz;
    const nm=Math.hypot(nx,ny,nz)||1; nx/=nm; ny/=nm; nz/=nm;

    // Binormal = tangent × normal (lateral)
    const bx=ty*nz-tz*ny, by=tz*nx-tx*nz, bz=tx*ny-ty*nx;

    const wf  = opaProfile(u);
    spine[i] = { u, x, y, z, tx,ty,tz, nx,ny,nz, bx,by,bz,
                 halfW: bodyW*wf, halfH: bodyH*wf };
  }

  return {
    spine,
    bodyLen, bodyW, bodyH,
    // Anatomy parameters
    nLobes:    14,    // lateral lobe-paddles per side
    lobeLen:   185,   // lobe max extension
    lobePhase:  3.8,
    probLen:   310,   // proboscis length
    eyeStalk:   88,   // stalk length per eye
    tailFanR:  240,
    tailFins:    5,
    mouthR:     56,
    mouthRings:  3,
  };
}

// Opabinia body profile: widest ~25% from head, tapers both ways
function opaProfile(u) {
  const head = 1 - Math.pow(1 - smoothstep(0, 0.15, u), 2.2);
  const tail = Math.pow(1 - smoothstep(0.28, 1.0, u), 1.5);
  return 0.52 * head * (0.52 + 0.48 * tail);
}

function smoothstep(a, b, x) {
  const t = constrain((x-a)/(b-a), 0, 1);
  return t*t*(3-2*t);
}

function ellipseRadii(theta, halfW, halfH) {
  return { rN: halfH*Math.cos(theta), rB: halfW*Math.sin(theta) };
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
  // ── Orbit: slow yaw around Y, eased so camera lingers on the lateral profile
  //    (the "beauty shot") and accelerates briefly through front/rear views.
  //    Uses a two-part smoothstep to create a non-uniform, organic speed curve.
  const orbitPhase = (t / TAU) % 1.0;   // 0–1 per loop
  // Map uniform 0–1 phase to eased 0–1 so lateral view occupies ~60% of the loop
  const easedOrbit = orbitPhase < 0.5
    ? smoothstep(0, 0.5, orbitPhase) * 0.45          // slow through lateral view
    : 0.45 + smoothstep(0.5, 1.0, orbitPhase) * 0.55; // faster through front/back
  const camA = easedOrbit * TAU + seedPhase;

  // ── Radius: pulled back so the full body fits comfortably in frame
  const radiusBreath = (Math.sin(t * 0.8 - Math.PI/2) + 1) * 0.5;
  const camR = lerp(1300, 1520, radiusBreath);

  // ── Vertical: keep camera at a consistent slight elevation (±25° from horizontal).
  //    - Base offset: sits 15° above the creature's midplane — shows dorsal AND lobes
  //    - Gentle sine sway of ±8° so it never swings to top-down or bottom-up
  //    - The creature is horizontal (along X), radius is in XZ plane, so
  //      camY controls the elevation angle: tan(elev) = camY / camR
  // Elevation: ~22° above horizontal at rest, sways ±5°
  // tan(22°)≈0.40 — shows dorsal plates AND lateral lobes simultaneously
  const elevBase  = camR * 0.40;
  const elevSway  = camR * 0.08 * Math.sin(t * 0.38 + seedPhase * 0.7);
  const camY = elevBase + elevSway;

  // Look-at: creature center, no offset — keeps full body in frame
  const at  = [0, 0, 0];

  const eye = [camR * Math.cos(camA), camY, camR * Math.sin(camA)];
  const fx=at[0]-eye[0], fy=at[1]-eye[1], fz=at[2]-eye[2];
  const fm=Math.hypot(fx,fy,fz);
  const fwd=[fx/fm, fy/fm, fz/fm];
  const up=[0,1,0];
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

  // Slow scene drift — subtle underwater current, doesn't fight camera elevation
  webglLayer.rotateX(Math.sin(t*0.35)*0.04);
  webglLayer.rotateZ(Math.cos(t*0.28)*0.03);
  webglLayer.translate(0, 14*Math.sin(t*0.32), 0);

  drawHorizonRing(t);
  drawAxisGuides(t);
  drawStars(t);
  drawInnerRays(t);
  drawCloud(t);
  updateAndDrawWake(t);

  // Opabinia — gentle swimming drift + lunge recoil
  const _phase0   = (t / TAU) % 1.0;
  const _reachCurve = _phase0 < 0.60 ? smoothstep(0, 0.60, _phase0)
                    : _phase0 < 0.80 ? 1.0
                    : 1.0 - smoothstep(0.80, 1.0, _phase0);
  const _reachEase = _reachCurve * _reachCurve * (3 - 2 * _reachCurve);
  const { bodyShift, bodyPitch } = lungeRecoil(_reachEase);

  webglLayer.push();
  webglLayer.rotateY(t * 0.10);
  webglLayer.rotateX(Math.sin(t * 0.55) * 0.10 + bodyPitch);
  webglLayer.translate(bodyShift, 0, 0);
  drawCreature(creature, t);
  webglLayer.pop();

  webglLayer.pop();
  image(webglLayer, 0, 0);
}

// ─── Lunge recoil ────────────────────────────────────────────────────────────
// Called with reachEase (0→1→0) — the proboscis extension curve.
// Returns { bodyShift, bodyPitch } — how much the body recoils.
//   bodyShift: translate along +X (tail direction) in world units, peak ≈ 20–50
//   bodyPitch: tilt angle in radians (rotateX), peak ≈ 0.03–0.08
//
// TODO: Shape the recoil curve here — 5–10 lines.
// Trade-offs to consider:
//   • Sharp snap vs. anticipatory crouch: positive bodyShift BEFORE the lunge peak
//     gives a "coiling" anticipation (like a cat); zero until peak then snap back is more explosive
//   • Decay: exponential decay (Math.exp(-k*t)) after the peak gives inertial follow-through
//   • Over-shoot: a small negative bodyShift after retraction (spring overshoot) adds weight
function lungeRecoil(reachEase) {
  // Anticipatory crouch: body shifts tail-ward slightly before strike
  const anticipate = Math.pow(reachEase, 0.6) * 28;
  // Over-shoot: small reverse after retraction when reachEase < 0.15
  const overshoot  = reachEase < 0.15 ? (0.15 - reachEase) * -40 : 0;
  const bodyShift  = anticipate + overshoot;
  const bodyPitch  = reachEase * 0.055;
  return { bodyShift, bodyPitch };
}

// ─── Swim kinematics ─────────────────────────────────────────────────────────
// TODO: Write your swim curve here!
// Parameters:
//   u  — normalized spine position [0=head, 1=tail]
//   t  — time in radians (0→TAU over one loop)
// Returns: { sway, bob, roll }
//   sway — lateral displacement (binormal axis), peak ≈ 40–60 at tail
//   bob  — vertical displacement (normal axis), peak ≈ 5–12
//   roll — body roll angle in radians (feeds into rib orientation), peak ≈ 0.1–0.25
//
// Tips to consider:
//   - Amplitude envelope: Math.pow(u, n) → n=1.2 keeps head still, n=2+ locks head
//   - Two harmonics: primary wave + 0.25* half-freq for organic "scoop"
//   - Head counter-yaw: at u<0.12 apply a small opposing sway to stop nose swinging
//   - Roll: peaks where sway is steepest (mid-body), lags the sway phase by ~0.4 rad
function swimKinematics(u, t) {
  // Primary traveling wave — fundamental frequency
  const wave1 = Math.sin(u * TAU * 1.25 - t * 1.5);
  // Second harmonic at half-freq: adds organic "scoop" feel
  const wave2 = Math.sin(u * TAU * 0.65 - t * 0.8) * 0.28;
  // Amplitude envelope: near-zero at head, full at tail
  const env   = Math.pow(u, 1.4);
  // Head counter-yaw: the snout resists lateral whip (like a real fish)
  const headDamp = 1 - Math.exp(-u * 14) * 0.72;

  const sway = 46 * (wave1 + wave2) * env * headDamp;
  const bob  =  9 * Math.cos(u * TAU * 1.25 - t * 1.5) * Math.pow(u, 1.8);
  // Body roll peaks mid-body, lags sway phase by ~0.4 rad
  const roll = 0.18 * Math.sin(u * TAU * 1.25 - t * 1.5 - 0.4) * Math.pow(u * (1 - u) * 4, 0.8);

  return { sway, bob, roll };
}

// ─── Creature render ──────────────────────────────────────────────────────────
function drawCreature(cr, t) {
  const { spine, params } = { spine: cr.spine, params: cr };
  const { fwd } = viewBasis;

  // Animate spine: traveling undulation (more toward tail) + gentle breath
  const breath = 1 + 0.022 * Math.sin(t * 0.6);
  const sp = new Array(spine.length);
  for (let i = 0; i < spine.length; i++) {
    const s = spine[i];
    const { sway, bob, roll } = swimKinematics(s.u, t);
    sp[i] = { ...s,
      px: (s.x + s.bx * sway) * breath,
      py: (s.y + bob) * breath,
      pz: (s.z + s.bz * sway) * breath,
      roll,
    };
  }

  // Pass 1: Spine ribbon
  webglLayer.push();
  for (let i = 0; i < sp.length-1; i++) {
    const a=sp[i], b=sp[i+1];
    const fog = fogFactor((viewDepth(a.px,a.py,a.pz)+viewDepth(b.px,b.py,b.pz))*0.5);
    webglLayer.stroke(255,255,255, 185*fog); webglLayer.strokeWeight(1.6);
    webglLayer.line(a.px,a.py,a.pz, b.px,b.py,b.pz);
    webglLayer.stroke(255,255,255, 35*fog);  webglLayer.strokeWeight(5.5);
    webglLayer.line(a.px,a.py,a.pz, b.px,b.py,b.pz);
  }
  webglLayer.pop();

  // Pass 2: Body cross-section ribs (segmentation)
  webglLayer.push();
  const RIB_STRIDE = 3;
  for (let i = 0; i < sp.length; i += RIB_STRIDE) {
    const s = sp[i];
    if (s.halfW < 1) continue;
    let px=0, py=0, pz=0, valid=false;
    for (let j = 0; j <= RIB_SEGS; j++) {
      const theta = (j / RIB_SEGS) * TAU;
      const { rN, rB } = ellipseRadii(theta, s.halfW, s.halfH);
      const x=s.px+s.nx*rN+s.bx*rB, y=s.py+s.ny*rN+s.by*rB, z=s.pz+s.nz*rN+s.bz*rB;
      if (valid) {
        const fog = fogFactor(viewDepth(x,y,z));
        const onx=s.nx*Math.cos(theta)+s.bx*Math.sin(theta);
        const ony=s.ny*Math.cos(theta)+s.by*Math.sin(theta);
        const onz=s.nz*Math.cos(theta)+s.bz*Math.sin(theta);
        const shade = 0.35 + 0.65*(0.5+0.5*(onx*LIGHT[0]+ony*LIGHT[1]+onz*LIGHT[2]));
        const dotV  = Math.abs(onx*fwd[0]+ony*fwd[1]+onz*fwd[2]);
        const rim   = Math.pow(1-dotV, 2.5);
        webglLayer.stroke(255,255,255, 145*fog*shade); webglLayer.strokeWeight(0.9);
        webglLayer.line(px,py,pz, x,y,z);
        if (rim > 0.35) {
          webglLayer.stroke(255,255,255, 255*fog*rim); webglLayer.strokeWeight(0.8);
          webglLayer.line(px,py,pz, x,y,z);
        }
      }
      px=x; py=y; pz=z; valid=true;
    }
  }
  webglLayer.pop();

  // Pass 3: Longitudinal lines (body surface strips)
  webglLayer.push();
  const LONGS = 10;
  for (let k = 0; k < LONGS; k++) {
    const theta = (k/LONGS)*TAU;
    let px=0, py=0, pz=0, psh=0, valid=false;
    for (let i = 0; i < sp.length; i++) {
      const s=sp[i]; if (s.halfW<1){valid=false;continue;}
      const {rN,rB} = ellipseRadii(theta,s.halfW,s.halfH);
      const x=s.px+s.nx*rN+s.bx*rB, y=s.py+s.ny*rN+s.by*rB, z=s.pz+s.nz*rN+s.bz*rB;
      const onx=s.nx*Math.cos(theta)+s.bx*Math.sin(theta);
      const ony=s.ny*Math.cos(theta)+s.by*Math.sin(theta);
      const onz=s.nz*Math.cos(theta)+s.bz*Math.sin(theta);
      const shade=0.35+0.65*(0.5+0.5*(onx*LIGHT[0]+ony*LIGHT[1]+onz*LIGHT[2]));
      // Caustic shimmer: traveling brightness wave along spine, mimics dappled underwater light
      const caustic = 0.5 + 0.5*Math.sin(s.u*TAU*3.2 - t*2.1 + k*0.9);
      const causticBoost = 1.0 + 0.55*Math.pow(caustic, 2.2);
      if (valid) {
        const fog=fogFactor(viewDepth((x+px)*0.5,(y+py)*0.5,(z+pz)*0.5));
        webglLayer.stroke(255,255,255, 110*fog*(shade+psh)*0.5*causticBoost); webglLayer.strokeWeight(0.65);
        webglLayer.line(px,py,pz, x,y,z);
        if (caustic > 0.82) {
          webglLayer.stroke(255,255,255, 55*fog*causticBoost); webglLayer.strokeWeight(1.4);
          webglLayer.line(px,py,pz, x,y,z);
        }
      }
      px=x; py=y; pz=z; psh=shade; valid=true;
    }
  }
  webglLayer.pop();

  // Pass 4: Dorsal scutes — arc plates along carapace ridge
  drawDorsalScutes(sp, t);

  // Pass 5: Lateral lobe-paddles
  drawLobes(sp, params, t);

  // Pass 6: 5 clustered dorsal eyes
  drawEyes(sp, params, t);

  // Pass 7: Flexible proboscis + 3-pronged claw
  drawProboscis(sp, params, t);

  // Pass 8: Tail fan
  drawTailFan(sp[sp.length-1], params, t);
}

// ─── Dorsal scutes — overlapping arc-plates along the carapace ──────────────
// Each scute is a thin arc drawn on the dorsal surface between two spine points,
// mimicking the segmented shell plates visible in Opabinia fossils.
function drawDorsalScutes(sp, t) {
  const { fwd } = viewBasis;
  const SCUTE_STRIDE = 5;   // one plate per N spine samples
  webglLayer.push();

  for (let i = SCUTE_STRIDE; i < sp.length - 1; i += SCUTE_STRIDE) {
    const s0 = sp[i - SCUTE_STRIDE];
    const s1 = sp[i];
    if (s0.halfW < 2 || s1.halfW < 2) continue;

    // Scute only on dorsal half (theta near 0 = top of ellipse)
    const SEGS = 18;
    const thetaRange = Math.PI * 0.72;   // span ±65° from dorsal apex

    // Draw scute as an arc connecting two spine cross-sections at the dorsal apex
    // Front arc (at s1), back arc (at s0), connected by side edges
    const drawArc = (s, thetaOff) => {
      let px=0,py=0,pz=0,valid=false;
      for (let j=0; j<=SEGS; j++) {
        const theta = -thetaRange*0.5 + (j/SEGS)*thetaRange + thetaOff;
        const {rN,rB} = ellipseRadii(theta, s.halfW*0.62, s.halfH);
        const x=s.px+s.nx*rN+s.bx*rB;
        const y=s.py+s.ny*rN+s.by*rB;
        const z=s.pz+s.nz*rN+s.bz*rB;
        if (valid) {
          const fog=fogFactor(viewDepth(x,y,z));
          const onx=s.nx*Math.cos(theta)+s.bx*Math.sin(theta);
          const ony=s.ny*Math.cos(theta)+s.by*Math.sin(theta);
          const onz=s.nz*Math.cos(theta)+s.bz*Math.sin(theta);
          const shade=0.4+0.6*(0.5+0.5*(onx*LIGHT[0]+ony*LIGHT[1]+onz*LIGHT[2]));
          const dotV=Math.abs(onx*fwd[0]+ony*fwd[1]+onz*fwd[2]);
          const rim=Math.pow(1-dotV,3.0);
          webglLayer.stroke(255,255,255,165*fog*shade); webglLayer.strokeWeight(1.1);
          webglLayer.line(px,py,pz,x,y,z);
          if (rim>0.4) {
            webglLayer.stroke(255,255,255,255*fog*rim); webglLayer.strokeWeight(0.7);
            webglLayer.line(px,py,pz,x,y,z);
          }
          // Soft glow underlay
          webglLayer.stroke(255,255,255,18*fog*shade); webglLayer.strokeWeight(4.0);
          webglLayer.line(px,py,pz,x,y,z);
        }
        px=x;py=y;pz=z;valid=true;
      }
    };

    // Slight lateral tilt oscillation for organic feel
    const tiltOff = Math.sin(t*0.8 + i*0.15) * 0.04;
    drawArc(s0, tiltOff);
    drawArc(s1, -tiltOff);

    // Connect the two arc endpoints with side edges (scute shape closes)
    for (let side of [-1, 1]) {
      const theta = side * thetaRange * 0.5 + tiltOff;
      const {rN:rN0,rB:rB0}=ellipseRadii(theta, s0.halfW*0.62, s0.halfH);
      const {rN:rN1,rB:rB1}=ellipseRadii(theta, s1.halfW*0.62, s1.halfH);
      const x0=s0.px+s0.nx*rN0+s0.bx*rB0, y0=s0.py+s0.ny*rN0+s0.by*rB0, z0=s0.pz+s0.nz*rN0+s0.bz*rB0;
      const x1=s1.px+s1.nx*rN1+s1.bx*rB1, y1=s1.py+s1.ny*rN1+s1.by*rB1, z1=s1.pz+s1.nz*rN1+s1.bz*rB1;
      const fog=fogFactor(viewDepth((x0+x1)*0.5,(y0+y1)*0.5,(z0+z1)*0.5));
      webglLayer.stroke(255,255,255,130*fog); webglLayer.strokeWeight(0.9);
      webglLayer.line(x0,y0,z0,x1,y1,z1);
    }
  }
  webglLayer.pop();
}

// ─── Lateral lobe-paddles ────────────────────────────────────────────────────
// Opabinia's defining feature: large overlapping fan-shaped flaps, one per
// segment on each side, undulating head→tail as a wave.
function drawLobes(sp, params, t) {
  const { fwd } = viewBasis;
  const N = params.nLobes;
  const uStart = 0.12, uEnd = 0.90;

  webglLayer.push();
  for (let side = -1; side <= 1; side += 2) {
    for (let f = 0; f < N; f++) {
      const u = lerp(uStart, uEnd, f/(N-1));
      const idx = Math.min(sp.length-1, Math.floor(u*(sp.length-1)));
      const s = sp[idx];

      const phase = (f/N)*params.lobePhase + (side>0?0:Math.PI);
      const wave  = Math.sin(t*1.55 - phase);
      // Flap pitches around body tangent — forward and aft edge move opposite
      const flapAngle = wave * 0.52;
      const sizeK = Math.sin(((u-uStart)/(uEnd-uStart))*Math.PI);
      const len = params.lobeLen * (0.52 + 0.48*sizeK);
      const halfChord = len * 0.42;

      // Lobe fans laterally outward — base direction is pure binormal (lateral)
      // Wave tilts it slightly dorsal/ventral (around tangent axis), not upward spike
      const sideDir = { x:s.bx*side, y:s.by*side, z:s.bz*side };
      const cs=Math.cos(flapAngle*0.55), sn=Math.sin(flapAngle*0.55);
      // Rotate sideDir around tangent axis by flapAngle — mixes sideDir with normal
      const outX=sideDir.x*cs + s.nx*sn*0.45;
      const outY=sideDir.y*cs + s.ny*sn*0.45;
      const outZ=sideDir.z*cs + s.nz*sn*0.45;

      // Anchor at lateral body surface edge (not top)
      const ax=s.px+sideDir.x*s.halfW*0.88;
      const ay=s.py+sideDir.y*s.halfW*0.88;
      const az=s.pz+sideDir.z*s.halfW*0.88;

      const front={x:ax+s.tx*halfChord, y:ay+s.ty*halfChord, z:az+s.tz*halfChord};
      const back ={x:ax-s.tx*halfChord, y:ay-s.ty*halfChord, z:az-s.tz*halfChord};
      const tipMid={x:ax+outX*len,          y:ay+outY*len,          z:az+outZ*len};
      const tipF  ={x:front.x+outX*len*0.82, y:front.y+outY*len*0.82, z:front.z+outZ*len*0.82};
      const tipB  ={x:back.x +outX*len*0.72, y:back.y +outY*len*0.72, z:back.z +outZ*len*0.72};
      const verts=[front,tipF,tipMid,tipB,back];

      const dotL=outX*LIGHT[0]+outY*LIGHT[1]+outZ*LIGHT[2];
      const shade=0.35+0.65*(0.5+0.5*dotL);
      const dotV=Math.abs(outX*fwd[0]+outY*fwd[1]+outZ*fwd[2]);
      const rim=Math.pow(1-dotV, 2.0);

      // Outline
      for (let v=0;v<verts.length-1;v++) {
        const a=verts[v], b=verts[v+1];
        const fog=fogFactor(viewDepth((a.x+b.x)*0.5,(a.y+b.y)*0.5,(a.z+b.z)*0.5));
        webglLayer.stroke(255,255,255, 210*fog*shade); webglLayer.strokeWeight(1.2);
        webglLayer.line(a.x,a.y,a.z, b.x,b.y,b.z);
        webglLayer.stroke(255,255,255, 28*fog*shade);  webglLayer.strokeWeight(5.0);
        webglLayer.line(a.x,a.y,a.z, b.x,b.y,b.z);
        if (rim>0.28) {
          webglLayer.stroke(255,255,255, 255*fog*rim); webglLayer.strokeWeight(0.9);
          webglLayer.line(a.x,a.y,a.z, b.x,b.y,b.z);
        }
      }
      // Fin rays — 8 ribs for richer fan detail
      for (let r=1; r<8; r++) {
        const k=r/8;
        const aax=lerp(back.x,front.x,k), aay=lerp(back.y,front.y,k), aaz=lerp(back.z,front.z,k);
        const ttx=lerp(tipB.x,tipF.x,k),  tty=lerp(tipB.y,tipF.y,k),  ttz=lerp(tipB.z,tipF.z,k);
        const fog=fogFactor(viewDepth((aax+ttx)*0.5,(aay+tty)*0.5,(aaz+ttz)*0.5));
        webglLayer.stroke(255,255,255, 120*fog*shade); webglLayer.strokeWeight(0.6);
        webglLayer.line(aax,aay,aaz, ttx,tty,ttz);
      }
    }
  }
  webglLayer.pop();
}

// ─── 5 clustered dorsal eyes ──────────────────────────────────────────────────
// All 5 eyes are tightly grouped on the dorsal head (u≈0.05), arranged in a
// compact arc, each on its own stalk. Outer stalks are longer.
function drawEyes(sp, params, t) {
  const headIdx = Math.floor(0.05 * (sp.length-1));
  const s = sp[headIdx];
  if (!s) return;

  const eyeConfig = [
    { lat:  0.0, len: params.eyeStalk * 0.80, phase: 0.0 },
    { lat:  0.9, len: params.eyeStalk * 0.95, phase: 0.8 },
    { lat: -0.9, len: params.eyeStalk * 0.95, phase: 1.6 },
    { lat:  1.85, len: params.eyeStalk * 1.10, phase: 2.4 },
    { lat: -1.85, len: params.eyeStalk * 1.10, phase: 3.2 },
  ];

  // Gaze direction: blend between default dorso-forward and vector toward proboscis tip
  // Collective tracking — all 5 eyes share the same gaze target
  const gazeDx = probTip.x - s.px, gazeDy = probTip.y - s.py, gazeDz = probTip.z - s.pz;
  const gazeDist = Math.hypot(gazeDx, gazeDy, gazeDz) || 1;
  const gazeNorm = { x: gazeDx/gazeDist, y: gazeDy/gazeDist, z: gazeDz/gazeDist };
  // Gaze blends strongly toward proboscis when it's extended
  const phase0 = (t / TAU) % 1.0;
  const gazeBlend = phase0 < 0.60 ? smoothstep(0, 0.45, phase0)
                  : phase0 < 0.80 ? 1.0
                  : 1.0 - smoothstep(0.80, 1.0, phase0);

  webglLayer.push();
  eyeConfig.forEach(({ lat, len, phase }) => {
    const latOff = lat * 13;
    const jitterN = Math.sin(t*2.2 + phase) * 3.2;   // subtler micro-jitter
    const jitterB = Math.cos(t*1.7 + phase) * 2.0;

    // Stalk base on dorsal head surface
    const bx = s.px + s.nx*s.halfH*0.88 + s.bx*latOff;
    const by = s.py + s.ny*s.halfH*0.88 + s.by*latOff;
    const bz = s.pz + s.nz*s.halfH*0.88 + s.bz*latOff;

    // Default: extends dorso-forward; tracked: leans toward proboscis tip
    const defX = s.nx + s.tx*0.45, defY = s.ny + s.ty*0.45, defZ = s.nz + s.tz*0.45;
    const defM = Math.hypot(defX,defY,defZ)||1;
    const lookX = lerp(defX/defM, gazeNorm.x, gazeBlend * 0.65);
    const lookY = lerp(defY/defM, gazeNorm.y, gazeBlend * 0.65);
    const lookZ = lerp(defZ/defM, gazeNorm.z, gazeBlend * 0.65);
    const lookM = Math.hypot(lookX,lookY,lookZ)||1;

    // Stalk tip: follows gaze direction with micro-jitter
    const tipX = bx + (lookX/lookM)*(len+jitterN) + s.bz*jitterB;
    const tipY = by + (lookY/lookM)*(len+jitterN);
    const tipZ = bz + (lookZ/lookM)*(len+jitterN) + s.bz*jitterB;

    const fog = fogFactor(viewDepth(tipX,tipY,tipZ));
    // Stalk shaft
    webglLayer.stroke(255,255,255, 220*fog); webglLayer.strokeWeight(1.1);
    webglLayer.line(bx,by,bz, tipX,tipY,tipZ);
    webglLayer.stroke(255,255,255, 28*fog);  webglLayer.strokeWeight(3.5);
    webglLayer.line(bx,by,bz, tipX,tipY,tipZ);

    // Eye globe ring
    const eyeR = len * 0.20;
    let px=0,py=0,pz=0,valid=false;
    for (let j=0; j<=18; j++) {
      const a=(j/18)*TAU;
      const ex=tipX+s.tx*eyeR*Math.cos(a)+s.bx*eyeR*Math.sin(a);
      const ey=tipY+s.ty*eyeR*Math.cos(a)+s.by*eyeR*Math.sin(a);
      const ez=tipZ+s.tz*eyeR*Math.cos(a)+s.bz*eyeR*Math.sin(a);
      if (valid) {
        webglLayer.stroke(255,255,255, 255*fog); webglLayer.strokeWeight(0.85);
        webglLayer.line(px,py,pz, ex,ey,ez);
      }
      px=ex; py=ey; pz=ez; valid=true;
    }
    // Bright pupil
    webglLayer.stroke(255,255,255, 255*fog); webglLayer.strokeWeight(3.0);
    webglLayer.point(tipX,tipY,tipZ);
    webglLayer.stroke(255,255,255, 130*fog); webglLayer.strokeWeight(10*1.0);
    webglLayer.point(tipX,tipY,tipZ);
  });
  webglLayer.pop();
}

// ─── Proboscis + 3-pronged claw ───────────────────────────────────────────────
// Long flexible trunk from the ventral-anterior head, sweeping in a figure-8,
// ending in a 3-tined grasping claw.
function drawProboscis(sp, params, t) {
  const headIdx = Math.floor(0.02*(sp.length-1));
  const s = sp[headIdx];
  if (!s) return;

  const len    = params.probLen;
  // Intentional reach cycle: slow extend → hold → snap back
  // Phase 0→0.6 of TAU: reach out; 0.6→0.8: hold; 0.8→1.0: retract
  const phase  = (t / TAU) % 1.0;   // 0–1 over one loop
  const reachCurve = phase < 0.60 ? smoothstep(0, 0.60, phase)
                   : phase < 0.80 ? 1.0
                   : 1.0 - smoothstep(0.80, 1.0, phase);
  const reachEase  = reachCurve * reachCurve * (3 - 2 * reachCurve);  // extra smooth

  const swingH = reachEase * Math.sin(t * 0.46 + seedPhase * 0.2) * 0.58;
  const swingV = reachEase * Math.sin(t * 0.28 + 1.2) * 0.44 + reachEase * 0.18;
  const curl   = reachEase * Math.sin(t * 0.72 + 0.5) * 0.32;

  // Base: ventral-anterior of head (below and ahead)
  const ox = s.px - s.tx*18 - s.nx*s.halfH*0.80;
  const oy = s.py - s.ty*18 - s.ny*s.halfH*0.80;
  const oz = s.pz - s.tz*18 - s.nz*s.halfH*0.80;

  const N=90;
  const joints=[];
  for (let i=0; i<N; i++) {
    const pt  = i/(N-1);
    const ease = pt*pt*(3-2*pt);   // smoothstep — droop near base, sweep at tip
    // Forward: along -tangent (head direction) — primary extension
    // Lateral swing via binormal, vertical via normal
    const wx = ox - s.tx*len*ease
              + s.bx*Math.sin(swingH)*len*ease*0.80
              + s.nx*(Math.sin(swingV)*len*ease*0.42 + Math.sin(curl)*len*ease*0.22);
    const wy = oy - s.ty*len*ease
              + s.by*Math.sin(swingH)*len*ease*0.80
              + s.ny*(Math.sin(swingV)*len*ease*0.42 + Math.sin(curl)*len*ease*0.22);
    const wz = oz - s.tz*len*ease
              + s.bz*Math.sin(swingH)*len*ease*0.80
              + s.nz*(Math.sin(swingV)*len*ease*0.42 + Math.sin(curl)*len*ease*0.22);
    joints.push({x:wx,y:wy,z:wz,t:pt});
  }

  webglLayer.push();
  // Trunk segments
  for (let i=0; i<joints.length-1; i++) {
    const a=joints[i], b=joints[i+1];
    const fog=fogFactor(viewDepth((a.x+b.x)*0.5,(a.y+b.y)*0.5,(a.z+b.z)*0.5));
    const w=1-a.t*0.5;
    webglLayer.stroke(255,255,255,240*fog); webglLayer.strokeWeight(1.8*w);
    webglLayer.line(a.x,a.y,a.z,b.x,b.y,b.z);
    webglLayer.stroke(255,255,255,50*fog);  webglLayer.strokeWeight(5.5*w);
    webglLayer.line(a.x,a.y,a.z,b.x,b.y,b.z);
  }
  // 3-pronged claw at tip
  const tip=joints[joints.length-1];
  probTip = { x: tip.x, y: tip.y, z: tip.z };
  const fog=fogFactor(viewDepth(tip.x,tip.y,tip.z));
  const clawLen=44;
  [-1,0,1].forEach(tine => {
    // Each tine fans in the normal-binormal plane at the tip
    const clawAng = tine * 0.42;
    const cs=Math.cos(clawAng), sn=Math.sin(clawAng);
    const cdx = -s.tx*cs + s.bx*sn;
    const cdy = -s.ty*cs + s.by*sn;
    const cdz = -s.tz*cs + s.bz*sn;
    const ex=tip.x+cdx*clawLen, ey=tip.y+cdy*clawLen, ez=tip.z+cdz*clawLen;
    webglLayer.stroke(255,255,255,255*fog); webglLayer.strokeWeight(1.1);
    webglLayer.line(tip.x,tip.y,tip.z,ex,ey,ez);
    webglLayer.stroke(255,255,255,48*fog);  webglLayer.strokeWeight(3.2);
    webglLayer.line(tip.x,tip.y,tip.z,ex,ey,ez);
  });
  webglLayer.pop();
}

// ─── Tail fan ─────────────────────────────────────────────────────────────────
function drawTailFan(sTail, params, t) {
  if (!sTail) return;
  const fins=params.tailFins;
  // Fan couples to tail undulation: spread wide when tail swings outward
  const tailSway = swimKinematics(1.0, t).sway;
  const swimPulse = Math.abs(tailSway) / 46;   // 0–1, peaks at max tail excursion
  const fanOpen = 0.70 + 0.30 * swimPulse;

  webglLayer.push();
  for (let f=0; f<fins; f++) {
    const k=f/(fins-1);
    const angle=lerp(-Math.PI*0.46, Math.PI*0.46, k)*fanOpen;
    const wave=0.10*Math.sin(t*1.5 - f*0.45);
    const a=angle+wave;
    const cs=Math.cos(a), sn=Math.sin(a);
    const dirX=sTail.tx+sTail.bx*sn*1.15+sTail.nx*cs*0.05;
    const dirY=sTail.ty+sTail.by*sn*1.15+sTail.ny*cs*0.05;
    const dirZ=sTail.tz+sTail.bz*sn*1.15+sTail.nz*cs*0.05;
    const dm=Math.hypot(dirX,dirY,dirZ)||1;
    const lenK=1-0.32*Math.abs(k-0.5)*2;
    const L=params.tailFanR*lenK;
    const ex=sTail.px+(dirX/dm)*L;
    const ey=sTail.py+(dirY/dm)*L;
    const ez=sTail.pz+(dirZ/dm)*L;
    const fog=fogFactor(viewDepth(ex,ey,ez));
    webglLayer.stroke(255,255,255,215*fog); webglLayer.strokeWeight(1.0);
    webglLayer.line(sTail.px,sTail.py,sTail.pz, ex,ey,ez);
    webglLayer.stroke(255,255,255,35*fog);  webglLayer.strokeWeight(4.0);
    webglLayer.line(sTail.px,sTail.py,sTail.pz, ex,ey,ez);
  }
  webglLayer.pop();
}

// ─── Wake bubbles ─────────────────────────────────────────────────────────────
function updateAndDrawWake(t) {
  const dt=1/60;
  const sp = creature ? creature.spine : null;
  webglLayer.push();
  for (let i=0; i<wake.length; i++) {
    const p=wake[i];
    p.life-=dt;
    if (p.life<=0) {
      // Spawn near a random body segment — bubbles trail the animated spine
      const u=(i*7)%wake.length/wake.length;
      const ro=0.5+0.5*(((i*19)%11)/11);
      if (sp) {
        const segIdx = Math.floor(u*(sp.length-1));
        const s = sp[segIdx];
        const { sway, bob } = swimKinematics(s.u, t);
        const sx = (s.x + s.bx*sway)*1.0, sy = (s.y + bob)*1.0, sz = s.z;
        const jitter = 55;
        p.x = sx + (Math.random()-0.5)*jitter;
        p.y = sy + (Math.random()-0.5)*jitter*0.5;
        p.z = sz + (Math.random()-0.5)*jitter;
      } else {
        const ang=(i*0.6180339)*TAU+t*0.3;
        const r=70+55*((i*13)%7)/7;
        p.x=lerp(-260,260,u); p.y=Math.sin(ang)*r*0.42; p.z=Math.cos(ang)*r;
      }
      // Drift away from body + gentle upward rise
      p.vx=(Math.random()-0.5)*22; p.vy=-8-ro*10; p.vz=(Math.random()-0.5)*22;
      p.maxLife=1.4+1.2*(((i*23)%13)/13); p.life=p.maxLife;
    }
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.z+=p.vz*dt;
    p.vx*=0.986; p.vy*=0.986; p.vz*=0.986;
    const lf=p.life/p.maxLife, fade=lf*(1-lf)*4;
    const fog=fogFactor(viewDepth(p.x,p.y,p.z));
    webglLayer.stroke(255,255,255, 20*fog*fade); webglLayer.strokeWeight(5.0); webglLayer.point(p.x,p.y,p.z);
    webglLayer.stroke(255,255,255, 65*fog*fade); webglLayer.strokeWeight(2.2); webglLayer.point(p.x,p.y,p.z);
    webglLayer.stroke(255,255,255,190*fog*fade); webglLayer.strokeWeight(1.0); webglLayer.point(p.x,p.y,p.z);
  }
  webglLayer.pop();
}

// ─── Ambient ──────────────────────────────────────────────────────────────────
function drawCloud(t) {
  const buf=cloud.map(p=>({p,x:p.x+Math.sin(t*0.5+p.phase)*4,y:p.y+Math.cos(t*0.4+p.phase)*3,z:p.z,d:0}));
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
    const k=0.5+0.5*Math.sin(t*0.6+p.phase*1.7);
    const fog=fogFactor(viewDepth(p.x,p.y,p.z));
    webglLayer.stroke(255,255,255,(16+44*k)*fog); webglLayer.strokeWeight(6*p.scale);  webglLayer.point(p.x,p.y,p.z);
    webglLayer.stroke(255,255,255,(130+170*k)*fog);webglLayer.strokeWeight(1.6*p.scale);webglLayer.point(p.x,p.y,p.z);
  });
  webglLayer.pop();
}
function drawInnerRays(t) {
  webglLayer.push();
  rays.forEach(r=>{
    const wob=0.06*Math.sin(t*0.5+r.phase);
    const len=r.length*(0.85+0.15*Math.sin(t*0.7+r.phase));
    const c=Math.cos(wob),s=Math.sin(wob);
    const dx=r.dx*c-r.dz*s, dz=r.dx*s+r.dz*c;
    const ex=dx*len, ey=r.dy*len, ez=dz*len;
    const fog=fogFactor(viewDepth(ex,ey,ez));
    webglLayer.stroke(255,255,255,3*fog);  webglLayer.strokeWeight(3.2); webglLayer.line(0,0,0,ex,ey,ez);
    webglLayer.stroke(255,255,255,10*fog); webglLayer.strokeWeight(0.9); webglLayer.line(0,0,0,ex,ey,ez);
    webglLayer.stroke(255,255,255,25*fog); webglLayer.strokeWeight(0.3); webglLayer.line(0,0,0,ex,ey,ez);
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
  webglLayer.stroke(255,255,255,8);  webglLayer.strokeWeight(0.4); ring(0);ring(1);ring(2);
  webglLayer.stroke(255,255,255,3);  webglLayer.strokeWeight(2.4); ring(0);ring(1);ring(2);
  webglLayer.pop();
}
function drawHorizonRing(_t) {
  const r=720,segs=220;
  webglLayer.push();
  webglLayer.rotateX(Math.PI/2);
  webglLayer.stroke(255,255,255,16); webglLayer.strokeWeight(0.5);
  webglLayer.beginShape();
  for(let i=0;i<=segs;i++){const a=(i/segs)*TAU;webglLayer.vertex(Math.cos(a)*r,Math.sin(a)*r,0);}
  webglLayer.endShape();
  webglLayer.stroke(255,255,255,4); webglLayer.strokeWeight(3.5);
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
  text('OPABINIA · CAMBRIAN DRIFT', 52, 52);
  fill(255,255,255,90); textSize(10);
  text('spine=' + SPINE_SEGS + '  ribs=' + RIB_SEGS + '  loop=' + loop.toFixed(3), 52, 76);
  fill(255,255,255,60); textSize(10);
  textAlign(LEFT,BOTTOM); text(W+'×'+H+' · '+FPS+'fps', 52, H-52);
  textAlign(RIGHT,BOTTOM); text('20260520 · OPABINIA · B&W', W-52, H-52);
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
  if(key==='s'||key==='S'){saveCanvas('opabinia_'+ts(),'png');return false;}
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
  a.href=url; a.download='opabinia_'+ts()+'.mp4'; a.click();
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

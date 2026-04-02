"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette — Black & White ───────────────────── */
const BG = [0, 0, 0];

/* ───────────────────── Config ───────────────────── */
const UNIT_R        = 130;
const NUM_DUST      = 350;
const NUM_SNOW      = 120;
const NUM_ORBIT_PTS = 8;

/* ───────────────────── State ───────────────────── */
let muxer = null, encoder = null, isRecording = false, recordingFrameCount = 0;
let canvasEl = null, latestRecordingUrl = "";
let latestRecordingFilename = "euler_identity_20260331.mp4";
let fc = 0, captureCanvas = null, captureCtx = null;

let dustParticles = [];
let snowParticles = [];
let orbitPoints   = [];
let vignetteGfx   = null;

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
  document.getElementById("stopBtn").disabled  = false;
  updateDownloadButton(false); setStatus("Recording..."); updateRecordingUI();
}
async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false; setStatus("Finalizing...");
  await encoder.flush(); muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url  = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  setDownloadLink(url, latestRecordingFilename); updateDownloadButton(true);
  triggerDownload(url, latestRecordingFilename);
  encoder.close(); encoder = null; muxer = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled  = true; setStatus("MP4 ready.");
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

/* ───────────────────── Utilities ───────────────────── */
function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* multi-layer glow sphere — 5 shells for luminous bloom */
function glowSphere(x, y, z, baseR, brightness) {
  push();
  translate(x, y, z);
  noStroke();
  const b = brightness;
  // Outermost haze — wide and visible
  const v0 = 255 * 0.12 * b;
  emissiveMaterial(v0, v0, v0);
  sphere(baseR * 6.0, 5, 5);
  // Outer glow
  const v1 = 255 * 0.28 * b;
  emissiveMaterial(v1, v1, v1);
  sphere(baseR * 3.5, 6, 6);
  // Mid shell
  const v2 = 255 * 0.60 * b;
  emissiveMaterial(v2, v2, v2);
  sphere(baseR * 1.8, 6, 6);
  // Inner bright
  const v3 = 255 * 0.85 * b;
  emissiveMaterial(v3, v3, v3);
  sphere(baseR * 0.9, 8, 8);
  // Hot core — near-white
  const v4 = 255 * Math.min(1.0, b * 1.2);
  emissiveMaterial(v4, v4, v4);
  sphere(baseR * 0.35, 8, 8);
  pop();
}

/* ─────── stroke helper: 4-layer glow line drawing ─────── */
function glowStroke(alpha, weight) {
  return [
    { a: alpha * 0.15, w: weight * 8.0 },   // wide haze
    { a: alpha * 0.35, w: weight * 5.0 },   // outer glow
    { a: alpha * 0.65, w: weight * 2.5 },   // soft glow
    { a: alpha,        w: weight },          // sharp core
  ];
}

/* ───────────────────── Build Particles ───────────────────── */
function buildDust() {
  const rng = makeRng(20260331);
  dustParticles = [];
  for (let i = 0; i < NUM_DUST; i++) {
    const theta = rng() * TWO_PI;
    const phi   = Math.acos(2 * rng() - 1);
    const r     = 60 + rng() * 550;
    dustParticles.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: -600 + rng() * 1200,
      z: r * Math.sin(phi) * Math.sin(theta),
      size: 0.15 + rng() * 0.6,
      speed: 0.04 + rng() * 0.18,
      phase: rng() * TWO_PI,
      brightness: 0.55 + rng() * 0.45,
    });
  }
}

function buildSnow() {
  const rng = makeRng(33310331);
  snowParticles = [];
  for (let i = 0; i < NUM_SNOW; i++) {
    snowParticles.push({
      x: (rng() - 0.5) * 900,
      y: -600 + rng() * 1200,
      z: (rng() - 0.5) * 900,
      fallSpeed: 5 + rng() * 14,
      drift: (rng() - 0.5) * 0.6,
      size: 0.4 + rng() * 1.2,
      phase: rng() * TWO_PI,
      brightness: 0.5 + rng() * 0.5,
    });
  }
}

function buildOrbitPoints() {
  orbitPoints = [];
  for (let i = 0; i < NUM_ORBIT_PTS; i++) {
    const phase    = (i / NUM_ORBIT_PTS) * TWO_PI;
    const speed    = 0.2 + (i % 4) * 0.1;
    const harmonic = 1 + (i % 5);
    orbitPoints.push({ phase, speed, harmonic, size: 2.5 + (i % 3) * 1.2 });
  }
}

/* ───────────────────── Build Vignette Overlay ───────────────────── */
function buildVignette() {
  vignetteGfx = createGraphics(W, H);
  vignetteGfx.noStroke();
  const cx = W / 2, cy = H / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  const steps = 100;
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const r = t * maxR;
    // Gentle falloff — subtle dark edges, mostly transparent
    const fade = Math.pow(1 - t, 0.4);
    const a = fade * 80;
    vignetteGfx.fill(0, 0, 0, a);
    vignetteGfx.ellipse(cx, cy, r * 2, r * 2);
  }
}

/* ───────────────────── Draw: Dust ───────────────────── */
function drawDust(t) {
  noStroke();
  for (const d of dustParticles) {
    const flicker   = 0.3 + 0.7 * Math.sin(t * d.speed * 2 + d.phase);
    const intensity = d.brightness * flicker;
    if (intensity < 0.06) continue;
    const dx = d.x + Math.sin(t * d.speed + d.phase) * 12;
    const dy = d.y + Math.cos(t * d.speed * 0.7 + d.phase * 1.3) * 10;
    const dz = d.z + Math.sin(t * d.speed * 0.5 + d.phase * 0.7) * 12;
    push();
    translate(dx, dy, dz);
    const v = 255 * 0.85 * intensity;
    emissiveMaterial(v, v, v);
    sphere(d.size, 4, 4);
    pop();
  }
}

/* ───────────────────── Draw: Falling Snow ───────────────────── */
function drawSnow(t) {
  noStroke();
  for (const s of snowParticles) {
    const y = ((s.y + t * s.fallSpeed) % 1200) - 600;
    const x = s.x + Math.sin(t * 0.3 + s.phase) * 20 * s.drift;
    const z = s.z + Math.cos(t * 0.25 + s.phase * 1.4) * 15 * s.drift;
    const twinkle = 0.4 + 0.6 * Math.sin(t * 1.5 + s.phase);
    const v = 255 * s.brightness * twinkle;
    push();
    translate(x, y, z);
    emissiveMaterial(v, v, v);
    sphere(s.size, 4, 4);
    pop();
  }
}

/* ───────────────────── Draw: Complex Plane Grid ───────────────────── */
function drawComplexGrid(t) {
  push();
  noFill();
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.25);

  // Radial lines
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * TWO_PI + t * 0.005;
    const alpha = (i % 3 === 0 ? 40 : 20) + 12 * pulse;
    for (const g of glowStroke(alpha, 0.2)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      line(0, 0, 0, Math.cos(angle) * 400, 0, Math.sin(angle) * 400);
    }
  }

  // Concentric circles
  for (let r = 1; r <= 4; r++) {
    const radius = r * 90;
    const isUnit = (r === 1);
    const alpha  = isUnit ? 80 + 30 * pulse : 25 + 12 * pulse;
    const w      = isUnit ? 0.6 : 0.2;
    for (const g of glowStroke(alpha, w)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      beginShape();
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * TWO_PI;
        vertex(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      }
      endShape();
    }
  }

  // Real & Imaginary axes — stronger
  for (const g of glowStroke(70 + 30 * pulse, 0.6)) {
    stroke(255, 255, 255, g.a);
    strokeWeight(g.w);
    line(-400, 0, 0, 400, 0, 0);
    line(0, 0, -400, 0, 0, 400);
  }

  pop();
}

/* ───────────────────── Draw: Unit Circle + e^(iθ) ───────────────────── */
function drawUnitCircle(t) {
  push();
  noFill();
  const p = 0.5 + 0.5 * Math.sin(t * 0.45);

  // Unit circle — luminous bloom
  for (const g of glowStroke(130 + 50 * p, 1.0)) {
    stroke(255, 255, 255, g.a);
    strokeWeight(g.w);
    beginShape();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * TWO_PI;
      vertex(Math.cos(a) * UNIT_R, 0, Math.sin(a) * UNIT_R);
    }
    endShape();
  }

  // Animated point e^(iθ)
  const theta = t * 0.35;
  const px = Math.cos(theta) * UNIT_R;
  const pz = Math.sin(theta) * UNIT_R;
  glowSphere(px, 0, pz, 8, 1.5);

  // Projection lines — cos & sin
  for (const g of glowStroke(80 + 35 * p, 0.5)) {
    stroke(255, 255, 255, g.a);
    strokeWeight(g.w);
    line(px, 0, pz, px, 0, 0);
    line(px, 0, pz, 0, 0, pz);
  }

  // Projection dots on axes
  glowSphere(px, 0, 0, 4, 0.8 + 0.3 * p);
  glowSphere(0, 0, pz, 4, 0.8 + 0.3 * p);

  // Radius line
  for (const g of glowStroke(70 + 25 * p, 0.5)) {
    stroke(255, 255, 255, g.a);
    strokeWeight(g.w);
    line(0, 0, 0, px, 0, pz);
  }

  // Arc from 0 → θ
  for (const g of glowStroke(60, 0.5)) {
    stroke(255, 255, 255, g.a);
    strokeWeight(g.w);
    beginShape();
    const arcR   = 28;
    const thetaMod = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
    const arcN   = Math.max(4, Math.floor(thetaMod / TWO_PI * 60));
    for (let i = 0; i <= arcN; i++) {
      const a = (i / arcN) * thetaMod;
      vertex(Math.cos(a) * arcR, 0, Math.sin(a) * arcR);
    }
    endShape();
  }

  // Vertical projection line from point to helix
  for (const g of glowStroke(22, 0.3)) {
    stroke(255, 255, 255, g.a);
    strokeWeight(g.w);
    line(px, 0, pz, px, -350, pz);
    line(px, 0, pz, px, 350, pz);
  }

  pop();
}

/* ───────────────────── Draw: Euler Helices e^(inθ) ───────────────────── */
function drawHelices(t) {
  push();
  noFill();
  const numH = 3;
  const hHeight = 700;

  for (let n = 1; n <= numH; n++) {
    const brightness = 1.0 - (n - 1) * 0.14;
    const radius     = UNIT_R * (1.0 - (n - 1) * 0.06);
    const baseAlpha  = (95 - (n - 1) * 10) * brightness;

    for (const g of glowStroke(baseAlpha, 0.35)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      beginShape();
      const segments = 150;
      for (let i = 0; i <= segments; i++) {
        const f     = i / segments;
        const theta = f * TWO_PI * 4 + t * 0.12 * n;
        const y     = -hHeight * 0.5 + f * hHeight;
        vertex(Math.cos(theta * n) * radius, y, Math.sin(theta * n) * radius);
      }
      endShape();
    }

    // Glowing tip
    const tipTheta = TWO_PI * 4 + t * 0.12 * n;
    glowSphere(
      Math.cos(tipTheta * n) * radius,
      hHeight * 0.5,
      Math.sin(tipTheta * n) * radius,
      2.5, brightness * 0.6
    );
  }

  // Cross-rungs connecting helix n=1 and n=2 (DNA-like)
  const r1 = UNIT_R, r2 = UNIT_R * 0.94;
  for (let i = 0; i < 20; i++) {
    const f     = i / 20;
    const theta = f * TWO_PI * 4 + t * 0.12;
    const y     = -hHeight * 0.5 + f * hHeight;
    const x1    = Math.cos(theta) * r1,    z1 = Math.sin(theta) * r1;
    const x2    = Math.cos(theta * 2) * r2, z2 = Math.sin(theta * 2) * r2;
    const fade  = 0.3 + 0.7 * Math.sin(t * 0.8 + i * 0.5);
    for (const g of glowStroke(20 * fade, 0.3)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      line(x1, y, z1, x2, y, z2);
    }
  }

  pop();
}

/* ───────────────────── Draw: Torus Knot (p,q) ───────────────────── */
function drawTorusKnot(t, p, q, R, r, yOff, alpha) {
  push();
  translate(0, yOff, 0);
  noFill();

  const segments = 200;
  for (const g of glowStroke(alpha * 3.5, 0.55)) {
    stroke(255, 255, 255, g.a);
    strokeWeight(g.w);
    beginShape();
    for (let i = 0; i <= segments; i++) {
      const u  = (i / segments) * TWO_PI;
      const ut = u + t * 0.08;
      const cr = R + r * Math.cos(q * ut);
      const x  = cr * Math.cos(p * ut);
      const z  = cr * Math.sin(p * ut);
      const y  = r * Math.sin(q * ut);
      vertex(x, y, z);
    }
    endShape();
  }
  pop();
}

/* ───────────────────── Draw: Lissajous Figure in 3D ───────────────────── */
function drawLissajous(t) {
  push();
  noFill();

  const configs = [
    { a: 3, b: 2, c: 5, delta: PI / 2, phi: PI / 4, A: 90, B: 60, C: 90, yOff: -200, alpha: 45 },
    { a: 5, b: 4, c: 3, delta: PI / 3, phi: PI / 6, A: 80, B: 50, C: 80, yOff:  200, alpha: 38 },
  ];

  for (const cfg of configs) {
    push();
    translate(0, cfg.yOff, 0);
    rotateY(t * 0.06);

    for (const g of glowStroke(cfg.alpha, 0.3)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      beginShape();
      for (let i = 0; i <= 150; i++) {
        const u = (i / 150) * TWO_PI * 2 + t * 0.1;
        vertex(
          cfg.A * Math.sin(cfg.a * u + cfg.delta),
          cfg.B * Math.sin(cfg.b * u),
          cfg.C * Math.sin(cfg.c * u + cfg.phi),
        );
      }
      endShape();
    }
    pop();
  }

  pop();
}

/* ───────────────────── Draw: Orbit Points + Trails ───────────────────── */
function drawOrbitPoints(t) {
  for (const op of orbitPoints) {
    const theta = t * op.speed + op.phase;
    const n     = op.harmonic;
    const x     = Math.cos(theta * n) * UNIT_R;
    const z     = Math.sin(theta * n) * UNIT_R;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.2 + op.phase);

    glowSphere(x, 0, z, op.size * (0.6 + 0.5 * pulse), 0.6 + 0.5 * pulse);

    // Longer trail with fade
    push();
    noFill();
    const trailLen = 25;
    for (const g of glowStroke(28 + 18 * pulse, 0.35)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      beginShape();
      for (let i = 0; i < trailLen; i++) {
        const tt = theta - i * 0.025;
        vertex(Math.cos(tt * n) * UNIT_R, 0, Math.sin(tt * n) * UNIT_R);
      }
      endShape();
    }
    pop();
  }
}

/* ───────────────────── Draw: Wireframe Platonic Solids ───────────────────── */
function drawTetra(s) {
  const a = s * 0.8;
  const pts = [[0,-a,0],[a,a*0.5,0],[-a*0.5,a*0.5,a*0.866],[-a*0.5,a*0.5,-a*0.866]];
  const edges = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
  for (const [i,j] of edges) line(pts[i][0],pts[i][1],pts[i][2], pts[j][0],pts[j][1],pts[j][2]);
}
function drawOcta(s) {
  const top=[0,-s,0], bot=[0,s,0];
  const m=[[s,0,0],[0,0,s],[-s,0,0],[0,0,-s]];
  for (let i=0;i<4;i++){const p=m[i],np=m[(i+1)%4];
    line(top[0],top[1],top[2],p[0],p[1],p[2]);
    line(bot[0],bot[1],bot[2],p[0],p[1],p[2]);
    line(p[0],p[1],p[2],np[0],np[1],np[2]);}
}
function drawCubeW(s) {
  const h=s*0.5, pts=[];
  for(let x=-1;x<=1;x+=2)for(let y=-1;y<=1;y+=2)for(let z=-1;z<=1;z+=2)pts.push([x*h,y*h,z*h]);
  for(let i=0;i<8;i++)for(let j=i+1;j<8;j++){let d=0;for(let k=0;k<3;k++)if(pts[i][k]!==pts[j][k])d++;
    if(d===1)line(pts[i][0],pts[i][1],pts[i][2],pts[j][0],pts[j][1],pts[j][2]);}
}
function drawIcosa(s) {
  const phi=(1+Math.sqrt(5))/2,a=s*0.5,b=a*phi;
  const V=[[-a,b,0],[a,b,0],[-a,-b,0],[a,-b,0],[0,-a,b],[0,a,b],[0,-a,-b],[0,a,-b],[b,0,-a],[b,0,a],[-b,0,-a],[-b,0,a]];
  const F=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];
  const S=new Set();for(const f of F)for(let i=0;i<3;i++){const a2=f[i],b2=f[(i+1)%3],k=Math.min(a2,b2)+","+Math.max(a2,b2);if(!S.has(k)){S.add(k);line(V[a2][0],V[a2][1],V[a2][2],V[b2][0],V[b2][1],V[b2][2]);}}
}
function drawDodeca(s) {
  const phi=(1+Math.sqrt(5))/2,a=s*0.35,b=a*phi,c=a/phi;
  const V=[[a,a,a],[a,a,-a],[a,-a,a],[a,-a,-a],[-a,a,a],[-a,a,-a],[-a,-a,a],[-a,-a,-a],[0,c,b],[0,c,-b],[0,-c,b],[0,-c,-b],[c,b,0],[c,-b,0],[-c,b,0],[-c,-b,0],[b,0,c],[b,0,-c],[-b,0,c],[-b,0,-c]];
  const E=[[0,8],[0,12],[0,16],[1,9],[1,12],[1,17],[2,10],[2,13],[2,16],[3,11],[3,13],[3,17],[4,8],[4,14],[4,18],[5,9],[5,14],[5,19],[6,10],[6,15],[6,18],[7,11],[7,15],[7,19]];
  const S=new Set();for(const[i,j]of E){const k=Math.min(i,j)+","+Math.max(i,j);if(!S.has(k)){S.add(k);line(V[i][0],V[i][1],V[i][2],V[j][0],V[j][1],V[j][2]);}}
}

function drawPolyhedra(t) {
  const configs = [
    { type: "tetra",  orbitR: 280, speed: 0.055, yOff: -90,  size: 24, spin: 0.40, phase: 0 },
    { type: "octa",   orbitR: 320, speed: 0.075, yOff:  50,  size: 20, spin: 0.55, phase: TWO_PI * 0.2 },
    { type: "cube",   orbitR: 360, speed: 0.045, yOff: -160, size: 28, spin: 0.35, phase: TWO_PI * 0.4 },
    { type: "icosa",  orbitR: 240, speed: 0.095, yOff:  130, size: 17, spin: 0.65, phase: TWO_PI * 0.6 },
    { type: "dodeca", orbitR: 400, speed: 0.035, yOff:   0,  size: 22, spin: 0.48, phase: TWO_PI * 0.8 },
  ];

  for (const c of configs) {
    const angle = t * c.speed + c.phase;
    const x = Math.cos(angle) * c.orbitR;
    const z = Math.sin(angle) * c.orbitR;
    const y = c.yOff + Math.sin(angle * 2 + c.phase) * 45;
    const pulse = 0.5 + 0.5 * Math.sin(t * 1.0 + c.phase);

    push();
    translate(x, y, z);
    rotateX(t * c.spin);
    rotateY(t * c.spin * 0.618);
    rotateZ(t * c.spin * 0.382);
    noFill();

    for (const g of glowStroke(90 + 55 * pulse, 0.6)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      switch (c.type) {
        case "tetra":  drawTetra(c.size);  break;
        case "octa":   drawOcta(c.size);   break;
        case "cube":   drawCubeW(c.size);  break;
        case "icosa":  drawIcosa(c.size);  break;
        case "dodeca": drawDodeca(c.size); break;
      }
    }

    noStroke();
    const v = 255 * 0.15 * pulse;
    emissiveMaterial(v, v, v);
    sphere(c.size * 0.35, 6, 6);
    pop();
  }
}

/* ───────────────────── Draw: Spiral Filaments ───────────────────── */
function drawFilaments(t) {
  push();
  noFill();

  for (let i = 0; i < 6; i++) {
    const baseAngle = (i / 6) * TWO_PI;
    const speed = 0.12 + (i % 4) * 0.04;
    const tOff  = t * speed + i * 1.5;
    const reveal  = smoothstep(0, 3.5, tOff % 6);
    const fadeOut  = 1 - smoothstep(4.5, 6, tOff % 6);
    const maxSeg  = Math.floor(reveal * 60);

    for (const g of glowStroke(65 * fadeOut, 0.45)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      beginShape();
      for (let s = 0; s <= maxSeg; s++) {
        const f = s / 60;
        const r = f * 320;
        const angle = baseAngle + f * PI * 2.5 + t * 0.025;
        const y = (f - 0.5) * 350 + Math.sin(f * PI * 3 + tOff) * 35;
        vertex(Math.cos(angle) * r, y, Math.sin(angle) * r);
      }
      endShape();
    }

    if (maxSeg > 3 && fadeOut > 0.25) {
      const f = maxSeg / 60;
      const r = f * 320;
      const angle = baseAngle + f * PI * 2.5 + t * 0.025;
      const y = (f - 0.5) * 350 + Math.sin(f * PI * 3 + tOff) * 35;
      glowSphere(Math.cos(angle) * r, y, Math.sin(angle) * r, 3, fadeOut * 0.8);
    }
  }

  pop();
}

/* ───────────────────── Draw: Radial Waves ───────────────────── */
function drawRadialWaves(t) {
  push();
  noFill();

  for (let w = 0; w < 5; w++) {
    const phase = (t * 0.04 + w * 0.2) % 1.0;
    const r     = phase * 450;
    const alpha = (1 - phase) * 55;
    if (alpha < 0.8) continue;

    for (const g of glowStroke(alpha, 0.25)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      beginShape();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * TWO_PI;
        const wobble = Math.sin(a * 6 + t * 0.35 + w) * 5 * phase;
        vertex(Math.cos(a) * (r + wobble), 0, Math.sin(a) * (r + wobble));
      }
      endShape();
    }
  }

  pop();
}

/* ───────────────────── Draw: Vertical Light Beams ───────────────────── */
function drawBeams(t) {
  push();
  noFill();

  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * TWO_PI + t * 0.008;
    const r     = UNIT_R * 1.25;
    const x     = Math.cos(angle) * r;
    const z     = Math.sin(angle) * r;
    const pulse = 0.2 + 0.8 * Math.sin(t * 0.4 + i * 0.52);

    for (const g of glowStroke(25 + 30 * pulse, 0.35)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      line(x, -500, z, x, 500, z);
    }
  }

  pop();
}

/* ───────────────────── Draw: Central Core ───────────────────── */
function drawCore(t) {
  push();
  const p1 = 0.5 + 0.5 * Math.sin(t * 1.1);
  const p2 = 0.5 + 0.5 * Math.sin(t * 1.7);
  const p3 = 0.5 + 0.5 * Math.sin(t * 0.55);

  noStroke();

  // 7-layer radial bloom — bright luminous core
  const coreLayers = [
    [140 + 40 * p3, 0.03],
    [110 + 30 * p3, 0.07],
    [85 + 25 * p3,  0.14],
    [55 + 15 * p1,  0.25],
    [35 + 10 * p2,  0.50],
    [18 + 5 * p1,   0.80],
    [6,              1.0],
  ];
  for (const [r, mul] of coreLayers) {
    const v = 255 * mul;
    emissiveMaterial(v, v, v);
    sphere(r, 8, 8);
  }

  // 3 interlocked orbital rings
  noFill();
  for (let r = 0; r < 3; r++) {
    const speed = 0.35 + r * 0.18;
    const a     = t * speed + r * (TWO_PI / 3);
    const ringR = 28 + r * 13 + 5 * Math.sin(t * 0.3 + r * 1.5);

    for (const g of glowStroke(80 + 45 * p1, 0.6)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      push();
      rotateX(a);
      rotateY(a * 0.618);
      rotateZ(a * 0.382);
      beginShape();
      for (let i = 0; i <= 40; i++) {
        const ang = (i / 40) * TWO_PI;
        vertex(Math.cos(ang) * ringR, 0, Math.sin(ang) * ringR);
      }
      endShape();
      pop();
    }
  }

  pop();
}

/* ───────────────────── Draw: Euler Spiral (Cornu) ───────────────────── */
function drawEulerSpiral(t) {
  push();
  noFill();
  translate(0, -40, 0);

  const scale = 85;
  const steps = 150;
  const maxT  = 4.0;

  for (let mirror = 0; mirror < 2; mirror++) {
    const phaseOff = mirror * PI;
    for (const g of glowStroke(70, 0.55)) {
      stroke(255, 255, 255, g.a);
      strokeWeight(g.w);
      beginShape();
      let cx = 0, cz = 0;
      for (let i = 0; i <= steps; i++) {
        const s  = (i / steps) * maxT;
        const dt = maxT / steps;
        cx += Math.cos(PI * s * s * 0.5 + t * 0.08 + phaseOff) * dt;
        cz += Math.sin(PI * s * s * 0.5 + t * 0.08 + phaseOff) * dt;
        vertex(cx * scale, -i * 0.65 + 160, cz * scale);
      }
      endShape();
    }
  }

  pop();
}

/* ───────────────────── p5 Setup ───────────────────── */
function setup() {
  pixelDensity(1);
  setAttributes("preserveDrawingBuffer", true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl  = cnv.elt;
  frameRate(FPS);

  captureCanvas        = document.createElement("canvas");
  captureCanvas.width  = W;
  captureCanvas.height = H;
  captureCtx           = captureCanvas.getContext("2d");

  buildDust();
  buildSnow();
  buildOrbitPoints();
  buildVignette();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS;
  background(0);

  // Camera — slow cinematic orbit with gentle vertical sway
  const camAngle = t * 0.03;
  const camR     = 580 + 110 * Math.sin(t * 0.015);
  const camY     = -80 - 200 * Math.sin(t * 0.025);
  const lookY    = 30 * Math.sin(t * 0.018);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, lookY, 0,
    0, 1, 0
  );

  // Monochrome lighting — bright and dimensional
  ambientLight(45, 45, 45);
  pointLight(255, 255, 255, 0, -450, 0);
  pointLight(200, 200, 200, 350, -120, -350);
  pointLight(150, 150, 150, -300, 120, 300);
  pointLight(100, 100, 100, 0, 350, 0);

  // --- Layers back → front ---
  drawDust(t);
  drawSnow(t);
  drawComplexGrid(t);
  drawRadialWaves(t);
  drawBeams(t);
  drawEulerSpiral(t);
  drawHelices(t);
  drawLissajous(t);
  drawTorusKnot(t, 2, 3, 100, 35, -280, 18);
  drawTorusKnot(t, 3, 5, 85,  28,  260, 14);
  drawUnitCircle(t);
  drawOrbitPoints(t);
  drawFilaments(t);
  drawPolyhedra(t);
  drawCore(t);

  // Vignette overlay (2D on top of 3D)
  push();
  resetMatrix();
  ortho();
  noLights();
  noStroke();
  texture(vignetteGfx);
  plane(W, H);
  pop();

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

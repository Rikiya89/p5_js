"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── Palette ───────────────────── */
const BG = [4, 2, 14];

const REAL_POS  = [30, 160, 255];   // +Re — deep blue
const REAL_NEG  = [255, 50, 80];    // -Re — coral
const IMAG_POS  = [0, 255, 180];    // +Im — jade
const IMAG_NEG  = [180, 60, 255];   // -Im — violet
const UNITY     = [255, 210, 80];   // roots of unity — amber
const JULIA_COL = [255, 80, 190];   // Julia orbits — hot pink
const EULER_COL = [80, 200, 255];   // Euler spiral — sky
const DUST_COL  = [160, 180, 255];  // ambient dust

/* ───────────────────── Julia Set Config ───────────────────── */
const JULIA_CR = -0.7;
const JULIA_CI = 0.27015;
const NUM_ORBITS = 90;
const MAX_ITER = 45;
const ORBIT_SCALE = 180;

/* ───────────────────── Euler Rings ───────────────────── */
const NUM_EULER_RINGS = 6;
const EULER_POINTS = 120;

/* ───────────────────── Roots of Unity ───────────────────── */
const MAX_ROOT_ORDER = 12;

/* ───────────────────── State ───────────────────── */
let muxer = null, encoder = null, isRecording = false, recordingFrameCount = 0;
let canvasEl = null, latestRecordingUrl = "";
let latestRecordingFilename = "imaginary_lattice_20260325.mp4";
let fc = 0, captureCanvas = null, captureCtx = null;

let orbits = [];
let eulerRings = [];
let unityRoots = [];
let dustParticles = [];

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

/* ───────────────────── Complex Arithmetic ───────────────────── */
function cMul(ar, ai, br, bi) { return [ar * br - ai * bi, ar * bi + ai * br]; }
function cAbs(r, i) { return Math.sqrt(r * r + i * i); }

/* ───────────────────── Smooth step ───────────────────── */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/* ───────────────────── Draw glowing sphere (multi-layer) ───────────────────── */
function glowSphere(x, y, z, baseR, col, intensity) {
  push();
  translate(x, y, z);
  noStroke();
  // Outer haze
  emissiveMaterial(col[0] * 0.03 * intensity, col[1] * 0.03 * intensity, col[2] * 0.03 * intensity);
  sphere(baseR * 3.5, 6, 6);
  // Mid glow
  emissiveMaterial(col[0] * 0.1 * intensity, col[1] * 0.1 * intensity, col[2] * 0.1 * intensity);
  sphere(baseR * 2.0, 7, 7);
  // Core
  emissiveMaterial(col[0] * 0.4 * intensity, col[1] * 0.4 * intensity, col[2] * 0.4 * intensity);
  sphere(baseR, 8, 8);
  pop();
}

/* ───────────────────── Build Julia Orbits ───────────────────── */
function buildOrbits() {
  const rng = makeRng(20260325);
  orbits = [];

  for (let k = 0; k < NUM_ORBITS; k++) {
    const angle = rng() * Math.PI * 2;
    const radius = 0.3 + rng() * 1.4;
    let zr = radius * Math.cos(angle);
    let zi = radius * Math.sin(angle);

    const trail = [];
    for (let iter = 0; iter < MAX_ITER; iter++) {
      trail.push({ re: zr, im: zi, iter });
      const [nr, ni] = cMul(zr, zi, zr, zi);
      zr = nr + JULIA_CR;
      zi = ni + JULIA_CI;
      if (cAbs(zr, zi) > 4) break;
    }

    orbits.push({
      trail,
      escaped: cAbs(zr, zi) > 4,
      phase: rng() * Math.PI * 2,
      speed: 0.2 + rng() * 0.6,
      colorMix: rng(),
    });
  }
}

/* ───────────────────── Build Euler Rings ───────────────────── */
function buildEulerRings() {
  eulerRings = [];
  for (let k = 0; k < NUM_EULER_RINGS; k++) {
    const freq = k + 1;
    const ringY = -200 + k * 100;
    const ringR = 100 + k * 28;
    eulerRings.push({ freq, y: ringY, radius: ringR });
  }
}

/* ───────────────────── Build Roots of Unity ───────────────────── */
function buildUnityRoots() {
  unityRoots = [];
  for (let n = 3; n <= MAX_ROOT_ORDER; n++) {
    const roots = [];
    for (let k = 0; k < n; k++) {
      const angle = (2 * Math.PI * k) / n;
      roots.push({ re: Math.cos(angle), im: Math.sin(angle) });
    }
    unityRoots.push({ order: n, roots });
  }
}

/* ───────────────────── Build Dust Particles ───────────────────── */
function buildDust() {
  const rng = makeRng(99999);
  dustParticles = [];
  for (let i = 0; i < 300; i++) {
    const theta = rng() * Math.PI * 2;
    const phi = Math.acos(2 * rng() - 1);
    const r = 80 + rng() * 400;
    dustParticles.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: -400 + rng() * 800,
      z: r * Math.sin(phi) * Math.sin(theta),
      size: 0.4 + rng() * 1.2,
      speed: 0.1 + rng() * 0.4,
      phase: rng() * TWO_PI,
      brightness: 0.3 + rng() * 0.7,
    });
  }
}

/* ───────────────────── Draw Ambient Dust ───────────────────── */
function drawDust(t) {
  noStroke();
  for (const d of dustParticles) {
    const flicker = 0.3 + 0.7 * Math.sin(t * d.speed * 2 + d.phase);
    const intensity = d.brightness * flicker;
    if (intensity < 0.15) continue;

    const dx = d.x + Math.sin(t * d.speed + d.phase) * 8;
    const dy = d.y + Math.cos(t * d.speed * 0.7 + d.phase * 1.3) * 6;
    const dz = d.z + Math.sin(t * d.speed * 0.5 + d.phase * 0.7) * 8;

    push();
    translate(dx, dy, dz);
    emissiveMaterial(
      DUST_COL[0] * 0.15 * intensity,
      DUST_COL[1] * 0.15 * intensity,
      DUST_COL[2] * 0.15 * intensity
    );
    sphere(d.size, 4, 4);
    pop();
  }
}

/* ───────────────────── Draw Complex Axes ───────────────────── */
function drawAxes(t) {
  push();
  const axLen = 300;
  const pulse = 0.6 + 0.4 * Math.sin(t * 0.5);

  // Real axis
  strokeWeight(0.7);
  stroke(REAL_POS[0], REAL_POS[1], REAL_POS[2], 60 * pulse);
  line(0, 0, 0, axLen, 0, 0);
  stroke(REAL_NEG[0], REAL_NEG[1], REAL_NEG[2], 60 * pulse);
  line(0, 0, 0, -axLen, 0, 0);

  // Imaginary axis
  stroke(IMAG_POS[0], IMAG_POS[1], IMAG_POS[2], 60 * pulse);
  line(0, 0, 0, 0, 0, axLen);
  stroke(IMAG_NEG[0], IMAG_NEG[1], IMAG_NEG[2], 60 * pulse);
  line(0, 0, 0, 0, 0, -axLen);

  // Glowing axis tips
  const tipPulse = 0.5 + 0.5 * Math.sin(t * 1.2);
  glowSphere(axLen, 0, 0, 3, REAL_POS, tipPulse);
  glowSphere(-axLen, 0, 0, 3, REAL_NEG, tipPulse);
  glowSphere(0, 0, axLen, 3, IMAG_POS, tipPulse);
  glowSphere(0, 0, -axLen, 3, IMAG_NEG, tipPulse);

  // Unit circle — glowing
  noFill();
  for (let layer = 0; layer < 3; layer++) {
    const alpha = [30, 12, 5][layer] * pulse;
    const weight = [0.6, 1.5, 3.0][layer];
    stroke(UNITY[0], UNITY[1], UNITY[2], alpha);
    strokeWeight(weight);
    beginShape();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * TWO_PI;
      vertex(Math.cos(a) * ORBIT_SCALE, 0, Math.sin(a) * ORBIT_SCALE);
    }
    endShape();
  }

  pop();
}

/* ───────────────────── Draw Julia Orbit Trails ───────────────────── */
function drawOrbits(t) {
  push();

  for (const orb of orbits) {
    const trail = orb.trail;
    if (trail.length < 2) continue;

    // Smooth reveal cycle
    const cycle = (t * orb.speed + orb.phase) % 8;
    const reveal = smoothstep(0, 5, cycle);
    const fadeOut = 1 - smoothstep(6, 8, cycle);
    const maxShow = Math.floor(reveal * trail.length);

    // Blend between escaped (pink) and converged (blue) with unique mix
    const baseCol = orb.escaped
      ? [lerp(JULIA_COL[0], REAL_NEG[0], orb.colorMix * 0.4),
         lerp(JULIA_COL[1], REAL_NEG[1], orb.colorMix * 0.4),
         lerp(JULIA_COL[2], REAL_NEG[2], orb.colorMix * 0.4)]
      : [lerp(EULER_COL[0], IMAG_POS[0], orb.colorMix * 0.5),
         lerp(EULER_COL[1], IMAG_POS[1], orb.colorMix * 0.5),
         lerp(EULER_COL[2], IMAG_POS[2], orb.colorMix * 0.5)];

    for (let i = 0; i < maxShow && i < trail.length - 1; i++) {
      const pt = trail[i];
      const nextPt = trail[i + 1];

      const x = pt.re * ORBIT_SCALE;
      const z = pt.im * ORBIT_SCALE;
      const y = -pt.iter * 10;

      const nx = nextPt.re * ORBIT_SCALE;
      const nz = nextPt.im * ORBIT_SCALE;
      const ny = -nextPt.iter * 10;

      const iterFrac = pt.iter / MAX_ITER;
      const fade = (1 - iterFrac * 0.5) * fadeOut;
      const alpha = (50 + 60 * fade) * fadeOut;

      // Multi-layer line glow
      for (let layer = 0; layer < 2; layer++) {
        const lAlpha = layer === 0 ? alpha : alpha * 0.25;
        const lWeight = layer === 0 ? (0.5 + (1 - iterFrac) * 0.8) : (1.5 + (1 - iterFrac) * 2.0);
        stroke(baseCol[0] * fade, baseCol[1] * fade, baseCol[2] * fade, lAlpha);
        strokeWeight(lWeight);
        line(x, y, z, nx, ny, nz);
      }

      // Head of trail glows brighter
      if (i === maxShow - 1) {
        glowSphere(x, y, z, 2.5 + (1 - iterFrac) * 3, baseCol, fade * 1.2);
      }
    }
  }

  pop();
}

/* ───────────────────── Draw Euler Rings ───────────────────── */
function drawEulerRings(t) {
  push();

  for (const ring of eulerRings) {
    const { freq, y, radius } = ring;
    const rotSpeed = 0.15 + freq * 0.06;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.6 + freq * 1.1);

    const f = (freq - 1) / NUM_EULER_RINGS;
    const colR = lerp(EULER_COL[0], IMAG_POS[0], f);
    const colG = lerp(EULER_COL[1], IMAG_POS[1], f);
    const colB = lerp(EULER_COL[2], IMAG_POS[2], f);

    noFill();
    // Double-layer ring glow
    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (30 + 20 * pulse) : (8 + 5 * pulse);
      const weight = layer === 0 ? (0.4 + 0.3 * pulse) : (1.5 + 1.0 * pulse);
      stroke(colR, colG, colB, alpha);
      strokeWeight(weight);

      beginShape();
      for (let i = 0; i <= EULER_POINTS; i++) {
        const theta = (i / EULER_POINTS) * TWO_PI;
        const cTheta = theta + t * rotSpeed;
        const px = Math.cos(cTheta) * radius;
        const pz = Math.sin(cTheta) * radius;
        const py = y + Math.sin(freq * theta + t * 0.4) * 25;
        vertex(px, py, pz);
      }
      endShape();
    }

    // Multiple traveling hands with trails
    for (let h = 0; h < freq; h++) {
      const handAngle = t * rotSpeed * freq + h * (TWO_PI / freq);
      const hx = Math.cos(handAngle) * radius;
      const hz = Math.sin(handAngle) * radius;
      const hy = y + Math.sin(freq * handAngle + t * 0.4) * 25;

      glowSphere(hx, hy, hz, 3 + 2 * pulse, [colR, colG, colB], 0.8 + 0.4 * pulse);

      // Short trail behind the hand
      noFill();
      stroke(colR, colG, colB, 20 * pulse);
      strokeWeight(0.6);
      beginShape();
      for (let tr = 0; tr < 12; tr++) {
        const trAngle = handAngle - tr * 0.06;
        const trx = Math.cos(trAngle) * radius;
        const trz = Math.sin(trAngle) * radius;
        const trTheta = (trAngle / TWO_PI) * TWO_PI;
        const try_ = y + Math.sin(freq * trTheta + t * 0.4) * 25;
        vertex(trx, try_, trz);
      }
      endShape();
    }
  }

  pop();
}

/* ───────────────────── Draw Roots of Unity ───────────────────── */
function drawUnityRoots(t) {
  push();
  noFill();

  for (let gi = 0; gi < unityRoots.length; gi++) {
    const group = unityRoots[gi];
    const n = group.order;

    const baseY = 60 + gi * 42;
    const breathe = 1 + 0.08 * Math.sin(t * 0.25 + gi * 0.6);
    const R = (70 + gi * 14) * breathe;
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.35 + n * 0.5);
    const rot = t * 0.04 * (1 + gi * 0.015);

    const hue = gi / unityRoots.length;
    const colR = lerp(UNITY[0], JULIA_COL[0], hue);
    const colG = lerp(UNITY[1], JULIA_COL[1], hue);
    const colB = lerp(UNITY[2], JULIA_COL[2], hue);

    // Double-layer polygon glow
    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (20 + 16 * pulse) : (6 + 4 * pulse);
      const weight = layer === 0 ? (0.4 + 0.25 * pulse) : (1.2 + 0.8 * pulse);
      stroke(colR, colG, colB, alpha);
      strokeWeight(weight);
      beginShape();
      for (let k = 0; k <= n; k++) {
        const angle = (2 * Math.PI * (k % n)) / n + rot;
        vertex(Math.cos(angle) * R, baseY, Math.sin(angle) * R);
      }
      endShape(CLOSE);
    }

    // Glowing root points
    for (let k = 0; k < n; k++) {
      const angle = (2 * Math.PI * k) / n + rot;
      const px = Math.cos(angle) * R;
      const pz = Math.sin(angle) * R;
      glowSphere(px, baseY, pz, 2 + pulse, [colR, colG, colB], 0.5 + 0.5 * pulse);
    }

    // Connecting lines from roots to center (radial spokes, very faint)
    stroke(colR, colG, colB, 4 * pulse);
    strokeWeight(0.2);
    for (let k = 0; k < n; k++) {
      const angle = (2 * Math.PI * k) / n + rot;
      line(0, baseY, 0, Math.cos(angle) * R, baseY, Math.sin(angle) * R);
    }
  }

  pop();
}

/* ───────────────────── Draw Multiplication Spiral ───────────────────── */
function drawMultSpiral(t) {
  push();

  const golden = (1 + Math.sqrt(5)) / 2;
  const wAngle = (2 * Math.PI) / (golden * golden) + t * 0.015;
  const wMag = 0.988;
  const wr = wMag * Math.cos(wAngle);
  const wi = wMag * Math.sin(wAngle);

  let zr = ORBIT_SCALE * 0.7;
  let zi = 0;
  const spiralY = -150;

  noFill();
  let prevX = zr, prevZ = zi;
  for (let step = 0; step < 250; step++) {
    const [nr, ni] = cMul(zr, zi, wr, wi);
    zr = nr;
    zi = ni;

    const f = step / 250;
    const fade = 1 - f;
    const yOff = spiralY - step * 1.0;

    // Multi-layer glow spiral
    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (25 * fade) : (7 * fade);
      const weight = layer === 0 ? 0.4 : 1.2;
      stroke(
        lerp(IMAG_NEG[0], EULER_COL[0], f),
        lerp(IMAG_NEG[1], EULER_COL[1], f),
        lerp(IMAG_NEG[2], EULER_COL[2], f),
        alpha
      );
      strokeWeight(weight);
      line(prevX, yOff + 1, prevZ, zr, yOff, zi);
    }

    prevX = zr;
    prevZ = zi;
  }

  pop();
}

/* ───────────────────── Mandelbrot Boundary Particles ───────────────────── */
function drawBoundaryParticles(t) {
  push();
  noStroke();

  const numParticles = 40;

  for (let p = 0; p < numParticles; p++) {
    const cAngle = t * 0.1 + p * (TWO_PI / numParticles);
    const cardioidR = 0.25;
    const cr = cardioidR * (2 * Math.cos(cAngle) - Math.cos(2 * cAngle));
    const ci = cardioidR * (2 * Math.sin(cAngle) - Math.sin(2 * cAngle));

    let zr = 0, zi = 0;
    const iterY = 300;

    for (let iter = 0; iter < 24; iter++) {
      const [nr, ni] = cMul(zr, zi, zr, zi);
      zr = nr + cr;
      zi = ni + ci;
      if (cAbs(zr, zi) > 2) break;

      const px = zr * ORBIT_SCALE * 0.5;
      const pz = zi * ORBIT_SCALE * 0.5;
      const py = iterY - iter * 7;

      const iterFrac = iter / 24;
      const col = [
        lerp(REAL_POS[0], IMAG_POS[0], iterFrac),
        lerp(REAL_POS[1], IMAG_POS[1], iterFrac),
        lerp(REAL_POS[2], IMAG_POS[2], iterFrac),
      ];

      const flicker = 0.3 + 0.7 * Math.sin(t * 2.5 + p * 1.9 + iter * 0.7);
      glowSphere(px, py, pz, 1.2 + flicker * 1.5, col, flicker * 0.6);
    }
  }

  pop();
}

/* ───────────────────── Central Core ───────────────────── */
function drawCentralCore(t) {
  push();
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.2);
  const pulse2 = 0.5 + 0.5 * Math.sin(t * 1.9);
  const pulse3 = 0.5 + 0.5 * Math.sin(t * 0.7);

  noStroke();

  // Outermost haze
  emissiveMaterial(
    EULER_COL[0] * 0.02 * pulse3,
    EULER_COL[1] * 0.02 * pulse3,
    EULER_COL[2] * 0.02 * pulse3
  );
  sphere(70 + 20 * pulse3, 14, 14);

  // Mid aura — color shifts over time
  const auraR = lerp(EULER_COL[0], IMAG_POS[0], pulse2 * 0.5);
  const auraG = lerp(EULER_COL[1], IMAG_POS[1], pulse2 * 0.5);
  const auraB = lerp(EULER_COL[2], IMAG_POS[2], pulse2 * 0.5);
  emissiveMaterial(auraR * 0.06 * pulse, auraG * 0.06 * pulse, auraB * 0.06 * pulse);
  sphere(40 + 12 * pulse, 12, 12);

  // Inner glow
  emissiveMaterial(
    EULER_COL[0] * 0.15 * pulse2,
    EULER_COL[1] * 0.15 * pulse2,
    EULER_COL[2] * 0.15 * pulse2
  );
  sphere(22 + 5 * pulse2, 10, 10);

  // Bright core
  emissiveMaterial(EULER_COL[0] * 0.55, EULER_COL[1] * 0.55, EULER_COL[2] * 0.55);
  sphere(7, 12, 12);

  // 4 orbiting rings — representing i, i², i³, i⁴ = 1 (the 4 powers)
  noFill();
  const ringColors = [REAL_POS, IMAG_POS, REAL_NEG, IMAG_NEG];
  for (let r = 0; r < 4; r++) {
    const speed = 0.6 + r * 0.22;
    const a = t * speed + r * HALF_PI;
    const ringR = 30 + r * 12 + 5 * Math.sin(t * 0.5 + r * 1.5);
    const col = ringColors[r];

    // Double-layer ring glow
    for (let layer = 0; layer < 2; layer++) {
      const alpha = layer === 0 ? (35 + 20 * pulse) : (8 + 5 * pulse);
      const weight = layer === 0 ? (0.5 + 0.3 * pulse) : (1.5 + 1.0 * pulse);
      stroke(col[0], col[1], col[2], alpha);
      strokeWeight(weight);

      push();
      rotateX(a);
      rotateY(a * 0.618);
      rotateZ(a * 0.382);
      beginShape();
      for (let i = 0; i <= 60; i++) {
        const ang = (i / 60) * TWO_PI;
        vertex(Math.cos(ang) * ringR, 0, Math.sin(ang) * ringR);
      }
      endShape();
      pop();
    }
  }

  pop();
}

/* ───────────────────── Complex Grid ───────────────────── */
function drawComplexGrid(t) {
  push();
  noFill();
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.25);
  const gridAlpha = 4 + 3 * pulse;
  const gridRange = 2;
  const gridStep = ORBIT_SCALE;

  strokeWeight(0.2);
  stroke(REAL_POS[0], REAL_POS[1], REAL_POS[2], gridAlpha);
  for (let i = -gridRange; i <= gridRange; i++) {
    if (i === 0) continue;
    const pos = i * gridStep;
    line(pos, 0, -gridRange * gridStep, pos, 0, gridRange * gridStep);
  }

  stroke(IMAG_POS[0], IMAG_POS[1], IMAG_POS[2], gridAlpha);
  for (let i = -gridRange; i <= gridRange; i++) {
    if (i === 0) continue;
    const pos = i * gridStep;
    line(-gridRange * gridStep, 0, pos, gridRange * gridStep, 0, pos);
  }

  pop();
}

/* ───────────────────── Conformal Ripples ───────────────────── */
function drawConformalRipples(t) {
  push();
  noFill();

  for (let w = 0; w < 4; w++) {
    const phase = (t * 0.08 + w * 0.25) % 1.0;
    const R = phase * 280;
    const alpha = (1 - phase) * 22;
    if (alpha < 2) continue;

    // Original circle — double layer glow
    for (let layer = 0; layer < 2; layer++) {
      const lAlpha = layer === 0 ? alpha : alpha * 0.2;
      const lWeight = layer === 0 ? 0.3 : 1.0;
      stroke(EULER_COL[0], EULER_COL[1], EULER_COL[2], lAlpha);
      strokeWeight(lWeight);
      beginShape();
      for (let i = 0; i <= 80; i++) {
        const a = (i / 80) * TWO_PI;
        vertex(Math.cos(a) * R, 0, Math.sin(a) * R);
      }
      endShape();
    }

    // z² image
    const R2 = (R / ORBIT_SCALE) * (R / ORBIT_SCALE) * ORBIT_SCALE * 0.4;
    for (let layer = 0; layer < 2; layer++) {
      const lAlpha = layer === 0 ? alpha * 0.5 : alpha * 0.1;
      const lWeight = layer === 0 ? 0.3 : 1.0;
      stroke(JULIA_COL[0], JULIA_COL[1], JULIA_COL[2], lAlpha);
      strokeWeight(lWeight);
      beginShape();
      for (let i = 0; i <= 100; i++) {
        const a = (i / 100) * TWO_PI;
        vertex(Math.cos(2 * a) * R2, -15, Math.sin(2 * a) * R2);
      }
      endShape();
    }
  }

  pop();
}

/* ───────────────────── Vertical i-axis Markers ───────────────────── */
function drawIAxisMarkers(t) {
  push();
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.8);

  // Vertical axis through the core (Y direction = iteration depth)
  stroke(EULER_COL[0], EULER_COL[1], EULER_COL[2], 12 * pulse);
  strokeWeight(0.25);
  line(0, -500, 0, 0, 500, 0);

  // Floating markers at integer imaginary positions
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const y = i * 100;
    const markerPulse = 0.4 + 0.6 * Math.sin(t * 0.9 + i * 0.8);
    const col = i > 0 ? IMAG_POS : IMAG_NEG;
    glowSphere(0, y, 0, 2, col, markerPulse * 0.5);

    // Small ring at each marker
    noFill();
    stroke(col[0], col[1], col[2], 10 * markerPulse);
    strokeWeight(0.25);
    beginShape();
    for (let j = 0; j <= 30; j++) {
      const a = (j / 30) * TWO_PI;
      vertex(Math.cos(a) * 15, y, Math.sin(a) * 15);
    }
    endShape();
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

  buildOrbits();
  buildEulerRings();
  buildUnityRoots();
  buildDust();

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const t = fc / FPS;
  background(BG[0], BG[1], BG[2]);

  // Camera — CLOSE, intimate orbit with gentle drift
  const camAngle = t * 0.05;
  const camR = 380 + 60 * Math.sin(t * 0.025);
  const camY = -180 - 100 * Math.sin(t * 0.04);
  const lookY = 20 + 40 * Math.sin(t * 0.03);
  camera(
    camR * Math.cos(camAngle), camY, camR * Math.sin(camAngle),
    0, lookY, 0,
    0, 1, 0
  );

  // Richer lighting
  ambientLight(6, 8, 16);
  pointLight(EULER_COL[0] * 0.25, EULER_COL[1] * 0.25, EULER_COL[2] * 0.25, 0, -400, 0);
  pointLight(IMAG_POS[0] * 0.18, IMAG_POS[1] * 0.18, IMAG_POS[2] * 0.18, 300, -150, -300);
  pointLight(JULIA_COL[0] * 0.18, JULIA_COL[1] * 0.18, JULIA_COL[2] * 0.18, -250, 150, 250);
  pointLight(UNITY[0] * 0.08, UNITY[1] * 0.08, UNITY[2] * 0.08, 0, 300, 0);

  drawDust(t);
  drawComplexGrid(t);
  drawAxes(t);
  drawIAxisMarkers(t);
  drawConformalRipples(t);
  drawOrbits(t);
  drawEulerRings(t);
  drawUnityRoots(t);
  drawMultSpiral(t);
  drawBoundaryParticles(t);
  drawCentralCore(t);

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

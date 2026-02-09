// Sacred Resonance — Spiritual 3D Generative Art
// Merkaba × Superformula × Seed of Life × Torus Knot × Kundalini Column

const W = 1080;
const H = 1920;

const PAL = [
  [54, 45, 120],   // #362d78
  [82, 63, 163],   // #523fa3
  [145, 108, 204], // #916ccc
  [189, 161, 229], // #bda1e5
  [200, 192, 233], // #c8c0e9
  [132, 186, 231], // #84bae7
  [81, 106, 212],  // #516ad4
  [51, 63, 135],   // #333f87
  [41, 48, 57],    // #293039
  [40, 54, 49],    // #283631
];

// ─── Recording ───
let encoder = null;
let muxer = null;
let isRecording = false;
let recordingFrameCount = 0;
let recordingStartTime = 0;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;

let t = 0;
let stars = [];

function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);

  // Star field on 3 concentric sphere shells
  for (let layer = 0; layer < 3; layer++) {
    let minR = 600 + layer * 300;
    let maxR = 900 + layer * 300;
    let count = 220 - layer * 50;
    for (let i = 0; i < count; i++) {
      let theta = random(TWO_PI);
      let phi = acos(random(-1, 1));
      let r = random(minR, maxR);
      stars.push({
        x: r * sin(phi) * cos(theta),
        y: r * sin(phi) * sin(theta),
        z: r * cos(phi),
        layer: layer
      });
    }
  }

  const maxDurEl = document.getElementById('maxDuration');
  if (maxDurEl) maxDurEl.textContent = MAX_DURATION;
}

// ─── Gielis Superformula ───
function sf(theta, m, n1, n2, n3) {
  let c = cos(m * theta * 0.25);
  let s = sin(m * theta * 0.25);
  let r = pow(pow(abs(c), n2) + pow(abs(s), n3), -1.0 / n1);
  return isFinite(r) ? r : 0;
}

// Palette interpolation with seamless wrap
function palColor(idx) {
  idx = ((idx % 1.0) + 1.0) % 1.0;
  let s = idx * (PAL.length - 1);
  let i = constrain(floor(s), 0, PAL.length - 2);
  let f = s - i;
  return [
    lerp(PAL[i][0], PAL[i + 1][0], f),
    lerp(PAL[i][1], PAL[i + 1][1], f),
    lerp(PAL[i][2], PAL[i + 1][2], f)
  ];
}

// ─── Global breathing rhythm ───
// Floor raised so it NEVER goes fully dark
function getBreath() {
  return 0.65 + 0.25 * sin(t * 0.2) + 0.1 * sin(t * 0.4 + 0.5);
}

// ═══════════════════════════════════════════
// DRAW
// ═══════════════════════════════════════════
function draw() {
  background(20, 17, 35);

  let breath = getBreath();

  // Breathing camera with more dynamic orbit
  let d = 530 + 60 * breath;
  camera(
    d * sin(t * 0.08),
    -30 + 70 * sin(t * 0.055),
    d * cos(t * 0.08),
    0, 0, 0,
    0, 1, 0
  );

  // Brighter lights on orbiting paths
  let li = 0.7 + 0.3 * breath;
  ambientLight(40 * li, 35 * li, 70 * li);
  pointLight(
    220 * li, 210 * li, 245 * li,
    400 * sin(t * 0.15), -300 * cos(t * 0.12), 350 * sin(t * 0.19));
  pointLight(
    150 * li, 200 * li, 240 * li,
    -350 * cos(t * 0.13), 250 * sin(t * 0.1), -400 * cos(t * 0.17));
  pointLight(
    100 * li, 80 * li, 190 * li,
    250 * sin(t * 0.2), 0, 250 * cos(t * 0.25));

  drawStars(breath);
  drawResonance(breath);
  drawTorusKnot(breath);
  drawSeedOfLife(breath);
  drawKundalini(breath);
  drawMerkaba(breath);
  drawSupershape(breath);
  drawAura(breath);
  drawToroidalFlow(breath);
  drawGoldenSpiral(breath);

  t += 0.005;

  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    const durEl = document.getElementById('duration');
    const frameEl = document.getElementById('frameCount');
    if (durEl) durEl.textContent = ((Date.now() - recordingStartTime) / 1000).toFixed(1);
    if (frameEl) frameEl.textContent = recordingFrameCount;
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ═══════════════════════════════════════════
// 1. STARS — twinkling cosmic depth
// ═══════════════════════════════════════════
function drawStars(breath) {
  noFill();
  for (let ci = 0; ci < PAL.length; ci++) {
    let c = PAL[ci];
    let flicker = 0.6 + 0.4 * sin(t * 0.8 + ci * 1.3);
    strokeWeight(2.0 + 0.6 * sin(t * 0.5 + ci));
    stroke(c[0], c[1], c[2], (120 + 60 * breath) * flicker);

    beginShape(POINTS);
    for (let i = ci; i < stars.length; i += PAL.length) {
      vertex(stars[i].x, stars[i].y, stars[i].z);
    }
    endShape();
  }
}

// ═══════════════════════════════════════════
// 2. RESONANCE EMANATION — Om vibrations
// Expanding rings in 3 orthogonal planes
// ═══════════════════════════════════════════
function drawResonance(breath) {
  noFill();

  let planes = [
    { rx: HALF_PI * 0.08, ry: 0 },
    { rx: HALF_PI * 0.9,  ry: 0 },
    { rx: HALF_PI * 0.3,  ry: HALF_PI * 0.7 }
  ];

  for (let pl = 0; pl < planes.length; pl++) {
    push();
    rotateX(planes[pl].rx);
    rotateY(planes[pl].ry + t * 0.02);

    for (let i = 0; i < 5; i++) {
      let phase = (t * 0.15 + i / 5.0 + pl * 0.33) % 1.0;
      let radius = 140 + phase * 400;
      let alpha = (1 - phase) * (70 + 40 * breath);
      let sw = 2.0 * (1 - phase) + 0.3;

      let c = palColor(phase + pl * 0.33 + t * 0.02);
      strokeWeight(sw);
      stroke(c[0], c[1], c[2], alpha);

      beginShape();
      for (let j = 0; j <= 72; j++) {
        let a = map(j, 0, 72, 0, TWO_PI);
        vertex(radius * cos(a), 0, radius * sin(a));
      }
      endShape(CLOSE);
    }
    pop();
  }
}

// ═══════════════════════════════════════════
// 3. MERKABA — Counter-rotating Star Tetrahedron
// Spirit tetra ↻  Matter tetra ↺
// ═══════════════════════════════════════════
function drawMerkaba(breath) {
  let s = 86 * (1 + 0.05 * breath);

  // Even-parity: spirit tetrahedron (rotates +)
  let t1base = [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]];
  // Odd-parity: matter tetrahedron (rotates -)
  let t2base = [[-1,-1,-1],[-1,1,1],[1,-1,1],[1,1,-1]];

  noFill();

  let passes = [
    { weight: 7,   alpha: 30 + 20 * breath, color: [145, 108, 204] },
    { weight: 2.8, alpha: 70 + 40 * breath, color: [189, 161, 229] },
    { weight: 0.8, alpha: 200 + 55 * breath, color: [200, 192, 233] }
  ];

  // Spirit tetrahedron — rotates one direction
  push();
  rotateY(t * 0.12);
  rotateX(t * 0.08);
  rotateZ(t * 0.05);
  let t1 = t1base.map(v => [v[0]*s, v[1]*s, v[2]*s]);
  for (let pass of passes) {
    strokeWeight(pass.weight);
    stroke(pass.color[0], pass.color[1], pass.color[2], pass.alpha);
    beginShape(LINES);
    merkabaPaths(t1);
    endShape();
  }
  noStroke();
  for (let v of t1) {
    push();
    translate(v[0], v[1], v[2]);
    emissiveMaterial(200, 192, 233);
    sphere(3 + 2 * breath, 8, 6);
    pop();
  }
  pop();

  // Matter tetrahedron — rotates opposite direction
  push();
  rotateY(-t * 0.12);
  rotateX(-t * 0.08);
  rotateZ(-t * 0.05);
  let t2 = t2base.map(v => [v[0]*s, v[1]*s, v[2]*s]);
  for (let pass of passes) {
    strokeWeight(pass.weight);
    stroke(pass.color[0], pass.color[1], pass.color[2], pass.alpha);
    beginShape(LINES);
    merkabaPaths(t2);
    endShape();
  }
  noStroke();
  for (let v of t2) {
    push();
    translate(v[0], v[1], v[2]);
    emissiveMaterial(132, 186, 231);
    sphere(3 + 2 * breath, 8, 6);
    pop();
  }
  pop();
}

function merkabaPaths(verts) {
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      vertex(verts[i][0], verts[i][1], verts[i][2]);
      vertex(verts[j][0], verts[j][1], verts[j][2]);
    }
  }
}

// ═══════════════════════════════════════════
// 4. KUNDALINI ENERGY COLUMN — dual helix
// Two intertwined spirals ascending/descending
// ═══════════════════════════════════════════
function drawKundalini(breath) {
  let columnH = 500;
  let spiralR = 35 + 10 * breath;
  let N = 180;

  noFill();

  // Two helices, phase-offset by PI
  for (let helix = 0; helix < 2; helix++) {
    let phaseOff = helix * PI;
    let colIdx = helix === 0 ? 2 : 5;

    // Glow
    strokeWeight(5);
    stroke(PAL[colIdx][0], PAL[colIdx][1], PAL[colIdx][2], 35 + 15 * breath);
    beginShape();
    for (let i = 0; i <= N; i++) {
      let prog = i / N;
      let y = -columnH * 0.5 + columnH * prog;
      let angle = prog * TWO_PI * 6 + t * 3 + phaseOff;
      let r = spiralR * sin(prog * PI);
      vertex(r * cos(angle), y, r * sin(angle));
    }
    endShape();

    // Core
    strokeWeight(1.5);
    stroke(PAL[colIdx][0], PAL[colIdx][1], PAL[colIdx][2], 180 + 60 * breath);
    beginShape();
    for (let i = 0; i <= N; i++) {
      let prog = i / N;
      let y = -columnH * 0.5 + columnH * prog;
      let angle = prog * TWO_PI * 6 + t * 3 + phaseOff;
      let r = spiralR * sin(prog * PI);
      vertex(r * cos(angle), y, r * sin(angle));
    }
    endShape();
  }

  // Energy nodes at helix crossings (every half turn)
  noStroke();
  let crossings = 12;
  for (let i = 0; i < crossings; i++) {
    let prog = (i + 0.5) / crossings;
    let y = -columnH * 0.5 + columnH * prog;
    let pulse = 0.5 + 0.5 * sin(t * 3 + i * 1.2);
    let sz = 3 + 4 * pulse * breath;

    push();
    translate(0, y, 0);
    let c = palColor(prog + t * 0.05);
    emissiveMaterial(c[0], c[1], c[2]);
    sphere(sz, 10, 8);
    pop();
  }
}

// ═══════════════════════════════════════════
// 5. SUPERSHAPE — Organic crystal with Perlin breath
// ═══════════════════════════════════════════
function drawSupershape(breath) {
  push();
  rotateY(t * 0.12);
  rotateX(sin(t * 0.07) * 0.25);
  rotateZ(t * 0.025);

  let det = 44;
  let sc = 112 * (1 + 0.04 * breath);

  let m1  = 7 + 2 * sin(t * 0.22);
  let n11 = 0.3 + 0.6 * abs(sin(t * 0.13));
  let n12 = 1.7 + 0.4 * cos(t * 0.18);
  let n13 = 1.7 + 0.4 * sin(t * 0.2);

  let m2  = 7 + 2 * cos(t * 0.16);
  let n21 = 0.3 + 0.6 * abs(cos(t * 0.11));
  let n22 = 1.7 + 0.4 * sin(t * 0.22);
  let n23 = 1.7 + 0.4 * cos(t * 0.15);

  noStroke();

  for (let i = 0; i < det; i++) {
    let lat1 = map(i, 0, det, -HALF_PI, HALF_PI);
    let lat2 = map(i + 1, 0, det, -HALF_PI, HALF_PI);

    let c = palColor(i / det + t * 0.015);
    specularMaterial(c[0], c[1], c[2]);
    shininess(80);

    beginShape(TRIANGLE_STRIP);
    for (let j = 0; j <= det; j++) {
      let lon = map(j, 0, det, -PI, PI);
      let r1 = sf(lon, m1, n11, n12, n13);

      let r2a = sf(lat1, m2, n21, n22, n23);
      let nx1 = r1 * cos(lon) * r2a * cos(lat1);
      let ny1 = r1 * sin(lon) * r2a * cos(lat1);
      let nz1 = r2a * sin(lat1);
      let d1 = noise(nx1 * 2 + t * 0.4, ny1 * 2, nz1 * 2) * 0.1;
      let s1 = sc * (1 + d1);
      vertex(s1 * nx1, s1 * ny1, s1 * nz1);

      let r2b = sf(lat2, m2, n21, n22, n23);
      let nx2 = r1 * cos(lon) * r2b * cos(lat2);
      let ny2 = r1 * sin(lon) * r2b * cos(lat2);
      let nz2 = r2b * sin(lat2);
      let d2 = noise(nx2 * 2 + t * 0.4, ny2 * 2, nz2 * 2) * 0.1;
      let s2 = sc * (1 + d2);
      vertex(s2 * nx2, s2 * ny2, s2 * nz2);
    }
    endShape();
  }
  pop();
}

// ═══════════════════════════════════════════
// 6. AURA — 6-layer breathing luminous field
// ═══════════════════════════════════════════
function drawAura(breath) {
  push();
  rotateY(t * 0.12);
  rotateX(sin(t * 0.07) * 0.25);
  noStroke();

  for (let layer = 0; layer < 6; layer++) {
    let radius = 130 + layer * 22;
    let c = PAL[(layer + 1) % PAL.length];
    let pulse = 0.6 + 0.4 * sin(t * 0.5 + layer * 0.6);
    let alpha = (12 - layer * 1.5) * pulse * breath;
    fill(c[0], c[1], c[2], alpha);
    sphere(radius, 20, 16);
  }
  pop();
}

// ═══════════════════════════════════════════
// 7. SEED OF LIFE — wave-breathing sacred circles
// Each ring pulses in sequence — ripple cascade
// ═══════════════════════════════════════════
function drawSeedOfLife(breath) {
  push();
  rotateY(t * 0.06);
  rotateX(PI * 0.07);

  let baseR = 95;
  let pts = 72;

  noFill();

  for (let ring = 0; ring < 7; ring++) {
    let cx = 0, cz = 0;
    let tiltX = 0, tiltZ = 0;

    // Each ring pulses at a different phase — wave cascade
    let ringPulse = 1 + 0.08 * sin(t * 1.5 - ring * 0.8);
    let r = baseR * ringPulse * (1 + 0.03 * breath);

    if (ring > 0) {
      let angle = (TWO_PI / 6) * (ring - 1) + t * 0.05;
      cx = r * cos(angle);
      cz = r * sin(angle);
      tiltX = sin(angle + t * 0.1) * 0.15;
      tiltZ = cos(angle + t * 0.08) * 0.1;
    }

    push();
    translate(cx, 0, cz);
    rotateX(tiltX);
    rotateZ(tiltZ);

    let c = PAL[(ring + 2) % PAL.length];
    let ringAlpha = 0.7 + 0.3 * sin(t * 1.5 - ring * 0.8);

    // Glow
    strokeWeight(4);
    stroke(c[0], c[1], c[2], (35 + 20 * breath) * ringAlpha);
    beginShape();
    for (let i = 0; i <= pts; i++) {
      let a = map(i, 0, pts, 0, TWO_PI);
      vertex(r * cos(a), 0, r * sin(a));
    }
    endShape(CLOSE);

    // Core
    strokeWeight(0.9);
    stroke(c[0], c[1], c[2], (150 + 80 * breath) * ringAlpha);
    beginShape();
    for (let i = 0; i <= pts; i++) {
      let a = map(i, 0, pts, 0, TWO_PI);
      vertex(r * cos(a), 0, r * sin(a));
    }
    endShape(CLOSE);
    pop();
  }
  pop();
}

// ═══════════════════════════════════════════
// 8. TORUS KNOT (3,2) — with traveling color wave
// ═══════════════════════════════════════════
function drawTorusKnot(breath) {
  push();
  rotateY(t * 0.06);
  rotateX(0.22);

  let R = 215, r = 80;
  let p = 3, q = 2;
  let steps = 600;

  noFill();

  let passes = [
    { weight: 9,   alphaBase: 30 },
    { weight: 3.5, alphaBase: 70 },
    { weight: 1.3, alphaBase: 210 }
  ];

  for (let pass of passes) {
    strokeWeight(pass.weight);
    beginShape();
    for (let i = 0; i <= steps; i++) {
      let u = map(i, 0, steps, 0, TWO_PI * p);
      let qu = q * u / p;
      let x = (R + r * cos(qu)) * cos(u);
      let y = (R + r * cos(qu)) * sin(u);
      let z = r * sin(qu);

      // Traveling bright pulse along the knot
      let wave = 0.5 + 0.5 * sin(i / steps * TWO_PI * 3 - t * 4);
      let alpha = pass.alphaBase * (0.5 + 0.5 * breath) * (0.6 + 0.4 * wave);
      let c = palColor(((i / steps) + t * 0.05) % 1.0);
      stroke(c[0], c[1], c[2], alpha);
      vertex(x, y, z);
    }
    endShape();
  }
  pop();
}

// ═══════════════════════════════════════════
// 9. TOROIDAL ENERGY FLOW — φ-spaced particles
// ═══════════════════════════════════════════
function drawToroidalFlow(breath) {
  push();
  rotateY(t * 0.05);
  rotateX(HALF_PI * 0.12);

  let R = 230, r = 58;
  let PHI = (1 + sqrt(5)) / 2;
  let N = 350;

  noFill();

  for (let ci = 0; ci < PAL.length; ci++) {
    let c = PAL[ci];
    let sw = 2.5 + 1.5 * breath + sin(t * 0.8 + ci) * 0.5;
    strokeWeight(sw);
    stroke(c[0], c[1], c[2], 130 + 80 * breath);

    beginShape(POINTS);
    for (let i = ci; i < N; i += PAL.length) {
      let u = ((i / N) * TWO_PI + t * 0.4) % TWO_PI;
      let v = (i * PHI * TWO_PI + t * 0.25) % TWO_PI;
      vertex(
        (R + r * cos(v)) * cos(u),
        (R + r * cos(v)) * sin(u),
        r * sin(v)
      );
    }
    endShape();
  }
  pop();
}

// ═══════════════════════════════════════════
// 10. GOLDEN SPIRAL — ascending with trails
// ═══════════════════════════════════════════
function drawGoldenSpiral(breath) {
  let GA = PI * (3 - sqrt(5));
  let N = 250;
  let trailSteps = 4;
  let trailDt = 0.012;

  for (let step = trailSteps; step >= 0; step--) {
    let tOff = t - step * trailDt;
    let alpha = map(step, 0, trailSteps, 180 + 70 * breath, 15);
    let sw = map(step, 0, trailSteps, 3.5, 1.0);

    for (let ci = 0; ci < PAL.length; ci++) {
      let c = PAL[ci];
      strokeWeight(sw + sin(t * 1.0 + ci) * 0.6);
      stroke(c[0], c[1], c[2], alpha);

      beginShape(POINTS);
      for (let i = ci; i < N; i += PAL.length) {
        let theta = i * GA + tOff * 0.3;
        let radius = sqrt(i) * 20;
        let h = (i - N * 0.5) * 1.8
              + 35 * sin(tOff * 0.8 + i * 0.04)
              + 20 * sin(tOff * 0.15 + i * 0.015);
        vertex(radius * cos(theta), h, radius * sin(theta));
      }
      endShape();
    }
  }

  // Fibonacci accent spheres
  noStroke();
  let fibs = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];
  for (let fi of fibs) {
    if (fi >= N) break;
    let theta = fi * GA + t * 0.3;
    let radius = sqrt(fi) * 20;
    let h = (fi - N * 0.5) * 1.8
          + 35 * sin(t * 0.8 + fi * 0.04)
          + 20 * sin(t * 0.15 + fi * 0.015);
    let c = PAL[fi % PAL.length];

    push();
    translate(radius * cos(theta), h, radius * sin(theta));
    emissiveMaterial(c[0], c[1], c[2]);
    sphere(3.5 + 3 * breath * sin(t * 1.5 + fi), 8, 6);
    pop();
  }
}

// ═══════════════════════════════════════════
// Recording (WebCodecs + mp4-muxer)
// ═══════════════════════════════════════════
async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('Your browser does not support WebCodecs API.');
    return;
  }

  t = 0;
  isRecording = true;
  recordingFrameCount = 0;
  recordingStartTime = Date.now();

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H },
    fastStart: 'in-memory'
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error('Encoder error:', e)
  });

  encoder.configure({
    codec: 'avc1.640028',
    width: W, height: H,
    bitrate: 12_000_000,
    framerate: FPS
  });

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  if (statusEl) {
    statusEl.textContent = 'Recording...';
    statusEl.style.color = '#ff6b6b';
  }
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;

  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sacred_resonance.mp4';
  a.click();

  encoder = null;
  muxer = null;

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');
  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (statusEl) {
    statusEl.textContent = 'Complete!';
    setTimeout(() => {
      statusEl.textContent = 'Ready';
      statusEl.style.color = '#84bae7';
    }, 3000);
  }
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector('canvas');
  const frame = new VideoFrame(canvas, {
    timestamp: recordingFrameCount * (1_000_000 / FPS)
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

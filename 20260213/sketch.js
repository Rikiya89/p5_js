// 3D Valentine Bloom

const W = 1080;
const H = 1920;

const PAL = [
  [255, 72, 118],  // hot pink
  [255, 102, 145],
  [255, 140, 176],
  [255, 184, 207],
  [255, 222, 234],
  [255, 196, 132], // warm gold
  [255, 130, 142],
  [214, 48, 92],
  [120, 20, 45],
  [46, 8, 24],
];

// Recording
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
let orbitHearts = [];
let petals = [];

function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);

  initStars();
  initOrbitHearts();
  initPetals();

  const maxDurEl = document.getElementById('maxDuration');
  if (maxDurEl) maxDurEl.textContent = MAX_DURATION;
}

function initStars() {
  for (let layer = 0; layer < 3; layer++) {
    let minR = 540 + layer * 280;
    let maxR = 850 + layer * 280;
    let count = 250 - layer * 60;
    for (let i = 0; i < count; i++) {
      let theta = random(TWO_PI);
      let phi = acos(random(-1, 1));
      let r = random(minR, maxR);
      stars.push({
        x: r * sin(phi) * cos(theta),
        y: r * sin(phi) * sin(theta),
        z: r * cos(phi),
      });
    }
  }
}

function initOrbitHearts() {
  let count = 14;
  for (let i = 0; i < count; i++) {
    orbitHearts.push({
      phase: (TWO_PI * i) / count,
      radius: 210 + (i % 4) * 38,
      speed: 0.35 + 0.06 * (i % 5),
      yOffset: map(i % 7, 0, 6, -150, 150),
      tilt: random(-0.5, 0.5),
      scale: random(1.0, 1.6),
    });
  }
}

function initPetals() {
  let count = 64;
  for (let i = 0; i < count; i++) {
    petals.push({
      baseAngle: random(TWO_PI),
      radius: random(120, 390),
      spin: random(0.2, 0.65),
      yBase: random(-300, 320),
      seed: random(),
    });
  }
}

function draw() {
  let pulse = getPulse();
  let bgWave = 0.5 + 0.5 * sin(t * 0.22 + 0.7);
  background(
    14 + 16 * bgWave,
    4 + 8 * bgWave,
    18 + 14 * bgWave
  );

  updateOrbitCamera(pulse);
  setLights(pulse);

  drawRoseMist(pulse);
  drawAurora(pulse);
  drawStars(pulse);
  drawLoveRibbons(pulse);
  drawHaloRings(pulse);
  drawPetalSpiral(pulse);
  drawOrbitTrails(pulse);
  drawCentralHeart(pulse);
  drawOrbitingHearts(pulse);
  drawCupidArrow(pulse);
  drawSparkCore(pulse);

  t += 0.008;

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

function getPulse() {
  return 0.72 + 0.2 * sin(t * 1.2) + 0.1 * sin(t * 2.5 + 0.4);
}

function updateOrbitCamera(pulse) {
  let camR = 560 + 50 * sin(t * 0.6);
  camera(
    camR * sin(t * 0.24),
    -75 + 60 * sin(t * 0.34),
    camR * cos(t * 0.24),
    0, 0, 0,
    0, 1, 0
  );
}

function setLights(pulse) {
  let li = 0.65 + 0.35 * pulse;
  ambientLight(58 * li, 20 * li, 28 * li);

  pointLight(
    255 * li, 130 * li, 170 * li,
    360 * sin(t * 0.7),
    -270,
    360 * cos(t * 0.7)
  );

  pointLight(
    255 * li, 205 * li, 130 * li,
    -330 * cos(t * 0.48),
    260 * sin(t * 0.55),
    -290 * sin(t * 0.48)
  );

  pointLight(
    180 * li, 72 * li, 108 * li,
    0,
    -120,
    260
  );

  directionalLight(
    255 * li, 160 * li, 185 * li,
    -0.35, 0.2, -0.85
  );
}

function drawRoseMist(pulse) {
  noStroke();
  for (let i = 0; i < 6; i++) {
    let c = palColor(0.06 + i * 0.12 + t * 0.02);
    let sway = 90 * sin(t * (0.18 + i * 0.02) + i * 1.7);

    push();
    translate(
      sway,
      -330 + i * 120,
      -1200 - i * 160
    );
    fill(c[0], c[1] * 0.65, c[2] * 0.82, 22 + 10 * pulse);
    sphere(210 + i * 32, 16, 10);
    pop();
  }
}

function palColor(idx) {
  idx = ((idx % 1.0) + 1.0) % 1.0;
  let s = idx * (PAL.length - 1);
  let i = constrain(floor(s), 0, PAL.length - 2);
  let f = s - i;
  return [
    lerp(PAL[i][0], PAL[i + 1][0], f),
    lerp(PAL[i][1], PAL[i + 1][1], f),
    lerp(PAL[i][2], PAL[i + 1][2], f),
  ];
}

function drawAurora(pulse) {
  noFill();
  for (let layer = 0; layer < 5; layer++) {
    let radius = 210 + layer * 68;
    let c = palColor(0.05 + layer * 0.11 + t * 0.03);
    strokeWeight(2.2 + layer * 0.22);
    stroke(c[0], c[1], c[2], 24 + layer * 10 + 24 * pulse);

    push();
    rotateY(layer * 0.35 + t * 0.07);
    rotateX(layer * 0.14 + t * 0.05);
    beginShape();
    for (let i = 0; i <= 96; i++) {
      let a = map(i, 0, 96, 0, TWO_PI);
      vertex(radius * cos(a), 0, radius * sin(a));
    }
    endShape(CLOSE);

    strokeWeight(0.95 + layer * 0.1);
    stroke(c[0], c[1], c[2], 92 + layer * 8 + 38 * pulse);
    beginShape();
    for (let i = 0; i <= 96; i++) {
      let a = map(i, 0, 96, 0, TWO_PI);
      vertex((radius - 10) * cos(a), 0, (radius - 10) * sin(a));
    }
    endShape(CLOSE);
    pop();
  }
}

function drawLoveRibbons(pulse) {
  noFill();
  let ribbonCount = 3;

  for (let rbi = 0; rbi < ribbonCount; rbi++) {
    let baseHue = 0.08 + rbi * 0.17 + t * 0.05;
    let phase = t * (0.34 + rbi * 0.09);

    beginShape();
    for (let i = 0; i <= 240; i++) {
      let u = map(i, 0, 240, 0, TWO_PI * 2.0);
      let radius = 260 + 34 * sin(3.0 * u + phase + rbi * 1.9);

      let x = radius * cos(u + rbi * 0.9);
      let y = 80 * sin(2.0 * u + phase * 1.2 + rbi);
      let z = radius * sin(u + rbi * 0.9) * 0.72;

      let c = palColor(baseHue + i / 240 * 0.22);
      strokeWeight(1.2 + 0.9 * pulse);
      stroke(c[0], c[1], c[2], 62 + 65 * pulse);
      vertex(x, y, z);
    }
    endShape();
  }
}

function drawStars(pulse) {
  noFill();

  for (let ci = 0; ci < PAL.length; ci++) {
    let c = PAL[ci];
    let twinkle = 0.55 + 0.45 * sin(t * 1.4 + ci * 0.9);

    strokeWeight(1.2 + 0.9 * twinkle);
    stroke(c[0], c[1], c[2], (80 + 80 * pulse) * twinkle);

    beginShape(POINTS);
    for (let i = ci; i < stars.length; i += PAL.length) {
      vertex(stars[i].x, stars[i].y, stars[i].z);
    }
    endShape();
  }
}

function drawHaloRings(pulse) {
  push();
  noFill();

  for (let i = 0; i < 6; i++) {
    let c = palColor(i / 6 + t * 0.04);
    let alpha = 60 + 75 * pulse;

    push();
    rotateX(i * 0.24 + t * 0.11);
    rotateY(i * 0.3 + t * 0.09);

    strokeWeight(1.6 + 0.4 * sin(t * 1.2 + i));
    stroke(c[0], c[1], c[2], alpha);

    beginShape();
    let rr = 155 + i * 38 + 10 * sin(t * 1.3 + i);
    for (let j = 0; j <= 90; j++) {
      let a = map(j, 0, 90, 0, TWO_PI);
      vertex(rr * cos(a), 0, rr * sin(a));
    }
    endShape(CLOSE);

    pop();
  }

  pop();
}

function heartSurface(u, v, scale, depth, pulseAmt) {
  let x2 = 16 * pow(sin(u), 3);
  let y2 = 13 * cos(u) - 5 * cos(2 * u) - 2 * cos(3 * u) - cos(4 * u);

  let swell = 1 + 0.08 * pulseAmt;
  let width = 0.55 + 0.45 * cos(v);

  return {
    x: x2 * width * scale * swell,
    y: -y2 * scale * swell,
    z: x2 * sin(v) * depth * scale * swell,
  };
}

function drawCentralHeart(pulse) {
  push();
  rotateY(t * 0.55);
  rotateX(0.2 * sin(t * 0.7));
  rotateZ(0.14 * sin(t * 0.4));

  let uSteps = 92;
  let vSteps = 30;

  noStroke();
  for (let iv = 0; iv < vSteps; iv++) {
    let v1 = map(iv, 0, vSteps, -PI, PI);
    let v2 = map(iv + 1, 0, vSteps, -PI, PI);

    let c = palColor(0.08 + iv / vSteps * 0.24 + 0.05 * sin(t * 0.7));
    specularMaterial(c[0], c[1], c[2]);
    shininess(56 + 30 * pulse);

    beginShape(TRIANGLE_STRIP);
    for (let iu = 0; iu <= uSteps; iu++) {
      let u = map(iu, 0, uSteps, 0, TWO_PI);
      let p1 = heartSurface(u, v1, 9.8, 0.16, pulse);
      let p2 = heartSurface(u, v2, 9.8, 0.16, pulse);
      vertex(p1.x, p1.y, p1.z);
      vertex(p2.x, p2.y, p2.z);
    }
    endShape();
  }

  noFill();
  for (let layer = 0; layer < 3; layer++) {
    let shellScale = 11.0 + layer * 0.72 + 0.24 * sin(t * 1.1 + layer * 0.8);
    for (let ring = 0; ring < 6; ring++) {
      let vv = map(ring, 0, 5, -PI * 0.75, PI * 0.75);
      let c = palColor(0.02 + layer * 0.08 + ring * 0.03 + t * 0.05);
      strokeWeight(0.9 + 0.2 * layer);
      stroke(c[0], c[1], c[2], 34 + 24 * pulse - layer * 6);

      beginShape();
      for (let i = 0; i <= 120; i++) {
        let u = map(i, 0, 120, 0, TWO_PI);
        let p = heartSurface(u, vv, shellScale, 0.2, pulse);
        vertex(p.x, p.y, p.z);
      }
      endShape(CLOSE);
    }
  }

  noFill();
  for (let k = 0; k < 4; k++) {
    let v = map(k, 0, 3, -PI * 0.78, PI * 0.78);
    let c = palColor(0.03 + k * 0.08 + t * 0.05);

    strokeWeight(2.4 - k * 0.38);
    stroke(c[0], c[1], c[2], 130 + 80 * pulse);

    beginShape();
    for (let i = 0; i <= 120; i++) {
      let u = map(i, 0, 120, 0, TWO_PI);
      let p = heartSurface(u, v, 10.4, 0.17, pulse);
      vertex(p.x, p.y, p.z);
    }
    endShape(CLOSE);
  }

  noStroke();
  for (let i = 0; i < 8; i++) {
    let ang = i * 0.8 + t * 0.9;
    let yy = -120 + i * 32;
    let rr = 12 + 20 * sin(t * 1.6 + i * 1.2);
    push();
    translate(rr * cos(ang), yy, rr * sin(ang));
    emissiveMaterial(255, 228, 238);
    sphere(2.2 + 1.4 * pulse, 7, 5);
    pop();
  }

  pop();
}

function drawMiniHeart(scaleVal, colorRGB, pulse) {
  let uSteps = 30;
  let vSteps = 12;

  noStroke();
  for (let iv = 0; iv < vSteps; iv++) {
    let v1 = map(iv, 0, vSteps, -PI, PI);
    let v2 = map(iv + 1, 0, vSteps, -PI, PI);
    let shade = map(iv, 0, vSteps - 1, 0.9, 1.15);

    ambientMaterial(colorRGB[0] * shade, colorRGB[1] * shade, colorRGB[2] * shade);

    beginShape(TRIANGLE_STRIP);
    for (let iu = 0; iu <= uSteps; iu++) {
      let u = map(iu, 0, uSteps, 0, TWO_PI);
      let p1 = heartSurface(u, v1, scaleVal, 0.18, pulse * 0.5);
      let p2 = heartSurface(u, v2, scaleVal, 0.18, pulse * 0.5);
      vertex(p1.x, p1.y, p1.z);
      vertex(p2.x, p2.y, p2.z);
    }
    endShape();
  }
}

function drawOrbitingHearts(pulse) {
  for (let i = 0; i < orbitHearts.length; i++) {
    let h = orbitHearts[i];
    let a = h.phase + t * h.speed;

    let r = h.radius + 24 * sin(t * 1.4 + h.phase * 2.0);
    let x = r * cos(a);
    let z = r * sin(a);
    let y = h.yOffset + 26 * sin(t * 1.25 + h.phase * 3.0);

    let c = palColor((a / TWO_PI + t * 0.08) % 1.0);

    push();
    translate(x, y, z);
    rotateY(-a + HALF_PI);
    rotateZ(h.tilt + 0.34 * sin(t + h.phase));
    drawMiniHeart(h.scale, c, pulse);
    pop();
  }
}

function drawOrbitTrails(pulse) {
  noFill();
  for (let i = 0; i < orbitHearts.length; i++) {
    let h = orbitHearts[i];
    let c = palColor((h.phase / TWO_PI + t * 0.08) % 1.0);

    strokeWeight(1.0 + 0.3 * pulse);
    stroke(c[0], c[1], c[2], 30 + 55 * pulse);

    beginShape();
    for (let k = 0; k <= 46; k++) {
      let aa = h.phase + (t - k * 0.03) * h.speed;
      let rr = h.radius + 24 * sin((t - k * 0.03) * 1.4 + h.phase * 2.0);
      let x = rr * cos(aa);
      let z = rr * sin(aa);
      let y = h.yOffset + 26 * sin((t - k * 0.03) * 1.25 + h.phase * 3.0);
      vertex(x, y, z);
    }
    endShape();
  }
}

function drawPetalSpiral(pulse) {
  noStroke();

  for (let i = 0; i < petals.length; i++) {
    let p = petals[i];

    let a = p.baseAngle + t * p.spin;
    let r = p.radius + 22 * sin(t * 1.15 + p.seed * 8.0);

    let x = r * cos(a);
    let z = r * sin(a);
    let y = p.yBase + 44 * sin(t * 0.86 + p.seed * 6.0);

    let c = palColor(0.1 + 0.32 * p.seed + 0.05 * sin(t * 0.9 + p.seed));

    push();
    translate(x, y, z);
    rotateY(a + HALF_PI);
    rotateZ(0.8 * sin(t * 1.7 + p.seed * 4.0));
    ambientMaterial(c[0], c[1] * 0.75, c[2] * 0.82);
    sphere(4.5 + 2.2 * pulse, 8, 6);
    pop();
  }
}

function drawCupidArrow(pulse) {
  push();
  rotateY(-0.42 + 0.08 * sin(t * 0.7));
  rotateZ(-0.18 + 0.05 * sin(t * 0.9));
  translate(0, 20 * sin(t * 0.8), 0);

  strokeWeight(3.2 + 0.6 * pulse);
  stroke(255, 214, 170, 220);
  beginShape(LINES);
  vertex(0, -150, 0);
  vertex(0, 165, 0);
  endShape();

  noStroke();
  fill(255, 120, 120, 210);
  beginShape(TRIANGLES);
  vertex(0, -175, 0);
  vertex(-10, -150, -6);
  vertex(10, -150, -6);

  vertex(0, -175, 0);
  vertex(10, -150, 6);
  vertex(-10, -150, 6);
  endShape();

  fill(255, 236, 206, 210);
  beginShape(TRIANGLES);
  vertex(0, 185, 0);
  vertex(-8, 164, -5);
  vertex(8, 164, -5);

  vertex(0, 185, 0);
  vertex(8, 164, 5);
  vertex(-8, 164, 5);
  endShape();

  stroke(255, 230, 200, 190);
  strokeWeight(2.2);
  noFill();

  for (let side of [-1, 1]) {
    beginShape();
    vertex(0, 146, 0);
    vertex(20 * side, 180, -4);
    vertex(10 * side, 190, -1);
    vertex(0, 170, 0);
    endShape();
  }

  pop();
}

function drawSparkCore(pulse) {
  noStroke();
  let count = 110;

  for (let i = 0; i < count; i++) {
    let a = i * 0.42 + t * 1.1;
    let h = map(i, 0, count - 1, -140, 140);
    let r = 36 + 24 * sin(t * 1.8 + i * 0.37);

    let c = palColor(0.1 + i / count * 0.5 + t * 0.2);

    push();
    translate(r * cos(a), h, r * sin(a));
    ambientMaterial(c[0], c[1], c[2]);
    sphere(2.2 + 1.7 * pulse, 8, 6);
    pop();
  }
}

// Recording (WebCodecs + mp4-muxer)
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
    width: W,
    height: H,
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
  a.download = 'valentine_3d_bloom.mp4';
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

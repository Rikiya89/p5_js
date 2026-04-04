/*
 *  Living Mirror — Webcam Generative Art
 *  Move your body to paint with particles of light.
 *
 *  Controls:
 *    1-0      Switch visual mode (0 = mode 10)
 *    C        Clear the canvas
 *    M        Toggle mirror mode
 *    Space    Pause / resume
 *    Mouse    Attract or repel particles (click to toggle)
 */

// ─── Config ──────────────────────────────────────────────
const W = 1920;
const H = 1080;
const CAM_W = 320;
const CAM_H = 240;
const GRID = 8;                // sampling grid size for motion detection
const MOTION_THRESHOLD = 30;   // pixel diff threshold to count as motion
const MAX_PARTICLES = 4000;
const PARTICLE_LIFE = 120;     // frames

// ─── State ───────────────────────────────────────────────
let cam;
let prevFrame;
let particles = [];
let mode = 1;
let mirrored = true;
let paused = false;
let mouseAttracts = true;
let started = false;
let modeLabelTimer = 0;

// Matrix rain state (mode 9)
let rainDrops = [];
let rainInitialized = false;

// ASCII character ramp — sparse to dense
const ASCII_RAMP = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

const MODE_NAMES = [
  '',
  'PARTICLE FLOW',
  'CONSTELLATION',
  'PIXEL MOSAIC',
  'PAINT STROKES',
  'LIGHT TRAILS',
  'ASCII MIRROR',
  'ASCII MOTION',
  'ASCII WAVE',
  'ASCII RAIN',
  'ASCII VORTEX'
];

// ─── p5 Setup ────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  cnv.parent(document.body);
  colorMode(RGB, 255, 255, 255, 255);
  background(0);
  prevFrame = createImage(CAM_W, CAM_H);
  prevFrame.loadPixels();
  for (let i = 0; i < prevFrame.pixels.length; i++) prevFrame.pixels[i] = 0;
  prevFrame.updatePixels();
}

function beginExperience() {
  cam = createCapture(VIDEO, { flipped: mirrored });
  cam.size(CAM_W, CAM_H);
  cam.hide();
  started = true;
  document.getElementById('overlay').classList.add('hidden');
  document.getElementById('hud').classList.add('visible');
  showModeLabel(MODE_NAMES[mode]);
}
window.beginExperience = beginExperience;

// ─── p5 Draw Loop ────────────────────────────────────────
function draw() {
  if (!started || !cam || !cam.loadedmetadata) return;
  if (paused) return;

  cam.loadPixels();
  prevFrame.loadPixels();
  if (cam.pixels.length === 0) return;

  // ─── ASCII modes render full-frame, skip particle logic ──
  if (mode >= 6) {
    background(0);
    const motionPoints = (mode === 7) ? detectMotion() : [];
    if (mode === 6 || mode === 7) drawAscii(motionPoints);
    if (mode === 8) drawAsciiWave();
    if (mode === 9) drawAsciiRain();
    if (mode === 10) drawAsciiVortex();
    prevFrame.copy(cam, 0, 0, CAM_W, CAM_H, 0, 0, CAM_W, CAM_H);
    prevFrame.loadPixels();
    drawInfo();
    return;
  }

  // Fade background for trail effect
  noStroke();
  fill(0, 0, 0, mode === 5 ? 8 : 25);
  rect(0, 0, W, H);

  // ─── Motion Detection ─────────────────────────────────
  const motionPoints = detectMotion();

  // ─── Spawn Particles from Motion ──────────────────────
  for (const mp of motionPoints) {
    if (particles.length >= MAX_PARTICLES) break;
    const col = sampleColor(mp.x, mp.y);
    particles.push(new Particle(
      map(mp.x, 0, CAM_W, 0, W),
      map(mp.y, 0, CAM_H, 0, H),
      col,
      mp.intensity
    ));
  }

  // ─── Update & Draw Particles ──────────────────────────
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.update();
    if (p.isDead()) {
      particles.splice(i, 1);
    } else {
      p.display();
    }
  }

  // ─── Mode-specific overlays ───────────────────────────
  if (mode === 2) drawConstellation();
  if (mode === 3) drawMosaic();

  // ─── Store current frame as previous ──────────────────
  prevFrame.copy(cam, 0, 0, CAM_W, CAM_H, 0, 0, CAM_W, CAM_H);
  prevFrame.loadPixels();

  // ─── HUD info ─────────────────────────────────────────
  drawInfo();
}

// ─── Motion Detection ────────────────────────────────────
function detectMotion() {
  const points = [];
  for (let y = 0; y < CAM_H; y += GRID) {
    for (let x = 0; x < CAM_W; x += GRID) {
      const i = (y * CAM_W + x) * 4;
      const r = cam.pixels[i];
      const g = cam.pixels[i + 1];
      const b = cam.pixels[i + 2];
      const pr = prevFrame.pixels[i];
      const pg = prevFrame.pixels[i + 1];
      const pb = prevFrame.pixels[i + 2];

      const diff = abs(r - pr) + abs(g - pg) + abs(b - pb);
      if (diff > MOTION_THRESHOLD) {
        points.push({ x, y, intensity: diff });
      }
    }
  }
  return points;
}

// ─── Sample Color from Webcam ────────────────────────────
function sampleColor(cx, cy) {
  const i = (cy * CAM_W + cx) * 4;
  const r = cam.pixels[i];
  const g = cam.pixels[i + 1];
  const b = cam.pixels[i + 2];
  return { r, g, b };
}

// ─── Particle Class ──────────────────────────────────────
class Particle {
  constructor(x, y, col, intensity) {
    this.x = x;
    this.y = y;
    this.col = col;
    this.intensity = intensity;
    this.life = PARTICLE_LIFE + random(-20, 20);
    this.maxLife = this.life;
    this.size = map(intensity, MOTION_THRESHOLD, 765, 2, 14);
    this.vx = random(-1, 1);
    this.vy = random(-1, 1);
    this.angle = random(TAU);
    this.noiseOff = random(1000);
  }

  update() {
    this.life--;

    // Noise-driven organic movement
    const n = noise(this.x * 0.003, this.y * 0.003, frameCount * 0.008 + this.noiseOff);
    const noiseAngle = n * TAU * 2;

    if (mode === 1) {
      // Particle flow — smooth noise-driven
      this.vx += cos(noiseAngle) * 0.3;
      this.vy += sin(noiseAngle) * 0.3;
    } else if (mode === 4) {
      // Paint strokes — directional
      this.vx += cos(noiseAngle) * 0.5;
      this.vy += sin(noiseAngle) * 0.15;
    } else if (mode === 5) {
      // Light trails — spiraling
      this.angle += 0.03;
      this.vx += cos(this.angle) * 0.2;
      this.vy += sin(this.angle) * 0.2;
    } else {
      this.vx += cos(noiseAngle) * 0.2;
      this.vy += sin(noiseAngle) * 0.2;
    }

    // Mouse interaction
    const dx = mouseX - this.x;
    const dy = mouseY - this.y;
    const dist = sqrt(dx * dx + dy * dy);
    if (dist < 200 && dist > 1) {
      const force = (mouseAttracts ? 1 : -1) * 2 / dist;
      this.vx += dx * force;
      this.vy += dy * force;
    }

    // Damping
    this.vx *= 0.95;
    this.vy *= 0.95;

    this.x += this.vx;
    this.y += this.vy;

    // Wrap around edges
    if (this.x < 0) this.x = W;
    if (this.x > W) this.x = 0;
    if (this.y < 0) this.y = H;
    if (this.y > H) this.y = 0;
  }

  display() {
    const alpha = map(this.life, 0, this.maxLife, 0, 220);
    const sz = this.size * map(this.life, 0, this.maxLife, 0.3, 1);
    const { r, g, b } = this.col;

    push();
    translate(this.x, this.y);

    if (mode === 1) {
      // Soft glowing circles
      noStroke();
      fill(r, g, b, alpha);
      ellipse(0, 0, sz, sz);
      fill(255, 255, 255, alpha * 0.3);
      ellipse(0, 0, sz * 0.3, sz * 0.3);
    } else if (mode === 2) {
      // Small dots for constellation
      noStroke();
      fill(r, g, b, alpha);
      ellipse(0, 0, sz * 0.6, sz * 0.6);
    } else if (mode === 4) {
      // Paint strokes — elongated shapes
      noStroke();
      fill(r, g, b, alpha * 0.8);
      rotate(atan2(this.vy, this.vx));
      ellipse(0, 0, sz * 2.5, sz * 0.6);
    } else if (mode === 5) {
      // Light trails — bright points
      noStroke();
      fill(r, g, b, alpha);
      ellipse(0, 0, sz * 0.8, sz * 0.8);
      fill(255, 255, 255, alpha * 0.5);
      ellipse(0, 0, sz * 0.2, sz * 0.2);
    } else {
      noStroke();
      fill(r, g, b, alpha);
      ellipse(0, 0, sz, sz);
    }

    pop();
  }

  isDead() {
    return this.life <= 0;
  }
}

// ─── Constellation Mode ──────────────────────────────────
function drawConstellation() {
  const maxDist = 60;
  const maxDistSq = maxDist * maxDist;
  const len = particles.length;
  const step = max(1, floor(len / 500));

  for (let i = 0; i < len; i += step) {
    for (let j = i + step; j < len; j += step) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dSq = dx * dx + dy * dy;
      if (dSq < maxDistSq) {
        const a = map(dSq, 0, maxDistSq, 40, 0);
        stroke(255, 255, 255, a);
        strokeWeight(0.5);
        line(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
      }
    }
  }
}

// ─── Mosaic Mode ─────────────────────────────────────────
function drawMosaic() {
  if (frameCount % 2 !== 0) return;
  const gridStep = 4;
  cam.loadPixels();

  for (let y = 0; y < CAM_H; y += gridStep) {
    for (let x = 0; x < CAM_W; x += gridStep) {
      const i = (y * CAM_W + x) * 4;
      const r = cam.pixels[i];
      const g = cam.pixels[i + 1];
      const b = cam.pixels[i + 2];
      const bright = (r + g + b) / 3;

      const sx = map(x, 0, CAM_W, 0, W);
      const sy = map(y, 0, CAM_H, 0, H);
      const sz = map(bright, 0, 255, 1, 10);

      noStroke();
      fill(r, g, b, 50);
      ellipse(sx, sy, sz, sz);
    }
  }
}

// ─── ASCII Mode (6, 7) ──────────────────────────────────
function drawAscii(motionPoints) {
  const fontSize = 14;
  const charW = fontSize * 0.6;
  const cols = floor(W / charW);
  const rows = floor(H / fontSize);
  const fisheyeRadius = 150;
  const fisheyeRadiusSq = fisheyeRadius * fisheyeRadius;

  // Build a motion lookup set for mode 7
  const motionSet = new Set();
  if (mode === 7) {
    for (const mp of motionPoints) {
      const gc = floor(map(mp.x, 0, CAM_W, 0, cols));
      const gr = floor(map(mp.y, 0, CAM_H, 0, rows));
      // Also mark neighbors for a thicker glow
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          motionSet.add((gr + dy) * cols + (gc + dx));
        }
      }
    }
  }

  textFont('monospace');
  textSize(fontSize);
  textAlign(LEFT, TOP);
  noStroke();

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = floor(col * CAM_W / cols);
      const cy = floor(row * CAM_H / rows);
      const i = (cy * CAM_W + cx) * 4;

      const r = cam.pixels[i];
      const g = cam.pixels[i + 1];
      const b = cam.pixels[i + 2];
      const bright = r * 0.299 + g * 0.587 + b * 0.114;

      const charIdx = floor(bright * (ASCII_RAMP.length - 1) / 255);
      const ch = ASCII_RAMP[charIdx];

      const sx = col * charW;
      const sy = row * fontSize;

      // Mouse fisheye — only compute sqrt when within bounding box
      const dx = mouseX - sx;
      const dy = mouseY - sy;
      const dSq = dx * dx + dy * dy;

      if (dSq < fisheyeRadiusSq) {
        const mouseDist = sqrt(dSq);
        const scale = map(mouseDist, 0, fisheyeRadius, 1.8, 1.0);
        textSize(fontSize * scale);

        if (mode === 7 && motionSet.has(row * cols + col)) {
          fill(r, g, b, 255);
        } else if (mode === 7) {
          fill(0, 255, 100, 200);
        } else {
          fill(bright + 60, bright + 80, bright + 60, 255);
        }
        text(ch, sx, sy);
        textSize(fontSize);
      } else {
        if (mode === 7 && motionSet.has(row * cols + col)) {
          fill(r, g, b, 255);
        } else if (mode === 7) {
          fill(0, bright * 0.6, 0, 180);
        } else {
          fill(bright, bright, bright, 220);
        }
        text(ch, sx, sy);
      }
    }
  }
}

// ─── ASCII Wave Mode (8) ─────────────────────────────────
// Characters undulate like an ocean surface. Mouse = wave epicenter.
function drawAsciiWave() {
  const fontSize = 14;
  const charW = fontSize * 0.6;
  const cols = floor(W / charW);
  const rows = floor(H / fontSize);
  const t = frameCount * 0.04;
  const rampLen = ASCII_RAMP.length - 1;

  const waveCX = mouseX / W;
  const waveCY = mouseY / H;

  push();
  colorMode(HSB, 360, 100, 100, 255);
  textFont('monospace');
  textAlign(LEFT, TOP);
  noStroke();

  for (let row = 0; row < rows; row++) {
    const ny = row / rows;
    const cy = floor(row * CAM_H / rows);
    const wave2 = sin(ny * 10 + t * 1.5) * 5;

    for (let col = 0; col < cols; col++) {
      const cx = floor(col * CAM_W / cols);
      const i = (cy * CAM_W + cx) * 4;

      const bright = cam.pixels[i] * 0.299 + cam.pixels[i + 1] * 0.587 + cam.pixels[i + 2] * 0.114;
      const charIdx = floor(bright * rampLen / 255);

      const nx = col / cols;
      const dnx = nx - waveCX;
      const dny = ny - waveCY;
      const distFromMouse = sqrt(dnx * dnx + dny * dny);

      const wave1 = sin(nx * 12 - t * 2 + distFromMouse * 8) * 8;
      const wave3 = cos(distFromMouse * 15 - t * 3) * (bright / 255) * 12;

      const offsetX = wave1 + wave3 * 0.5;
      const offsetY = wave2 + wave3;

      const hueShift = (wave1 + wave2) * 3.08; // map(-13..13 -> -40..40)
      const hue = ((bright * 0.392 + 200) + hueShift + 360) % 360; // 200-300 range
      fill(hue, 70, bright * 0.314 + 20, 230);

      textSize(fontSize + abs(wave3) * 0.3);
      text(ASCII_RAMP[charIdx], col * charW + offsetX, row * fontSize + offsetY);
    }
  }
  pop();
}

// ─── ASCII Rain Mode (9) — Matrix Digital Rain ──────────
// Falling columns revealing your webcam face in code.
function drawAsciiRain() {
  const fontSize = 16;
  const charW = fontSize * 0.6;
  const cols = floor(W / charW);
  const rows = floor(H / fontSize);
  const rampLen = ASCII_RAMP.length - 1;

  // Initialize rain drops
  if (!rainInitialized || rainDrops.length !== cols) {
    rainDrops = [];
    for (let c = 0; c < cols; c++) {
      rainDrops.push({
        y: random(-rows, 0),
        speed: random(0.3, 1.2),
        length: floor(random(8, 25))
      });
    }
    rainInitialized = true;
  }

  textFont('monospace');
  textSize(fontSize);
  textAlign(LEFT, TOP);
  noStroke();

  // Dim webcam background — draw every other cell for speed
  for (let row = 0; row < rows; row += 2) {
    const cy = floor(row * CAM_H / rows);
    for (let col = 0; col < cols; col += 2) {
      const cx = floor(col * CAM_W / cols);
      const idx = (cy * CAM_W + cx) * 4;
      const bright = cam.pixels[idx] * 0.299 + cam.pixels[idx + 1] * 0.587 + cam.pixels[idx + 2] * 0.114;
      const charIdx = floor(bright * rampLen / 255);
      fill(0, bright * 0.15, 0, 80);
      text(ASCII_RAMP[charIdx], col * charW, row * fontSize);
    }
  }

  // Draw rain columns
  for (let c = 0; c < cols; c++) {
    const drop = rainDrops[c];
    drop.y += drop.speed;

    if (drop.y - drop.length > rows) {
      drop.y = random(-15, -2);
      drop.speed = random(0.3, 1.2);
      drop.length = floor(random(8, 25));
    }

    const cx = floor(c * CAM_W / cols);

    for (let t = 0; t < drop.length; t++) {
      const row = floor(drop.y) - t;
      if (row < 0 || row >= rows) continue;

      const cy = floor(row * CAM_H / rows);
      const idx = (cy * CAM_W + cx) * 4;
      const r = cam.pixels[idx];
      const g = cam.pixels[idx + 1];
      const b = cam.pixels[idx + 2];
      const bright = r * 0.299 + g * 0.587 + b * 0.114;
      const charIdx = floor(bright * rampLen / 255);

      if (t === 0) {
        fill(180, 255, 180, 255);
        textSize(fontSize + 2);
      } else {
        const fade = 1 - t / drop.length;
        fill(lerp(0, r, fade * 0.5), lerp(bright * 0.3, g, fade), lerp(0, b, fade * 0.3), 200 * fade + 55);
        textSize(fontSize);
      }
      text(ASCII_RAMP[charIdx], c * charW, row * fontSize);
    }
  }

  // Mouse spotlight — only check bounding box around mouse
  const spotRadius = 120;
  const colMin = max(0, floor((mouseX - spotRadius) / charW));
  const colMax = min(cols - 1, ceil((mouseX + spotRadius) / charW));
  const rowMin = max(0, floor((mouseY - spotRadius) / fontSize));
  const rowMax = min(rows - 1, ceil((mouseY + spotRadius) / fontSize));
  const spotRadiusSq = spotRadius * spotRadius;
  textSize(fontSize);

  for (let row = rowMin; row <= rowMax; row++) {
    const sy = row * fontSize;
    const dy = mouseY - sy;
    for (let col = colMin; col <= colMax; col++) {
      const sx = col * charW;
      const dx = mouseX - sx;
      const dSq = dx * dx + dy * dy;
      if (dSq < spotRadiusSq) {
        const cx = floor(col * CAM_W / cols);
        const cy = floor(row * CAM_H / rows);
        const idx = (cy * CAM_W + cx) * 4;
        const r = cam.pixels[idx];
        const g = cam.pixels[idx + 1];
        const b = cam.pixels[idx + 2];
        const bright = r * 0.299 + g * 0.587 + b * 0.114;
        const charIdx = floor(bright * rampLen / 255);
        const d = sqrt(dSq);
        fill(r, g, b, map(d, 0, spotRadius, 255, 0));
        text(ASCII_RAMP[charIdx], sx, sy);
      }
    }
  }
}

// ─── ASCII Vortex Mode (10) ─────────────────────────────
// Characters spiral around mouse. Whirlpool / black hole.
function drawAsciiVortex() {
  const fontSize = 14;
  const charW = fontSize * 0.6;
  const cols = floor(W / charW);
  const rows = floor(H / fontSize);
  const t = frameCount * 0.02;
  const rampLen = ASCII_RAMP.length - 1;

  const centerX = mouseX;
  const centerY = mouseY;
  const maxRadius = sqrt(W * W + H * H) * 0.5;
  const invMaxRadius = 1 / maxRadius;
  const fc2 = frameCount * 2;

  push();
  colorMode(HSB, 360, 100, 100, 255);
  textFont('monospace');
  textAlign(CENTER, CENTER);
  noStroke();

  for (let row = 0; row < rows; row++) {
    const oy = row * fontSize;
    const dy = oy - centerY;

    for (let col = 0; col < cols; col++) {
      const ox = col * charW;
      const dx = ox - centerX;
      const d = sqrt(dx * dx + dy * dy);

      // Swirl — stronger near center
      const swirlStrength = (1 - d * invMaxRadius) * 4.0;
      const swirlAngle = swirlStrength * sin(t + d * 0.01) + t;
      const cosA = cos(swirlAngle);
      const sinA = sin(swirlAngle);

      const pull = 0.6 + d * invMaxRadius * 0.4;
      const drawX = centerX + (dx * cosA - dy * sinA) * pull;
      const drawY = centerY + (dx * sinA + dy * cosA) * pull;

      // Skip off-screen
      if (drawX < -20 || drawX > W + 20 || drawY < -20 || drawY > H + 20) continue;

      const cx = floor(col * CAM_W / cols);
      const cy = floor(row * CAM_H / rows);
      const i = (cy * CAM_W + cx) * 4;
      const bright = cam.pixels[i] * 0.299 + cam.pixels[i + 1] * 0.587 + cam.pixels[i + 2] * 0.114;

      const hue = (d * invMaxRadius * 360 + fc2) % 360;
      const sat = d < 200 ? 90 - d * 0.3 : 30;
      fill(hue, sat, bright * 0.333 + 15, 240);

      const sz = d < 200 ? fontSize + (1 - d / 200) * 8 : fontSize;
      textSize(sz);
      text(ASCII_RAMP[floor(bright * rampLen / 255)], drawX, drawY);
    }
  }

  // Bright core
  const coreHue = (frameCount * 3) % 360;
  noStroke();
  fill(coreHue, 50, 100, 40);
  ellipse(centerX, centerY, 30, 30);
  fill(coreHue, 20, 100, 80);
  ellipse(centerX, centerY, 8, 8);
  pop();
}

// ─── Info Overlay ────────────────────────────────────────
function drawInfo() {
  push();
  fill(255, 100);
  noStroke();
  textSize(11);
  textFont('monospace');
  textAlign(RIGHT, TOP);
  text('particles: ' + particles.length, W - 16, 16);
  text('fps: ' + floor(frameRate()), W - 16, 32);
  pop();
}

// ─── Mode Label ──────────────────────────────────────────
function showModeLabel(name) {
  const el = document.getElementById('modeLabel');
  el.textContent = name;
  el.classList.add('show');
  clearTimeout(modeLabelTimer);
  modeLabelTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ─── Keyboard Controls ──────────────────────────────────
function keyPressed() {
  if (!started) return;

  if (key === '1') { mode = 1; showModeLabel(MODE_NAMES[1]); }
  if (key === '2') { mode = 2; showModeLabel(MODE_NAMES[2]); }
  if (key === '3') { mode = 3; showModeLabel(MODE_NAMES[3]); }
  if (key === '4') { mode = 4; showModeLabel(MODE_NAMES[4]); }
  if (key === '5') { mode = 5; showModeLabel(MODE_NAMES[5]); }
  if (key === '6') { mode = 6; showModeLabel(MODE_NAMES[6]); }
  if (key === '7') { mode = 7; showModeLabel(MODE_NAMES[7]); }
  if (key === '8') { mode = 8; showModeLabel(MODE_NAMES[8]); }
  if (key === '9') { mode = 9; rainInitialized = false; showModeLabel(MODE_NAMES[9]); }
  if (key === '0') { mode = 10; showModeLabel(MODE_NAMES[10]); }

  if (key === 'c' || key === 'C') {
    background(0);
    particles = [];
    showModeLabel('CLEARED');
  }

  if (key === 'm' || key === 'M') {
    mirrored = !mirrored;
    if (cam) {
      cam.remove();
      cam = createCapture(VIDEO, { flipped: mirrored });
      cam.size(CAM_W, CAM_H);
      cam.hide();
    }
    showModeLabel(mirrored ? 'MIRRORED' : 'NORMAL');
  }

  if (key === ' ') {
    paused = !paused;
    showModeLabel(paused ? 'PAUSED' : 'RESUMED');
    return false;
  }
}

// ─── Mouse Controls ──────────────────────────────────────
function mousePressed() {
  if (!started) return;
  mouseAttracts = !mouseAttracts;
}

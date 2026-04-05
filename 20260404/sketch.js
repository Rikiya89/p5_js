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

// ─── Neon Palette ────────────────────────────────────────
// Dark tones (backgrounds / dim characters)
const PAL_DARK   = [[0x29,0x30,0x39],[0x28,0x36,0x31],[0x0d,0x1f,0x2d],[0x0a,0x3d,0x2e]];
// Neon accents (active / mid-brightness)
const PAL_NEON   = [[0x00,0xff,0x87],[0x00,0xd4,0xff],[0x7b,0x2f,0xff],[0xff,0x2d,0x7a]];
// Highlights (brightest)
const PAL_LIGHT  = [[0xb0,0xff,0xe8],[0xc4,0xf0,0xff]];

// Map brightness (0-255) to palette color with smooth interpolation
// Uses only Math.* to avoid p5 global-mode edge cases
function getPaletteColor(bright, t) {
  const b = (typeof bright === 'number' && isFinite(bright)) ? bright : 0;
  const nf = Math.max(0, Math.min(b, 255)) / 255;
  const ts = (typeof t === 'number' && isFinite(t)) ? Math.abs(t) : 0;

  if (nf < 0.3) {
    const idx = Math.floor(ts * 1.7) % PAL_DARK.length;
    const d = PAL_DARK[idx] || PAL_DARK[0];
    const f = nf / 0.3;
    return [d[0] * f, d[1] * f, d[2] * f];
  }

  if (nf < 0.75) {
    const f = (nf - 0.3) / 0.45;
    const idx = Math.floor(ts * 2.3) % PAL_NEON.length;
    const idx2 = (idx + 1) % PAL_NEON.length;
    const a = PAL_NEON[idx] || PAL_NEON[0];
    const bCol = PAL_NEON[idx2] || PAL_NEON[0];
    return [
      a[0] + (bCol[0] - a[0]) * f,
      a[1] + (bCol[1] - a[1]) * f,
      a[2] + (bCol[2] - a[2]) * f
    ];
  }

  // Highlight zone
  const f = (nf - 0.75) / 0.25;
  const lIdx = Math.floor(ts * 1.1) % PAL_LIGHT.length;
  const nIdx = Math.floor(ts * 2.3) % PAL_NEON.length;
  const n = PAL_NEON[nIdx] || PAL_NEON[0];
  const l = PAL_LIGHT[lIdx] || PAL_LIGHT[0];
  return [n[0] + (l[0] - n[0]) * f, n[1] + (l[1] - n[1]) * f, n[2] + (l[2] - n[2]) * f];
}

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
  const t = frameCount * 0.015;

  // Build a motion lookup map for mode 7 (stores intensity)
  const motionMap = new Map();
  if (mode === 7) {
    for (const mp of motionPoints) {
      const gc = floor(map(mp.x, 0, CAM_W, 0, cols));
      const gr = floor(map(mp.y, 0, CAM_H, 0, rows));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = (gr + dy) * cols + (gc + dx);
          const prev = motionMap.get(key) || 0;
          motionMap.set(key, max(prev, mp.intensity));
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

      // Palette seed varies by position + time for shimmer
      const palSeed = col * 0.07 + row * 0.05 + t;

      // Mouse fisheye — only compute sqrt when within bounding box
      const dx = mouseX - sx;
      const dy = mouseY - sy;
      const dSq = dx * dx + dy * dy;

      if (dSq < fisheyeRadiusSq) {
        const mouseDist = sqrt(dSq);
        const scale = map(mouseDist, 0, fisheyeRadius, 2.0, 1.0);
        textSize(fontSize * scale);

        if (mode === 7 && motionMap.has(row * cols + col)) {
          // Motion area near mouse — bright neon flash
          const nIdx = floor((frameCount * 0.05 + col * 0.1) % 4);
          const n = PAL_NEON[nIdx];
          const f = map(mouseDist, 0, fisheyeRadius, 1, 0.6);
          fill(n[0] * f, n[1] * f, n[2] * f, 255);
        } else if (mode === 7) {
          // Static area near mouse — soft neon glow
          const c = getPaletteColor(bright * 1.3, palSeed);
          fill(c[0], c[1], c[2], 230);
        } else {
          // Mode 6 fisheye — neon palette with extra brightness
          const c = getPaletteColor(min(255, bright + 60), palSeed);
          fill(c[0], c[1], c[2], 255);
        }
        text(ch, sx, sy);
        textSize(fontSize);
      } else {
        if (mode === 7 && motionMap.has(row * cols + col)) {
          // Motion area — cycling neon colors
          const intensity = motionMap.get(row * cols + col);
          const nIdx = floor((t * 4 + col * 0.08 + row * 0.06) % 4);
          const n = PAL_NEON[nIdx];
          const f = map(intensity, MOTION_THRESHOLD, 765, 0.5, 1.0);
          fill(n[0] * f, n[1] * f, n[2] * f, 240);
        } else if (mode === 7) {
          // Static area — dark palette tones
          const dIdx = floor((col * 0.03 + row * 0.05) % PAL_DARK.length);
          const d = PAL_DARK[dIdx];
          const f = bright / 255;
          fill(d[0] * f * 1.5, d[1] * f * 1.5, d[2] * f * 1.5, 180);
        } else {
          // Mode 6 — full palette coloring
          const c = getPaletteColor(bright, palSeed);
          fill(c[0], c[1], c[2], 220);
        }
        text(ch, sx, sy);
      }
    }
  }
}

// ─── ASCII Wave Mode (8) ─────────────────────────────────
// Characters undulate like an ocean surface. Mouse = wave epicenter.
// Neon palette waves with depth layering.
function drawAsciiWave() {
  const fontSize = 14;
  const charW = fontSize * 0.6;
  const cols = floor(W / charW);
  const rows = floor(H / fontSize);
  const t = frameCount * 0.04;
  const rampLen = ASCII_RAMP.length - 1;

  const waveCX = mouseX / W;
  const waveCY = mouseY / H;

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

      // Wave-driven neon coloring
      const waveEnergy = (wave1 + wave3) / 20 + 0.5; // 0-1 normalized
      const palSeed = nx * 3 + ny * 2 + t * 0.3 + waveEnergy * 2;

      // Blend palette color with wave energy boosting brightness
      const boosted = min(255, bright + waveEnergy * 80);
      const c = getPaletteColor(boosted, palSeed);

      // Wave peaks get extra glow — blend toward highlight colors
      if (waveEnergy > 0.7) {
        const glowF = (waveEnergy - 0.7) / 0.3;
        const lIdx = floor(palSeed) % PAL_LIGHT.length;
        const l = PAL_LIGHT[lIdx];
        fill(lerp(c[0], l[0], glowF * 0.6), lerp(c[1], l[1], glowF * 0.6), lerp(c[2], l[2], glowF * 0.6), 240);
      } else {
        fill(c[0], c[1], c[2], 220);
      }

      textSize(fontSize + abs(wave3) * 0.3);
      text(ASCII_RAMP[charIdx], col * charW + offsetX, row * fontSize + offsetY);
    }
  }
}

// ─── ASCII Rain Mode (9) — Neon Digital Rain ────────────
// Multi-color neon rain columns revealing your webcam face.
function drawAsciiRain() {
  const fontSize = 16;
  const charW = fontSize * 0.6;
  const cols = floor(W / charW);
  const rows = floor(H / fontSize);
  const rampLen = ASCII_RAMP.length - 1;

  // Initialize rain drops — each column gets a neon color index
  if (!rainInitialized || rainDrops.length !== cols) {
    rainDrops = [];
    for (let c = 0; c < cols; c++) {
      rainDrops.push({
        y: random(-rows, 0),
        speed: random(0.3, 1.2),
        length: floor(random(8, 25)),
        colorIdx: floor(random(4))  // which PAL_NEON color
      });
    }
    rainInitialized = true;
  }

  textFont('monospace');
  textSize(fontSize);
  textAlign(LEFT, TOP);
  noStroke();

  // Dim webcam background — dark palette tint instead of pure green
  for (let row = 0; row < rows; row += 2) {
    const cy = floor(row * CAM_H / rows);
    for (let col = 0; col < cols; col += 2) {
      const cx = floor(col * CAM_W / cols);
      const idx = (cy * CAM_W + cx) * 4;
      const bright = cam.pixels[idx] * 0.299 + cam.pixels[idx + 1] * 0.587 + cam.pixels[idx + 2] * 0.114;
      const charIdx = floor(bright * rampLen / 255);
      const dIdx = (col + row) % PAL_DARK.length;
      const d = PAL_DARK[dIdx];
      const f = bright / 255 * 0.3;
      fill(d[0] * f, d[1] * f, d[2] * f, 90);
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
      drop.colorIdx = floor(random(4));  // re-roll color on reset
    }

    const cx = floor(c * CAM_W / cols);
    const neonCol = PAL_NEON[drop.colorIdx];

    for (let ti = 0; ti < drop.length; ti++) {
      const row = floor(drop.y) - ti;
      if (row < 0 || row >= rows) continue;

      const cy = floor(row * CAM_H / rows);
      const idx = (cy * CAM_W + cx) * 4;
      const r = cam.pixels[idx];
      const g = cam.pixels[idx + 1];
      const b = cam.pixels[idx + 2];
      const bright = r * 0.299 + g * 0.587 + b * 0.114;
      const charIdx = floor(bright * rampLen / 255);

      if (ti === 0) {
        // Head of rain — use highlight colors (bright white-ish neon)
        const lIdx = drop.colorIdx % PAL_LIGHT.length;
        const l = PAL_LIGHT[lIdx];
        fill(l[0], l[1], l[2], 255);
        textSize(fontSize + 2);
      } else {
        // Trail — fade from neon to dark, blended with webcam
        const fade = 1 - ti / drop.length;
        fill(
          lerp(neonCol[0] * 0.15, lerp(neonCol[0], r, 0.4), fade),
          lerp(neonCol[1] * 0.15, lerp(neonCol[1], g, 0.4), fade),
          lerp(neonCol[2] * 0.15, lerp(neonCol[2], b, 0.4), fade),
          200 * fade + 55
        );
        textSize(fontSize);
      }
      text(ASCII_RAMP[charIdx], c * charW, row * fontSize);
    }
  }

  // Mouse spotlight — reveals webcam in full neon palette
  const spotRadius = 140;
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
        const palSeed = col * 0.05 + row * 0.03 + frameCount * 0.02;
        const c = getPaletteColor(bright, palSeed);
        const a = map(d, 0, spotRadius, 255, 0);
        fill(c[0], c[1], c[2], a);
        text(ASCII_RAMP[charIdx], sx, sy);
      }
    }
  }
}

// ─── ASCII Vortex Mode (10) ─────────────────────────────
// Characters spiral around mouse with neon palette coloring.
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

      // Spiral arm coloring — distance + angle determines neon color
      const angle = atan2(dy, dx);
      const spiralPhase = (angle + d * 0.015 + t * 2) / TAU;
      const nIdx = floor(((spiralPhase % 1 + 1) % 1) * 4) % 4;
      const neon = PAL_NEON[nIdx];

      const nf = d * invMaxRadius; // 0 at center, 1 at edge

      if (d < 180) {
        // Inner vortex — bright neon blended with webcam brightness
        const f = bright / 255;
        const innerBlend = 1 - d / 180;
        // Near core: pure neon. Further out: blend with dark
        fill(
          neon[0] * f * (0.5 + innerBlend * 0.5),
          neon[1] * f * (0.5 + innerBlend * 0.5),
          neon[2] * f * (0.5 + innerBlend * 0.5),
          240
        );
      } else {
        // Outer region — palette-based coloring
        const palSeed = spiralPhase * 4 + t * 0.5;
        const c = getPaletteColor(bright, palSeed);
        fill(c[0], c[1], c[2], map(nf, 0.15, 1, 240, 160));
      }

      const sz = d < 200 ? fontSize + (1 - d / 200) * 8 : fontSize;
      textSize(sz);
      text(ASCII_RAMP[floor(bright * rampLen / 255)], drawX, drawY);
    }
  }

  // Hot pink core with layered glow
  noStroke();
  // Outer glow — purple
  fill(0x7b, 0x2f, 0xff, 25);
  ellipse(centerX, centerY, 60, 60);
  // Mid glow — hot pink
  fill(0xff, 0x2d, 0x7a, 40);
  ellipse(centerX, centerY, 30, 30);
  // Bright core — mint highlight
  fill(0xb0, 0xff, 0xe8, 120);
  ellipse(centerX, centerY, 8, 8);
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

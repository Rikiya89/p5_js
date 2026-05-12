'use strict';

// -----------------------------------------------------------------------------
// TOKYO SIGNAL BLOOM — COLOR SIGNAGE VERSION / CENTER-CONTROLLED
// p5.js / 1920x1080 / 30s / 29.97fps / 30Mbps target
// Theme: MADE FOR THIS CITY — Art that belongs here -TOKYO-.
// -----------------------------------------------------------------------------

const W = 1920;
const H = 1080;

// Submission spec
const FPS = 30000 / 1001; // 29.97fps
const LOOP_SECONDS = 30;
const LOOP_FRAMES = Math.round(FPS * LOOP_SECONDS); // 899 frames
const VIDEO_BITRATE = 30000000; // 30Mbps target
const VIDEO_FILENAME = 'tokyo_signal_bloom_color_1920x1080_30s_29.97fps_30mbps.mp4';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Right-side official logo area.
const SAFE_ZONE_RATIO = 0.22;
const SAFE_ZONE_W = W * SAFE_ZONE_RATIO;
const SAFE_ZONE_X = W - SAFE_ZONE_W;

// Main composition shifted left.
const CX = W * 0.37;
const CY = H * 0.52;

// Outdoor signage tuning.
const SIGNAGE_BRIGHTNESS = 1.28;
const LINE_BOOST = 2.15;
const DOT_BOOST = 1.85;
const CENTER_SUPPRESSION_RADIUS = 185;
const CENTER_SUPPRESSION_STRENGTH = 0.62;

const ROUTE_COUNT = 12;
const PARTICLE_COUNT = 560;
const SEED_COUNT = 460;
const NODE_COUNT = 68;
const RING_COUNT = 6;
const RAIN_COUNT = 70;
const GLYPH_COUNT = 26;

// High-visibility Tokyo signage palette.
const BG = [3, 5, 10];
const INK = [245, 248, 255];
const CYAN = [0, 212, 255];
const BLUE = [81, 106, 212];
const VIOLET = [145, 108, 204];
const MAGENTA = [255, 45, 122];
const WARM = [255, 168, 78];
const GREEN = [0, 255, 135];

const PALETTE = [CYAN, BLUE, VIOLET, MAGENTA, WARM, GREEN, INK];

let routes = [];
let particles = [];
let seeds = [];
let nodes = [];
let rain = [];
let glyphs = [];
let trail;
let canvasEl;

let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;
let captureInProgress = false;

function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;

  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  smooth();

  trail = createGraphics(W, H);
  trail.pixelDensity(1);
  trail.clear();

  randomSeed(369);
  noiseSeed(369);

  initSystem();
  setupCaptureUI();
}

function draw() {
  const currentFrame = isRecording ? recFrameCount : frameCount;
  const loop = (currentFrame % LOOP_FRAMES) / LOOP_FRAMES;
  const t = loop * TAU;

  const opening = smoothstep(0.00, 0.20, loop);
  const organize = smoothstep(0.16, 0.68, loop);
  const bloom = smoothstep(0.36, 0.90, loop);
  const finale = smoothstep(0.76, 1.00, loop);

  background(BG[0], BG[1], BG[2]);

  drawColorWash(t, opening, bloom);
  drawTrail();
  drawSubtleVignette();
  drawSignageAnchor(t, opening, bloom, finale);
  drawRainField(t, opening);
  drawDistantGrid(t, opening, organize);
  drawTokyoRoutes(t, opening, organize);
  drawCrossingSignals(t, opening, organize);
  drawMovingParticles(t, opening, organize, bloom);
  drawSignalGarden(t, opening, organize, bloom, finale);
  drawCityConstellation(t, opening, organize, bloom);
  drawFloatingGlyphs(t, opening, bloom);
  drawLogoSafeZone(t);
  drawScreenTexture(t);

  if (isRecording && !captureInProgress) {
    captureInProgress = true;

    captureFrame().then(() => {
      recFrameCount++;
      captureInProgress = false;

      if (recFrameCount >= LOOP_FRAMES) {
        stopRecording();
      }
    });
  }
}

// -----------------------------------------------------------------------------
// Setup data
// -----------------------------------------------------------------------------
function initSystem() {
  routes = [];
  particles = [];
  seeds = [];
  nodes = [];
  rain = [];
  glyphs = [];

  for (let i = 0; i < ROUTE_COUNT; i++) {
    const k = i / max(1, ROUTE_COUNT - 1);
    const y = lerp(H * 0.20, H * 0.82, k) + random(-20, 20);

    routes.push({
      y,
      amp: random(28, 78),
      freq: random([1, 2, 3]),
      phase: random(TAU),
      speed: random(0.08, 0.20),
      weight: random(1.1, 2.0),
      drift: random(-28, 28),
      colorIndex: i % PALETTE.length,
    });
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      route: floor(random(ROUTE_COUNT)),
      k: random(1),
      phase: random(TAU),
      speed: random(0.014, 0.055),
      size: random(1.5, 5.2),
      orbit: random(0.75, 1.22),
      alpha: random(0.72, 1.0),
      colorIndex: floor(random(PALETTE.length)),
    });
  }

  for (let i = 0; i < SEED_COUNT; i++) {
    const a = i * GOLDEN_ANGLE;
    const r = 8.5 * sqrt(i);

    seeds.push({
      a,
      r,
      phase: random(TAU),
      size: random(1.3, 4.2),
      layer: random(0.88, 1.14),
      colorIndex: i % PALETTE.length,
    });
  }

  for (let i = 0; i < NODE_COUNT; i++) {
    const a = i * GOLDEN_ANGLE;
    const r = 120 + 430 * sqrt(i / NODE_COUNT);

    nodes.push({
      a,
      r,
      x: CX + cos(a) * r * random(0.68, 1.04),
      y: CY + sin(a) * r * random(0.42, 0.72),
      phase: random(TAU),
      size: random(2.8, 6.5),
      linkOffset: floor(random(9, 21)),
      colorIndex: i % PALETTE.length,
    });
  }

  for (let i = 0; i < RAIN_COUNT; i++) {
    rain.push({
      x: random(60, SAFE_ZONE_X - 120),
      y: random(-H, H),
      len: random(24, 110),
      speed: random(0.28, 1.25),
      phase: random(TAU),
      alpha: random(8, 28),
      colorIndex: floor(random(PALETTE.length)),
    });
  }

  for (let i = 0; i < GLYPH_COUNT; i++) {
    const a = i * GOLDEN_ANGLE;
    const r = random(200, 620);

    glyphs.push({
      x: CX + cos(a) * r * random(0.78, 1.06),
      y: CY + sin(a) * r * random(0.50, 0.76),
      phase: random(TAU),
      size: random(18, 42),
      type: floor(random(4)),
      colorIndex: i % PALETTE.length,
    });
  }
}

// -----------------------------------------------------------------------------
// Base layers
// -----------------------------------------------------------------------------
function drawColorWash(t, opening, bloom) {
  noStroke();
  blendMode(ADD);

  const a1 = 14 * opening * (0.5 + bloom * 0.7);
  const a2 = 9 * opening * (0.35 + bloom * 0.55);

  radialGlow(CX - 130, CY, 880, CYAN, a1);
  radialGlow(CX + 80, CY + 10, 720, MAGENTA, a2);
  radialGlow(CX - 30, CY - 70, 580, VIOLET, a2);

  blendMode(BLEND);
}

function drawTrail() {
  image(trail, 0, 0);

  trail.noStroke();
  trail.fill(BG[0], BG[1], BG[2], 40);
  trail.rect(0, 0, W, H);
}

function drawSubtleVignette() {
  noFill();

  for (let i = 0; i < 70; i++) {
    const a = map(i, 0, 69, 10, 0);
    stroke(0, 0, 0, a);
    strokeWeight(12);
    rect(i * 4, i * 3, W - i * 8, H - i * 6);
  }
}

// -----------------------------------------------------------------------------
// Large readable anchor
// -----------------------------------------------------------------------------
function drawSignageAnchor(t, opening, bloom, finale) {
  push();
  translate(CX, CY);
  blendMode(ADD);
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  const coreAlpha = (70 + 70 * bloom + 38 * finale) * opening * SIGNAGE_BRIGHTNESS;

  for (let i = 0; i < 10; i++) {
    const k = i / 9;
    const r = 130 + k * 430;
    const c = lerpPalette(k + t * 0.035);
    const alpha = 24 * opening * SIGNAGE_BRIGHTNESS * (1 - k * 0.72);

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(10 - k * 7.2);
    ellipse(0, 0, r * 2.0, r * 1.18);
  }

  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + t * 0.035;
    const inner = 82 + 12 * sin(t * 1.4 + i);
    const outer = 520 + 26 * sin(t * 0.8 + i * 0.7);
    const c = PALETTE[i % PALETTE.length];

    stroke(c[0], c[1], c[2], coreAlpha * 0.78);
    strokeWeight(3.4);

    line(
      cos(a) * inner,
      sin(a) * inner * 0.6,
      cos(a) * outer,
      sin(a) * outer * 0.6
    );
  }

  for (let layer = 0; layer < 3; layer++) {
    const rr = 150 + layer * 130;
    const c = [INK, CYAN, MAGENTA][layer];
    const alpha = (82 - layer * 16) * opening * SIGNAGE_BRIGHTNESS;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(4.8 - layer * 1.1);

    beginShape();
    for (let i = 0; i <= 360; i++) {
      const a = (i / 360) * TAU;
      const mod = 1 + 0.11 * cos(8 * a - t * 0.9 + layer);
      vertex(cos(a) * rr * mod, sin(a) * rr * 0.6 * mod);
    }
    endShape(CLOSE);
  }

  blendMode(BLEND);
  pop();
}

// -----------------------------------------------------------------------------
// Tokyo information layers
// -----------------------------------------------------------------------------
function drawRainField(t, opening) {
  blendMode(ADD);
  strokeCap(ROUND);

  for (let i = 0; i < rain.length; i++) {
    const r = rain[i];
    const c = PALETTE[r.colorIndex];
    const yy = (r.y + t * 85 * r.speed) % (H + 160) - 80;
    const wave = sin(t * 1.3 + r.phase) * 10;

    stroke(c[0], c[1], c[2], r.alpha * opening * 0.65);
    strokeWeight(1.15);
    line(r.x + wave, yy, r.x + wave * 0.2, yy + r.len);
  }

  blendMode(BLEND);
}

function drawDistantGrid(t, opening, organize) {
  blendMode(ADD);
  noFill();

  const horizonY = H * 0.52;
  const alpha = 6 * opening * (1 - organize * 0.55);

  stroke(CYAN[0], CYAN[1], CYAN[2], alpha);
  strokeWeight(1.0);

  for (let i = 0; i < 18; i++) {
    const k = i / 17;
    const y = lerp(H * 0.10, H * 0.92, k);
    const bend = sin(t * 0.25 + k * TAU) * 10;
    line(80, y + bend, SAFE_ZONE_X - 140, y - bend * 0.5);
  }

  stroke(VIOLET[0], VIOLET[1], VIOLET[2], alpha);

  for (let i = 0; i < 20; i++) {
    const k = i / 19;
    const x = lerp(80, SAFE_ZONE_X - 140, k);
    const sway = sin(t * 0.18 + k * 5.0) * 14;
    line(x + sway, H * 0.10, lerp(CX, x, 0.5), horizonY);
    line(lerp(CX, x, 0.5), horizonY, x - sway * 0.4, H * 0.92);
  }

  blendMode(BLEND);
}

function drawTokyoRoutes(t, opening, organize) {
  blendMode(ADD);
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  for (let r = 0; r < routes.length; r++) {
    const route = routes[r];
    const c = PALETTE[route.colorIndex];
    const pulse = 0.55 + 0.45 * sin(t * 0.65 + route.phase);
    const alpha = (36 + 70 * pulse) * opening * (1 - organize * 0.08) * SIGNAGE_BRIGHTNESS;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(route.weight * LINE_BOOST);

    beginShape();
    for (let i = 0; i <= 240; i++) {
      const k = i / 240;
      const x = lerp(90, SAFE_ZONE_X - 135, k);
      const y =
        route.y +
        sin(k * TAU * route.freq + route.phase + t * route.speed) * route.amp +
        sin(k * PI + t * 0.35) * route.drift;

      vertex(x, y);
    }
    endShape();
  }

  blendMode(BLEND);
}

function drawCrossingSignals(t, opening, organize) {
  blendMode(ADD);
  strokeCap(ROUND);

  const a = opening * (1 - organize * 0.25);
  const left = 130;
  const right = SAFE_ZONE_X - 205;
  const top = H * 0.20;
  const bottom = H * 0.82;

  for (let i = 0; i < 9; i++) {
    const k = i / 8;
    const c = i % 2 === 0 ? CYAN : MAGENTA;
    const pulse = 0.5 + 0.5 * sin(t * 1.8 + i * 0.6);

    stroke(c[0], c[1], c[2], (22 + 44 * pulse) * a * SIGNAGE_BRIGHTNESS);
    strokeWeight((1.2 + pulse * 0.75) * LINE_BOOST);

    line(left, lerp(top, bottom, k), right, lerp(bottom, top, k));
    line(left, lerp(bottom, top, k), right, lerp(top, bottom, k));
  }

  for (let i = 0; i < 7; i++) {
    const x = lerp(180, SAFE_ZONE_X - 270, i / 6);
    const h = 90 + 160 * noise(i * 0.4, t * 0.05);
    const pulse = 0.4 + 0.6 * sin(t * 2.0 + i);
    const c = PALETTE[i % PALETTE.length];

    stroke(c[0], c[1], c[2], (24 + 42 * pulse) * a * SIGNAGE_BRIGHTNESS);
    strokeWeight(2.6);
    line(x, CY - h, x, CY + h);
  }

  blendMode(BLEND);
}

function drawMovingParticles(t, opening, organize, bloom) {
  blendMode(ADD);
  noStroke();

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const route = routes[p.route];
    const c = PALETTE[p.colorIndex];
    const k = (p.k + t * p.speed) % 1;

    const rx = lerp(90, SAFE_ZONE_X - 135, k);
    const ry =
      route.y +
      sin(k * TAU * route.freq + route.phase + t * route.speed) * route.amp +
      sin(k * PI + t * 0.35) * route.drift;

    const a = p.phase + k * TAU * 2.25 + t * 0.08;
    const flowerR = 82 + 500 * pow(k, 0.58) * p.orbit;
    const petal = 1 + 0.18 * cos(a * 10 - t * 0.72) + 0.04 * sin(a * 5 + t);

    const fx = CX + cos(a) * flowerR * petal;
    const fy = CY + sin(a) * flowerR * 0.60 * petal;

    const m = smoothstep(0.06, 0.95, organize + 0.12 * sin(p.phase));
    const x = lerp(rx, fx, m);
    const y = lerp(ry, fy, m);

    const centerDistance = dist(x, y, CX, CY);
    const centerSuppression = lerp(
      CENTER_SUPPRESSION_STRENGTH,
      1.0,
      smoothstep(CENTER_SUPPRESSION_RADIUS * 0.35, CENTER_SUPPRESSION_RADIUS, centerDistance)
    );

    const pulse = 0.5 + 0.5 * sin(t * 3.2 + p.phase);

    const alpha =
      (58 + 132 * pulse) *
      opening *
      p.alpha *
      (0.76 + bloom * 0.32) *
      SIGNAGE_BRIGHTNESS *
      centerSuppression;

    const size =
      p.size *
      DOT_BOOST *
      (1.1 + pulse * 1.25 + bloom * 0.55) *
      centerSuppression;

    fill(c[0], c[1], c[2], alpha);
    circle(x, y, size);

    if (i % 10 === 0 && centerDistance > CENTER_SUPPRESSION_RADIUS * 0.6) {
      trail.noStroke();
      trail.fill(c[0], c[1], c[2], 20 * opening * (0.75 + bloom) * centerSuppression);
      trail.circle(x, y, size * 2.0);
    }
  }

  blendMode(BLEND);
}

// -----------------------------------------------------------------------------
// Main mathematical bloom
// -----------------------------------------------------------------------------
function drawSignalGarden(t, opening, organize, bloom, finale) {
  push();
  translate(CX, CY);
  rotate(0.024 * sin(t * 0.55));
  blendMode(ADD);

  drawOuterHalo(t, opening, bloom, finale);
  drawRoseArchitecture(t, opening, bloom);
  drawGoldenSeeds(t, opening, bloom);
  drawLissajousCore(t, opening, organize, bloom);
  drawCentralPulse(t, opening, bloom, finale);

  blendMode(BLEND);
  pop();
}

function drawOuterHalo(t, opening, bloom, finale) {
  noFill();
  strokeCap(ROUND);

  for (let i = 0; i < RING_COUNT; i++) {
    const k = i / max(1, RING_COUNT - 1);
    const rr = 130 + k * 480;
    const breathe = 1 + 0.018 * sin(t * 1.2 + i);
    const c = lerpPalette(k + t * 0.045);

    const alpha =
      (32 + 56 * bloom) *
      opening *
      (1 - k * 0.42) *
      (1 + finale * 0.25) *
      SIGNAGE_BRIGHTNESS;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(3.8 - k * 1.8);

    beginShape();
    for (let j = 0; j <= 420; j++) {
      const a = (j / 420) * TAU;
      const mod = 1 + 0.025 * sin(a * 20 + t * 0.9 + i);
      const x = cos(a) * rr * breathe * mod;
      const y = sin(a) * rr * 0.60 * breathe * mod;
      vertex(x, y);
    }
    endShape(CLOSE);
  }
}

function drawRoseArchitecture(t, opening, bloom) {
  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);

  for (let layer = 0; layer < 6; layer++) {
    const lk = layer / 5;
    const baseR = 105 + lk * 440;
    const c = layer % 2 === 0 ? CYAN : MAGENTA;

    const alpha =
      (42 + 78 * bloom) *
      opening *
      (1 - lk * 0.45) *
      SIGNAGE_BRIGHTNESS;

    const weight = layer === 0 ? 5.0 : 3.8 - lk * 1.8;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(weight);

    beginShape();
    for (let i = 0; i <= 540; i++) {
      const a = (i / 540) * TAU;
      const rose = cos(10 * a + t * (0.10 + lk * 0.08));
      const secondary = sin(4 * a - t * 0.35 + layer) * 0.035;
      const rr = baseR * (0.60 + 0.40 * abs(rose)) * (1 + secondary);
      const x = cos(a) * rr;
      const y = sin(a) * rr * 0.60;
      vertex(x, y);
    }
    endShape(CLOSE);
  }

  for (let s = 0; s < 12; s++) {
    const start = (s / 12) * TAU + t * 0.035;
    const end = start + PI * 0.72;
    const rr = 250 + (s % 4) * 72;
    const c = PALETTE[s % PALETTE.length];
    const alpha = (28 + 54 * bloom) * opening * SIGNAGE_BRIGHTNESS;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(2.3);

    beginShape();
    for (let i = 0; i <= 64; i++) {
      const a = lerp(start, end, i / 64);
      const x = cos(a) * rr;
      const y = sin(a) * rr * 0.60;
      vertex(x, y);
    }
    endShape();
  }
}

function drawGoldenSeeds(t, opening, bloom) {
  noStroke();

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    const k = i / seeds.length;
    const c = PALETTE[s.colorIndex];

    const a = s.a + t * 0.026;
    const petal = 1 + 0.10 * cos(s.a * 10 - t * 0.86);
    const breathe = 1 + 0.055 * sin(t * 1.18 + s.phase);

    const x = cos(a) * s.r * petal * breathe * s.layer;
    const y = sin(a) * s.r * 0.60 * petal * breathe * s.layer;

    const centerDistance = dist(x, y, 0, 0);
    const centerSuppression = lerp(0.48, 1.0, smoothstep(85, 240, centerDistance));

    const pulse = pow(0.5 + 0.5 * sin(t * 2.6 + s.phase), 2);

    const alpha =
      (36 + pulse * 128) *
      opening *
      bloom *
      (1 - k * 0.22) *
      SIGNAGE_BRIGHTNESS *
      centerSuppression;

    const size =
      s.size *
      DOT_BOOST *
      (1.0 + pulse * 1.55 + bloom * 0.45) *
      centerSuppression;

    fill(c[0], c[1], c[2], alpha);
    circle(x, y, size);
  }
}

function drawLissajousCore(t, opening, organize, bloom) {
  noFill();
  strokeCap(ROUND);

  for (let l = 0; l < 4; l++) {
    const scale = 58 + l * 52;
    const c = [INK, CYAN, MAGENTA, WARM][l];

    const alpha =
      (92 - l * 8) *
      opening *
      (0.48 + bloom * 0.62) *
      SIGNAGE_BRIGHTNESS;

    const phase = HALF_PI + l * 0.46;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(3.3 - l * 0.28);

    beginShape();
    for (let i = 0; i <= 300; i++) {
      const a = (i / 300) * TAU;
      const x = sin((3 + l) * a + phase + t * 0.35) * scale;
      const y = sin((4 + l * 2) * a + t * 0.25) * scale * 0.72;
      vertex(x, y);
    }
    endShape(CLOSE);
  }

  stroke(INK[0], INK[1], INK[2], 105 * opening * bloom);
  strokeWeight(2.4);

  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 16;
    const h = 68 + 44 * sin(t * 1.1 + i);
    line(x, -h, x, h);
  }
}

function drawCentralPulse(t, opening, bloom, finale) {
  noStroke();

  const pulse = pow(0.5 + 0.5 * sin(t * 2.0), 2);

  fill(INK[0], INK[1], INK[2], (128 + pulse * 42) * opening * bloom);
  circle(0, 0, 24 + pulse * 22 + finale * 10);

  fill(CYAN[0], CYAN[1], CYAN[2], 42 * opening * bloom);
  circle(0, 0, 72 + pulse * 22);

  noFill();
  stroke(INK[0], INK[1], INK[2], 110 * opening * bloom);
  strokeWeight(2.4);
  circle(0, 0, 92 + pulse * 18);
  circle(0, 0, 158 + pulse * 24);
}

function drawCityConstellation(t, opening, organize, bloom) {
  blendMode(ADD);
  strokeCap(ROUND);

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const c = PALETTE[n.colorIndex];

    const a = n.a + t * 0.012;
    const settle = smoothstep(0.18, 0.86, organize);
    const orbitX = CX + cos(a) * n.r * 0.98;
    const orbitY = CY + sin(a) * n.r * 0.58;

    const x = lerp(n.x + sin(t + n.phase) * 18, orbitX, settle);
    const y = lerp(n.y + cos(t * 0.9 + n.phase) * 14, orbitY, settle);

    const centerDistance = dist(x, y, CX, CY);
    const centerSuppression = lerp(
      0.58,
      1.0,
      smoothstep(CENTER_SUPPRESSION_RADIUS * 0.45, CENTER_SUPPRESSION_RADIUS * 1.4, centerDistance)
    );

    const pulse = 0.45 + 0.55 * sin(t * 2.15 + n.phase);

    noStroke();
    fill(
      c[0],
      c[1],
      c[2],
      (48 + 104 * pulse) *
        opening *
        (0.56 + bloom * 0.46) *
        SIGNAGE_BRIGHTNESS *
        centerSuppression
    );

    circle(x, y, n.size * DOT_BOOST * (1.1 + pulse * 1.05) * centerSuppression);

    if (i % 3 === 0) {
      const m = nodes[(i + n.linkOffset) % nodes.length];
      const ma = m.a + t * 0.012;
      const mx = CX + cos(ma) * m.r * 0.98;
      const my = CY + sin(ma) * m.r * 0.58;

      stroke(
        c[0],
        c[1],
        c[2],
        (22 + 34 * pulse) *
          opening *
          bloom *
          SIGNAGE_BRIGHTNESS *
          centerSuppression
      );
      strokeWeight(1.45);
      line(x, y, mx, my);

      if (i % 12 === 0 && centerDistance > CENTER_SUPPRESSION_RADIUS * 0.7) {
        trail.stroke(c[0], c[1], c[2], 8 * opening * bloom);
        trail.strokeWeight(1.0);
        trail.line(x, y, mx, my);
      }
    }
  }

  blendMode(BLEND);
}

function drawFloatingGlyphs(t, opening, bloom) {
  blendMode(ADD);
  noFill();
  strokeCap(ROUND);

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const c = PALETTE[g.colorIndex];

    const pulse = 0.5 + 0.5 * sin(t * 1.4 + g.phase);
    const alpha = (6 + 14 * pulse) * opening * (0.22 + bloom * 0.3);

    const x = g.x + sin(t * 0.45 + g.phase) * 12;
    const y = g.y + cos(t * 0.38 + g.phase) * 8;
    const s = g.size;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(1.0);

    push();
    translate(x, y);
    rotate(g.phase + t * 0.04);

    if (g.type === 0) {
      line(-s * 0.5, 0, s * 0.5, 0);
      line(0, -s * 0.5, 0, s * 0.5);
    } else if (g.type === 1) {
      rect(-s * 0.35, -s * 0.35, s * 0.7, s * 0.7);
    } else if (g.type === 2) {
      triangle(0, -s * 0.45, s * 0.42, s * 0.32, -s * 0.42, s * 0.32);
    } else {
      circle(0, 0, s * 0.78);
    }

    pop();
  }

  blendMode(BLEND);
}

function drawLogoSafeZone(t) {
  noStroke();

  for (let i = 0; i < 150; i++) {
    const k = i / 149;
    fill(0, 0, 0, 5 + 11 * k);
    rect(SAFE_ZONE_X - 190 + k * 190, 0, 3, H);
  }

  fill(0, 0, 0, 224);
  rect(SAFE_ZONE_X, 0, SAFE_ZONE_W, H);

  stroke(INK[0], INK[1], INK[2], 24 + 8 * sin(t));
  strokeWeight(1.2);
  line(SAFE_ZONE_X, H * 0.14, SAFE_ZONE_X, H * 0.86);
}

function drawScreenTexture(t) {
  blendMode(ADD);
  noStroke();

  for (let i = 0; i < 76; i++) {
    const y = (i * 18 + t * 7) % H;
    fill(255, 255, 255, i % 9 === 0 ? 1.6 : 0.42);
    rect(0, y, W, 1);
  }

  for (let i = 0; i < 36; i++) {
    const x = random(0, SAFE_ZONE_X - 40);
    const y = random(0, H);
    fill(255, 255, 255, random(1.0, 4.5));
    rect(x, y, 1, 1);
  }

  blendMode(BLEND);
}

// -----------------------------------------------------------------------------
// Utility
// -----------------------------------------------------------------------------
function smoothstep(edge0, edge1, x) {
  const n = constrain((x - edge0) / (edge1 - edge0), 0, 1);
  return n * n * (3 - 2 * n);
}

function radialGlow(x, y, radius, col, alpha) {
  for (let i = 0; i < 18; i++) {
    const k = i / 17;
    const a = alpha * (1 - k) * 0.28;
    fill(col[0], col[1], col[2], a);
    circle(x, y, radius * (1 - k * 0.75));
  }
}

function lerpPalette(v) {
  const n = PALETTE.length;
  const x = ((v % 1) + 1) % 1;
  const scaled = x * n;
  const i0 = floor(scaled) % n;
  const i1 = (i0 + 1) % n;
  const f = scaled - floor(scaled);

  const c0 = PALETTE[i0];
  const c1 = PALETTE[i1];

  return [
    lerp(c0[0], c1[0], f),
    lerp(c0[1], c1[1], f),
    lerp(c0[2], c1[2], f),
  ];
}

// -----------------------------------------------------------------------------
// Capture
// -----------------------------------------------------------------------------
function setupCaptureUI() {
  updateCaptureStatus('Ready');
  updateCaptureInfo();
}

async function startRecording() {
  if (isRecording) return;

  if (!window.VideoEncoder || !window.Mp4Muxer) {
    console.error('VideoEncoder or Mp4Muxer is not available. Check your capture library import.');
    alert('VideoEncoder or Mp4Muxer is not available. Check your capture library import.');
    return;
  }

  recFrameCount = 0;
  captureInProgress = false;
  isRecording = true;
  trail.clear();

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;

  updateCaptureStatus('Recording: 1920x1080 / 29.97fps / 30Mbps target / no audio');
  updateCaptureProgress();

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: W,
      height: H,
      frameRate: FPS,
    },
    fastStart: 'in-memory',
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      console.error(e);
      updateCaptureStatus('Encoder error. See console.');
    },
  });

  encoder.configure({
    codec: 'avc1.64002A',
    width: W,
    height: H,
    bitrate: VIDEO_BITRATE,
    bitrateMode: 'constant',
    framerate: FPS,
    avc: { format: 'avc' },
    latencyMode: 'quality',
  });
}

async function captureFrame() {
  const bitmap = await createImageBitmap(canvasEl);

  const frame = new VideoFrame(bitmap, {
    timestamp: Math.round((recFrameCount * 1000000) / FPS),
    duration: Math.round(1000000 / FPS),
  });

  encoder.encode(frame, { keyFrame: recFrameCount % Math.round(FPS) === 0 });
  frame.close();
  bitmap.close();

  updateCaptureProgress();
}

async function stopRecording() {
  if (!isRecording && !encoder) return;

  isRecording = false;
  captureInProgress = false;
  updateCaptureStatus('Finalizing MP4...');

  try {
    if (encoder) {
      await encoder.flush();
    }

    if (muxer) {
      muxer.finalize();

      const { buffer } = muxer.target;
      const blob = new Blob([buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = VIDEO_FILENAME;
      a.click();

      URL.revokeObjectURL(url);
    }

    updateCaptureStatus('Done: 1920x1080 / 29.97fps / 30Mbps target / no audio');
  } catch (error) {
    console.error(error);
    updateCaptureStatus('Export failed. See console.');
  } finally {
    encoder = null;
    muxer = null;

    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;

    updateCaptureProgress();
  }
}

function updateCaptureStatus(message) {
  const status = document.getElementById('status');
  if (status) status.textContent = message;
}

function updateCaptureInfo() {
  const durationEl = document.getElementById('duration');
  const maxDurationEl = document.getElementById('maxDuration');
  const frameCountEl = document.getElementById('frameCount');
  const maxFramesEl = document.getElementById('maxFrames');
  const canvasSizeEl = document.getElementById('canvasSize');

  if (durationEl) durationEl.textContent = '0.0';
  if (maxDurationEl) maxDurationEl.textContent = LOOP_SECONDS.toString();
  if (frameCountEl) frameCountEl.textContent = '0';
  if (maxFramesEl) maxFramesEl.textContent = LOOP_FRAMES.toString();
  if (canvasSizeEl) canvasSizeEl.textContent = `${W}×${H} / ${FPS.toFixed(2)}fps / 30Mbps`;
}

function updateCaptureProgress() {
  const durationEl = document.getElementById('duration');
  const frameCountEl = document.getElementById('frameCount');
  const maxFramesEl = document.getElementById('maxFrames');
  const progressFill = document.getElementById('progressFill');

  const seconds = recFrameCount / FPS;
  const progress = constrain(recFrameCount / LOOP_FRAMES, 0, 1);

  if (durationEl) durationEl.textContent = seconds.toFixed(1);
  if (frameCountEl) frameCountEl.textContent = recFrameCount.toString();
  if (maxFramesEl) maxFramesEl.textContent = LOOP_FRAMES.toString();
  if (progressFill) progressFill.style.width = `${(progress * 100).toFixed(1)}%`;
}

function keyPressed() {
  if (key === 'r' || key === 'R') {
    startRecording();
  }

  if (key === 's' || key === 'S') {
    saveCanvas('tokyo_signal_bloom_still_1920x1080', 'png');
  }

  if (keyCode === DELETE || keyCode === BACKSPACE) {
    randomSeed(Math.floor(random(999999)));
    noiseSeed(Math.floor(random(999999)));
    trail.clear();
    initSystem();
    updateCaptureStatus('Reseeded');
  }
}
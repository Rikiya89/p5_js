// ═══════════════════════════════════════════════════
// Sacred Geometry — Black & White 3D Generative Art
// Simplified & beautifully animated
// ═══════════════════════════════════════════════════

const W = 1080;
const H = 1920;

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
const PHI = (1 + Math.sqrt(5)) / 2;

// ─── Data ───
let particles = [];
let sparkTrails = []; // sparks flowing along Metatron lines
let flowerCenters = []; // precomputed

// ═══════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════
function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);

  // Ambient particles
  for (let i = 0; i < 180; i++) {
    particles.push({
      angle: random(TWO_PI),
      r: random(250, 650),
      y: random(-600, 600),
      speed: random(0.0008, 0.003) * (random() > 0.5 ? 1 : -1),
      drift: random(0.05, 0.2) * (random() > 0.5 ? 1 : -1),
      size: random(0.4, 2.2),
      phase: random(TWO_PI)
    });
  }

  // Sparks that travel along Metatron's Cube edges
  for (let i = 0; i < 25; i++) {
    sparkTrails.push({
      fromIdx: floor(random(13)),
      toIdx: floor(random(13)),
      pos: random(1),
      speed: random(0.003, 0.01),
      size: random(2, 4),
      trail: []
    });
  }

  // Precompute Flower of Life centers
  let baseR = 50;
  let layers = 3;
  flowerCenters = [{ x: 0, y: 0 }];
  for (let layer = 1; layer <= layers; layer++) {
    for (let i = 0; i < 6 * layer; i++) {
      let side = floor(i / layer);
      let pos = i % layer;
      let a1 = (side / 6) * TWO_PI + PI / 6;
      let a2 = ((side + 1) / 6) * TWO_PI + PI / 6;
      flowerCenters.push({
        x: lerp(layer * baseR * cos(a1), layer * baseR * cos(a2), pos / layer),
        y: lerp(layer * baseR * sin(a1), layer * baseR * sin(a2), pos / layer)
      });
    }
  }

  const maxDurEl = document.getElementById('maxDuration');
  if (maxDurEl) maxDurEl.textContent = MAX_DURATION;
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function ease(x) {
  return x * x * (3 - 2 * x);
}

function pulse01(speed, phase) {
  return 0.5 + 0.5 * sin(t * speed + phase);
}

// Global heartbeat — synchronized across all shapes
function heartbeat() {
  let beat = sin(t * 0.25);
  beat = beat > 0.7 ? 1 : 0;
  return beat * 0.15; // subtle 15% boost
}

// ═══════════════════════════════════════════
// DRAW
// ═══════════════════════════════════════════
function draw() {
  background(0);

  let breath = 0.75 + 0.2 * sin(t * 0.1) + 0.05 * sin(t * 0.23);
  let beat = heartbeat();

  // ─── Camera: smooth cinematic orbit with gentle bob ───
  let camDist = 480 + 50 * sin(t * 0.022) + 20 * sin(t * 0.055);
  let camY = 55 * sin(t * 0.007) + 15 * cos(t * 0.013);
  let camTilt = 0.02 * sin(t * 0.009); // subtle roll
  camera(
    camDist * sin(t * 0.01),
    camY,
    camDist * cos(t * 0.01),
    0, 0, 0,
    camTilt, 1, 0
  );

  // ─── Soft white lighting ───
  ambientLight((70 + 40 * beat) * breath);
  pointLight(255, 255, 255, 300 * sin(t * 0.03), -350, 300 * cos(t * 0.04));
  pointLight(160, 160, 160, -250 * cos(t * 0.025), 250, -300 * sin(t * 0.03));

  // ─── Draw layers ───
  drawParticles(breath);
  drawLightRays(breath, beat);
  drawArmillarySphere(breath, beat);
  drawOrbitingOrbs(breath, beat);
  drawFlowerOfLife(breath, beat);
  drawMetatronsCube(breath, beat);
  drawMetatronSparks(breath);
  drawSriYantra(breath, beat);
  drawTorusKnot(breath, beat);
  drawSpinningIcosahedron(breath, beat);

  t += 0.005;

  // ─── Recording ───
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
// LIGHT RAYS — radial beams from the center
// that slowly rotate and pulse
// ═══════════════════════════════════════════
function drawLightRays(breath, beat) {
  push();
  noFill();

  let numRays = 12;
  let rayLen = 500;

  for (let i = 0; i < numRays; i++) {
    let angle = (i / numRays) * TWO_PI + t * 0.003;
    let fadePhase = sin(t * 0.08 + i * 0.8);
    let alpha = (15 + 20 * max(0, fadePhase) + 30 * beat) * breath;

    // Rays fade from center outward
    stroke(255, alpha);
    strokeWeight(1 + beat * 2);

    let x1 = 20 * cos(angle);
    let z1 = 20 * sin(angle);
    let x2 = rayLen * cos(angle);
    let z2 = rayLen * sin(angle);
    line(x1, 0, z1, x2, 0, z2);

    // Second layer, slightly rotated for depth
    stroke(255, alpha * 0.4);
    strokeWeight(0.5);
    let a2 = angle + 0.03;
    line(30 * cos(a2), -5, 30 * sin(a2),
         rayLen * 0.7 * cos(a2), -5, rayLen * 0.7 * sin(a2));
  }

  pop();
}

// ═══════════════════════════════════════════
// 1. FLOWER OF LIFE
//    Circles DRAW themselves with a tracing head,
//    ripple wave, and spinning center seed
// ═══════════════════════════════════════════
function drawFlowerOfLife(breath, beat) {
  push();
  translate(0, -180, 0);
  rotateX(PI * 0.5);
  rotateZ(t * 0.004);

  let baseR = 50;
  let layers = 3;
  let maxDist = layers * baseR;

  noFill();

  // ─── Ripple wave (two waves for richer motion) ───
  let ripple1 = ((t * 0.25) % 3.0) * maxDist;
  let ripple2 = (((t * 0.25) + 1.5) % 3.0) * maxDist;

  // ─── Draw circles with trace animation ───
  // Each circle traces itself based on time + distance from center
  let drawProgress = (t * 0.06) % 1.0; // global draw cycle

  for (let ci = 0; ci < flowerCenters.length; ci++) {
    let c = flowerCenters[ci];
    let dist = sqrt(c.x * c.x + c.y * c.y);

    // Stagger: outer circles start drawing later
    let startDelay = dist / (maxDist * 1.5);
    let localProgress = constrain((drawProgress - startDelay) * 3, 0, 1);
    localProgress = ease(localProgress);

    // How much of the circle to draw (0 → full)
    let drawAmount = localProgress;

    // Ripple glow from two waves
    let rDist1 = abs(dist - ripple1);
    let rDist2 = abs(dist - ripple2);
    let rippleGlow = exp(-rDist1 * rDist1 / 2500) + exp(-rDist2 * rDist2 / 2500);

    let baseAlpha = 80 + 60 * (1 - dist / (maxDist * 1.3));
    let alpha = (baseAlpha + 140 * rippleGlow + 50 * beat) * breath;
    let sw = 1.0 + 1.5 * rippleGlow + beat;

    stroke(255, constrain(alpha, 0, 255));
    strokeWeight(sw);

    let animR = baseR * (0.95 + 0.08 * sin(t * 0.12 + dist * 0.02));

    // Draw partial circle (trace animation)
    let segments = 64;
    let endSeg = floor(segments * drawAmount);

    if (endSeg > 1) {
      beginShape();
      for (let j = 0; j <= endSeg; j++) {
        let angle = (j / segments) * TWO_PI;
        vertex(c.x + animR * cos(angle), c.y + animR * sin(angle), 0);
      }
      endShape();

      // Bright drawing head
      if (drawAmount < 0.99) {
        let headAngle = drawAmount * TWO_PI;
        let hx = c.x + animR * cos(headAngle);
        let hy = c.y + animR * sin(headAngle);

        stroke(255, 255 * breath);
        strokeWeight(4);
        point(hx, hy, 0);
      }
    }
  }

  // Outer bounding circle — pulses with heartbeat
  let outerR = (layers + 0.5) * baseR * (1 + 0.04 * sin(t * 0.1) + 0.03 * beat);
  stroke(255, (150 + 60 * beat) * breath);
  strokeWeight(2);
  beginShape();
  for (let j = 0; j <= 72; j++) {
    let angle = (j / 72) * TWO_PI;
    vertex(outerR * cos(angle), outerR * sin(angle), 0);
  }
  endShape(CLOSE);

  // Center seed spinning
  push();
  rotateZ(-t * 0.02);
  stroke(255, 200 * breath);
  strokeWeight(1.5);
  let seedR = baseR * 0.3;
  for (let i = 0; i < 6; i++) {
    let a = (i / 6) * TWO_PI;
    let px = seedR * cos(a);
    let py = seedR * sin(a);
    beginShape();
    for (let j = 0; j <= 32; j++) {
      let ja = (j / 32) * TWO_PI;
      vertex(px + seedR * 0.5 * cos(ja), py + seedR * 0.5 * sin(ja), 0);
    }
    endShape(CLOSE);
  }
  pop();

  pop();
}

// ═══════════════════════════════════════════
// 2. METATRON'S CUBE
//    Lines breathe, nodes pulse in sequence,
//    z-wave undulation, heartbeat sync
// ═══════════════════════════════════════════

// Shared Metatron points (used by sparks too)
function getMetatronPts() {
  let sc = 140 * (0.9 + 0.1 * sin(t * 0.08));
  let pts = [createVector(0, 0, 0)];
  for (let i = 0; i < 6; i++) {
    let a = (i / 6) * TWO_PI;
    pts.push(createVector(sc * 0.5 * cos(a), sc * 0.5 * sin(a), 0));
  }
  for (let i = 0; i < 6; i++) {
    let a = (i / 6) * TWO_PI + PI / 6;
    pts.push(createVector(sc * cos(a), sc * sin(a), 0));
  }
  // Z-wave
  for (let i = 1; i < pts.length; i++) {
    pts[i].z = 30 * sin(t * 0.1 + i * 0.5);
  }
  return pts;
}

function drawMetatronsCube(breath, beat) {
  push();
  rotateY(t * 0.015);
  rotateX(0.15 * sin(t * 0.008));
  rotateZ(0.1 * cos(t * 0.006));

  let pts = getMetatronPts();
  let sc = 140 * (0.9 + 0.1 * sin(t * 0.08));

  noFill();

  // Lines — wave-based stagger
  let totalLines = (pts.length * (pts.length - 1)) / 2;
  let lineIdx = 0;

  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      let linePhase = (lineIdx / totalLines) * TWO_PI;
      let appear = 0.5 + 0.5 * sin(t * 0.08 + linePhase);
      appear = ease(appear);

      let d = p5.Vector.dist(pts[i], pts[j]);
      let distFade = map(d, 0, sc * 2, 1, 0.3);

      let alpha = (200 + 55 * beat) * appear * distFade * breath;

      // Glow layer
      stroke(255, alpha * 0.25);
      strokeWeight(2.5 + 2 * beat);
      line(pts[i].x, pts[i].y, pts[i].z,
           pts[j].x, pts[j].y, pts[j].z);

      // Core line
      stroke(255, alpha);
      strokeWeight(0.6 + 1.0 * appear * distFade);
      line(pts[i].x, pts[i].y, pts[i].z,
           pts[j].x, pts[j].y, pts[j].z);

      lineIdx++;
    }
  }

  // Nodes — sequential pulse wave
  let pulseWave = (t * 0.15) % 1.0;

  for (let i = 0; i < pts.length; i++) {
    push();
    translate(pts[i].x, pts[i].y, pts[i].z);

    // Sequential highlight: one node glows extra bright at a time
    let nodeDist = abs((i / pts.length) - pulseWave);
    nodeDist = min(nodeDist, 1 - nodeDist);
    let highlight = exp(-nodeDist * nodeDist * 60);

    let nodePulse = 0.7 + 0.3 * sin(t * 0.2 + i * 0.6) + 0.4 * highlight;
    let nodeR = (i === 0 ? 22 : 15) * nodePulse;

    // Glow ring
    stroke(255, 80 * nodePulse * breath);
    strokeWeight(3 * nodePulse);
    noFill();
    beginShape();
    for (let k = 0; k <= 40; k++) {
      let a = (k / 40) * TWO_PI;
      vertex(nodeR * 1.2 * cos(a), nodeR * 1.2 * sin(a), 0);
    }
    endShape(CLOSE);

    // Core ring
    stroke(255, (200 + 55 * highlight) * breath);
    strokeWeight(1.5 * nodePulse);
    beginShape();
    for (let k = 0; k <= 40; k++) {
      let a = (k / 40) * TWO_PI;
      vertex(nodeR * cos(a), nodeR * sin(a), 0);
    }
    endShape(CLOSE);

    // Center sphere
    noStroke();
    fill(255, (200 + 55 * highlight) * nodePulse * breath);
    sphere(3.5 * nodePulse);
    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// METATRON SPARKS — bright dots that travel
// along the edges of Metatron's Cube
// ═══════════════════════════════════════════
function drawMetatronSparks(breath) {
  push();
  rotateY(t * 0.015);
  rotateX(0.15 * sin(t * 0.008));
  rotateZ(0.1 * cos(t * 0.006));

  let pts = getMetatronPts();
  noStroke();

  for (let spark of sparkTrails) {
    spark.pos += spark.speed;
    if (spark.pos >= 1) {
      spark.pos = 0;
      spark.fromIdx = spark.toIdx;
      spark.toIdx = floor(random(13));
      if (spark.toIdx === spark.fromIdx) spark.toIdx = (spark.toIdx + 1) % 13;
    }

    let from = pts[spark.fromIdx];
    let to = pts[spark.toIdx];
    let smoothPos = ease(spark.pos);

    let sx = lerp(from.x, to.x, smoothPos);
    let sy = lerp(from.y, to.y, smoothPos);
    let sz = lerp(from.z, to.z, smoothPos);

    // Store trail
    spark.trail.push({ x: sx, y: sy, z: sz });
    if (spark.trail.length > 12) spark.trail.shift();

    // Draw trail (fading)
    for (let ti = 0; ti < spark.trail.length; ti++) {
      let tp = spark.trail[ti];
      let fade = (ti / spark.trail.length);
      fill(255, fade * fade * 180 * breath);
      push();
      translate(tp.x, tp.y, tp.z);
      sphere(spark.size * fade * 0.6);
      pop();
    }

    // Bright head
    fill(255, 255 * breath);
    push();
    translate(sx, sy, sz);
    sphere(spark.size * 0.5);
    pop();
    fill(255, 60 * breath);
    push();
    translate(sx, sy, sz);
    sphere(spark.size * 1.5);
    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// 3. SRI YANTRA — 9 interlocking triangles
//    Counter-rotating, breathing, with vertex
//    sparkle and energy connections
// ═══════════════════════════════════════════
function drawSriYantra(breath, beat) {
  push();
  rotateY(t * 0.012);
  rotateX(0.15 * sin(t * 0.007));

  let sc = 130;
  let openness = 0.85 + 0.15 * sin(t * 0.06);

  noFill();

  // Collect all triangle vertices for sparkle effect
  let allVerts = [];

  // 4 upward triangles
  let upScales = [1.0, 0.7, 0.44, 0.2];
  let upRot = t * 0.004;
  for (let ti = 0; ti < upScales.length; ti++) {
    let s = sc * upScales[ti] * openness;
    let glowPhase = pulse01(0.15, ti * 1.2);
    let alpha = (140 + 100 * glowPhase + 50 * beat) * breath;
    let depth = 15 * sin(t * 0.05 + ti * 0.8);

    push();
    rotateZ(upRot + ti * 0.015);

    // Glow layer
    stroke(255, alpha * 0.25);
    strokeWeight(5 + 2 * beat);
    beginShape();
    for (let i = 0; i <= 3; i++) {
      let a = (i / 3) * TWO_PI - PI / 2;
      let vx = s * cos(a);
      let vy = s * sin(a);
      vertex(vx, vy, depth);
      if (i < 3) allVerts.push({ x: vx, y: vy, z: depth });
    }
    endShape(CLOSE);

    // Main line
    stroke(255, alpha);
    strokeWeight(2);
    beginShape();
    for (let i = 0; i <= 3; i++) {
      let a = (i / 3) * TWO_PI - PI / 2;
      vertex(s * cos(a), s * sin(a), depth);
    }
    endShape(CLOSE);

    pop();
  }

  // 5 downward triangles
  let downScales = [0.92, 0.65, 0.48, 0.3, 0.1];
  let downRot = -t * 0.004;
  for (let ti = 0; ti < downScales.length; ti++) {
    let s = sc * downScales[ti] * openness;
    let glowPhase = pulse01(0.15, ti * 1.2 + PI);
    let alpha = (130 + 100 * glowPhase + 50 * beat) * breath;
    let depth = -15 * sin(t * 0.05 + ti * 0.8 + 1);

    push();
    rotateZ(downRot - ti * 0.015);

    // Glow
    stroke(255, alpha * 0.25);
    strokeWeight(5 + 2 * beat);
    beginShape();
    for (let i = 0; i <= 3; i++) {
      let a = (i / 3) * TWO_PI + PI / 2;
      let vx = s * cos(a);
      let vy = s * sin(a);
      vertex(vx, vy, depth);
      if (i < 3) allVerts.push({ x: vx, y: vy, z: depth });
    }
    endShape(CLOSE);

    // Main line
    stroke(255, alpha);
    strokeWeight(2);
    beginShape();
    for (let i = 0; i <= 3; i++) {
      let a = (i / 3) * TWO_PI + PI / 2;
      vertex(s * cos(a), s * sin(a), depth);
    }
    endShape(CLOSE);

    pop();
  }

  // ─── Vertex sparkles ───
  noStroke();
  for (let vi = 0; vi < allVerts.length; vi++) {
    let v = allVerts[vi];
    let sparkle = 0.5 + 0.5 * sin(t * 0.6 + vi * 0.9);
    sparkle = sparkle * sparkle; // sharper sparkle

    if (sparkle > 0.5) {
      fill(255, sparkle * 200 * breath);
      push();
      translate(v.x, v.y, v.z);
      sphere(2 + 2 * sparkle);
      pop();
    }
  }

  // Bindu — breathing central point
  noStroke();
  let binduPulse = 1 + 0.5 * sin(t * 0.25) + 0.3 * beat;
  fill(255, 40 * breath);
  sphere(18 * binduPulse);
  fill(255, 100 * breath);
  sphere(8 * binduPulse);
  fill(255, 240 * breath);
  sphere(3.5 * binduPulse);

  // Outer circle with dashed effect
  push();
  rotateZ(t * 0.003);
  stroke(255, 170 * breath);
  strokeWeight(2);
  noFill();

  let circleR = sc * 1.15;
  for (let i = 0; i < 36; i++) {
    let a1 = (i / 36) * TWO_PI;
    let a2 = ((i + 0.6) / 36) * TWO_PI;
    // Stagger: each dash fades in/out
    let dashAlpha = (140 + 60 * sin(t * 0.12 + i * 0.4)) * breath;
    stroke(255, dashAlpha);
    beginShape();
    for (let j = 0; j <= 8; j++) {
      let a = lerp(a1, a2, j / 8);
      vertex(circleR * cos(a), circleR * sin(a), 0);
    }
    endShape();
  }
  pop();

  pop();
}

// ═══════════════════════════════════════════
// 4. TORUS KNOT — traveling light with trails
//    plus a ghost knot that phases in/out
// ═══════════════════════════════════════════
function drawTorusKnot(breath, beat) {
  push();
  rotateX(PI * 0.18 + 0.06 * sin(t * 0.015));
  rotateY(t * 0.018);

  let R = 190 + 15 * sin(t * 0.035);
  let r = 65 + 8 * sin(t * 0.05);
  let p = 2, q = 3;

  let totalPts = 700;
  noFill();

  // Compute knot positions
  let knotPts = [];
  for (let i = 0; i <= totalPts; i++) {
    let u = (i / totalPts) * TWO_PI;
    knotPts.push({
      x: (R + r * cos(q * u)) * cos(p * u),
      y: (R + r * cos(q * u)) * sin(p * u),
      z: r * sin(q * u)
    });
  }

  // ─── Three traveling waves ───
  let wave1 = (t * 0.12) % 1.0;
  let wave2 = (wave1 + 0.33) % 1.0;
  let wave3 = (wave1 + 0.66) % 1.0;

  for (let i = 0; i < totalPts; i++) {
    let pos = i / totalPts;

    // Distance to each wave
    let d1 = min(abs(pos - wave1), 1 - abs(pos - wave1));
    let d2 = min(abs(pos - wave2), 1 - abs(pos - wave2));
    let d3 = min(abs(pos - wave3), 1 - abs(pos - wave3));

    // Gaussian glow for each wave
    let glow = exp(-d1 * d1 * 120) + exp(-d2 * d2 * 120) + exp(-d3 * d3 * 120);
    glow = min(glow, 1);

    let baseAlpha = 40 + 20 * beat;
    let alpha = (baseAlpha + 215 * glow) * breath;
    let sw = 0.8 + 3.0 * glow + beat;

    stroke(255, alpha);
    strokeWeight(sw);
    line(knotPts[i].x, knotPts[i].y, knotPts[i].z,
         knotPts[i + 1].x, knotPts[i + 1].y, knotPts[i + 1].z);
  }

  // ─── Three bright orbs ───
  noStroke();
  let waves = [wave1, wave2, wave3];
  for (let w of waves) {
    let idx = floor(w * totalPts);
    let wp = knotPts[constrain(idx, 0, totalPts)];
    push();
    translate(wp.x, wp.y, wp.z);
    // Outer glow
    fill(255, 35 * breath);
    sphere(25);
    // Mid glow
    fill(255, 100 * breath);
    sphere(10);
    // Core
    fill(255, 255 * breath);
    sphere(4);
    pop();
  }

  // ─── Ghost knot: slightly different (p,q) fading in/out ───
  let ghostAlpha = 25 * (0.5 + 0.5 * sin(t * 0.06)) * breath;
  if (ghostAlpha > 5) {
    stroke(255, ghostAlpha);
    strokeWeight(0.6);
    noFill();
    let gp = 3, gq = 5;
    let gR = R + 10, gr = r - 5;
    beginShape();
    for (let i = 0; i <= 500; i++) {
      let u = (i / 500) * TWO_PI;
      vertex(
        (gR + gr * cos(gq * u)) * cos(gp * u),
        (gR + gr * cos(gq * u)) * sin(gp * u),
        gr * sin(gq * u)
      );
    }
    endShape();
  }

  pop();
}

// ═══════════════════════════════════════════
// 5. AMBIENT PARTICLES — twinkling dust
// ═══════════════════════════════════════════
function drawParticles(breath) {
  push();
  noStroke();

  for (let p of particles) {
    p.angle += p.speed;
    p.y += p.drift;
    if (p.y > 600) p.y = -600;
    if (p.y < -600) p.y = 600;

    let twinkle = 0.3 + 0.7 * sin(t * 0.5 + p.phase);
    twinkle = twinkle * twinkle; // sharper twinkle
    let x = p.r * cos(p.angle);
    let z = p.r * sin(p.angle);

    fill(255, 80 * twinkle * breath);
    push();
    translate(x, p.y, z);
    sphere(p.size * (0.5 + 0.5 * twinkle));
    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// 6. ARMILLARY SPHERE — nested rotating rings
//    like an ancient astronomical instrument
//    Each ring tilts at a different axis and
//    spins at its own speed
// ═══════════════════════════════════════════
function drawArmillarySphere(breath, beat) {
  push();

  let numRings = 5;
  let baseRadius = 300;

  noFill();

  for (let i = 0; i < numRings; i++) {
    push();

    let radius = baseRadius + i * 20;

    // Each ring has unique tilt and spin
    let tiltX = (i * 0.6) + 0.2 * sin(t * 0.02 + i * 1.3);
    let tiltZ = (i * 0.4) + 0.15 * cos(t * 0.018 + i * 0.9);
    let spinSpeed = 0.012 + i * 0.004;
    let spinDir = i % 2 === 0 ? 1 : -1;

    rotateX(tiltX);
    rotateZ(tiltZ);
    rotateY(t * spinSpeed * spinDir);

    // Breathing pulse per ring
    let ringPulse = 0.9 + 0.1 * sin(t * 0.15 + i * 0.8);
    let alpha = (80 + 50 * ringPulse + 40 * beat) * breath;

    // Glow layer
    stroke(255, alpha * 0.2);
    strokeWeight(4);
    beginShape();
    for (let j = 0; j <= 90; j++) {
      let a = (j / 90) * TWO_PI;
      vertex(radius * ringPulse * cos(a), 0, radius * ringPulse * sin(a));
    }
    endShape(CLOSE);

    // Core ring
    stroke(255, alpha);
    strokeWeight(1.2 + 0.5 * ringPulse);
    beginShape();
    for (let j = 0; j <= 90; j++) {
      let a = (j / 90) * TWO_PI;
      vertex(radius * ringPulse * cos(a), 0, radius * ringPulse * sin(a));
    }
    endShape(CLOSE);

    // Small tick marks on the ring (like degree markers)
    let ticks = 12 + i * 4;
    for (let ti = 0; ti < ticks; ti++) {
      let a = (ti / ticks) * TWO_PI;
      let tickGlow = 0.5 + 0.5 * sin(t * 0.3 + ti * 0.6 + i);
      let tickAlpha = alpha * 0.5 * tickGlow;
      stroke(255, tickAlpha);
      strokeWeight(0.8);
      let inner = radius * ringPulse * 0.95;
      let outer = radius * ringPulse * 1.05;
      line(inner * cos(a), 0, inner * sin(a),
           outer * cos(a), 0, outer * sin(a));
    }

    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// 7. SPINNING ICOSAHEDRON — golden-ratio solid
//    Smooth continuous rotation on all 3 axes
//    with edges that glow as they face the camera
// ═══════════════════════════════════════════
function drawSpinningIcosahedron(breath, beat) {
  push();

  // Smooth multi-axis rotation
  let rx = t * 0.025;
  let ry = t * 0.018;
  let rz = t * 0.01;
  // Add gentle wobble
  rx += 0.15 * sin(t * 0.03);
  ry += 0.1 * cos(t * 0.025);

  rotateX(rx);
  rotateY(ry);
  rotateZ(rz);

  let s = 80 + 8 * sin(t * 0.06) + 5 * beat;

  // Icosahedron vertices
  let verts = [
    createVector(-1, PHI, 0), createVector(1, PHI, 0),
    createVector(-1, -PHI, 0), createVector(1, -PHI, 0),
    createVector(0, -1, PHI), createVector(0, 1, PHI),
    createVector(0, -1, -PHI), createVector(0, 1, -PHI),
    createVector(PHI, 0, -1), createVector(PHI, 0, 1),
    createVector(-PHI, 0, -1), createVector(-PHI, 0, 1)
  ];

  for (let v of verts) v.normalize().mult(s);

  let faces = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
  ];

  // Faint filled faces
  noStroke();
  fill(255, (12 + 8 * beat) * breath);
  for (let face of faces) {
    beginShape(TRIANGLES);
    vertex(verts[face[0]].x, verts[face[0]].y, verts[face[0]].z);
    vertex(verts[face[1]].x, verts[face[1]].y, verts[face[1]].z);
    vertex(verts[face[2]].x, verts[face[2]].y, verts[face[2]].z);
    endShape();
  }

  // Bright edges with glow
  noFill();
  let drawnEdges = new Set();
  for (let face of faces) {
    for (let ei = 0; ei < 3; ei++) {
      let a = face[ei];
      let b = face[(ei + 1) % 3];
      let edgeKey = min(a, b) + '-' + max(a, b);
      if (!drawnEdges.has(edgeKey)) {
        drawnEdges.add(edgeKey);

        // Edge glow based on rotation phase
        let edgeMid = p5.Vector.add(verts[a], verts[b]).mult(0.5);
        let edgeGlow = 0.6 + 0.4 * sin(t * 0.2 + edgeMid.x * 0.05 + edgeMid.y * 0.03);

        // Glow layer
        stroke(255, 40 * edgeGlow * breath);
        strokeWeight(4);
        line(verts[a].x, verts[a].y, verts[a].z,
             verts[b].x, verts[b].y, verts[b].z);

        // Core edge
        stroke(255, (150 + 60 * edgeGlow + 40 * beat) * breath);
        strokeWeight(1.5 * edgeGlow);
        line(verts[a].x, verts[a].y, verts[a].z,
             verts[b].x, verts[b].y, verts[b].z);
      }
    }
  }

  // Pulsing vertices
  noStroke();
  for (let i = 0; i < verts.length; i++) {
    let vPulse = 0.6 + 0.4 * sin(t * 0.35 + i * PHI);
    push();
    translate(verts[i].x, verts[i].y, verts[i].z);
    fill(255, (180 + 60 * vPulse) * breath);
    sphere(2.5 * vPulse + beat * 2);
    // Outer halo
    fill(255, 30 * vPulse * breath);
    sphere(7 * vPulse);
    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// 8. ORBITING ORBS — glowing spheres that
//    trace smooth circular paths at different
//    heights and tilts, leaving fading trails
// ═══════════════════════════════════════════
function drawOrbitingOrbs(breath, beat) {
  push();
  noStroke();

  let numOrbs = 8;

  for (let i = 0; i < numOrbs; i++) {
    let orbitR = 250 + i * 30;
    let speed = 0.015 + i * 0.003;
    let dir = i % 2 === 0 ? 1 : -1;
    let tiltX = (i * 0.35) + 0.1 * sin(t * 0.01 + i);
    let tiltZ = (i * 0.25);
    let yOffset = 40 * sin(t * 0.02 + i * 1.2);

    // Current position
    let angle = t * speed * dir + i * (TWO_PI / numOrbs);

    push();
    rotateX(tiltX);
    rotateZ(tiltZ);

    // Draw trail (12 past positions)
    let trailLen = 14;
    for (let ti = trailLen; ti >= 0; ti--) {
      let trailAngle = angle - ti * 0.025 * dir;
      let fade = 1 - ti / trailLen;
      fade = fade * fade; // quadratic fade

      let tx = orbitR * cos(trailAngle);
      let tz = orbitR * sin(trailAngle);
      let ty = yOffset * (1 - ti * 0.02);

      let trailAlpha = fade * (60 + 40 * beat) * breath;
      let trailSize = (3 + 2 * beat) * fade;

      fill(255, trailAlpha);
      push();
      translate(tx, ty, tz);
      sphere(trailSize);
      pop();
    }

    // Bright orb head
    let ox = orbitR * cos(angle);
    let oz = orbitR * sin(angle);

    push();
    translate(ox, yOffset, oz);

    // Outer halo
    fill(255, (30 + 20 * beat) * breath);
    sphere(14);
    // Mid glow
    fill(255, (90 + 40 * beat) * breath);
    sphere(6);
    // Core
    fill(255, 240 * breath);
    sphere(2.5);

    pop();

    pop();
  }

  pop();
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
  a.download = 'sacred_geometry.mp4';
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
      statusEl.style.color = '#aaaaaa';
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

// ═══════════════════════════════════════════════════
// Rolle's Theorem — 3D Generative Art
// "If f is continuous on [a,b], differentiable on (a,b),
//  and f(a) = f(b), then ∃ c ∈ (a,b) : f'(c) = 0"
// ═══════════════════════════════════════════════════

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
let flowParticles = [];
let cometParticles = [];
let wavePulses = [];
let cachedCriticals = [];

// ─── Easing helpers ───
function smoothPulse(speed, phase) {
  let v = sin(t * speed + phase);
  return v * v * sign(v); // smoother than raw sin
}

function sign(x) { return x >= 0 ? 1 : -1; }

// ═══════════════════════════════════════════
// Rolle functions — all satisfy f(0) = f(1) = 0
// ═══════════════════════════════════════════
function rolleF(x, type) {
  x = constrain(x, 0, 1);
  switch (type % 6) {
    case 0: return sin(PI * x);
    case 1: return 4 * x * (1 - x);
    case 2: return pow(sin(PI * x), 2);
    case 3: return sin(PI * x) * (1 + 0.4 * sin(3 * PI * x));
    case 4: return pow(sin(PI * x), 3);
    case 5: return sin(PI * x) * cos(PI * x * 0.5);
    default: return sin(PI * x);
  }
}

// Morphing Rolle — smooth blend between two function types
function rolleFMorph(x, tVal) {
  x = constrain(x, 0, 1);
  let cycle = (tVal * 0.03) % 6;
  let typeA = floor(cycle) % 6;
  let typeB = (typeA + 1) % 6;
  let blend = cycle - floor(cycle);
  blend = blend * blend * (3 - 2 * blend); // smoothstep
  return lerp(rolleF(x, typeA), rolleF(x, typeB), blend);
}

function rolleDeriv(x, type) {
  let dx = 0.001;
  return (rolleF(x + dx, type) - rolleF(x - dx, type)) / (2 * dx);
}

// ─── Palette interpolation ───
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

function getBreath() {
  return 0.65 + 0.25 * sin(t * 0.15) + 0.1 * sin(t * 0.25 + 0.5);
}

// ═══════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════
function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);

  // Star field
  for (let i = 0; i < 500; i++) {
    let theta = random(TWO_PI);
    let phi = acos(random(-1, 1));
    let r = random(800, 1800);
    stars.push({
      x: r * sin(phi) * cos(theta),
      y: r * sin(phi) * sin(theta),
      z: r * cos(phi),
      size: random(0.8, 3.5),
      brightness: random(0.3, 1),
      phase: random(TWO_PI)
    });
  }

  // Flow particles — slower drift
  for (let i = 0; i < 300; i++) {
    flowParticles.push({
      param: random(0, 1),
      speed: random(0.0003, 0.0012),
      curveType: floor(random(6)),
      radialAngle: random(TWO_PI),
      size: random(1.5, 4),
      colorIdx: random(0, 1)
    });
  }

  // Comet trail particles — gentle orbits
  for (let i = 0; i < 45; i++) {
    cometParticles.push({
      param: random(0, 1),
      speed: random(0.0005, 0.0018),
      orbitRadius: random(200, 380),
      orbitTilt: random(-0.3, 0.3),
      orbitPhase: random(TWO_PI),
      trail: [],
      trailMax: floor(random(20, 45)),
      size: random(2, 4.5),
      colorIdx: random(0, 1)
    });
  }

  // Pre-compute critical points
  for (let ct = 0; ct < 6; ct++) {
    for (let x = 0.02; x < 0.99; x += 0.01) {
      let d = rolleDeriv(x, ct);
      let dNext = rolleDeriv(x + 0.01, ct);
      if (d * dNext < 0) {
        let cx = x + 0.005;
        cachedCriticals.push({ x: cx, type: ct, fVal: rolleF(cx, ct) });
      }
    }
  }

  const maxDurEl = document.getElementById('maxDuration');
  if (maxDurEl) maxDurEl.textContent = MAX_DURATION;
}

// ═══════════════════════════════════════════
// DRAW
// ═══════════════════════════════════════════
function draw() {
  background(20, 17, 35);

  let breath = getBreath();

  // ─── Camera: slow, dreamy cinematic orbit ───
  let camDist = 580 + 50 * sin(t * 0.04) + 25 * sin(t * 0.025);
  let camY = -30 + 90 * sin(t * 0.015) + 35 * sin(t * 0.008);
  camera(
    camDist * sin(t * 0.018),
    camY,
    camDist * cos(t * 0.018),
    0, -20, 0,
    0, 1, 0
  );

  // ─── Lighting: gentle orbiting lights ───
  let li = 0.7 + 0.3 * breath;
  ambientLight(50 * li, 42 * li, 90 * li);
  pointLight(230 * li, 215 * li, 250 * li,
    400 * sin(t * 0.05), -300 * cos(t * 0.04), 350 * sin(t * 0.06));
  pointLight(160 * li, 210 * li, 245 * li,
    -350 * cos(t * 0.045), 250 * sin(t * 0.035), -400 * cos(t * 0.055));
  pointLight(110 * li, 85 * li, 210 * li,
    200 * sin(t * 0.07), -150, 300 * cos(t * 0.06));

  // ─── Spawn wave pulses periodically ───
  if (frameCount % 150 === 0 && cachedCriticals.length > 0) {
    let cp = cachedCriticals[floor(random(cachedCriticals.length))];
    wavePulses.push({
      y: -cp.fVal * 200,
      radius: 0,
      maxRadius: 420,
      speed: 1.2,
      alpha: 70,
      colorIdx: 0.3 + cp.type * 0.1
    });
  }

  // ─── Draw layers (back to front) ───
  drawStars(breath);
  drawOrbitingHalos(breath);
  drawRolleSurface(breath);
  drawDoubleHelix(breath);
  drawRolleArches(breath);
  drawPetalBloom(breath);
  drawCriticalPoints(breath);
  drawEnergyFilaments(breath);
  drawTangentRings(breath);
  drawWavePulses(breath);
  drawFlowParticles(breath);
  drawCometTrails(breath);
  drawEndpointConnections(breath);
  drawCentralAxis(breath);

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
// 1. STAR FIELD — gentle twinkle
// ═══════════════════════════════════════════
function drawStars(breath) {
  push();
  rotateY(t * 0.001);
  noStroke();
  for (let s of stars) {
    push();
    translate(s.x, s.y, s.z);
    let b = s.brightness * (0.4 + 0.6 * breath);
    let twinkle = 0.7 + 0.3 * sin(t * 0.6 + s.phase);
    let c = palColor(s.brightness * 0.4 + 0.35);
    fill(c[0] * b * twinkle, c[1] * b * twinkle, c[2] * b * twinkle, 210);
    sphere(s.size * (0.85 + 0.15 * twinkle));
    pop();
  }
  pop();
}

// ═══════════════════════════════════════════
// 2. MORPHING ROLLE SURFACE OF REVOLUTION
//    Smoothly transitions between Rolle functions
// ═══════════════════════════════════════════
function drawRolleSurface(breath) {
  push();
  let radialSteps = 72;
  let heightSteps = 60;
  let baseRadius = 130 + 12 * sin(t * 0.08);
  let totalHeight = 320;

  noFill();

  // Horizontal rings — morphing cross-sections
  for (let i = 0; i <= heightSteps; i++) {
    let x = i / heightSteps;
    let fVal = rolleFMorph(x, t);
    let r = baseRadius * (0.15 + fVal * 0.85);
    let py = (x - 0.5) * totalHeight;

    let c = palColor(x * 0.6 + 0.15 + t * 0.005);
    let alpha = (25 + 55 * fVal) * breath;
    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(0.6 + fVal * 0.8);

    beginShape();
    for (let j = 0; j <= radialSteps; j++) {
      let angle = (j / radialSteps) * TWO_PI;
      let warp = 1 + 0.03 * sin(angle * 6 + t * 0.2 + x * 4);
      warp += 0.015 * sin(angle * 3 - t * 0.12 + x * 8);
      vertex(r * cos(angle) * warp, py, r * sin(angle) * warp);
    }
    endShape();
  }

  // Vertical meridian lines
  for (let j = 0; j < 24; j++) {
    let angle = (j / 24) * TWO_PI + t * 0.006;
    let c = palColor(j / 24 + 0.2 + t * 0.004);
    stroke(c[0], c[1], c[2], 22 * breath);
    strokeWeight(0.5);

    beginShape();
    for (let i = 0; i <= heightSteps; i++) {
      let x = i / heightSteps;
      let fVal = rolleFMorph(x, t);
      let r = baseRadius * (0.15 + fVal * 0.85);
      let py = (x - 0.5) * totalHeight;
      vertex(r * cos(angle), py, r * sin(angle));
    }
    endShape();
  }

  pop();
}

// ═══════════════════════════════════════════
// 3. DOUBLE HELIX — Rolle DNA spirals
//    Two intertwined Rolle curves wrapping
//    around the central axis
// ═══════════════════════════════════════════
function drawDoubleHelix(breath) {
  push();

  let helixHeight = 350;
  let helixRadius = 50 + 8 * sin(t * 0.1);
  let turns = 3;
  let steps = 200;

  for (let strand = 0; strand < 2; strand++) {
    let offset = strand * PI;
    let c = palColor(0.2 + strand * 0.35 + t * 0.003);
    noFill();
    stroke(c[0], c[1], c[2], (60 + 40 * breath));
    strokeWeight(1.2 + 0.5 * breath);

    beginShape();
    for (let i = 0; i <= steps; i++) {
      let x = i / steps;
      let fVal = rolleFMorph(x, t + strand * 2);
      let angle = x * turns * TWO_PI + offset + t * 0.08;
      let r = helixRadius * (0.4 + fVal * 0.6);
      let py = (x - 0.5) * helixHeight;

      vertex(r * cos(angle), py, r * sin(angle));
    }
    endShape();
  }

  // Cross-rungs connecting the two strands
  for (let i = 0; i < steps; i += 8) {
    let x = i / steps;
    let fVal = rolleFMorph(x, t);
    let angle1 = x * turns * TWO_PI + t * 0.08;
    let angle2 = angle1 + PI;
    let r1 = helixRadius * (0.4 + rolleFMorph(x, t) * 0.6);
    let r2 = helixRadius * (0.4 + rolleFMorph(x, t + 2) * 0.6);
    let py = (x - 0.5) * helixHeight;

    let c = palColor(x + 0.4 + t * 0.003);
    stroke(c[0], c[1], c[2], (20 + 25 * fVal) * breath);
    strokeWeight(0.4);
    line(
      r1 * cos(angle1), py, r1 * sin(angle1),
      r2 * cos(angle2), py, r2 * sin(angle2)
    );
  }

  pop();
}

// ═══════════════════════════════════════════
// 4. ROLLE ARCHES — 3D ribbon curves
// ═══════════════════════════════════════════
function drawRolleArches(breath) {
  push();
  let numTypes = 6;
  let copiesPerType = 3;
  let steps = 80;
  let archHeight = 200;
  let archSpan = 280;

  for (let ct = 0; ct < numTypes; ct++) {
    for (let copy = 0; copy < copiesPerType; copy++) {
      let baseAngle = (ct * copiesPerType + copy) / (numTypes * copiesPerType) * TWO_PI;
      baseAngle += t * 0.01;

      let c = palColor(ct / numTypes + copy * 0.05 + t * 0.003);
      let alpha = (50 + 80 * breath) * (0.6 + 0.4 * sin(t * 0.12 + ct));
      noFill();
      stroke(c[0], c[1], c[2], alpha);
      strokeWeight(1.0 + 0.8 * breath);

      beginShape();
      for (let i = 0; i <= steps; i++) {
        let x = i / steps;
        let fVal = rolleF(x, ct);
        let spanAngle = 0.4 + 0.08 * sin(t * 0.06 + ct);
        let angle = baseAngle + (x - 0.5) * spanAngle;
        let radius = archSpan + 15 * sin(t * 0.09 + ct * 0.7);
        let py = -fVal * archHeight;
        vertex(radius * cos(angle), py, radius * sin(angle));
      }
      endShape();
    }
  }
  pop();
}

// ═══════════════════════════════════════════
// 5. PETAL BLOOM — Rolle curves as petals
//    that open and close like a flower
// ═══════════════════════════════════════════
function drawPetalBloom(breath) {
  push();

  let numPetals = 8;
  let steps = 50;
  let openAmount = 0.5 + 0.5 * sin(t * 0.06);

  for (let p = 0; p < numPetals; p++) {
    let baseAngle = (p / numPetals) * TWO_PI + t * 0.007;
    let c = palColor(p / numPetals + 0.1 + t * 0.003);

    noFill();
    stroke(c[0], c[1], c[2], (35 + 50 * openAmount) * breath);
    strokeWeight(1.5);

    beginShape();
    for (let i = 0; i <= steps; i++) {
      let x = i / steps;
      let fVal = rolleF(x, p % 6);

      let petalLength = 180 * openAmount + 40;
      let petalLift = fVal * 120 * openAmount;
      let sway = 8 * sin(t * 0.12 + p * 0.8) * x;

      let radius = 30 + x * petalLength;
      let angle = baseAngle + sway * 0.01;
      let py = -petalLift - 10;

      vertex(radius * cos(angle), py, radius * sin(angle));
    }
    endShape();

    // Second layer — thinner, slightly offset
    stroke(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, (20 + 30 * openAmount) * breath);
    strokeWeight(0.7);

    beginShape();
    for (let i = 0; i <= steps; i++) {
      let x = i / steps;
      let fVal = rolleF(x, (p + 3) % 6);

      let petalLength = 160 * openAmount + 30;
      let petalLift = fVal * 100 * openAmount;

      let radius = 40 + x * petalLength;
      let angle = baseAngle + 0.05;
      let py = -petalLift - 15;

      vertex(radius * cos(angle), py, radius * sin(angle));
    }
    endShape();
  }

  pop();
}

// ═══════════════════════════════════════════
// 6. CRITICAL POINTS — glowing spheres
//    where f'(c) = 0 (horizontal tangent)
//    Slow, gentle pulsing
// ═══════════════════════════════════════════
function drawCriticalPoints(breath) {
  push();
  noStroke();

  let copiesPerType = 3;
  for (let cp of cachedCriticals) {
    for (let copy = 0; copy < copiesPerType; copy++) {
      let baseAngle = (cp.type * copiesPerType + copy) / (6 * copiesPerType) * TWO_PI + t * 0.01;
      let spanAngle = 0.4 + 0.08 * sin(t * 0.06 + cp.type);
      let angle = baseAngle + (cp.x - 0.5) * spanAngle;
      let radius = 280 + 15 * sin(t * 0.09 + cp.type * 0.7);
      let py = -cp.fVal * 200;

      push();
      translate(radius * cos(angle), py, radius * sin(angle));

      // Gentle, slow pulse
      let pulse = 1 + 0.2 * sin(t * 0.6 + cp.type * 1.5 + cp.x * 5);

      // Outer halo
      let c = palColor(0.45 + cp.type * 0.08);
      fill(c[0], c[1], c[2], 25 * breath * pulse);
      sphere(18 * pulse);

      // Mid glow
      fill(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 50 * breath * pulse);
      sphere(9 * pulse);

      // Inner core
      fill(220, 210, 245, 200 * breath * pulse);
      sphere(3.5 * pulse);
      pop();
    }
  }
  pop();
}

// ═══════════════════════════════════════════
// 7. ENERGY FILAMENTS — gentle electric arcs
//    connecting critical points across space
// ═══════════════════════════════════════════
function drawEnergyFilaments(breath) {
  push();
  noFill();

  let copiesPerType = 3;

  for (let i = 0; i < cachedCriticals.length - 1; i++) {
    let cp1 = cachedCriticals[i];
    let cp2 = cachedCriticals[(i + 1) % cachedCriticals.length];

    // Slow phase-in/phase-out
    let connectPhase = sin(t * 0.2 + i * 1.5);
    if (connectPhase < 0.2) continue;

    let alpha = map(connectPhase, 0.2, 1, 0, 40) * breath;

    for (let copy = 0; copy < 2; copy++) {
      let ba1 = (cp1.type * copiesPerType + copy) / (6 * copiesPerType) * TWO_PI + t * 0.01;
      let sa1 = 0.4 + 0.08 * sin(t * 0.06 + cp1.type);
      let a1 = ba1 + (cp1.x - 0.5) * sa1;
      let r1 = 280 + 15 * sin(t * 0.09 + cp1.type * 0.7);
      let py1 = -cp1.fVal * 200;

      let ba2 = (cp2.type * copiesPerType + copy) / (6 * copiesPerType) * TWO_PI + t * 0.01;
      let sa2 = 0.4 + 0.08 * sin(t * 0.06 + cp2.type);
      let a2 = ba2 + (cp2.x - 0.5) * sa2;
      let r2 = 280 + 15 * sin(t * 0.09 + cp2.type * 0.7);
      let py2 = -cp2.fVal * 200;

      let x1 = r1 * cos(a1), z1 = r1 * sin(a1);
      let x2 = r2 * cos(a2), z2 = r2 * sin(a2);

      let c = palColor(0.5 + i * 0.05 + t * 0.003);
      stroke(c[0], c[1], c[2], alpha);
      strokeWeight(0.6);

      // Gentle wavy interpolation
      beginShape();
      let segments = 20;
      for (let s = 0; s <= segments; s++) {
        let frac = s / segments;
        let mx = lerp(x1, x2, frac);
        let my = lerp(py1, py2, frac);
        let mz = lerp(z1, z2, frac);

        // Soft, slow undulation instead of frantic jitter
        let wave = 6 * sin(frac * PI) * connectPhase;
        mx += wave * sin(t * 1.5 + frac * 8 + i);
        my += wave * cos(t * 1.2 + frac * 6 + i * 2);
        mz += wave * sin(t * 1.3 + frac * 7 + i * 3);

        vertex(mx, my, mz);
      }
      endShape();
    }
  }

  pop();
}

// ═══════════════════════════════════════════
// 8. TANGENT RINGS — horizontal planes
//    at heights where f'(c) = 0
// ═══════════════════════════════════════════
function drawTangentRings(breath) {
  push();
  noFill();

  let heights = [
    -rolleF(0.5, 0) * 200,
    -rolleF(0.5, 1) * 200,
    -rolleF(0.5, 2) * 200,
  ];

  for (let hi = 0; hi < heights.length; hi++) {
    let py = heights[hi];

    for (let ring = 0; ring < 4; ring++) {
      let radius = 180 + ring * 55 + 12 * sin(t * 0.1 + ring + hi);
      let c = palColor(0.3 + hi * 0.2 + ring * 0.05 + t * 0.003);
      let alpha = (35 - ring * 7) * breath;

      stroke(c[0], c[1], c[2], alpha);
      strokeWeight(0.8 + (3 - ring) * 0.3);

      beginShape();
      for (let i = 0; i <= 90; i++) {
        let angle = (i / 90) * TWO_PI;
        let wobble = 1 + 0.015 * sin(angle * 8 + t * 0.25 + hi * 2);
        vertex(radius * cos(angle) * wobble, py, radius * sin(angle) * wobble);
      }
      endShape(CLOSE);
    }
  }

  // Endpoint rings: f(a) = f(b) = 0
  for (let ep = 0; ep < 2; ep++) {
    let py = (ep - 0.5) * 320;
    let c = palColor(ep * 0.5 + 0.05);
    stroke(c[0], c[1], c[2], 30 * breath);
    strokeWeight(1.2);

    beginShape();
    for (let i = 0; i <= 72; i++) {
      let angle = (i / 72) * TWO_PI;
      let r = 130 * 0.15;
      vertex(r * cos(angle), py, r * sin(angle));
    }
    endShape(CLOSE);
  }

  pop();
}

// ═══════════════════════════════════════════
// 9. WAVE PULSES — expanding ripples
//    emanating from critical points
// ═══════════════════════════════════════════
function drawWavePulses(breath) {
  push();
  noFill();

  for (let i = wavePulses.length - 1; i >= 0; i--) {
    let wp = wavePulses[i];
    wp.radius += wp.speed;
    wp.alpha -= 0.2;

    if (wp.alpha <= 0 || wp.radius > wp.maxRadius) {
      wavePulses.splice(i, 1);
      continue;
    }

    let c = palColor(wp.colorIdx);
    let fade = wp.alpha * breath;
    stroke(c[0], c[1], c[2], fade);
    strokeWeight(1.5 * (wp.alpha / 70));

    beginShape();
    for (let j = 0; j <= 60; j++) {
      let angle = (j / 60) * TWO_PI;
      let wobble = 1 + 0.02 * sin(angle * 5 + wp.radius * 0.05);
      vertex(wp.radius * cos(angle) * wobble, wp.y, wp.radius * sin(angle) * wobble);
    }
    endShape(CLOSE);

    // Second ghost ring
    if (wp.radius > 40) {
      stroke(c[0], c[1], c[2], fade * 0.35);
      strokeWeight(0.5);
      let r2 = wp.radius - 30;
      beginShape();
      for (let j = 0; j <= 60; j++) {
        let angle = (j / 60) * TWO_PI;
        vertex(r2 * cos(angle), wp.y, r2 * sin(angle));
      }
      endShape(CLOSE);
    }
  }

  pop();
}

// ═══════════════════════════════════════════
// 10. FLOW PARTICLES — tracing Rolle curves
// ═══════════════════════════════════════════
function drawFlowParticles(breath) {
  push();
  noStroke();

  for (let p of flowParticles) {
    p.param += p.speed;
    if (p.param > 1) p.param -= 1;

    let x = p.param;
    let fVal = rolleF(x, p.curveType);
    let copiesPerType = 3;
    let copyIdx = floor(p.radialAngle / TWO_PI * copiesPerType) % copiesPerType;

    let baseAngle = (p.curveType * copiesPerType + copyIdx) / (6 * copiesPerType) * TWO_PI + t * 0.01;
    let spanAngle = 0.4 + 0.08 * sin(t * 0.06 + p.curveType);
    let angle = baseAngle + (x - 0.5) * spanAngle + p.radialAngle * 0.3;
    let radius = 280 + 15 * sin(t * 0.09 + p.curveType * 0.7);
    let py = -fVal * 200;

    push();
    translate(radius * cos(angle), py, radius * sin(angle));

    let c = palColor(p.colorIdx + t * 0.003);
    let intensity = sin(x * PI);
    let alpha = (80 + 120 * intensity) * breath;
    fill(c[0], c[1], c[2], alpha);
    sphere(p.size * (0.6 + 0.5 * intensity));
    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// 11. COMET TRAILS — particles with fading
//     motion-trail histories
// ═══════════════════════════════════════════
function drawCometTrails(breath) {
  push();
  noStroke();

  for (let comet of cometParticles) {
    comet.param += comet.speed;
    if (comet.param > 1) comet.param -= 1;

    let x = comet.param;
    let fVal = rolleFMorph(x, t + comet.orbitPhase);
    let angle = comet.orbitPhase + x * TWO_PI * 1.5 + t * 0.04;
    let r = comet.orbitRadius + fVal * 50;
    let py = (x - 0.5) * 280 * fVal + comet.orbitTilt * 80;

    let px = r * cos(angle);
    let pz = r * sin(angle);

    // Store trail
    comet.trail.push({ x: px, y: py, z: pz });
    if (comet.trail.length > comet.trailMax) comet.trail.shift();

    // Draw trail (fading tail)
    let c = palColor(comet.colorIdx + t * 0.002);
    for (let ti = 0; ti < comet.trail.length; ti++) {
      let tp = comet.trail[ti];
      let trailFade = ti / comet.trail.length;
      let a = trailFade * trailFade * 110 * breath;
      let sz = comet.size * trailFade * 0.7;

      push();
      translate(tp.x, tp.y, tp.z);
      fill(c[0], c[1], c[2], a);
      sphere(sz);
      pop();
    }

    // Bright head
    push();
    translate(px, py, pz);
    fill(220, 215, 245, 170 * breath);
    sphere(comet.size * 0.5);
    fill(c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 90 * breath);
    sphere(comet.size * 1.1);
    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// 12. ORBITING HALOS — tilted rings
//     orbiting the structure at various angles
// ═══════════════════════════════════════════
function drawOrbitingHalos(breath) {
  push();
  noFill();

  let numHalos = 5;
  for (let h = 0; h < numHalos; h++) {
    push();

    let tiltX = sin(h * 1.3 + t * 0.012) * 0.5;
    let tiltZ = cos(h * 0.9 + t * 0.009) * 0.4;
    rotateX(tiltX);
    rotateZ(tiltZ);
    rotateY(t * 0.006 * (h % 2 === 0 ? 1 : -1) + h * 0.7);

    let radius = 350 + h * 40 + 15 * sin(t * 0.06 + h);
    let c = palColor(h / numHalos + 0.1 + t * 0.002);
    let alpha = (18 + 12 * sin(t * 0.15 + h * 1.2)) * breath;

    stroke(c[0], c[1], c[2], alpha);
    strokeWeight(0.7 + 0.3 * sin(t * 0.08 + h));

    beginShape();
    for (let i = 0; i <= 100; i++) {
      let angle = (i / 100) * TWO_PI;
      let x01 = (i / 100);
      let modulation = 1 + 0.06 * rolleF(x01, h % 6) * sin(t * 0.15 + h);
      vertex(radius * cos(angle) * modulation, 0, radius * sin(angle) * modulation);
    }
    endShape(CLOSE);

    pop();
  }

  pop();
}

// ═══════════════════════════════════════════
// 13. ENDPOINT CONNECTIONS
//     Visual proof: f(a) = f(b) — paired orbs
// ═══════════════════════════════════════════
function drawEndpointConnections(breath) {
  push();

  let numPairs = 12;
  let surfaceRadius = 130;
  let totalHeight = 320;

  for (let i = 0; i < numPairs; i++) {
    let angle = (i / numPairs) * TWO_PI + t * 0.012;
    let rEnd = surfaceRadius * 0.15;
    let yTop = -0.5 * totalHeight;
    let yBot = 0.5 * totalHeight;

    let pulse = 1 + 0.15 * sin(t * 0.4 + i * 0.5);

    // Top endpoint (a)
    push();
    translate(rEnd * cos(angle), yTop, rEnd * sin(angle));
    let c1 = palColor(0.15 + i * 0.03);
    noStroke();
    fill(c1[0], c1[1], c1[2], 130 * breath);
    sphere(4 * pulse);
    pop();

    // Bottom endpoint (b)
    push();
    translate(rEnd * cos(angle), yBot, rEnd * sin(angle));
    let c2 = palColor(0.65 + i * 0.03);
    noStroke();
    fill(c2[0], c2[1], c2[2], 130 * breath);
    sphere(4 * pulse);
    pop();

    // Connecting thread
    stroke(200, 192, 233, 15 * breath);
    strokeWeight(0.4);
    line(
      rEnd * cos(angle), yTop, rEnd * sin(angle),
      rEnd * cos(angle), yBot, rEnd * sin(angle)
    );
  }

  pop();
}

// ═══════════════════════════════════════════
// 14. CENTRAL AXIS — the [a,b] interval
// ═══════════════════════════════════════════
function drawCentralAxis(breath) {
  push();

  let totalHeight = 320;
  let yTop = -0.5 * totalHeight;
  let yBot = 0.5 * totalHeight;

  // Main axis
  stroke(145, 108, 204, 25 * breath);
  strokeWeight(1);
  line(0, yTop - 30, 0, 0, yBot + 30, 0);

  // Gentle pulsing rings at center (the critical c)
  noFill();
  let pulse = 1 + 0.2 * sin(t * 0.5);
  let peakY = -rolleFMorph(0.5, t) * 200;

  for (let r = 0; r < 3; r++) {
    let radius = (8 + r * 6) * pulse;
    let c = palColor(0.4 + r * 0.1);
    stroke(c[0], c[1], c[2], (50 - r * 12) * breath);
    strokeWeight(1.5 - r * 0.3);

    beginShape();
    for (let i = 0; i <= 40; i++) {
      let angle = (i / 40) * TWO_PI;
      vertex(radius * cos(angle), peakY, radius * sin(angle));
    }
    endShape(CLOSE);
  }

  // Markers at a and b
  let markerSize = 8;
  stroke(200, 192, 233, 40 * breath);
  strokeWeight(1);
  line(-markerSize, yTop, 0, markerSize, yTop, 0);
  line(0, yTop, -markerSize, 0, yTop, markerSize);
  line(-markerSize, yBot, 0, markerSize, yBot, 0);
  line(0, yBot, -markerSize, 0, yBot, markerSize);

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
  a.download = 'rolles_theorem.mp4';
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

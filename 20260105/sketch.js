let particles = [];
let connections = [];
let helixParticles = [];
let stars = [];
let time = 0;
const PHI = (1 + Math.sqrt(5)) / 2; // Golden ratio

const colors = [
  '#0a0a2e', // 0 deep navy
  '#1a0a4e', // 1 dark purple
  '#2d0a6e', // 2 purple
  '#4b0082', // 3 indigo
  '#7b2fff', // 4 violet
  '#00d4ff', // 5 cyan
  '#00ff87', // 6 mint
  '#ff2d7a', // 7 magenta
  '#ff6b35', // 8 orange
];
const numParticles = 450;
const numHelixParticles = 40;
const numStars = 150;
const connectionDistance = 90;
const maxConnectionsPerParticle = 3;

function setup() {
  createCanvas(720, 1280, WEBGL);
  smooth();
  colorMode(RGB, 255);
  frameRate(60); // Target 60fps for smooth animation

  // Optimize sphere rendering detail for better performance
  setAttributes('antialias', true);

  // Create multiple layers of particles with different mathematical patterns
  for (let i = 0; i < numParticles; i++) {
    let layer = floor(i / (numParticles / 3));
    particles.push(new Particle(i, layer));
  }

  // Create DNA helix particles
  for (let i = 0; i < numHelixParticles; i++) {
    helixParticles.push(new HelixParticle(i));
  }

  // Create background stars
  for (let i = 0; i < numStars; i++) {
    stars.push({
      x: random(-800, 800),
      y: random(-1000, 1000),
      z: random(-800, -400),
      size: random(1, 3),
      brightness: random(100, 255),
      twinkleSpeed: random(0.02, 0.05),
      twinkleOffset: random(TWO_PI)
    });
  }
}

function draw() {
  // Beautiful gradient background
  setGradientBackground();

  // Draw twinkling stars in background
  drawStars();

  // Smoother camera view with gentle breathing
  let camZ = 400 + sin(time * 0.2) * 30; // Slower, gentler breathing
  camera(0, 0, camZ, 0, 0, 0, 0, 1, 0);

  // Enhanced lighting setup with color-shifting lights
  ambientLight(50, 50, 70);

  // Smoother animated colored lights
  let light1Color = lerpColor(color(colors[2]), color(colors[4]), sin(time * 0.3) * 0.5 + 0.5);
  let light2Color = lerpColor(color(colors[6]), color(colors[8]), cos(time * 0.2) * 0.5 + 0.5);
  let light3Color = lerpColor(color(colors[1]), color(colors[7]), sin(time * 0.4) * 0.5 + 0.5);

  pointLight(red(light1Color), green(light1Color), blue(light1Color),
             300 * sin(time * 0.3), -200, 300);
  pointLight(red(light2Color), green(light2Color), blue(light2Color),
             -300 * cos(time * 0.2), 200, -200);
  pointLight(red(light3Color) * 0.8, green(light3Color) * 0.8, blue(light3Color) * 0.8,
             0, 200 * sin(time * 0.25), -300);
  directionalLight(120, 120, 160, -0.5, 0.5, -1);

  // Smoother, gentler rotation
  let camX = sin(time * 0.08) * 0.25;
  let camY = cos(time * 0.05) * 0.15;
  rotateY(camX + time * 0.05);
  rotateX(camY + sin(time * 0.03) * 0.08);
  rotateZ(sin(time * 0.02) * 0.03);

  // Draw energy waves
  drawEnergyWaves();

  // Draw central sacred geometry (render every frame for smooth rotation)
  drawSacredGeometry();

  // Draw DNA double helix (update every frame, but optimized detail)
  for (let h of helixParticles) {
    h.update();
    h.display();
  }

  // Optimized connection detection - only check every 4 frames and limit connections
  if (frameCount % 4 === 0) {
    connections = [];
    for (let i = 0; i < particles.length; i++) {
      let connectionCount = 0;
      for (let j = i + 1; j < particles.length && connectionCount < maxConnectionsPerParticle; j += 3) {
        let dx = particles[i].x - particles[j].x;
        let dy = particles[i].y - particles[j].y;
        let dz = particles[i].z - particles[j].z;
        let dSquared = dx * dx + dy * dy + dz * dz;
        let distSquared = connectionDistance * connectionDistance;

        if (dSquared < distSquared) {
          connections.push({
            p1: particles[i],
            p2: particles[j],
            distance: sqrt(dSquared)
          });
          connectionCount++;
        }
      }
    }
  }

  // Draw connections with gradient colors
  drawConnections();

  // Update and display particles
  for (let p of particles) {
    p.update();
    p.display();
  }

  // Draw ethereal outer rings (smooth every frame)
  drawMathematicalRings();

  // Draw bloom effect particles
  drawBloomParticles();

  time += 0.008; // Slower, smoother animation speed
}

function setGradientBackground() {
  // Smooth gradient background every frame
  push();
  translate(0, 0, -600);
  noStroke();

  let c1 = color(10, 10, 15);
  let c2 = color(20 + sin(time * 0.2) * 10, 15 + cos(time * 0.3) * 10, 30 + sin(time * 0.1) * 15);

  for (let y = -height; y < height; y += 100) {
    let inter = map(y, -height, height, 0, 1);
    let c = lerpColor(c1, c2, inter);
    fill(c);
    rect(-width, y, width * 2, 100);
  }
  pop();
}

function drawStars() {
  // Draw twinkling background stars
  push();
  noStroke();

  for (let star of stars) {
    let twinkle = sin(time * star.twinkleSpeed * 60 + star.twinkleOffset) * 0.5 + 0.5;
    let alpha = star.brightness * twinkle;

    // Star color with slight blue/purple tint
    let starColor = lerpColor(color(200, 200, 255), color(colors[6]), twinkle * 0.3);

    fill(red(starColor), green(starColor), blue(starColor), alpha);

    push();
    translate(star.x, star.y, star.z);
    sphere(star.size, 4, 4);
    pop();
  }
  pop();
}

function drawEnergyWaves() {
  // Smoother pulsing energy waves
  push();
  noFill();

  for (let w = 0; w < 3; w++) {
    let wavePhase = time * 1.5 + w * TWO_PI / 3;
    let waveRadius = (time * 40 + w * 100) % 300;
    let waveAlpha = map(waveRadius, 0, 300, 80, 0);

    let waveColor = color(colors[(w + floor(time * 1.5)) % colors.length]);

    stroke(red(waveColor), green(waveColor), blue(waveColor), waveAlpha);
    strokeWeight(1.5);

    // Draw expanding wave with smoother motion
    push();
    rotateY(wavePhase * 0.5);
    rotateX(wavePhase * 0.3);

    beginShape();
    for (let i = 0; i <= 360; i += 15) {
      let angle = radians(i);
      let x = cos(angle) * waveRadius;
      let y = sin(angle) * waveRadius;
      let z = sin(angle * 3 + wavePhase) * 15;
      vertex(x, y, z);
    }
    endShape(CLOSE);
    pop();
  }
  pop();
}

function drawSacredGeometry() {
  push();

  // Smoothly rotating icosahedron
  let morphAmount = sin(time * 0.7) * 0.5 + 0.5;
  let size = 60 + sin(time * 1.5) * 15;

  rotateY(time * 0.4);
  rotateX(time * 0.25);
  rotateZ(time * 0.15);

  // Wireframe with gradient color
  noFill();
  let geomColor = lerpColor(color(colors[2]), color(colors[5]), morphAmount);
  stroke(red(geomColor), green(geomColor), blue(geomColor), 150);
  strokeWeight(1.5);

  // Draw icosahedron with pulsing effect
  drawIcosahedron(size);

  // Inner rotating octahedron (slower, smoother)
  push();
  rotateY(-time * 0.5);
  rotateX(-time * 0.3);
  let innerColor = lerpColor(color(colors[6]), color(colors[8]), 1 - morphAmount);
  stroke(red(innerColor), green(innerColor), blue(innerColor), 120);
  strokeWeight(1);
  drawOctahedron(size * 0.6);
  pop();

  pop();
}

function drawIcosahedron(r) {
  // Simplified icosahedron using mathematical formula
  let t = (1 + sqrt(5)) / 2; // Golden ratio
  let vertices = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ];

  // Draw edges
  let edges = [
    [0,11],[0,5],[0,1],[0,7],[0,10],[1,5],[1,9],[1,7],[1,8],
    [2,11],[2,10],[2,3],[2,6],[3,9],[3,4],[3,6],[4,9],[4,5],[4,11],[5,11],
    [6,10],[6,7],[6,8],[7,8],[8,9],[10,11]
  ];

  for (let e of edges) {
    let v1 = vertices[e[0]];
    let v2 = vertices[e[1]];
    line(v1[0] * r, v1[1] * r, v1[2] * r, v2[0] * r, v2[1] * r, v2[2] * r);
  }
}

function drawOctahedron(r) {
  // Octahedron vertices
  beginShape(LINES);
  vertex(r, 0, 0); vertex(0, r, 0);
  vertex(r, 0, 0); vertex(0, -r, 0);
  vertex(r, 0, 0); vertex(0, 0, r);
  vertex(r, 0, 0); vertex(0, 0, -r);
  vertex(-r, 0, 0); vertex(0, r, 0);
  vertex(-r, 0, 0); vertex(0, -r, 0);
  vertex(-r, 0, 0); vertex(0, 0, r);
  vertex(-r, 0, 0); vertex(0, 0, -r);
  vertex(0, r, 0); vertex(0, 0, r);
  vertex(0, r, 0); vertex(0, 0, -r);
  vertex(0, -r, 0); vertex(0, 0, r);
  vertex(0, -r, 0); vertex(0, 0, -r);
  endShape();
}

function drawBloomParticles() {
  // Smooth bloom particles with enhanced glow
  push();
  for (let i = 0; i < 6; i++) {
    let angle = time * 0.4 + i * TWO_PI / 6;
    let radius = 200 + sin(time * 1.5 + i) * 40;
    let x = cos(angle) * radius;
    let y = sin(angle) * radius;
    let z = sin(time * 0.8 + i * 0.5) * 80;

    // Smoother color cycling through palette
    let colorIndex1 = (i * 2 + floor(time * 2)) % colors.length;
    let colorIndex2 = (i * 2 + 1 + floor(time * 2)) % colors.length;
    let colorMix = sin(time * 1.5 + i) * 0.5 + 0.5;
    let particleColor = lerpColor(color(colors[colorIndex1]), color(colors[colorIndex2]), colorMix);

    // Enhanced multi-layer glow
    for (let g = 2; g > 0; g--) {
      push(); 
      translate(x, y, z);

      let glowIntensity = 30 / g * (sin(time * 3 + i) * 0.3 + 0.7);
      fill(red(particleColor), green(particleColor), blue(particleColor), glowIntensity);
      noStroke();
      sphere(8 * g, 6, 5);
      pop();
    }
  }
  pop();
}

function drawConnections() {
  for (let conn of connections) {
    let alpha = map(conn.distance, 0, connectionDistance, 120, 0);

    // Enhanced color mixing with gradient
    let c1 = conn.p1.currentColor || conn.p1.color;
    let c2 = conn.p2.currentColor || conn.p2.color;
    let avgColor = lerpColor(c1, c2, 0.5);

    // Add rainbow shimmer effect
    let shimmer = sin(time * 3 + conn.distance * 0.1) * 0.5 + 0.5;
    let shimmerColor = lerpColor(avgColor, color(colors[floor(time * 5) % colors.length]), shimmer * 0.1);

    stroke(red(shimmerColor), green(shimmerColor), blue(shimmerColor), alpha * 0.5);
    strokeWeight(map(conn.distance, 0, connectionDistance, 2, 0.3));

    line(conn.p1.x, conn.p1.y, conn.p1.z,
         conn.p2.x, conn.p2.y, conn.p2.z);
  }
}

function drawMathematicalRings() {
  // Draw 2 torus-like rings with parametric equations (optimized)
  for (let ring = 0; ring < 2; ring++) {
    push();
    noFill();

    let ringColor = color(colors[ring * 3]);
    stroke(red(ringColor), green(ringColor), blue(ringColor), 30);
    strokeWeight(1);

    rotateX(time * 0.2 + ring * PI / 3);
    rotateY(time * 0.15 + ring * PI / 4);

    // Parametric torus equation (fewer vertices for performance)
    let R = 250 + ring * 40; // Major radius
    let r = 20 + ring * 5;   // Minor radius

    beginShape();
    for (let i = 0; i <= 360; i += 8) { // Increased step for fewer vertices
      let theta = radians(i);
      let modulation = sin(theta * 3 + time * 2) * 10;

      let x = (R + (r + modulation) * cos(theta)) * cos(theta);
      let y = (R + (r + modulation) * cos(theta)) * sin(theta);
      let z = (r + modulation) * sin(theta) * sin(time * 0.5 + ring);

      vertex(x, y, z);
    }
    endShape(CLOSE);
    pop();
  }
}

class Particle {
  constructor(index, layer) {
    this.index = index;
    this.layer = layer;
    this.baseRadius = 120 + layer * 40;

    // Fibonacci sphere distribution
    this.phi = Math.acos(1 - 2 * (index + 0.5) / numParticles);
    this.theta = PI * PHI * index;

    // Color based on layer and position
    let colorIndex = floor(map(this.phi, 0, PI, 0, colors.length - 1));
    this.color = color(colors[colorIndex]);

    this.size = random(2, 6);
    this.noiseOffset = random(1000);

    // Trail history for motion blur effect (optimized)
    this.trail = [];
    this.maxTrailLength = 3;
  }

  update() {
    // Mathematical formula: Multiple harmonic patterns
    let t = time + this.noiseOffset * 0.01;

    // Layer-specific harmonic coefficients
    let m = 2 + this.layer;
    let n = 3 + this.layer;

    // Complex spherical harmonics
    let harmonic1 = sin(m * this.theta + t) * cos(n * this.phi + t * 0.5);
    let harmonic2 = cos(m * this.phi - t * 0.3) * sin(n * this.theta - t * 0.7);

    // Wave modulation with Fibonacci sequence influence
    let fibMod = sin(this.index * PHI * 0.1 + t * 2) * 0.3;

    // 3D Perlin noise for organic movement
    let noiseScale = 0.5;
    let noiseModulation = noise(
      cos(this.theta) * noiseScale + t * 0.3,
      sin(this.phi) * noiseScale + t * 0.2,
      this.index * 0.005 + t * 0.1
    ) - 0.5;

    // Combine all modulations
    let radiusModulation = harmonic1 * 0.25 + harmonic2 * 0.15 + fibMod + noiseModulation * 0.4;
    this.currentRadius = this.baseRadius * (1 + radiusModulation);

    // Store previous position for trail (less frequent updates)
    if (frameCount % 4 === 0) {
      this.trail.push({x: this.x, y: this.y, z: this.z});
      if (this.trail.length > this.maxTrailLength) {
        this.trail.shift();
      }
    }

    // Spherical to Cartesian conversion
    this.x = this.currentRadius * sin(this.phi) * cos(this.theta);
    this.y = this.currentRadius * sin(this.phi) * sin(this.theta);
    this.z = this.currentRadius * cos(this.phi);

    // Enhanced Lissajous curves with different frequencies per layer
    let freq1 = 3 + this.layer * 0.5;
    let freq2 = 2 + this.layer * 0.3;
    let freq3 = 5 + this.layer * 0.7;

    let lissajousX = sin(freq1 * t + this.index * 0.05) * 25;
    let lissajousY = sin(freq2 * t + this.index * 0.03) * 25;
    let lissajousZ = sin(freq3 * t + this.index * 0.07) * 25;

    this.x += lissajousX;
    this.y += lissajousY;
    this.z += lissajousZ;

    // Pulsating size with golden ratio rhythm
    this.currentSize = this.size * (1 + sin(t * PHI * 2 + this.index * 0.1) * 0.4);

    // Color shift based on movement
    let colorShift = map(sin(t + this.index * 0.1), -1, 1, -30, 30);
    this.currentColor = color(
      red(this.color) + colorShift,
      green(this.color) + colorShift,
      blue(this.color) + colorShift
    );
  }

  display() {
    // Depth-based effects for better visual depth
    let depthFactor = map(this.z, -300, 300, 0.6, 1.4);
    let visualSize = this.currentSize * depthFactor;

    // Draw motion trail with depth
    if (this.trail.length > 1) {
      for (let i = 0; i < this.trail.length - 1; i++) {
        let alpha = map(i, 0, this.trail.length, 0, 80) * depthFactor;
        stroke(red(this.currentColor), green(this.currentColor), blue(this.currentColor), alpha);
        strokeWeight(map(i, 0, this.trail.length, 0.5, 2) * depthFactor);

        line(this.trail[i].x, this.trail[i].y, this.trail[i].z,
             this.trail[i + 1].x, this.trail[i + 1].y, this.trail[i + 1].z);
      }
    }

    push();
    translate(this.x, this.y, this.z);

    // Enhanced glow effect with color cycling
    let glowIntensity = map(sin(time * 2 + this.index * 0.1), -1, 1, 0.3, 0.8);
    let colorCycle = sin(time * 0.5 + this.index * 0.05) * 0.5 + 0.5;

    // Subtle color shift for more variety
    let shiftedColor = lerpColor(this.currentColor, color(colors[(this.index + floor(time * 10)) % colors.length]), colorCycle * 0.2);

    ambientMaterial(shiftedColor);
    emissiveMaterial(
      red(shiftedColor) * glowIntensity,
      green(shiftedColor) * glowIntensity,
      blue(shiftedColor) * glowIntensity
    );

    // Main particle sphere with depth-based size
    noStroke();
    sphere(visualSize, 12, 8);

    // Add subtle rotating halo for select particles (optimized)
    if (this.index % 20 === 0) {
      push();
      rotateY(time * 2);
      rotateX(time * 1.5);

      noFill();
      stroke(red(this.currentColor), green(this.currentColor), blue(this.currentColor), 80);
      strokeWeight(0.5);

      // Simplified golden spiral (fewer points)
      beginShape();
      for (let i = 0; i < 30; i += 2) {
        let angle = i * PHI * 0.5;
        let radius = this.currentSize * 2 * sqrt(i * 0.5);
        let px = radius * cos(angle);
        let py = radius * sin(angle);
        vertex(px, py, 0);
      }
      endShape();

      pop();
    }

    pop();
  }
}

class HelixParticle {
  constructor(index) {
    this.index = index;
    this.offset = (index / numHelixParticles) * TWO_PI * 3;
    this.colorIndex = floor(map(index, 0, numHelixParticles, 0, colors.length));
    this.color = color(colors[this.colorIndex]);
  }

  update() {
    // Smoother DNA Double Helix parametric equations
    let t = time * 0.4 + this.offset;
    let helixRadius = 40;
    let helixHeight = 400;
    let verticalPos = ((this.index / numHelixParticles) - 0.5) * helixHeight;

    // First strand
    this.x1 = cos(t) * helixRadius;
    this.z1 = sin(t) * helixRadius;
    this.y1 = verticalPos + sin(time * 1.5) * 15;

    // Second strand (opposite phase)
    this.x2 = cos(t + PI) * helixRadius;
    this.z2 = sin(t + PI) * helixRadius;
    this.y2 = verticalPos + sin(time * 1.5) * 15;

    // Gentler pulsating effect
    this.size = 4 + sin(time * 2 + this.offset) * 0.8;
  }

  display() {
    // Draw connecting rung between strands (less frequently)
    if (this.index % 5 === 0) {
      stroke(red(this.color), green(this.color), blue(this.color), 100);
      strokeWeight(1);
      line(this.x1, this.y1, this.z1, this.x2, this.y2, this.z2);
    }

    // Optimized sphere detail for helix particles
    let detail = 8;

    // First strand particle
    push();
    translate(this.x1, this.y1, this.z1);
    ambientMaterial(this.color);
    emissiveMaterial(red(this.color) * 0.4, green(this.color) * 0.4, blue(this.color) * 0.4);
    noStroke();
    sphere(this.size, detail, detail);
    pop();

    // Second strand particle
    push();
    translate(this.x2, this.y2, this.z2);
    ambientMaterial(this.color);
    emissiveMaterial(red(this.color) * 0.4, green(this.color) * 0.4, blue(this.color) * 0.4);
    noStroke();
    sphere(this.size, detail, detail);
    pop();
  }
}

let time = 0;
let phi;
let particles = [];
let energyBeams = [];

function setup() {
  createCanvas(720, 1280, WEBGL);

  // Calculate golden ratio
  phi = (1 + sqrt(5)) / 2;

  // Create flowing particles for golden spiral
  for (let i = 0; i < 60; i++) {
    particles.push({
      progress: random(1),
      speed: random(0.003, 0.008),
      offset: random(TWO_PI)
    });
  }

  // Create energy beams
  for (let i = 0; i < 5; i++) {
    energyBeams.push({
      angle: i * TWO_PI / 5,
      phase: random(TWO_PI)
    });
  }
}

function draw() {
  // Clear background
  background(0);

  time += 0.008;

  // Dynamic lighting with pulsation
  ambientLight(50);
  let lightPulse = sin(time * 2) * 100 + 200;
  pointLight(255, 255, 255, lightPulse, -400, 400);
  pointLight(200, 200, 200, -lightPulse, 300, -200);

  // Smooth camera rotation
  let camX = sin(time * 0.2) * 450;
  let camY = -100 + sin(time * 0.1) * 50;
  let camZ = cos(time * 0.2) * 450 + 300;
  camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);

  // Expanding energy waves from center
  drawEnergyWaves();

  // Metatron's Cube with pulsation
  push();
  let cubePulse = 1 + sin(time * 1.5) * 0.15;
  scale(cubePulse);
  rotateY(time * 0.5);
  rotateX(time * 0.3);
  drawMetatronsCube();
  pop();

  // Flower of Life with breathing effect
  push();
  translate(0, 0, -150);
  rotateY(time * 0.4);
  let flowerPulse = 1 + sin(time * 2) * 0.1;
  scale(flowerPulse);
  drawFlowerOfLife(120, 2);
  pop();

  // Five Platonic Solids with energy connections
  drawPlatonicSolids();

  // Energy beams connecting solids
  drawEnergyBeams();

  // Golden spiral with flowing particles
  push();
  rotateZ(time * 0.3);
  drawGoldenSpiral();
  drawSpiralParticles();
  pop();

  // Seed of Life with pulsation
  push();
  translate(0, 300, 0);
  rotateX(PI / 2);
  rotateZ(time * 0.6);
  let seedPulse = 1 + sin(time * 2.5) * 0.12;
  scale(seedPulse);
  drawSeedOfLife(80);
  pop();

  // Vesica Piscis with glow
  push();
  translate(0, -300, 0);
  rotateX(PI / 2);
  rotateZ(-time * 0.5);
  drawVesicaPiscis(90);
  pop();

  // Sacred circles with rotation
  drawSacredCircles();

  // Orbiting light particles
  drawOrbitingParticles();

  // Connecting geometric lines
  drawGeometricConnections();
}

// Expanding energy waves
function drawEnergyWaves() {
  noFill();

  for (let i = 0; i < 3; i++) {
    let waveTime = (time * 0.5 + i * 0.5) % 2;
    let waveRadius = waveTime * 400;
    let waveAlpha = (1 - waveTime / 2) * 150;

    stroke(255, waveAlpha);
    strokeWeight(2);

    push();
    rotateX(PI / 2);
    circle(0, 0, waveRadius * 2);
    pop();
  }
}

// Metatron's Cube with glow
function drawMetatronsCube() {
  noFill();
  let radius = 100;
  let centers = [];

  // Center circle
  centers.push(createVector(0, 0, 0));

  // Inner 6 circles
  for (let i = 0; i < 6; i++) {
    let angle = i * TWO_PI / 6;
    centers.push(createVector(
      cos(angle) * radius,
      sin(angle) * radius,
      0
    ));
  }

  // Outer 6 circles
  for (let i = 0; i < 6; i++) {
    let angle = i * TWO_PI / 6 + PI / 6;
    centers.push(createVector(
      cos(angle) * radius * 2,
      sin(angle) * radius * 2,
      0
    ));
  }

  // Draw circles with pulsating glow
  for (let i = 0; i < centers.length; i++) {
    let pulse = sin(time * 3 + i * 0.5) * 0.3 + 0.7;

    // Outer glow
    stroke(255, 80 * pulse);
    strokeWeight(3);
    push();
    translate(centers[i].x, centers[i].y, centers[i].z);
    circle(0, 0, radius * 1.1);
    pop();

    // Main circle
    stroke(255, 200 * pulse);
    strokeWeight(1);
    push();
    translate(centers[i].x, centers[i].y, centers[i].z);
    circle(0, 0, radius);
    pop();
  }

  // Connecting lines with animation
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      let lineAlpha = sin(time * 2 + i + j) * 50 + 130;
      stroke(255, lineAlpha);
      strokeWeight(0.8);
      line(centers[i].x, centers[i].y, centers[i].z,
           centers[j].x, centers[j].y, centers[j].z);
    }
  }
}

// Flower of Life with animated opacity
function drawFlowerOfLife(radius, layers) {
  strokeWeight(1);
  noFill();

  // Center circle with glow
  let centerPulse = sin(time * 3) * 0.5 + 0.5;
  stroke(255, 200);
  strokeWeight(2);
  circle(0, 0, radius * 2);

  stroke(255, 100 * centerPulse);
  strokeWeight(4);
  circle(0, 0, radius * 2.2);

  // Hexagonal pattern with wave animation
  strokeWeight(1);
  for (let layer = 1; layer <= layers; layer++) {
    for (let i = 0; i < 6; i++) {
      let angle = i * TWO_PI / 6;
      let x = cos(angle) * radius * layer;
      let y = sin(angle) * radius * layer;

      let circleAlpha = sin(time * 2 + layer + i) * 60 + 140;
      stroke(255, circleAlpha);
      circle(x, y, radius * 2);

      if (layer > 1) {
        for (let j = 1; j < layer; j++) {
          let x2 = cos(angle) * radius * j;
          let y2 = sin(angle) * radius * j;
          let alpha = sin(time * 2 + j + i) * 50 + 120;
          stroke(255, alpha);
          circle(x2, y2, radius * 2);
        }
      }
    }
  }
}

// Platonic Solids with trails
function drawPlatonicSolids() {
  let orbitRadius = 280;

  for (let i = 0; i < 5; i++) {
    let angle = i * TWO_PI / 5 + time * 0.3;
    let x = cos(angle) * orbitRadius;
    let y = sin(angle * 1.3 + time * 0.2) * 100;
    let z = sin(angle) * orbitRadius;

    // Glow effect
    push();
    translate(x, y, z);

    let glowSize = 60 + sin(time * 3 + i) * 15;
    stroke(255, 40);
    strokeWeight(8);
    point(0, 0, 0);

    rotateX(time * 0.7 + i);
    rotateY(time * 0.5 + i);
    rotateZ(time * 0.6 + i);

    // Pulsating effect
    let pulse = 1 + sin(time * 2.5 + i) * 0.2;
    scale(pulse);

    stroke(255, 220);
    strokeWeight(1.5);
    noFill();

    let size = 40;

    if (i === 0) {
      drawTetrahedron(size);
    } else if (i === 1) {
      box(size);
    } else if (i === 2) {
      drawOctahedron(size);
    } else if (i === 3) {
      drawDodecahedron(size);
    } else {
      drawIcosahedron(size);
    }
    pop();
  }
}

// Energy beams between platonic solids
function drawEnergyBeams() {
  stroke(255, 80);
  strokeWeight(1);

  let orbitRadius = 280;
  let positions = [];

  for (let i = 0; i < 5; i++) {
    let angle = i * TWO_PI / 5 + time * 0.3;
    let x = cos(angle) * orbitRadius;
    let y = sin(angle * 1.3 + time * 0.2) * 100;
    let z = sin(angle) * orbitRadius;
    positions.push(createVector(x, y, z));
  }

  // Connect adjacent solids
  for (let i = 0; i < positions.length; i++) {
    let next = (i + 1) % positions.length;
    let beamAlpha = sin(time * 3 + i) * 40 + 60;
    stroke(255, beamAlpha);
    line(positions[i].x, positions[i].y, positions[i].z,
         positions[next].x, positions[next].y, positions[next].z);
  }
}

// Particles flowing along golden spiral
function drawSpiralParticles() {
  stroke(255, 200);
  strokeWeight(3);

  for (let p of particles) {
    p.progress += p.speed;
    if (p.progress > 1) p.progress = 0;

    let i = p.progress * 100;
    let angle = i * 0.3 + time + p.offset;
    let radius = pow(phi, angle / PI) * 5;

    let x = cos(angle) * radius;
    let y = i * 3 - 150;
    let z = sin(angle) * radius;

    // Pulsating particle
    let pulse = sin(time * 4 + p.offset) * 2 + 4;
    strokeWeight(pulse);

    point(x, y, z);
  }
}

// Orbiting light particles
function drawOrbitingParticles() {
  for (let i = 0; i < 20; i++) {
    let angle = i * TWO_PI / 20 + time;
    let radius = 200 + sin(time * 2 + i) * 50;
    let height = sin(time * 1.5 + i * 0.5) * 300;

    let x = cos(angle) * radius;
    let y = height;
    let z = sin(angle) * radius;

    let particleAlpha = sin(time * 3 + i) * 100 + 150;
    stroke(255, particleAlpha);
    strokeWeight(4);
    point(x, y, z);

    // Trail
    stroke(255, particleAlpha * 0.3);
    strokeWeight(1);
    let prevAngle = angle - 0.1;
    let px = cos(prevAngle) * radius;
    let pz = sin(prevAngle) * radius;
    line(x, y, z, px, y, pz);
  }
}

// Geometric connections
function drawGeometricConnections() {
  stroke(255, 50);
  strokeWeight(0.5);

  let numPoints = 8;
  for (let i = 0; i < numPoints; i++) {
    let angle1 = i * TWO_PI / numPoints + time * 0.4;
    let r1 = 350;
    let x1 = cos(angle1) * r1;
    let y1 = sin(time + i) * 200;
    let z1 = sin(angle1) * r1;

    // Connect to next point
    let angle2 = (i + 1) * TWO_PI / numPoints + time * 0.4;
    let x2 = cos(angle2) * r1;
    let y2 = sin(time + i + 1) * 200;
    let z2 = sin(angle2) * r1;

    let lineAlpha = sin(time * 2 + i) * 30 + 50;
    stroke(255, lineAlpha);
    line(x1, y1, z1, x2, y2, z2);
  }
}

// Tetrahedron
function drawTetrahedron(size) {
  let vertices = [
    createVector(0, -size, 0),
    createVector(size * 0.866, size * 0.5, 0),
    createVector(-size * 0.866, size * 0.5, 0),
    createVector(0, 0, size * 0.816)
  ];

  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      line(vertices[i].x, vertices[i].y, vertices[i].z,
           vertices[j].x, vertices[j].y, vertices[j].z);
    }
  }
}

// Octahedron
function drawOctahedron(size) {
  let vertices = [
    createVector(0, -size, 0),
    createVector(size, 0, 0),
    createVector(0, 0, size),
    createVector(-size, 0, 0),
    createVector(0, 0, -size),
    createVector(0, size, 0)
  ];

  let edges = [
    [0,1], [0,2], [0,3], [0,4],
    [5,1], [5,2], [5,3], [5,4],
    [1,2], [2,3], [3,4], [4,1]
  ];

  for (let edge of edges) {
    let v1 = vertices[edge[0]];
    let v2 = vertices[edge[1]];
    line(v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  }
}

// Dodecahedron
function drawDodecahedron(size) {
  let vertices = [];
  let a = size / 1.618;
  let b = size;
  let c = size * 1.618;

  vertices.push(createVector(a, a, a));
  vertices.push(createVector(a, a, -a));
  vertices.push(createVector(a, -a, a));
  vertices.push(createVector(a, -a, -a));
  vertices.push(createVector(-a, a, a));
  vertices.push(createVector(-a, a, -a));
  vertices.push(createVector(-a, -a, a));
  vertices.push(createVector(-a, -a, -a));

  vertices.push(createVector(0, b, c));
  vertices.push(createVector(0, b, -c));
  vertices.push(createVector(0, -b, c));
  vertices.push(createVector(0, -b, -c));

  vertices.push(createVector(b, c, 0));
  vertices.push(createVector(b, -c, 0));
  vertices.push(createVector(-b, c, 0));
  vertices.push(createVector(-b, -c, 0));

  vertices.push(createVector(c, 0, b));
  vertices.push(createVector(c, 0, -b));
  vertices.push(createVector(-c, 0, b));
  vertices.push(createVector(-c, 0, -b));

  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      let d = p5.Vector.dist(vertices[i], vertices[j]);
      if (d < size * 1.3) {
        line(vertices[i].x, vertices[i].y, vertices[i].z,
             vertices[j].x, vertices[j].y, vertices[j].z);
      }
    }
  }
}

// Icosahedron
function drawIcosahedron(size) {
  let vertices = [];
  let t = (1 + sqrt(5)) / 2 * size / 2;
  let s = size / 2;

  vertices.push(createVector(-s, t, 0));
  vertices.push(createVector(s, t, 0));
  vertices.push(createVector(-s, -t, 0));
  vertices.push(createVector(s, -t, 0));

  vertices.push(createVector(0, -s, t));
  vertices.push(createVector(0, s, t));
  vertices.push(createVector(0, -s, -t));
  vertices.push(createVector(0, s, -t));

  vertices.push(createVector(t, 0, -s));
  vertices.push(createVector(t, 0, s));
  vertices.push(createVector(-t, 0, -s));
  vertices.push(createVector(-t, 0, s));

  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      let d = p5.Vector.dist(vertices[i], vertices[j]);
      if (d < size * 1.2) {
        line(vertices[i].x, vertices[i].y, vertices[i].z,
             vertices[j].x, vertices[j].y, vertices[j].z);
      }
    }
  }
}

// Golden Spiral with glow
function drawGoldenSpiral() {
  noFill();

  // Outer glow
  stroke(255, 80);
  strokeWeight(4);
  beginShape();
  for (let i = 0; i < 100; i++) {
    let angle = i * 0.3 + time;
    let radius = pow(phi, angle / PI) * 5;
    let x = cos(angle) * radius;
    let y = i * 3 - 150;
    let z = sin(angle) * radius;
    vertex(x, y, z);
  }
  endShape();

  // Main spiral
  stroke(255, 200);
  strokeWeight(2);
  beginShape();
  for (let i = 0; i < 100; i++) {
    let angle = i * 0.3 + time;
    let radius = pow(phi, angle / PI) * 5;
    let x = cos(angle) * radius;
    let y = i * 3 - 150;
    let z = sin(angle) * radius;
    vertex(x, y, z);
  }
  endShape();
}

// Seed of Life with glow
function drawSeedOfLife(radius) {
  strokeWeight(1);
  noFill();

  let pulse = sin(time * 3) * 60 + 160;

  // Glow
  stroke(255, 60);
  strokeWeight(3);
  circle(0, 0, radius * 2.1);

  // Main circle
  stroke(255, pulse);
  strokeWeight(1.5);
  circle(0, 0, radius * 2);

  for (let i = 0; i < 6; i++) {
    let angle = i * TWO_PI / 6;
    let x = cos(angle) * radius;
    let y = sin(angle) * radius;

    let circleAlpha = sin(time * 2.5 + i) * 60 + 140;

    // Glow
    stroke(255, 50);
    strokeWeight(3);
    circle(x, y, radius * 2.1);

    // Main
    stroke(255, circleAlpha);
    strokeWeight(1.5);
    circle(x, y, radius * 2);
  }
}

// Vesica Piscis with animation
function drawVesicaPiscis(radius) {
  strokeWeight(1);
  noFill();

  let pulse = sin(time * 2.5) * 0.1 + 1;

  stroke(255, 140);
  circle(-radius / 2, 0, radius * 2 * pulse);
  circle(radius / 2, 0, radius * 2 * pulse);

  let h = radius * sqrt(3) / 2;
  stroke(255, 180);
  strokeWeight(2);
  line(0, h, 0, -h);

  strokeWeight(1);
  for (let i = 0; i < 6; i++) {
    let angle = i * TWO_PI / 6;
    let alpha = sin(time * 2 + i) * 50 + 100;
    stroke(255, alpha);

    push();
    rotateZ(angle);
    circle(-radius / 2, 0, radius * 2);
    circle(radius / 2, 0, radius * 2);
    pop();
  }
}

// Sacred circles with pulsation
function drawSacredCircles() {
  stroke(255, 100);
  strokeWeight(0.8);
  noFill();

  let maxRadius = 400;
  let circles = 12;

  for (let i = 1; i <= circles; i++) {
    let radius = (i / circles) * maxRadius;
    let pulse = 1 + sin(time * 2 + i * 0.3) * 0.15;
    let alpha = sin(time * 1.5 + i * 0.2) * 60 + 80;

    stroke(255, alpha);
    push();
    rotateY(time * 0.3 + i * 0.1);
    rotateX(PI / 2);
    circle(0, 0, radius * 2 * pulse);
    pop();
  }
}

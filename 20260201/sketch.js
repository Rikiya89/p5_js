// Canvas dimensions
const W = 1080;
const H = 1920;

// Recording variables
let encoder = null;
let muxer = null;
let isRecording = false;
let recordingFrameCount = 0;
let recordingStartTime = 0;
const FPS = 60;
const MAX_DURATION = 15; // seconds
const MAX_FRAMES = FPS * MAX_DURATION;

// Animation
let time = 0;

// 3D objects array
let boxes = [];
const NUM_BOXES = 80;

function setup() {
  createCanvas(W, H, WEBGL);
  frameRate(FPS);

  // Initialize boxes with random properties
  for (let i = 0; i < NUM_BOXES; i++) {
    boxes.push({
      x: random(-400, 400),
      y: random(-800, 800),
      z: random(-600, 600),
      size: random(30, 120),
      rotSpeed: random(0.005, 0.02),
      rotOffset: random(TWO_PI),
      orbitRadius: random(100, 500),
      orbitSpeed: random(0.003, 0.01),
      orbitOffset: random(TWO_PI),
      type: floor(random(3)) // 0: box, 1: sphere, 2: torus
    });
  }
}

function draw() {
  background(0);

  // Lighting setup for black and white aesthetic
  ambientLight(60);
  directionalLight(255, 255, 255, 0.5, 0.5, -1);
  directionalLight(150, 150, 150, -0.5, -0.5, 1);
  pointLight(255, 255, 255, 0, 0, 500);

  // Camera movement
  let camX = sin(time * 0.3) * 200;
  let camY = cos(time * 0.2) * 300;
  let camZ = 800 + sin(time * 0.15) * 200;
  camera(camX, camY, camZ, 0, 0, 0, 0, 1, 0);

  // Global rotation
  rotateY(time * 0.1);
  rotateX(sin(time * 0.15) * 0.3);

  // Draw central structure
  push();
  noFill();
  stroke(255);
  strokeWeight(1);
  rotateX(time * 0.2);
  rotateY(time * 0.15);
  rotateZ(time * 0.1);

  // Nested wireframe cubes
  for (let i = 0; i < 5; i++) {
    let s = 150 + i * 80 + sin(time + i) * 30;
    push();
    rotateX(time * 0.1 * (i % 2 === 0 ? 1 : -1));
    rotateY(time * 0.08 * (i % 2 === 0 ? -1 : 1));
    box(s);
    pop();
  }
  pop();

  // Draw floating objects
  for (let i = 0; i < boxes.length; i++) {
    let b = boxes[i];

    push();

    // Orbital movement
    let orbitAngle = time * b.orbitSpeed + b.orbitOffset;
    let ox = cos(orbitAngle) * b.orbitRadius;
    let oz = sin(orbitAngle) * b.orbitRadius;

    // Vertical oscillation
    let oy = b.y + sin(time * 0.5 + b.rotOffset) * 100;

    translate(ox, oy, oz);

    // Individual rotation
    rotateX(time * b.rotSpeed + b.rotOffset);
    rotateY(time * b.rotSpeed * 1.3);
    rotateZ(time * b.rotSpeed * 0.7);

    // Alternating fill/stroke for variety
    if (i % 3 === 0) {
      fill(255);
      noStroke();
    } else if (i % 3 === 1) {
      noFill();
      stroke(255);
      strokeWeight(1);
    } else {
      fill(30);
      stroke(255);
      strokeWeight(0.5);
    }

    // Draw shape based on type
    let s = b.size * (0.8 + sin(time + b.rotOffset) * 0.2);

    if (b.type === 0) {
      box(s);
    } else if (b.type === 1) {
      sphere(s * 0.5, 12, 8);
    } else {
      torus(s * 0.4, s * 0.15, 16, 8);
    }

    pop();
  }

  // Draw connecting lines between nearby objects
  stroke(255, 100);
  strokeWeight(0.5);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      let b1 = boxes[i];
      let b2 = boxes[j];

      let angle1 = time * b1.orbitSpeed + b1.orbitOffset;
      let angle2 = time * b2.orbitSpeed + b2.orbitOffset;

      let x1 = cos(angle1) * b1.orbitRadius;
      let z1 = sin(angle1) * b1.orbitRadius;
      let y1 = b1.y + sin(time * 0.5 + b1.rotOffset) * 100;

      let x2 = cos(angle2) * b2.orbitRadius;
      let z2 = sin(angle2) * b2.orbitRadius;
      let y2 = b2.y + sin(time * 0.5 + b2.rotOffset) * 100;

      let d = dist(x1, y1, z1, x2, y2, z2);

      if (d < 250) {
        let alpha = map(d, 0, 250, 150, 0);
        stroke(255, alpha);
        line(x1, y1, z1, x2, y2, z2);
      }
    }
  }

  // Draw particle ring
  push();
  rotateX(HALF_PI);
  rotateZ(time * 0.2);
  noFill();
  stroke(255);
  strokeWeight(2);

  beginShape();
  for (let a = 0; a < TWO_PI; a += 0.05) {
    let r = 600 + sin(a * 8 + time * 2) * 50 + cos(a * 12 - time) * 30;
    let x = cos(a) * r;
    let y = sin(a) * r;
    let z = sin(a * 6 + time) * 40;
    vertex(x, y, z);
  }
  endShape(CLOSE);
  pop();

  // Second ring
  push();
  rotateX(HALF_PI + 0.5);
  rotateY(time * 0.15);
  noFill();
  stroke(255, 150);
  strokeWeight(1);

  beginShape();
  for (let a = 0; a < TWO_PI; a += 0.03) {
    let r = 700 + sin(a * 5 - time * 1.5) * 60;
    let x = cos(a) * r;
    let y = sin(a) * r;
    let z = cos(a * 8 + time * 0.8) * 50;
    vertex(x, y, z);
  }
  endShape(CLOSE);
  pop();

  // Update time
  time += 0.016;

  // Handle recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;

    let elapsed = (Date.now() - recordingStartTime) / 1000;
    document.getElementById('duration').textContent = elapsed.toFixed(1);
    document.getElementById('frameCount').textContent = recordingFrameCount;

    if (recordingFrameCount >= MAX_FRAMES) {
      stopRecording();
    }
  }
}

// Start recording with MP4 encoding
async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('Your browser does not support WebCodecs API. Please use Chrome or Edge.');
    return;
  }

  isRecording = true;
  recordingFrameCount = 0;
  time = 0;
  recordingStartTime = Date.now();

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: W,
      height: H
    },
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
    bitrate: 8_000_000,
    framerate: FPS
  });

  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled = false;
  document.getElementById('status').textContent = 'Recording...';
  document.getElementById('status').style.color = '#ff6b6b';
}

// Stop recording and download MP4
async function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  document.getElementById('status').textContent = 'Processing...';
  document.getElementById('status').style.color = '#84bae7';

  await encoder.flush();
  muxer.finalize();

  let buffer = muxer.target.buffer;
  let blob = new Blob([buffer], { type: 'video/mp4' });

  let url = URL.createObjectURL(blob);
  let a = document.createElement('a');
  a.href = url;
  a.download = 'bw_3d_generative.mp4';
  a.click();
  URL.revokeObjectURL(url);

  encoder = null;
  muxer = null;

  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled = true;
  document.getElementById('status').textContent = 'Download started!';
  document.getElementById('status').style.color = '#916ccc';

  setTimeout(() => {
    document.getElementById('status').textContent = 'Ready';
    document.getElementById('status').style.color = '#84bae7';
  }, 3000);
}

// Capture frame for MP4 encoding
function captureFrame() {
  if (!isRecording || !encoder) return;

  const canvas = document.querySelector('canvas');
  const timestamp = recordingFrameCount * (1_000_000 / FPS);

  const frame = new VideoFrame(canvas, {
    timestamp: timestamp
  });

  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

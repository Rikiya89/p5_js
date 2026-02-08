// Perlin Noise Contour Pattern — Domain-Warped Topographic Lines
// GPU-accelerated via fragment shader

const W = 1080;
const H = 1920;

let theShader;
let seed = 0;

// Recording
let encoder = null;
let muxer = null;
let isRecording = false;
let recordingFrameCount = 0;
let recordingStartTime = 0;
const FPS = 60;
const MAX_DURATION = 30;
const MAX_FRAMES = FPS * MAX_DURATION;


function preload() {
  theShader = loadShader('shader.vert', 'shader.frag');
}

function setup() {
  createCanvas(W, H, WEBGL);
  pixelDensity(1);
  noStroke();
  seed = random(1000);

  const maxDurEl = document.getElementById('maxDuration');
  if (maxDurEl) maxDurEl.textContent = MAX_DURATION;
}

function draw() {
  shader(theShader);
  theShader.setUniform('u_resolution', [W, H]);
  theShader.setUniform('u_time', millis() / 1000.0);
  theShader.setUniform('u_seed', seed);
  rect(0, 0, W, H);

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;

    const elapsed = (Date.now() - recordingStartTime) / 1000;
    const durEl = document.getElementById('duration');
    const frEl = document.getElementById('frameCount');
    if (durEl) durEl.textContent = elapsed.toFixed(1);
    if (frEl) frEl.textContent = recordingFrameCount;

    if (recordingFrameCount >= MAX_FRAMES) {
      stopRecording();
    }
  }
}


// ─────────────────────────────────────────────────────────────
// Recording (WebCodecs + mp4-muxer)
// ─────────────────────────────────────────────────────────────
async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('Your browser does not support WebCodecs API.');
    return;
  }

  seed = random(1000);
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
  a.download = 'perlin_contour.mp4';
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

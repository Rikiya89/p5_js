// Serial Geometry — 3D Mathematical Generative Art
// Torus Knot × Superformula Grid × Icosahedron × Dodecahedron
// Canvas: 1080 × 1920 (portrait 9:16)

const W = 1080;
const H = 1920;

// Deep-space palette (background, solids, grid)
const PAL = [
  [54,  45,  120],  // 0  deep violet
  [82,  63,  163],  // 1  medium violet
  [145, 108, 204],  // 2  lavender
  [189, 161, 229],  // 3  light lavender
  [200, 192, 233],  // 4  pale violet
  [132, 186, 231],  // 5  sky blue
  [81,  106, 212],  // 6  cornflower blue
  [51,   63, 135],  // 7  navy
];

// Vivid gradient used for torus knot chromatic pass
const GRAD = [
  [110,  85, 235],   // violet
  [ 85, 170, 250],   // sky blue
  [200, 140, 255],   // orchid
  [100, 225, 235],   // cyan
  [170, 100, 255],   // purple
  [ 70, 140, 245],   // deep blue
];


// ─── Recording state ──────────────────────────────────────────────────────
let encoder = null, muxer = null;
let isRecording         = false;
let recordingFrameCount = 0;
const FPS        = 60;
const MAX_FRAMES = FPS * 30;

let t = 0;

// ═════════════════════════════════════════════════════════════════════════
// Recording — WebCodecs + mp4-muxer
// ═════════════════════════════════════════════════════════════════════════
async function startRecording() {
  if (typeof VideoEncoder === 'undefined') {
    alert('WebCodecs API is not supported in this browser.\nUse Chrome ≥ 94.');
    return;
  }
  t = 0;
  isRecording = true;
  recordingFrameCount = 0;

  muxer = new Mp4Muxer.Muxer({
    target:                 new Mp4Muxer.ArrayBufferTarget(),
    video:                  { codec: 'avc', width: W, height: H },
    fastStart:              'in-memory',
    firstTimestampBehavior: 'offset'
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error:  (e) => console.error('Encoder error:', e)
  });
  encoder.configure({
    codec: 'avc1.640028', width: W, height: H,
    bitrate: 12_000_000, framerate: FPS
  });

  document.getElementById('startBtn').disabled = true;
  document.getElementById('stopBtn').disabled  = false;
  const s = document.getElementById('status');
  s.textContent = 'Recording…'; s.style.color = '#ff6b6b';
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'serial_geometry.mp4';
  a.click();

  encoder = null; muxer = null;
  document.getElementById('startBtn').disabled = false;
  document.getElementById('stopBtn').disabled  = true;
  const s = document.getElementById('status');
  s.textContent = 'Complete!';
  setTimeout(() => { s.textContent = 'Ready'; s.style.color = '#84bae7'; }, 3000);
}

function captureFrame() {
  if (!isRecording || !encoder) return;
  const canvas = document.querySelector('canvas');
  const frame  = new VideoFrame(canvas, {
    timestamp: recordingFrameCount * (1_000_000 / FPS)
  });
  encoder.encode(frame, { keyFrame: recordingFrameCount % 60 === 0 });
  frame.close();
}

function updateUI() {
  const d = document.getElementById('duration');
  const f = document.getElementById('frameCount');
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}


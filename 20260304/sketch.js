"use strict";

// ── Constants ──────────────────────────────────────────────────────────────
const W            = 1080;
const H            = 1920;
const FPS          = 60;
const MAX_DURATION = 24;
const MAX_FRAMES   = FPS * MAX_DURATION;

const BG     = [10,  15,  13 ];   // #0a0f0d  void black-green
const MINT   = [0,   255, 135];   // #00ff87  acid mint
const CYAN   = [0,   212, 255];   // #00d4ff  cyan electric
const VIO    = [123, 47,  255];   // #7b2fff  hyper-violet
const MAG    = [255, 45,  122];   // #ff2d7a  biopunk magenta
const ECHO   = [176, 255, 232];   // #b0ffe8  acid mint echo (5th chain)
const ABYSS  = [13,  33,  55 ];   // #0d2137  abyss blue
const NAVY   = [26,  26,  46 ];   // #1a1a2e  deep navy void
const BIOGRN = [13,  59,  46 ];   // #0d3b2e  bio dark green
const ICE    = [224, 247, 255];   // #e0f7ff  ice white

// ── Recording state ────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recordingFrameCount = 0;
let canvasEl;

// ── Sketch state ──────────────────────────────────────────────────────────
let fc = 0;
let pg;
let chains;
let particles = [];
const MAX_PARTICLES = 320;


// ── MP4 Recording ─────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported. Use Chrome/Edge."); return; }
  if (typeof Mp4Muxer    === "undefined") { alert("mp4-muxer failed to load."); return; }

  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); setStatus("Encoder error", "#ff2d7a"); isRecording = false; },
  });

  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 16_000_000, framerate: FPS });

  fc = 0;
  recordingFrameCount = 0;
  isRecording = true;
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled  = false;
  setStatus("Recording MP4\u2026", "#00ff87");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing\u2026", "#aaa");
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "bio_synthetic_fourier_20260304.mp4"; a.click();

  encoder.close(); encoder = null; muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled  = true;
  setStatus("Complete \u2713", "#00ff87");
  setTimeout(() => setStatus("Ready", "#aaa"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(text, color) {
  const el = document.getElementById("status");
  if (!el) return;
  el.textContent = text; el.style.color = color;
}

function updateRecordingUI() {
  const dEl = document.getElementById("duration");
  const fEl = document.getElementById("frameCount");
  if (dEl) dEl.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (fEl) fEl.textContent = recordingFrameCount;
}

function updateCanvasInfo() {
  const el = document.getElementById("canvasSize");
  if (el) el.textContent = W + " \u00D7 " + H;
}

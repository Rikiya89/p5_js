/*
 *  Forma II — Radiant Sacred Geometry  1080 × 1920
 *
 *  Controls:  R · record   Space · pause
 */

const FPS        = 60;
const MAX_FRAMES = FPS * 24;
const W = 1080;
const H = 1920;

let t      = 0;
let paused = false;
let recording     = false;
let recFrameCount = 0;
let muxer, encoder;

function drawDod(alpha, sw) {
  noFill();
  stroke(255, 255, 255, alpha);
  strokeWeight(sw);
  for (const [a,b] of dodEdges) line(a.x,a.y,a.z, b.x,b.y,b.z);
}

// ─── HUD ─────────────────────────────────────────────────────
function drawHUD() {
  push();
  ortho(-W/2, W/2, -H/2, H/2, -9999, 9999);
  resetMatrix();
  noStroke();
  fill(255, 60);
  textFont('monospace');
  textSize(12);
  textAlign(LEFT, BOTTOM);
  text(
    recording ? `\u25CF REC  ${nf(recFrameCount,4)} / ${MAX_FRAMES}` : 'R \u00B7 rec   Spc \u00B7 pause',
    -W/2+16, H/2-16
  );
  pop();
}

// ─── Keys ────────────────────────────────────────────────────
function keyPressed() {
  if (key==='r'||key==='R') recording ? stopRecording() : startRecording();
  if (key===' ') paused = !paused;
}

// ─── mp4-muxer ───────────────────────────────────────────────
function startRecording() {
  if (typeof Mp4Muxer==='undefined') { console.warn('Mp4Muxer not loaded'); return; }
  const target = new Mp4Muxer.ArrayBufferTarget();
  muxer = new Mp4Muxer.Muxer({ target, video:{ codec:'avc', width:W, height:H }, fastStart:'in-memory' });
  encoder = new VideoEncoder({
    output: (chunk,meta) => muxer.addVideoChunk(chunk,meta),
    error: e => console.error(e)
  });
  encoder.configure({ codec:'avc1.4d002a', width:W, height:H, bitrate:16_000_000, framerate:FPS });
  recFrameCount = 0;
  recording = true;
}

function captureFrame() {
  if (recFrameCount >= MAX_FRAMES) { stopRecording(); return; }
  const cnv = document.querySelector('canvas');
  const bitmap = cnv.transferToImageBitmap();
  const frame = new VideoFrame(bitmap, {
    timestamp: (recFrameCount/FPS)*1e6,
    duration:  (1/FPS)*1e6
  });
  encoder.encode(frame, { keyFrame: recFrameCount%(FPS*2)===0 });
  frame.close(); bitmap.close();
  recFrameCount++;
}

async function stopRecording() {
  recording = false;
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type:'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  a.download = `forma2_${d.getFullYear()}${nf(d.getMonth()+1,2)}${nf(d.getDate(),2)}.mp4`;
  a.href=url; a.click();
  URL.revokeObjectURL(url);
}

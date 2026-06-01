'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS          = 60;
const MAX_DURATION = 30;
const MAX_FRAMES   = FPS * MAX_DURATION;

const TAU = Math.PI * 2;

// ─── RD grid ─────────────────────────────────────────────────────────────────
const GW = 360;
const GH = 640;

const DA = 1.0;
const DB = 0.5;
const DT = 1.0;

// Parameter journey: [time_seconds, f, k]
// Spots → coral branching → worm labyrinth — one continuous morphing take
const PARAM_PATH = [
  {  t:  0, f: 0.0370, k: 0.0650 },  // void → first spots appear
  {  t:  8, f: 0.0370, k: 0.0649 },  // active mitosis / splitting
  {  t: 15, f: 0.0545, k: 0.0620 },  // coral / dendritic branching
  {  t: 22, f: 0.0620, k: 0.0610 },  // transition to worms
  {  t: 30, f: 0.0780, k: 0.0610 },  // dense labyrinth fills frame
];

let gridA, gridB, nextA, nextB;
let imgData, pixels32;
let bloomLayer = null;

// ─── Recording ───────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;
let canvasEl = null;

// ─── Setup ───────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255);
  noSmooth();

  gridA    = new Float32Array(GW * GH).fill(1.0);
  gridB    = new Float32Array(GW * GH).fill(0.0);
  nextA    = new Float32Array(GW * GH);
  nextB    = new Float32Array(GW * GH);
  imgData  = drawingContext.createImageData(GW, GH);
  pixels32 = new Uint32Array(imgData.data.buffer);

  bloomLayer = createGraphics(W >> 1, H >> 1);
  bloomLayer.pixelDensity(1);

  // Single central seed — one organism born from silence
  seedSingle();

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function seedSingle() {
  gridA.fill(1.0); gridB.fill(0.0);
  const cx = GW >> 1, cy = GH >> 1, r = 4;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx*dx + dy*dy > r*r) continue;
      const i = ((cy+dy+GH)%GH)*GW + ((cx+dx+GW)%GW);
      gridB[i] = 1.0; gridA[i] = 0.0;
    }
}

// ─── Parameter interpolation ─────────────────────────────────────────────────
function getParams(sec) {
  const path = PARAM_PATH;
  if (sec <= path[0].t) return { f: path[0].f, k: path[0].k };
  if (sec >= path[path.length-1].t) {
    const last = path[path.length-1];
    return { f: last.f, k: last.k };
  }
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i+1];
    if (sec >= a.t && sec <= b.t) {
      // Smoothstep blend between keyframes
      const raw = (sec - a.t) / (b.t - a.t);
      const blend = raw * raw * (3 - 2 * raw);
      return {
        f: a.f + (b.f - a.f) * blend,
        k: a.k + (b.k - a.k) * blend,
      };
    }
  }
  return { f: path[0].f, k: path[0].k };
}

// ─── Draw ────────────────────────────────────────────────────────────────────
function draw() {
  const sec = frameCount / FPS;         // seconds elapsed
  const t   = sec / MAX_DURATION;       // 0→1

  // Steps per frame ramps up over the video:
  // 0s–1s: pause (pure black, building tension)
  // 1s–6s: 1 step  — single cell visible, slow first division
  // 6s–15s: 2 steps — spreading colony
  // 15s+: 4 steps  — fills frame rapidly for labyrinth finale
  const stepsPerFrame = sec < 1  ? 0
                      : sec < 6  ? 2
                      : sec < 15 ? 6
                      : sec < 22 ? 12
                      : 20;

  const { f, k } = getParams(sec);
  for (let s = 0; s < stepsPerFrame; s++) rdStep(f, k);

  background(0);
  renderRD();
  applyBloom();
  drawVignette();
  drawCornerBrackets();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    const el = id => document.getElementById(id);
    if (el('duration'))     el('duration').textContent     = (recFrameCount/FPS).toFixed(1);
    if (el('frameCount'))   el('frameCount').textContent   = recFrameCount;
    if (el('progressFill')) el('progressFill').style.width = (recFrameCount/MAX_FRAMES*100).toFixed(1)+'%';
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// ─── Gray-Scott step — 9-point isotropic Laplacian ───────────────────────────
function rdStep(f, k) {
  for (let y = 0; y < GH; y++) {
    const yU = ((y-1+GH)%GH) * GW;
    const yC = y * GW;
    const yD = ((y+1)%GH) * GW;
    for (let x = 0; x < GW; x++) {
      const xL = (x-1+GW)%GW, xR = (x+1)%GW;
      const idx = yC + x;
      const a = gridA[idx], b = gridB[idx];

      const lapA =
        0.05*gridA[yU+xL] + 0.2*gridA[yU+x] + 0.05*gridA[yU+xR] +
        0.2 *gridA[yC+xL] - 1.0*a            + 0.2 *gridA[yC+xR] +
        0.05*gridA[yD+xL] + 0.2*gridA[yD+x] + 0.05*gridA[yD+xR];

      const lapB =
        0.05*gridB[yU+xL] + 0.2*gridB[yU+x] + 0.05*gridB[yU+xR] +
        0.2 *gridB[yC+xL] - 1.0*b            + 0.2 *gridB[yC+xR] +
        0.05*gridB[yD+xL] + 0.2*gridB[yD+x] + 0.05*gridB[yD+xR];

      const rxn = a * b * b;
      nextA[idx] = Math.min(1, Math.max(0, a + DT*(DA*lapA - rxn + f*(1-a))));
      nextB[idx] = Math.min(1, Math.max(0, b + DT*(DB*lapB + rxn - (k+f)*b)));
    }
  }
  const ta = gridA; gridA = nextA; nextA = ta;
  const tb = gridB; gridB = nextB; nextB = tb;
}

// ─── Render ──────────────────────────────────────────────────────────────────
// B concentration → luminance. Gamma 2.0 keeps black deep and pattern crisp.
// A subtle blue-tint in the midtones gives a bioluminescent microscopy feel
// without departing from near-monochrome (Instagram-safe, works on any screen).
function renderRD() {
  const fadeIn = Math.min(1, (frameCount - 60) / 60);

  for (let i = 0; i < GW * GH; i++) {
    const b   = gridB[i];
    const raw = Math.min(1, b * 2.4);
    const lum = Math.pow(raw, 2.0);

    // Core: near-white. Halo midtone: faint cool blue — bioluminescent microscopy look
    const rr = lum * 200 * fadeIn | 0;
    const gg = lum * 230 * fadeIn | 0;
    const bb = Math.min(255, lum * 255 * fadeIn + raw * 18 * fadeIn) | 0;

    pixels32[i] = (255 << 24) | (bb << 16) | (gg << 8) | rr;
  }
  drawingContext.putImageData(imgData, 0, 0);
  drawingContext.drawImage(drawingContext.canvas, 0, 0, GW, GH, 0, 0, W, H);
}

// ─── Bloom ───────────────────────────────────────────────────────────────────
function applyBloom() {
  bloomLayer.drawingContext.drawImage(canvasEl, 0, 0, W >> 1, H >> 1);
  push(); blendMode(ADD);
  const taps = [
    { dx:  0, dy:  0, a: 30 },
    { dx:  8, dy:  0, a: 22 }, { dx:  -8, dy:   0, a: 22 },
    { dx: 20, dy:  0, a: 13 }, { dx: -20, dy:   0, a: 13 },
    { dx: 40, dy:  0, a:  7 }, { dx: -40, dy:   0, a:  7 },
    { dx: 70, dy:  0, a:  3 }, { dx: -70, dy:   0, a:  3 },
    { dx:  0, dy:  7, a: 18 }, { dx:   0, dy:  -7, a: 18 },
    { dx:  0, dy: 18, a:  9 }, { dx:   0, dy: -18, a:  9 },
    { dx:  0, dy: 36, a:  4 }, { dx:   0, dy: -36, a:  4 },
  ];
  taps.forEach(({ dx, dy, a }) => { tint(255, a); image(bloomLayer, dx, dy, W, H); });
  noTint(); blendMode(BLEND);
  pop();
}

// ─── Vignette ────────────────────────────────────────────────────────────────
function drawVignette() {
  push(); noFill();
  const steps = 60, maxR = dist(W/2, H/2, 0, 0) * 1.12;
  strokeWeight((maxR/steps)*2 + 2);
  for (let i = 0; i < steps; i++) {
    const k = i / (steps-1);
    const a = map(k, 0.70, 1.0, 0, 120, true);
    if (a <= 0) continue;
    stroke(0, 0, 0, a);
    circle(W/2, H/2, lerp(0, maxR, k)*2);
  }
  pop();
}

// ─── HUD ─────────────────────────────────────────────────────────────────────
// Phase label so the viewer understands the narrative arc
function drawHUD(sec, f, k) {
  const phase = sec < 6  ? 'NUCLEATION'
              : sec < 15 ? 'MITOSIS'
              : sec < 22 ? 'COLONY'
              : 'LABYRINTH';

  push(); noStroke(); textFont('ui-monospace, Menlo, monospace');
  fill(255, 255, 255, 120); textSize(13); textAlign(LEFT, TOP);
  text('REACTION DIFFUSION · GRAY-SCOTT', 52, 52);
  fill(255, 255, 255, 55); textSize(10);
  text(phase + '  f=' + f.toFixed(4) + '  k=' + k.toFixed(4) + '  t=' + sec.toFixed(1) + 's', 52, 76);
  fill(255, 255, 255, 30); textSize(10);
  textAlign(LEFT, BOTTOM);  text(W + '×' + H + ' · ' + FPS + 'fps', 52, H-52);
  textAlign(RIGHT, BOTTOM); text('20260601 · GRAY-SCOTT', W-52, H-52);
  pop();
}

// ─── Corner brackets ─────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push(); noFill(); stroke(255, 255, 255, 30); strokeWeight(0.8);
  const m = 32, L = 26;
  line(m,m,m+L,m); line(m,m,m,m+L);
  line(W-m,m,W-m-L,m); line(W-m,m,W-m,m+L);
  line(m,H-m,m+L,H-m); line(m,H-m,m,H-m-L);
  line(W-m,H-m,W-m-L,H-m); line(W-m,H-m,W-m,H-m-L);
  pop();
}

// ─── Interaction ─────────────────────────────────────────────────────────────
function mousePressed() {
  const gx = Math.floor(map(mouseX, 0, W, 0, GW));
  const gy = Math.floor(map(mouseY, 0, H, 0, GH));
  const r = 5;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx*dx + dy*dy > r*r) continue;
      const x = (gx+dx+GW)%GW, y = (gy+dy+GH)%GH;
      gridB[y*GW+x] = 1.0; gridA[y*GW+x] = 0.0;
    }
}
function keyReleased() {
  if (key==='r'||key==='R') { isRecording ? stopRecording() : startRecording(); return false; }
  if (key==='s'||key==='S') { saveCanvas('rd_'+ts(),'png'); return false; }
  if (keyCode===DELETE||keyCode===BACKSPACE) { seedSingle(); return false; }
  return true;
}

// ─── Recording ───────────────────────────────────────────────────────────────
function startRecording() {
  if (typeof VideoEncoder==='undefined'){alert('WebCodecs not supported.');return;}
  if (typeof Mp4Muxer==='undefined'){alert('mp4-muxer not loaded.');return;}
  muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),video:{codec:'avc',width:W,height:H},fastStart:'in-memory',firstTimestampBehavior:'offset'});
  encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:(e)=>{console.error(e);isRecording=false;setStatus('Error','#f44');}});
  encoder.configure({codec:'avc1.640028',width:W,height:H,bitrate:18_000_000,framerate:FPS});
  recFrameCount=0;isRecording=true;
  const el=id=>document.getElementById(id);
  if(el('startBtn'))el('startBtn').disabled=true;
  if(el('stopBtn'))el('stopBtn').disabled=false;
  setStatus('Recording…','#fff');
}
async function stopRecording(){
  if(!encoder||!muxer)return;
  isRecording=false;setStatus('Finalizing…','#ccc');
  await encoder.flush();muxer.finalize();
  const blob=new Blob([muxer.target.buffer],{type:'video/mp4'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='rd_'+ts()+'.mp4';a.click();
  encoder.close();encoder=null;muxer=null;
  setTimeout(()=>URL.revokeObjectURL(url),6000);
  const el=id=>document.getElementById(id);
  if(el('startBtn'))el('startBtn').disabled=false;
  if(el('stopBtn'))el('stopBtn').disabled=true;
  setStatus('Complete','#fff');
  setTimeout(()=>setStatus('Ready','#ccc'),3000);
}
function captureFrame(){
  if(!encoder||!canvasEl)return;
  const frame=new VideoFrame(canvasEl,{timestamp:recFrameCount*(1_000_000/FPS)});
  encoder.encode(frame,{keyFrame:recFrameCount%FPS===0});
  frame.close();
}
function setStatus(txt,c){const el=document.getElementById('status');if(el){el.textContent=txt;el.style.color=c;}}
function ts(){const d=new Date();return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;}

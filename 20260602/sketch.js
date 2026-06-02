'use strict';

// ─── Canvas ───────────────────────────────────────────────────────────────────
const W = 1080;
const H = 1920;
const FPS          = 60;
const MAX_DURATION = 30;
const MAX_FRAMES   = FPS * MAX_DURATION;
const LOOP_FRAMES  = FPS * 30;

const TAU = Math.PI * 2;

// ─── Flow field parameters ────────────────────────────────────────────────────
const N_PARTICLES  = 5000;
const TRAIL_ALPHA  = 11;    // hairline buffer fade per frame
const GLOW_ALPHA   = 6;     // glow buffer fades slower → light pools in dense zones
const WARMUP_STEPS = 480;   // pre-run frames so recording starts with full trails

const SCALE_COARSE = 0.0016;
const SCALE_FINE   = 0.0058;
const COARSE_W     = 0.72;
const FINE_W       = 0.28;

let pg;        // crisp hairline trail buffer
let glowPg;    // soft thick glow buffer
let halfPg;    // half-res scratch for blurred glow
let grainPg;   // baked film grain, composited once per frame
let particles;
let canvasEl = null;

// ─── Recording ────────────────────────────────────────────────────────────────
let muxer = null, encoder = null;
let isRecording = false, recFrameCount = 0;

// ─── Setup ────────────────────────────────────────────────────────────────────
function setup() {
  const cnv = createCanvas(W, H);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);

  pg = createGraphics(W, H);
  pg.pixelDensity(1);
  pg.colorMode(RGB, 255, 255, 255, 255);

  glowPg = createGraphics(W, H);
  glowPg.pixelDensity(1);
  glowPg.colorMode(RGB, 255, 255, 255, 255);

  // Half-res buffer for cheap blur: draw glowPg scaled down then back up
  halfPg = createGraphics(W >> 1, H >> 1);
  halfPg.pixelDensity(1);
  halfPg.colorMode(RGB, 255, 255, 255, 255);

  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  grainPg.colorMode(RGB, 255, 255, 255, 255);
  bakeGrain();

  reseed(floor(random(100000)));

  const el = id => document.getElementById(id);
  if (el('maxDuration')) el('maxDuration').textContent = MAX_DURATION;
  if (el('canvasSize'))  el('canvasSize').textContent  = W + ' × ' + H;
  if (el('maxFrames'))   el('maxFrames').textContent   = MAX_FRAMES;
}

function reseed(s) {
  randomSeed(s); noiseSeed(s);
  pg.background(3, 3, 5);
  glowPg.background(3, 3, 5);
  spawnParticles();
  warmup();
}

// ─── Grain ────────────────────────────────────────────────────────────────────
function bakeGrain() {
  grainPg.clear(); grainPg.noStroke();
  const count = floor(W * H * 0.0014);
  for (let i = 0; i < count; i++) {
    const v = random(100, 200);
    grainPg.fill(v, v, v, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.22, 0.85));
  }
}

// ─── Particles ────────────────────────────────────────────────────────────────
function spawnParticles() {
  particles = [];
  for (let i = 0; i < N_PARTICLES; i++) {
    particles.push({
      x:      random(W),
      y:      random(H),
      age:    floor(random(340)),
      maxAge: floor(random(260, 440)),
    });
  }
}

// Pre-warm: run particles through WARMUP_STEPS frames at t≈0.15 so the trail
// buffers are full when the first visible (or recorded) frame appears.
function warmup() {
  for (let step = 0; step < WARMUP_STEPS; step++) {
    const t = (step / WARMUP_STEPS) * 1.2;   // sweep through a slice of field space
    fadeBufers();
    updateParticles(t);
  }
}

// ─── Draw ─────────────────────────────────────────────────────────────────────
function draw() {
  const loop = (frameCount % LOOP_FRAMES) / LOOP_FRAMES;
  const t    = loop * TAU;

  fadeBufers();
  updateParticles(t);
  composite();

  drawHUD(loop);
  drawCornerBrackets();
  drawVignette();

  if (isRecording) {
    captureFrame();
    recFrameCount++;
    const el = id => document.getElementById(id);
    if (el('duration'))   el('duration').textContent   = (recFrameCount/FPS).toFixed(1);
    if (el('frameCount')) el('frameCount').textContent = recFrameCount;
    const pf = document.getElementById('progressFill');
    if (pf) pf.style.width = (recFrameCount / MAX_FRAMES * 100).toFixed(1) + '%';
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function fadeBufers() {
  pg.noStroke();
  pg.fill(3, 3, 5, TRAIL_ALPHA);
  pg.rect(0, 0, W, H);

  glowPg.noStroke();
  glowPg.fill(3, 3, 5, GLOW_ALPHA);
  glowPg.rect(0, 0, W, H);
}

// Composite: bg → blurred glow (screen) → sharp trails (screen) → grain
function composite() {
  background(3, 3, 5);

  // Blur the glow pass: downscale to half-res, draw back at full size.
  // This spreads the thick strokes into a soft diffuse halo without a real convolution.
  halfPg.clear();
  halfPg.image(glowPg, 0, 0, W >> 1, H >> 1);

  drawingContext.globalCompositeOperation = 'screen';
  image(halfPg, 0, 0, W, H);   // upscaled → blur artifact becomes the soft glow
  image(pg, 0, 0);
  drawingContext.globalCompositeOperation = 'source-over';

  // Film grain: dithers banding in dark areas, gives analogue texture
  push();
  drawingContext.globalCompositeOperation = 'screen';
  tint(255, 9);
  image(grainPg, 0, 0);
  noTint();
  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}

// ─── Flow field ───────────────────────────────────────────────────────────────
function flowSample(x, y, t) {
  const nc1 = noise(x*SCALE_COARSE,       y*SCALE_COARSE,       t*0.22);
  const nc2 = noise(x*SCALE_COARSE + 3.7, y*SCALE_COARSE + 1.3, t*0.22 + 1.8);
  const angleC = nc1 * TAU * 2 + (nc2 - 0.5) * Math.PI * 0.7;

  const nf1 = noise(x*SCALE_FINE,       y*SCALE_FINE,       t*0.35 + 5.1);
  const nf2 = noise(x*SCALE_FINE + 2.1, y*SCALE_FINE + 4.6, t*0.35 + 7.3);
  const angleF = nf1 * TAU * 2 + (nf2 - 0.5) * Math.PI * 0.5;

  const angle = angleC * COARSE_W + angleF * FINE_W;

  // Curl estimate: tight-turning zones slow particles → trails pool there → brighter glow
  const eps = 3.0;
  const curl = Math.abs(noise((x+eps)*SCALE_COARSE, y*SCALE_COARSE, t*0.22) - nc1)
             + Math.abs(noise(x*SCALE_COARSE, (y+eps)*SCALE_COARSE, t*0.22) - nc1);
  const speed = map(curl, 0, 0.12, 2.5, 0.55, true);

  return { angle, speed };
}

function updateParticles(t) {
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.age++;

    if (p.x < -2 || p.x > W+2 || p.y < -2 || p.y > H+2 || p.age > p.maxAge) {
      p.x = random(W); p.y = random(H);
      p.age = 0; p.maxAge = floor(random(260, 440));
      continue;
    }

    const { angle, speed } = flowSample(p.x, p.y, t);
    const nx = p.x + Math.cos(angle) * speed;
    const ny = p.y + Math.sin(angle) * speed;

    // Life arc: fast rise, long hold, graceful fade
    const life = p.age / p.maxAge;
    const bri  = Math.pow(Math.sin(life * Math.PI), 0.45);

    // Central brightness boost — luminous focal zone draws the eye
    const dx = (p.x - W*0.5) / W, dy = (p.y - H*0.44) / H;
    const boost = 1.0 + 0.55 * Math.max(0, 1 - Math.sqrt(dx*dx + dy*dy) * 3.0);

    const a = bri * boost;

    // Calligraphic stroke: thin at birth, swell to thick mid-life, taper thin at death.
    // This makes every trail look like a brushstroke rather than a uniform spray.
    const swellK = Math.sin(life * Math.PI);   // 0→1→0, peaks at midlife
    const sw = 0.3 + swellK * 1.6;            // 0.3 (hair) → 1.9 (full body) → 0.3 (tip)

    // Glow layer: thick, soft, accumulates in dense spirals
    glowPg.stroke(255, 255, 255, 32 * a);
    glowPg.strokeWeight(sw * 6.0);
    glowPg.line(p.x, p.y, nx, ny);

    // Trail layer: calligraphic hairline, the sharp ink skeleton
    pg.stroke(255, 255, 255, 210 * a);
    pg.strokeWeight(sw);
    pg.line(p.x, p.y, nx, ny);

    p.x = nx; p.y = ny;
  }
}

// ─── HUD ──────────────────────────────────────────────────────────────────────
function drawHUD(loop) {
  push(); noStroke(); textFont('ui-monospace, Menlo, monospace');
  fill(255,255,255,155); textSize(13); textAlign(LEFT,TOP);
  text('FLOW FIELD · PERLIN DRIFT', 52, 52);
  fill(255,255,255,70); textSize(10);
  text('n=' + N_PARTICLES + '  dual-layer  loop=' + loop.toFixed(3), 52, 76);
  fill(255,255,255,45); textSize(10);
  textAlign(LEFT,  BOTTOM); text(W+'×'+H+' · '+FPS+'fps', 52, H-52);
  textAlign(RIGHT, BOTTOM); text('20260602 · FLOW FIELD · B&W', W-52, H-52);
  pop();
}

// ─── Corner brackets ──────────────────────────────────────────────────────────
function drawCornerBrackets() {
  push(); noFill(); stroke(255,255,255,42); strokeWeight(0.7);
  const m=32, L=26;
  line(m,m,m+L,m); line(m,m,m,m+L);
  line(W-m,m,W-m-L,m); line(W-m,m,W-m,m+L);
  line(m,H-m,m+L,H-m); line(m,H-m,m,H-m-L);
  line(W-m,H-m,W-m-L,H-m); line(W-m,H-m,W-m,H-m-L);
  pop();
}

// ─── Vignette ─────────────────────────────────────────────────────────────────
function drawVignette() {
  push(); noFill();
  const steps=70, maxR=dist(W/2,H/2,0,0)*1.10;
  strokeWeight((maxR/steps)*2+2);
  for(let i=0;i<steps;i++){
    const k=i/(steps-1);
    const a=map(k,0.72,1.0,0,115,true);
    if(a<=0) continue;
    stroke(0,0,0,a); circle(W/2,H/2,lerp(0,maxR,k)*2);
  }
  pop();
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function mousePressed() { reseed(floor(random(100000))); }
function keyReleased() {
  if(key==='r'||key==='R'){isRecording?stopRecording():startRecording();return false;}
  if(key==='s'||key==='S'){saveCanvas('flowfield_'+ts(),'png');return false;}
  if(keyCode===DELETE||keyCode===BACKSPACE){reseed(floor(random(100000)));return false;}
  return true;
}

// ─── Recording ────────────────────────────────────────────────────────────────
function startRecording() {
  if(typeof VideoEncoder==='undefined'){alert('WebCodecs not supported.');return;}
  if(typeof Mp4Muxer==='undefined'){alert('mp4-muxer not loaded.');return;}
  muxer=new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(),video:{codec:'avc',width:W,height:H},fastStart:'in-memory',firstTimestampBehavior:'offset'});
  encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:(e)=>{console.error(e);isRecording=false;setStatus('Error','#f44');}});
  encoder.configure({codec:'avc1.640028',width:W,height:H,bitrate:18_000_000,framerate:FPS});
  recFrameCount=0; isRecording=true;
  const el=id=>document.getElementById(id);
  if(el('startBtn'))el('startBtn').disabled=true;
  if(el('stopBtn')) el('stopBtn').disabled=false;
  setStatus('Recording…','#fff');
}
async function stopRecording() {
  if(!encoder||!muxer)return;
  isRecording=false; setStatus('Finalizing…','#ccc');
  await encoder.flush(); muxer.finalize();
  const blob=new Blob([muxer.target.buffer],{type:'video/mp4'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='flowfield_'+ts()+'.mp4'; a.click();
  encoder.close(); encoder=null; muxer=null;
  setTimeout(()=>URL.revokeObjectURL(url),6000);
  const el=id=>document.getElementById(id);
  if(el('startBtn'))el('startBtn').disabled=false;
  if(el('stopBtn')) el('stopBtn').disabled=true;
  const pf=document.getElementById('progressFill');
  if(pf)pf.style.width='0%';
  setStatus('Complete','#fff');
  setTimeout(()=>setStatus('Ready','#ccc'),3000);
}
function captureFrame() {
  if(!encoder||!canvasEl)return;
  const frame=new VideoFrame(canvasEl,{timestamp:recFrameCount*(1_000_000/FPS)});
  encoder.encode(frame,{keyFrame:recFrameCount%FPS===0});
  frame.close();
}
function setStatus(txt,c){const el=document.getElementById('status');if(el){el.textContent=txt;el.style.color=c;}}
function ts(){const d=new Date();return`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;}

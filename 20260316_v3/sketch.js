"use strict";

/* ───────────────────── Canvas & Recording ───────────────────── */
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 24;
const MAX_FRAMES = FPS * MAX_DURATION;

/* ───────────────────── State ───────────────────── */
let muxer = null;
let encoder = null;
let isRecording = false;
let recordingFrameCount = 0;
let canvasEl = null;
let latestRecordingUrl = "";
let latestRecordingFilename = "shader_mandala_20260316.mp4";

let fc = 0;
let mandalaShader = null;
let captureCanvas = null;
let captureCtx = null;

/* ───────────────────── GLSL: Vertex Shader ───────────────────── */
const vertSrc = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main() {
  vTexCoord = aTexCoord;
  vec4 positionVec4 = vec4(aPosition, 1.0);
  positionVec4.xy = positionVec4.xy * 2.0 - 1.0;
  gl_Position = positionVec4;
}
`;

/* ───────────────────── GLSL: Fragment Shader ───────────────────── */
const fragSrc = `
precision highp float;

varying vec2 vTexCoord;

uniform vec2  uResolution;
uniform float uTime;
uniform float uMorph;

#define COL_BG    vec3(0.051, 0.122, 0.176)
#define COL_MINT  vec3(0.0,   1.0,   0.529)
#define COL_CYAN  vec3(0.0,   0.831, 1.0)
#define COL_VIOL  vec3(0.482, 0.184, 1.0)
#define COL_MAG   vec3(1.0,   0.176, 0.478)
#define COL_PMINT vec3(0.69,  1.0,   0.91)
#define COL_PCYAN vec3(0.769, 0.941, 1.0)

#define PI  3.14159265359
#define TAU 6.28318530718
#define PHI 1.618033988749

/* ── hash / noise ──────────────────────── */
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    val += amp * noise(p * freq);
    freq *= 2.1;
    amp *= 0.48;
    p = mat2(0.8, 0.6, -0.6, 0.8) * p;  // rotate each octave
  }
  return val;
}

/* ── palette ───────────────────────────── */
vec3 palette(float t) {
  t = fract(t);
  vec3 colors[6];
  colors[0] = COL_MINT;
  colors[1] = COL_CYAN;
  colors[2] = COL_VIOL;
  colors[3] = COL_MAG;
  colors[4] = COL_PMINT;
  colors[5] = COL_PCYAN;
  float idx = t * 6.0;
  int i0 = int(mod(floor(idx), 6.0));
  int i1 = int(mod(floor(idx) + 1.0, 6.0));
  float blend = fract(idx);
  blend = blend * blend * (3.0 - 2.0 * blend); // smooth interpolation
  vec3 c0 = (i0==0?colors[0]:i0==1?colors[1]:i0==2?colors[2]:i0==3?colors[3]:i0==4?colors[4]:colors[5]);
  vec3 c1 = (i1==0?colors[0]:i1==1?colors[1]:i1==2?colors[2]:i1==3?colors[3]:i1==4?colors[4]:colors[5]);
  return mix(c0, c1, blend);
}

/* ── shape functions (polar radius) ───── */
float starR(float a, float sym) {
  return mix(1.0, 0.35, pow(abs(sin(a * sym * 0.5)), 2.0));
}

float flowerR(float a, float petals) {
  return 0.35 + 0.65 * abs(sin(a * petals * 0.5));
}

float waveR(float a, float petals, float sym) {
  return 0.65 + 0.35 * sin(a * petals + a * sym * 0.25);
}

float polyR(float a, float sides) {
  float ha = PI / sides;
  float sa = mod(a, TAU / sides);
  return cos(ha) / cos(abs(sa - ha));
}

float lotusR(float a, float petals, float time) {
  float base = 0.5 + 0.5 * cos(a * petals);
  float inner = 0.3 + 0.2 * cos(a * petals * 2.0 + time * 0.5);
  return mix(base, inner, 0.3);
}

/* ── kaleidoscope fold ─────────────────── */
float kaleido(float a, float sym) {
  float sector = TAU / sym;
  a = mod(a, sector);
  a = abs(a - sector * 0.5);
  return a;
}

/* ── ring with triple-width glow ───────── */
vec3 glowRing(vec2 uv, float radius, float sym, float morph, float time, float seed, float colorT) {
  float r = length(uv);
  float rawA = atan(uv.y, uv.x);

  // Kaleidoscopic fold for extra symmetry
  float a = kaleido(rawA + time * 0.15 * (seed - 0.5), sym);

  // Morph through 5 shapes with smooth transitions
  float m = morph * 5.0;
  float phase = floor(m);
  float blend = fract(m);
  blend = blend * blend * (3.0 - 2.0 * blend);

  float s0, s1;
  // Shape cycle: circle -> star -> flower -> lotus -> wave -> circle
  if (phase < 1.0) {
    s0 = 1.0;
    s1 = starR(a, sym);
  } else if (phase < 2.0) {
    s0 = starR(a, sym);
    s1 = flowerR(a, sym + 2.0);
  } else if (phase < 3.0) {
    s0 = flowerR(a, sym + 2.0);
    s1 = lotusR(a, sym, time);
  } else if (phase < 4.0) {
    s0 = lotusR(a, sym, time);
    s1 = waveR(a, sym + 1.0, sym);
  } else {
    s0 = waveR(a, sym + 1.0, sym);
    s1 = 1.0;
  }

  float shapeR = mix(s0, s1, blend);

  // Add organic noise distortion
  float noiseDist = fbm(vec2(rawA * 2.0, r * 8.0) + time * 0.2 + seed * 10.0);
  shapeR *= 0.92 + 0.08 * noiseDist;

  float ringDist = abs(r - radius * shapeR);

  // Triple-layer glow: sharp core + medium halo + wide bloom
  float core  = smoothstep(0.004, 0.0, ringDist);
  float halo  = smoothstep(0.018, 0.0, ringDist) * 0.5;
  float bloom = smoothstep(0.06,  0.0, ringDist) * 0.15;
  float intensity = core + halo + bloom;

  // Ornamental dots at symmetry points (on the unfolded angle)
  float dotA = mod(rawA + time * 0.15 * (seed - 0.5) + PI, TAU / sym);
  float dotR = r - radius * shapeR;
  float dotDist = length(vec2(dotA - PI / sym, dotR) * vec2(r, 1.0));
  float dotGlow = smoothstep(0.025, 0.0, dotDist) * 0.8;
  float dotBloom = smoothstep(0.06, 0.0, dotDist) * 0.25;
  intensity += dotGlow + dotBloom;

  // Filigree: thin secondary lines between main shape vertices
  float filiAngle = kaleido(rawA + time * 0.1 + seed, sym * 2.0);
  float filiR = radius * 0.5 * (0.8 + 0.2 * cos(filiAngle * sym));
  float filiDist = abs(r - filiR);
  float filigree = smoothstep(0.003, 0.0, filiDist) * 0.2;
  intensity += filigree;

  vec3 col = palette(colorT);

  // Breathing
  float breathe = 0.55 + 0.45 * sin(time * 1.2 + seed * TAU);
  intensity *= breathe;

  return col * intensity;
}

/* ── nebula background ─────────────────── */
vec3 nebula(vec2 uv, float time) {
  vec3 col = vec3(0.0);

  // Layer 1: slow-moving large-scale clouds
  float n1 = fbm(uv * 3.0 + vec2(time * 0.05, time * 0.03));
  col += COL_VIOL * 0.06 * smoothstep(0.35, 0.7, n1);

  // Layer 2: medium turbulence
  float n2 = fbm(uv * 6.0 - vec2(time * 0.08, -time * 0.04));
  col += COL_CYAN * 0.04 * smoothstep(0.4, 0.75, n2);

  // Layer 3: fine detail
  float n3 = fbm(uv * 12.0 + vec2(-time * 0.12, time * 0.06));
  col += COL_MINT * 0.03 * smoothstep(0.45, 0.8, n3);

  // Radial nebula glow
  float radial = exp(-length(uv) * 2.5);
  col += mix(COL_VIOL, COL_MAG, 0.5 + 0.5 * sin(time * 0.3)) * radial * 0.04;

  return col;
}

/* ── sparkle stars ─────────────────────── */
float sparkle(vec2 uv, float time) {
  float stars = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 grid = uv * (15.0 + fi * 10.0);
    vec2 cell = floor(grid);
    vec2 local = fract(grid) - 0.5;
    float h = hash(cell + fi * 100.0);
    vec2 offset = vec2(hash(cell * 1.3 + fi), hash(cell * 2.7 + fi)) - 0.5;
    float d = length(local - offset * 0.4);
    float twinkle = 0.5 + 0.5 * sin(time * (2.0 + h * 4.0) + h * TAU);
    float star = smoothstep(0.05 + 0.02 * fi, 0.0, d) * twinkle * step(0.92, h);
    stars += star * (0.3 - fi * 0.08);
  }
  return stars;
}

/* ── main ──────────────────────────────── */
void main() {
  vec2 uv = (gl_FragCoord.xy - uResolution * 0.5) / min(uResolution.x, uResolution.y);
  float time = uTime;
  float morph = uMorph;

  // Deep background with nebula
  vec3 col = COL_BG * 0.8;
  col += nebula(uv, time);

  // Sparkle field
  float stars = sparkle(uv, time);
  col += palette(time * 0.03 + length(uv)) * stars;

  // ── Mandala rings ──
  const int RINGS = 14;
  for (int i = 0; i < RINGS; i++) {
    float fi = float(i);
    float t = fi / float(RINGS - 1);
    float seed = fract(fi * PHI);  // golden ratio scatter

    // Radius with breathing
    float breatheR = 1.0 + 0.03 * sin(time * 0.8 + fi * 0.5);
    float radius = (0.05 + t * 0.55) * breatheR;
    float sym = 4.0 + mod(fi * 3.0, 9.0);

    // Cascading morph: each ring morphs with offset
    float ringMorph = fract(morph + seed * 0.6 + fi * 0.07);

    float colorT = t * 0.8 + time * 0.015 + seed * 0.4;
    float ringTime = time + fi * 0.35;

    vec3 ringCol = glowRing(uv, radius, sym, ringMorph, ringTime, seed, colorT);

    // Distance-based intensity falloff (inner rings brighter)
    float falloff = 0.6 + 0.4 * (1.0 - t);
    col += ringCol * falloff;
  }

  // ── Central sacred glow ──
  float cd = length(uv);
  // Multi-layered core
  float core1 = exp(-cd * 12.0) * 0.6;
  float core2 = exp(-cd * 6.0) * 0.25;
  float core3 = exp(-cd * 2.5) * 0.08;
  float corePulse = 0.6 + 0.4 * sin(time * 2.0);
  vec3 coreCol = mix(COL_MINT, COL_PCYAN, 0.5 + 0.5 * sin(time * 0.7));
  col += coreCol * (core1 + core2 + core3) * corePulse;

  // ── Radial rays from center ──
  float rawA = atan(uv.y, uv.x);
  float rays = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float rayCount = 8.0 + fi * 8.0;
    float rayAngle = rawA + time * (0.05 + fi * 0.03);
    float ray = pow(abs(cos(rayAngle * rayCount)), 60.0 + fi * 40.0);
    ray *= exp(-cd * (3.0 + fi * 1.5)) * (0.12 - fi * 0.03);
    rays += ray;
  }
  col += mix(COL_MINT, COL_CYAN, 0.5 + 0.5 * sin(time + cd * 3.0)) * rays * corePulse;

  // ── Outer ring pulse wave ──
  float waveDist = abs(cd - 0.6 - 0.05 * sin(time * 0.5));
  float outerWave = smoothstep(0.015, 0.0, waveDist) * 0.4;
  float outerBloom = smoothstep(0.08, 0.0, waveDist) * 0.1;
  col += COL_PCYAN * (outerWave + outerBloom) * (0.5 + 0.5 * sin(time * 1.5));

  // ── Vignette ──
  float vig = 1.0 - smoothstep(0.35, 0.95, cd);
  col *= 0.65 + 0.35 * vig;

  // ── Film grain ──
  float grain = (hash(gl_FragCoord.xy + fract(time)) - 0.5) * 0.02;
  col += grain;

  // ── Tone mapping (ACES-inspired) ──
  col = col * (2.51 * col + 0.03) / (col * (2.43 * col + 0.59) + 0.14);
  col = clamp(col, 0.0, 1.0);

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ───────────────────── Recording Boilerplate ───────────────────── */
function startRecording() {
  if (typeof VideoEncoder === "undefined") {
    alert("WebCodecs not supported. Use Chrome or Edge.");
    return;
  }
  if (typeof Mp4Muxer === "undefined") {
    alert("mp4-muxer failed to load.");
    return;
  }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { console.error(err); setStatus("Encoder error"); isRecording = false; },
  });
  encoder.configure({
    codec: "avc1.640028", width: W, height: H,
    bitrate: 16_000_000, framerate: FPS,
  });
  fc = 0;
  recordingFrameCount = 0;
  isRecording = true;
  clearDownloadLink();
  document.getElementById("startBtn").disabled = true;
  document.getElementById("stopBtn").disabled = false;
  updateDownloadButton(false);
  setStatus("Recording...");
  updateRecordingUI();
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing...");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  latestRecordingUrl = url;
  setDownloadLink(url, latestRecordingFilename);
  updateDownloadButton(true);
  triggerDownload(url, latestRecordingFilename);
  encoder.close(); encoder = null; muxer = null;
  document.getElementById("startBtn").disabled = false;
  document.getElementById("stopBtn").disabled = true;
  setStatus("MP4 ready.");
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  // Copy WebGL canvas to 2D canvas for reliable VideoFrame capture
  captureCtx.drawImage(canvasEl, 0, 0);
  const frame = new VideoFrame(captureCanvas, { timestamp: recordingFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recordingFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(t) { const e = document.getElementById("status"); if (e) e.textContent = t; }
function updateRecordingUI() {
  const d = document.getElementById("duration"), f = document.getElementById("frameCount");
  if (d) d.textContent = (recordingFrameCount / FPS).toFixed(1);
  if (f) f.textContent = recordingFrameCount;
}
function updateCanvasInfo() { const e = document.getElementById("canvasSize"); if (e) e.textContent = W + " x " + H; }
function setDownloadLink(url, fn) { const l = document.getElementById("downloadLink"); if (!l) return; l.href = url; l.download = fn; l.hidden = false; l.textContent = "Direct Link"; }
function clearDownloadLink() {
  if (latestRecordingUrl) { URL.revokeObjectURL(latestRecordingUrl); latestRecordingUrl = ""; }
  const l = document.getElementById("downloadLink"); if (!l) return; l.hidden = true; l.removeAttribute("href"); updateDownloadButton(false);
}
function updateDownloadButton(on) { const b = document.getElementById("downloadBtn"); if (b) b.disabled = !on; }
function triggerDownload(url, fn) { const a = document.createElement("a"); a.href = url; a.download = fn; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); }
function downloadLatestRecording() { if (!latestRecordingUrl) { setStatus("No MP4 yet."); return; } triggerDownload(latestRecordingUrl, latestRecordingFilename); }

/* ───────────────────── p5 Setup ───────────────────── */
function setup() {
  pixelDensity(1);
  setAttributes('preserveDrawingBuffer', true);
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  frameRate(FPS);
  noStroke();

  mandalaShader = createShader(vertSrc, fragSrc);

  // 2D canvas for WebGL frame capture
  captureCanvas = document.createElement('canvas');
  captureCanvas.width = W;
  captureCanvas.height = H;
  captureCtx = captureCanvas.getContext('2d');

  const m = document.getElementById("maxDuration");
  if (m) m.textContent = MAX_DURATION;
  updateCanvasInfo();
}

/* ───────────────────── Draw ───────────────────── */
function draw() {
  const loopT = (fc % MAX_FRAMES) / MAX_FRAMES;
  const timeSec = fc / FPS;

  // Morph phase cycles over the full loop duration
  const morphPhase = loopT;

  shader(mandalaShader);
  mandalaShader.setUniform("uResolution", [W, H]);
  mandalaShader.setUniform("uTime", timeSec);
  mandalaShader.setUniform("uMorph", morphPhase);

  // Fullscreen quad
  quad(-1, -1, 1, -1, 1, 1, -1, 1);

  // Recording
  if (isRecording) {
    captureFrame();
    recordingFrameCount++;
    updateRecordingUI();
    if (recordingFrameCount >= MAX_FRAMES) stopRecording();
  }
  fc++;
}

/* ───────────────────── Input ───────────────────── */
function keyPressed() {
  if (key === "r" || key === "R") {
    if (isRecording) stopRecording();
    else startRecording();
    return false;
  }
  return true;
}

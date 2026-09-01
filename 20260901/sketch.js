"use strict";

// Existing project framework: retained exactly.
const W = 1080;
const H = 1920;
const FPS = 60;
const MAX_DURATION = 10;
const MAX_FRAMES = FPS * MAX_DURATION;
const LOOP_FRAMES = MAX_FRAMES;
const TAU = Math.PI * 2;

const BG_R = 3, BG_G = 3, BG_B = 5;
const INK_R = 255, INK_G = 255, INK_B = 255;

// The existing palette is a two-value monochrome system: near-black ground,
// white ink. There is no secondary hue to migrate curvature through, so
// curvature is mapped onto the tonal axes this project already uses --
// ink alpha, stroke weight, contour density, and bloom contribution --
// rather than introducing a colour that is not in the palette.

const CONFIG = {
  surfaceUSegments: 96,
  surfaceVSegments: 48,

  baseRadius: 235,

  // The manifold is now ONE continuous displaced sphere: base direction *
  // baseRadius, plus a small number of broad vector deformation fields (see
  // DEFORMERS below). No per-lobe ray casts, no smooth-max union -- lobes,
  // folds and the neck all emerge from overlapping displacement, so the
  // surface is never star-shaped and can genuinely fold and twist.
  verticalCompression: 0.78,  // base sphere squashed in Y before deformers
                              // apply, so lateral spread reads as WIDTH, not
                              // as a taller spine (buys lateral room against
                              // the portrait-frame camera fit; see setupCamera).
  lateralSpread: 1.30,        // base sphere widened in X/Z, 30% per the brief

  curvatureFlowRate: 0.34,  // discrete Laplacian step scale
  curvatureGain: 30,         // curvature -> visual response scale
  reseedRate: 0.42,         // relaxation toward the closed-form target.
                             // Sets the flow's memory horizon (~1/rate frames).

  contourCount: 8,           // 12 -> 8, placed by percentile (see
                              // updateContours) so each level lands where the
                              // curvature distribution actually has vertices.
  temporalEchoCount: 2,
  echoStride: 10,           // must divide LOOP_FRAMES evenly (600 / 10 = 60)
  echoAlpha: [18, 7],        // memory stays below restored live structure
                             // dimmed further per the brief's echo range.

  ribStride: 19,             // longitudinal ribs: dim structural layer only
                              // now -- the silhouette comes from the rim term.
                              // 11 -> 19 (9 ribs -> 5): the ribs were the
                              // last evenly-spaced longitude set on screen.
  silhouetteWeight: 1.24,
  rimWeight: 2.65,            // primary silhouette stroke: rim-lit outline

  // --- Silhouette (see updateSilhouette / LAYER 1) --------------------------
  // The outline is extracted as the zero level set of signed n*v and welded
  // into polylines, so there is no visibility threshold to tune here: a
  // threshold on |n*v| is what produced first a meridian cage and then
  // combing across view-tangent folds.
  silhouetteBase: 255,        // peak alpha of the outline stroke
  silhouetteStrength: 1.0,    // master multiplier on silhouette brightness
  silhouetteMinRun: 4,        // drop chains shorter than this many vertices

  // --- Facing attenuation (§04) --------------------------------------------
  // Signed n·v, distinct from the unsigned rim magnitude. Back-facing geometry
  // is dimmed hard but never removed -- it still has to communicate volume.
  backFacingFloor: 0.28,      // rear structure stays legible, never equal
  facingPower: 1.08,

  // --- Hero contours (§03) --------------------------------------------------
  // Marching-squares output is chained into continuous polylines; the longest
  // chains carrying the most curvature are promoted to heroes.
  heroContourCount: 7,
  minChainLength: 7,          // remove short islands; retain long fold bridges
  secondaryLineOpacity: 0.76, // restored structure without returning the mesh
  closedLoopOpacity: 0.06,    // closed islands recede well below flowing bands

  // --- Translucent surface (§06) -------------------------------------------
  surfaceOpacity: 42,        // readable membrane mass, still translucent
  surfaceInset: 0.994,        // depth bias so contours don't z-fight the shell

  // Only response above this reaches full brightness, so broad lobes stay
  // quiet and the brightest ink is reserved for the single primary neck.
  curvatureHighlightThreshold: 0.81,  // broad top 8–15% curvature field
  curvatureHighlightPower: 2.25,      // preserve a rare, tight bright core

  surfaceLineWeight: 1.05,
  cameraDistance: 1500,
  cameraMaxDistance: 2400,
  cameraDrift: 54,
  // Bounding-box fit (see measureExtents): true min/max box, not distance
  // from the origin, so the off-centre asymmetric form doesn't inflate its
  // own framing fit toward the empty side.
  framingFill: 0.86,          // slightly looser than before, for breathing
                              // room now that the form is wider and offset.
  fogDepthRange: 920,
};

// --- Temporal choreography --------------------------------------------------
// The loop is no longer driven by one palindromic envelope. It is driven by six
// overlapping EVENTS, each with its own window, easing and spatial target, so
// forward and return traverse genuinely different deformation paths. Windows are
// given as [start, end) in loop fractions (10s loop -> 0.1 == 1s) and may wrap
// the seam; `attack`/`release` are fractions OF THE WINDOW, remainder is hold.
//
// Verified numerically: total activity never drops below 0.79 (continuous
// motion, no dead frames) and every envelope satisfies E(0) == E(1) to 3e-6.
const ANIM = {
  // EVENT 01 COMPRESSION -- starts BEFORE the seam so t=0 opens mid-gesture at
  // 0.65 and hits full by t=0.05 (0.5s). This is the Reels hook: the viewer
  // sees deformation inside the first half-second, not a slow build.
  compression: { start: 0.965, end: 0.24, attack: 0.22, release: 0.55, strength: 1.0 },
  // EVENT 02 TORSION -- overlaps compression's release.
  twist:       { start: 0.11,  end: 0.36, attack: 0.26, release: 0.52, strength: 1.0 },
  // EVENT 03 NECK PINCH -- longest hold; peaks 0.35-0.45 == the 4.0-4.5s climax.
  pinch:       { start: 0.25,  end: 0.54, attack: 0.40, release: 0.34, strength: 1.0 },
  // EVENT 04 BLOOM -- release into a broad asymmetric unfold, not a reversal.
  bloom:       { start: 0.44,  end: 0.76, attack: 0.30, release: 0.46, strength: 1.0 },
  // EVENT 05 CURVATURE WAVE -- travelling front, see waveFront().
  wave:        { start: 0.65,  end: 0.92, attack: 0.26, release: 0.50, strength: 1.0 },
  // EVENT 06 RECONNECTION -- wraps the seam; returns by a different route.
  reconnect:   { start: 0.80,  end: 1.10, attack: 0.28, release: 0.44, strength: 1.0 },

  compressionStrength: 0.58,   // inward push depth, unit-sphere space
  counterExpansion: 0.42,      // opposing region's simultaneous outward push
  twistStrength: 0.62,         // extra radians through the neck at full torsion
  pinchStrength: 0.52,         // additional fractional neck pinch at climax
  pinchWidth: 0.62,            // band tightness multiplier during the pinch
  bloomStrength: 0.36,         // unfold amplitude
  bloomSplay: 0.24,            // lateral splay of the released region

  curvatureWaveSpeed: 1.15,    // front travel, in surface-coord units per window
  curvatureWaveWidth: 0.30,    // gaussian sigma of the front
  curvatureWaveStrength: 0.26, // displacement amplitude at the front

  propagationDelay: 0.085,     // loop fractions of lag per unit surface distance
  curvatureSpeedGain: 1.0,     // how much harder high-curvature regions flow
  peakHold: 0.05,              // extra dwell at the climax (see peakDwell())

  cameraDrift: 1.0,            // scales the existing drift; motion stays secondary

  // --- Anticipation / overshoot / settle (§12-§14) --------------------------
  // ALL of these are closed-form functions of loop phase, built out of
  // envelope()/phaseDist(). None of them integrate state across frames. That
  // is a hard constraint, not a style choice: a numerical spring would carry
  // velocity across the loop seam and the position at t=1 would not equal the
  // position at t=0, which snaps the Reel. See shapedEvent().
  anticipation: 0.16,          // pre-event counter-move, fraction of the event
  anticipationWindow: 0.30,    // how much of the attack is spent winding up
  overshoot: 0.09,             // peak excess past the target (1.09), §13
  overshootDecay: 2.6,         // how fast the overshoot ring settles
  settleRipples: 1.5,          // damped oscillations before rest

  // Elastic settle (§14): outer regions lag the primary by this much extra,
  // on top of propagationDelay, so the system settles limb-by-limb.
  settleLag: 0.055,

  // Focal highlight (§08/§09): a continuously moving bright region. The wave
  // window is its fast crossing, but it never stops existing.
  // Route timing lives in FOCAL_KEYS (a closed circuit in loop phase); there is
  // deliberately no speed multiplier here, since scaling loop phase would move
  // the seam off frame 600.
  focalWidth: 0.58,

  cameraPushStrength: 0.034,   // restrained push, kept within the 2–4% range
  compositionDrift: 26,        // §24: px the framed centre may wander
  equilibriumResidual: 0.050,  // local settling, ~10% of main motion
};

// Event centres in unit-sphere space. Each event acts on a DIFFERENT region, so
// the surface never deforms as a whole. Compression and counter-expansion are
// deliberately opposed; the wave runs a path that is not the reverse of the
// outbound events, which is what gives EVENT 06 a distinct return route.
const EVENT_SITES = {
  compress:  [-0.62, 0.34, -0.18],  // left/upper flank contracts
  counter:   [0.58, -0.22, 0.26],   // opposing right/lower flank expands
  bloomSite: [0.34, 0.52, 0.22],    // release unfolds up-right, NOT at the neck
  waveStart: [-0.70, -0.30, 0.10],  // lower-left
  waveEnd:   [0.55, 0.60, -0.15],   // upper-right (diagonal crossing)
};

// --- Deformation fields -------------------------------------------------
// Each field is a broad, smooth push on the base sphere: a spatial centre,
// a directional bias, a width, an amplitude, and a phase. They overlap, so
// lobes/folds/necks emerge from the sum rather than from separate attached
// primitives. All time terms are integer harmonics of TAU*loopProgress, so
// the field -- and therefore the loop -- stays exactly periodic.
const DEFORMERS = {
  // Primary upper mass, offset left and slightly back: pulled up+left+back
  // and flattened along its own push direction so it reads as a compressed
  // fold rather than a balloon.
  upperMass: { c: [-0.34, 0.62, -0.10], amp: 0.62, width: 0.62, dir: [-0.20, 0.80, -0.12], flatten: 0.34 },
  // Secondary lateral extension, right and forward: the piece's main lateral
  // gesture, kept shallower and wider than the upper mass so it reads as an
  // extension of the same body, not a second balloon.
  lateralWing: { c: [0.62, 0.02, 0.24], amp: 0.46, width: 0.58, dir: [0.86, 0.10, 0.22], flatten: 0.42 },
  // Lower mass, offset opposite the upper mass (right, forward) so the whole
  // form reads as a diagonal S-flow rather than a vertical stack.
  lowerMass: { c: [0.28, -0.68, 0.08], amp: 0.56, width: 0.60, dir: [0.30, -0.78, 0.10], flatten: 0.30 },
  // Small folded region, mostly behind the main mass -- reads as depth, not
  // a fifth lobe on the silhouette.
  hiddenFold: { c: [-0.10, -0.10, -0.52], amp: 0.24, width: 0.40, dir: [-0.05, 0.10, -0.90], flatten: 0.20 },
};

// The primary curvature focal region: a diagonal neck between the upper and
// lower masses. Its own centre/axis are independent of the mass centres
// above so it can sit off the straight line between them -- "offset from
// the main axis, wider on one side, tighter on the other" per the brief --
// and it is the ONLY region driving the twist term and the brightest ink.
const NECK = {
  a: [-0.20, 0.30, -0.04],   // neck throat near the upper mass
  b: [0.16, -0.34, 0.06],    // neck throat near the lower mass
  radius: 0.30,              // pinch half-width at rest
  pinch: 0.40,               // additional fractional pinch at bloom peak
  twist: 0.85,                // radians of tangential twist through the neck
};
// Secondary, weaker curvature region: the lateral wing's own shallow fold.
// Half the amplitude of the primary neck so the eye has one clear focus.
const NECK_SECONDARY = {
  a: [0.18, 0.10, 0.10],
  b: [0.58, -0.02, 0.24],
  radius: 0.40,
  pinch: 0.16,
  twist: -0.35,
};

const PHASES = [
  { key: "FORM", label: "01 · FORM", note: "THE FIRST CONTRACTION TAKES HOLD" },
  { key: "FLOW", label: "02 · FLOW", note: "CURVATURE BEGINS TO REDISTRIBUTE" },
  { key: "BLOOM", label: "03 · BLOOM", note: "THE NECKS TIGHTEN · THE LOBES OPEN" },
  { key: "EQUILIBRIUM", label: "04 · EQUILIBRIUM", note: "A NEW BALANCED CONFIGURATION" },
  { key: "RETURN", label: "05 · RETURN", note: "THE METRIC RETURNS THROUGH ITS CYCLE" },
];

// Rows within POLE_SKIP of either pole are excluded from contouring: they
// collapse to a point in 3D and degenerate the iso-lines into pole spirals.
const POLE_SKIP = 3;

const US = CONFIG.surfaceUSegments;
const VS = CONFIG.surfaceVSegments;
const pointCount = US * VS;

const surface = {
  target: new Float32Array(pointCount * 3),    // closed-form periodic manifold
  positions: new Float32Array(pointCount * 3), // relaxed + curvature-evolved state
  laplacian: new Float32Array(pointCount * 3),
  normals: new Float32Array(pointCount * 3),
  curvature: new Float32Array(pointCount),     // signed mean-curvature proxy
  response: new Float32Array(pointCount),      // curvatureResponse() applied, 0..1
};

// Precomputed topology: 4-neighbour indices per vertex, pole rows handled by
// ring-averaging so the Laplacian never touches a clamped duplicate.
const neighbourIndex = new Int32Array(pointCount * 4);
const isPoleRow = new Uint8Array(pointCount);
const paramU = new Float32Array(pointCount);
const paramV = new Float32Array(pointCount);

// Temporal echo ring buffer: previous geometry states, sampled sparsely.
const echoStates = [];
let echoWrite = 0;
// Scratch for the echo outline (drawTemporalEchoes). Sized for every sample on
// the walked columns to cross zero, which is far more than can ever happen.
const echoTrace = new Float32Array(US * VS * 3);

let canvasEl = null;
let grainPg = null;
let hudPg = null;
let bloomPg = null;
let bloomStreakPg = null;
const BLOOM_SCALE = 0.5;
let loopProgress = 0;
let phase = 0;
// Per-event envelope amplitudes for the current frame. These replace the old
// single palindromic `flowT`/`bloomEnv` pair: the surface is now driven by six
// independent, overlapping envelopes rather than one global morph value.
const EV = {
  compression: 0, twist: 0, pinch: 0, bloom: 0, wave: 0, reconnect: 0,
};
let activity = 0;    // summed event energy -- drives global flow rate, NOT shape
let flowT = 0;       // retained name: now = normalised activity, non-palindromic
let wavePos = 0;     // travelling front position along the wave axis, 0..1
let peakness = 0;    // 0..1, peaks only at the climax -- brightness/flow accent
let pinchShaped = 0; // EV.pinch run through shapedEvent(): anticipation swell
                     // before the close, overshoot and settle after
// §08/§09: THE focal point. A single world-space position that always exists,
// travelling a continuous route through the sculpture across the whole loop.
// The old waveHighlight() only existed inside EVENT 05's window (0.65-0.92),
// which left ~70% of the loop with no moving bright region at all.
const focalPoint = { x: 0, y: 0, z: 0, strength: 0 };
// §24: the framed centre wanders slightly with the deformation.
const focusOffset = { x: 0, y: 0 };

// Existing deterministic WebCodecs + mp4-muxer recording workflow.
let muxer = null;
let encoder = null;
let isRecording = false;
let recFrameCount = 0;

function setup() {
  const cnv = createCanvas(W, H, WEBGL);
  canvasEl = cnv.elt;
  pixelDensity(1);
  frameRate(FPS);
  colorMode(RGB, 255, 255, 255, 255);
  strokeCap(ROUND);
  grainPg = createGraphics(W, H);
  grainPg.pixelDensity(1);
  hudPg = createGraphics(W, H);
  hudPg.pixelDensity(1);
  bloomPg = createGraphics(W * BLOOM_SCALE, H * BLOOM_SCALE, WEBGL);
  bloomPg.pixelDensity(1);
  bloomStreakPg = createGraphics(W * BLOOM_SCALE, H * BLOOM_SCALE);
  bloomStreakPg.pixelDensity(1);
  bakeGrain();

  buildTopology();
  for (let e = 0; e < CONFIG.temporalEchoCount; e++) {
    echoStates.push(new Float32Array(pointCount * 3));
  }
  // Settle the relaxation so frame 0 already shows a fully formed sculpture
  // instead of building up from the undeformed target.
  primeState();

  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").onclick = startRecording;
  if (el("stopBtn")) el("stopBtn").onclick = stopRecording;
  if (el("maxDuration")) el("maxDuration").textContent = MAX_DURATION;
  if (el("canvasSize")) el("canvasSize").textContent = W + " × " + H;
  if (el("maxFrames")) el("maxFrames").textContent = MAX_FRAMES;
}

function bakeGrain() {
  grainPg.clear();
  grainPg.noStroke();
  randomSeed(20260901);
  for (let i = 0; i < Math.floor(W * H * 0.0016); i++) {
    const value = random(110, 200);
    grainPg.fill(value, value, value, random(2, 7));
    grainPg.circle(random(W), random(H), random(0.15, 0.85));
  }
  for (let i = 0; i < Math.floor(W * H * 0.000035); i++) {
    const value = random(210, 255);
    grainPg.fill(value, value, value, random(12, 34));
    grainPg.circle(random(W), random(H), random(0.4, 1.2));
  }
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smooth01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

// C2 easing. Used for envelope attack/release so events accelerate and
// decelerate rather than ramping linearly, and so the seam is derivative-clean.
function smoother01(value) {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Signed wrapped distance between two loop phases, in [-0.5, 0.5). This is what
// makes every envelope below exactly periodic BY CONSTRUCTION -- including
// windows that straddle t=0 and including local phase offsets that push a
// vertex's window across the seam. Periodicity is structural, not verified.
function phaseDist(t, centre) {
  const d = t - centre;
  return d - Math.round(d);
}

// Event envelope: 0 outside [start, end), smootherstep attack, flat hold,
// smootherstep release. `attack`/`release` are fractions of the window length.
// Zero value AND zero derivative at both edges, so overlapping events sum
// without kinks and the loop seam is continuous.
function envelope(t, spec) {
  let len = spec.end - spec.start;
  if (len <= 0) len += 1;
  const d = phaseDist(t, spec.start + len * 0.5) + len * 0.5;
  if (d < 0 || d > len) return 0;
  const a = len * spec.attack;
  const r = len * spec.release;
  let v;
  if (d < a) v = smoother01(d / a);
  else if (d > len - r) v = 1 - smoother01((d - (len - r)) / r);
  else v = 1;
  return v * (spec.strength === undefined ? 1 : spec.strength);
}

// Normalised progress through an event's own window, 0..1, or -1 when the
// phase sits outside it. Shares its wrapped-distance maths with envelope(), so
// a vertex's progress and its envelope value always agree about where the
// window starts and ends -- including across the loop seam.
function eventProgress(t, spec) {
  let len = spec.end - spec.start;
  if (len <= 0) len += 1;
  const d = phaseDist(t, spec.start + len * 0.5) + len * 0.5;
  if (d < 0 || d > len) return -1;
  return d / len;
}

/**
 * shapedEvent(t, spec) -- ANTICIPATION -> ACTION -> OVERSHOOT -> SETTLE.
 *
 * Returns a signed multiplier that replaces a bare envelope() call wherever an
 * event should feel physical rather than interpolated. The shape is:
 *
 *   - a small NEGATIVE dip during the first `anticipationWindow` of the attack
 *     (the wind-up: the surface pulls the opposite way before it moves),
 *   - the ordinary envelope through the action,
 *   - a damped sine ringing past 1.0 after the attack completes, peaking near
 *     1 + ANIM.overshoot and settling back toward the envelope value.
 *
 * CRITICAL -- why this is closed-form rather than a spring: every term is a
 * pure function of the loop phase, and the whole ringing term is multiplied by
 * the envelope, which is zero with zero derivative at both window edges. So the
 * overshoot is FORCED to vanish exactly where the window closes and the value
 * at t=1 is identical to t=0 by construction. A stateful spring would carry
 * velocity across the seam and snap the loop. Do not "improve" this into an
 * integrator.
 */
function shapedEvent(t, spec) {
  const e = envelope(t, spec);
  if (e <= 1e-5) return 0;
  const p = eventProgress(t, spec);
  if (p < 0) return e;

  const attack = spec.attack;
  let shaped = e;

  // ANTICIPATION: a brief counter-move at the very start of the attack. Scaled
  // by the envelope so it cannot punch through the window edge.
  const antWin = attack * ANIM.anticipationWindow;
  if (p < antWin && antWin > 1e-6) {
    const a = p / antWin;
    shaped -= ANIM.anticipation * Math.sin(Math.PI * a);
  }

  // OVERSHOOT + ELASTIC SETTLE: a damped sine that begins as the attack
  // completes and rings down. Windowed by `e`, so it dies with the event.
  if (p > attack) {
    const q = (p - attack) / Math.max(1e-6, 1 - attack);
    const ring = Math.sin(Math.PI * ANIM.settleRipples * 2 * q) *
      Math.exp(-ANIM.overshootDecay * q);
    shaped += ANIM.overshoot * ring * e;
  }
  return shaped;
}

// Gaussian falloff in unit-sphere space, shared by every localized event. This
// is the single mechanism that keeps deformation SPATIAL: an event only reaches
// vertices near its own site, so regions genuinely respond at different times.
function siteFalloff(px, py, pz, site, width) {
  const dx = px - site[0], dy = py - site[1], dz = pz - site[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  return Math.exp(-d2 / (2 * width * width));
}

// Local phase offset: a vertex further from an event's origin responds later.
// This is the inertia / propagation term -- neighbouring regions lag rather
// than moving in lockstep, so deformation visibly travels through the manifold.
function localPhase(t, px, py, pz, site) {
  const dx = px - site[0], dy = py - site[1], dz = pz - site[2];
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return t - dist * ANIM.propagationDelay;
}

function paramIndex(i, j) {
  const wrappedI = (i + US) % US;
  const boundedJ = clamp(j, 0, VS - 1);
  return wrappedI * VS + boundedJ;
}

// --- Topology ---------------------------------------------------------------
// Neighbours are resolved once. On the pole rows the "outward" neighbour would
// be a clamped duplicate of the vertex itself, which degenerates the Laplacian;
// those rows are flagged and averaged around their ring instead.
function buildTopology() {
  const du = TAU / US;
  const vSpan = Math.PI - 0.07;
  const dv = vSpan / (VS - 1);
  for (let i = 0; i < US; i++) {
    for (let j = 0; j < VS; j++) {
      const idx = paramIndex(i, j);
      paramU[idx] = i * du;
      paramV[idx] = 0.035 + j * dv;
      const n = idx * 4;
      neighbourIndex[n] = paramIndex(i - 1, j);
      neighbourIndex[n + 1] = paramIndex(i + 1, j);
      neighbourIndex[n + 2] = paramIndex(i, j - 1);
      neighbourIndex[n + 3] = paramIndex(i, j + 1);
      isPoleRow[idx] = (j === 0 || j === VS - 1) ? 1 : 0;
    }
  }
}

// --- The manifold -----------------------------------------------------------
// ONE continuous deformable manifold: a squashed/widened base sphere plus a
// sum of broad vector displacement fields (DEFORMERS) and a dedicated neck
// deformation (NECK / NECK_SECONDARY). This is deliberately NOT a star-shaped
// radial field (position = direction * scalar(direction)): each deformer
// displaces the base point by a 3D vector, including a tangential component,
// so the surface can genuinely fold and twist rather than only bulge along
// rays from the origin. Lobes, folds and the neck all fall out of the same
// summed field instead of being separate primitives glued together.

function vlen(x, y, z) { return Math.hypot(x, y, z) || 1e-6; }

// Scratch accumulator triple, reused across calls -- avoids a per-vertex
// array allocation in the hot per-frame path (4608 verts * 60fps).
const _acc = { x: 0, y: 0, z: 0 };

// A single broad deformer: pushes the base point along `dir`, falling off
// smoothly with distance from `c` (in baseRadius units), and flattens the
// component of the point along `dir` near the centre -- compressing what
// would otherwise be a spherical bulge into a broader, flatter face.
// Accumulates into _acc instead of returning/allocating.
function applyDeformer(px, py, pz, d, weightMod) {
  const dx = px - d.c[0], dy = py - d.c[1], dz = pz - d.c[2];
  const dist = vlen(dx, dy, dz);
  const w = Math.exp(-(dist * dist) / (2 * d.width * d.width)) * weightMod;
  if (w < 1e-5) return;
  const dir = d.dir;
  const push = d.amp * w;
  const along = dx * dir[0] + dy * dir[1] + dz * dir[2];
  // Flatten: pull the point back toward the plane through c perpendicular to
  // dir, proportional to how far along dir it already sits. This is what
  // stops the deformer from reading as a sphere -- the face it produces is
  // compressed along its own push axis instead of bulging uniformly outward.
  const flat = d.flatten * w * along;
  _acc.x += dir[0] * push - dir[0] * flat;
  _acc.y += dir[1] * push - dir[1] * flat;
  _acc.z += dir[2] * push - dir[2] * flat;
}

// Neck deformation: a MULTIPLICATIVE pinch on the offset from the a-b axis,
// gated only by position ALONG the axis (not by perpendicular distance --
// the surface sits well outside the neck's own radius, so a perpendicular
// gaussian would gate the effect to nothing), plus a tangential twist about
// the axis. Scaling the existing offset (rather than nudging it by a fixed
// amount) is what turns a distant, wide surface into a genuine waist: the
// pinch is felt in proportion to how far out the surface already is.
// twistAmount and bandScale are now passed in per-frame (they used to be read
// straight off the NECK constant and a single global envelope) so EVENT 02
// (torsion) and EVENT 03 (pinch) can drive the same neck on separate clocks.
// bandScale < 1 narrows the affected band -- a tighter, more singular neck.
function applyNeck(px, py, pz, n, pinchAmount, twistAmount, bandScale) {
  const ax = n.a[0], ay = n.a[1], az = n.a[2];
  const bx = n.b[0], by = n.b[1], bz = n.b[2];
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  const eLen = vlen(ex, ey, ez);
  const ux = ex / eLen, uy = ey / eLen, uz = ez / eLen;
  const rx = px - ax, ry = py - ay, rz = pz - az;
  const tRaw = (rx * ux + ry * uy + rz * uz) / eLen;
  // Band extends a bit past the segment ends so the pinch reaches the
  // surface (which sits outside [a,b], since a/b are interior throat
  // points), then falls off smoothly.
  const t = clamp(tRaw, -0.6, 1.6);
  // bandScale narrows the falloff during the pinch climax: the same total
  // pinch concentrated into a shorter stretch of the axis reads as a genuine
  // near-singular neck rather than a broadly sagging waist.
  const bs = bandScale === undefined ? 1 : clamp(bandScale, 0.25, 1);
  const band = smooth01(1 - Math.abs(tRaw - 0.5) / (1.1 * bs));
  if (band < 1e-4) return;
  const cx = ax + ex * t, cy = ay + ey * t, cz = az + ez * t;
  const ox = px - cx, oy = py - cy, oz = pz - cz;
  const perpDist = vlen(ox, oy, oz);
  // Wider on one side (near a, t small), tighter on the other (near b) --
  // asymmetric pinch rather than a symmetric hourglass.
  const sideBias = 0.55 + 0.45 * (1 - clamp(tRaw, 0, 1));
  const scale = clamp(1 - pinchAmount * band * sideBias, 0.15, 1);
  const newOx = ox * scale, newOy = oy * scale, newOz = oz * scale;

  // Tangential twist: rotate the (already-pinched) offset about axis u. The
  // angle is graded ALONG the axis (tRaw term), not constant across the band,
  // so the neck shears -- adjacent cross-sections rotate by different amounts,
  // which is what makes the contours bend with the torsion instead of the
  // whole region rotating rigidly.
  const tw = twistAmount === undefined ? n.twist : twistAmount;
  const ang = tw * band * (0.35 + 0.65 * clamp(tRaw, 0, 1));
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const dot = newOx * ux + newOy * uy + newOz * uz;
  const crx = uy * newOz - uz * newOy, cry = uz * newOx - ux * newOz, crz = ux * newOy - uy * newOx;
  const rotx = newOx * cosA + crx * sinA + ux * dot * (1 - cosA);
  const roty = newOy * cosA + cry * sinA + uy * dot * (1 - cosA);
  const rotz = newOz * cosA + crz * sinA + uz * dot * (1 - cosA);

  // Net displacement from the ORIGINAL point.
  _acc.x += (cx + rotx) - px;
  _acc.y += (cy + roty) - py;
  _acc.z += (cz + rotz) - pz;
}

// Closed-form target manifold. Every time-dependent term is an integer
// harmonic of TAU * loopProgress, so the surface is exactly periodic.
// Writes directly into `out` (a 3-element view into surface.target) --
// no per-vertex allocation.
// --- Event deformations -----------------------------------------------------
// Each of these acts on a LOCAL region only, with its own local phase offset,
// so no event ever multiplies the whole mesh by a single animation value.

// EVENT 01: a localized inward contraction on one flank, with a simultaneous
// outward push on the OPPOSING flank. The two are driven by the same envelope
// but different sites and opposite signs -- the form gains tension immediately
// instead of scaling as a whole.
function applyCompression(px, py, pz, t) {
  const site = EVENT_SITES.compress;
  const anti = EVENT_SITES.counter;
  // Local phase: vertices further from the contraction origin respond later,
  // so the contraction visibly travels into the flank.
  const lp = localPhase(t, px, py, pz, site);
  // shapedEvent rather than envelope: the flank winds slightly OUTWARD before
  // it contracts, then rings past its target and settles (§12/§13).
  const e = shapedEvent(lp, ANIM.compression);
  if (Math.abs(e) > 1e-4) {
    const w = siteFalloff(px, py, pz, site, 0.66);
    const pull = -ANIM.compressionStrength * e * w;
    const dx = px - site[0], dy = py - site[1], dz = pz - site[2];
    const m = vlen(dx, dy, dz);
    _acc.x += (dx / m) * pull;
    _acc.y += (dy / m) * pull;
    _acc.z += (dz / m) * pull;
  }
  // Counter-expansion lags slightly more -- the opposing side answers, it does
  // not move in unison.
  // ELASTIC SETTLE (§14): the opposing flank answers on a longer lag than the
  // primary, so the pair reads as one region driving and another catching up
  // rather than two halves moving in lockstep.
  const lpAnti = localPhase(t, px, py, pz, anti) - 0.025 - ANIM.settleLag;
  const eAnti = shapedEvent(lpAnti, ANIM.compression);
  if (Math.abs(eAnti) > 1e-4) {
    const w = siteFalloff(px, py, pz, anti, 0.72);
    const push = ANIM.counterExpansion * eAnti * w;
    const dx = px - anti[0], dy = py - anti[1], dz = pz - anti[2];
    const m = vlen(dx, dy, dz);
    _acc.x += (dx / m) * push;
    _acc.y += (dy / m) * push;
    _acc.z += (dz / m) * push;
  }
}

// EVENT 04: the compressed structure releases into a broad asymmetric fold.
// Deliberately NOT the inverse of the compression -- it acts at bloomSite (up
// and to the right) rather than back at the compression flank, and adds a
// lateral splay, so the geometry reorganises rather than rewinding.
function applyBloomFold(px, py, pz, t) {
  const site = EVENT_SITES.bloomSite;
  const lp = localPhase(t, px, py, pz, site);
  // §18: the release must be visibly faster than the ordinary deformation
  // rate. shapedEvent supplies the overshoot-and-settle; the extra pow(0.62)
  // on the rising side front-loads the opening so the lobe snaps out and then
  // eases, instead of interpolating linearly from closed to open.
  const eRaw = shapedEvent(lp, ANIM.bloom);
  if (Math.abs(eRaw) < 1e-4) return;
  const e = eRaw > 0 ? Math.pow(eRaw, 0.62) : eRaw;
  const w = siteFalloff(px, py, pz, site, 0.78);
  const open = ANIM.bloomStrength * e * w;
  const dx = px - site[0], dy = py - site[1], dz = pz - site[2];
  const m = vlen(dx, dy, dz);
  _acc.x += (dx / m) * open;
  _acc.y += (dy / m) * open * 0.55;   // flattened -> a broad fold, not a balloon
  _acc.z += (dz / m) * open;
  // Asymmetric splay: pushes the released material sideways so the unfold has
  // a direction and the silhouette genuinely changes.
  const splay = ANIM.bloomSplay * e * w;
  _acc.x += splay * 0.85;
  _acc.z += splay * 0.40;
}

// EVENT 05: a travelling curvature front. `s` is the surface coordinate along
// the wave axis (a projection onto the waveStart->waveEnd diagonal, normalised
// 0..1), and the front is a gaussian in that coordinate. As wavePos sweeps, a
// localized band of the manifold lifts and passes the motion along.
function applyCurvatureWave(px, py, pz, t) {
  const e = EV.wave;
  if (e < 1e-4) return;
  const a = EVENT_SITES.waveStart, b = EVENT_SITES.waveEnd;
  const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
  const eLen2 = ex * ex + ey * ey + ez * ez;
  const s = ((px - a[0]) * ex + (py - a[1]) * ey + (pz - a[2]) * ez) / eLen2;
  const d = s - wavePos;
  const front = Math.exp(-(d * d) / (2 * ANIM.curvatureWaveWidth * ANIM.curvatureWaveWidth));
  if (front < 1e-4) return;
  // Displace along the local outward direction: the front reads as a curvature
  // ridge crossing the surface, not as a translation of the whole body.
  const amp = ANIM.curvatureWaveStrength * e * front;
  const m = vlen(px, py, pz);
  _acc.x += (px / m) * amp;
  _acc.y += (py / m) * amp;
  _acc.z += (pz / m) * amp;
}

// EVENT 06: the return route. Rather than reversing the outbound events, the
// reconnection relaxes through a THIRD site path: the lower-left region shifts
// while the upper region settles, so the loop closes by a different geometry.
//
// TODO(user): the routing here is the main artistic call in EVENT 06.
// The working default below relaxes lower-left first, then upper. Alternatives
// worth trying: (a) route the return through the hiddenFold site so the form
// appears to settle from BEHIND, reading as depth rather than lateral shift;
// (b) drive it from the neck outward, so the reopening neck pushes the lobes
// back into place. (a) is calmer and hides the return; (b) is more legible but
// risks echoing the pinch too closely.
function applyReconnection(px, py, pz, t) {
  const e = EV.reconnect;
  if (e < 1e-4) return;
  // A slow lateral settle across the lower-left, phase-lagged by height so the
  // form reorganises from the bottom up.
  const heightLag = (0.5 - py * 0.5) * 0.06;
  const lp = t - heightLag;
  const eLocal = envelope(lp, ANIM.reconnect);
  const w = siteFalloff(px, py, pz, [-0.45, -0.42, 0.14], 0.85);
  const settle = 0.26 * eLocal * w;
  _acc.x -= settle * 0.75;
  _acc.y += settle * 0.35;
  _acc.z -= settle * 0.30;
}

// EQUILIBRIUM is balanced, not frozen. Two out-of-phase local settling fields
// keep curvature drifting through the neck and released lobe without a global
// breathing cycle.
function applyEquilibriumResidual(px, py, pz, t) {
  const enter = smooth01(clamp((t - 0.50) / 0.055, 0, 1));
  const exit = 1 - smooth01(clamp((t - 0.735) / 0.060, 0, 1));
  const active = enter * exit;
  if (active < 1e-4) return;
  const a = siteFalloff(px, py, pz, NECK.b, 0.62);
  const b = siteFalloff(px, py, pz, EVENT_SITES.bloomSite, 0.72);
  const settleA = Math.sin(TAU * (t + px * 0.16 - py * 0.10));
  const settleB = Math.sin(TAU * (t + 0.31 + py * 0.12 + pz * 0.10));
  const radial = vlen(px, py, pz) || 1;
  const amp = ANIM.equilibriumResidual * active;
  _acc.x += (px / radial) * amp * (a * settleA + b * settleB);
  _acc.y += (py / radial) * amp * (a * settleA - b * settleB * 0.55);
  _acc.z += (pz / radial) * amp * (a * settleA + b * settleB * 0.70);
}

function deformedPoint(nx, ny, nz, p, out, o) {
  // Base sphere: squashed vertically, widened laterally -- buys lateral
  // spread structurally rather than by scaling the whole object uniformly.
  let px = nx * CONFIG.lateralSpread;
  let py = ny * CONFIG.verticalCompression;
  let pz = nz * CONFIG.lateralSpread;

  // Per-deformer weights are now driven by EVENTS, not by a global sine. Each
  // mass answers to a different envelope, so the masses never pulse together --
  // this is what removes the "whole surface morphs at one speed" reading.
  // Compression squeezes the upper mass while the lower mass counter-expands;
  // the bloom re-inflates the wing.
  const wUpper = 1 - 0.26 * EV.compression + 0.10 * EV.bloom;
  const wWing = 1 + 0.30 * EV.bloom + 0.12 * EV.wave - 0.10 * EV.pinch;
  const wLower = 1 + 0.22 * EV.compression - 0.14 * EV.pinch + 0.12 * EV.reconnect;
  const wHidden = 1 + 0.18 * EV.wave + 0.10 * EV.reconnect;

  _acc.x = 0; _acc.y = 0; _acc.z = 0;
  applyDeformer(px, py, pz, DEFORMERS.upperMass, wUpper);
  applyDeformer(px, py, pz, DEFORMERS.lateralWing, wWing);
  applyDeformer(px, py, pz, DEFORMERS.lowerMass, wLower);
  applyDeformer(px, py, pz, DEFORMERS.hiddenFold, wHidden);
  // Localized events, each with its own site and local phase offset.
  applyCompression(px, py, pz, p);
  applyBloomFold(px, py, pz, p);
  applyCurvatureWave(px, py, pz, p);
  applyReconnection(px, py, pz, p);
  applyEquilibriumResidual(px, py, pz, p);
  px += _acc.x; py += _acc.y; pz += _acc.z;

  // Primary neck. The pinch now rides its OWN envelope (EVENT 03) and the
  // twist rides EVENT 02, so the neck tightens and the centre twists as two
  // distinct, separately-timed events rather than one blended morph.
  // pinchWidth tightens the band at the climax so the neck narrows sharply
  // instead of the whole waist sagging.
  _acc.x = 0; _acc.y = 0; _acc.z = 0;
  // §17: the pinch is shaped (anticipation: the neck swells slightly before it
  // closes) and driven by pinchShaped, which additionally decelerates through
  // the climax -- see evaluateEvents(). The band narrows harder than before
  // (0.45 -> 0.58) so the peak reads as a genuine near-singular waist.
  const pinchAmt = NECK.pinch * 0.4 + ANIM.pinchStrength * pinchShaped + 0.18;
  // §20 TORSIONAL PROPAGATION: the twist reaching THIS vertex is delayed by
  // its position along the neck axis, so cross-sections rotate at different
  // moments and the torsion visibly travels down the neck instead of the whole
  // region turning as one rigid unit.
  const twistLag = localPhase(p, px, py, pz, NECK.a) - ANIM.settleLag * 0.5;
  const eTwistLocal = shapedEvent(twistLag, ANIM.twist);
  const twistAmt = NECK.twist * (0.25 + ANIM.twistStrength / NECK.twist * eTwistLocal);
  applyNeck(px, py, pz, NECK, pinchAmt, twistAmt,
    1 - ANIM.pinchWidth * 0.58 * pinchShaped);
  px += _acc.x; py += _acc.y; pz += _acc.z;

  _acc.x = 0; _acc.y = 0; _acc.z = 0;
  // The secondary neck lags the primary by a full settleLag, so the two necks
  // never tighten or twist on the same frame -- the eye reads a sequence.
  const secLag = localPhase(p, px, py, pz, NECK_SECONDARY.a) - ANIM.settleLag * 1.6;
  const eSecTwist = shapedEvent(secLag, ANIM.twist);
  applyNeck(px, py, pz, NECK_SECONDARY,
    NECK_SECONDARY.pinch * (0.4 + 0.6 * EV.pinch) + 0.08,
    NECK_SECONDARY.twist * (0.3 + 0.9 * eSecTwist), 1);
  px += _acc.x; py += _acc.y; pz += _acc.z;

  // One low-frequency broad-fold term for surface life -- large-scale, not
  // micro-noise. Kept, but now gated on the wave event so it is a localized
  // ripple during EVENT 05 rather than a constant global undulation.
  const bend = 0.045 * Math.sin(1.0 * nx + TAU * p) * Math.cos(1.0 * ny + 0.7)
    * (0.35 + 0.65 * EV.wave);
  px += nx * bend;
  py += ny * bend;
  pz += nz * bend;

  out[o] = px * CONFIG.baseRadius;
  out[o + 1] = py * CONFIG.baseRadius;
  out[o + 2] = pz * CONFIG.baseRadius;
}

function updateTargetSurface(p) {
  for (let idx = 0; idx < pointCount; idx++) {
    const u = paramU[idx];
    const v = paramV[idx];
    const sv = Math.sin(v);
    const nx = sv * Math.cos(u);
    const ny = Math.cos(v);
    const nz = sv * Math.sin(u);
    deformedPoint(nx, ny, nz, p, surface.target, idx * 3);
  }
}

// --- Ricci-flow-inspired discrete curvature evolution ------------------------
// This is NOT a numerical Ricci flow solver. It is a real-time discrete
// approximation in the same spirit: a curvature-weighted geometric flow where
// the update direction comes from the mesh Laplacian (whose normal component
// approximates the mean curvature vector, the analogue of -2Ric acting on the
// embedding) and the rate is modulated by local curvature magnitude, so
// high-curvature necks evolve visibly faster than broad, flat lobes.

function computeLaplacianAndCurvature() {
  const pos = surface.positions;
  const lap = surface.laplacian;

  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    let ax = 0, ay = 0, az = 0;

    if (isPoleRow[idx]) {
      // Degenerate row: average the whole ring plus the adjacent ring so the
      // pole relaxes toward its own neighbourhood instead of toward itself.
      const j = paramV[idx] < Math.PI * 0.5 ? 0 : VS - 1;
      const jn = j === 0 ? 1 : VS - 2;
      for (let i = 0; i < US; i++) {
        const a = paramIndex(i, j) * 3;
        const b = paramIndex(i, jn) * 3;
        ax += pos[a] + pos[b];
        ay += pos[a + 1] + pos[b + 1];
        az += pos[a + 2] + pos[b + 2];
      }
      const inv = 1 / (US * 2);
      ax *= inv; ay *= inv; az *= inv;
    } else {
      const n = idx * 4;
      for (let k = 0; k < 4; k++) {
        const a = neighbourIndex[n + k] * 3;
        ax += pos[a]; ay += pos[a + 1]; az += pos[a + 2];
      }
      ax *= 0.25; ay *= 0.25; az *= 0.25;
    }

    // L(v_i) = average(neighbours) - v_i
    lap[o] = ax - pos[o];
    lap[o + 1] = ay - pos[o + 1];
    lap[o + 2] = az - pos[o + 2];
  }

  // Signed curvature proxy: the component of the Laplacian along the LOCAL
  // SURFACE NORMAL, not the radial direction from the origin. Once the
  // manifold folds and twists, radial != normal -- a normal taken from
  // position alone would flip sign on off-axis necks and decorrelate the
  // curvature highlight from the actual geometry. The true normal is built
  // from the tangent vectors (finite differences along u and v on the
  // deformed mesh), then oriented outward by comparing against the radial
  // direction (a sign check only, not a substitute for the normal itself).
  const nrm = surface.normals;
  const curv = surface.curvature;
  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    const n = idx * 4;
    const ia = neighbourIndex[n] * 3, ib = neighbourIndex[n + 1] * 3;
    const ic = neighbourIndex[n + 2] * 3, id = neighbourIndex[n + 3] * 3;
    // Tangent along u (wraps, always valid) and along v (clamped at poles,
    // still a valid finite-difference direction there).
    const tux = pos[ib] - pos[ia], tuy = pos[ib + 1] - pos[ia + 1], tuz = pos[ib + 2] - pos[ia + 2];
    const tvx = pos[id] - pos[ic], tvy = pos[id + 1] - pos[ic + 1], tvz = pos[id + 2] - pos[ic + 2];
    // Normal = tangent_u x tangent_v.
    let cx = tuy * tvz - tuz * tvy;
    let cy = tuz * tvx - tux * tvz;
    let cz = tux * tvy - tuy * tvx;
    let m = Math.hypot(cx, cy, cz);
    if (m < 1e-8) {
      // Degenerate cross product (rare, near-collinear tangents): fall back
      // to the radial direction rather than propagate a zero-length normal.
      m = Math.hypot(pos[o], pos[o + 1], pos[o + 2]) || 1;
      cx = pos[o]; cy = pos[o + 1]; cz = pos[o + 2];
    }
    let ux = cx / m, uy = cy / m, uz = cz / m;
    // Orient outward: flip if pointing toward the origin side of the vertex.
    const radialDot = ux * pos[o] + uy * pos[o + 1] + uz * pos[o + 2];
    if (radialDot < 0) { ux = -ux; uy = -uy; uz = -uz; }
    nrm[o] = ux; nrm[o + 1] = uy; nrm[o + 2] = uz;
    const k = (lap[o] * ux + lap[o + 1] * uy + lap[o + 2] * uz) / CONFIG.baseRadius;
    curv[idx] = Number.isFinite(k) ? k : 0;
  }

  // One smoothing sweep: the raw per-vertex value is noisy at grid scale and
  // makes the iso-contours jagged.
  smoothCurvatureField();

  const resp = surface.response;
  let rLo = Infinity, rHi = -Infinity;
  for (let idx = 0; idx < pointCount; idx++) {
    const r = curvatureResponse(curv[idx] * CONFIG.curvatureGain);
    const safe = Number.isFinite(r) ? clamp(r, 0, 1) : 0;
    resp[idx] = safe;
    if (safe < rLo) rLo = safe;
    if (safe > rHi) rHi = safe;
  }
  // Percentile normalisation, not min/max. The curvature distribution is
  // heavily bottom-skewed -- a handful of neck vertices sit far above the
  // bulk -- so normalising against the extremes leaves the median contour
  // near black. Anchoring on the 55th and 97th percentiles instead spends the
  // tonal range where the vertices actually are, which is what makes the
  // silhouette read instantly. Any well-behaved curvatureResponse() gets the
  // same treatment, so the mapping's shape stays the artistic choice while
  // the piece's contrast stays reliable.
  // Capture the RAW curvature energy before normalisation. The percentile
  // normaliser re-anchors to each frame's own distribution -- which is what
  // keeps the median contour visible, but it also means the pinch climax would
  // normalise to exactly the same brightness as a calm frame, silently
  // flattening the peak. Measuring the top-percentile raw magnitude against a
  // loop-constant reference preserves a genuine global intensity signal that
  // survives normalisation, so the climax can actually be the brightest moment.
  percentileScratch.set(curv);
  percentileScratch.sort();
  const rawHi = Math.abs(percentileScratch[Math.floor(0.985 * (pointCount - 1))]);
  const rawLo = Math.abs(percentileScratch[Math.floor(0.015 * (pointCount - 1))]);
  const rawPeak = Math.max(rawHi, rawLo) * CONFIG.curvatureGain;
  if (curvatureReference <= 0) curvatureReference = rawPeak;
  curvatureIntensity = clamp(rawPeak / (curvatureReference + 1e-6), 0, 2.2);

  normalizeResponseByPercentile(0.10, 0.92);
}

// Loop-constant curvature reference, set on the first primed frame; and the
// per-frame ratio against it. curvatureIntensity > 1 means this frame's surface
// is genuinely more curved than the resting state -- the peak signal that the
// per-frame percentile normalisation would otherwise erase.
let curvatureReference = 0;
let curvatureIntensity = 1;

const percentileScratch = new Float32Array(pointCount);
function normalizeResponseByPercentile(loQ, hiQ) {
  const resp = surface.response;
  percentileScratch.set(resp);
  percentileScratch.sort();
  const last = pointCount - 1;
  const rLo = percentileScratch[Math.floor(loQ * last)];
  const rHi = percentileScratch[Math.floor(hiQ * last)];
  const span = rHi - rLo;
  if (!(span > 1e-6)) return;
  const inv = 1 / span;
  for (let idx = 0; idx < pointCount; idx++) {
    // Gamma < 1 lifts the midtones so broad low-curvature lobes stay visible
    // as calm anchors instead of dropping out of the frame entirely.
    const t = clamp((resp[idx] - rLo) * inv, 0, 1);
    resp[idx] = Math.pow(t, 0.65);
  }
}

const curvatureScratch = new Float32Array(pointCount);
function smoothCurvatureField() {
  const curv = surface.curvature;
  for (let idx = 0; idx < pointCount; idx++) {
    const n = idx * 4;
    let sum = curv[idx];
    for (let k = 0; k < 4; k++) sum += curv[neighbourIndex[n + k]];
    curvatureScratch[idx] = sum * 0.2;
  }
  curv.set(curvatureScratch);
}

/**
 * curvatureResponse(kappa)
 *
 * Maps a signed, normalised curvature value onto the artwork's single visual
 * intensity channel in 0..1. Everything downstream reads this: contour
 * brightness, stroke weight, bloom contribution, filament survival, and the
 * per-vertex flow rate that decides which regions evolve fastest.
 *
 * kappa: roughly -3 .. +3 in practice. Negative = saddle / neck (the surface
 * curves away from the outward normal). Positive = convex lobe cap.
 *
 * TODO(user): implement the mapping.
 *
 * Trade-offs to weigh:
 *   - Symmetric |kappa| response treats necks and lobe caps alike -- clean and
 *     legible, but the necks stop being the dramatic feature.
 *   - Asymmetric response biased toward negative kappa makes the saddle/neck
 *     regions the brightest, densest zones. More sculptural, more spec-aligned
 *     ("necks tighten, glow more strongly"), but risks the lobes going dead.
 *   - A sharp mapping (high exponent / steep sigmoid) gives dramatic isolated
 *     hot zones and deep negative space; a soft one gives a continuous
 *     gradient that reads more like a field than a sculpture.
 *   - Must return a finite value in 0..1 for ALL inputs including 0 and large
 *     magnitudes, and should be C1 (no steps) or the contours will pop between
 *     frames.
 */
function curvatureResponse(kappa) {
  // Working default: asymmetric, biased toward NEGATIVE kappa so the saddle
  // necks are the brightest, densest zones and the convex lobe caps stay calm.
  // This is the reading the piece is built around ("the necks tighten"), and
  // it is what pairs with the smooth-union geometry, where the necks are the
  // only genuinely high-curvature regions.
  //
  // Necks get the full range; lobe caps are compressed into the lower third so
  // broad convex areas read as quiet anchors rather than competing highlights.
  // Smooth and finite for all inputs including 0 and large magnitudes.
  if (!Number.isFinite(kappa)) return 0;
  const neck = clamp(-kappa, 0, 3) / 3;      // saddle side, 0..1
  const capped = clamp(kappa, 0, 3) / 3;     // convex side, 0..1
  // Knee constants chosen so a fully saturated neck reaches ~1.0 rather than
  // topping out partway: with a 0.45 knee the neck term maxed at 0.69, which
  // left the raw response unable to span its own range before normalisation.
  const n = neck / (0.30 + 0.70 * neck);     // -> 1.0 as neck -> 1
  const c = capped / (1.6 + capped);         // much flatter convex response
  return clamp(0.90 * n + 0.26 * c, 0, 1);
}

// Curvature-weighted relaxation. Two forces act each frame:
//   1. reseed toward the closed-form periodic target (bounded + loop-safe),
//   2. a curvature-driven Laplacian step whose rate scales with the local
//      curvature response, so necks move fast and broad lobes move slowly.
function evolveSurface() {
  const pos = surface.positions;
  const tgt = surface.target;
  const lap = surface.laplacian;
  const resp = surface.response;

  const reseed = CONFIG.reseedRate;
  // Global flow rate now tracks summed event activity, so the relaxation
  // accelerates while an event is firing and eases in the handoff troughs --
  // this is where the rhythm's acceleration/deceleration lives. It scales
  // SPEED only; it never multiplies the shape.
  const flowScale = CONFIG.curvatureFlowRate * (0.30 + 0.95 * flowT);

  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    // Reseed toward the periodic target.
    let x = pos[o] + (tgt[o] - pos[o]) * reseed;
    let y = pos[o + 1] + (tgt[o + 1] - pos[o + 1]) * reseed;
    let z = pos[o + 2] + (tgt[o + 2] - pos[o + 2]) * reseed;

    // Curvature-dependent flow: rate varies per vertex, so this is not a
    // uniform smoothing pass. The spread is widened by curvatureSpeedGain --
    // high-curvature necks now evolve several times faster than broad flat
    // lobes, which is the Ricci-flow-inspired behaviour and also the reason
    // the surface reads as deforming region-by-region rather than all at once.
    const rate = flowScale * (0.05 + ANIM.curvatureSpeedGain * resp[idx] * resp[idx]);
    x += lap[o] * rate;
    y += lap[o + 1] * rate;
    z += lap[o + 2] * rate;

    pos[o] = Number.isFinite(x) ? x : tgt[o];
    pos[o + 1] = Number.isFinite(y) ? y : tgt[o + 1];
    pos[o + 2] = Number.isFinite(z) ? z : tgt[o + 2];
  }

  // Global scale constraint: hold the mean radius near the target's mean radius
  // so curvature flow cannot collapse the manifold toward a point.
  constrainGlobalScale();
}

function constrainGlobalScale() {
  const pos = surface.positions;
  const tgt = surface.target;
  let sumPos = 0, sumTgt = 0;
  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    sumPos += Math.hypot(pos[o], pos[o + 1], pos[o + 2]);
    sumTgt += Math.hypot(tgt[o], tgt[o + 1], tgt[o + 2]);
  }
  if (sumPos < 1e-6) return;
  const k = clamp(sumTgt / sumPos, 0.5, 2.0);
  if (!Number.isFinite(k)) return;
  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    pos[o] *= k; pos[o + 1] *= k; pos[o + 2] *= k;
  }
}

// Run the relaxation to a settled state before the first rendered frame, so
// the loop opens on a complete sculpture rather than the bare target.
function primeState() {
  loopProgress = 0; phase = 0;
  // Solve the loop-constant framing FIRST (it sweeps the whole loop and leaves
  // the event state at an arbitrary phase), then evaluate events at t=0 through
  // the same evaluator the render loop uses. Hand-setting the envelope values
  // here would make frame 0's target disagree with the loop's own t=0 and the
  // opening frames would jerk -- the one place this is easy to get wrong.
  solveLoopFraming();
  evaluateEvents(0);
  updateTargetSurface(0);
  surface.positions.set(surface.target);
  for (let step = 0; step < 40; step++) {
    computeLaplacianAndCurvature();
    evolveSurface();
  }
  computeLaplacianAndCurvature();
  for (const e of echoStates) e.set(surface.positions);
}

function updateLoopTime() {
  const frame = isRecording ? recFrameCount : frameCount - 1;
  loopProgress = (((frame % LOOP_FRAMES) + LOOP_FRAMES) % LOOP_FRAMES) / LOOP_FRAMES;
  phase = loopProgress * TAU;
  evaluateEvents(loopProgress);
}

// Evaluate all six event envelopes for a given loop phase. Split out of
// updateLoopTime so primeState() can evaluate at t=0 through the SAME path --
// otherwise frame 0's target would not match the loop's own t=0 and the
// opening frames would jerk.
function evaluateEvents(t) {
  EV.compression = envelope(t, ANIM.compression);
  EV.twist = envelope(t, ANIM.twist);
  EV.pinch = envelope(t, ANIM.pinch);
  EV.bloom = envelope(t, ANIM.bloom);
  EV.wave = envelope(t, ANIM.wave);
  EV.reconnect = envelope(t, ANIM.reconnect);

  // Travelling-front position across the wave window, 0 -> 1. Eased so the
  // front accelerates into the manifold and decelerates as it exits.
  let wl = ANIM.wave.end - ANIM.wave.start;
  if (wl <= 0) wl += 1;
  const wd = phaseDist(t, ANIM.wave.start + wl * 0.5) + wl * 0.5;
  wavePos = smoother01(clamp(wd / wl, 0, 1)) * ANIM.curvatureWaveSpeed;

  // Summed activity drives the GLOBAL flow rate only -- never shape. Normalised
  // against the schedule's own measured range so it spans ~0..1 in practice.
  activity = EV.compression + EV.twist + EV.pinch + EV.bloom + EV.wave + EV.reconnect;
  flowT = clamp((activity - 0.75) / 0.85, 0, 1);

  // peakness isolates the single climax: high only while the pinch is at full
  // hold and nothing else has taken over. This is what stops every frame from
  // carrying equal intensity.
  peakness = EV.pinch * clamp(1 - EV.bloom * 1.4, 0, 1) * clamp(1 - EV.twist * 0.8, 0, 1);

  // Shaped pinch: anticipation swell, then the close, then a settle.
  pinchShaped = shapedEvent(t, ANIM.pinch);

  // §17 TIME DILATION AROUND THE SINGULARITY. At the pinch peak the global
  // flow rate is pulled down so the deformation decelerates for ~0.2s and the
  // eye is given time to register the neck. It is a rate scale, never a freeze
  // -- flowT keeps a floor so the surface is always evolving.
  flowT = clamp(flowT * (1 - 0.42 * peakness), 0.06, 1);

  updateFocalPoint(t);
}

// §09 TRAVELLING HIGHLIGHT. The focal point walks a continuous route through
// the sculpture: compression flank -> primary neck -> bloom lobe -> along the
// wave diagonal -> back. Position is piecewise-interpolated between the same
// EVENT_SITES the geometry uses, so the brightest region is always sitting on
// the part of the manifold that is actually deforming.
//
// §16 DIFFERENT PROPAGATION SPEEDS: the route parameter is passed through
// smoother01 per leg, so the focus eases out of one site, crosses fast, and
// decelerates into the next -- rather than sliding at constant speed. The neck
// leg is additionally slowed by the peakness term, so the highlight is
// visibly ATTRACTED to the curvature concentration and lingers there.
const FOCAL_ROUTE = [
  EVENT_SITES.compress,    // 0.00 -- opening contraction
  NECK.a,                  // 0.28 -- into the primary neck
  EVENT_SITES.bloomSite,   // 0.52 -- released lobe
  EVENT_SITES.waveEnd,     // 0.74 -- carried out along the wave
  EVENT_SITES.waveStart,   // 0.88 -- returns by a DIFFERENT route (§31)
];
const FOCAL_KEYS = [0.0, 0.28, 0.52, 0.74, 0.88];

function updateFocalPoint(t) {
  const n = FOCAL_ROUTE.length;
  // Locate the leg containing t, wrapping the last leg back to the first so
  // the route is a closed circuit and the focus never jumps at the seam.
  let leg = n - 1;
  for (let k = 0; k < n - 1; k++) {
    if (t >= FOCAL_KEYS[k] && t < FOCAL_KEYS[k + 1]) { leg = k; break; }
  }
  const t0 = FOCAL_KEYS[leg];
  const t1 = leg === n - 1 ? FOCAL_KEYS[0] + 1 : FOCAL_KEYS[leg + 1];
  const tt = t < t0 ? t + 1 : t;
  const raw = clamp((tt - t0) / Math.max(1e-6, t1 - t0), 0, 1);
  // Ease each leg: slow departure, fast crossing, slow arrival (§16).
  const eased = smoother01(raw);
  const a = FOCAL_ROUTE[leg];
  const b = FOCAL_ROUTE[(leg + 1) % n];
  const R = CONFIG.baseRadius;
  focalPoint.x = (a[0] + (b[0] - a[0]) * eased) * R;
  focalPoint.y = (a[1] + (b[1] - a[1]) * eased) * R;
  focalPoint.z = (a[2] + (b[2] - a[2]) * eased) * R;
  // Strength: always present, but strongest at the climax and while the wave
  // is crossing. Never zero -- §29 requires a moving focus from frame one.
  focalPoint.strength = clamp(0.42 + 0.5 * peakness + 0.34 * EV.wave +
    0.22 * EV.bloom, 0, 1.25);

  // §24 COMPOSITION DRIFT: the framed centre leans gently toward the active
  // focal region. Bounded to compositionDrift px so the sculpture never walks
  // out of frame, and derived from the focal route (already a closed circuit)
  // so it returns exactly to its starting offset at the seam.
  const d = ANIM.compositionDrift;
  focusOffset.x = clamp(focalPoint.x * 0.055, -d, d);
  focusOffset.y = clamp(focalPoint.y * 0.055, -d, d);
}

// Labels are driven by monotonic loopProgress, not by the palindromic flow
// envelope -- otherwise the stage label and percent would count back down
// through the second half of the loop.
// Label boundaries track the EVENT schedule (ANIM) rather than even fifths, so
// the stage caption changes when the geometry actually changes stage.
function currentPhaseInfo() {
  const t = loopProgress;
  if (t < 0.13) return PHASES[0];   // compression
  if (t < 0.27) return PHASES[1];   // torsion
  if (t < 0.50) return PHASES[2];   // pinch -> climax
  if (t < 0.72) return PHASES[3];   // bloom
  return PHASES[4];                 // wave -> reconnection
}

function draw() {
  updateLoopTime();
  updateTargetSurface(loopProgress);
  computeLaplacianAndCurvature();
  evolveSurface();
  updateContours();
  updateEchoes();
  measureExtents();
  renderFrame();
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

function updateEchoes() {
  const frame = isRecording ? recFrameCount : frameCount - 1;
  if (frame % CONFIG.echoStride !== 0) return;
  echoStates[echoWrite].set(surface.positions);
  echoWrite = (echoWrite + 1) % CONFIG.temporalEchoCount;
}

// --- Iso-contour extraction --------------------------------------------------
// Marching squares over the (u,v) grid on the curvature field, emitted as 3D
// polyline segments that ride the deformed mesh. Uniform iso-levels mean the
// contours automatically compress wherever the curvature gradient is steep --
// i.e. across the necks -- and spread out over the smooth lobes. This replaces
// the latitude/longitude wireframe entirely.

let contourSegments = new Float32Array(0);
let contourSegmentNormals = new Float32Array(0);
let contourSegmentResponse = new Float32Array(0);
let contourValues = new Float32Array(0);
let contourResponse = new Float32Array(0); // curvature response, interpolated
                                            // on the same edge/t as the segment
let contourSegCount = 0;

function ensureContourCapacity(n) {
  if (contourSegments.length >= n * 6) return;
  contourSegments = new Float32Array(n * 6);
  contourSegmentNormals = new Float32Array(n * 6);
  contourSegmentResponse = new Float32Array(n * 2);
  contourValues = new Float32Array(n);
  contourResponse = new Float32Array(n);
}

function lerpVertex(out, o, ia, ib, t) {
  const a = ia * 3, b = ib * 3;
  const pos = surface.positions;
  out[o] = pos[a] + (pos[b] - pos[a]) * t;
  out[o + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * t;
  out[o + 2] = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * t;
}

const percentileLevelScratch = new Float32Array(pointCount);

function updateContours() {
  const curv = surface.curvature;
  // Percentile-placed levels, not uniform min..max. The curvature distribution
  // is bottom-skewed (a handful of neck vertices sit far above the bulk), so
  // uniform levels put most of them where the mesh has no vertices at all --
  // that is what produced scattered, disconnected dashes instead of coherent
  // bands. Anchoring on percentiles spends the level budget where the surface
  // actually varies, the same fix already applied to surface.response.
  percentileLevelScratch.set(curv);
  percentileLevelScratch.sort();
  const last = pointCount - 1;
  const lo = percentileLevelScratch[Math.floor(0.06 * last)];
  const hi = percentileLevelScratch[Math.floor(0.96 * last)];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-9) {
    contourSegCount = 0;
    return;
  }

  const levels = CONFIG.contourCount;
  ensureContourCapacity(US * (VS - 1) * levels * 2);
  const seg = contourSegments;
  const segNrm = contourSegmentNormals;
  const segResp = contourSegmentResponse;
  const resp = surface.response;
  let n = 0;

  for (let li = 0; li < levels; li++) {
    const t = (li + 0.5) / levels;
    const level = lo + (hi - lo) * t;
    for (let i = 0; i < US; i++) {
      // Skip the pole-adjacent bands. Those rows collapse to a single point in
      // 3D, so every cell there shares a vertex and the iso-lines degenerate
      // into concentric spirals around the poles instead of surface contours.
      for (let j = POLE_SKIP; j < VS - 1 - POLE_SKIP; j++) {
        const i0 = paramIndex(i, j);
        const i1 = paramIndex(i + 1, j);
        const i2 = paramIndex(i + 1, j + 1);
        const i3 = paramIndex(i, j + 1);
        const c0 = curv[i0], c1 = curv[i1], c2 = curv[i2], c3 = curv[i3];

        let code = 0;
        if (c0 > level) code |= 1;
        if (c1 > level) code |= 2;
        if (c2 > level) code |= 4;
        if (c3 > level) code |= 8;
        if (code === 0 || code === 15) continue;

        // Edge crossing parameters (guarded against zero denominators).
        const e = MS_EDGES[code];
        if (!e) continue;
        const o = n * 6;
        if (o + 12 > seg.length) { contourSegCount = n; return; }
        const r0 = writeCrossing(seg, segNrm, segResp, o, n * 2, e[0],
          i0, i1, i2, i3, c0, c1, c2, c3, level, resp);
        const r1 = writeCrossing(seg, segNrm, segResp, o + 3, n * 2 + 1, e[1],
          i0, i1, i2, i3, c0, c1, c2, c3, level, resp);
        contourValues[n] = level;
        contourResponse[n] = (r0 + r1) * 0.5;
        n++;
        if (e.length === 4) {
          const o2 = n * 6;
          const r2 = writeCrossing(seg, segNrm, segResp, o2, n * 2, e[2],
            i0, i1, i2, i3, c0, c1, c2, c3, level, resp);
          const r3 = writeCrossing(seg, segNrm, segResp, o2 + 3, n * 2 + 1, e[3],
            i0, i1, i2, i3, c0, c1, c2, c3, level, resp);
          contourValues[n] = level;
          contourResponse[n] = (r2 + r3) * 0.5;
          n++;
        }
      }
    }
  }
  contourSegCount = n;
  buildContourChains();
}

// --- Contour chaining --------------------------------------------------------
// §01/§02/§03. Marching squares emits segments in cell order, i.e. essentially
// arbitrary order, and the renderer used to draw each as an independent line().
// That is why the contour layer read as dashes and why "hero contours" could
// not simply be brightened into existence: brightening a subset of unordered
// segments gives you bright dashes, not a continuous stroke.
//
// Here the segments are welded into POLYLINES by shared endpoints. This buys
// three things at once:
//   - chains shorter than minChainLength are dropped, which is the principled
//     30-50% line-density reduction (§01) -- short chains are exactly the
//     speckle that made the surface look like a mesh readout,
//   - the survivors are continuous curves that can be stroked with
//     beginShape/vertex, so they read as topographic strata (§02),
//   - chains can be RANKED, so the longest/highest-curvature ones become the
//     hero contours (§03) instead of every band having equal weight.
//
// Welding is done on a quantised spatial hash of the endpoints: marching
// squares produces exactly coincident endpoints for adjacent cells on the same
// level, so a fine quantisation is both safe and cheap.

const CHAIN_QUANT = 0.55;          // world units; well below segment length
let chainStarts = new Int32Array(0);   // index into chainVerts, per chain
let chainLengths = new Int32Array(0);  // vertex count per chain
let chainScore = new Float32Array(0);  // ranking score
let chainResp = new Float32Array(0);   // mean curvature response
let chainIsHero = new Uint8Array(0);
let chainIsClosed = new Uint8Array(0);
let chainVerts = new Float32Array(0);
let chainVertNormals = new Float32Array(0);
let chainVertResponse = new Float32Array(0);
let chainCount = 0;
let chainVertCount = 0;

const segUsed = new Uint8Array(0);
let _segUsed = segUsed;
const endpointMap = new Map();

function chainKey(x, y, z) {
  const qx = Math.round(x / CHAIN_QUANT);
  const qy = Math.round(y / CHAIN_QUANT);
  const qz = Math.round(z / CHAIN_QUANT);
  return qx + "," + qy + "," + qz;
}

function ensureChainCapacity(segCount) {
  if (_segUsed.length < segCount) _segUsed = new Uint8Array(segCount * 2);
  const vcap = (segCount + 2) * 3 * 2;
  if (chainVerts.length < vcap) {
    chainVerts = new Float32Array(vcap);
    chainVertNormals = new Float32Array(vcap);
    chainVertResponse = new Float32Array((segCount + 2) * 2);
    chainStarts = new Int32Array(segCount + 2);
    chainLengths = new Int32Array(segCount + 2);
    chainScore = new Float32Array(segCount + 2);
    chainResp = new Float32Array(segCount + 2);
    chainIsHero = new Uint8Array(segCount + 2);
    chainIsClosed = new Uint8Array(segCount + 2);
  }
}

function buildContourChains() {
  chainCount = 0;
  chainVertCount = 0;
  const segCount = contourSegCount;
  if (segCount === 0) return;
  ensureChainCapacity(segCount);
  const seg = contourSegments;
  const segNrm = contourSegmentNormals;
  const segResp = contourSegmentResponse;
  const used = _segUsed;
  used.fill(0, 0, segCount);

  // Endpoint -> list of segment indices touching it.
  endpointMap.clear();
  for (let s = 0; s < segCount; s++) {
    const o = s * 6;
    for (let end = 0; end < 2; end++) {
      const k = chainKey(seg[o + end * 3], seg[o + end * 3 + 1], seg[o + end * 3 + 2]);
      let list = endpointMap.get(k);
      if (list === undefined) { list = []; endpointMap.set(k, list); }
      list.push(s);
    }
  }

  // Walk from each unused segment in both directions to build a maximal chain.
  const forward = [];
  const forwardN = [];
  const forwardR = [];
  for (let s = 0; s < segCount; s++) {
    if (used[s]) continue;
    // Only chain segments on the SAME iso-level: different levels can share a
    // welded endpoint at a saddle, and joining across them would produce a
    // contour that jumps between elevations.
    const level = contourValues[s];
    used[s] = 1;
    const o = s * 6;
    forward.length = 0;
    forwardN.length = 0;
    forwardR.length = 0;
    forward.push(seg[o], seg[o + 1], seg[o + 2], seg[o + 3], seg[o + 4], seg[o + 5]);
    forwardN.push(segNrm[o], segNrm[o + 1], segNrm[o + 2],
      segNrm[o + 3], segNrm[o + 4], segNrm[o + 5]);
    forwardR.push(segResp[s * 2], segResp[s * 2 + 1]);
    let respSum = contourResponse[s];
    let respN = 1;

    // Extend forward from the tail, then backward from the head.
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        let hx, hy, hz;
        if (dir === 0) {
          const L = forward.length;
          hx = forward[L - 3]; hy = forward[L - 2]; hz = forward[L - 1];
        } else {
          hx = forward[0]; hy = forward[1]; hz = forward[2];
        }
        const list = endpointMap.get(chainKey(hx, hy, hz));
        if (list === undefined) break;
        let next = -1, nEnd = 0;
        for (let q = 0; q < list.length; q++) {
          const cand = list[q];
          if (used[cand]) continue;
          if (contourValues[cand] !== level) continue;
          const co = cand * 6;
          if (Math.abs(seg[co] - hx) < CHAIN_QUANT &&
              Math.abs(seg[co + 1] - hy) < CHAIN_QUANT &&
              Math.abs(seg[co + 2] - hz) < CHAIN_QUANT) { next = cand; nEnd = 1; break; }
          if (Math.abs(seg[co + 3] - hx) < CHAIN_QUANT &&
              Math.abs(seg[co + 4] - hy) < CHAIN_QUANT &&
              Math.abs(seg[co + 5] - hz) < CHAIN_QUANT) { next = cand; nEnd = 0; break; }
        }
        if (next < 0) break;
        used[next] = 1;
        const co = next * 6 + nEnd * 3;
        const cr = next * 2 + nEnd;
        respSum += contourResponse[next];
        respN++;
        if (dir === 0) {
          forward.push(seg[co], seg[co + 1], seg[co + 2]);
          forwardN.push(segNrm[co], segNrm[co + 1], segNrm[co + 2]);
          forwardR.push(segResp[cr]);
        } else {
          forward.unshift(seg[co], seg[co + 1], seg[co + 2]);
          forwardN.unshift(segNrm[co], segNrm[co + 1], segNrm[co + 2]);
          forwardR.unshift(segResp[cr]);
        }
      }
    }

    const vertCount = forward.length / 3;
    // §01: the density cut. Short chains are speckle, not structure.
    if (vertCount < CONFIG.minChainLength) continue;
    if (chainVertCount * 3 + forward.length > chainVerts.length) break;

    const start = chainVertCount;
    for (let q = 0; q < forward.length; q++) chainVerts[start * 3 + q] = forward[q];
    for (let q = 0; q < forwardN.length; q++) chainVertNormals[start * 3 + q] = forwardN[q];
    for (let q = 0; q < forwardR.length; q++) chainVertResponse[start + q] = forwardR[q];
    const meanResp = respSum / respN;
    chainStarts[chainCount] = start;
    chainLengths[chainCount] = vertCount;
    chainResp[chainCount] = meanResp;
    const dx = forward[0] - forward[forward.length - 3];
    const dy = forward[1] - forward[forward.length - 2];
    const dz = forward[2] - forward[forward.length - 1];
    const closed = Math.hypot(dx, dy, dz) < CHAIN_QUANT * 1.75;
    chainIsClosed[chainCount] = closed ? 1 : 0;
    // Hero ranking: long AND highly curved. Length matters because a hero
    // contour has to read as one continuous sweep across the form; curvature
    // matters because the heroes must land on the folds and necks (§03).
    // Closed loops are valid only as sparse secondary evidence. Long open
    // contours travel through folds and necks, which is the visual language
    // of a membrane rather than a CT slice.
    let focusCoverage = 0;
    for (let q = 0; q < vertCount; q += 3) {
      const qo = (start + q) * 3;
      focusCoverage += clamp(focalWeight(chainVerts[qo], chainVerts[qo + 1], chainVerts[qo + 2]), 0, 1);
    }
    focusCoverage /= Math.ceil(vertCount / 3);
    chainScore[chainCount] = vertCount * (0.42 + 1.35 * meanResp + 0.70 * focusCoverage) *
      (closed ? 0.08 : 1);
    chainIsHero[chainCount] = 0;
    chainVertCount += vertCount;
    chainCount++;
  }

  selectHeroContours();
}

// Promote the top-scoring chains to heroes. Partial selection by repeated max
// scan: heroContourCount is ~7, so this is far cheaper than sorting the
// full chain list every frame.
function selectHeroContours() {
  const want = Math.min(CONFIG.heroContourCount, chainCount);
  for (let h = 0; h < want; h++) {
    let best = -1, bestScore = -Infinity;
    for (let c = 0; c < chainCount; c++) {
      if (chainIsHero[c] || chainIsClosed[c]) continue;
      if (chainScore[c] > bestScore) { bestScore = chainScore[c]; best = c; }
    }
    if (best < 0) break;
    chainIsHero[best] = 1;
  }
}

// Cell edges: 0 = v0-v1, 1 = v1-v2, 2 = v2-v3, 3 = v3-v0. Returns the
// curvature response interpolated at the same crossing parameter t as the
// emitted vertex, so contour brightness stays exactly synced to the actual
// geometry -- replaces the acos/atan2 position inversion in the old
// sampleResponseNear(), which was only valid for a star-shaped surface.
function writeCrossing(out, normalsOut, responseOut, o, ro, edge,
  i0, i1, i2, i3, c0, c1, c2, c3, level, resp) {
  let ia, ib, ca, cb;
  if (edge === 0) { ia = i0; ib = i1; ca = c0; cb = c1; }
  else if (edge === 1) { ia = i1; ib = i2; ca = c1; cb = c2; }
  else if (edge === 2) { ia = i2; ib = i3; ca = c2; cb = c3; }
  else { ia = i3; ib = i0; ca = c3; cb = c0; }
  const d = cb - ca;
  const t = Math.abs(d) < 1e-12 ? 0.5 : clamp((level - ca) / d, 0, 1);
  lerpVertex(out, o, ia, ib, t);
  const na = ia * 3, nb = ib * 3;
  const nrm = surface.normals;
  let nx = nrm[na] + (nrm[nb] - nrm[na]) * t;
  let ny = nrm[na + 1] + (nrm[nb + 1] - nrm[na + 1]) * t;
  let nz = nrm[na + 2] + (nrm[nb + 2] - nrm[na + 2]) * t;
  const nm = vlen(nx, ny, nz) || 1;
  normalsOut[o] = nx / nm;
  normalsOut[o + 1] = ny / nm;
  normalsOut[o + 2] = nz / nm;
  const r = resp[ia] + (resp[ib] - resp[ia]) * t;
  responseOut[ro] = r;
  return r;
}

// Marching-squares edge table. Ambiguous saddles (5, 10) emit both segments.
const MS_EDGES = [
  null,        // 0
  [3, 0],      // 1
  [0, 1],      // 2
  [3, 1],      // 3
  [1, 2],      // 4
  [3, 0, 1, 2],// 5 (saddle)
  [0, 2],      // 6
  [3, 2],      // 7
  [2, 3],      // 8
  [2, 0],      // 9
  [0, 1, 2, 3],// 10 (saddle)
  [2, 1],      // 11
  [1, 3],      // 12
  [1, 0],      // 13
  [0, 3],      // 14
  null,        // 15
];

// --- Silhouette extraction ---------------------------------------------------
// §05. The silhouette of a smooth surface is, by definition, the set of points
// where the normal is perpendicular to the view ray: the ZERO LEVEL SET of the
// signed n·v field. The previous implementation walked every parameter column
// and emitted wherever |n·v| was small, which approximates that curve with a
// BAND. On a fold that lies tangent to the view over an extended stretch, the
// band condition holds simultaneously in dozens of adjacent columns, and the
// result is dozens of parallel strokes covering an area -- the "combing" that
// still read as wireframe hatching.
//
// Marching the zero contour instead yields the curve itself: one continuous
// stroke per silhouette edge, with combing impossible by construction. This
// reuses the same MS_EDGES / writeCrossing / weld machinery as the curvature
// contours; only the scalar field differs.

const facingField = new Float32Array(pointCount);   // signed n·v per vertex
let silSegments = new Float32Array(0);
let silDepth = new Float32Array(0);                 // fog term at the crossing
let silSegCount = 0;

let silStarts = new Int32Array(0);
let silLengths = new Int32Array(0);
let silVerts = new Float32Array(0);
let silVertDepth = new Float32Array(0);
let silCount = 0;
let silVertCount = 0;
let _silUsed = new Uint8Array(0);
const silEndpointMap = new Map();

// Signed n·v, normalised, for every vertex. Positive = facing the eye.
function updateFacingField() {
  const pos = surface.positions;
  const nrm = surface.normals;
  for (let k = 0; k < pointCount; k++) {
    const o = k * 3;
    const ex = cameraEye.x - pos[o];
    const ey = cameraEye.y - pos[o + 1];
    const ez = cameraEye.z - pos[o + 2];
    const m = vlen(ex, ey, ez) || 1;
    facingField[k] = (nrm[o] * ex + nrm[o + 1] * ey + nrm[o + 2] * ez) / m;
  }
}

function ensureSilCapacity(n) {
  if (silSegments.length >= n * 6) return;
  silSegments = new Float32Array(n * 6);
  silDepth = new Float32Array(n);
  _silUsed = new Uint8Array(n);
  silStarts = new Int32Array(n + 2);
  silLengths = new Int32Array(n + 2);
  silVerts = new Float32Array((n + 2) * 3 * 2);
  silVertDepth = new Float32Array((n + 2) * 2);
}

// Crossing of the zero level on one cell edge. Mirrors writeCrossing() but
// carries a fog term rather than a curvature response.
function writeSilCrossing(out, o, edge, i0, i1, i2, i3, f0, f1, f2, f3) {
  let ia, ib, fa, fb;
  if (edge === 0) { ia = i0; ib = i1; fa = f0; fb = f1; }
  else if (edge === 1) { ia = i1; ib = i2; fa = f1; fb = f2; }
  else if (edge === 2) { ia = i2; ib = i3; fa = f2; fb = f3; }
  else { ia = i3; ib = i0; fa = f3; fb = f0; }
  const d = fb - fa;
  const t = Math.abs(d) < 1e-12 ? 0.5 : clamp((0 - fa) / d, 0, 1);
  lerpVertex(out, o, ia, ib, t);
  return fogFactor(viewDepthAtPoint(out[o], out[o + 1], out[o + 2]));
}

function updateSilhouette() {
  updateFacingField();
  ensureSilCapacity(US * (VS - 1) * 2);
  const seg = silSegments;
  const f = facingField;
  let n = 0;

  for (let i = 0; i < US; i++) {
    for (let j = POLE_SKIP; j < VS - 1 - POLE_SKIP; j++) {
      const i0 = paramIndex(i, j);
      const i1 = paramIndex(i + 1, j);
      const i2 = paramIndex(i + 1, j + 1);
      const i3 = paramIndex(i, j + 1);
      const f0 = f[i0], f1 = f[i1], f2 = f[i2], f3 = f[i3];

      let code = 0;
      if (f0 > 0) code |= 1;
      if (f1 > 0) code |= 2;
      if (f2 > 0) code |= 4;
      if (f3 > 0) code |= 8;
      if (code === 0 || code === 15) continue;
      const e = MS_EDGES[code];
      if (!e) continue;
      const o = n * 6;
      if (o + 12 > seg.length) break;
      const d0 = writeSilCrossing(seg, o, e[0], i0, i1, i2, i3, f0, f1, f2, f3);
      const d1 = writeSilCrossing(seg, o + 3, e[1], i0, i1, i2, i3, f0, f1, f2, f3);
      silDepth[n] = (d0 + d1) * 0.5;
      n++;
      if (e.length === 4) {
        const o2 = n * 6;
        const d2 = writeSilCrossing(seg, o2, e[2], i0, i1, i2, i3, f0, f1, f2, f3);
        const d3 = writeSilCrossing(seg, o2 + 3, e[3], i0, i1, i2, i3, f0, f1, f2, f3);
        silDepth[n] = (d2 + d3) * 0.5;
        n++;
      }
    }
  }
  silSegCount = n;
  buildSilhouetteChains();
}

// Same weld as buildContourChains(), minus the iso-level constraint: the
// silhouette is a single level, so any two coincident endpoints belong together.
function buildSilhouetteChains() {
  silCount = 0;
  silVertCount = 0;
  const segCount = silSegCount;
  if (segCount === 0) return;
  const seg = silSegments;
  const used = _silUsed;
  used.fill(0, 0, segCount);

  silEndpointMap.clear();
  for (let s = 0; s < segCount; s++) {
    const o = s * 6;
    for (let end = 0; end < 2; end++) {
      const k = chainKey(seg[o + end * 3], seg[o + end * 3 + 1], seg[o + end * 3 + 2]);
      let list = silEndpointMap.get(k);
      if (list === undefined) { list = []; silEndpointMap.set(k, list); }
      list.push(s);
    }
  }

  const fwd = [];
  const fwdD = [];
  for (let s = 0; s < segCount; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const o = s * 6;
    fwd.length = 0; fwdD.length = 0;
    fwd.push(seg[o], seg[o + 1], seg[o + 2], seg[o + 3], seg[o + 4], seg[o + 5]);
    fwdD.push(silDepth[s], silDepth[s]);

    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        let hx, hy, hz;
        if (dir === 0) {
          const L = fwd.length;
          hx = fwd[L - 3]; hy = fwd[L - 2]; hz = fwd[L - 1];
        } else {
          hx = fwd[0]; hy = fwd[1]; hz = fwd[2];
        }
        const list = silEndpointMap.get(chainKey(hx, hy, hz));
        if (list === undefined) break;
        let next = -1, nEnd = 0;
        for (let q = 0; q < list.length; q++) {
          const cand = list[q];
          if (used[cand]) continue;
          const co = cand * 6;
          if (Math.abs(seg[co] - hx) < CHAIN_QUANT &&
              Math.abs(seg[co + 1] - hy) < CHAIN_QUANT &&
              Math.abs(seg[co + 2] - hz) < CHAIN_QUANT) { next = cand; nEnd = 1; break; }
          if (Math.abs(seg[co + 3] - hx) < CHAIN_QUANT &&
              Math.abs(seg[co + 4] - hy) < CHAIN_QUANT &&
              Math.abs(seg[co + 5] - hz) < CHAIN_QUANT) { next = cand; nEnd = 0; break; }
        }
        if (next < 0) break;
        used[next] = 1;
        const co = next * 6 + nEnd * 3;
        if (dir === 0) { fwd.push(seg[co], seg[co + 1], seg[co + 2]); fwdD.push(silDepth[next]); }
        else { fwd.unshift(seg[co], seg[co + 1], seg[co + 2]); fwdD.unshift(silDepth[next]); }
      }
    }

    const vertCount = fwd.length / 3;
    if (vertCount < CONFIG.silhouetteMinRun) continue;
    if (silVertCount * 3 + fwd.length > silVerts.length) break;
    const start = silVertCount;
    for (let q = 0; q < fwd.length; q++) silVerts[start * 3 + q] = fwd[q];
    for (let q = 0; q < vertCount; q++) silVertDepth[start + q] = fwdD[q];
    silStarts[silCount] = start;
    silLengths[silCount] = vertCount;
    silVertCount += vertCount;
    silCount++;
  }
}

// --- Framing -----------------------------------------------------------------
// Extents are measured from the closed-form TARGET, not the relaxed state, so
// the auto-framing distance is exactly periodic and does not pump with the flow.
let maxRadius = CONFIG.baseRadius;
let maxVerticalExtent = CONFIG.baseRadius;
const lookAtCenter = { x: 0, y: 0 };

// True axis-aligned bounding box, not distance from the origin. The form is
// deliberately off-centre now, so an origin-based measure (old maxRadius via
// hypot(x,z), maxVerticalExtent via abs(y)) would inflate toward whichever
// side sits farther from (0,0,0) even where the empty side of the frame is.
// half-extents are measured about the box's own centre, and lookAtCenter is
// that centre's X/Y (Z left at 0 -- depth offset would just push the whole
// form toward/away from the camera, not change the framed silhouette) so the
// composition is centred on the SCULPTURE, not on the coordinate origin.
// LOOP-CONSTANT framing. Measured once over the entire loop, then frozen.
//
// This matters more than it looks: the events are specifically designed to vary
// the silhouette by 10-25%. If the framing were still solved per-frame, the
// auto-fit would dolly in and out to compensate and convert that silhouette
// change into a global zoom pulse -- which is exactly the "global synchronized
// breathing" the piece must not have. Freezing the fit means a wider frame is
// seen as the form getting wider, which is the entire point of the choreography.
let framingSolved = false;
function solveLoopFraming() {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  const SAMPLES = 40;
  for (let s = 0; s < SAMPLES; s++) {
    const t = s / SAMPLES;
    evaluateEvents(t);
    updateTargetSurface(t);
    const tgt = surface.target;
    for (let idx = 0; idx < pointCount; idx++) {
      const o = idx * 3;
      const x = tgt[o], y = tgt[o + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  maxRadius = (maxX - minX) * 0.5;
  maxVerticalExtent = (maxY - minY) * 0.5;
  lookAtCenter.x = (minX + maxX) * 0.5;
  lookAtCenter.y = (minY + maxY) * 0.5;
  framingSolved = true;
}

function measureExtents() {
  if (framingSolved) return;   // framing is loop-constant; see solveLoopFraming
  const tgt = surface.target;
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let idx = 0; idx < pointCount; idx++) {
    const o = idx * 3;
    const x = tgt[o], y = tgt[o + 1], z = tgt[o + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  maxRadius = Math.max((maxX - minX) * 0.5, (maxZ - minZ) * 0.5);
  maxVerticalExtent = (maxY - minY) * 0.5;
  lookAtCenter.x = (minX + maxX) * 0.5;
  lookAtCenter.y = (minY + maxY) * 0.5;
}

function renderFrame() {
  setupCamera();
  // Must follow setupCamera(): the silhouette is the zero set of signed n·v,
  // so it is view-DEPENDENT and has to be re-extracted against this frame's
  // cameraEye. (The curvature contours live on the surface and are therefore
  // computed once per frame up in draw(), before the camera exists.)
  updateSilhouette();
  renderBloomSource();
  streakBloom();

  background(BG_R, BG_G, BG_B);
  // Perspective/camera are set by setupCamera() via applySculptureCamera(),
  // the same path the bloom buffer uses -- not duplicated here.
  drawEnvironment();
  push();
  applySculptureOrientation();
  drawTemporalEchoes();
  drawContourField();
  pop();
  compositeBloom();
  drawScreenFinish();
}

// Composed cinematic orientation: a slow drift out and back, much slower than
// the geometry evolution. All harmonics are integer multiples of the loop.
//
// SINGLE SOURCE OF TRUTH. The main canvas and the half-res bloom buffer used to
// each hand-write these three rotations with a "must stay in lockstep" comment;
// any edit to one and not the other silently detaches the glow from the
// sculpture. Both now call this with their own render target (`window` for the
// main canvas, the p5.Graphics for the bloom pass), so they cannot drift apart.
function applySculptureOrientation(target) {
  const g = target || window;
  // Slower and shallower than before (was 0.42 yaw + a 2x harmonic). The
  // camera must not be what makes the frame interesting, and the necks have to
  // stay side-on and readable through the bloom peak, so the yaw excursion is
  // roughly halved and the second harmonic dropped.
  g.rotateX(-0.15 - 0.07 * Math.sin(TAU * loopProgress));
  g.rotateZ(0.03 * Math.sin(TAU * loopProgress + 1.1));
  g.rotateY(-0.22 + 0.21 * Math.sin(TAU * loopProgress));
}

// Camera placement, likewise shared between the main canvas and the bloom
// buffer so a push/drift change can only ever be made in one place.
function applySculptureCamera(target) {
  const g = target || window;
  g.perspective(VFOV, ASPECT, 10, 5000);
  g.camera(cameraEye.x, cameraEye.y, cameraEye.z,
    lookAtCenter.x + focusOffset.x, lookAtCenter.y + focusOffset.y, 0, 0, 1, 0);
}

// --- Drawing -----------------------------------------------------------------

// View direction toward the eye, reused per-vertex in drawRimSilhouette --
// module scope so the hot loop below doesn't allocate.
const _toEye = { x: 0, y: 0, z: 0 };

// Travelling-front weight at a WORLD-space point, 0..1. Reads the exact same
// wave axis and front position as applyCurvatureWave(), so the moving highlight
// is the visual response of the same local field that is deforming the surface
// -- not an independently animated colour effect.
function waveHighlight(x, y, z) {
  if (EV.wave < 1e-4) return 0;
  const a = EVENT_SITES.waveStart, b = EVENT_SITES.waveEnd;
  const px = x / CONFIG.baseRadius, py = y / CONFIG.baseRadius, pz = z / CONFIG.baseRadius;
  const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2];
  const eLen2 = ex * ex + ey * ey + ez * ez;
  const s = ((px - a[0]) * ex + (py - a[1]) * ey + (pz - a[2]) * ez) / eLen2;
  const d = s - wavePos;
  const w = ANIM.curvatureWaveWidth;
  return Math.exp(-(d * d) / (2 * w * w)) * EV.wave;
}

// §08 THE dominant focal region, as a 0..1 weight at a world-space point.
// Unlike waveHighlight() this is defined across the ENTIRE loop, so there is
// always exactly one brightest area and the viewer's eye always has a target.
// Gaussian in world distance from focalPoint, which travels the FOCAL_ROUTE.
function focalWeight(x, y, z) {
  const dx = x - focalPoint.x, dy = y - focalPoint.y, dz = z - focalPoint.z;
  const d2 = (dx * dx + dy * dy + dz * dz) /
    (CONFIG.baseRadius * CONFIG.baseRadius);
  const w = ANIM.focalWidth;
  return Math.exp(-d2 / (2 * w * w)) * focalPoint.strength;
}

// §04 DEPTH-BASED VISIBILITY. Two DIFFERENT quantities come off the same dot
// product and they must not be conflated:
//   signed  -- the raw n·v. Its ZERO SET is the silhouette curve; both the
//              live outline and the echo outline are extracted from it.
//   facing  -- the same n·v remapped to a front/back weight.
// An earlier `rim` term (a |n·v| band) was removed: a band is an area, not a
// curve, so wherever a fold lay tangent to the eye it held across many
// adjacent columns at once and rendered as hatching.
// Returning the pair lets the silhouette stay symmetric while back-facing
// geometry is attenuated toward backFacingFloor (dimmed hard, never deleted --
// the rear lines still carry the volume read).
const _facing = { facing: 0, signed: 0 };
function facingTerms(vx, vy, vz, nx, ny, nz) {
  _toEye.x = cameraEye.x - vx;
  _toEye.y = cameraEye.y - vy;
  _toEye.z = cameraEye.z - vz;
  const m = vlen(_toEye.x, _toEye.y, _toEye.z);
  const signed = (nx * _toEye.x + ny * _toEye.y + nz * _toEye.z) / m;
  // Raw signed n*v is exported so callers that need the silhouette CURVE (the
  // zero set) can find it, rather than approximating it with a band on |n*v|.
  _facing.signed = signed;
  const f = smooth01(clamp(signed * 0.5 + 0.5, 0, 1));
  _facing.facing = CONFIG.backFacingFloor +
    (1 - CONFIG.backFacingFloor) * Math.pow(f, CONFIG.facingPower);
  return _facing;
}

// §06 SUBTLE SURFACE PRESENCE. A very dark translucent shell drawn BEFORE the
// additive line layers, in BLEND mode, so it occludes rear lines and gives the
// form physical volume. Three things make or break this layer:
//   - noStroke() is mandatory. p5 outlines every triangle otherwise, which
//     would hand back the exact full-mesh grid this pass exists to remove.
//   - the shell is inset slightly (surfaceInset) as a depth bias, or the
//     on-surface contours z-fight against it and shimmer.
//   - it stays near-black. It is not lighting; it is occlusion and separation.
function drawTranslucentShell() {
  const pos = surface.positions;
  const nrm = surface.normals;
  const k = CONFIG.surfaceInset;
  noStroke();
  // Per-vertex tone is interpolated by WEBGL across the existing triangles.
  // No edges are drawn, so this restores continuous membrane mass rather than
  // revealing the UV tessellation. Facing, depth, curvature, the focal field,
  // and the travelling wave all agree with the line hierarchy.
  for (let i = 0; i < US; i++) {
    const i2 = (i + 1) % US;   // wrap closes the seam column
    beginShape(TRIANGLE_STRIP);
    for (let j = POLE_SKIP; j < VS - POLE_SKIP; j++) {
      const oa = paramIndex(i, j) * 3, ob = paramIndex(i2, j) * 3;
      const ia = oa / 3;
      const fa = facingTerms(pos[oa], pos[oa + 1], pos[oa + 2],
        nrm[oa], nrm[oa + 1], nrm[oa + 2]).facing;
      const focalA = clamp(focalWeight(pos[oa], pos[oa + 1], pos[oa + 2]), 0, 1);
      const alphaA = clamp(CONFIG.surfaceOpacity * (0.62 + 0.38 * fa +
        0.24 * surface.response[ia] + 0.34 * focalA +
        0.16 * waveHighlight(pos[oa], pos[oa + 1], pos[oa + 2])),
      CONFIG.surfaceOpacity * 0.78, CONFIG.surfaceOpacity * 1.35);
      fill(INK_R * 0.46, INK_G * 0.46, INK_B * 0.50, alphaA);
      vertex(pos[oa] * k, pos[oa + 1] * k, pos[oa + 2] * k);

      const ib = ob / 3;
      const fb = facingTerms(pos[ob], pos[ob + 1], pos[ob + 2],
        nrm[ob], nrm[ob + 1], nrm[ob + 2]).facing;
      const focalB = clamp(focalWeight(pos[ob], pos[ob + 1], pos[ob + 2]), 0, 1);
      const alphaB = clamp(CONFIG.surfaceOpacity * (0.62 + 0.38 * fb +
        0.24 * surface.response[ib] + 0.34 * focalB +
        0.16 * waveHighlight(pos[ob], pos[ob + 1], pos[ob + 2])),
      CONFIG.surfaceOpacity * 0.78, CONFIG.surfaceOpacity * 1.35);
      fill(INK_R * 0.46, INK_G * 0.46, INK_B * 0.50, alphaB);
      vertex(pos[ob] * k, pos[ob + 1] * k, pos[ob + 2] * k);
    }
    endShape();
  }
  noFill();
}

function drawContourField() {
  const pos = surface.positions;
  const nrm = surface.normals;

  // The translucent shell goes down first, in BLEND, while depth writes are
  // still on -- everything after it is additive line work.
  drawTranslucentShell();

  blendMode(ADD);
  noFill();

  // ---------------------------------------------------------------------
  // LAYER 1 -- SILHOUETTE (§05). Highest in the hierarchy.
  //
  // Drawn as the chained zero contour of signed n·v (see updateSilhouette).
  // Two earlier attempts failed here and both failures were the same mistake
  // in different clothes: a per-column rim test with an alpha FLOOR drew all
  // 48 meridians everywhere (a cage, not a mask), and removing the floor but
  // keeping the column walk still filled AREA wherever a fold lay tangent to
  // the view, because dozens of adjacent columns passed the test at once.
  // Marching the actual zero level set gives the outline curve itself, so
  // both the cage and the combing are gone by construction.
  // ---------------------------------------------------------------------
  strokeWeight(CONFIG.rimWeight);
  for (let c = 0; c < silCount; c++) {
    const start = silStarts[c];
    const len = silLengths[c];
    beginShape();
    for (let q = 0; q < len; q++) {
      const o = (start + q) * 3;
      const x = silVerts[o], y = silVerts[o + 1], z = silVerts[o + 2];
      // §09/§08: the outline is brightest where the travelling focal point is,
      // so the silhouette carries the event rather than glowing uniformly.
      const foc = focalWeight(x, y, z);
      const a = CONFIG.silhouetteBase * (0.70 + 0.30 * clamp(foc, 0, 1)) *
        (1 + 0.24 * peakness) * silVertDepth[start + q] * CONFIG.silhouetteStrength;
      stroke(INK_R, INK_G, INK_B, a);
      vertex(x, y, z);
    }
    endShape();
  }

  // ---------------------------------------------------------------------
  // LAYER 2/3 -- PRIMARY CURVATURE CONTOURS and LOCAL HIGHLIGHTS (§03/§07).
  // Chained polylines, drawn as continuous strokes. Heroes carry full weight;
  // the rest are held down to secondaryLineOpacity so the hierarchy is a real
  // step, not a gradient.
  // ---------------------------------------------------------------------
  const hi = CONFIG.curvatureHighlightThreshold;
  for (let c = 0; c < chainCount; c++) {
    const start = chainStarts[c];
    const len = chainLengths[c];
    const hero = chainIsHero[c] === 1;
    const closed = chainIsClosed[c] === 1;
    const r = chainResp[c];
    // §07 CURVATURE SCARCITY: only the top slice above the threshold reaches
    // full brightness, and the extra power curve makes that slice narrower
    // still. Bright pixels are rationed so they read as important.
    const peak = Math.pow(smooth01((r - hi) / (1 - hi)), CONFIG.curvatureHighlightPower);
    const tier = (hero ? 1 : CONFIG.secondaryLineOpacity) *
      (closed ? CONFIG.closedLoopOpacity : 1);

    // Weight MUST be set before beginShape(): p5 latches stroke weight at the
    // start of a shape, so setting it after endShape() would give every chain
    // the previous chain's weight (and chain 0 the silhouette's 2.35), which
    // scrambles the hero/secondary split that the whole hierarchy rests on.
    strokeWeight(CONFIG.surfaceLineWeight *
      (hero ? 0.94 + 0.72 * r + 0.48 * peak : 0.42 + 0.34 * r) *
      (closed ? 0.72 : 1));

    beginShape();
    for (let q = 0; q < len; q++) {
      const o = (start + q) * 3;
      const x = chainVerts[o], y = chainVerts[o + 1], z = chainVerts[o + 2];
      if (!Number.isFinite(x)) continue;
      const fog = fogFactor(viewDepthAtPoint(x, y, z));
      const nx = chainVertNormals[o], ny = chainVertNormals[o + 1], nz = chainVertNormals[o + 2];
      const facing = facingTerms(x, y, z, nx, ny, nz).facing;
      const localR = chainVertResponse[start + q];
      const localPeak = Math.pow(
        smooth01((localR - hi) / (1 - hi)), CONFIG.curvatureHighlightPower);
      const foc = focalWeight(x, y, z);
      const climax = peakness * (0.30 + 0.70 * localPeak);
      const front = waveHighlight(x, y, z);
      // §08: the focal term is what guarantees one dominant bright region at
      // every moment of the loop, not only inside the wave window.
      const neighborhood = smooth01((localR - 0.50) / 0.38);
      const contourBody = hero ? 36 + 84 * localR : 20 + 50 * localR;
      const a = (contourBody + 176 * localPeak + 150 * climax +
        72 * front * (0.42 + 0.58 * localR) +
        92 * foc * (0.42 + 0.58 * localR) + 42 * neighborhood * foc) *
        fog * facing * tier;
      stroke(INK_R, INK_G, INK_B, a);
      vertex(x, y, z);
    }
    endShape();
  }

  // ---------------------------------------------------------------------
  // LAYER 4 -- SECONDARY STRUCTURE. Five very dim ribs (was nine), purely to
  // tie the silhouette to the contour bands. Deliberately the faintest thing
  // on the surface; this layer used to carry the silhouette itself, which is
  // what read as a lat-long cage.
  // ---------------------------------------------------------------------
  strokeWeight(CONFIG.silhouetteWeight * 0.8);
  for (let i = 0; i < US; i += CONFIG.ribStride) {
    beginShape();
    for (let j = POLE_SKIP; j < VS - POLE_SKIP; j++) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      const ft = facingTerms(pos[o], pos[o + 1], pos[o + 2],
        nrm[o], nrm[o + 1], nrm[o + 2]);
      const a = (11 + 30 * surface.response[idx]) * ft.facing *
        fogFactor(viewDepthAtPoint(pos[o], pos[o + 1], pos[o + 2]));
      stroke(INK_R, INK_G, INK_B, a);
      vertex(pos[o], pos[o + 1], pos[o + 2]);
    }
    endShape();
  }
  blendMode(BLEND);
}

// Thin silhouettes of previous geometry states -- the manifold's memory of its
// earlier metric. Restrained: contour-count only, very low alpha, no blur.
function drawTemporalEchoes() {
  blendMode(ADD);
  noFill();
  strokeWeight(0.58);
  // Two states only, with an explicit alpha ladder rather than a uniform
  // fade, so this reads as the manifold's memory of an earlier metric and not
  // as motion blur. Drawn on the rib stride so the echo silhouettes line up
  // with the primary ribs instead of adding a second, offset mesh.
  // §10: SILHOUETTE-ONLY echoes. These used to be drawn as rib meridians,
  // which is precisely the "duplicated wireframe" the brief rules out -- a
  // second and third copy of the lat-long cage, offset in time.
  //
  // Now each echo is reduced to the OUTLINE of the earlier state, using the
  // same rim gate as the live silhouette. A remembered shape is an outline,
  // not a mesh: this reads as geometric memory because it carries only the
  // information a memory would keep.
  //
  // The echo normal is approximated from the echo's own neighbouring vertices
  // (the stored states are positions only), which is enough to find the
  // grazing band.
  for (let e = 0; e < CONFIG.temporalEchoCount; e++) {
    const age = (CONFIG.temporalEchoCount - 1 - e + CONFIG.temporalEchoCount) % CONFIG.temporalEchoCount;
    const state = echoStates[(echoWrite + e) % CONFIG.temporalEchoCount];
    const base = CONFIG.echoAlpha[Math.min(age, CONFIG.echoAlpha.length - 1)];
    // Echoes only matter while the flow is actually moving.
    const alpha = base * (0.25 + 0.75 * flowT);
    stroke(INK_R, INK_G, INK_B, alpha);
    // One POINT per column, at the zero crossing of signed n*v -- not a band.
    // A threshold on |n*v| holds across many adjacent columns wherever a fold
    // lies tangent to the eye, which is what turned the old rim walk into
    // hatching. The crossing is the outline itself, so combing cannot occur.
    // Crossings are collected first, then stroked as one polyline per echo, so
    // the memory reads as a single closed trace rather than 48 dashes.
    let n = 0;
    for (let i = 0; i < US; i += 2) {
      let px = 0, py = 0, pz = 0, pf = 0, have = false;
      for (let j = POLE_SKIP; j < VS - POLE_SKIP; j++) {
        const o = paramIndex(i, j) * 3;
        const x = state[o], y = state[o + 1], z = state[o + 2];
        // Cheap normal from the two in-column / in-row neighbours.
        const ou = paramIndex(i + 1, j) * 3;
        const ov = paramIndex(i, j + 1) * 3;
        const ax = state[ou] - x, ay = state[ou + 1] - y, az = state[ou + 2] - z;
        const bx = state[ov] - x, by = state[ov + 1] - y, bz = state[ov + 2] - z;
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const nl = vlen(nx, ny, nz);
        nx /= nl; ny /= nl; nz /= nl;
        const f = facingTerms(x, y, z, nx, ny, nz).signed;
        if (have && ((pf > 0) !== (f > 0))) {
          const d = f - pf;
          const t = Math.abs(d) < 1e-12 ? 0.5 : clamp(-pf / d, 0, 1);
          const ex = px + (x - px) * t;
          const ey = py + (y - py) * t;
          const ez = pz + (z - pz) * t;
          echoTrace[n * 3] = ex;
          echoTrace[n * 3 + 1] = ey;
          echoTrace[n * 3 + 2] = ez;
          n++;
        }
        px = x; py = y; pz = z; pf = f; have = true;
      }
    }
    if (n < 3) continue;
    beginShape();
    for (let q = 0; q < n; q++) {
      vertex(echoTrace[q * 3], echoTrace[q * 3 + 1], echoTrace[q * 3 + 2]);
    }
    endShape();
  }
  blendMode(BLEND);
}

// drawCurvatureFilaments() removed. It walked 34 deterministic seeds downhill
// along the curvature gradient on the (u,v) grid. The walks were genuinely
// curvature-derived, but visually they were the "free-floating curves around a
// mesh" the brief rules out: they converged into the saddles from every
// direction at once and produced the bright crossing clusters. The contour
// field already marks those same high-curvature zones while staying ON the
// surface, so removing this layer costs no information.

// Half-res WEBGL pass: the same contour geometry, brighter, ADD-blended, then
// streaked horizontally for real luminous bloom. Only the highest-curvature
// contours contribute, so the glow tracks curvature rather than the silhouette.
function renderBloomSource() {
  const b = bloomPg;
  b.push();
  b.background(0);
  applySculptureCamera(b);
  b.blendMode(ADD);
  b.noFill();
  b.push();
  applySculptureOrientation(b);
  b.strokeWeight(2.2);
  // Glow now runs over the CHAINS, and is gated by curvature AND by proximity
  // to the travelling focal point. That second gate is what enforces §08: the
  // bloom cannot light up several equally bright hotspots, because only the
  // region the focus is currently visiting can reach full glow. The result is
  // that the brightest thing in frame moves along the sculpture over the loop.
  const hiB = CONFIG.curvatureHighlightThreshold;
  for (let c = 0; c < chainCount; c++) {
    const r = chainResp[c];
    if (r < 0.50 || chainIsClosed[c]) continue;
    const start = chainStarts[c];
    const len = chainLengths[c];
    b.beginShape();
    for (let q = 0; q < len; q++) {
      const o = (start + q) * 3;
      const x = chainVerts[o], y = chainVerts[o + 1], z = chainVerts[o + 2];
      if (!Number.isFinite(x)) continue;
      const localR = chainVertResponse[start + q];
      const core = Math.pow(smooth01((localR - hiB) / (1 - hiB)),
        CONFIG.curvatureHighlightPower);
      const foc = clamp(focalWeight(x, y, z), 0, 1);
      const field = smooth01((localR - 0.58) / 0.30) * foc;
      const a = 255 * (0.30 * field + 0.70 * core * (0.34 + 0.66 * foc)) *
        fogFactor(viewDepthAtPoint(x, y, z));
      b.stroke(INK_R, INK_G, INK_B, a);
      b.vertex(x, y, z);
    }
    b.endShape();
  }
  b.pop();
  b.pop();
}

function streakBloom() {
  const s = bloomStreakPg;
  const taps = 14;
  const spread = 9;
  s.clear();
  s.push();
  s.blendMode(ADD);
  s.imageMode(CENTER);
  const cx = s.width / 2, cy = s.height / 2;
  for (let k = -taps; k <= taps; k++) {
    const falloff = 1 - Math.abs(k) / taps;
    s.tint(255, 255, 255, 28 * falloff * falloff);
    s.image(bloomPg, cx + k * spread, cy);
  }
  s.pop();
}

function compositeBloom() {
  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
  ortho(-W * 0.5, W * 0.5, -H * 0.5, H * 0.5, -10, 10);
  noLights();
  blendMode(ADD);
  tint(255, 255, 255, 228);
  image(bloomStreakPg, -W * 0.5, -H * 0.5, W, H);
  noTint();
  blendMode(BLEND);
  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

const cameraEye = { x: 0, y: 0, z: 0 };

const VFOV = Math.PI / 3.35;
const ASPECT = W / H;
const TAN_HALF_VFOV = Math.tan(VFOV / 2);

function setupCamera() {
  // Composed cinematic drift rather than a constant orbit: front-facing at the
  // loop ends, a small horizontal excursion and a diagonal rise through the
  // curvature peak, returning exactly to start. Integer harmonics only.
  // Drift is added on top of lookAtCenter, not the origin, so the excursion
  // reads relative to the (off-centre) sculpture rather than world space.
  const eyeX = lookAtCenter.x + CONFIG.cameraDrift * Math.sin(TAU * loopProgress);
  const eyeY = lookAtCenter.y - 50 + 46 * Math.sin(TAU * loopProgress) * Math.sin(Math.PI * loopProgress);
  // Fit each axis separately against its own half-FOV, then take whichever is
  // the binding constraint, so the portrait frame stays filled.
  const distForVertical = maxVerticalExtent / (TAN_HALF_VFOV * CONFIG.framingFill);
  const distForLateral = maxRadius / (TAN_HALF_VFOV * ASPECT * CONFIG.framingFill);
  const fitZ = Math.min(
    Math.max(distForVertical, distForLateral, CONFIG.cameraDistance),
    CONFIG.cameraMaxDistance,
  );
  // §22/§23 CAMERA PUSH. A subtle dolly IN synchronised with peak curvature,
  // and a slight pull-BACK as the bloom releases -- the two classic beats.
  // Deliberately applied here, on top of the frozen fit distance, rather than
  // inside solveLoopFraming(): the fit must stay loop-constant or the auto-fit
  // would compensate for the silhouette variation and turn the choreography
  // into a global zoom pulse. This is a camera move; that would be a rescale.
  const push = 1 - ANIM.cameraPushStrength * peakness + 0.022 * EV.bloom;
  const eyeZ = fitZ * push;
  cameraEye.x = eyeX; cameraEye.y = eyeY; cameraEye.z = eyeZ;
  applySculptureCamera();
}

// fogFactor(): near→far alpha falloff so depth reads as atmosphere, not a flat diagram.
function fogFactor(viewDepth) {
  const nearDepth = cameraEye.z - CONFIG.fogDepthRange * 0.5;
  const t = clamp((viewDepth - nearDepth) / CONFIG.fogDepthRange, 0, 1);
  return 1 - smooth01(t) * 0.68;
}

function viewDepthAtPoint(x, y, z) {
  const dx = x - cameraEye.x;
  const dy = y - cameraEye.y;
  const dz = z - cameraEye.z;
  return Math.hypot(dx, dy, dz);
}

function drawEnvironment() {
  // Reduced to a single, very faint reference ring. The previous three
  // concentric rings plus a full cross-hair competed with the sculpture for
  // attention; at phone size they read as part of the artwork rather than as
  // ground. What remains is just enough to sit the form in a space.
  noFill();
  strokeWeight(0.6);
  const fieldRadius = CONFIG.baseRadius * 1.95;
  stroke(INK_R, INK_G, INK_B, 4);
  beginShape();
  for (let j = 0; j <= 96; j++) {
    const a = (j / 96) * TAU;
    vertex(Math.cos(a) * fieldRadius, Math.sin(a) * fieldRadius, -330);
  }
  endShape(CLOSE);

  // Two short registration marks instead of full axis lines.
  stroke(INK_R, INK_G, INK_B, 6);
  const tick = 30;
  line(-fieldRadius - tick, 0, -330, -fieldRadius, 0, -330);
  line(fieldRadius, 0, -330, fieldRadius + tick, 0, -330);
}

function flowPercentText() {
  return Math.round(loopProgress * 100) + "%";
}

function drawScreenFinish() {
  const g = hudPg;
  const info = currentPhaseInfo();
  g.clear();
  g.image(grainPg, 0, 0);
  g.noFill();
  g.stroke(INK_R, INK_G, INK_B, 26);
  g.strokeWeight(0.7);
  const m = 34, l = 24;
  g.line(m, m, m + l, m); g.line(m, m, m, m + l);
  g.line(W - m, m, W - m - l, m); g.line(W - m, m, W - m, m + l);
  g.line(m, H - m, m + l, H - m); g.line(m, H - m, m, H - m - l);
  g.line(W - m, H - m, W - m - l, H - m); g.line(W - m, H - m, W - m, H - m - l);

  // Exact existing typography settings, positions, alignment, spacing, and hierarchy.
  g.noStroke();
  g.textFont("ui-monospace, Menlo, Consolas, monospace");
  g.textAlign(CENTER, CENTER);
  g.textStyle(BOLD);
  g.fill(INK_R, INK_G, INK_B, 246);
  g.textSize(54);
  g.text("CURVATURE BLOOM", W * 0.5, 222);
  g.textStyle(NORMAL);
  g.fill(INK_R, INK_G, INK_B, 122);
  g.textSize(24);
  g.text("A RICCI FLOW STUDY", W * 0.5, 278);
  g.fill(INK_R, INK_G, INK_B, 64);
  g.textSize(17);
  g.text("dg/dt = -2 Ric   /   CURVATURE-DRIVEN  ·  REDISTRIBUTED", W * 0.5, 316);

  g.textAlign(LEFT, TOP);
  g.fill(INK_R, INK_G, INK_B, 78);
  g.textSize(19);
  g.text(info.label, 70, 372);
  g.textAlign(RIGHT, TOP);
  g.text(flowPercentText(), W - 70, 372);

  const trackX = 70, trackY = 416, trackW = W - 140;
  g.stroke(INK_R, INK_G, INK_B, 24);
  g.strokeWeight(1);
  g.line(trackX, trackY, trackX + trackW, trackY);
  g.stroke(INK_R, INK_G, INK_B, 150);
  g.strokeWeight(2.2);
  g.line(trackX, trackY, trackX + trackW * loopProgress, trackY);
  g.noStroke();
  for (const marker of [0, 0.25, 0.5, 0.75, 1]) {
    g.fill(INK_R, INK_G, INK_B, marker === 0.5 ? 132 : 58);
    g.circle(trackX + trackW * marker, trackY, marker === 0.5 ? 6 : 4);
  }

  g.textAlign(CENTER, CENTER);
  g.fill(INK_R, INK_G, INK_B, 58 + 132 * smooth01(Math.sin(flowT * Math.PI)));
  g.textSize(22);
  g.text(info.note, W * 0.5, 1482);
  g.textSize(17);
  g.fill(INK_R, INK_G, INK_B, 96);
  g.text("FORM  ->  FLOW  ->  BLOOM  ->  EQUILIBRIUM  ->  RETURN", W * 0.5, 1514);

  push();
  drawingContext.disable(drawingContext.DEPTH_TEST);
  resetMatrix();
  camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
  ortho(-W * 0.5, W * 0.5, -H * 0.5, H * 0.5, -10, 10);
  noLights();
  blendMode(BLEND);
  image(g, -W * 0.5, -H * 0.5, W, H);
  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

function keyReleased() {
  if (key === "r" || key === "R") {
    isRecording ? stopRecording() : startRecording();
    return false;
  }
  if (key === "s" || key === "S") {
    saveCanvas("curvature_bloom_" + getTimestamp(), "png");
    return false;
  }
  return true;
}

function updateRecordingUI() {
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = (recFrameCount / FPS).toFixed(1);
  if (el("frameCount")) el("frameCount").textContent = recFrameCount;
  if (el("progressFill")) el("progressFill").style.width = ((recFrameCount / MAX_FRAMES) * 100).toFixed(1) + "%";
}

function startRecording() {
  if (typeof VideoEncoder === "undefined") { alert("WebCodecs not supported."); return; }
  if (typeof Mp4Muxer === "undefined") { alert("mp4-muxer not loaded."); return; }
  muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => { console.error(error); isRecording = false; setStatus("Error", "#f44"); },
  });
  encoder.configure({ codec: "avc1.640028", width: W, height: H, bitrate: 18_000_000, framerate: FPS });
  recFrameCount = 0;
  loopProgress = 0;
  phase = 0;
  // Recording may start from a warm preview at an arbitrary loop position. The
  // flow state is persistent, so without re-priming, frame 0 would be captured
  // mid-relaxation from the wrong form and the first ~6 frames would visibly
  // settle -- and the loop would not close.
  echoWrite = 0;
  primeState();
  isRecording = true;
  const el = (id) => document.getElementById(id);
  if (el("duration")) el("duration").textContent = "0.0";
  if (el("frameCount")) el("frameCount").textContent = "0";
  if (el("startBtn")) el("startBtn").disabled = true;
  if (el("stopBtn")) el("stopBtn").disabled = false;
  if (el("progressFill")) el("progressFill").style.width = "0%";
  setStatus("Recording…", "#fff");
}

async function stopRecording() {
  if (!encoder || !muxer) return;
  isRecording = false;
  setStatus("Finalizing…", "#ccc");
  await encoder.flush();
  muxer.finalize();
  const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "curvature_bloom_" + getTimestamp() + ".mp4";
  a.click();
  encoder.close();
  encoder = null;
  muxer = null;
  setTimeout(() => URL.revokeObjectURL(url), 6000);
  const el = (id) => document.getElementById(id);
  if (el("startBtn")) el("startBtn").disabled = false;
  if (el("stopBtn")) el("stopBtn").disabled = true;
  if (el("progressFill")) el("progressFill").style.width = "0%";
  setStatus("Complete", "#fff");
  setTimeout(() => setStatus("Ready", "#ccc"), 3000);
}

function captureFrame() {
  if (!encoder || !canvasEl) return;
  const frame = new VideoFrame(canvasEl, { timestamp: recFrameCount * (1_000_000 / FPS) });
  encoder.encode(frame, { keyFrame: recFrameCount % FPS === 0 });
  frame.close();
}

function setStatus(textValue, colorValue) {
  const el = document.getElementById("status");
  if (el) { el.textContent = textValue; el.style.color = colorValue; }
}

function getTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + "_" +
    pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
}

if (typeof window !== "undefined") {
  window.startRecording = startRecording;
  window.stopRecording = stopRecording;
}

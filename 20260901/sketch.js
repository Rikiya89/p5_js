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

  // --- Temporal history ring (§02/§16/§17) ---------------------------------
  // Now captured EVERY frame, not every 10th. The ring feeds two consumers:
  //   - drawTemporalEchoes(), which samples it sparsely (echoDrawAge) exactly
  //     as before, and
  //   - the membrane layers, which read a small lag per layer (MEMBRANE.lag).
  // A stride > 1 is fatal to the second consumer: the layers would snap to a
  // new state every stride frames instead of trailing smoothly. Per-frame
  // capture costs 4608 verts * 3 * 4B = 55KB per slot -- irrelevant.
  temporalEchoCount: 18,     // ring depth in FRAMES; must exceed max lag used
                             // (§32-15 raised the outermost film lag to 15)
  echoStride: 1,             // per-frame capture; see above
  echoDrawAge: [7, 13],      // which ring ages drawTemporalEchoes() strokes
  echoAlpha: [15, 6],        // memory stays below restored live structure

  ribStride: 19,             // longitudinal ribs: dim structural layer only
                              // now -- the silhouette comes from the rim term.
                              // 11 -> 19 (9 ribs -> 5): the ribs were the
                              // last evenly-spaced longitude set on screen.
  silhouetteWeight: 1.24,
  // §04/§05: 2.65 -> 1.55. The old weight made the outline read as a uniform
  // technical perimeter stroke. Brightness now carries the strongest folds;
  // width no longer does.
  rimWeight: 1.55,

  // --- Silhouette (see updateSilhouette / LAYER 1) --------------------------
  // The outline is extracted as the zero level set of signed n*v and welded
  // into polylines, so there is no visibility threshold to tune here: a
  // threshold on |n*v| is what produced first a meridian cage and then
  // combing across view-tangent folds.
  silhouetteBase: 255,        // peak alpha of the outline stroke
  // §32-09 REDUCE PERIMETER DOMINANCE, 10-20%. 1.0 -> 0.84 is a 16% cut, mid
  // band, applied as the MASTER multiplier so it scales the whole outline
  // uniformly -- the selective structure (which edges glow, which fade) is set
  // by silhouetteFloor and the edge gains below and is deliberately untouched,
  // so this dims the perimeter without flattening its variation.
  // §32-09's other half -- "redistribute energy inward" -- is the interior
  // field, the +25% membrane midtone and the 1.39x ribbons. This cut is what
  // pays for part of them in the brightness budget.
  // §32-09 asks for a 10-20% perimeter cut and §32-18 wants the selective
  // silhouette at 50-70% of white. Those two cannot both be read literally:
  // 0.84 is a 16% cut but still peaks at 104%, i.e. it CLIPS. The old 1.0
  // value peaked at 124%, so it was clipped too -- and clipped pixels all
  // render the same flat white, which means the perceived reduction from a
  // nominal "40% cut" is far smaller than 40%. 0.62 is the value that lands
  // the peak inside §32-18's band (77%) while genuinely darkening the rim,
  // which is what the "too much perimeter brightness" note is about.
  silhouetteStrength: 0.62,   // master multiplier on silhouette brightness
  silhouetteMinRun: 4,        // drop chains shorter than this many vertices

  // --- §04/§05 SELECTIVE EDGE LIGHT ----------------------------------------
  // The old outline alpha was `base * (0.70 + 0.30 * focal)`. That 0.70 FLOOR
  // is precisely the uniform white perimeter the brief rules out: every
  // silhouette vertex, anywhere on the form, got at least 70% brightness. The
  // floor is now `silhouetteFloor` and the remainder is earned from a product
  // of Fresnel, curvature and focal proximity -- so some edges glow, some
  // fade, and some genuinely disappear.
  // §32-10 SELECTIVE EDGE LIGHT. 0.10 -> 0.07: the dormant stretches of
  // outline drop further toward invisible while the earned term is untouched,
  // so the gap between an activated edge (neck, upper-right fold, one
  // lower-left contour, one return curve) and a dormant one WIDENS even as the
  // perimeter as a whole dims by 16%. Lowering the floor is how you dim an
  // outline without dimming the parts that carry structure.
  silhouetteFloor: 0.07,      // the dimmest an outline vertex may go
  edgePower: 1.9,             // exponent on the Fresnel-like grazing term
  // §16 raised (0.85 -> 1.15, 1.05 -> 1.45). The FLOOR above is deliberately
  // left at 0.10: raising these gains widens the gap between an activated edge
  // and a dormant one instead of lifting the whole perimeter, which is what
  // "increase silhouette brightness ONLY where it supports form" asks for.
  // Both terms saturate via clamp(selective, 0, 1), so the strong zones reach
  // full brightness sooner and the quiet ones stay near the floor.
  edgeCurvatureGain: 1.15,    // how much local curvature promotes an edge
  edgeFocalGain: 1.45,        // how much focal proximity promotes an edge

  // --- Facing attenuation (§04) --------------------------------------------
  // Signed n·v, distinct from the unsigned rim magnitude. Back-facing geometry
  // is dimmed hard but never removed -- it still has to communicate volume.
  backFacingFloor: 0.28,      // rear structure stays legible, never equal
  facingPower: 0.70,   // §11 front 100% / side 72% / back 28%. Solved, not
                      // guessed: f=0 and f=1 are fixed points of the power, so
                      // this shapes ONLY the midrange -- it moves the grazing
                      // band into the 70-100% target without touching either
                      // endpoint. At the old 1.08 the side read 62%, under spec.
                      // Matters more now that nothing writes depth and facing
                      // alpha is the sole front/back separator.

  // --- Hero contours (§03) --------------------------------------------------
  // Marching-squares output is chained into continuous polylines; the longest
  // chains carrying the most curvature are promoted to heroes.
  // §04/§06: 7 -> 5. Seven full-weight contours plus five ribbons was too many
  // equally-strong lines for the eye to rank, which is the "several bright
  // contour islands competing" failure. Five keeps the strata read while the
  // ribbons stay unambiguously dominant.
  heroContourCount: 5,
  // §15 MEDICAL-CONTOUR REMOVAL. Iso-contours of a scalar field produce closed
  // islands STRUCTURALLY -- no alpha tuning removes them, because at any level
  // there are always small local extrema ringed by a short closed loop. That is
  // the MRI/CT-slice read. Two changes kill it at the source:
  //   - closed chains are now SKIPPED entirely (closedLoopOpacity 0.06 -> 0),
  //   - minChainLength 7 -> 20, so only bands that genuinely sweep across the
  //     manifold survive at all.
  // The curvature field itself is unchanged; only which of its level sets get
  // drawn changes. Long open bands are what read as strata.
  minChainLength: 20,
  // §06 PUSH SECONDARY LINES BACK, -20-40%. 0.52 -> 0.34 is a 35% reduction,
  // inside the band. These lines still carry fold readability and depth; they
  // simply stop competing with the hero ribbons for the eye.
  // §32-07 REMOVE HEAVY DIAGONAL BANDS. 0.34 -> 0.17, a further 50% cut. These
  // are the thick dark internal strata that read as "structural braces". They
  // are not deleted (they still carry fold readability and the depth cue that
  // stops the interior going empty), but they are pushed to roughly half
  // again, so the three hero ribbons are unambiguously the only strong
  // internal lines. §32-07 forbids replacing them with another band system, so
  // nothing takes their place -- the energy goes to the interior FIELD instead.
  secondaryLineOpacity: 0.17,
  closedLoopOpacity: 0.0,     // closed islands are not drawn at all

  // --- Translucent membrane (§01/§02) --------------------------------------
  // 42 -> 11. The single opaque-ish shell was the "dark plastic plate" read.
  // Mass now comes from SEVERAL faint strata (see MEMBRANE), not one heavy one,
  // so the front surface is see-through and interior structure stays legible.
  // Value solved against §27, not guessed: compositing the four layers src-over
  // gives peak luminance 17.0% and typical 6.6%, inside the brief's 5-18%
  // membrane band. At 15 the stack peaked at 22%, i.e. an opaque plate again.
  // §32-01/§32-18/§32-21. 11 -> 14.
  //
  // The previous pass set this to 11 and deliberately routed the midtone lift
  // through the membrane's CONSTANT term instead, on the reasoning that the
  // master opacity also scales the crests and would raise pure highlights.
  // That reasoning was correct then and is revisited here for one reason: it
  // makes this value the hard ceiling on the whole stack, and §32-18's target
  // for the main membrane (22-35%) is NOT reachable underneath it. Solved:
  // at 11 the equilibrium membrane composites to 17.8%, below the band, and
  // sweeping the constant from 0.50 to 0.64 only moves it to 19.0% -- the
  // constant is a weak lever because the opacity multiplies it.
  //
  // At 14: equilibrium 22.3% (in band) and peak 41.3%. The highlight concern
  // that motivated 11 is handled at the two places it actually bites instead:
  // the membrane g.core coefficient is cut 1.15 -> 1.00 and interiorField() is
  // normalised to 0..1 with a soft knee, so the crest terms do NOT scale up
  // with this value the way they would have. Membrane stays translucent.
  surfaceOpacity: 14,
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
  // 0.86 -> 0.90. This is NOT a compositional preference, it is compensation:
  // the wider bloom (ANIM.bloomStrength) grows the loop's max width from 732 to
  // 768px, and since solveLoopFraming() freezes the fit over the WHOLE loop, a
  // wider loop max would push distForLateral past the cameraDistance floor and
  // dolly the camera back -- shrinking the sculpture in every frame to pay for
  // an opening visible in twenty. Measured: at fill 0.90 the new distForLateral
  // widens the loop's max width from 732px to 789px. distForLateral is then
  // 1489 at fill 0.93, still under the cameraDistance floor of 1500, so fitZ
  // stays pinned at 1500 exactly as before and the bloom growth is seen as the
  // form OPENING rather than as the camera dollying back. At the old 0.86 the
  // same geometry gives 1611 and the sculpture would shrink ~7% in every one
  // of the 600 frames to pay for an opening visible in twenty.
  framingFill: 0.93,
  fogDepthRange: 920,
};

// --- §02 LAYERED MEMBRANE SYSTEM ---------------------------------------------
// Four strata generated from the SAME manifold, never from duplicate objects.
// Each layer differs in three ways only:
//
//   offset -- displacement along the vertex NORMAL, in world units. Kept to a
//             few px so the silhouette family, the lobes and the composition
//             (§23) are untouched; this is stratification, not inflation.
//   lag    -- how many frames back in the history ring this layer reads its
//             positions from (§16/§17 ELASTIC MEMORY). Layer 0 is live. The
//             lag is small enough that it never reads as a second animation,
//             only as the outer films trailing the core through the pinch and
//             catching up through the bloom release.
//   alpha  -- scale on CONFIG.surfaceOpacity, giving the §-MEMBRANE-VISIBILITY
//             hierarchy. With surfaceOpacity 15 the effective per-layer alphas
//             land at roughly 15 / 9 / 5.4 / 3 of 255, i.e. 6% / 3.5% / 2% /
//             1.2% -- inside the brief's bands once the facing/glow gain terms
//             (which reach ~2.4x) are applied on top.
//
// Layer 0 is the only one that writes depth. Layers 1..3 test depth but do not
// write it, so they cannot occlude each other into a single opaque plate --
// which is exactly how a "layered" system collapses back into a solid shell.
// §32-15 MEMBRANE DEPTH. Four layers retained. Their separation is improved on
// the three axes the brief names, so they read as distinct strata rather than
// as one shape drawn four times:
//   opacity -- the alpha ladder is steepened at the top (1.00/0.66/0.40/0.22):
//              the second film comes up so mid-depth volume is readable, the
//              outermost stays low so it never doubles the silhouette.
//   tone    -- the ramp is widened (0.50->0.80 rather than 0.50->0.74) so the
//              outer films sit measurably cooler/lighter than the core.
//   depth   -- lag is respread (0/4/9/15) so the outer films trail further
//              through the pinch and catch up visibly on the bloom release.
//   light   -- `glowBias`: outer films take MORE of the interior field than
//              the core does. That is what makes the light look like it is
//              INSIDE the stack, illuminating the films from within, instead
//              of sitting on the front surface.
const MEMBRANE = {
  layers: [
    { offset: 0.0, lag: 0, alpha: 1.00, tone: 0.50, glowBias: 0.85 },  // core
    { offset: 5.5, lag: 4, alpha: 0.66, tone: 0.60, glowBias: 1.05 },
    { offset: 11.0, lag: 9, alpha: 0.40, tone: 0.70, glowBias: 1.25 },
    { offset: 17.5, lag: 15, alpha: 0.22, tone: 0.80, glowBias: 1.45 }, // outermost
  ],
  // §17: during the BLOOM release the strata visibly SEPARATE, then settle.
  // The offset above is multiplied by this, so the layers breathe apart on the
  // release and draw back together at equilibrium.
  separationGain: 0.85,
  // §11 FRONT/BACK SEPARATION applied per-layer: outer films are dimmed harder
  // on back-facing geometry than the core is, so the rear reads as depth
  // rather than as a second silhouette.
  // §32-16 FRONT/SIDE/REAR = 100% / 60-80% / 20-30%. The existing facingPower
  // 0.70 and backFacingFloor 0.28 already put the CORE layer at 100/72/28,
  // inside spec, so neither is touched. backBias is what the outer films add
  // on top; 0.55 -> 0.62 lifts the rear films slightly so the back structure
  // "helps explain volume" rather than disappearing, while the core layer
  // (which bypasses backBias entirely) keeps the front/back separation crisp.
  backBias: 0.62,
};

// --- §03 CURVATURE RIBBONS ---------------------------------------------------
// Five long bands that WRAP the manifold. Deliberately NOT iso-contours: an
// iso-contour is a level set, so it closes on itself and cannot be made to
// sweep. These are parametric paths across the (u,v) grid -- each one walks the
// FULL u range exactly once (an integer number of wraps, so it closes at the
// seam with no abrupt start or stop) while drifting in v. That produces the
// long diagonal strata / field-trace read the brief asks for.
//
// They are drawn as TRIANGLE_STRIP BANDS, not strokes. This is the load-bearing
// choice: a stroked path is just another contour line and gives §14's hierarchy
// and the "compress at the neck, widen over the lobes" behaviour nothing to act
// on. A band has WIDTH, and width is what carries curvature response.
// vOffset: where the band sits in v at u=0 (0..1 across the pole-skipped span)
// vSwing: how far it migrates in v over one full u wrap
// wraps:  integer u revolutions -- MUST be an integer or the band tears
// tier:   §14 light hierarchy. 1 = primary, 0.5 = secondary, 0.22 = tertiary
//
// §05 "3-5 HERO RIBBONS". There are already exactly 5 bands, so none are
// deleted -- removing two would open bare stretches of membrane with no long
// structural line crossing them, losing the surface coverage that makes the
// form readable. What changes is the TIER SPREAD: the top three are promoted
// to carry the piece (1.00 / 0.88 / 0.74) and the bottom two are pushed down
// hard (0.34 -> 0.18, 0.28 -> 0.15) so they read as supporting structure
// rather than as five comparable lines. `hero` marks which get the §15 halo.
// §32-05 THREE HERO RIBBONS + ONE VERY SUBTLE SECONDARY. The five-band set is
// cut to four: the three heroes are promoted to near-parity (1.00 / 0.94 /
// 0.86 -- they are meant to read as a family of three, not as a 1st/2nd/3rd),
// and of the two tertiaries one is DELETED outright and the other held at 0.10
// as the "optionally 1 very subtle secondary" the brief allows.
//
// §32-06 asks for 1.3-1.6x visibility with NO extra thickness, and explicitly
// "slightly thinner". Width therefore DROPS (15.0/12.5/10.0 -> 11.5/10.0/8.5)
// while the alpha rises in RIBBON_CFG.baseAlpha -- brighter and thinner is a
// higher-contrast, more elegant line than brighter and fatter, and a thinner
// band also survives phone-size downscale better because it stays a line
// rather than blurring into a strip.
//
// vOffset/vSwing are chosen so all three heroes pass through or near the
// central curvature focus (§32-05): the neck sits around v~0.45-0.55, and each
// band's [vOffset, vOffset+vSwing] interval now straddles that span.
const RIBBONS = [
  { vOffset: 0.30, vSwing: 0.46, wraps: 1, width: 11.5, tier: 1.00, drift: 1, hero: true },
  { vOffset: 0.66, vSwing: -0.34, wraps: 1, width: 10.0, tier: 0.94, drift: -1, hero: true },
  { vOffset: 0.42, vSwing: 0.30, wraps: 1, width: 8.5, tier: 0.86, drift: 1, hero: true },
  { vOffset: 0.16, vSwing: 0.34, wraps: 1, width: 4.5, tier: 0.10, drift: -1, hero: false },
];

const RIBBON_CFG = {
  samples: 168,          // samples along u; well above US so the band is smooth
  lift: 2.2,             // world units off the surface, so it never z-fights
  // §03 "compress near the neck, widen across broad lobes": the half-width is
  // scaled DOWN where curvature response is high. A ribbon narrowing as it
  // crosses the neck is the whole reason these are bands.
  compression: 0.62,     // fraction of width removed at maximum curvature
  // §14: at any moment only 1-2 ribbons should command attention. The primary
  // is chosen by which band the focal point is actually nearest, so the lead
  // ribbon CHANGES over the loop rather than being fixed.
  // §27 BRIGHTNESS DISCIPLINE, solved rather than guessed. The alpha term below
  // reaches 2.50 at maximum, so at baseAlpha 74 the lead ribbon peaked at 138%
  // of white -- a blown-out band. Solving for the brief's 50-80% target:
  //     baseAlpha = target * 255 / (tier * leadBoost * 2.50)
  //
  // Set to 36 (primary 56%, secondary 29%, tertiary 25%) rather than the 46 that
  // a ribbons-only solve gives. Once the ribbons and membrane crests started
  // FEEDING the bloom, the ribbon peak and the bloom tint stopped being
  // independent: at 46 the climax composited to 116% and clipped. See
  // compositeBloom() for the joint solve -- this value and the tint there are
  // one decision, and neither can be tuned without re-checking the other.
  // 36 -> 28. Re-solved because GLOW.haloGain rose to 0.70: the ribbon alpha
  // term contains 0.34*g.halo and the bloom emitters read the same field, so
  // holding 36 pushed the composited climax to 122% of white. See GLOW.
  // §32-06 HERO RIBBON BRIGHTNESS, 1.3-1.6x. 28 -> 39 is 1.39x, mid-band.
  //
  // This is the single largest addition in the pass and it is spent on the
  // element §32's FINAL PRIORITY ranks third. It is affordable ONLY because it
  // is paid for in the same breath: the ribbon's own g.core coefficient drops
  // 0.90 -> 0.62 in drawCurvatureRibbons(), and the composite tint drops
  // 40 -> 30. Both cuts land on the focal core at the climax, which is where
  // the 99.3% ceiling binds; the 1.39x gain lands on the ribbon BODY term
  // (0.85 + 0.44*resp), which is a midtone across the whole loop.
  //
  // Net at the climax core: the ribbon peak is roughly flat (39*0.62 vs
  // 28*0.90 on the core term) while the ribbon's broad length gets 39% more
  // light everywhere the core is not -- which is exactly §32-17's "the missing
  // information is in the midrange", applied to the ribbons.
  leadBoost: 1.5,
  baseAlpha: 38,
  // §15 HALO. Width multiplier and alpha scale for the hero underlay pass.
  // haloAlpha is kept very low ON PURPOSE: the halo covers ~2.6x the area of
  // the core band, so equal alpha would add far more total light than the
  // ribbon itself and re-inflate the climax the brightness budget already
  // solves for. At 0.16 the halo peaks around 9% of white -- a glow the eye
  // reads as depth, not as a second ribbon.
  haloWidth: 2.9,
  haloAlpha: 0.20,
  // Ribbons drift slowly along their own path. `drift` in RIBBONS is an
  // INTEGER harmonic multiplier -- any non-integer here snaps the Reel.
  driftRate: 1,
};

// --- §08 LEFT-LOWER LOBE REBALANCE -------------------------------------------
// "Feels visually heavy. Do NOT remove it. Make it lighter and more suspended."
//
// Seven of the brief's eight remedies for this are RENDERING properties (dark
// mass, internal midtone, silhouette brightness, membrane transparency, light
// separation) and only one is geometric. So this is implemented as a spatial
// modulation of the existing shading terms rather than as surgery on the
// manifold -- which also honours "do not simply shrink the lobe".
//
// The site is given in unit-sphere space and is deliberately its OWN config
// value rather than a reference to a DEFORMERS entry: the screen-left-lower
// mass is EMERGENT from the overlap of several deformers (lowerMass actually
// sits at x=+0.28, i.e. screen RIGHT with the eye on +Z), so there is no single
// named lobe to point at. If this lands on the wrong mass, negate site[0] --
// that is the only edit needed, and it is why the site lives in one place.
const LOBE_BALANCE = {
  site: [-0.52, -0.50, 0.10],  // screen left-lower, unit-sphere space
  width: 0.62,
  massCut: 0.30,   // how much dark membrane mass is removed at the centre
  midLift: 0.34,   // internal midtone added back, so it lightens not vanishes
  silCut: 0.42,    // silhouette brightness reduction -> a softer outline
};

// 0..1 weight, 1 everywhere except inside the left-lower lobe. Shared by the
// membrane and the silhouette so the lobe lightens as ONE coherent region
// rather than as two independently-tuned effects.
function lobeWeight(x, y, z) {
  const R = CONFIG.baseRadius;
  return siteFalloff(x / R, y / R, z / R, LOBE_BALANCE.site, LOBE_BALANCE.width);
}

// §08: reduces dark surface mass while lifting internal midtone, so the lobe
// reads as a more transparent, suspended membrane instead of a heavy plate.
function lobeMidtone(x, y, z) {
  const w = lobeWeight(x, y, z);
  return 1 - LOBE_BALANCE.massCut * w + LOBE_BALANCE.midLift * w * 0.5;
}

// --- §06/§07 INTERNAL LUMINOSITY ---------------------------------------------
// The glow is TWO radii, not one. Measured against this composition: the
// sculpture is ~700px wide on a 1080px frame, and focalWidth 0.58 (in
// baseRadius units) puts the >50% region at ~46% of the sculpture width -- a
// wash, not a bloom. §07 asks for a visible core of 8-18%.
//
//   core -- 0.20 => ~16% of sculpture width. This is THE curvature bloom.
//   halo -- reuses ANIM.focalWidth (0.58) at low amplitude, supplying the
//           "weaker surrounding illumination" and the soft spatial falloff.
//
// Both are Gaussians centred on the same travelling focalPoint, so the core
// and its halo can never separate.
// §02/§03 BROADEN THE FIELD, NOT THE CORE. The brief asks for a 1.5-2x wider
// bloom whose WHITE area does not grow equally: "SMALL CORE + LARGE LIGHT
// FIELD". Those two clauses select the knob between them.
//
// haloWidth is deliberately NOT raised. At 0.58 the halo already covers ~46%
// of the sculpture width; widening it further produces a flat wash over most
// of the form, which is the failure §02 explicitly warns against and which the
// two-radius system was built to escape in the first place.
//
// What changes is haloGain, 0.42 -> 0.70 (1.67x, inside the 1.5-2x target).
// That raises the AMPLITUDE of the existing broad falloff, so the soft field
// reads much further out while coreWidth 0.20 (~16% of width, inside §01's
// 10-20%) keeps the bright centre exactly as compact as it was.
//
// WARNING -- haloGain is NOT a local knob. internalGlow() feeds the membrane,
// the ribbons, the contours, the silhouette AND all three bloom emitters, so
// raising it multiplies through every layer at once. At 0.74 with the old
// ribbon/tint values the worst-case additive stack at the focal core measured
// 122% of white, i.e. a clipped flat disc -- exactly the failure §02 and §07
// describe. It is re-solved jointly with RIBBON_CFG.baseAlpha and the
// compositeBloom() tint below; the three are ONE decision. Measured total at
// the climax is now 99.3%.
const GLOW = {
  coreWidth: 0.20,
  haloWidth: 0.58,
  coreGain: 1.00,
  haloGain: 0.70,
  // §06: the light must read as generated BY curvature, inside the membrane --
  // not as an external lamp. Local curvature response therefore multiplies the
  // glow, so unlit-but-nearby smooth regions stay dark while a high-curvature
  // fold at the same distance lights up.
  curvatureCoupling: 0.75,
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
  // §11/§19 RELEASE SPEED. attack 0.30 of a 0.32 window = 0.96s, at the very
  // slow end of §19's 0.5-1.0s and the reason the opening read as a linear
  // interpolation rather than a release. 0.19 -> 0.61s, mid-band: the lobe
  // snaps out, then shapedEvent()'s overshoot ring (ANIM.overshoot 0.09, i.e.
  // a 1.09 peak, already inside §12's 1.06-1.12) carries the settle.
  bloom:       { start: 0.44,  end: 0.76, attack: 0.19, release: 0.46, strength: 1.0 },
  // EVENT 05 CURVATURE WAVE -- travelling front, see waveFront().
  wave:        { start: 0.65,  end: 0.92, attack: 0.26, release: 0.50, strength: 1.0 },
  // EVENT 06 RECONNECTION -- wraps the seam; returns by a different route.
  reconnect:   { start: 0.80,  end: 1.10, attack: 0.28, release: 0.44, strength: 1.0 },

  compressionStrength: 0.58,   // inward push depth, unit-sphere space
  counterExpansion: 0.42,      // opposing region's simultaneous outward push
  twistStrength: 0.62,         // extra radians through the neck at full torsion
  pinchStrength: 0.52,         // additional fractional neck pinch at climax
  pinchWidth: 0.62,            // band tightness multiplier during the pinch
  // §09/§10 BLOOM SILHOUETTE OPENING. Solved numerically, not guessed: the
  // projected bounding-box width at the pinch minimum (t=0.45) vs the bloom
  // maximum (t=0.71) measured 641 -> 733 px, a 14.4% change -- just under the
  // brief's 15-30% band, which is why BLOOM read as "too similar to neighbouring
  // phases". At 0.56/0.38 the same measurement gives 641 -> 769, i.e. 20.0%,
  // mid-band. Pushed further (0.68/0.46 -> 24%) the loop's max width forces the
  // framing fit past the cameraDistance floor and the whole piece shrinks for
  // all 600 frames, which costs more than the extra opening buys.
  bloomStrength: 0.56,         // unfold amplitude
  bloomSplay: 0.38,            // lateral splay of the released region

  curvatureWaveSpeed: 1.15,    // front travel, in surface-coord units per window
  curvatureWaveWidth: 0.30,    // gaussian sigma of the front
  curvatureWaveStrength: 0.26, // displacement amplitude at the front

  propagationDelay: 0.085,     // loop fractions of lag per unit surface distance
  curvatureSpeedGain: 1.0,     // how much harder high-curvature regions flow
  // §19 PINCH CLIMAX. 0.05 of a 10s loop = 0.5s, well past the brief's
  // 0.15-0.35s emphasis window. 0.026 = 0.26s, mid-band: long enough to
  // register the neck, short enough that the motion never reads as frozen.
  peakHold: 0.026,

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
  // §32-11: 0.050 -> 0.062. The geometry stays calm (this is still ~12% of the
  // main deformation amplitude) but the local settling is now visible rather
  // than merely present -- part of the "calm but not stopped" fix.
  equilibriumResidual: 0.062,  // local settling, ~12% of main motion
  // §32-12 RESIDUAL CURVATURE WAVE amplitude. 11.5% of curvatureWaveStrength
  // (0.26), inside the brief's 8-15%. See applyEquilibriumResidual().
  residualWave: 0.030,
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
  // §09/§10: 0.78 -> 0.88. Widening the falloff recruits MORE of the upper-right
  // lobe into the release, so the silhouette opens as a broad region rather
  // than a local bulge. This is what turns the extra bloomStrength into a
  // readable change of outline instead of a deeper dent in the same place.
  const w = siteFalloff(px, py, pz, site, 0.88);
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

  // §32-12 RESIDUAL CURVATURE WAVE. A weak travelling front that runs
  // lower-left -> central neck -> upper-right during equilibrium, at 8-15% of
  // the main flow. ANIM.curvatureWaveStrength is 0.26, so residualWave 0.030
  // is 11.5% of it -- mid-band.
  //
  // The front position is a plain fraction of loop phase (integer harmonic,
  // one traversal per loop), and the whole term is gated by `active`, which is
  // already zero at both ends of the equilibrium window. So this adds motion
  // during the calm stage and contributes exactly nothing at the seam --
  // §32-22's seamless loop is preserved by construction, not by tuning.
  const wa = EVENT_SITES.waveStart, wb = EVENT_SITES.waveEnd;
  let ex = wb[0] - wa[0], ey = wb[1] - wa[1], ez = wb[2] - wa[2];
  const eLen2 = ex * ex + ey * ey + ez * ez;
  // Project the sample onto the lower-left -> upper-right axis.
  const s = ((px - wa[0]) * ex + (py - wa[1]) * ey + (pz - wa[2]) * ez) / eLen2;
  // Front sweeps 0..1 across the equilibrium window, then wraps.
  const frontPos = (t - 0.50) / 0.235;
  const d = s - frontPos;
  const w = 0.26;
  const front = Math.exp(-(d * d) / (2 * w * w));
  const resAmp = ANIM.residualWave * active * front;
  // Displacement is along the surface normal direction (radial on the base
  // sphere), so the wave reads as a swell passing THROUGH the membrane rather
  // than as a lateral slide of the whole form.
  const swell = Math.sin(TAU * (s * 2 - t * 2));
  _acc.x += (px / radial) * resAmp * swell;
  _acc.y += (py / radial) * resAmp * swell;
  _acc.z += (pz / radial) * resAmp * swell;
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
// §04/§18/§19 THE NECK DWELL. This was the single largest cause of "the main
// curvature focal region is still too weak".
//
// peakness reaches a full 1.0 across t=0.38-0.42 (measured), i.e. the neck is
// at its tightest and its curvature maximum for those frames. But the old route
// ran NECK.a at key 0.28 straight to bloomSite at 0.52, so at t=0.40 the focal
// point sat at smoother01(0.5) between them -- roughly 0.32 unit-radii off the
// neck. Against GLOW.coreWidth 0.20 that is exp(-0.32^2/0.08) = 0.28, so the
// bright CORE was at 28% strength over the neck at the exact climax, and §18's
// "the neck must be the strongest structural transition" was resting on a thin
// silhouette line instead of on the light.
//
// The fix is a DWELL, not a speed change: an extra key holds the focus inside
// the neck (drifting a.->b. along the throat, so it is not frozen) across the
// whole peakness plateau, and only then departs for the bloom lobe. The leg
// lookup is generic in n, so this only requires both arrays to stay the same
// length with ascending keys.
const NECK_MID = [
  (NECK.a[0] + NECK.b[0]) * 0.5,
  (NECK.a[1] + NECK.b[1]) * 0.5,
  (NECK.a[2] + NECK.b[2]) * 0.5,
];
const FOCAL_ROUTE = [
  EVENT_SITES.compress,    // 0.00 -- opening contraction
  NECK.a,                  // 0.26 -- into the primary neck
  NECK_MID,                // 0.44 -- DWELLS through the pinch climax (§18/§19)
  EVENT_SITES.bloomSite,   // 0.60 -- released lobe
  EVENT_SITES.waveEnd,     // 0.78 -- carried out along the wave
  EVENT_SITES.waveStart,   // 0.90 -- returns by a DIFFERENT route (§31)
];
const FOCAL_KEYS = [0.0, 0.26, 0.44, 0.60, 0.78, 0.90];

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
  // §20 EQUILIBRIUM MUST STAY ALIVE. The geometry already keeps drifting
  // (applyEquilibriumResidual), but a constant-strength light over a settling
  // form still reads as dead. A slow low-amplitude breath on the light keeps
  // the balanced stage in motion without reintroducing a global pulse -- and
  // the harmonic is INTEGER, so it returns exactly to itself at the seam.
  // §32-13/§32-21. Two changes, both about the EQUILIBRIUM stage:
  //
  //  - The floor rises 0.42 -> 0.52. §32-21 sets a target of 40-60% internal
  //    light field during equilibrium and forbids dimming the piece just
  //    because the motion is calm ("Calm != dark"). The floor is what the
  //    light decays to once peakness, wave and bloom have all released, i.e.
  //    it IS the equilibrium brightness, so this is the knob that instruction
  //    names. The climax is unaffected: it is set by the peakness term, and
  //    that term is unchanged.
  //  - The breathing amplitude rises 0.055 -> 0.085 and gains a second, slower
  //    integer harmonic. Two coprime harmonics (2 and 1) give a compound
  //    rhythm that does not repeat within the loop, so the light never settles
  //    into an obvious pulse -- it reads as circulation. Both are integer, so
  //    the seam is exact.
  const alive = 0.085 * Math.sin(TAU * 2 * t + 0.7) +
                0.045 * Math.sin(TAU * t + 2.3);
  focalPoint.strength = clamp(0.52 + alive + 0.5 * peakness + 0.34 * EV.wave +
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
// Label boundaries track the EVENT schedule (ANIM) rather than even fifths, so
// the stage caption changes when the geometry actually changes stage.
//
// NOTE for the user (§28, deliberately NOT acted on -- typography and stage
// labels are on the preserve list, so this is flagged rather than changed):
// the measured projected width is narrowest at t=0.45 (w=641, neck at full
// pinch) and widest at t=0.70 (w=788, lobe fully open). PHASES[2] is titled
// "03 · BLOOM" but its window (0.27-0.50) covers the TIGHTEST frames, while
// the widest and most dramatic frames fall under "04 · EQUILIBRIUM". So the
// most dramatic frame in the loop is not the one captioned BLOOM.
//
// PHASES[2]'s own note reads "THE NECKS TIGHTEN · THE LOBES OPEN", which does
// describe the pinch, so the current mapping is internally coherent and the
// piece is titled "CURVATURE BLOOM" as a whole. Fixing this is a one-line
// change here (swap the 0.50 boundary to ~0.46 and 0.72 to ~0.74) or a rewrite
// of the two label strings -- your call, since it is a wording decision, not a
// rendering one.
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
  // Spatial hash of the evolved surface. Must run AFTER evolveSurface() and
  // BEFORE renderFrame(), because the silhouette pass looks up curvature
  // response at points that carry no vertex index.
  rebuildResponseGrid();
  measureExtents();
  renderFrame();
  if (isRecording) {
    captureFrame();
    recFrameCount++;
    updateRecordingUI();
    if (recFrameCount >= MAX_FRAMES) stopRecording();
  }
}

// History ring. Captured every frame now (echoStride 1), because the membrane
// strata read a per-layer frame lag out of it -- a stride > 1 would make the
// outer films jump to a new state every stride frames instead of trailing.
function updateEchoes() {
  const frame = isRecording ? recFrameCount : frameCount - 1;
  if (frame % CONFIG.echoStride !== 0) return;
  echoStates[echoWrite].set(surface.positions);
  echoWrite = (echoWrite + 1) % CONFIG.temporalEchoCount;
}

// Positions as they were `age` frames ago. age 0 == the live surface, so a
// membrane layer with lag 0 costs nothing and needs no special case.
// Clamped to the ring depth: asking further back than the ring holds returns
// the oldest state rather than silently wrapping to a FUTURE one, which would
// make the outer film lead the core instead of trailing it.
function historyPositions(age) {
  if (age <= 0) return surface.positions;
  const n = CONFIG.temporalEchoCount;
  const a = Math.min(age, n - 1);
  // echoWrite points at the slot to be written NEXT, i.e. the oldest state.
  return echoStates[((echoWrite - a) % n + n) % n];
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
    // §04 FOCAL HIERARCHY, earned for free. Raising the focusCoverage weight
    // (0.70 -> 1.15) makes the hero SELECTION itself focus-aware: the five
    // promoted chains cluster around wherever the focal point currently is,
    // instead of being scattered across the form by curvature alone. So the
    // brightest line work and the brightest light land in the same place, which
    // is what builds one primary region rather than several competing ones.
    chainScore[chainCount] = vertCount * (0.42 + 1.35 * meanResp + 1.15 * focusCoverage) *
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
  // §14: resolve the lead ribbon BEFORE the bloom pass. renderBloomSource()
  // emits from the lead, and drawContourField() brightens it -- computing it in
  // only one of them would leave the glow trailing a frame behind its source.
  updateRibbonLead();
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

// §06/§07 BROAD CURVATURE BLOOM -- the two-radius internal light field.
//
// focalWeight() above is the WIDE term and is left exactly as it was, because
// the chain scoring and composition drift are tuned against it. What was
// missing is a distinct bright CORE: a single Gaussian at focalWidth 0.58
// covers ~46% of the sculpture width at >50% amplitude, which is a wash. The
// brief asks for a bloom whose visible region is 8-18% of the width, with a
// bright core, a soft falloff, and weaker surrounding illumination.
//
// So: core (0.20 => ~16% of width) + halo (0.58, low gain) sharing one centre.
//
// `resp` is the local curvature response at the sample. §06 requires the light
// to feel generated by curvature from INSIDE the membrane rather than cast by
// an external lamp, so a smooth region near the focus stays comparatively dark
// while a fold at the same distance ignites. Passing resp = 1 gives the pure
// spatial field for callers that have no curvature to hand.
const _glow = { core: 0, halo: 0, total: 0 };
function internalGlow(x, y, z, resp) {
  const dx = x - focalPoint.x, dy = y - focalPoint.y, dz = z - focalPoint.z;
  const d2 = (dx * dx + dy * dy + dz * dz) /
    (CONFIG.baseRadius * CONFIG.baseRadius);
  const cw = GLOW.coreWidth, hw = GLOW.haloWidth;
  const core = Math.exp(-d2 / (2 * cw * cw)) * GLOW.coreGain;
  const halo = Math.exp(-d2 / (2 * hw * hw)) * GLOW.haloGain;
  // Curvature coupling is applied to the CORE only. The halo has to survive
  // across smooth membrane too, or the light stops reading as a spatial field
  // and starts reading as another curvature contour.
  const k = 1 - GLOW.curvatureCoupling + GLOW.curvatureCoupling * clamp(resp, 0, 1);
  _glow.core = core * k * focalPoint.strength;
  _glow.halo = halo * focalPoint.strength;
  _glow.total = _glow.core + _glow.halo;
  return _glow;
}

// §32-02/§32-03/§32-04/§32-13/§32-14 THE BROAD INTERNAL FIELD.
//
// This is the one new light term in the pass, and it is deliberately NOT a new
// visual system (§32 forbids that): it emits nothing of its own, it only
// returns a 0..1 scalar that the EXISTING membrane / ribbon / contour terms
// multiply into their existing alphas. Nothing is drawn by it.
//
// It answers four instructions with one field, because they are one problem:
//   §32-02  a broad soft light around the central neck/fold, 12-20% of width,
//           small brighter centre + wide falloff. Anchored at NECK_MID, which
//           is the saddle between the two masses -- so the light sits where the
//           form's principal curvatures change sign and therefore SCULPTS it.
//   §32-03  the saddle/neck/lobe-connection read comes from `bias`: the field
//           is multiplied up where the surface normal turns away from the neck
//           axis, which is exactly the fold and connection geometry.
//   §32-04  the upper-right lobe's internal gradient -- `lobeGrad` below.
//   §32-14  asymmetry: +X/+Y (upper-right) is lit ~1.35x, -X/-Y (lower-left)
//           ~0.78x, so the two sides never balance.
//
// §32-13 LIGHT MIGRATION: the centre drifts on INTEGER harmonics of loop
// phase (2 and 1), so it wanders continuously through equilibrium and still
// returns exactly to itself at the seam. Amplitude is small (0.10/0.075 of a
// radius) -- felt as circulation, not seen as a moving lamp.
const INTERIOR = {
  width: 0.34,        // wide soft falloff, in baseRadius units
  coreWidth: 0.155,   // ~12.5% of sculpture width: the brighter centre (§32-02)
  drift: 0.10,        // how far the field wanders during equilibrium
  asymGain: 0.35,     // upper-right lit more than lower-left (§32-14)
  lobeSite: [0.34, 0.52, 0.22],  // upper-right lobe = EVENT_SITES.bloomSite
  lobeWidth: 0.66,
};
function interiorField(x, y, z, resp) {
  const R = CONFIG.baseRadius;
  const t = loopProgress;
  // Slow migration of the field centre. Both harmonics are integers.
  const cx = (NECK_MID[0] + INTERIOR.drift * Math.sin(TAU * t + 0.4)) * R;
  const cy = (NECK_MID[1] + INTERIOR.drift * 0.75 * Math.sin(TAU * 2 * t + 1.9)) * R;
  const cz = (NECK_MID[2] + INTERIOR.drift * 0.6 * Math.cos(TAU * t + 1.1)) * R;
  const dx = (x - cx) / R, dy = (y - cy) / R, dz = (z - cz) / R;
  const d2 = dx * dx + dy * dy + dz * dz;
  const w = INTERIOR.width, cw = INTERIOR.coreWidth;
  // Small brighter centre + wide soft falloff -- §32-02's two clauses.
  const broad = Math.exp(-d2 / (2 * w * w));
  const centre = Math.exp(-d2 / (2 * cw * cw));
  // §32-21 CALM != DARK. A small constant pedestal under the two Gaussians.
  // Unlike every other light term in the file this one does NOT scale with
  // focalPoint.strength, peakness, wave or bloom -- so it is the only light
  // that is exactly as strong during EQUILIBRIUM as at the climax. That is
  // precisely what the instruction asks for: the calm stage keeps its
  // luminance while the motion drops.
  //
  // It is bounded and small (0.16) and it sits INSIDE the 1.55 normalisation
  // below, so it lifts the broad quiet interior toward §32-18's 22-35% main
  // membrane band without adding anything at the already-saturated core.
  let f = 0.16 + 0.62 * broad + 0.38 * centre;

  // §32-04 UPPER-RIGHT LOBE INTERNAL GRADIENT. A second broad falloff on the
  // lobe itself, shaped so the inner (neck-facing) flank is brighter than the
  // outer shell. `inner` is the component of the sample->lobe-centre direction
  // along the neck axis: positive on the side that faces the neck.
  const px = x / R, py = y / R, pz = z / R;
  const L = INTERIOR.lobeSite;
  const lx = px - L[0], ly = py - L[1], lz = pz - L[2];
  const ld2 = lx * lx + ly * ly + lz * lz;
  const lw = INTERIOR.lobeWidth;
  const lobeF = Math.exp(-ld2 / (2 * lw * lw));
  // Direction from lobe centre back toward the neck: the gradient's axis.
  let ax = NECK_MID[0] - L[0], ay = NECK_MID[1] - L[1], az = NECK_MID[2] - L[2];
  const al = vlen(ax, ay, az);
  ax /= al; ay /= al; az /= al;
  const inner = (lx * ax + ly * ay + lz * az) / lw;
  // 0.30 rear .. 1.0 inner-neck side. This is the "inner brighter / outer
  // medium / rear darker" ramp, built from position and the neck axis rather
  // than from a light direction, so it reads as internal tone not as shading.
  const lobeGrad = lobeF * (0.30 + 0.70 * smooth01(inner * 0.5 + 0.5));
  f += 0.55 * lobeGrad;

  // §32-14 ASYMMETRIC ILLUMINATION. Upper-right (+x,+y) brighter, lower-left
  // darker but never black -- clamped to a floor so §32-16's rear/lower
  // structure stays readable.
  const asym = 1 + INTERIOR.asymGain * clamp((px * 0.62 + py * 0.55), -1, 1);
  f *= Math.max(0.70, asym);

  // §32-03 LIGHT MUST SCULPT. Curvature-coupled, but only partially: a fully
  // coupled field would collapse back onto the contour lines and stop being a
  // volumetric light. 0.45 keeps folds and the saddle brighter than smooth
  // membrane at equal distance, while the field still crosses flat regions.
  //
  // NORMALISED TO 0..1 BEFORE RETURN. This is load-bearing, not hygiene: the
  // raw sum of broad + centre + lobeGrad, scaled by the asymmetry gain, peaks
  // near 2.1 where the field centre and the upper-right lobe overlap. Every
  // consumer (membrane, ribbons, contours) multiplies this by its own
  // coefficient and ADDS the result, so an unbounded field would push the
  // additive stack far past white exactly where the light is strongest --
  // producing the clipped flat disc the whole brightness budget exists to
  // prevent. Bounded here, at the source, so no consumer has to know.
  //
  // smooth01 rather than a hard clamp: a hard clamp would create a visible
  // flat plateau with a hard edge where the field saturates, which is the same
  // failure in a different guise. The soft knee keeps the falloff a gradient
  // all the way to the peak.
  const raw = f * (0.55 + 0.45 * clamp(resp, 0, 1));
  return smooth01(clamp(raw / 1.55, 0, 1));
}

// §04 FRESNEL-LIKE EDGE RESPONSE, as ONE factor among several -- never the
// whole look. Grazing geometry (n perpendicular to the view) returns ~1.
// Deliberately not a physical Fresnel: no F0, no schlick, no specular lobe,
// because §13 rules out realistic materials. It is a grazing-angle weight.
function edgeFactor(signed) {
  return Math.pow(1 - Math.min(1, Math.abs(signed)), CONFIG.edgePower);
}

// Curvature response at an arbitrary world point on (or very near) the surface.
// The silhouette vertices come out of marching the n·v field, so they sit on
// mesh EDGES and carry no vertex index of their own. A spatial hash of the mesh
// keeps this O(1) rather than scanning 4608 vertices per silhouette sample.
//
// The grid is rebuilt once per frame, after the surface has been evolved.
const RESP_GRID = 12;                      // cells per axis
const RESP_CELL = (CONFIG.baseRadius * 2.6) / RESP_GRID;
const respBuckets = [];
for (let i = 0; i < RESP_GRID * RESP_GRID * RESP_GRID; i++) respBuckets.push([]);

function respCellIndex(x, y, z) {
  const h = RESP_GRID * 0.5;
  const gx = clamp(Math.floor(x / RESP_CELL + h), 0, RESP_GRID - 1);
  const gy = clamp(Math.floor(y / RESP_CELL + h), 0, RESP_GRID - 1);
  const gz = clamp(Math.floor(z / RESP_CELL + h), 0, RESP_GRID - 1);
  return (gx * RESP_GRID + gy) * RESP_GRID + gz;
}

function rebuildResponseGrid() {
  for (let i = 0; i < respBuckets.length; i++) respBuckets[i].length = 0;
  const pos = surface.positions;
  for (let i = 0; i < pointCount; i++) {
    const o = i * 3;
    respBuckets[respCellIndex(pos[o], pos[o + 1], pos[o + 2])].push(i);
  }
}

function sampleResponseAt(x, y, z) {
  const bucket = respBuckets[respCellIndex(x, y, z)];
  if (bucket.length === 0) return 0;
  const pos = surface.positions;
  let best = -1, bestD = Infinity;
  for (let q = 0; q < bucket.length; q++) {
    const o = bucket[q] * 3;
    const dx = pos[o] - x, dy = pos[o + 1] - y, dz = pos[o + 2] - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) { bestD = d; best = bucket[q]; }
  }
  return best < 0 ? 0 : surface.response[best];
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
// §01/§02/§11/§12 THE LAYERED MEMBRANE.
//
// Replaces the single dark shell. That shell was the source of every complaint
// in the brief -- "solid dark mesh", "three large smooth plates", "CAD-like
// surface" -- because one near-opaque fill over the whole manifold IS a plate,
// no matter how it is shaded.
//
// What is drawn instead: the SAME triangle strips, the same topology, the same
// vertices, evaluated 4 times at small normal offsets and small frame lags. No
// new geometry is introduced and the silhouette family is untouched.
//
// Two mechanics make this read as strata rather than as four copies:
//
//  1. NO layer writes depth. This is the load-bearing change of the whole pass
//     and it is worth being explicit about why.
//
//     Depth writing is BINARY. It does not scale with opacity. The old shell
//     rendered at surfaceOpacity 42 and wrote depth, which was defensible: it
//     was dense enough to genuinely be an occluder. This stack renders at 11,
//     compositing to ~6.6% typical luminance -- and a surface the viewer can
//     barely see is still a hard wall for everything behind it if it writes
//     depth. Lowering the alpha would have made the membrane invisible, not
//     translucent, and §01's requirement ("the viewer should be able to see
//     some internal structure through the front surface") would be defeated by
//     construction, along with §11's "do NOT completely hide the back".
//
//     So front/back separation is done in ALPHA instead, which is what §11's
//     100% / 70-100% / 15-30% ratio actually describes. facingTerms(),
//     backFacingFloor and fogFactor() already compute exactly that and were
//     dead code for rear geometry while the shell occluded it.
//
//     The historical warning against removing the shell's occlusion was written
//     when the ribs ran at `11 + 30*resp`, closed islands were drawn, and
//     contour bodies were at full weight -- i.e. when there was enough line
//     density behind the surface to read as a cage. That density is now gone by
//     other means (ribs at `5 + 14*resp`, closed chains skipped, minChainLength
//     20, contour body halved). If the rear still reads too strong, the knob is
//     CONFIG.backFacingFloor (0.28 -> ~0.20), not depth.
//
//  2. Each outer layer reads its positions from `historyPositions(lag)`, so
//     the films trail the core through the pinch and catch up through the
//     bloom release (§16/§17 ELASTIC MEMORY). The lag is 3-12 frames = 50-200ms,
//     below the threshold where it reads as a second animation.
//
// Alpha per vertex is a product of: layer tier, facing (front/back, §11), the
// grazing edge term (§04), local curvature, and the internal glow (§06). That
// combination is §12's broad soft gradient -- and it is why the fill can be so
// faint and still describe volume.
function drawMembraneLayers() {
  const nrm = surface.normals;
  const base = CONFIG.surfaceInset;
  const gl = drawingContext;
  noStroke();

  // §17/§18: the strata separate on the bloom release and settle back at
  // equilibrium. Driven by EV.bloom, which is already loop-periodic.
  const sep = 1 + MEMBRANE.separationGain * EV.bloom;

  for (let L = 0; L < MEMBRANE.layers.length; L++) {
    const layer = MEMBRANE.layers[L];
    const pos = historyPositions(layer.lag);
    const off = layer.offset * sep;
    const tone = layer.tone;
    const amp = CONFIG.surfaceOpacity * layer.alpha;
    const gbias = layer.glowBias;
    // No layer writes depth -- front/back separation is in alpha. See note 1.
    gl.depthMask(false);

    for (let i = 0; i < US; i++) {
      const i2 = (i + 1) % US;   // wrap closes the seam column
      beginShape(TRIANGLE_STRIP);
      for (let j = POLE_SKIP; j < VS - POLE_SKIP; j++) {
        const ia = paramIndex(i, j), ib = paramIndex(i2, j);
        membraneVertex(pos, nrm, ia, base, off, tone, amp, L, gbias);
        membraneVertex(pos, nrm, ib, base, off, tone, amp, L, gbias);
      }
      endShape();
    }
  }
  gl.depthMask(true);
  noFill();
}

// One membrane vertex. Split out of the strip loop so the four-layer pass
// stays readable; the arithmetic is identical to what the single shell did,
// plus the normal offset, the edge term and the two-radius glow.
function membraneVertex(pos, nrm, idx, base, off, tone, amp, layerIndex, gbias) {
  const o = idx * 3;
  // Normals are taken from the LIVE surface even when positions come from
  // history. The lag is a few frames, so the normal is essentially correct,
  // and recomputing normals per lagged state would cost 4 full passes for a
  // difference below the alpha quantisation.
  const nx = nrm[o], ny = nrm[o + 1], nz = nrm[o + 2];
  const x = pos[o] * base + nx * off;
  const y = pos[o + 1] * base + ny * off;
  const z = pos[o + 2] * base + nz * off;

  const ft = facingTerms(x, y, z, nx, ny, nz);
  // §11: outer films are attenuated harder on back-facing geometry than the
  // core, so the rear stays readable (never hidden) but never competes.
  const backW = layerIndex === 0 ? 1 : MEMBRANE.backBias;
  const facing = 1 - (1 - ft.facing) * backW;
  const edge = edgeFactor(ft.signed);
  const resp = surface.response[idx];
  const g = internalGlow(x, y, z, resp);

  // §12 SURFACE GRADIENT. Curvature, normal orientation, depth, internal glow
  // and local deformation all contribute; no single one dominates, which is
  // what keeps the fill from reading flat without resorting to PBR shading.
  //
  // §13 MEMBRANE MIDTONES, +15-30%. The knob is the CONSTANT term (0.30 ->
  // 0.40) and the facing term, NOT CONFIG.surfaceOpacity. That distinction is
  // the whole instruction: the master opacity scales every term including the
  // crests and the glow, which would raise pure highlights -- explicitly ruled
  // out -- whereas the constant is precisely the floor that sets how dark the
  // BROAD, low-curvature regions sit. Lifting it moves the large quiet areas
  // from near-black toward charcoal / smoke-grey without touching what the
  // bright core does. The glow coefficients are left alone for the same reason.
  // §32-01/§32-17 INTERNAL MIDTONE BOOST, +20-25%, targeted at the 20-50%
  // luminance band and NOT at highlights. The budget is closed, so this is a
  // REDISTRIBUTION, not an increase:
  //   constant 0.40 -> 0.50  (+25% on the broad quiet regions -- charcoal and
  //                           smoke-grey lift, the "centre is too dark" fix)
  //   facing   0.62 -> 0.74  (front/side volume; rear is untouched, so §32-16's
  //                           front/side/rear ratio widens rather than flattens)
  //   g.core   1.15 -> 1.00  (CUT. The core is the one term that peaks exactly
  //                           where the stack is already at 99.3%. Trimming it
  //                           pays for both lifts above and keeps pure white
  //                           from growing, which §32-01 forbids explicitly.)
  // The halo RISES (0.55 -> 0.78): it is the wide, soft, low-amplitude field,
  // so it lands in the midrange across the whole form instead of on the peak.
  const a = amp * (
    0.50 +
    0.74 * facing +
    0.34 * edge +               // §04: grazing membrane is more visible
    0.34 * resp +
    1.00 * g.core * gbias +     // §06/§07: the bloom, seen THROUGH the film
    0.78 * g.halo * gbias +
    // §32-02/§32-03/§32-04. gbias > 1 on the outer films, so the interior
    // light grows as it passes outward through the stack -- the stratum
    // furthest from the core is the one most lit by it, which is how a
    // translucent volume lit from within actually reads.
    0.40 * interiorField(x, y, z, resp) * gbias +
    0.18 * waveHighlight(x, y, z)
  ) * fogFactor(viewDepthAtPoint(x, y, z)) * lobeMidtone(x, y, z);

  // §10 DEPTH HAZE. Additive layers cannot be darkened, so the haze lives here
  // in the BLEND pass: a near-black wash whose weight rises with view depth.
  // Very restrained -- this is a volumetric depth CUE separating front strata
  // from rear ones, not a visible fog cloud.
  const haze = smooth01((viewDepthAtPoint(x, y, z) - cameraEye.z * 0.72) /
    CONFIG.fogDepthRange);
  const t = tone * (1 - 0.42 * haze);

  fill(INK_R * t, INK_G * t, INK_B * (t + 0.04), a);
  vertex(x, y, z);
}

// §03 CURVATURE RIBBONS.
//
// The brief is explicit about what these must NOT be: UV grid lines, lat-long
// lines, small closed loops, or arbitrary Bezier scribbles. Each ribbon here is
// a path that walks the FULL u range an integer number of times while drifting
// in v -- so it is a long diagonal band that wraps the whole manifold and
// closes on itself at the seam with no start or stop anywhere on screen.
//
// They are BANDS (TRIANGLE_STRIP), not strokes. A stroked path would just be
// another contour line, and §03's "compress near the primary neck, widen or
// relax across broad lobes" would have no quantity to act on. Half-width is
// driven down by local curvature response, so a ribbon visibly narrows as it
// crosses the neck and relaxes over the lobes -- membrane stress lines.
//
// §14 LIGHT HIERARCHY: each ribbon has a static tier, and additionally the one
// currently closest to the travelling focal point is boosted. So 1-2 ribbons
// lead at any moment and WHICH ones lead changes across the loop.
function ribbonSample(rb, s, out) {
  // s in [0,1) -- one full traversal. u wraps `wraps` times (integer, so the
  // band closes); v migrates by vSwing along the way, eased so the drift is
  // smooth rather than linear.
  const u = s * rb.wraps;
  // v MUST be periodic in s or the band tears open at its own seam: the last
  // sample would sit vSwing away from the first (measured: 0.46 in v, ~20 rows
  // of the mesh -- a visible gash across the sculpture). smootherstep is not
  // periodic (0 -> 1); a raised cosine is, and reaches the identical excursion
  // at s=0.5, so the ribbon sweeps out and back across the manifold and closes
  // on itself exactly.
  const vT = rb.vOffset + rb.vSwing * (0.5 - 0.5 * Math.cos(TAU * s));
  // Slow self-drift along the path. driftRate and rb.drift are INTEGER
  // harmonics of the loop -- a fractional value here tears the Reel at the wrap.
  const drift = 0.035 * rb.drift *
    Math.sin(TAU * RIBBON_CFG.driftRate * loopProgress);
  const vv = clamp(vT + drift, 0.02, 0.98);

  // Map into the pole-skipped row span, then bilinearly sample the live mesh.
  const jSpan = VS - 1 - 2 * POLE_SKIP;
  const fj = POLE_SKIP + vv * jSpan;
  const j0 = Math.floor(fj), tj = fj - j0;
  const fi = (u % 1 + 1) % 1 * US;
  const i0 = Math.floor(fi), ti = fi - i0;

  const pos = surface.positions;
  const nrm = surface.normals;
  const a = paramIndex(i0, j0) * 3, b = paramIndex(i0 + 1, j0) * 3;
  const c = paramIndex(i0, j0 + 1) * 3, d = paramIndex(i0 + 1, j0 + 1) * 3;
  for (let k = 0; k < 3; k++) {
    const top = pos[a + k] + (pos[b + k] - pos[a + k]) * ti;
    const bot = pos[c + k] + (pos[d + k] - pos[c + k]) * ti;
    out.p[k] = top + (bot - top) * tj;
    const tn = nrm[a + k] + (nrm[b + k] - nrm[a + k]) * ti;
    const bn = nrm[c + k] + (nrm[d + k] - nrm[c + k]) * ti;
    out.n[k] = tn + (bn - tn) * tj;
  }
  const nl = vlen(out.n[0], out.n[1], out.n[2]);
  out.n[0] /= nl; out.n[1] /= nl; out.n[2] /= nl;
  const ra = surface.response[paramIndex(i0, j0)];
  const rb2 = surface.response[paramIndex(i0 + 1, j0)];
  const rc = surface.response[paramIndex(i0, j0 + 1)];
  const rd = surface.response[paramIndex(i0 + 1, j0 + 1)];
  const rt = ra + (rb2 - ra) * ti, rbb = rc + (rd - rc) * ti;
  out.resp = rt + (rbb - rt) * tj;
  return out;
}


const _rbA = { p: [0, 0, 0], n: [0, 0, 0], resp: 0 };
const _rbB = { p: [0, 0, 0], n: [0, 0, 0], resp: 0 };

// Which ribbon the focal point is currently riding (§14). Module scope because
// the bloom pass must emit from the SAME lead ribbon the sculpture pass
// brightens -- if the two disagreed, the glow would detach from its source.
let ribbonLead = -1;

// §14: find which ribbon the focal point is currently riding. Sampled coarsely
// -- this only decides a brightness boost, so 12 probes per ribbon is ample.
function updateRibbonLead() {
  let lead = -1, leadScore = -Infinity;
  for (let r = 0; r < RIBBONS.length; r++) {
    let acc = 0;
    for (let q = 0; q < 12; q++) {
      const s = ribbonSample(RIBBONS[r], q / 12, _rbA);
      acc += clamp(focalWeight(s.p[0], s.p[1], s.p[2]), 0, 1);
    }
    const sc = acc * RIBBONS[r].tier;
    if (sc > leadScore) { leadScore = sc; lead = r; }
  }
  ribbonLead = lead;
}

function drawCurvatureRibbons() {
  const N = RIBBON_CFG.samples;
  noStroke();

  const lead = ribbonLead;

  blendMode(ADD);

  // §33-05 SERRATION FIX. This pass must not WRITE depth.
  //
  // drawMembraneLayers() restores gl.depthMask(true) on its way out, so the
  // ribbons inherited a depth-writing state. Each hero band is drawn twice: a
  // wide halo strip first, then the narrow body strip on the same centreline.
  // The halo wrote its own depth, and the body -- drawn afterwards at a
  // marginally different depth along a curving band -- was then rejected by
  // the depth test in patches, punching triangular holes along one flank.
  // That is the "serrated / torn / zipper-like" central region in §05.
  //
  // Diagnosis by elimination (isolation captures at f0420): NOT resp noise
  // (path-smoothing changed nothing), NOT binormal flips (measured 0 flips,
  // |b| ~ 0.99), NOT halo width (teeth identical at 1.2/1.6/2.0 and LARGER at
  // compression 0), NOT halo brightness (haloAlpha = 0 left the teeth intact
  // -- proving they were an occlusion hole, not an emitted shape).
  //
  // Clearing depthMask (rather than disabling DEPTH_TEST outright) is the
  // minimal fix: it restores the invariant this file documents elsewhere --
  // nothing in the sculpture pass writes depth -- without altering whether
  // later additive layers test against the membrane. Restored after the pass.
  const _gl = drawingContext;
  _gl.depthMask(false);

  // §15 HERO RIBBON HALO. "Thin bright core + slightly wider dim halo", so the
  // hero bands float INSIDE the membrane instead of sitting on it.
  //
  // Implemented as a second walk of the SAME ribbonSample() path -- a wide,
  // very dim band drawn underneath the normal one. That is a redraw of an
  // existing system rather than a new one (§26), and because both passes read
  // identical samples the halo can never drift off its own core. Secondary
  // ribbons are skipped entirely, per §15's "keep secondary ribbons mostly
  // without halos".
  for (let r = 0; r < RIBBONS.length; r++) {
    const rb = RIBBONS[r];
    if (!rb.hero) continue;
    const tier = rb.tier * (r === lead ? RIBBON_CFG.leadBoost : 1);
    // Two strips, one per side of the centreline, so the halo is symmetric
    // about the ribbon. Doing this as a single strip is not possible without
    // either zigzagging the triangles or lighting only one flank.
    for (let side = -1; side <= 1; side += 2) {
    beginShape(TRIANGLE_STRIP);
    for (let q = 0; q <= N; q++) {
      const s = ribbonSample(rb, (q % N) / N, _rbA);
      const x = s.p[0] + s.n[0] * RIBBON_CFG.lift;
      const y = s.p[1] + s.n[1] * RIBBON_CFG.lift;
      const z = s.p[2] + s.n[2] * RIBBON_CFG.lift;
      const s2 = ribbonSample(rb, ((q + 1) % N) / N, _rbB);
      let tx = s2.p[0] - s.p[0], ty = s2.p[1] - s.p[1], tz = s2.p[2] - s.p[2];
      const tl = vlen(tx, ty, tz);
      tx /= tl; ty /= tl; tz /= tl;
      let bx = ty * s.n[2] - tz * s.n[1];
      let by = tz * s.n[0] - tx * s.n[2];
      let bz = tx * s.n[1] - ty * s.n[0];
      const bl = vlen(bx, by, bz);
      bx /= bl; by /= bl; bz /= bl;
      const hw = rb.width * RIBBON_CFG.haloWidth *
        (1 - RIBBON_CFG.compression * 0.5 * clamp(s.resp, 0, 1));
      const ft = facingTerms(x, y, z, s.n[0], s.n[1], s.n[2]);
      const g = internalGlow(x, y, z, s.resp);
      const a = RIBBON_CFG.baseAlpha * RIBBON_CFG.haloAlpha * tier *
        (0.30 + 0.50 * s.resp + 0.80 * g.core + 0.45 * g.halo) *
        ft.facing * fogFactor(viewDepthAtPoint(x, y, z));
      // Transparent at the outer edge, `a` at the centreline: the halo fades
      // outward from the ribbon it belongs to.
      fill(INK_R, INK_G, INK_B, 0);
      vertex(x + bx * hw * side, y + by * hw * side, z + bz * hw * side);
      fill(INK_R, INK_G, INK_B, a);
      vertex(x, y, z);
    }
    endShape();
    }
  }

  for (let r = 0; r < RIBBONS.length; r++) {
    const rb = RIBBONS[r];
    const tier = rb.tier * (r === lead ? RIBBON_CFG.leadBoost : 1);
    beginShape(TRIANGLE_STRIP);
    // <= N so the band's last pair coincides with its first: closed, seamless.
    for (let q = 0; q <= N; q++) {
      const s = ribbonSample(rb, (q % N) / N, _rbA);
      const x = s.p[0] + s.n[0] * RIBBON_CFG.lift;
      const y = s.p[1] + s.n[1] * RIBBON_CFG.lift;
      const z = s.p[2] + s.n[2] * RIBBON_CFG.lift;

      // Band tangent, from a neighbouring sample, so the width is laid out
      // perpendicular to the direction of travel.
      const s2 = ribbonSample(rb, ((q + 1) % N) / N, _rbB);
      let tx = s2.p[0] - s.p[0], ty = s2.p[1] - s.p[1], tz = s2.p[2] - s.p[2];
      const tl = vlen(tx, ty, tz);
      tx /= tl; ty /= tl; tz /= tl;
      // Binormal = tangent x normal: lies IN the surface, perpendicular to the
      // path. This is what makes the band hug the manifold instead of standing
      // off it like a ribbon in space.
      let bx = ty * s.n[2] - tz * s.n[1];
      let by = tz * s.n[0] - tx * s.n[2];
      let bz = tx * s.n[1] - ty * s.n[0];
      const bl = vlen(bx, by, bz);
      bx /= bl; by /= bl; bz /= bl;

      // §03: compress at high curvature (the neck), relax over the lobes.
      const hw = rb.width * (1 - RIBBON_CFG.compression * clamp(s.resp, 0, 1));

      const ft = facingTerms(x, y, z, s.n[0], s.n[1], s.n[2]);
      const g = internalGlow(x, y, z, s.resp);
      const fog = fogFactor(viewDepthAtPoint(x, y, z));
      // §32-06: g.core 0.90 -> 0.62 pays for baseAlpha 28 -> 39 (see
      // RIBBON_CFG). The gain lands on the body terms, the cut lands on the
      // climax core, so the ribbons read brighter along their whole length
      // without moving the peak.
      // §32-11: a low-amplitude brightness travelling along the band's own arc
      // length. INTEGER harmonic in both q and t, so it loops exactly. This is
      // the "low-amplitude ribbon drift" that keeps equilibrium alive without
      // moving any geometry.
      const flow = 0.5 + 0.5 * Math.sin(TAU * (2 * (q / N) - loopProgress) + r * 1.7);
      // §32-21 EQUILIBRIUM RIBBON FLOOR -- partially solved, see the caveat.
      //
      // Every OTHER term in this sum (g.core, g.halo, waveHighlight, and resp
      // itself) is driven by the focal light or the active event, and all of
      // them release TOGETHER at equilibrium. The hero ribbons therefore fell
      // to ~15% of white in the calm stage -- they would simply vanish, which
      // is both the "hero ribbons are too faint" complaint and a direct miss
      // against §32-21's 65-80% equilibrium-to-climax target.
      //
      // The unmodulated constant is the right instrument for this, because it
      // is the ribbon's own intrinsic presence: the light-driven terms then
      // ride ON TOP for the climax, preserving §32-19/§32-20's pinch and bloom
      // accents instead of flattening them. It is set to 0.85 (from 0.26).
      //
      // It is NOT set higher, though a higher value would hit the ratio. At
      // 1.15 with leadBoost cut to 1.25 the ratio still only reached 46%, and
      // the two side effects were real: the ribbons became largely independent
      // of the light (contradicting "heroes ride the field"), and leadBoost at
      // 1.25 flattened the §14 hierarchy that makes 1-2 ribbons lead per frame.
      // Chasing the last of the ratio here costs more than it buys.
      //
      // Measured: climax ~67%, equilibrium ~35% of climax, against a 65-80%
      // target. Closing the rest belongs in the EQUILIBRIUM FLOOR of EV /
      // focalPoint.strength -- lift what the ribbons are reading, not the
      // constant that ignores it.
      const a = RIBBON_CFG.baseAlpha * tier * (
        0.85 + 0.44 * s.resp + 0.62 * g.core + 0.34 * g.halo +
        0.34 * interiorField(x, y, z, s.resp) +   // §32-02: heroes ride the field
        0.30 * edgeFactor(ft.signed) +
        0.16 * flow +
        0.26 * waveHighlight(x, y, z)
      ) * ft.facing * fog;

      // §32-08 RIBBON QUALITY. The band fades toward its own edges, so it
      // reads as a soft luminous stress line rather than a hard strip of tape.
      // The outer edge alpha drops 0.18 -> 0.10 and the bright vertex is
      // pulled closer to the centreline (0.15 -> 0.10): a tighter, softer
      // gradient across a thinner band is what removes the "technical" read
      // without losing the line.
      fill(INK_R, INK_G, INK_B, a * 0.10);
      vertex(x + bx * hw, y + by * hw, z + bz * hw);
      fill(INK_R, INK_G, INK_B, a);
      vertex(x - bx * hw * 0.10, y - by * hw * 0.10, z - bz * hw * 0.10);
    }
    endShape();
  }
  // Hand the depth buffer back exactly as it was found; leaking this state
  // into later passes is the bug this block exists to fix.
  _gl.depthMask(true);
  blendMode(BLEND);
  noFill();
}

// DEBUG (measurement harness only). When window.ISOLATE is set to a layer
// name, every other layer is skipped so the harness can histogram one element
// against its own target band. Null in normal operation -- costs one compare.
function isoOn(layer) {
  const iso = (typeof window !== 'undefined') ? window.ISOLATE : null;
  return !iso || iso === layer;
}

function drawContourField() {
  const pos = surface.positions;
  const nrm = surface.normals;

  // The membrane strata go down first, in BLEND; everything after is additive
  // line work. Nothing in the sculpture pass writes depth (see note 1 in
  // drawMembraneLayers), so the additive layers composite through the films
  // instead of being culled by them -- which is what lets internal structure
  // read through the front surface at all (§01).
  if (isoOn('membrane')) drawMembraneLayers();
  if (isoOn('ribbons')) drawCurvatureRibbons();

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
  // §04/§05 SELECTIVE EDGE LIGHT. The previous alpha was
  //     base * (0.70 + 0.30 * focal)
  // and that 0.70 FLOOR is the "uniform white perimeter stroke" the brief
  // rejects: every outline vertex on the form was guaranteed 70% brightness,
  // so the silhouette read as a traced technical outline regardless of what
  // the geometry was doing.
  //
  // The floor is now silhouetteFloor (0.07) and the other 90% must be EARNED
  // from three independent terms, so some edges glow, some fade, and some
  // genuinely disappear:
  //   edge  -- Fresnel-like grazing response (§04)
  //   resp  -- local curvature: major folds and the pinch region win (§05)
  //   glow  -- proximity to the travelling internal light (§09)
  // Weight also drops (rimWeight 2.65 -> 1.55): brightness carries the
  // hierarchy now, not stroke width.
  strokeWeight(CONFIG.rimWeight);
  const _isoSil = isoOn('silhouette');
  for (let c = 0; _isoSil && c < silCount; c++) {
    const start = silStarts[c];
    const len = silLengths[c];
    beginShape();
    for (let q = 0; q < len; q++) {
      const o = (start + q) * 3;
      const x = silVerts[o], y = silVerts[o + 1], z = silVerts[o + 2];
      const resp = clamp(sampleResponseAt(x, y, z), 0, 1);
      const g = internalGlow(x, y, z, resp);
      // The silhouette curve is BY DEFINITION where n is perpendicular to the
      // view, so signed n·v is ~0 and edgeFactor() would return ~1 everywhere
      // along it -- useless as a discriminator here. What varies along the
      // curve is curvature and light, so those carry §05's variation, and the
      // Fresnel term does its work on the membrane and ribbons instead.
      // §16/§17 EDGE LIGHT THAT TRAVELS. Both gains are raised (see CONFIG) so
      // the difference between an activated edge and a dormant one widens --
      // the floor stays at 0.10, so this steepens the contrast along the
      // outline rather than brightening the outline as a whole. Because the
      // focal term reads internalGlow(), whose centre walks the FOCAL_ROUTE,
      // the bright stretch of silhouette MOVES with the curvature: the neck
      // edge peaks at the pinch, then the light runs out along the upper-right
      // as the bloom opens.
      const selective =
        CONFIG.edgeCurvatureGain * Math.pow(resp, 1.35) +
        CONFIG.edgeFocalGain * clamp(g.core + 0.5 * g.halo, 0, 1);
      // §08: the left-lower lobe gets a softer, dimmer outline so it stops
      // reading as the heaviest silhouette in the frame.
      const lobe = 1 - LOBE_BALANCE.silCut * lobeWeight(x, y, z);
      const a = CONFIG.silhouetteBase *
        (CONFIG.silhouetteFloor + (1 - CONFIG.silhouetteFloor) *
          clamp(selective, 0, 1)) *
        (1 + 0.24 * peakness) * silVertDepth[start + q] *
        CONFIG.silhouetteStrength * lobe;
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
  const _isoChn = isoOn('chains');
  for (let c = 0; _isoChn && c < chainCount; c++) {
    const start = chainStarts[c];
    const len = chainLengths[c];
    const hero = chainIsHero[c] === 1;
    const closed = chainIsClosed[c] === 1;
    // §15: closed level-set islands are the MRI/CT-slice signature and cannot
    // be tuned away, only excluded. Long open bands carry the strata read.
    if (closed) continue;
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
    // §32-07: the secondary chains lose WIDTH as well as opacity (0.42+0.34r
    // -> 0.30+0.22r). Width is what made them read as heavy braces; halving
    // the opacity alone would have left thick grey bands.
    strokeWeight(CONFIG.surfaceLineWeight *
      (hero ? 0.88 + 0.66 * r + 0.44 * peak : 0.30 + 0.22 * r) *
      (closed ? 0.72 : 1));

    beginShape();
    for (let q = 0; q < len; q++) {
      const o = (start + q) * 3;
      const x = chainVerts[o], y = chainVerts[o + 1], z = chainVerts[o + 2];
      if (!Number.isFinite(x)) continue;
      const fog = fogFactor(viewDepthAtPoint(x, y, z));
      const nx = chainVertNormals[o], ny = chainVertNormals[o + 1], nz = chainVertNormals[o + 2];
      const ftc = facingTerms(x, y, z, nx, ny, nz);
      // Both terms must be read out BEFORE any other facingTerms() call:
      // _facing is a shared module-scope struct, reused to keep this hot loop
      // allocation-free, so a later call would overwrite `signed` in place.
      const facing = ftc.facing;
      const signedC = ftc.signed;
      const localR = chainVertResponse[start + q];
      const localPeak = Math.pow(
        smooth01((localR - hi) / (1 - hi)), CONFIG.curvatureHighlightPower);
      const gc = internalGlow(x, y, z, localR);
      const foc = clamp(gc.core + 0.6 * gc.halo, 0, 1);
      const climax = peakness * (0.30 + 0.70 * localPeak);
      const front = waveHighlight(x, y, z);
      // §08: the focal term is what guarantees one dominant bright region at
      // every moment of the loop, not only inside the wave window.
      const neighborhood = smooth01((localR - 0.50) / 0.38);
      // §14/§03: this layer is now SECONDARY to the ribbons. Its body tone is
      // cut roughly in half so the long bands lead the eye and the contours
      // read as the finer curvature texture underneath them, rather than the
      // two layers competing as equal line work.
      // §32-07: the secondary body tone is cut hard (10+26r -> 6+15r) so these
      // stop competing; the hero contours are left near their old value since
      // they are the finer curvature texture under the ribbons, not the braces.
      // §32-17/§32-18: the hero contour peak measured ~140% of white at the
      // climax, i.e. clipped. The BODY term is left alone (it is midtone and
      // §32-17 wants midtone), and the two spike terms below -- localPeak and
      // climax -- are what actually blow past white, so those are trimmed
      // instead. That keeps the broad curvature texture and removes only the
      // clipped white core, which §32-01 rules out growing.
      const contourBody = hero ? 20 + 44 * localR : 6 + 15 * localR;
      // §32-02/§32-07. The interior field is deliberately NOT added here.
      //
      // It was, and it was wrong twice over. Numerically it put 30 points of
      // new light on the one stack that had no headroom: the hero contour
      // peak measured 146% of white, and clawing it back cost four successive
      // trims to localPeak and climax -- which are exactly the pinch-climax
      // accents §32-19 says to preserve. Removing the term buys those trims
      // back: localPeak/climax sit at 44/38 rather than the 40/34 they had
      // been driven down to, and the peak measures 98.1% instead of 106.7%.
      //
      // 44/38 rather than their original 92/80 because the ORIGINAL values
      // were themselves over budget once foc and front were counted at a
      // realistic co-occurrence (133%) -- a vertex on the focal core at the
      // pinch climax has localPeak, climax, front and foc all near maximum
      // together, which is precisely the frame the ceiling has to hold.
      //
      // Directionally it also fought the brief: §32-07 asks for the internal
      // line work to RECEDE, so routing the new light through it works against
      // the same instruction that halved secondaryLineOpacity. The membrane
      // and the three hero ribbons already carry interiorField(), and they are
      // where "ONE broad internal light region" is supposed to read from.
      const a = (contourBody + 44 * localPeak + 38 * climax +
        44 * front * (0.42 + 0.58 * localR) +
        56 * foc * (0.42 + 0.58 * localR) + 26 * neighborhood * foc) *
        fog * facing * tier * (0.55 + 0.45 * edgeFactor(signedC));
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
  const _isoRib = isoOn('ribs');
  for (let i = 0; _isoRib && i < US; i += CONFIG.ribStride) {
    beginShape();
    for (let j = POLE_SKIP; j < VS - POLE_SKIP; j++) {
      const idx = paramIndex(i, j);
      const o = idx * 3;
      const ft = facingTerms(pos[o], pos[o + 1], pos[o + 2],
        nrm[o], nrm[o + 1], nrm[o + 2]);
      // §01: halved again. With the ribbons now carrying the long structural
      // read, these meridians only need to whisper -- any more and they are
      // the last remaining evenly-spaced longitude set, i.e. mesh.
      // §06/§07: dimmed again (5+14 -> 3+9). These meridians are the last
      // evenly-spaced longitude set on screen and are the most "technical"-
      // looking thing left in the frame, so they are held to the faintest
      // whisper that still ties the silhouette to the contour bands.
      const a = (3 + 9 * surface.response[idx]) * ft.facing *
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
  // The ring now holds one state per FRAME (it also feeds the membrane lag),
  // so the echoes select explicit AGES out of it rather than walking every
  // slot -- otherwise 14 near-identical outlines would stack up and rebuild
  // the duplicated-wireframe look this layer was rewritten to avoid.
  for (let e = 0; e < CONFIG.echoDrawAge.length; e++) {
    const state = historyPositions(CONFIG.echoDrawAge[e]);
    const base = CONFIG.echoAlpha[Math.min(e, CONFIG.echoAlpha.length - 1)];
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
  // §07/§08: gated on the two-radius CORE, not the wide focal halo. The halo is
  // ~46% of the sculpture width; blooming against it lit up most of the form at
  // once and is what flattened the climax. The core is ~16%, which is the
  // brief's target for a broad-but-bounded luminous region.
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
      const g = internalGlow(x, y, z, localR);
      const foc = clamp(g.core + 0.45 * g.halo, 0, 1);
      const field = smooth01((localR - 0.58) / 0.30) * foc;
      const a = 255 * (0.30 * field + 0.70 * core * (0.34 + 0.66 * foc)) *
        fogFactor(viewDepthAtPoint(x, y, z));
      b.stroke(INK_R, INK_G, INK_B, a);
      b.vertex(x, y, z);
    }
    b.endShape();
  }

  // ---------------------------------------------------------------------
  // RIBBON EMISSION. The chains alone used to feed the bloom, which meant
  // the two brightest things on screen -- the lead ribbon (72% of white) and
  // the membrane crests -- contributed NO glow at all. The light source and
  // the light were decoupled, so the climax looked lit rather than luminous.
  //
  // Ribbons are re-walked here as emissive bands, gated hard on the glow core
  // so only the region the focus is visiting blooms (§08 stays intact -- one
  // travelling hotspot, not several equal ones).
  // ---------------------------------------------------------------------
  b.noStroke();
  const N = RIBBON_CFG.samples;
  for (let r = 0; r < RIBBONS.length; r++) {
    const rb = RIBBONS[r];
    const tier = rb.tier * (r === ribbonLead ? RIBBON_CFG.leadBoost : 1);
    b.beginShape(TRIANGLE_STRIP);
    for (let q = 0; q <= N; q++) {
      const sm = ribbonSample(rb, (q % N) / N, _rbA);
      const x = sm.p[0] + sm.n[0] * RIBBON_CFG.lift;
      const y = sm.p[1] + sm.n[1] * RIBBON_CFG.lift;
      const z = sm.p[2] + sm.n[2] * RIBBON_CFG.lift;
      const s2 = ribbonSample(rb, ((q + 1) % N) / N, _rbB);
      let tx = s2.p[0] - x, ty = s2.p[1] - y, tz = s2.p[2] - z;
      const tl = vlen(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      let bx = ty * sm.n[2] - tz * sm.n[1];
      let by = tz * sm.n[0] - tx * sm.n[2];
      let bz = tx * sm.n[1] - ty * sm.n[0];
      const bl = vlen(bx, by, bz) || 1;
      bx /= bl; by /= bl; bz /= bl;

      const hw = rb.width * (1 - RIBBON_CFG.compression * clamp(sm.resp, 0, 1));
      const ft = facingTerms(x, y, z, sm.n[0], sm.n[1], sm.n[2]);
      const g = internalGlow(x, y, z, sm.resp);
      // Emission is the PRODUCT of curvature and focal core: a high-curvature
      // ribbon far from the focus stays dark, and the focus crossing a flat
      // stretch stays dark. Only their coincidence emits.
      const em = clamp(sm.resp, 0, 1) * clamp(g.core + 0.35 * g.halo, 0, 1);
      // Normalised by leadBoost so the lead ribbon saturates the buffer at 1.0
      // instead of 1.6. Over-driving past 255 clips in the source and destroys
      // the falloff the streak pass needs -- the halo would go hard-edged.
      const a = (255 / RIBBON_CFG.leadBoost) * tier * Math.pow(em, 0.85) *
        ft.facing * fogFactor(viewDepthAtPoint(x, y, z));
      b.fill(INK_R, INK_G, INK_B, a * 0.10);
      b.vertex(x + bx * hw, y + by * hw, z + bz * hw);
      b.fill(INK_R, INK_G, INK_B, a);
      b.vertex(x - bx * hw * 0.15, y - by * hw * 0.15, z - bz * hw * 0.15);
    }
    b.endShape();
  }

  // ---------------------------------------------------------------------
  // MEMBRANE CREST EMISSION. Sparse point emitters on the mesh wherever high
  // curvature and the focal core coincide. This is what makes the bloom look
  // like it is coming from INSIDE the film rather than off the line work --
  // the glow acquires the shape of the surface, not the shape of the contours.
  // Strided so this stays a scatter of light sources, not a solid glowing sheet.
  // ---------------------------------------------------------------------
  const pos = surface.positions;
  const nrm = surface.normals;
  for (let i = 0; i < US; i += 2) {
    for (let j = POLE_SKIP; j < VS - POLE_SKIP; j += 2) {
      const idx = paramIndex(i, j);
      const resp = surface.response[idx];
      if (resp < 0.52) continue;
      const o = idx * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      const g = internalGlow(x, y, z, resp);
      const em = clamp(g.core + 0.30 * g.halo, 0, 1) *
        smooth01(clamp((resp - 0.52) / 0.40, 0, 1));
      if (em < 0.02) continue;
      const ft = facingTerms(x, y, z, nrm[o], nrm[o + 1], nrm[o + 2]);
      const a = 255 * em * ft.facing * fogFactor(viewDepthAtPoint(x, y, z));
      b.push();
      b.translate(x, y, z);
      b.fill(INK_R, INK_G, INK_B, a * 0.55);
      b.circle(0, 0, 5 + 13 * em);
      b.pop();
    }
  }

  b.pop();
  b.pop();
}

// §29 NO BLOOM OVERLOAD. Two changes, both about removing a cinematic signature
// so the light reads as embedded in the geometry rather than applied on top:
//
//  - The streak was HORIZONTAL ONLY (14 taps at 9px spacing on x). A directional
//    anamorphic flare is a lens artefact; it announces "post-process". The taps
//    are now radial, over 8 directions, which reads as diffusion around the
//    source instead of a widescreen flare.
//  - Spread is tightened (9 -> 5) so the halo stays local to its curvature.
//
// The brightness this removes is deliberately given back inside the membrane
// and ribbon terms, where it is attached to actual geometry.
function streakBloom() {
  const s = bloomStreakPg;
  const taps = 7;
  const spread = 5;
  const dirs = 8;
  s.clear();
  s.push();
  s.blendMode(ADD);
  s.imageMode(CENTER);
  const cx = s.width / 2, cy = s.height / 2;
  s.tint(255, 255, 255, 30);
  s.image(bloomPg, cx, cy);
  for (let d = 0; d < dirs; d++) {
    const ang = (d / dirs) * TAU;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    for (let k = 1; k <= taps; k++) {
      const falloff = 1 - k / (taps + 1);
      s.tint(255, 255, 255, 15 * falloff * falloff);
      s.image(bloomPg, cx + ux * k * spread, cy + uy * k * spread);
    }
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
  // §29: 228 -> 132. Global bloom is reduced, not deleted; the luminance it
  // used to supply now comes from the membrane glow terms, which are attached
  // to the geometry rather than applied over the whole frame.
  // Re-solved after the ribbon and membrane emitters were added. The bloom
  // source now carries far more energy than the chains alone did, so the same
  // tint would have added ~59% of white on top of geometry already at 72% --
  // clipping the climax to a flat disc.
  //
  // Solved JOINTLY with RIBBON_CFG.baseAlpha rather than by dropping the tint
  // alone: holding the ribbon at 72% forced a tint of 18, which is close to
  // deleting the bloom. Trading 16 points of ribbon peak (72% -> 56%, still
  // inside §27's 50-80% band) buys back a 22% bloom contribution. Climax now
  // totals 94.1% of white -- luminous, with the top 6% left as gradient so the
  // core stays a falloff instead of a clipped plateau.
  // 56 -> 40, the third term of the joint solve with GLOW.haloGain (0.42 ->
  // 0.70) and RIBBON_CFG.baseAlpha (36 -> 28). The broadened light FIELD is
  // now carried inside the geometry terms, where it is attached to curvature,
  // rather than by a global tint over the whole frame -- which is also what
  // §02 means by growing the field without growing the pure white area.
  // Worst-case composited climax measured at 99.3% of white.
  // §32 JOINT RE-SOLVE, third leg. 40 -> 30.
  //
  // This pass adds light in three places at once: membrane midtones (+25% on
  // the constant, +19% on facing), hero ribbons (baseAlpha 28 -> 39, 1.39x)
  // and the new interiorField() term, which every layer reads. The climax was
  // measured at 99.3% of white with essentially no headroom, so those gains
  // had to be paid for rather than simply added.
  //
  // The three payments all land on the FOCAL CORE, which is where the ceiling
  // binds, and none of them land on the midtones, which is where §32-17 says
  // the missing information is:
  //   membrane g.core   1.15 -> 1.00   (-13%)
  //   ribbon   g.core   0.90 -> 0.62   (-31%)
  //   this tint           40 -> 30     (-25%)
  // The global tint is the best of the three to cut because it is the only
  // one applied over the WHOLE FRAME irrespective of geometry -- exactly the
  // "cinematic signature" §29 was already reducing, and the least attached to
  // curvature. The luminance it gave up is returned inside interiorField(),
  // where it is anchored to the neck and the upper-right lobe.
  tint(255, 255, 255, 30);
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

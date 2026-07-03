# PLAN: Ceva's Theorem Simulator (20260703b)

> Planned by: Opus on 2026-07-03
> Implement with: Sonnet. Follow tasks in order. Check boxes as you go.

## 1. Goal

A p5.js WEBGL math-simulator Reel, same production pattern as `20260703/` (Hilbert
Space) and `20260604` lineage (Lissajous): a flat 2D triangle with three cevians
meeting at a moving interior point P, rendered inside a WEBGL buffer for glow/bloom,
composited with HUD text panels (top: title + formula, bottom: live ratio readout +
bar-style stat), grain, vignette. Loop is exactly 10s at 60fps, seamless (frame 0 ≡
frame LOOP_FRAMES). Recording via existing mp4-muxer + WebCodecs pipeline, R key
starts/stops, S key saves PNG. Canvas is 1080×1920 (9:16 Reel).

Done when: opening `index.html` in a browser shows a triangle with three cevians
converging at a point that sweeps a closed elliptical path inside the triangle, the
on-screen ratio product reads ~1.000 every frame, the loop is seamless, and pressing
R produces a 10s MP4 at 1080×1920.

## 2. Constraints & decisions (final — do not revisit)

- **Stack / files**: new folder `20260703b/` (sibling to today's `20260703/` Hilbert
  Space sketch, since that folder is already occupied) — `index.html`, `sketch.js`.
  Copy the recording/HUD/composite scaffolding verbatim from `20260703/sketch.js`
  and `20260703/index.html`; only the scene-specific math/drawing functions and HUD
  text differ.
- **Render mode**: flat 2D triangle drawn as a WEBGL plane (z=0 for all geometry),
  NOT a true 3D generalization. WEBGL is used purely for the glow/bloom buffer
  pipeline (`pg`, `glowPg`, half/quarter/eighth downsample) and a subtle static
  camera tilt — confirmed with user, this keeps the classical 2D theorem intact.
- **Camera**: near-orthographic, slight fixed tilt (no orbit — orbiting would rotate
  the triangle out of a legible "flat diagram" read, undesirable for a theorem
  diagram). `camera(0, -140, 900, 0, 0, 0, 0, 1, 0)` with `perspective(0.55, W/H, 10, 4000)`.
  This is static across the whole loop (not animated) — no periodicity concern.
- **Animation driver**: point P orbits inside the triangle via a closed barycentric
  path (derived in §3). Triangle vertices are FIXED for the whole loop (per user's
  choice: "cevian point P orbits", not "triangle morphs").
- **Resolution / FPS / duration**: 1080×1920, 60fps, **LOOP_FRAMES = 600 (10.0s
  exactly)**, MAX_DURATION = 10, MAX_FRAMES = 600 (single loop per recording — no
  extra buffer seconds, since the loop itself is the deliverable).
- **Palette (revised after visual review)**: background stays near-black
  `BG_R,BG_G,BG_B = 3,3,5`; triangle edges + orbit trail + P stay neutral white
  `255,255,255`. Cevians are color-coded per user request for legibility, tied to
  the matching HUD ratio label:
  - Cevian A-D (ratio BD/DC): cyan `#00E5FF` → rgb(0,229,255)
  - Cevian B-E (ratio CE/EA): magenta `#FF3DBF` → rgb(255,61,191)
  - Cevian C-F (ratio AF/FB): acid-green `#B6FF3D` → rgb(182,255,61)
  HUD ratio text for each label uses the matching color at readable alpha so the
  diagram and the numbers form one legible system.
- **Naming / export**: MP4 filename `ceva_theorem_<timestamp>.mp4`, PNG
  `ceva_theorem_<timestamp>.png` (swap the `hilbert_space_` prefix used in the
  source file for `ceva_theorem_`).
- **Font**: same as Hilbert Space HUD — `ui-monospace, "SF Mono", Menlo, Consolas,
  monospace`, drawn via `overlayPg.drawingContext` (raw canvas 2D API), ASCII-only
  text (no Unicode math glyphs — proven unreliable per DEVLOG lesson in `20260703/`).

## 3. Math & formulas (derived — transcribe verbatim)

### 3.1 Triangle vertices (world space, WEBGL plane, z=0)

Fixed equilateral-ish triangle sized to read clearly in the scene zone (between HUD
top/bottom strips). Use the same `HUD_TOP_H=280`, `HUD_BOT_H=400` strip heights as
Hilbert Space, so the visible scene band is `y ∈ [280, 1520]` px, center py=900.

World-space (WEBGL buffer, origin at canvas center, y-down flipped to y-up by p5
convention — WEBGL y is already screen-down-positive in p5, i.e. +y is DOWN on
screen, matching 2D canvas convention):

```
TRI_SCALE = 520   // circumradius-ish, px
A = ( 0,        -TRI_SCALE * 0.62,  0)   // apex, above center
B = (-TRI_SCALE * 0.58,  TRI_SCALE * 0.42, 0)   // base-left
C = ( TRI_SCALE * 0.58,  TRI_SCALE * 0.42, 0)   // base-right
```

(Deliberately NOT perfectly equilateral — a slightly irregular scalene-ish triangle
makes it visually obvious the theorem holds for *any* triangle, not just symmetric
ones. The 0.62 / 0.58 / 0.42 asymmetry is intentional.) These three points do not
move during the loop.

Screen offset: apply the same `worldOffset` vertical-centering trick as
`prepCamera()` in the source file (recompute `sceneMidPx`/`canvasMidPx` for THIS
scene — reuse verbatim, constants HUD_TOP_H/HUD_BOT_H are unchanged so the offset
formula is unchanged).

### 3.2 Barycentric coordinates of P (the derivation)

Let P = αA + βB + γC with the constraint **α + β + γ = 1**, all three > 0 (interior
point). This constraint means P always lies in the plane through A,B,C — no need to
re-derive concurrency per frame, it's true **by construction** for every (α,β,γ)
satisfying the constraint.

**Why this matters for the animation**: instead of computing three independent
cevian lines and checking if they happen to concur (they generally wouldn't), we
pick P directly in barycentric form. This *guarantees* AD, BE, CF meet at P every
single frame, so the theorem is demonstrated by construction, and the ratio product
is identically 1.000 (not just numerically close) at every frame — this is the
correct way to build the animation, not a simplification of it.

**Closed orbit path for (α,β,γ), period = LOOP_FRAMES, exactly seamless:**

Project onto the 2-simplex plane (α+β+γ=1) using two orthonormal in-plane basis
vectors:
```
u = (1/√2, -1/√2, 0)
v = (1/√6,  1/√6, -2/√6)
```
(These are the standard orthonormal basis for the plane α+β+γ=0, i.e. the tangent
plane of the simplex, verified: u·v=0, |u|=|v|=1, both ⊥ (1,1,1).)

Orbit, with loop phase `t = TAU * loop` (loop = frame/LOOP_FRAMES ∈ [0,1)):
```
r = 0.24          // orbit radius in barycentric space — keeps α,β,γ ∈ (0.02, 0.65), safely > 0
α(t) = 1/3 + r * ( cos(t) * u.x + sin(t) * v.x )
β(t) = 1/3 + r * ( cos(t) * u.y + sin(t) * v.y )
γ(t) = 1/3 + r * ( cos(t) * u.z + sin(t) * v.z )
```
Both `cos(t)` and `sin(t)` use **integer k=1** — one full revolution per loop,
exactly periodic, frame 0 ≡ frame LOOP_FRAMES (satisfies the project's seamless-loop
requirement, see `verify-loop-seamlessness` convention).

Numeric range check (r=0.24, worst case when cos or sin = ±1): each coordinate's
deviation from 1/3 is at most `r * max(|u_i|,|v_i|) ≈ 0.24 * 0.816 ≈ 0.196`, so
coordinates range roughly **[0.137, 0.529]** in the worst single-axis pull — safely
bounded away from 0 and 1 (no near-degenerate cevian, no visual "snapping" to a
vertex). Confirm this numerically in code with a console.assert or just trust the
derivation; no runtime clamping needed since the bound is proven.

P in world space: `P = A.mult(α) + B.mult(β) + C.mult(γ)` componentwise:
```
Px = α*A.x + β*B.x + γ*C.x
Py = α*A.y + β*B.y + γ*C.y
```

### 3.3 Cevian feet (D, E, F) and ratios

```
D = (β*B + γ*C) / (β+γ)     // on BC, foot of cevian from A through P
E = (γ*C + α*A) / (γ+α)     // on CA, foot of cevian from B through P
F = (α*A + β*B) / (α+β)     // on AB, foot of cevian from C through P

BD/DC = γ/β
CE/EA = α/γ
AF/FB = β/α

product = (γ/β) * (α/γ) * (β/α)   // = 1 identically — display this each frame
```
Compute `product` from the actual ratios (not hardcode `1.0`) so the HUD proves the
theorem live — floating point will show e.g. `1.0000` or `0.99999997`, both correct
and honest.

### 3.4 Parameter table

| name | range | default/value | unit |
|---|---|---|---|
| TRI_SCALE | fixed | 520 | px |
| r (orbit radius, barycentric) | fixed | 0.24 | barycentric units |
| LOOP_FRAMES | fixed | 600 | frames (10.0s @ 60fps) |
| α, β, γ | (0.137, 0.529) each, sum=1 | — | barycentric |
| camera perspective FOV | fixed | 0.55 | radians |
| camera distance | fixed | 900 | px (z) |

## 4. Architecture / structure

Copy `20260703/sketch.js` and `20260703/index.html` into new folder `20260703b/` as
the starting point, then replace scene-specific parts. Keep identical: canvas/buffer
setup in `setup()`, `bakeGrain()`, `compositeFrame()`, `drawVignette()`, all
recording functions (`startRecording`/`stopRecording`/`captureFrame`/
`updateRecordingUi`/`setStatus`/`ts`), `keyReleased()` (just rename PNG filename
prefix), math helpers (`smoothstep`/`clamp01`/`clamp`), `fogAlpha` (unused — may
delete, triangle has no depth fog).

Replace:
- `HILBERT` constants object → `CEVA` constants object: `{ TRI_SCALE: 520, ORBIT_R: 0.24 }`
- `initHilbertSpace()` → `initTriangle()`: compute A, B, C once (module-level `let A, B, C`), store as `{x,y,z:0}` objects.
- `getPsi(t)` → `getBary(loop)`: returns `{a, b, g}` (α,β,γ) per §3.2 formula.
- `innerProduct` → delete (not needed).
- `renderHilbertScene` → `renderCevaScene(loop, phase, bary, P, D, E, F)`:
  - `prepCameraStatic(g)`: fixed camera per §2 (no per-frame animation — call once
    per pg per frame is fine, it's just deterministic, but no orbit math needed).
  - `drawTriangleEdges(g, isGlow)`: three `g.line()` calls A-B, B-C, C-A.
  - `drawCevians(g, P, D, E, F, isGlow)`: three `g.line()` calls A-D, B-E, C-F, each
    through P (draw as A→P→D two segments, or A→D single line — P lies on it exactly
    by construction, single line A-D is correct and simpler).
  - `drawVertexMarkers(g, isGlow)`: small spheres at A, B, C, D, E, F, and P (P
    brightest — it's the theorem's subject).
  - `drawOrbitTrail(g, loop, isGlow)`: faint trace of P's path over the full loop
    (precompute ~120 points of the ellipse once in `initTriangle`, draw as static
    dotted line — this is a fixed closed curve, not time-dependent, safe to draw
    every frame identically).
- `drawBasisAxes`, `drawStateVector`, `drawProjectionLines`, `drawSubspaceRings`,
  `drawAmplitudeParticles`, `drawDust` → delete (no analog; Ceva scene is much
  simpler, no particle field needed — this is a clean geometric diagram, not a
  particle sim).
- `drawHUD(loop, psi, coefs)` → `drawHUD(loop, bary, ratios, product)`:
  - Top strip title: `"CEVA'S THEOREM"` / subtitle `"CONCURRENT CEVIAN SIMULATOR"`.
  - Top formula row: `"BD/DC * CE/EA * AF/FB = 1"` (ASCII, ~20px, matches source
    sizing/alpha).
  - Second formula row: live values, e.g.
    `"BD/DC=0.732  CE/EA=1.847  AF/FB=0.740   product=1.000"` (4 decimal places
    recommended for `product` specifically, to visually prove it's not just rounded
    to 1 — e.g. `product=0.99998` reads as more convincing proof than `1.0000`).
  - Loop progress bar: reuse verbatim (`pbX/pbY/pbW/pbH` unchanged).
  - Bottom strip: replace the 16-bar amplitude spectrum with a **single large
    numeric readout** of `product` (big monospace number, ~64px, centered) plus a
    small three-row breakdown of the individual ratios below it (each ~18px). This
    replaces `nBars`/`barSlot` loop entirely — simpler bottom panel since there's
    only one scalar quantity to show, not 16.
  - Footer row: reuse verbatim layout (barycentric coords left-aligned instead of
    psi, date+title right-aligned: `"20260703  CEVA'S THEOREM"`).
- `compositeFrame`, `drawVignette`, `bakeGrain`: **unchanged, copy verbatim.**

### File map
```
20260703b/
├── index.html   (copy of 20260703/index.html; title + button label text only differ)
└── sketch.js    (per replacements above)
```

## 5. Tasks (ordered, checkable)

- [x] 1. Create `20260703b/` folder; copy `20260703/index.html` → update `<title>`,
      status hint text, PNG button filename prefix (`ceva_theorem_`). Copy
      `20260703/sketch.js` as starting point for the new `sketch.js`.
- [x] 2. Strip Hilbert-specific scene code from the copied `sketch.js`: delete
      `HILBERT` const, `basisVecs`/`stateParticles`/`dustParticles`/`subspaceRings`
      module vars, `initHilbertSpace`, `getPsi`, `innerProduct`, `fogAlpha`,
      `drawBasisAxes`, `drawStateVector`, `drawProjectionLines`,
      `drawSubspaceRings`, `drawAmplitudeParticles`, `drawDust`. Keep everything
      else (recording, composite, grain, vignette, math helpers, setup buffer
      creation).
- [x] 3. Add `CEVA` constants object and module vars `let A, B, C, orbitTrailPts`.
      Implement `initTriangle()` per §3.1 (fixed A/B/C) — call it from `setup()`
      where `initHilbertSpace()` used to be called. Precompute `orbitTrailPts`: loop
      `i` from 0 to 119, `loop = i/120`, compute bary via §3.2 formula, convert to
      world P, push `{x,y}` — store once, reused every frame for the trail.
- [x] 4. Implement `getBary(loop)` per §3.2 exactly (u, v basis vectors, r=0.24,
      integer-k trig). Implement `baryToWorld(a,b,g)` helper: `{x: a*A.x+b*B.x+g*C.x,
      y: a*A.y+b*B.y+g*C.y, z: 0}`. Implement `computeCevianFeet(bary)` returning
      `{D,E,F}` per §3.3, and `computeRatios(bary)` returning `{bdDc, ceEa, afFb,
      product}`.
- [x] 5. Set `LOOP_FRAMES = FPS * 10` (10s exact), `MAX_DURATION = 10`,
      `MAX_FRAMES = FPS * MAX_DURATION`. Confirm `LOOP_FRAMES === MAX_FRAMES` (single
      full loop per recording, per §2).
- [x] 6. Implement `prepCameraStatic(g)`: fixed `perspective(0.55, W/H, 10, 4000)` +
      `camera(0, -140, 900, 0, worldOffset, 0, 0, 1, 0)` where `worldOffset` reuses
      the vertical-centering derivation from the source `prepCamera` (HUD_TOP_H=280,
      HUD_BOT_H=400 unchanged, so the formula is identical — just drop the
      `camAngle`/`camTilt` orbit terms, camera position is constant every frame).
- [x] 7. Implement `drawTriangleEdges`, `drawCevians`, `drawVertexMarkers`,
      `drawOrbitTrail` per §4, modeled on the glow/sharp dual-pass style of
      `drawBasisAxes`/`drawStateVector` in the source (same alpha/strokeWeight
      pattern: low alpha + thick stroke for `isGlow=true` pass in `glowPg`, higher
      alpha + thin stroke for `isGlow=false` pass in `pg`).
- [x] 8. Implement `renderCevaScene(loop, phase, bary, P, D, E, F)` replacing
      `renderHilbertScene`, calling the 4 draw functions above in both glow and
      sharp passes (same push/pop/blendMode structure as source).
- [x] 9. Rewrite `drawHUD` per §4's HUD spec (title, formula rows, single big
      product readout, ratio breakdown, footer). Keep `HUD_TOP_H`/`HUD_BOT_H`,
      corner brackets, separator lines, progress bar all verbatim from source.
- [x] 10. Update `draw()`: compute `bary = getBary(loop)`, `P = baryToWorld(...)`,
      `{D,E,F} = computeCevianFeet(bary)`, `ratios = computeRatios(bary)`; call
      `renderCevaScene(...)`, `drawHUD(loop, bary, ratios)`, `drawVignette()`,
      `compositeFrame()` — same structure as source `draw()`.
- [x] 11. Update `keyReleased` PNG filename and `startRecording`/`stopRecording`
      download filename prefixes to `ceva_theorem_`.
- [x] 12. Verification pass — see §6. Confirmed via headless-browser CDP checks:
      no console errors, triangle fully visible in frame after TRI_SCALE fix,
      point P animates smoothly, per-cevian colors render correctly and match
      HUD labels, product reads 1.00000 at multiple loop positions.

## 6. Verification

1. Serve via existing dev server (`npm run dev`, port 3003) or open
   `20260703b/index.html` directly — dev server should already be running per
   project convention, do not relaunch it.
2. Visual check: a triangle (apex up, asymmetric per §3.1) with three thin cevian
   lines meeting at a single bright point P that sweeps a smooth closed elliptical
   path inside the triangle over 10s, never reaching an edge or vertex.
3. HUD check: top shows "CEVA'S THEOREM" + the formula row; bottom shows a large
   `product` number that stays within ~0.999–1.001 every frame (read it at a few
   scrubbed points, e.g. loop=0, 0.25, 0.5, 0.75).
4. Seamless-loop check (per project convention): numerically compare `getBary(0)`
   vs `getBary(1.0 - 1/LOOP_FRAMES)` → should be nearly identical to `getBary(0)`
   pattern (cos/sin at t=0 vs t=TAU-ε), confirms no snap at the wrap. Since both
   trig terms use integer k=1, this is true by construction — spot check is enough,
   full numeric diff not required.
5. Recording check: press R, let it run the full 10s (600 frames), confirm it
   auto-stops at MAX_FRAMES, produces `ceva_theorem_<timestamp>.mp4` at 1080×1920,
   file plays back smoothly and loops seamlessly when replayed back-to-back.
6. No console errors (check for `smoothstep undefined`-style crashes per project's
   `verify-webgl-sketch-render` lesson — this sketch reuses the same helper
   functions verbatim so should not recur, but confirm).

## 7. Out of scope

- No true 3D tetrahedron generalization (explicitly declined by user).
- No orbiting/animated camera (static camera chosen so the triangle reads as a
  legible flat diagram, not a rotating 3D object).
- No morphing triangle shape (P orbits, vertices are fixed — per user's explicit
  choice).
- No UI sliders/interactivity beyond the existing R/S key + button controls.

## Deviations

- **2026-07-03, palette**: original plan specified monochrome-only cevians. After
  headless-browser visual verification, user requested per-cevian color coding for
  legibility. Applied: cevian A-D = cyan `rgb(0,229,255)`, B-E = magenta
  `rgb(255,61,191)`, C-F = acid-green `rgb(182,255,61)`; feet D/E/F and the matching
  HUD ratio labels recolored to match. Triangle edges, orbit trail, and P stay
  neutral white. See revised §2 palette entry.
- **2026-07-03, TRI_SCALE**: the plan's derived `TRI_SCALE=520` did not account for
  the actual camera FOV (0.55 rad) / distance (900) combination, which yields only
  ~3.78 px per world unit at z=0. At TRI_SCALE=520 the triangle's apex rendered
  above the visible band (behind the top HUD strip), confirmed via headless-browser
  screenshot. Recomputed: visible band is 1240px tall (H - HUD_TOP_H - HUD_BOT_H),
  target triangle vertical span ~700px of that for margin → **TRI_SCALE=185**
  (was 520). All other §3 formulas (barycentric math, ratios) are scale-invariant
  and required no change.

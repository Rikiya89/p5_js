#ifdef GL_ES
precision highp float;
#endif

varying vec2 vTexCoord;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

/* ──────────────────────────────────────────────
   3D Simplex Noise — Ashima Arts (Ian McEwan)
   ────────────────────────────────────────────── */
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
  + i.y + vec4(0.0, i1.y, i2.y, 1.0))
  + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x2d = x_ * ns.x + ns.yyyy;
  vec4 y2d = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x2d) - abs(y2d);

  vec4 b0 = vec4(x2d.xy, y2d.xy);
  vec4 b1 = vec4(x2d.zw, y2d.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

/* ──────────────────────────────────────────────
   Fractional Brownian Motion (3 octaves)
   ────────────────────────────────────────────── */
float fbm(vec3 p) {
  float value = 0.0;
  float amp = 0.55;
  float freq = 1.0;
  for (int i = 0; i < 3; i++) {
    value += amp * snoise(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return value;
}

/* ──────────────────────────────────────────────
   Color Palette
   ────────────────────────────────────────────── */
vec3 getColor(int idx) {
  if (idx == 0) return vec3(0.212, 0.176, 0.471);  // #362d78
  if (idx == 1) return vec3(0.322, 0.247, 0.639);  // #523fa3
  if (idx == 2) return vec3(0.569, 0.424, 0.800);  // #916ccc
  if (idx == 3) return vec3(0.741, 0.631, 0.898);  // #bda1e5
  if (idx == 4) return vec3(0.784, 0.753, 0.914);  // #c8c0e9
  if (idx == 5) return vec3(0.518, 0.729, 0.906);  // #84bae7
  if (idx == 6) return vec3(0.318, 0.416, 0.831);  // #516ad4
  if (idx == 7) return vec3(0.200, 0.247, 0.529);  // #333f87
  return vec3(0.212, 0.176, 0.471);
}

/* ──────────────────────────────────────────────
   Main
   ────────────────────────────────────────────── */
void main() {
  vec2 uv = vTexCoord;
  float aspect = u_resolution.x / u_resolution.y;

  // Scale and aspect-correct the coordinates
  float scale = 3.5;
  vec2 pos = vec2(uv.x * aspect, uv.y) * scale;

  float t = u_time * 0.04;

  // ── Domain warping: distort coordinates with noise ──
  // First warp layer
  float wx1 = snoise(vec3(pos * 0.7, t + u_seed));
  float wy1 = snoise(vec3(pos * 0.7 + 50.0, t + u_seed + 100.0));
  vec2 warp1 = vec2(wx1, wy1) * 1.3;

  // Second warp layer for extra organic feel
  float wx2 = snoise(vec3((pos + warp1) * 0.5, t * 0.7 + u_seed + 200.0));
  float wy2 = snoise(vec3((pos + warp1) * 0.5 + 30.0, t * 0.7 + u_seed + 300.0));
  vec2 warp2 = vec2(wx2, wy2) * 0.6;

  vec2 warpedPos = pos + warp1 + warp2;

  // ── Compute noise field ──
  float n = fbm(vec3(warpedPos, u_time * 0.06 + u_seed));
  n = n * 0.5 + 0.5;
  n = clamp(n, 0.0, 1.0);

  // ── Contour lines ──
  float numContours = 35.0;
  float bands = n * numContours;
  float bandFrac = fract(bands);
  float distToEdge = min(bandFrac, 1.0 - bandFrac);

  // Line profile — sharp center with soft glow
  float lineWidth = 0.14;
  float line = 1.0 - smoothstep(0.0, lineWidth, distToEdge);

  // Soft glow around each contour line
  float glow = exp(-distToEdge * 12.0) * 0.3;
  float brightness = max(line, glow);
  brightness = pow(brightness, 0.75);

  // ── Color selection ──
  int colorIdx = int(mod(floor(bands), 8.0));
  vec3 lineColor = getColor(colorIdx);

  // Brighten toward white for more vivid lines
  lineColor = mix(lineColor, vec3(0.82, 0.86, 1.0), 0.22);

  // Subtle brightness variation from secondary noise
  float brightVar = snoise(vec3(warpedPos * 0.4, u_seed + 500.0));
  lineColor *= 0.85 + brightVar * 0.15;

  // ── Compose final color ──
  vec3 bg = vec3(0.01, 0.01, 0.025);
  vec3 col = mix(bg, lineColor, brightness);

  // Subtle vignette
  vec2 vigUV = uv - 0.5;
  float vig = 1.0 - dot(vigUV, vigUV) * 0.5;
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}

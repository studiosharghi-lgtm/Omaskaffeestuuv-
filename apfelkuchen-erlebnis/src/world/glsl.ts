/** Noise and helpers shared by the procedural materials, the backdrop and the steam. */
export const NOISE_GLSL = /* glsl */ `
#ifndef PROC_NOISE
#define PROC_NOISE

vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }

float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }

// 2D simplex noise (Ashima Arts, MIT)
vec3 permute3(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// 3D value noise (smooth, cheap)
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash21(i.xy + i.z * 57.0);
  float n100 = hash21(i.xy + vec2(1.0, 0.0) + i.z * 57.0);
  float n010 = hash21(i.xy + vec2(0.0, 1.0) + i.z * 57.0);
  float n110 = hash21(i.xy + vec2(1.0, 1.0) + i.z * 57.0);
  float n001 = hash21(i.xy + (i.z + 1.0) * 57.0);
  float n101 = hash21(i.xy + vec2(1.0, 0.0) + (i.z + 1.0) * 57.0);
  float n011 = hash21(i.xy + vec2(0.0, 1.0) + (i.z + 1.0) * 57.0);
  float n111 = hash21(i.xy + vec2(1.0, 1.0) + (i.z + 1.0) * 57.0);
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z) * 2.0 - 1.0;
}

// fbm with footprint fade: octaves finer than a pixel are faded out to avoid shimmer
float fbm2(vec2 p, float fw) {
  float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 5; i++) {
    s += a * snoise(p * f) * (1.0 - smoothstep(0.25, 0.6, fw * f));
    f *= 2.03; a *= 0.5;
  }
  return s;
}

float fbm3(vec3 p, float fw) {
  float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p * f) * (1.0 - smoothstep(0.25, 0.6, fw * f));
    f *= 2.07; a *= 0.5;
  }
  return s;
}

// Worley: x = distance to nearest feature, y = to second nearest, z = cell id
vec3 voronoi2(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash21(n + g); }
    else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

vec3 voronoi3(vec3 x) {
  vec3 n = floor(x);
  vec3 f = fract(x);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int k = -1; k <= 1; k++)
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 o = hash33(n + g);
    vec3 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = hash21((n + g).xy + (n + g).z * 7.13); }
    else if (d < d2) { d2 = d; }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}

#endif
`;

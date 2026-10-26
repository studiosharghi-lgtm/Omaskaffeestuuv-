/*
 * One composite pass for everything on the stage. Footage and the 3D render share the same
 * grade, vignette and grain, which is what makes the cut between them hard to see.
 */

export const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const depthHelpers = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uAperture;
uniform float uMaxBlur;

float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
}

// Circle of confusion in full-resolution pixels (thin lens: proportional to dioptric distance).
float cocPx(float depth) {
  return clamp(abs(1.0 / uFocus - 1.0 / depth) * uAperture, 0.0, uMaxBlur);
}
`;

/** Half-resolution bokeh blur (single-pass scatter-as-gather, after D. Gustafsson). */
export const dofFragment = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uStep;
varying vec2 vUv;
${depthHelpers}

void main() {
  float cd = viewDepth(vUv);
  float cs = cocPx(cd);
  vec3 col = texture2D(tScene, vUv).rgb;
  float tot = 1.0;
  float fg = 0.0;
  float fgN = 0.0;
  float radius = uStep;
  float ang = 0.0;
  for (int i = 0; i < 160; i++) {
    if (radius >= uMaxBlur) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec3 sc = texture2D(tScene, tc).rgb;
    float sd = viewDepth(tc);
    float ss = cocPx(sd);
    if (sd > cd) ss = clamp(ss, 0.0, cs * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, ss);
    col += mix(col / tot, sc, m);
    tot += 1.0;
    if (sd < cd - 0.005) { fg += m; fgN += 1.0; }
    radius += uStep / radius;
    ang += 2.39996323;
  }
  float bleed = fgN > 0.0 ? clamp(fg / fgN * 1.6, 0.0, 1.0) : 0.0;
  gl_FragColor = vec4(col / tot, bleed);
}
`;

export const compositeFragment = /* glsl */ `
uniform sampler2D tFootA;
uniform sampler2D tFootB;
uniform vec4 uRectA;
uniform vec4 uRectB;
uniform vec3 uGradeA;
uniform vec3 uGradeB;
uniform float uMixAB;
uniform float uHasA;
uniform float uHasB;

uniform sampler2D tScene;
uniform sampler2D tDof;
uniform float uSceneMix;
uniform float uUseDof;
uniform float uExposure;

uniform sampler2D tSteam;
uniform float uSteam;
uniform float uSteamLod;

uniform vec2 uResolution;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform vec3 uMatte;
uniform float uWarmth;

varying vec2 vUv;
${depthHelpers}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Khronos PBR Neutral: keeps the hues of golden crust and caramel instead of bending them yellow.
vec3 neutralTonemap(vec3 color) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

vec3 gradeClip(vec3 c, vec3 g) {
  c *= g.x;
  c *= 1.0 + g.y * vec3(0.16, 0.03, -0.17);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), c, g.z), 0.0);
}

vec3 footage(sampler2D tex, vec4 rect, vec3 g) {
  vec2 suv = rect.xy + vUv * rect.zw;
  // distance beyond the frame's edge in screen units (negative inside the frame)
  vec2 over = max(-suv, suv - 1.0) / rect.zw;
  // Where a still does not fill the screen on an axis (landscape photo on a portrait screen),
  // it dissolves into the matte just inside its edge, instead of smearing its edge pixels.
  vec2 letterbox = smoothstep(1.0, 1.06, rect.zw);
  vec2 fade = mix(smoothstep(0.0, 0.05, over), smoothstep(-0.08, 0.0, over), letterbox);
  vec3 c = gradeClip(texture2D(tex, clamp(suv, vec2(0.001), vec2(0.999))).rgb, g);
  return mix(c, uMatte * g.x, max(fade.x, fade.y));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = uMatte;
  if (uHasA > 0.5) col = footage(tFootA, uRectA, uGradeA);
  if (uHasB > 0.5) col = mix(col, footage(tFootB, uRectB, uGradeB), uMixAB);

  if (uSceneMix > 0.001) {
    vec3 sc = texture2D(tScene, vUv).rgb;
    if (uUseDof > 0.5) {
      vec4 blurred = texture2D(tDof, vUv);
      float coc = cocPx(viewDepth(vUv));
      sc = mix(sc, blurred.rgb, max(smoothstep(0.6, 2.4, coc), blurred.a));
    }
    sc = neutralTonemap(sc * uExposure);
    col = mix(col, sc, uSceneMix);
  }

  if (uSteam > 0.001) {
    vec4 s = texture2D(tSteam, vUv, uSteamLod);
    col = col * (1.0 - s.a * uSteam) + s.rgb * uSteam;
  }

  // shared grade: gentle S-curve, warm shadows, cooler nothing
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += (col - l) * 0.04;
  col = mix(col, col * vec3(1.06, 1.0, 0.9), uWarmth);
  col = clamp(col, 0.0, 1.0);
  col = col * col * (3.0 - 2.0 * col) * 0.22 + col * 0.78;

  vec2 q = (vUv - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float v = smoothstep(1.25, 0.35, length(q) * 1.15);
  col *= mix(1.0, v, uVignette);

  vec3 outc = linearToSrgb(clamp(col, 0.0, 1.0));
  float n = hash12(floor(gl_FragCoord.xy) + fract(uTime * 7.31) * 913.0) - 0.5;
  outc += n * uGrain * (1.0 - outc * 0.6);
  gl_FragColor = vec4(outc, 1.0);
}
`;

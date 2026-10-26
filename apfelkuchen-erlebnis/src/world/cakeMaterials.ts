import { DoubleSide } from 'three';
import { proceduralMaterial } from './procedural';
import { CAKE } from './dimensions';

const R = CAKE.radius.toFixed(4);
const H = CAKE.height.toFixed(4);

/** Golden sponge side, caramelised top edge and glazed top between the apples. */
export function crustMaterial() {
  return proceduralMaterial(
    {
      name: 'crust',
      bump: 0.9,
      surface: /* glsl */ `
        float r = length(P.xz);
        float top = smoothstep(0.55, 0.85, N.y);
        float edge = smoothstep(${H} - 0.012, ${H} - 0.002, P.y);
        float bottom = 1.0 - smoothstep(0.0, 0.006, P.y);

        // pores of the sponge, faded out where they would be smaller than a pixel
        float aa1 = 1.0 - smoothstep(0.3, 0.9, FW * 900.0);
        float aa2 = 1.0 - smoothstep(0.3, 0.9, FW * 320.0);
        vec3 cell = voronoi3(P * 900.0);
        float pore = (1.0 - smoothstep(0.0, 0.28, cell.x)) * aa1;
        vec3 cellB = voronoi3(P * 320.0 + 7.0);
        float poreB = (1.0 - smoothstep(0.0, 0.22, cellB.x)) * aa2;
        float mottle = fbm3(P * 140.0, FW * 140.0);
        float ridges = fbm3(P * 420.0 + 5.0, FW * 420.0);

        vec3 sponge = mix(srgb(vec3(0.88, 0.69, 0.43)), srgb(vec3(0.70, 0.49, 0.27)), clamp(0.5 + 0.7 * mottle + 0.35 * ridges, 0.0, 1.0));
        sponge = mix(sponge, srgb(vec3(0.58, 0.40, 0.21)), pore * 0.55 + poreB * 0.35);
        vec3 caramel = mix(srgb(vec3(0.66, 0.42, 0.20)), srgb(vec3(0.50, 0.29, 0.12)), 0.5 + 0.5 * fbm3(P * 90.0 + 3.0, FW * 90.0));
        vec3 glazeTop = mix(srgb(vec3(0.74, 0.50, 0.24)), srgb(vec3(0.56, 0.34, 0.14)), 0.5 + 0.5 * fbm3(P * 60.0 + 11.0, FW * 60.0));

        sponge *= 1.0 - 0.1 * (1.0 - aa1) - 0.06 * (1.0 - aa2);
        vec3 col = mix(sponge, caramel, edge * 0.85);
        col = mix(col, srgb(vec3(0.42, 0.24, 0.10)), bottom * 0.8);
        col = mix(col, glazeTop, top);

        o.albedo = col;
        o.rough = mix(mix(0.78, 0.92, pore), 0.38, top) - edge * 0.12;
        o.coat = top * 0.8 + edge * 0.3;
        o.height = (-pore * 0.00012 - poreB * 0.0002 + mottle * 0.00025 + ridges * 0.00012) * (1.0 - top * 0.6);
      `,
    },
    { clearcoat: 0.5, clearcoatRoughness: 0.35, sheen: 0.25, sheenRoughness: 0.6, sheenColor: 0xd9a05b },
  );
}

/**
 * The cut face: bottom crust, sponge base, apple chunks embedded in the dough, the fanned slices
 * on top and a thin glaze line. Depends only on radius and height, so both faces of a cut match.
 */
export function crumbMaterial() {
  return proceduralMaterial(
    {
      name: 'crumb',
      bump: 1.0,
      functions: /* glsl */ `
        // apple pieces in the (radius, height) plane, metres; cells about 1.3 cm
        vec3 appleChunks(vec2 q) {
          vec2 s = q * vec2(74.0, 88.0);
          s += vec2(snoise(q * 60.0), snoise(q * 60.0 + 13.0)) * 0.35;
          return voronoi2(s);
        }
      `,
      surface: /* glsl */ `
        float r = length(P.xz);
        float u = r / ${R};
        float y = P.y;
        vec2 q = vec2(r, y);

        float wob = snoise(vec2(r * 60.0, 3.1)) * 0.0015;
        float crustLine = 1.0 - smoothstep(0.003, 0.0048, y + wob);
        float baseTop = 0.0125 + snoise(vec2(r * 40.0, 7.7)) * 0.0025;
        float appleTop = ${H} - 0.0055 + snoise(vec2(r * 55.0, 1.3)) * 0.0014;
        float rimCrust = smoothstep(0.965, 0.995, u);

        // sponge with pores (faded below pixel size to avoid speckle)
        float aa1 = 1.0 - smoothstep(0.3, 0.9, FW * 1400.0);
        float aa2 = 1.0 - smoothstep(0.3, 0.9, FW * 520.0);
        vec3 pores = voronoi2(q * vec2(1400.0, 1500.0));
        float pore = (1.0 - smoothstep(0.05, 0.32, pores.x)) * aa1;
        vec3 poresB = voronoi2(q * vec2(520.0, 600.0) + 4.0);
        float poreB = (1.0 - smoothstep(0.0, 0.25, poresB.x)) * aa2;
        float mott = fbm2(q * 180.0, FW * 180.0);
        vec3 crumb = mix(srgb(vec3(0.93, 0.77, 0.53)), srgb(vec3(0.86, 0.68, 0.45)), 0.5 + 0.5 * mott);
        crumb = mix(crumb, srgb(vec3(0.66, 0.48, 0.29)), pore * 0.4 + poreB * 0.3);
        crumb *= 1.0 - 0.08 * (1.0 - aa1) - 0.05 * (1.0 - aa2);

        // the filling: tightly packed soft apple pieces between base and top
        vec3 ch = appleChunks(q);
        float inBand = smoothstep(baseTop - 0.0015, baseTop + 0.0025, y) * (1.0 - smoothstep(appleTop - 0.0025, appleTop + 0.0005, y));
        float chunk = (1.0 - smoothstep(0.4, 0.5, ch.x)) * inBand * step(0.12, ch.z);
        float core = 1.0 - smoothstep(0.0, 0.42, ch.x);
        vec3 apple = mix(srgb(vec3(0.80, 0.53, 0.25)), srgb(vec3(0.95, 0.76, 0.46)), core * 0.85);
        apple = mix(apple, srgb(vec3(0.9, 0.66, 0.36)), ch.z * 0.35);
        float syrup = inBand * (1.0 - chunk) * 0.55;

        // fanned slices on top, seen in section, and the glaze line
        float band = y - appleTop;
        float slices = smoothstep(-0.0005, 0.0008, band) * (1.0 - smoothstep(0.005, 0.007, band));
        float sliceLines = 0.5 + 0.5 * sin((band * 1150.0) + snoise(vec2(r * 90.0, 2.0)) * 2.5);
        vec3 topApple = mix(srgb(vec3(0.92, 0.70, 0.38)), srgb(vec3(0.76, 0.47, 0.2)), sliceLines);
        float skin = smoothstep(0.7, 0.95, fract(r * 38.0 + snoise(vec2(r * 30.0, 9.0)) * 0.3)) * slices;
        float glaze = smoothstep(0.005, 0.0062, band) * (1.0 - smoothstep(0.0078, 0.0098, band));

        vec3 col = crumb;
        col = mix(col, srgb(vec3(0.78, 0.52, 0.27)), syrup);
        col = mix(col, apple, chunk);
        col = mix(col, topApple, slices);
        col = mix(col, srgb(vec3(0.5, 0.11, 0.07)), skin * 0.85);
        col = mix(col, srgb(vec3(0.64, 0.38, 0.15)), glaze);
        col = mix(col, srgb(vec3(0.68, 0.45, 0.22)), crustLine * 0.9);
        col = mix(col, srgb(vec3(0.72, 0.5, 0.27)), rimCrust * 0.85);

        float wet = max(chunk, max(slices * 0.8, max(glaze, syrup * 0.6)));
        o.albedo = col;
        o.rough = mix(0.86 + pore * 0.08, 0.3, wet);
        o.coat = wet;
        // pieces bulge slightly out of the cut, the sponge has small pits
        o.height = chunk * core * 0.00045 - (pore * 0.00008 + poreB * 0.00014) * (1.0 - wet) + slices * 0.0001;
        o.emissive = col * wet * 0.035;
      `,
    },
    { clearcoat: 0.45, clearcoatRoughness: 0.3 },
  );
}

/** Fanned apple slices: amber flesh caramelised at the edges, a red skin band, glaze on top. */
export function appleSliceMaterial() {
  return proceduralMaterial(
    {
      name: 'apple-slice',
      bump: 0.7,
      surface: /* glsl */ `
        float rad = length(P.xy);
        float v = clamp((rad - ${CAKE.slice.inner.toFixed(4)}) / ${(CAKE.slice.outer - CAKE.slice.inner).toFixed(4)}, 0.0, 1.0);
        float ang = atan(P.y, P.x);
        float seed = hash21(SEED.xz * 113.0);
        float caramel = smoothstep(0.55, 1.0, abs(ang - 1.5708) / 0.95) * 0.6 + (1.0 - smoothstep(0.0, 0.25, v)) * 0.25;
        float fibres = snoise(vec2(ang * 30.0, v * 4.0 + seed * 10.0)) * 0.5 + 0.5;
        vec3 flesh = mix(srgb(vec3(0.84, 0.58, 0.27)), srgb(vec3(0.72, 0.43, 0.17)), fibres * 0.35 + seed * 0.3);
        flesh = mix(flesh, srgb(vec3(0.58, 0.29, 0.1)), caramel);
        float skin = smoothstep(0.86, 0.95, v);
        vec3 skinCol = mix(srgb(vec3(0.62, 0.12, 0.07)), srgb(vec3(0.38, 0.06, 0.04)), snoise(vec2(ang * 12.0, seed * 20.0)) * 0.5 + 0.5);
        o.albedo = mix(flesh, skinCol, skin);
        o.rough = mix(0.36, 0.42, skin) + fibres * 0.06;
        o.coat = 1.0;
        o.height = fibres * 0.00012 - skin * 0.0001;
        // light passing through thin cooked apple
        o.emissive = flesh * (1.0 - skin) * 0.02;
      `,
    },
    { clearcoat: 0.5, clearcoatRoughness: 0.3, side: DoubleSide },
  );
}

/** Crumbs scattered on table and plate. */
export function crumbBitsMaterial() {
  return proceduralMaterial(
    {
      name: 'crumb-bits',
      surface: /* glsl */ `
        float n = fbm3(P * 900.0 + SEED * 50.0, FW * 900.0);
        o.albedo = mix(srgb(vec3(0.86, 0.62, 0.32)), srgb(vec3(0.62, 0.38, 0.16)), 0.5 + 0.5 * n);
        o.rough = 0.85;
        o.coat = 0.0;
        o.height = n * 0.0003;
      `,
    },
    {},
  );
}

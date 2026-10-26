import { MeshPhysicalMaterial, type IUniform, type MeshPhysicalMaterialParameters } from 'three';
import { NOISE_GLSL } from './glsl';

export interface ProceduralSpec {
  /** Unique name; also the shader program cache key. */
  name: string;
  /**
   * GLSL statements filling `ProcOut o` from:
   *   vec3 P   – object-space position (metres)
   *   vec3 N   – object-space normal
   *   vec3 SEED – per-instance seed (instance translation, or 0)
   *   float FW – object-space size of one pixel (for anti-aliasing)
   * Fields: o.albedo (linear), o.rough, o.height (metres), o.coat, o.emissive.
   */
  surface: string;
  /** Extra GLSL functions used by `surface`. */
  functions?: string;
  uniforms?: Record<string, IUniform>;
  /** Strength of the height-derived bump. */
  bump?: number;
}

/**
 * A MeshPhysicalMaterial whose colour, roughness, clearcoat and relief are computed per pixel in
 * object space. No textures: detail stays crisp in close-ups, and two faces cut from the same
 * object (the slice and the cake it came from) show exactly the same crumb.
 */
export function proceduralMaterial(spec: ProceduralSpec, params: MeshPhysicalMaterialParameters = {}): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 0, ...params });
  const bump = (spec.bump ?? 1).toFixed(4);
  const uniformDecls = Object.keys(spec.uniforms ?? {})
    .map((name) => {
      const v = spec.uniforms![name].value;
      const type = typeof v === 'number' ? 'float' : v?.isVector3 ? 'vec3' : v?.isVector2 ? 'vec2' : v?.isColor ? 'vec3' : 'float';
      return `uniform ${type} ${name};`;
    })
    .join('\n');

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, spec.uniforms ?? {});
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vProcP;
varying vec3 vProcN;
varying vec3 vProcSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vProcP = position;
vProcN = normal;
#ifdef USE_INSTANCING
  vProcSeed = instanceMatrix[3].xyz;
#else
  vProcSeed = vec3(0.0);
#endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vProcP;
varying vec3 vProcN;
varying vec3 vProcSeed;
${uniformDecls}
${NOISE_GLSL}
struct ProcOut { vec3 albedo; float rough; float height; float coat; vec3 emissive; };
${spec.functions ?? ''}
ProcOut procSurface(vec3 P, vec3 N, vec3 SEED, float FW) {
  ProcOut o;
  o.albedo = vec3(0.8);
  o.rough = 1.0;
  o.height = 0.0;
  o.coat = 1.0;
  o.emissive = vec3(0.0);
  ${spec.surface}
  return o;
}
vec3 procPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float procFW = max(length(fwidth(vProcP)), 1e-6);
ProcOut proc = procSurface(vProcP, normalize(vProcN), vProcSeed, procFW);
diffuseColor.rgb *= proc.albedo;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor * proc.rough, 0.04, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  // height in metres → slope per pixel; scaled by the pixel footprint so relief reads the same at any distance
  vec2 dH = vec2(dFdx(proc.height), dFdy(proc.height)) / procFW;
  normal = procPerturb(-vViewPosition, normal, dH * ${bump}, faceDirection);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += proc.emissive;`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= proc.coat;
#endif`,
      );
  };
  material.customProgramCacheKey = () => `proc:${spec.name}`;
  return material;
}

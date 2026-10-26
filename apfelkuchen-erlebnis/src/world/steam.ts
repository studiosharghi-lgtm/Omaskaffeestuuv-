import { Group, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector3, type Camera } from 'three';
import { NOISE_GLSL } from './glsl';

/*
 * Rising steam: a few soft, camera-facing ribbons with noise advected upwards.
 * Rendered into its own layer and laid over footage or 3D, so it can also bring the
 * still placeholder photo of the fresh cake to life.
 */

const vertex = /* glsl */ `
  uniform vec3 uCamPos;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCam = uCamPos - base;
    toCam.y = 0.0;
    toCam = normalize(toCam);
    vec3 right = vec3(toCam.z, 0.0, -toCam.x);
    vec3 world = base + right * position.x * uSize.x + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * uSize.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const fragment = /* glsl */ `
  ${NOISE_GLSL}
  uniform float uTime;
  uniform float uSeed;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float t = uTime * 0.11 + uSeed * 9.0;
    float y = vUv.y;
    // slow lateral drift that grows with height
    float sway = (snoise(vec2(y * 1.1 - t * 0.55, uSeed * 7.0)) * 0.17 + snoise(vec2(y * 2.6 - t * 0.9, uSeed * 3.0)) * 0.05) * smoothstep(0.0, 1.0, y);
    float x = vUv.x - 0.5 - sway;
    // thin curling filaments: ridged noise, stretched upwards and advected
    vec2 q = vec2(x * 3.6, y * 1.5 - t * 1.15);
    float warp = snoise(q * 0.85 + uSeed) * 0.7;
    float ridge = 1.0 - abs(snoise(vec2(q.x * 1.6 + warp, q.y)));
    ridge = pow(ridge, 7.0);
    float body = 0.5 + 0.5 * fbm2(q * 0.7 + 3.0, 0.0);
    float d = ridge * (0.45 + 0.55 * body) + body * body * 0.08;
    // envelope: narrow over the source, spreading and dissolving as it rises
    float width = mix(0.07, 0.3, y);
    d *= exp(-(x * x) / (width * width) * 1.6);
    d *= smoothstep(0.0, 0.2, y) * (1.0 - smoothstep(0.3, 0.92, y));
    float a = clamp(d * uIntensity, 0.0, 1.0);
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export interface SteamSource {
  group: Group;
  materials: ShaderMaterial[];
}

function source(count: number, base: Vector3, spread: number, size: [number, number], seed: number): SteamSource {
  const group = new Group();
  const materials: ShaderMaterial[] = [];
  const geo = new PlaneGeometry(1, 1, 1, 1);
  for (let i = 0; i < count; i++) {
    const mat = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      premultipliedAlpha: true,
      blending: NormalBlending,
      uniforms: {
        uCamPos: { value: new Vector3() },
        uSize: { value: [size[0] * (0.8 + 0.4 * ((i * 0.37) % 1)), size[1] * (0.85 + 0.3 * ((i * 0.61) % 1))] },
        uTime: { value: 0 },
        uSeed: { value: seed + i * 1.618 },
        uIntensity: { value: 0 },
        uColor: { value: new Vector3(1, 0.97, 0.92) },
      },
    });
    const m = new Mesh(geo, mat);
    const a = (i / count) * Math.PI * 2 + seed;
    m.position.set(base.x + Math.cos(a) * spread * (0.3 + 0.7 * ((i * 0.53) % 1)), base.y, base.z + Math.sin(a) * spread * 0.6);
    m.frustumCulled = false;
    group.add(m);
    materials.push(mat);
  }
  return { group, materials };
}

export class Steam {
  readonly root = new Group();
  readonly cup: SteamSource;
  readonly cake: SteamSource;

  constructor(cupBase: Vector3, cakeBase: Vector3) {
    this.cup = source(4, cupBase, 0.01, [0.055, 0.19], 3.3);
    this.cake = source(5, cakeBase, 0.05, [0.12, 0.3], 11.7);
    this.root.add(this.cup.group, this.cake.group);
  }

  update(camera: Camera, time: number, cupIntensity: number, cakeIntensity: number, light: number): void {
    const pos = camera.getWorldPosition(new Vector3());
    const col = new Vector3(1, 0.96, 0.9).multiplyScalar(light);
    for (const [src, k] of [
      [this.cup, cupIntensity],
      [this.cake, cakeIntensity],
    ] as const) {
      src.group.visible = k > 0.001;
      for (const m of src.materials) {
        m.uniforms.uCamPos.value.copy(pos);
        m.uniforms.uTime.value = time;
        m.uniforms.uIntensity.value = k;
        m.uniforms.uColor.value.copy(col);
      }
    }
  }
}

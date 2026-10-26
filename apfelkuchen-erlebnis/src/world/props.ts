import {
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { proceduralMaterial } from './procedural';
import { crumbBitsMaterial } from './cakeMaterials';
import { NOISE_GLSL } from './glsl';
import { CAKE, CUP, PLATE } from './dimensions';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ table */

function woodMaterial() {
  return proceduralMaterial(
    {
      name: 'wood',
      bump: 1.0,
      surface: /* glsl */ `
        // PlaneGeometry in its own XY plane; planks run along x
        float plankW = 0.155;
        float py = P.y + 0.031;
        float id = floor(py / plankW);
        float f = fract(py / plankW);
        float seed = hash11(id * 7.31 + 1.7);
        vec2 q = vec2(P.x + seed * 3.7, py);

        float warp = fbm2(vec2(q.x * 0.8, q.y * 9.0) + seed * 11.0, FW * 9.0);
        float grain = 0.5 + 0.5 * sin(q.y * 135.0 + warp * 7.5 + seed * 30.0);
        float streak = 0.5 + 0.5 * fbm2(vec2(q.x * 1.8, q.y * 70.0) + seed * 5.0, FW * 70.0);
        float fibre = snoise(vec2(q.x * 45.0, q.y * 1100.0)) * (1.0 - smoothstep(0.2, 0.5, FW * 1100.0));
        float wear = smoothstep(0.25, 0.8, 0.5 + 0.5 * fbm2(q * vec2(1.4, 3.2) + 40.0, FW * 3.2));

        vec3 dark = srgb(vec3(0.24, 0.16, 0.105));
        vec3 mid = srgb(vec3(0.42, 0.30, 0.20));
        vec3 light = srgb(vec3(0.58, 0.45, 0.33));
        vec3 col = mix(dark, mid, smoothstep(0.15, 0.85, grain * 0.55 + streak * 0.6));
        col = mix(col, light, smoothstep(0.62, 0.95, streak) * 0.45);
        col *= 0.82 + seed * 0.32;
        col = mix(col, srgb(vec3(0.52, 0.46, 0.40)), wear * 0.3);

        float edge = min(f, 1.0 - f) * plankW;
        float seam = 1.0 - smoothstep(0.0006, 0.0028, edge);
        col = mix(col, dark * 0.25, seam);

        o.albedo = col;
        o.rough = 0.6 + streak * 0.12 + seam * 0.25 - wear * 0.06;
        o.coat = 0.25 * (1.0 - wear);
        o.height = fibre * 0.00005 + grain * 0.00012 - seam * 0.0016 - wear * 0.0001;
      `,
    },
    { clearcoat: 0.25, clearcoatRoughness: 0.5 },
  );
}

/* ------------------------------------------------------------------ background */

export function backdropMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBrightness: { value: 1 },
      uWindow: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      ${NOISE_GLSL}
      uniform float uBrightness;
      uniform float uWindow;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        // the far kitchen wall, already out of focus
        vec3 wall = mix(srgb(vec3(0.26, 0.2, 0.15)), srgb(vec3(0.5, 0.42, 0.34)), smoothstep(0.02, 0.75, uv.y));
        wall *= 0.85 + 0.15 * snoise(uv * vec2(3.0, 2.0));
        // window light from the left
        vec2 w = (uv - vec2(0.39, 0.6)) * vec2(1.25, 1.0);
        float win = exp(-dot(w, w) / 0.03);
        float winCore = exp(-dot(w, w) / 0.008);
        vec3 col = wall + srgb(vec3(1.0, 0.86, 0.66)) * (win * 1.6 + winCore * 2.4) * uWindow;
        // a few warm practical lights, they turn into bokeh
        for (int i = 0; i < 7; i++) {
          float fi = float(i);
          vec2 c = vec2(0.55 + 0.38 * hash11(fi * 3.1), 0.35 + 0.45 * hash11(fi * 7.7));
          float rad = 0.004 + 0.006 * hash11(fi * 1.9);
          float d = length((uv - c) * vec2(2.0, 1.0));
          col += srgb(vec3(1.0, 0.72, 0.42)) * smoothstep(rad, rad * 0.4, d) * (2.0 + 3.0 * hash11(fi * 5.3));
        }
        gl_FragColor = vec4(col * uBrightness, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------ props */

function cinnamonMaterial() {
  return proceduralMaterial(
    {
      name: 'cinnamon',
      bump: 1.2,
      surface: /* glsl */ `
        float ang = atan(P.z, P.x);
        float r = length(P.xz) / 0.0058;
        float fib = snoise(vec2(ang * 3.0, P.y * 650.0));
        float ridge = 0.5 + 0.5 * sin(ang * 13.0 + snoise(vec2(P.y * 90.0, ang * 2.0)) * 2.2);
        vec3 col = mix(srgb(vec3(0.40, 0.19, 0.085)), srgb(vec3(0.60, 0.33, 0.15)), fib * 0.3 + ridge * 0.4 + 0.15);
        // rolled bark visible at the ends
        float cap = smoothstep(0.85, 0.95, abs(N.y));
        float spiral = fract(r * 2.6 - (ang / 6.2831853));
        float roll = smoothstep(0.0, 0.08, spiral) * smoothstep(0.32, 0.22, spiral);
        col = mix(col, mix(srgb(vec3(0.55, 0.30, 0.14)), srgb(vec3(0.18, 0.08, 0.035)), 1.0 - roll), cap);
        o.albedo = col;
        o.rough = 0.82;
        o.coat = 0.0;
        o.height = (fib * 0.00008 + ridge * 0.00025) * (1.0 - cap) + roll * cap * 0.0003;
      `,
    },
    {},
  );
}

function appleSkinMaterial() {
  return proceduralMaterial(
    {
      name: 'apple-skin',
      bump: 0.5,
      surface: /* glsl */ `
        float ang = atan(P.z, P.x);
        float seed = hash21(SEED.xz * 31.0 + floor(P.y * 0.0));
        float streak = 0.5 + 0.5 * snoise(vec2(ang * 9.0, P.y * 35.0));
        float blush = smoothstep(-0.2, 0.7, sin(ang + 0.6) + snoise(vec2(ang * 2.0, P.y * 20.0)) * 0.5);
        vec3 col = mix(srgb(vec3(0.80, 0.62, 0.22)), srgb(vec3(0.62, 0.10, 0.06)), clamp(blush * 0.8 + streak * 0.35, 0.0, 1.0));
        vec3 len = voronoi3(P * 420.0);
        float dot2 = (1.0 - smoothstep(0.0, 0.12, len.x)) * step(0.55, len.z);
        col = mix(col, srgb(vec3(0.85, 0.72, 0.45)), dot2 * 0.6);
        float top = smoothstep(0.055, 0.068, P.y);
        col = mix(col, srgb(vec3(0.55, 0.45, 0.20)), top * 0.4);
        o.albedo = col;
        o.rough = 0.4;
        o.coat = 0.7;
        o.height = dot2 * 0.00004;
      `,
    },
    { clearcoat: 0.6, clearcoatRoughness: 0.35 },
  );
}

function appleGeometry(): LatheGeometry {
  const v = (r: number, y: number) => new Vector2(r, y);
  return new LatheGeometry(
    [
      v(0, 0.006),
      v(0.008, 0.0042),
      v(0.02, 0.0016),
      v(0.03, 0.006),
      v(0.0378, 0.016),
      v(0.0414, 0.03),
      v(0.0402, 0.044),
      v(0.0343, 0.0568),
      v(0.0243, 0.066),
      v(0.0142, 0.0694),
      v(0.0072, 0.0668),
      v(0.0022, 0.0618),
      v(0, 0.06),
    ],
    48,
  );
}

/* ------------------------------------------------------------------ contact shadows & sugar */

function blobTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.75, 'rgba(0,0,0,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

export function contactShadow(tex: CanvasTexture, size: number, opacity: number): Mesh {
  const m = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

function sugarTexture(): CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rand = seeded(424242);
  for (let i = 0; i < 2600; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.pow(rand(), 0.8) * size * 0.5;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r * 0.9;
    const fall = 1 - r / (size * 0.5);
    ctx.fillStyle = `rgba(255,255,255,${(0.25 + rand() * 0.6) * (0.35 + fall * 0.65)})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rand() * 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ assembly */

export interface PropsBuild {
  table: Mesh;
  backdrop: Mesh;
  group: Group;
  /** moving shadow under the slice */
  sliceShadow: Mesh;
  cakeShadow: Mesh;
  materials: Material[];
}

export function buildProps(maxAnisotropy: number): PropsBuild {
  const group = new Group();
  group.name = 'props';
  const blob = blobTexture();

  const wood = woodMaterial();
  const table = new Mesh(new PlaneGeometry(2.8, 1.8), wood);
  table.rotation.x = -Math.PI / 2;
  table.position.set(0.05, 0, -0.25);
  table.receiveShadow = true;
  group.add(table);

  const backdropMat = backdropMaterial();
  const backdrop = new Mesh(new PlaneGeometry(5.4, 2.6), backdropMat);
  backdrop.position.set(0.1, 1.15, -1.3);
  group.add(backdrop);

  // cinnamon sticks in front of the cake, as in the reference
  const cin = cinnamonMaterial();
  const stickGeo = new CylinderGeometry(0.0058, 0.0058, 0.092, 28, 1, false);
  const sticks = [
    { p: new Vector3(-0.215, 0.0058, 0.13), yaw: 0.42 },
    { p: new Vector3(-0.204, 0.0058, 0.1435), yaw: 0.36 },
    { p: new Vector3(0.2, 0.0058, 0.07), yaw: -0.9 },
  ];
  for (const s of sticks) {
    const m = new Mesh(stickGeo, cin);
    m.rotation.set(0, s.yaw, Math.PI / 2, 'YXZ');
    m.position.copy(s.p);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // whole apples further back, they end up as soft shapes behind the cake
  const skin = appleSkinMaterial();
  const appleGeo = appleGeometry();
  const stemMat = new MeshStandardMaterial({ color: new Color('#4a3020'), roughness: 0.8 });
  const stemGeo = new TubeGeometry(
    new CatmullRomCurve3([new Vector3(0, 0.058, 0), new Vector3(0.001, 0.07, 0.0005), new Vector3(0.004, 0.079, 0.001)]),
    8,
    0.0016,
    6,
    false,
  );
  const apples = [
    { p: new Vector3(-0.36, 0, -0.27), s: 1.0, r: 0.4 },
    { p: new Vector3(-0.27, 0, -0.41), s: 0.95, r: 2.1 },
    { p: new Vector3(0.62, 0, -0.38), s: 1.05, r: 1.0 },
  ];
  for (const a of apples) {
    const apple = new Group();
    const body = new Mesh(appleGeo, skin);
    body.castShadow = body.receiveShadow = true;
    const stem = new Mesh(stemGeo, stemMat);
    apple.add(body, stem);
    apple.position.copy(a.p);
    apple.scale.setScalar(a.s);
    apple.rotation.y = a.r;
    group.add(apple);
    const sh = contactShadow(blob, 0.11 * a.s, 0.6);
    sh.position.set(a.p.x, 0.0004, a.p.z);
    group.add(sh);
  }

  // crumbs on the table and the plate
  const rand = seeded(1999);
  const crumbs: Matrix4[] = [];
  const q = new Quaternion();
  const e = new Vector3();
  for (let i = 0; i < 46; i++) {
    const onPlate = i < 14;
    let x: number, z: number, y: number;
    if (onPlate) {
      const a = rand() * Math.PI * 2;
      const r = 0.035 + rand() * 0.05;
      x = PLATE.position.x + Math.cos(a) * r;
      z = PLATE.position.z + Math.sin(a) * r * 0.9;
      y = PLATE.wellHeight;
    } else {
      const a = 0.4 + rand() * 2.3;
      const r = CAKE.radius + 0.015 + rand() * 0.12;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = 0;
    }
    const s = 0.0012 + rand() * rand() * 0.003;
    q.setFromAxisAngle(e.set(rand(), rand(), rand()).normalize(), rand() * 6.28);
    crumbs.push(new Matrix4().compose(new Vector3(x, y + s * 0.5, z), q, new Vector3(s * (0.8 + rand() * 0.6), s * (0.6 + rand() * 0.5), s)));
  }
  const crumbMesh = new InstancedMesh(new IcosahedronGeometry(1, 1), crumbBitsMaterial(), crumbs.length);
  crumbs.forEach((m, i) => crumbMesh.setMatrixAt(i, m));
  crumbMesh.castShadow = true;
  crumbMesh.receiveShadow = true;
  group.add(crumbMesh);

  // contact shadows: the soft dark line where things touch the table
  const cakeShadow = contactShadow(blob, 0.34, 0.5);
  cakeShadow.position.set(0, 0.0004, 0);
  group.add(cakeShadow);
  const plateShadow = contactShadow(blob, 0.25, 0.42);
  plateShadow.position.set(PLATE.position.x, 0.0004, PLATE.position.z);
  group.add(plateShadow);
  const saucerShadow = contactShadow(blob, 0.17, 0.5);
  saucerShadow.position.set(CUP.position.x, 0.0004, CUP.position.z);
  group.add(saucerShadow);
  const sliceShadow = contactShadow(blob, 0.15, 0.0);
  group.add(sliceShadow);

  // powdered sugar dusted over the plate
  const sugar = new Mesh(
    new CircleGeometry(0.088, 48),
    new MeshStandardMaterial({ map: sugarTexture(), transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  sugar.rotation.x = -Math.PI / 2;
  sugar.position.set(PLATE.position.x, PLATE.wellHeight + 0.0002, PLATE.position.z);
  (sugar.material as MeshStandardMaterial).map!.anisotropy = maxAnisotropy;
  sugar.receiveShadow = true;
  group.add(sugar);

  return {
    table,
    backdrop,
    group,
    sliceShadow,
    cakeShadow,
    materials: [wood, backdropMat, cin, skin, stemMat, crumbMesh.material as Material],
  };
}

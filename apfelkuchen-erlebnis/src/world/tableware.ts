import {
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { proceduralMaterial } from './procedural';
import { CUP, PLATE } from './dimensions';

const v2 = (r: number, y: number) => new Vector2(r, y);

/* ------------------------------------------------------------------ materials */

/** Grey stoneware with iron speckles and a brown, thinly glazed rim (as in the reference photo). */
function plateMaterial() {
  return proceduralMaterial(
    {
      name: 'plate-glaze',
      bump: 0.6,
      surface: /* glsl */ `
        float r = length(P.xz);
        float front = step(0.0, N.y);
        vec3 sp = voronoi3(P * 520.0);
        float speck = (1.0 - smoothstep(0.0, 0.11, sp.x)) * step(0.55, sp.z);
        vec3 sp2 = voronoi3(P * 180.0 + 3.0);
        float speck2 = (1.0 - smoothstep(0.0, 0.07, sp2.x)) * step(0.7, sp2.z);
        float pool = fbm3(P * 40.0, FW * 40.0);
        vec3 glaze = mix(srgb(vec3(0.60, 0.57, 0.52)), srgb(vec3(0.50, 0.47, 0.43)), 0.5 + 0.5 * pool);
        float rim = smoothstep(0.088, 0.097, r);
        vec3 rimCol = mix(srgb(vec3(0.42, 0.28, 0.17)), srgb(vec3(0.60, 0.42, 0.26)), smoothstep(0.1, 0.106, r));
        vec3 col = mix(glaze, rimCol, rim);
        col = mix(col, srgb(vec3(0.70, 0.62, 0.52)), (1.0 - front) * 0.5);
        col = mix(col, srgb(vec3(0.20, 0.13, 0.08)), speck * 0.8 + speck2 * 0.6);
        o.albedo = col;
        o.rough = mix(0.42, 0.62, rim) + pool * 0.05;
        o.coat = mix(0.9, 0.4, rim);
        o.height = -speck * 0.00006 + pool * 0.00008;
      `,
    },
    { clearcoat: 0.55, clearcoatRoughness: 0.22 },
  );
}

/** Brown speckled cup and saucer glaze; lighter where the glaze thins at the rim, cream inside. */
function cupMaterial(withInside = true) {
  return proceduralMaterial(
    {
      name: withInside ? 'cup-glaze' : 'cup-glaze-outer',
      bump: 0.5,
      surface: /* glsl */ `
        float r = length(P.xz);
        float inner = ${withInside ? 'step(dot(N.xz, P.xz), -0.0000001)' : '0.0'};
        vec3 sp = voronoi3(P * 600.0);
        float speck = (1.0 - smoothstep(0.0, 0.1, sp.x)) * step(0.5, sp.z);
        float drip = fbm3(vec3(P.x * 30.0, P.y * 6.0, P.z * 30.0), FW * 30.0);
        vec3 outer = mix(srgb(vec3(0.55, 0.37, 0.23)), srgb(vec3(0.43, 0.27, 0.16)), 0.5 + 0.5 * drip);
        float thin = smoothstep(0.066, 0.0725, P.y) + smoothstep(0.0068, 0.0, P.y) * 0.6;
        outer = mix(outer, srgb(vec3(0.78, 0.62, 0.45)), thin * 0.75);
        vec3 innerCol = srgb(vec3(0.86, 0.79, 0.67));
        vec3 col = mix(outer, innerCol, inner);
        col = mix(col, srgb(vec3(0.18, 0.11, 0.07)), speck * 0.7);
        o.albedo = col;
        o.rough = 0.36 + drip * 0.06;
        o.coat = 0.9;
        o.height = drip * 0.00008 - speck * 0.00005;
      `,
    },
    { clearcoat: 0.6, clearcoatRoughness: 0.18 },
  );
}

/* ------------------------------------------------------------------ latte art */

function latteTexture(maxAnisotropy: number): CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  // crema: darker towards the wall
  const crema = ctx.createRadialGradient(c, c, 0, c, c, c);
  crema.addColorStop(0, '#a87c55');
  crema.addColorStop(0.62, '#9a6c46');
  crema.addColorStop(0.86, '#7a5133');
  crema.addColorStop(1, '#4f331f');
  ctx.fillStyle = crema;
  ctx.fillRect(0, 0, size, size);

  // fine bubbles in the crema
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * c * 0.98;
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '240,220,190' : '90,50,25'}, ${0.05 + Math.random() * 0.08})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 0.6 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // rosetta in microfoam: stacked leaves, smaller towards the top, pulled through by a thin line
  if ('filter' in ctx) ctx.filter = 'blur(2.2px)';
  const foam = '#f4e8d6';
  ctx.fillStyle = foam;
  ctx.strokeStyle = foam;
  ctx.lineCap = 'round';
  const leaves = 9;
  for (let i = 0; i < leaves; i++) {
    const t = i / (leaves - 1);
    const y = c + size * (0.27 - t * 0.5);
    const w = size * (0.26 - t * 0.17);
    const h = size * (0.075 - t * 0.03);
    const thick = size * (0.035 - t * 0.018);
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(c - w, y - h);
    ctx.quadraticCurveTo(c - w * 0.55, y + h * 0.75, c, y + h * 0.35);
    ctx.quadraticCurveTo(c + w * 0.55, y + h * 0.75, c + w, y - h);
    ctx.stroke();
  }
  // small heart on top
  ctx.beginPath();
  ctx.ellipse(c, c - size * 0.255, size * 0.035, size * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  // base blob
  ctx.beginPath();
  ctx.ellipse(c, c + size * 0.31, size * 0.12, size * 0.05, 0, 0, Math.PI * 2);
  ctx.fill();
  // pull-through line
  ctx.lineWidth = size * 0.007;
  ctx.beginPath();
  ctx.moveTo(c, c - size * 0.29);
  ctx.lineTo(c, c + size * 0.36);
  ctx.stroke();
  if ('filter' in ctx) ctx.filter = 'none';

  // brown veins where foam meets crema
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#8a5a34';
  ctx.lineWidth = 2;
  for (let i = 0; i < leaves; i++) {
    const t = i / (leaves - 1);
    const y = c + size * (0.27 - t * 0.5);
    const w = size * (0.26 - t * 0.17);
    ctx.beginPath();
    ctx.moveTo(c - w * 0.9, y - size * 0.06);
    ctx.quadraticCurveTo(c, y + size * 0.03, c + w * 0.9, y - size * 0.06);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/* ------------------------------------------------------------------ geometry */

function plateGeometry(): LatheGeometry {
  const w = PLATE.wellHeight;
  const pts = [
    v2(0.0, 0.0024),
    v2(0.054, 0.0024),
    v2(0.056, 0.0),
    v2(0.062, 0.0),
    v2(0.066, 0.0032),
    v2(0.08, 0.0056),
    v2(0.095, 0.0089),
    v2(0.1045, 0.0119),
    v2(0.106, 0.0133),
    v2(0.1055, 0.0146),
    v2(0.104, 0.0152),
    v2(0.1012, 0.0148),
    v2(0.097, 0.0127),
    v2(0.09, 0.0096),
    v2(0.08, w + 0.0007),
    v2(0.068, w),
    v2(0.0, w),
  ];
  return new LatheGeometry(pts, 112);
}

function cupGeometry(): LatheGeometry {
  const pts = [
    v2(0.0, 0.0035),
    v2(0.024, 0.0035),
    v2(0.026, 0.0),
    v2(0.03, 0.0),
    v2(0.0318, 0.0022),
    v2(0.0342, 0.0085),
    v2(0.0392, 0.021),
    v2(0.0428, 0.0345),
    v2(0.0452, 0.0498),
    v2(0.0462, 0.062),
    v2(0.0465, 0.0702),
    v2(0.0461, 0.0729),
    v2(0.0451, 0.0739),
    v2(0.0439, 0.0733),
    v2(0.0433, 0.0712),
    v2(0.0431, 0.065),
    v2(0.0419, 0.05),
    v2(0.0393, 0.0345),
    v2(0.0352, 0.0205),
    v2(0.0288, 0.0112),
    v2(0.018, 0.0076),
    v2(0.0, 0.007),
  ];
  return new LatheGeometry(pts, 96);
}

function saucerGeometry(): LatheGeometry {
  const pts = [
    v2(0.0, 0.002),
    v2(0.033, 0.002),
    v2(0.035, 0.0),
    v2(0.04, 0.0),
    v2(0.055, 0.0045),
    v2(0.07, 0.0088),
    v2(0.0738, 0.0112),
    v2(0.0732, 0.0123),
    v2(0.0718, 0.0125),
    v2(0.068, 0.0108),
    v2(0.055, 0.0068),
    v2(0.04, 0.0054),
    v2(0.036, CUP.saucerTop),
    v2(0.0, CUP.saucerTop),
  ];
  return new LatheGeometry(pts, 96);
}

function handleGeometry(): TubeGeometry {
  const curve = new CatmullRomCurve3([
    new Vector3(0.0425, 0.057, 0),
    new Vector3(0.056, 0.0615, 0),
    new Vector3(0.0665, 0.053, 0),
    new Vector3(0.0672, 0.037, 0),
    new Vector3(0.0585, 0.0262, 0),
    new Vector3(0.0395, 0.0245, 0),
  ]);
  return new TubeGeometry(curve, 48, 0.0047, 14, false);
}

/** A three-tined cake fork; the left tine is widened into a cutting edge. */
function forkGeometry(): ExtrudeGeometry {
  const s = new Shape();
  s.moveTo(0, -0.0052);
  s.quadraticCurveTo(-0.004, 0, 0, 0.0052);
  s.lineTo(0.088, 0.0034);
  s.quadraticCurveTo(0.104, 0.0026, 0.116, 0.0098);
  s.lineTo(0.128, 0.0112);
  s.lineTo(0.158, 0.0105);
  s.quadraticCurveTo(0.161, 0.0098, 0.158, 0.0076);
  s.lineTo(0.134, 0.0068);
  s.lineTo(0.133, 0.0051);
  s.lineTo(0.159, 0.0046);
  s.quadraticCurveTo(0.1615, 0.0035, 0.159, 0.0026);
  s.lineTo(0.133, 0.0021);
  s.lineTo(0.132, 0.0004);
  s.lineTo(0.158, -0.0004);
  s.quadraticCurveTo(0.161, -0.0016, 0.158, -0.0026);
  s.lineTo(0.134, -0.0036);
  s.lineTo(0.134, -0.0052);
  s.lineTo(0.156, -0.0068);
  s.quadraticCurveTo(0.162, -0.0098, 0.152, -0.0112);
  s.lineTo(0.128, -0.0118);
  s.lineTo(0.116, -0.0104);
  s.quadraticCurveTo(0.104, -0.0028, 0.088, -0.0034);
  s.lineTo(0, -0.0052);
  const geo = new ExtrudeGeometry(s, { depth: 0.0013, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelSegments: 2, curveSegments: 10 });
  // gentle bend: handle and head rise from the neck
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const bendHead = Math.max(0, x - 0.11);
    const bendHandle = Math.max(0, 0.05 - x);
    pos.setZ(i, pos.getZ(i) + bendHead * bendHead * 2.2 + bendHandle * bendHandle * 1.6);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ assembly */

export interface TablewareBuild {
  plate: Group;
  cup: Group;
  fork: Mesh;
  coffee: Mesh;
  materials: Material[];
}

export function buildTableware(maxAnisotropy: number): TablewareBuild {
  const plateMat = plateMaterial();
  const cupMat = cupMaterial(true);
  cupMat.side = DoubleSide;
  const glazeMat = cupMaterial(false);

  const plate = new Group();
  plate.name = 'plate';
  const plateMesh = new Mesh(plateGeometry(), plateMat);
  plateMesh.castShadow = plateMesh.receiveShadow = true;
  plate.add(plateMesh);
  plate.position.copy(PLATE.position);

  const fork = new Mesh(
    forkGeometry(),
    new MeshPhysicalMaterial({ color: 0xe4ded4, metalness: 1, roughness: 0.27, envMapIntensity: 1.7 }),
  );
  fork.castShadow = fork.receiveShadow = true;
  fork.rotation.x = -Math.PI / 2;
  fork.rotation.z = 0.5;
  fork.position.set(-0.045, PLATE.wellHeight + 0.0009, 0.075);
  plate.add(fork);

  const cup = new Group();
  cup.name = 'cup';
  const saucer = new Mesh(saucerGeometry(), glazeMat);
  const body = new Mesh(cupGeometry(), cupMat);
  body.position.y = CUP.saucerTop;
  const handle = new Mesh(handleGeometry(), glazeMat);
  handle.position.y = CUP.saucerTop;
  handle.rotation.y = -0.55;
  body.rotation.y = 0;
  const coffee = new Mesh(
    new CircleGeometry(0.0433, 72),
    new MeshStandardMaterial({ map: latteTexture(maxAnisotropy), roughness: 0.42, metalness: 0 }),
  );
  coffee.rotation.x = -Math.PI / 2;
  coffee.rotation.z = 0.35;
  coffee.position.y = CUP.saucerTop + CUP.coffeeLevel;
  for (const m of [saucer, body, handle]) m.castShadow = m.receiveShadow = true;
  coffee.receiveShadow = true;
  cup.add(saucer, body, handle, coffee);
  cup.position.copy(CUP.position);

  return {
    plate,
    cup,
    fork,
    coffee,
    materials: [plateMat, cupMat, glazeMat, fork.material as Material, coffee.material as Material],
  };
}

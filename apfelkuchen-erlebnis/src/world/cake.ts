import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  Plane,
  Quaternion,
  Shape,
  ShapeUtils,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { CAKE, WEDGE_CENTER_ANGLE } from './dimensions';
import { appleSliceMaterial, crumbMaterial, crustMaterial } from './cakeMaterials';

/*
 * A homemade apple cake built from one radial profile swept around the axis, with gentle
 * irregularities. The first slice is a separate solid from the start, aligned so the cake looks
 * whole; both solids share the surface function, so the seam is invisible until the slice moves.
 */

type Part = 'axis-bottom' | 'bottom' | 'side' | 'top' | 'axis-top';
interface ProfilePoint {
  r: number;
  y: number;
  part: Part;
  /** outward normal of the undisturbed profile (r, y) */
  nr: number;
  ny: number;
}

const { radius: R, height: H, dome, topBevel: TB, bottomBevel: BB } = CAKE;

function baseProfile(): ProfilePoint[] {
  const pts: ProfilePoint[] = [{ r: 0, y: 0, part: 'axis-bottom', nr: 0, ny: -1 }];
  const bottomSteps = 9;
  for (let i = 1; i <= bottomSteps; i++) {
    pts.push({ r: ((R - BB) * i) / bottomSteps, y: 0, part: 'bottom', nr: 0, ny: -1 });
  }
  for (let i = 1; i <= 4; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / 4);
    pts.push({ r: R - BB + Math.cos(a) * BB, y: BB + Math.sin(a) * BB, part: 'side', nr: Math.cos(a), ny: Math.sin(a) });
  }
  const sideSteps = 10;
  for (let i = 1; i < sideSteps; i++) {
    pts.push({ r: R, y: BB + ((H - TB - BB) * i) / sideSteps, part: 'side', nr: 1, ny: 0 });
  }
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI / 2) * (i / 8);
    pts.push({ r: R - TB + Math.cos(a) * TB, y: H - TB + Math.sin(a) * TB, part: i < 5 ? 'side' : 'top', nr: Math.cos(a), ny: Math.sin(a) });
  }
  const topSteps = 16;
  for (let i = 1; i < topSteps; i++) {
    const r = (R - TB) * (1 - i / topSteps);
    const s = r / (R - TB);
    const y = H + dome * (1 - s * s);
    const slope = (-2 * dome * s) / (R - TB);
    const len = Math.hypot(slope, 1);
    pts.push({ r, y, part: 'top', nr: -slope / len, ny: 1 / len });
  }
  pts.push({ r: 0, y: H + dome, part: 'axis-top', nr: 0, ny: 1 });
  return pts;
}

const PROFILE = baseProfile();

/** Relative radius change around the cake: a homemade cake is never perfectly round. */
function bulge(theta: number, y: number): number {
  const b =
    0.0055 * Math.sin(3 * theta + 0.7) +
    0.0038 * Math.sin(5 * theta + 2.1) +
    0.0024 * Math.sin(8 * theta + 4.0) +
    0.0012 * Math.sin(13 * theta + 1.0);
  return b * (0.75 + 0.5 * (y / H));
}

/** Height variation of the top surface. */
function topRelief(theta: number, r: number): number {
  const s = r / R;
  return (0.0011 * Math.sin(4 * theta + r * 40) + 0.0007 * Math.sin(7 * theta - r * 60 + 1.3) + 0.0005 * Math.sin(11 * theta + 2.2)) * s;
}

/** Height of the top surface at (theta, r); used to seat the apple slices. */
export function topHeight(theta: number, r: number): number {
  const s = Math.min(1, r / (R - TB));
  return H + dome * (1 - s * s) + topRelief(theta, r);
}

function surfacePoint(theta: number, p: ProfilePoint, out: Vector3): Vector3 {
  const r = p.r * (1 + bulge(theta, p.y) * (p.r / R));
  const y = p.y + (p.part === 'top' || p.part === 'axis-top' ? topRelief(theta, p.r) : 0);
  return out.set(r * Math.cos(theta), y, r * Math.sin(theta));
}

/** Outer surface (bottom, side, top) for theta in [a, b]. */
function sweep(a: number, b: number): BufferGeometry {
  const segs = Math.max(2, Math.round(((b - a) / (Math.PI * 2)) * 144));
  const n = PROFILE.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const P = new Vector3();
  const A = new Vector3();
  const B = new Vector3();
  const Tt = new Vector3();
  const Tp = new Vector3();
  const N = new Vector3();
  const ref = new Vector3();
  const eps = 1e-4;

  for (let i = 0; i <= segs; i++) {
    const theta = a + ((b - a) * i) / segs;
    for (let k = 0; k < n; k++) {
      const p = PROFILE[k];
      surfacePoint(theta, p, P);
      positions.push(P.x, P.y, P.z);
      if (p.part === 'axis-bottom') {
        normals.push(0, -1, 0);
        continue;
      }
      if (p.part === 'axis-top') {
        normals.push(0, 1, 0);
        continue;
      }
      surfacePoint(theta + eps, p, A);
      surfacePoint(theta - eps, p, B);
      Tt.subVectors(A, B);
      surfacePoint(theta, PROFILE[Math.min(n - 1, k + 1)], A);
      surfacePoint(theta, PROFILE[Math.max(0, k - 1)], B);
      Tp.subVectors(A, B);
      N.crossVectors(Tt, Tp).normalize();
      ref.set(p.nr * Math.cos(theta), p.ny, p.nr * Math.sin(theta));
      if (N.dot(ref) < 0) N.negate();
      // blend towards the reference at sharp transitions to avoid seams between parts
      N.lerp(ref, 0.15).normalize();
      normals.push(N.x, N.y, N.z);
    }
  }

  const index: number[] = [];
  for (let i = 0; i < segs; i++) {
    for (let k = 0; k < n - 1; k++) {
      const a0 = i * n + k;
      const a1 = (i + 1) * n + k;
      index.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setIndex(orient(index, positions, normals));
  geo.computeBoundingSphere();
  return geo;
}

/** Flat cut face at angle theta, facing `outward`. */
function cap(theta: number, outward: Vector3): BufferGeometry {
  const P = new Vector3();
  const contour: Vector2[] = [];
  const pts3: Vector3[] = [];
  for (const p of PROFILE) {
    surfacePoint(theta, p, P);
    const r = Math.hypot(P.x, P.z);
    const last = contour[contour.length - 1];
    if (last && Math.abs(last.x - r) < 1e-7 && Math.abs(last.y - P.y) < 1e-7) continue;
    contour.push(new Vector2(r, P.y));
    pts3.push(new Vector3(r * Math.cos(theta), P.y, r * Math.sin(theta)));
  }
  const tris = ShapeUtils.triangulateShape(contour, []);
  const positions: number[] = [];
  const normals: number[] = [];
  const e1 = new Vector3();
  const e2 = new Vector3();
  for (const [i0, i1, i2] of tris) {
    let a = pts3[i0];
    let b = pts3[i1];
    let c = pts3[i2];
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    if (e1.cross(e2).dot(outward) < 0) [b, c] = [c, b];
    for (const v of [a, b, c]) {
      positions.push(v.x, v.y, v.z);
      normals.push(outward.x, outward.y, outward.z);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** Make every triangle wind counter-clockwise around its stored normal. */
function orient(index: number[], pos: number[], nor: number[]): number[] {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const out: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const [i0, i1, i2] = [index[t], index[t + 1], index[t + 2]];
    a.fromArray(pos, i0 * 3);
    b.fromArray(pos, i1 * 3);
    c.fromArray(pos, i2 * 3);
    n.fromArray(nor, i0 * 3).add(new Vector3().fromArray(nor, i1 * 3)).add(new Vector3().fromArray(nor, i2 * 3));
    const face = b.sub(a).cross(c.sub(a));
    if (face.lengthSq() < 1e-16) continue; // degenerate at the axis
    if (face.dot(n) < 0) out.push(i0, i2, i1);
    else out.push(i0, i1, i2);
  }
  return out;
}

/* ------------------------------------------------------------------ apple slices on top */

function appleSliceGeometry(): ExtrudeGeometry {
  const { outer, inner, span, thickness } = CAKE.slice;
  const a0 = Math.PI / 2 - span / 2;
  const a1 = Math.PI / 2 + span / 2;
  const shape = new Shape();
  shape.moveTo(Math.cos(a0) * outer, Math.sin(a0) * outer);
  shape.absarc(0, 0, outer, a0, a1, false);
  shape.lineTo(Math.cos(a1) * inner, Math.sin(a1) * inner);
  shape.absarc(0, 0, inner, a1, a0, true);
  shape.closePath();
  const geo = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.0009,
    bevelSize: 0.0008,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geo.translate(0, 0, -thickness / 2);
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

interface AppleInstance {
  matrix: Matrix4;
  angle: number;
  halfWidth: number;
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The apple fan: slices stand radially in the batter, skin edge up, each one leaning on its
 * neighbour (like the reference photo). Two rings and a small rosette in the middle.
 */
function appleLayout(): AppleInstance[] {
  const rand = seeded(19990731);
  const { outer } = CAKE.slice;
  const rings = [
    { radius: 0.094, count: 30, scale: 1.0, lean: 1.22, sink: 0.0085, offset: 0.0 },
    { radius: 0.048, count: 17, scale: 0.84, lean: 1.24, sink: 0.0078, offset: 0.11 },
    { radius: 0.007, count: 6, scale: 0.5, lean: 1.28, sink: 0.006, offset: 0.4 },
  ];
  const out: AppleInstance[] = [];
  const basis = new Matrix4();
  const lean = new Matrix4();
  const radial = new Vector3();
  const up = new Vector3(0, 1, 0);
  const tangent = new Vector3();
  const pos = new Vector3();
  const q = new Quaternion();
  const scl = new Vector3();

  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const phi = ring.offset + (i / ring.count) * Math.PI * 2 + (rand() - 0.5) * 0.05;
      const s = ring.scale * (0.94 + rand() * 0.12);
      radial.set(Math.cos(phi), 0, Math.sin(phi));
      tangent.set(-Math.sin(phi), 0, Math.cos(phi));
      // local X (chord) → radial, local Y (core → skin) → up, local Z (thickness) → along the ring
      basis.makeBasis(radial, up, tangent);
      // lean along the ring, rotating about the radial axis
      lean.makeRotationAxis(radial, -(ring.lean + (rand() - 0.5) * 0.12));
      basis.premultiply(lean);
      q.setFromRotationMatrix(basis);
      // a slight outward tip so the skin edges catch the light
      q.premultiply(new Quaternion().setFromAxisAngle(tangent, 0.06 + rand() * 0.05));

      const r = ring.radius;
      const y = topHeight(phi, Math.max(0, r)) - ring.sink * s;
      pos.set(radial.x * r, y, radial.z * r);
      scl.setScalar(s);
      out.push({
        matrix: new Matrix4().compose(pos, q, scl),
        angle: phi,
        halfWidth: Math.atan2(outer * s * 0.6, Math.max(0.012, r)) + 0.02,
      });
    }
  }
  return out;
}

function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ------------------------------------------------------------------ assembly */

export interface CakeBuild {
  root: Group;
  body: Group;
  /** Moves the slice; positioned at the slice centroid. */
  slicePivot: Group;
  slice: Group;
  /** Centroid of the slice in cake coordinates. */
  centroid: Vector3;
  centerAngle: number;
  /** Keep the clipping of apple slices that cross the cut in sync with the moving slice. */
  updateClipping(): void;
  materials: Material[];
  setVisible(v: boolean): void;
}

export function buildCake(): CakeBuild {
  const crust = crustMaterial();
  const crumb = crumbMaterial();
  const apple = appleSliceMaterial();
  const centerAngle = WEDGE_CENTER_ANGLE;
  const t0 = centerAngle - CAKE.wedgeAngle / 2;
  const t1 = centerAngle + CAKE.wedgeAngle / 2;

  const root = new Group();
  root.name = 'cake';
  const body = new Group();
  body.name = 'cake-body';
  root.add(body);

  // body: everything except the wedge
  const bodyOuter = new Mesh(sweep(t1, t0 + Math.PI * 2), crust);
  const bodyCapA = new Mesh(cap(t1, new Vector3(Math.sin(t1), 0, -Math.cos(t1))), crumb);
  const bodyCapB = new Mesh(cap(t0, new Vector3(-Math.sin(t0), 0, Math.cos(t0))), crumb);
  body.add(bodyOuter, bodyCapA, bodyCapB);

  // the slice, built in cake coordinates and re-centred on its centroid
  const sectorCentroid = (2 * R * Math.sin(CAKE.wedgeAngle / 2)) / (3 * (CAKE.wedgeAngle / 2));
  const centroid = new Vector3(Math.cos(centerAngle) * sectorCentroid, H * 0.5, Math.sin(centerAngle) * sectorCentroid);
  const slicePivot = new Group();
  slicePivot.name = 'slice-pivot';
  slicePivot.position.copy(centroid);
  const slice = new Group();
  slice.name = 'slice';
  slice.position.copy(centroid).negate();
  slicePivot.add(slice);
  root.add(slicePivot);

  const sliceOuter = new Mesh(sweep(t0, t1), crust);
  const sliceCapA = new Mesh(cap(t0, new Vector3(Math.sin(t0), 0, -Math.cos(t0))), crumb);
  const sliceCapB = new Mesh(cap(t1, new Vector3(-Math.sin(t1), 0, Math.cos(t1))), crumb);
  slice.add(sliceOuter, sliceCapA, sliceCapB);

  // apples: those crossing the cut appear in both groups and are clipped at the cut planes
  const layout = appleLayout();
  const geo = appleSliceGeometry();
  const inBody: Matrix4[] = [];
  const inSlice: Matrix4[] = [];
  for (const a of layout) {
    const d0 = angleDiff(a.angle, t0);
    const d1 = angleDiff(a.angle, t1);
    const inside = d0 >= -a.halfWidth && d1 <= a.halfWidth;
    const fullyInside = d0 >= a.halfWidth && d1 <= -a.halfWidth;
    if (inside) inSlice.push(a.matrix);
    if (!fullyInside) inBody.push(a.matrix);
  }

  const bodyApple = apple.clone();
  const sliceApple = apple.clone();
  bodyApple.onBeforeCompile = apple.onBeforeCompile;
  bodyApple.customProgramCacheKey = apple.customProgramCacheKey;
  sliceApple.onBeforeCompile = apple.onBeforeCompile;
  sliceApple.customProgramCacheKey = apple.customProgramCacheKey;

  const localKeep = [
    new Plane(new Vector3(-Math.sin(t0), 0, Math.cos(t0)), 0),
    new Plane(new Vector3(Math.sin(t1), 0, -Math.cos(t1)), 0),
  ];
  const slicePlanes = localKeep.map((p) => p.clone());
  const bodyPlanes = localKeep.map((p) => p.clone().negate());
  sliceApple.clippingPlanes = slicePlanes;
  sliceApple.clipIntersection = false;
  bodyApple.clippingPlanes = bodyPlanes;
  bodyApple.clipIntersection = true;
  sliceApple.clipShadows = true;
  bodyApple.clipShadows = true;

  const bodyApples = new InstancedMesh(geo, bodyApple, inBody.length);
  inBody.forEach((m, i) => bodyApples.setMatrixAt(i, m));
  const sliceApples = new InstancedMesh(geo, sliceApple, inSlice.length);
  inSlice.forEach((m, i) => sliceApples.setMatrixAt(i, m));
  body.add(bodyApples);
  slice.add(sliceApples);

  for (const obj of [bodyOuter, bodyCapA, bodyCapB, sliceOuter, sliceCapA, sliceCapB, bodyApples, sliceApples] as Object3D[]) {
    obj.castShadow = true;
    obj.receiveShadow = true;
  }

  const tmpPlane = new Plane();
  const updateClipping = () => {
    root.updateMatrixWorld();
    for (let i = 0; i < 2; i++) {
      tmpPlane.copy(localKeep[i]).applyMatrix4(sliceApples.matrixWorld);
      slicePlanes[i].copy(tmpPlane);
      tmpPlane.copy(localKeep[i]).negate().applyMatrix4(bodyApples.matrixWorld);
      bodyPlanes[i].copy(tmpPlane);
    }
  };
  updateClipping();

  return {
    root,
    body,
    slicePivot,
    slice,
    centroid,
    centerAngle,
    updateClipping,
    materials: [crust, crumb, bodyApple, sliceApple],
    setVisible: (v: boolean) => {
      body.visible = v;
      slice.visible = v;
    },
  };
}

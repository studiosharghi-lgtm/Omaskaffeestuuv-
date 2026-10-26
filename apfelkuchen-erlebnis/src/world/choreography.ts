import { Vector3 } from 'three';
import { HANDOFF, chapter } from '../content/story';
import { CUP, PLATE } from './dimensions';
import { clamp01, smoothstep } from '../render/fit';

/*
 * Everything the 3D scene does, as pure functions of timeline time t.
 * Same t → same frame, so scrolling backwards plays the scene in reverse exactly.
 */

/* ------------------------------------------------------------------ handoff calibration */

export interface CameraPose {
  pos: Vector3;
  target: Vector3;
  /** vertical field of view in degrees */
  fov: number;
  /** aspect of the frame this pose was measured for */
  aspect: number;
}

/**
 * The 3D camera that reproduces the last frame of the footage. With real footage, enter the
 * measured camera of shot S05 here (ASSETS.md, "Handoff frame"). The `reference` pose is fitted
 * to the placeholder photo cake-baked-steam.webp.
 */
export const HANDOFF_CAMERA: Record<'reference' | 'desktop' | 'mobile', CameraPose> = {
  reference: { pos: new Vector3(0, 0.131, 0.542), target: new Vector3(0, 0.057, 0), fov: 24, aspect: 1320 / 734 },
  desktop: { pos: new Vector3(0, 0.131, 0.542), target: new Vector3(0, 0.057, 0), fov: 24, aspect: 16 / 9 },
  mobile: { pos: new Vector3(0, 0.16, 0.66), target: new Vector3(0, 0.05, 0), fov: 40, aspect: 9 / 16 },
};

/* ------------------------------------------------------------------ interpolation */

/** Monotone cubic interpolation (Fritsch–Carlson) with eased ends: no overshoot, no jerks. */
class Track {
  private readonly xs: number[];
  private readonly ys: number[];
  private readonly ms: number[];

  constructor(keys: [number, number][]) {
    this.xs = keys.map((k) => k[0]);
    this.ys = keys.map((k) => k[1]);
    const n = keys.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((this.ys[i + 1] - this.ys[i]) / (this.xs[i + 1] - this.xs[i]));
    const m = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i];
      const b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const tau = 3 / Math.sqrt(s);
        m[i] = tau * a * d[i];
        m[i + 1] = tau * b * d[i];
      }
    }
    this.ms = m;
  }

  at(t: number): number {
    const { xs, ys, ms } = this;
    if (t <= xs[0]) return ys[0];
    if (t >= xs[xs.length - 1]) return ys[ys.length - 1];
    let k = 0;
    while (t > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const s = (t - xs[k]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * ys[k] + (s3 - 2 * s2 + s) * h * ms[k] + (-2 * s3 + 3 * s2) * ys[k + 1] + (s3 - s2) * h * ms[k + 1]
    );
  }
}

class VecTrack {
  private readonly x: Track;
  private readonly y: Track;
  private readonly z: Track;
  constructor(keys: [number, [number, number, number]][]) {
    this.x = new Track(keys.map(([t, v]) => [t, v[0]]));
    this.y = new Track(keys.map(([t, v]) => [t, v[1]]));
    this.z = new Track(keys.map(([t, v]) => [t, v[2]]));
  }
  at(t: number, out: Vector3): Vector3 {
    return out.set(this.x.at(t), this.y.at(t), this.z.at(t));
  }
}

/* ------------------------------------------------------------------ timing */

const an = chapter('anschnitt');
const ka = chapter('kaffee');
const fi = chapter('finale');
const ri = chapter('anrichten');
const [H0, H1] = HANDOFF;

const ref = HANDOFF_CAMERA.desktop;
const v = (p: Vector3): [number, number, number] => [p.x, p.y, p.z];

/** Free camera after the handoff (landscape framing; portrait is derived at runtime). */
const camPos = new VecTrack([
  [H1, v(ref.pos)],
  [an.start + 0.6, [0.085, 0.235, 0.5]],
  [an.start + 1.3, [0.2, 0.24, 0.56]],
  [an.end, [0.3, 0.16, 0.5]],
  [ka.start + 1.0, [0.27, 0.19, 0.5]],
  [fi.end, [0.26, 0.205, 0.56]],
]);
const camTarget = new VecTrack([
  [H1, v(ref.target)],
  [an.start + 0.6, [0.055, 0.032, 0.03]],
  [an.start + 1.3, [0.2, 0.04, 0.11]],
  [an.end, [0.31, 0.024, 0.17]],
  [ka.start + 1.0, [0.36, 0.035, 0.085]],
  [fi.end, [0.355, 0.038, 0.075]],
]);
const camFov = new Track([
  [H1, ref.fov],
  [an.start + 0.6, 28],
  [an.end, 26],
  [ka.start + 1.0, 26],
  [fi.end, 26],
]);

/** 0 = camera locked to the footage frame, 1 = free 3D camera. */
export const freeAmount = (t: number): number => smoothstep(H1, an.start + 0.9, t);

/* ------------------------------------------------------------------ the slice */

export interface SliceState {
  /** slice centroid offset from its resting position, in cake coordinates */
  position: Vector3;
  yaw: number;
  roll: number;
  /** height above whatever it rests on (for the contact shadow) */
  lift: number;
  onPlate: number;
}

const SLICE_WINDOW: [number, number] = [an.start + 0.15, an.end - 0.05];

/**
 * The slice slides out, is lifted onto the plate and turned so its cut face looks at the camera.
 * `restCentroid` is where the slice sits inside the cake; `centerAngle` the direction it points.
 */
export function sliceState(
  t: number,
  restCentroid: Vector3,
  centerAngle: number,
  plateSurface: number,
  out: SliceState,
): SliceState {
  const s = clamp01((t - SLICE_WINDOW[0]) / (SLICE_WINDOW[1] - SLICE_WINDOW[0]));
  const dir = new Vector3(Math.cos(centerAngle), 0, Math.sin(centerAngle));

  // phase A: slide out radially
  const a = smoothstep(0, 0.3, s);
  const slid = restCentroid.clone().addScaledVector(dir, 0.05 * a);
  slid.y += 0.002 * a;

  // phase B: lift and carry to the plate along an arc
  const b = smoothstep(0.3, 0.86, s);
  // the centroid sits half a cake height above the surface it rests on
  const plateTarget = new Vector3(PLATE.position.x - 0.01, plateSurface + restCentroid.y + 0.0005, PLATE.position.z + 0.005);
  const above = plateTarget.clone();
  above.y += 0.03;
  const ctrl = slid.clone().lerp(above, 0.5);
  ctrl.y = Math.max(slid.y, above.y) + 0.07;
  const p = new Vector3();
  const omb = 1 - b;
  p.copy(slid).multiplyScalar(omb * omb).addScaledVector(ctrl, 2 * omb * b).addScaledVector(above, b * b);

  // phase C: set down
  const c = smoothstep(0.86, 1, s);
  p.lerp(plateTarget, c);

  // cut face towards the camera, tip pointing left
  const finalAngle = (-15 * Math.PI) / 180;
  const yaw = (centerAngle - finalAngle) * smoothstep(0.32, 0.9, s);
  const roll = Math.sin(Math.PI * b) * 0.16 * (1 - c);

  out.position.copy(p).sub(restCentroid);
  out.yaw = yaw;
  out.roll = roll;
  out.lift = s < 0.3 ? 0.002 * a : Math.max(0, p.y - (s > 0.6 ? plateTarget.y : restCentroid.y));
  out.onPlate = smoothstep(0.75, 0.98, s);
  return out;
}

/* ------------------------------------------------------------------ everything else */

export interface Choreo {
  pos: Vector3;
  target: Vector3;
  fov: number;
  free: number;
  focusPoint: Vector3;
  aperture: number;
  exposure: number;
  backdrop: number;
  sceneMix: number;
  steamCake: number;
  steamCup: number;
}

const focusMix = new Track([
  // 0 = cake, 1 = slice, 2 = cup
  [H0, 0],
  [an.start + 0.4, 0],
  [an.start + 0.9, 1],
  [ka.start + 0.35, 1],
  [ka.start + 0.95, 2],
  [ka.end - 0.1, 2],
  [fi.start + 0.4, 1],
]);
const aperture = new Track([
  [H0, 0.011],
  [an.start + 0.8, 0.014],
  [ka.start + 1.0, 0.017],
  [fi.end, 0.016],
]);
const backdrop = new Track([
  [H0, 1.0],
  [an.start + 0.8, 0.7],
  [ka.start + 0.8, 0.42],
  [fi.end, 0.38],
]);
const exposure = new Track([
  [H0, 1.08],
  [ka.start, 1.12],
  [fi.end, 1.1],
]);
const steamCake = new Track([
  [ri.start - 0.1, 0],
  [ri.start + 0.35, 0.42],
  [an.start + 0.3, 0.36],
  [an.start + 1.4, 0],
]);
const steamCup = new Track([
  [an.start + 0.9, 0],
  [an.end, 0.32],
  [ka.start + 0.5, 0.5],
  [fi.end, 0.5],
]);

const CAKE_FOCUS = new Vector3(0, 0.045, 0);
const CUP_FOCUS = new Vector3(CUP.position.x, CUP.saucerTop + CUP.coffeeLevel, CUP.position.z);

export function choreography(t: number, slicePoint: Vector3, out: Choreo): Choreo {
  camPos.at(Math.max(t, H1), out.pos);
  camTarget.at(Math.max(t, H1), out.target);
  out.fov = camFov.at(Math.max(t, H1));
  out.free = freeAmount(t);

  const f = focusMix.at(t);
  if (f <= 1) out.focusPoint.copy(CAKE_FOCUS).lerp(slicePoint, f);
  else out.focusPoint.copy(slicePoint).lerp(CUP_FOCUS, f - 1);

  out.aperture = aperture.at(t);
  out.exposure = exposure.at(t);
  out.backdrop = backdrop.at(t);
  out.sceneMix = smoothstep(H0, H1, t);
  out.steamCake = steamCake.at(t);
  out.steamCup = steamCup.at(t);
  return out;
}

export function emptyChoreo(): Choreo {
  return {
    pos: new Vector3(),
    target: new Vector3(),
    fov: 24,
    free: 0,
    focusPoint: new Vector3(),
    aperture: 0,
    exposure: 1,
    backdrop: 1,
    sceneMix: 0,
    steamCake: 0,
    steamCup: 0,
  };
}

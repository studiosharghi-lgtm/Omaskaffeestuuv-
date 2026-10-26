export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const progress = (t: number, [a, b]: readonly [number, number]): number => clamp01((t - a) / (b - a));

/**
 * The part of a source frame that is visible on the stage, in source image coordinates
 * (0–1, origin top-left; values beyond 0–1 mean the stage shows more than the frame).
 *
 * fit 1 = cover (fills the stage, crops), fit 0 = contain (whole frame visible).
 * zoom > 1 moves closer; (cx, cy) is the centre of interest, clamped so a covering frame
 * never reveals its own edges.
 */
export interface VisibleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function visibleRect(
  sourceAspect: number,
  stageAspect: number,
  fit: number,
  zoom: number,
  cx: number,
  cy: number,
): VisibleRect {
  let wCover: number, hCover: number, wContain: number, hContain: number;
  if (stageAspect > sourceAspect) {
    wCover = 1;
    hCover = sourceAspect / stageAspect;
    wContain = stageAspect / sourceAspect;
    hContain = 1;
  } else {
    wCover = stageAspect / sourceAspect;
    hCover = 1;
    wContain = 1;
    hContain = sourceAspect / stageAspect;
  }
  const f = clamp01(fit);
  const w = Math.exp(lerp(Math.log(wContain), Math.log(wCover), f)) / zoom;
  const h = Math.exp(lerp(Math.log(hContain), Math.log(hCover), f)) / zoom;
  const x = w <= 1 ? clamp(cx - w / 2, 0, 1 - w) : 0.5 - w / 2;
  const y = h <= 1 ? clamp(cy - h / 2, 0, 1 - h) : 0.5 - h / 2;
  return { x, y, w, h };
}

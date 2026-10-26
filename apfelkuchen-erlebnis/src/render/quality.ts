export type Tier = 'high' | 'medium' | 'low';

export interface Quality {
  tier: Tier;
  /** Upper bound for devicePixelRatio. */
  maxDpr: number;
  /** Upper bound for drawing-buffer pixels (width × height). */
  maxPixels: number;
  msaa: number;
  shadowMapSize: number;
  /** Depth-of-field samples per pixel (half-resolution pass). */
  dofSamples: number;
  /** Largest blur radius in CSS pixels. */
  dofMaxBlur: number;
  /** Concurrent image requests for frame sequences. */
  frameConcurrency: number;
  /** Frame rate cap while something animates continuously (steam). */
  maxFps: number;
}

const coarsePointer = (): boolean => window.matchMedia('(pointer: coarse)').matches;

const LOW: Quality = {
  tier: 'low',
  maxDpr: 1.5,
  maxPixels: 1_300_000,
  msaa: 0,
  shadowMapSize: 1024,
  dofSamples: 40,
  dofMaxBlur: 14,
  frameConcurrency: 4,
  maxFps: 30,
};

/** `?quality=low|medium|high` overrides the automatic choice (handy when testing on devices). */
function forcedTier(): Tier | null {
  try {
    const q = new URLSearchParams(window.location.search).get('quality');
    return q === 'low' || q === 'medium' || q === 'high' ? q : null;
  } catch {
    return null;
  }
}

export function pickQuality(): Quality {
  const forced = forcedTier();
  if (forced === 'low') return { ...LOW };
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

  if (!forced && (coarsePointer() || saveData || memory <= 4 || cores <= 4)) {
    return { ...LOW };
  }
  if (forced === 'medium' || (!forced && window.devicePixelRatio > 1.5 && window.innerWidth * window.innerHeight > 1_400_000)) {
    return {
      tier: 'medium',
      maxDpr: 1.5,
      maxPixels: 2_600_000,
      msaa: 2,
      shadowMapSize: 2048,
      dofSamples: 64,
      dofMaxBlur: 20,
      frameConcurrency: 6,
      maxFps: 60,
    };
  }
  return {
    tier: 'high',
    maxDpr: 2,
    maxPixels: 3_200_000,
    msaa: 4,
    shadowMapSize: 2048,
    dofSamples: 96,
    dofMaxBlur: 22,
    frameConcurrency: 6,
    maxFps: 60,
  };
}

/** One step down when frames take too long; returns null when already at the bottom. */
export function degrade(q: Quality): Quality | null {
  if (q.maxPixels <= 700_000) return null;
  return {
    ...q,
    maxPixels: Math.round(q.maxPixels * 0.72),
    msaa: q.msaa > 0 ? Math.max(0, q.msaa - 2) : 0,
    dofSamples: Math.max(32, Math.round(q.dofSamples * 0.75)),
  };
}

export interface SequenceVariantInventory {
  frames: number;
  ext: string | null;
  width: number | null;
  height: number | null;
  bytes: number;
  warnings: string[];
}

export interface MediaInventory {
  sequences: Record<string, Record<string, SequenceVariantInventory>>;
  models: Record<string, boolean>;
  posters: Record<string, boolean>;
  reference: Record<string, boolean>;
}

export interface ScanResult {
  manifest: any;
  inventory: MediaInventory;
}

export const FRAME_PATTERN: RegExp;
export function loadManifest(projectRoot: string): any;
export function readImageSize(file: string): { width: number; height: number } | null;
export function scanMedia(projectRoot: string, publicDir: string): ScanResult;
export function describeMissing(result: ScanResult): { lines: string[]; missingCount: number };

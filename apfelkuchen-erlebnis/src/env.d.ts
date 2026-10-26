/// <reference types="vite/client" />

declare module 'virtual:media-inventory' {
  export interface SequenceVariantInventory {
    frames: number;
    ext: string | null;
    width: number | null;
    height: number | null;
    bytes: number;
    warnings: string[];
  }

  export interface MediaInventory {
    sequences: Record<string, Record<'desktop' | 'mobile', SequenceVariantInventory>>;
    models: Record<string, boolean>;
    posters: Record<string, boolean>;
    reference: Record<string, boolean>;
  }

  const inventory: MediaInventory;
  export default inventory;
}

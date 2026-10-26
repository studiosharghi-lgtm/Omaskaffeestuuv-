import manifest from './media.manifest.json';
import inventory from 'virtual:media-inventory';

export type SequenceId = 's01-aepfel' | 's02-teig' | 's03-fuellung' | 's04-ofen' | 's05-anrichten';
export type ReferenceId = 'pie-raw-topdown' | 'cake-baked-steam' | 'slice-cappuccino';
export type ModelId = 'cake-body' | 'cake-slice' | 'plate' | 'cup';
export type PosterId = 'finale';
export type Variant = 'desktop' | 'mobile';

export const MANIFEST = manifest;
export const INVENTORY = inventory;

const MEDIA_BASE = `${import.meta.env.BASE_URL}media/`;

export const mediaUrl = (path: string): string => MEDIA_BASE + path;

export interface SequenceSource {
  id: SequenceId;
  variant: Variant;
  frames: number;
  width: number;
  height: number;
  /** URL of frame `index` (0-based). */
  url(index: number): string;
}

/**
 * Real footage for a sequence, or null when no frames exist yet (placeholder is used).
 * Portrait screens prefer the `mobile` variant; if only one variant exists it is used everywhere.
 */
export function sequenceSource(id: SequenceId, preferred: Variant): SequenceSource | null {
  const entry = inventory.sequences[id];
  if (!entry) return null;
  const order: Variant[] = preferred === 'mobile' ? ['mobile', 'desktop'] : ['desktop', 'mobile'];
  for (const variant of order) {
    const v = entry[variant];
    if (v && v.frames > 0 && v.ext) {
      const spec = manifest.sequences.find((s) => s.id === id)!.variants[variant];
      const ext = v.ext;
      return {
        id,
        variant,
        frames: v.frames,
        width: v.width ?? spec.width,
        height: v.height ?? spec.height,
        url: (index: number) => mediaUrl(`sequences/${id}/${variant}/${String(index + 1).padStart(4, '0')}.${ext}`),
      };
    }
  }
  return null;
}

export const hasReference = (id: ReferenceId): boolean => inventory.reference[id] === true;
export const hasModel = (id: ModelId): boolean => inventory.models[id] === true;
export const hasPoster = (id: PosterId): boolean => inventory.posters[id] === true;

export const referenceUrl = (id: ReferenceId): string =>
  mediaUrl(manifest.reference.find((r) => r.id === id)!.file);
export const modelUrl = (id: ModelId): string => mediaUrl(manifest.models.find((m) => m.id === id)!.file);
export const posterUrl = (id: PosterId): string => mediaUrl(manifest.posters.find((p) => p.id === id)!.file);

export interface MissingItem {
  kind: 'sequence' | 'model' | 'poster';
  id: string;
  title: string;
  detail: string;
}

/** Everything that is still a placeholder, for the in-page production status panel. */
export function missingMedia(): MissingItem[] {
  const items: MissingItem[] = [];
  for (const seq of manifest.sequences) {
    const variants = (['desktop', 'mobile'] as const).filter((v) => !(inventory.sequences[seq.id]?.[v]?.frames > 0));
    if (variants.length) {
      const specs = variants
        .map((v) => {
          const frames = v === 'desktop' ? seq.recommended.frames : Math.round(seq.recommended.frames / 2);
          return `${v === 'desktop' ? 'Desktop' : 'Mobil'}: ca. ${frames} Bilder, ${seq.variants[v].width}×${seq.variants[v].height}`;
        })
        .join('; ');
      items.push({ kind: 'sequence', id: seq.id, title: seq.title, detail: specs });
    }
  }
  for (const model of manifest.models) {
    if (!inventory.models[model.id]) {
      items.push({ kind: 'model', id: model.id, title: model.title, detail: model.file });
    }
  }
  for (const poster of manifest.posters) {
    if (!inventory.posters[poster.id]) {
      items.push({ kind: 'poster', id: poster.id, title: poster.title, detail: `${poster.width}×${poster.height}` });
    }
  }
  return items;
}

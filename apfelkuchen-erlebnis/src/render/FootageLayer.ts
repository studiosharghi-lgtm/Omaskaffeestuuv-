import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace, Texture } from 'three';
import { CLIPS, type ClipSpec, type Grade } from '../content/story';
import {
  MANIFEST,
  hasReference,
  referenceUrl,
  sequenceSource,
  type ReferenceId,
  type SequenceSource,
  type Variant,
} from '../content/media';
import { FrameLoader } from './FrameLoader';
import { clamp01, easeInOutSine, lerp, progress, smoothstep, visibleRect, type VisibleRect } from './fit';

export type ClipKind = 'sequence' | 'reference' | 'card';

export interface FootageSlot {
  texture: Texture;
  /** Visible part of the texture: u0, v0, width, height (texture space, v upwards). */
  rect: [number, number, number, number];
  /** exposure, warmth, saturation */
  grade: [number, number, number];
}

export interface FootageState {
  a: FootageSlot | null;
  b: FootageSlot | null;
  mix: number;
  /** The clip in front, for labels. */
  clip: ClipSpec;
  kind: ClipKind;
  frame: number;
  frames: number;
}

/** How the last clip (the handoff shot) is currently framed, so the 3D camera can match it. */
export interface HandoffView {
  kind: ClipKind;
  variant: Variant | null;
  sourceAspect: number;
  rect: VisibleRect;
}

const NEUTRAL: Grade = { exposure: 1, warmth: 0, saturation: 1 };

function makeTexture(image?: TexImageSource): Texture {
  const tex = new Texture(image as HTMLImageElement | undefined);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  if (image) tex.needsUpdate = true;
  return tex;
}

class Clip {
  readonly spec: ClipSpec;
  private readonly sources = new Map<Variant, SequenceSource | null>();
  private readonly loaders = new Map<Variant, FrameLoader>();
  private readonly seqTexture = makeTexture();
  private shownIndex = -1;
  private shownVariant: Variant | null = null;
  private card: { canvas: HTMLCanvasElement; texture: CanvasTexture; drawnFrame: number } | null = null;

  constructor(
    spec: ClipSpec,
    private readonly owner: FootageLayer,
  ) {
    this.spec = spec;
  }

  source(variant: Variant): SequenceSource | null {
    if (!this.sources.has(variant)) this.sources.set(variant, sequenceSource(this.spec.sequence, variant));
    return this.sources.get(variant)!;
  }

  private loader(src: SequenceSource): FrameLoader {
    let l = this.loaders.get(src.variant);
    if (!l) {
      l = new FrameLoader(src, this.owner.concurrency, () => this.owner.onFrameReady());
      this.loaders.set(src.variant, l);
    }
    return l;
  }

  /** Warm up or free frame memory depending on how close the visitor is. */
  manage(t: number, variant: Variant): void {
    const src = this.source(variant);
    if (!src) return;
    const [v0, v1] = this.spec.visible;
    const loader = this.loader(src);
    if (t >= v0 - 1.6 && t <= v1 + 0.6) {
      const p = progress(t, this.spec.play);
      loader.focus(p * (src.frames - 1));
    } else if (t < v0 - 3 || t > v1 + 2.5) {
      loader.release();
    }
  }

  /** Video export: waits until the exact frame for `t` is decoded. */
  async settle(t: number, variant: Variant): Promise<void> {
    const src = this.source(variant);
    if (src) await this.loader(src).whenReady(progress(t, this.spec.play) * (src.frames - 1));
  }

  kind(variant: Variant): ClipKind {
    if (this.source(variant)) return 'sequence';
    return hasReference(this.spec.placeholder.reference) ? 'reference' : 'card';
  }

  /** Recommended frame count for labels when no real frames exist. */
  frameCount(variant: Variant): number {
    const src = this.source(variant);
    if (src) return src.frames;
    return MANIFEST.sequences.find((s) => s.id === this.spec.sequence)!.recommended.frames;
  }

  prepare(t: number, stageAspect: number, variant: Variant): { slot: FootageSlot | null; frame: number; kind: ClipKind } {
    const p = progress(t, this.spec.play);
    const src = this.source(variant);

    if (src) {
      const frame = p * (src.frames - 1);
      const hit = this.loader(src).nearest(frame);
      if (hit) {
        if (hit.index !== this.shownIndex || src.variant !== this.shownVariant) {
          this.seqTexture.image = hit.image;
          this.seqTexture.needsUpdate = true;
          this.shownIndex = hit.index;
          this.shownVariant = src.variant;
        }
        const r = visibleRect(src.width / src.height, stageAspect, 1, 1, 0.5, 0.5);
        return { slot: { texture: this.seqTexture, rect: toTexRect(r), grade: [1, 0, 1] }, frame: hit.index, kind: 'sequence' };
      }
      // Nothing decoded yet: show the placeholder until the first frame arrives.
    }

    const ph = this.spec.placeholder;
    const frames = this.frameCount(variant);
    const frameIndex = Math.round(p * (frames - 1));
    const ref = hasReference(ph.reference) ? this.owner.reference(ph.reference) : null;

    if (ref && ref.ready) {
      const e = easeInOutSine(p);
      const fit = stageAspect < 1 ? ph.portraitFit : 1;
      const r = visibleRect(
        ref.aspect,
        stageAspect,
        fit,
        lerp(ph.from.zoom, ph.to.zoom, e),
        lerp(ph.from.x, ph.to.x, e),
        lerp(ph.from.y, ph.to.y, e),
      );
      const g0 = { ...NEUTRAL, ...ph.gradeFrom };
      const g1 = { ...NEUTRAL, ...(ph.gradeTo ?? ph.gradeFrom) };
      return {
        slot: {
          texture: ref.texture,
          rect: toTexRect(r),
          grade: [lerp(g0.exposure, g1.exposure, p), lerp(g0.warmth, g1.warmth, p), lerp(g0.saturation, g1.saturation, p)],
        },
        frame: frameIndex,
        kind: src ? 'sequence' : 'reference',
      };
    }
    if (ref && !ref.ready) return { slot: null, frame: frameIndex, kind: 'reference' };

    // Storyboard card: drawn on a canvas, clearly a stand-in.
    const card = this.ensureCard(stageAspect < 1);
    if (card.drawnFrame !== frameIndex) {
      drawStoryboardCard(card.canvas, this.spec, frameIndex, frames);
      card.texture.needsUpdate = true;
      card.drawnFrame = frameIndex;
    }
    const r = visibleRect(card.canvas.width / card.canvas.height, stageAspect, 1, 1, 0.5, 0.5);
    return { slot: { texture: card.texture, rect: toTexRect(r), grade: [1, 0, 1] }, frame: frameIndex, kind: 'card' };
  }

  handoffView(t: number, stageAspect: number, variant: Variant): HandoffView {
    const src = this.source(variant);
    if (src) {
      return {
        kind: 'sequence',
        variant: src.variant,
        sourceAspect: src.width / src.height,
        rect: visibleRect(src.width / src.height, stageAspect, 1, 1, 0.5, 0.5),
      };
    }
    const ph = this.spec.placeholder;
    const ref = this.owner.reference(ph.reference);
    const e = easeInOutSine(progress(t, this.spec.play));
    const fit = stageAspect < 1 ? ph.portraitFit : 1;
    return {
      kind: hasReference(ph.reference) ? 'reference' : 'card',
      variant: null,
      sourceAspect: ref.aspect,
      rect: visibleRect(
        ref.aspect,
        stageAspect,
        fit,
        lerp(ph.from.zoom, ph.to.zoom, e),
        lerp(ph.from.x, ph.to.x, e),
        lerp(ph.from.y, ph.to.y, e),
      ),
    };
  }

  private ensureCard(portrait: boolean) {
    const w = portrait ? 900 : 1600;
    const h = portrait ? 1600 : 900;
    if (!this.card || this.card.canvas.width !== w) {
      this.card?.texture.dispose();
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.generateMipmaps = false;
      this.card = { canvas, texture, drawnFrame: -1 };
    }
    return this.card;
  }
}

interface ReferenceStill {
  texture: Texture;
  aspect: number;
  ready: boolean;
  promise: Promise<void>;
}

const REFERENCE_ASPECT: Record<ReferenceId, number> = {
  'pie-raw-topdown': 1320 / 876,
  'cake-baked-steam': 1320 / 734,
  'slice-cappuccino': 1320 / 1204,
};

function toTexRect(r: VisibleRect): [number, number, number, number] {
  // image coordinates (y down) → texture coordinates (v up)
  return [r.x, 1 - (r.y + r.h), r.w, r.h];
}

export class FootageLayer {
  readonly clips: Clip[];
  private readonly references = new Map<ReferenceId, ReferenceStill>();
  private stageAspect = 16 / 9;
  private requestRender: () => void = () => {};

  constructor(readonly concurrency: number) {
    this.clips = CLIPS.map((spec) => new Clip(spec, this));
  }

  setRenderCallback(cb: () => void): void {
    this.requestRender = cb;
  }

  onFrameReady(): void {
    this.requestRender();
  }

  get variant(): Variant {
    return this.stageAspect < 0.9 ? 'mobile' : 'desktop';
  }

  setStageAspect(aspect: number): void {
    this.stageAspect = aspect;
  }

  reference(id: ReferenceId): ReferenceStill {
    let ref = this.references.get(id);
    if (!ref) {
      const texture = makeTexture();
      const still: ReferenceStill = { texture, aspect: REFERENCE_ASPECT[id], ready: false, promise: Promise.resolve() };
      if (hasReference(id)) {
        const img = new Image();
        img.decoding = 'async';
        img.src = referenceUrl(id);
        still.promise = img
          .decode()
          .then(() => {
            texture.image = img;
            texture.needsUpdate = true;
            still.aspect = img.naturalWidth / img.naturalHeight;
            still.ready = true;
            this.requestRender();
          })
          .catch(() => {
            /* missing or broken file: the storyboard card takes over */
          });
      }
      ref = still;
      this.references.set(id, ref);
    }
    return ref;
  }

  /** Resolves once the first shot can be shown. */
  async ready(): Promise<void> {
    const first = this.clips[0];
    const src = first.source(this.variant);
    if (src) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.src = src.url(0);
        img.decode().then(() => resolve(), () => resolve());
      });
    }
    const ph = first.spec.placeholder;
    if (hasReference(ph.reference)) await this.reference(ph.reference).promise;
    // Reference stills used later are small; start them now.
    for (const clip of this.clips) {
      if (hasReference(clip.spec.placeholder.reference)) void this.reference(clip.spec.placeholder.reference);
    }
  }

  private visibleClips(t: number): Clip[] {
    const visible = this.clips.filter((c) => t >= c.spec.visible[0] && t <= c.spec.visible[1]);
    if (visible.length) return visible;
    return [t < this.clips[0].spec.visible[0] ? this.clips[0] : this.clips[this.clips.length - 1]];
  }

  /**
   * Video export: resolves once everything shown at `t` is decoded, so a frame never
   * captures a coarse stand-in frame or a still that is still loading.
   */
  async settle(t: number): Promise<void> {
    const variant = this.variant;
    await Promise.all(
      this.clips
        .filter((clip) => hasReference(clip.spec.placeholder.reference))
        .map((clip) => this.reference(clip.spec.placeholder.reference).promise),
    );
    await Promise.all(this.visibleClips(t).map((clip) => clip.settle(t, variant)));
  }

  state(t: number): FootageState {
    const variant = this.variant;
    for (const clip of this.clips) clip.manage(t, variant);

    const visible = this.visibleClips(t);
    const top = visible[visible.length - 1];
    const below = visible.length > 1 ? visible[visible.length - 2] : null;

    const topPrep = top.prepare(t, this.stageAspect, variant);
    let a: FootageSlot | null;
    let b: FootageSlot | null = null;
    let mix = 0;
    if (below) {
      const belowPrep = below.prepare(t, this.stageAspect, variant);
      a = belowPrep.slot;
      b = topPrep.slot;
      mix = top.spec.fadeIn > 0 ? smoothstep(top.spec.visible[0], top.spec.visible[0] + top.spec.fadeIn, t) : 1;
      if (!b) mix = 0;
      if (!a) {
        a = b;
        b = null;
        mix = 0;
      }
    } else {
      a = topPrep.slot;
    }
    return { a, b, mix: clamp01(mix), clip: top.spec, kind: topPrep.kind, frame: topPrep.frame, frames: top.frameCount(variant) };
  }

  handoffView(t: number): HandoffView {
    const last = this.clips[this.clips.length - 1];
    return last.handoffView(t, this.stageAspect, this.variant);
  }

  /** Label data for the clip that holds the 3D handoff shot. */
  handoffKind(): ClipKind {
    return this.clips[this.clips.length - 1].kind(this.variant);
  }

  kindOf(index: number): ClipKind {
    return this.clips[index].kind(this.variant);
  }
}

/* ------------------------------------------------------------------ storyboard card */

/**
 * A storyboard card for a missing sequence: what the shot will show, and how far into it the
 * visitor is. The text sits in the upper middle so the page captions below stay clear.
 */
function drawStoryboardCard(canvas: HTMLCanvasElement, spec: ClipSpec, frame: number, frames: number): void {
  const ctx = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  const portrait = h > w;
  const meta = MANIFEST.sequences.find((s) => s.id === spec.sequence)!;

  const bg = ctx.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.38, Math.max(w, h) * 0.75);
  bg.addColorStop(0, '#33241a');
  bg.addColorStop(1, '#120c08');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // film perforations along two edges: this is where footage will go
  ctx.fillStyle = 'rgba(243, 233, 218, 0.07)';
  if (portrait) {
    for (let y = 30; y < h; y += 64) {
      ctx.fillRect(22, y, 24, 36);
      ctx.fillRect(w - 46, y, 24, 36);
    }
  } else {
    for (let x = 30; x < w; x += 64) {
      ctx.fillRect(x, 22, 36, 24);
      ctx.fillRect(x, h - 46, 36, 24);
    }
  }

  const maxWidth = w * (portrait ? 0.78 : 0.62);
  const cx = w / 2;
  let y = h * (portrait ? 0.24 : 0.26);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = 'rgba(243, 233, 218, 0.72)';
  ctx.font = `500 ${portrait ? 34 : 30}px Jost, system-ui, sans-serif`;
  ctx.fillText(`Platzhalter für Filmsequenz ${spec.sequence.slice(1, 3)}`, cx, y);

  // title: shrink until it fits on one line (two at most)
  ctx.fillStyle = '#f3e9da';
  let size = portrait ? 92 : 104;
  ctx.font = `340 ${size}px Fraunces, Georgia, serif`;
  while (ctx.measureText(meta.title).width > maxWidth * 1.6 && size > 48) {
    size -= 4;
    ctx.font = `340 ${size}px Fraunces, Georgia, serif`;
  }
  y += size * 1.25;
  y = wrapText(ctx, meta.title, cx, y, maxWidth, size * 1.05);

  ctx.fillStyle = 'rgba(243, 233, 218, 0.8)';
  ctx.font = `400 ${portrait ? 34 : 32}px Jost, system-ui, sans-serif`;
  y = wrapText(ctx, spec.storyboard, cx, y + (portrait ? 60 : 56), maxWidth, portrait ? 46 : 44);

  const barW = Math.min(maxWidth, 560);
  const p = frames > 1 ? frame / (frames - 1) : 0;
  y += portrait ? 64 : 58;
  ctx.fillStyle = 'rgba(243, 233, 218, 0.18)';
  ctx.fillRect(cx - barW / 2, y, barW, 3);
  ctx.fillStyle = '#d39a4f';
  ctx.fillRect(cx - barW / 2, y, barW * p, 3);
  ctx.fillStyle = 'rgba(243, 233, 218, 0.6)';
  ctx.font = `400 ${portrait ? 28 : 26}px Jost, system-ui, sans-serif`;
  ctx.fillText(`Bild ${frame + 1} von ${frames}`, cx, y + (portrait ? 48 : 44));
}

/** Centred wrapped text; returns the baseline of the last line. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): number {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y;
}

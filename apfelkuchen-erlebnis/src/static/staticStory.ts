import { CLIPS, chapter, type ChapterId, type ClipSpec } from '../content/story';
import { MANIFEST, hasModel, hasPoster, hasReference, posterUrl, referenceUrl, sequenceSource, type ModelId } from '../content/media';
import { visibleRect } from '../render/fit';

type Reason = 'motion' | 'webgl' | 'error';

const CHAPTER_CLIP: Partial<Record<ChapterId, number>> = {
  aepfel: 0,
  teig: 1,
  fuellung: 2,
  ofen: 3,
  anrichten: 4,
};

/** Moments of the 3D scene used as stills: the cut slice, and the final table. */
const STILL_TIMES: Partial<Record<ChapterId, number>> = {
  anschnitt: chapter('anschnitt').start + 1.15,
  kaffee: chapter('kaffee').end - 0.2,
};

const SLICE_PHOTO_ALT = 'Ein Stück Apfelkuchen auf einem Keramikteller, dahinter ein Cappuccino';

/**
 * The calm version: every chapter as a still with its caption, in normal reading order.
 * Used for "reduce motion", devices without WebGL 2, and as a fallback after errors.
 */
export async function startStatic(reason: Reason): Promise<void> {
  const stage = document.querySelector<HTMLElement>('.buehne');
  if (!stage) return;

  const items = [...stage.querySelectorAll<HTMLElement>('.kapitel__eintrag')];
  const variant = window.innerWidth / window.innerHeight < 0.9 ? 'mobile' : 'desktop';

  // Hero: the first shot appears inside the closed window.
  const first = await shotImage(CLIPS[0], 0, variant, 900, 1100);
  if (first) stage.querySelector<HTMLElement>('.fenster__oeffnung')?.style.setProperty('--fenster-bild', `url("${first.url}")`);

  const stillJobs: { figure: HTMLElement; time: number }[] = [];

  for (const item of items) {
    const id = item.dataset.kapitel as ChapterId;
    item.querySelector('.statisch__bild')?.remove();
    const figure = document.createElement('figure');
    figure.className = 'statisch__bild';

    const clipIndex = CHAPTER_CLIP[id];
    if (clipIndex !== undefined) {
      const clip = CLIPS[clipIndex];
      const shot = await shotImage(clip, 1, variant, 1600, 900);
      if (!shot) continue;
      const img = document.createElement('img');
      img.src = shot.url;
      img.alt = shot.alt;
      img.loading = 'lazy';
      img.decoding = 'async';
      figure.append(img);
      if (shot.placeholder) figure.append(caption(shot.placeholder));
      item.prepend(figure);
      continue;
    }

    const time = STILL_TIMES[id];
    if (time === undefined) continue;
    if (reason !== 'webgl') {
      stillJobs.push({ figure, time });
      item.prepend(figure);
    } else if (hasPoster('finale')) {
      const img = document.createElement('img');
      img.src = posterUrl('finale');
      img.alt = SLICE_PHOTO_ALT;
      img.loading = 'lazy';
      figure.append(img);
      item.prepend(figure);
    } else if (id === 'kaffee' && hasReference('slice-cappuccino')) {
      const img = document.createElement('img');
      img.src = referenceUrl('slice-cappuccino');
      img.alt = SLICE_PHOTO_ALT;
      img.loading = 'lazy';
      figure.append(img, caption('Platzhalter: Referenzfoto statt Schlussbild'));
      item.prepend(figure);
    }
  }

  if (stillJobs.length) renderStillsWhenNear(stillJobs);
}

function caption(text: string): HTMLElement {
  const fc = document.createElement('figcaption');
  fc.textContent = text;
  return fc;
}

/** Real footage frame if present, otherwise the framed reference still (drawn at the shot's end position). */
async function shotImage(
  clip: ClipSpec,
  at: 0 | 1,
  variant: 'desktop' | 'mobile',
  width: number,
  height: number,
): Promise<{ url: string; alt: string; placeholder: string | null } | null> {
  const meta = MANIFEST.sequences.find((s) => s.id === clip.sequence)!;
  const src = sequenceSource(clip.sequence, variant);
  if (src) {
    return {
      url: src.url(at === 0 ? 0 : src.frames - 1),
      alt: meta.title,
      placeholder: null,
    };
  }
  const ph = clip.placeholder;
  if (!hasReference(ph.reference)) return null;
  const img = new Image();
  img.src = referenceUrl(ph.reference);
  try {
    await img.decode();
  } catch {
    return null;
  }
  const frame = at === 0 ? ph.from : ph.to;
  const r = visibleRect(img.naturalWidth / img.naturalHeight, width / height, 1, frame.zoom, frame.x, frame.y);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const g = { exposure: 1, ...(at === 0 ? ph.gradeFrom : ph.gradeTo ?? ph.gradeFrom) };
  if (g.exposure !== 1) ctx.filter = `brightness(${g.exposure})`;
  ctx.drawImage(
    img,
    r.x * img.naturalWidth,
    r.y * img.naturalHeight,
    r.w * img.naturalWidth,
    r.h * img.naturalHeight,
    0,
    0,
    width,
    height,
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) return null;
  return {
    url: URL.createObjectURL(blob),
    alt: ph.alt,
    placeholder: `Platzhalter: Referenzfoto statt Filmsequenz ${clip.sequence.slice(1, 3)} „${meta.title}“`,
  };
}

/** Renders still images of the 3D scene once, when the visitor scrolls close to them. */
function renderStillsWhenNear(jobs: { figure: HTMLElement; time: number }[]): void {
  let started = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (started || !entries.some((e) => e.isIntersecting)) return;
      started = true;
      observer.disconnect();
      void renderStills(jobs);
    },
    { rootMargin: '120% 0px' },
  );
  jobs.forEach((j) => observer.observe(j.figure));
}

async function renderStills(jobs: { figure: HTMLElement; time: number }[]): Promise<void> {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;width:1280px;height:720px;pointer-events:none;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:1280px;height:720px;display:block;';
  holder.append(canvas);
  document.body.append(holder);

  const placeholderNote = MANIFEST.models.some((m) => !hasModel(m.id as ModelId))
    ? 'Platzhalter: 3D-Kuchen, Teller und Tasse sind nachgebaut, die Scans fehlen noch.'
    : null;

  try {
    const [{ Engine }, { World3D }, { pickQuality }] = await Promise.all([
      import('../render/Engine'),
      import('../world/World3D'),
      import('../render/quality'),
    ]);
    const quality = { ...pickQuality(), maxDpr: 1, maxPixels: 1280 * 720, maxFps: 1 };
    const engine = new Engine({ canvas, quality, motion: false, onContextLost: () => {} });
    const world = await World3D.create(engine.renderer, quality, { motion: false });
    engine.setWorld(world);
    engine.resize();
    for (const job of jobs) {
      engine.setTime(job.time);
      engine.renderNow();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (!blob) continue;
      const img = document.createElement('img');
      img.src = URL.createObjectURL(blob);
      img.alt =
        job.time < chapter('kaffee').start
          ? 'Das erste Stück Apfelkuchen wird aus dem Kuchen gehoben, die Apfelfüllung ist zu sehen'
          : 'Ein Stück Apfelkuchen auf einem Keramikteller, daneben ein Cappuccino mit Milchschaum';
      job.figure.replaceChildren(img);
      if (placeholderNote) job.figure.append(caption(placeholderNote));
    }
    engine.dispose();
  } catch (error) {
    console.error('Omas Apfelkuchen: could not render the 3D stills.', error);
    for (const job of jobs) job.figure.remove();
  } finally {
    holder.remove();
  }
}

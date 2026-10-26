import type { ReferenceId, SequenceId } from './media';

/*
 * The whole experience is one scroll-driven timeline. Its unit is one "screen":
 * scrolling by the height of the pinned stage advances the timeline by 1.
 * Captions and texts live in index.html; this file only decides *when* things happen.
 */

export type ChapterId =
  | 'intro'
  | 'aepfel'
  | 'teig'
  | 'fuellung'
  | 'ofen'
  | 'anrichten'
  | 'anschnitt'
  | 'kaffee'
  | 'finale';

interface ChapterSpec {
  id: ChapterId;
  /** Scroll length in screens. */
  length: number;
  /** Label in the chapter navigation. Chapters without one belong to the previous entry. */
  nav?: string;
}

const CHAPTER_SPECS: ChapterSpec[] = [
  { id: 'intro', length: 0.9 },
  { id: 'aepfel', length: 1.8, nav: 'Äpfel' },
  { id: 'teig', length: 1.8, nav: 'Teig' },
  { id: 'fuellung', length: 1.8, nav: 'Füllung' },
  { id: 'ofen', length: 1.5, nav: 'Ofen' },
  { id: 'anrichten', length: 1.5 },
  { id: 'anschnitt', length: 2.1, nav: 'Anschnitt' },
  { id: 'kaffee', length: 1.7, nav: 'Kaffee' },
  { id: 'finale', length: 1.2 },
];

export interface Chapter extends ChapterSpec {
  start: number;
  end: number;
}

export const CHAPTERS: Chapter[] = (() => {
  let t = 0;
  return CHAPTER_SPECS.map((spec) => {
    const chapter = { ...spec, start: t, end: t + spec.length };
    t += spec.length;
    return chapter;
  });
})();

export const TOTAL = CHAPTERS[CHAPTERS.length - 1].end;

export const chapter = (id: ChapterId): Chapter => CHAPTERS.find((c) => c.id === id)!;

export interface NavEntry {
  label: string;
  start: number;
  end: number;
}

export const NAV: NavEntry[] = (() => {
  const entries: NavEntry[] = [];
  for (const c of CHAPTERS) {
    if (c.nav) entries.push({ label: c.nav, start: c.start, end: c.end });
    else if (entries.length && c.id !== 'finale') entries[entries.length - 1].end = c.end;
  }
  return entries;
})();

/** Navigation is shown between the opened window and the closing shot. */
export const NAV_VISIBLE: [number, number] = [chapter('aepfel').start - 0.05, chapter('finale').start + 0.1];

/* ------------------------------------------------------------------ footage */

export interface ShotFrame {
  /** Centre of the visible area in image coordinates (0–1, y downwards). */
  x: number;
  y: number;
  /** 1 = the image just covers the stage; 2 = twice as close. */
  zoom: number;
}

export interface Grade {
  exposure: number;
  warmth: number;
  saturation: number;
}

/** What stands in for a sequence while its frames are missing. */
export interface PlaceholderShot {
  reference: ReferenceId;
  from: ShotFrame;
  to: ShotFrame;
  gradeFrom?: Partial<Grade>;
  gradeTo?: Partial<Grade>;
  /** Portrait screens: 0 shows the whole (landscape) still, 1 crops it to fill. */
  portraitFit: number;
  /** Describes what this framing of the still shows (used as alt text in the calm version). */
  alt: string;
}

export interface ClipSpec {
  sequence: SequenceId;
  /** Timeline window in which the clip is on screen. */
  visible: [number, number];
  /** Timeline window mapped onto frames 0…n-1; before/after it the first/last frame holds. */
  play: [number, number];
  /** Dissolve from the previous clip at the start of `visible`. */
  fadeIn: number;
  placeholder: PlaceholderShot;
  /** One line for the storyboard card shown when even the reference still is missing. */
  storyboard: string;
}

const c = chapter;

export const CLIPS: ClipSpec[] = [
  {
    sequence: 's01-aepfel',
    visible: [0, c('aepfel').end + 0.15],
    play: [c('aepfel').start - 0.15, c('aepfel').end + 0.15],
    fadeIn: 0,
    placeholder: {
      reference: 'pie-raw-topdown',
      from: { x: 0.86, y: 0.6, zoom: 2.0 },
      to: { x: 0.87, y: 0.82, zoom: 2.25 },
      portraitFit: 1,
      alt: 'Äpfel mit Blättern und Zimtstangen auf einem dunklen Holztisch',
    },
    storyboard: 'Draufsicht: Ein Messer schneidet Äpfel in feine Spalten.',
  },
  {
    sequence: 's02-teig',
    visible: [c('teig').start - 0.15, c('teig').end + 0.15],
    play: [c('teig').start - 0.15, c('teig').end + 0.15],
    fadeIn: 0.3,
    placeholder: {
      reference: 'pie-raw-topdown',
      from: { x: 0.25, y: 0.3, zoom: 2.0 },
      to: { x: 0.22, y: 0.74, zoom: 2.15 },
      portraitFit: 1,
      alt: 'Nudelholz, Zimtstangen und ein Messbecher mit Mehl auf einem Holztisch',
    },
    storyboard: 'Draufsicht: Mehl, Butter und Eier werden zu Teig, der Teig kommt in die Form.',
  },
  {
    sequence: 's03-fuellung',
    visible: [c('fuellung').start - 0.15, c('fuellung').end + 0.15],
    play: [c('fuellung').start - 0.15, c('fuellung').end + 0.15],
    fadeIn: 0.3,
    placeholder: {
      reference: 'pie-raw-topdown',
      from: { x: 0.57, y: 0.55, zoom: 2.0 },
      to: { x: 0.56, y: 0.53, zoom: 1.08 },
      portraitFit: 1,
      alt: 'Apfelspalten mit Zimtzucker in der Teigform, von oben fotografiert',
    },
    storyboard: 'Draufsicht: Apfelspalten werden Ring um Ring eingeschichtet, Zimt und Zucker darüber.',
  },
  {
    sequence: 's04-ofen',
    visible: [c('ofen').start - 0.15, c('ofen').end + 0.15],
    play: [c('ofen').start - 0.15, c('ofen').end + 0.15],
    fadeIn: 0.3,
    placeholder: {
      reference: 'cake-baked-steam',
      from: { x: 0.5, y: 0.56, zoom: 1.7 },
      to: { x: 0.5, y: 0.53, zoom: 1.35 },
      gradeFrom: { exposure: 0.42, warmth: 0.55, saturation: 1.15 },
      gradeTo: { exposure: 0.78, warmth: 0.25, saturation: 1.05 },
      portraitFit: 0.55,
      alt: 'Gebackener Apfelkuchen mit gefächerten Apfelspalten im warmen Licht',
    },
    storyboard: 'Zeitraffer durch die Ofenscheibe: Der Kuchen geht auf und wird goldbraun.',
  },
  {
    sequence: 's05-anrichten',
    visible: [c('anrichten').start - 0.15, c('anrichten').end],
    play: [c('anrichten').start - 0.15, c('anrichten').start + 0.95],
    fadeIn: 0.3,
    placeholder: {
      reference: 'cake-baked-steam',
      from: { x: 0.5, y: 0.52, zoom: 1.22 },
      to: { x: 0.5, y: 0.5, zoom: 1.0 },
      portraitFit: 0.35,
      alt: 'Frisch gebackener Apfelkuchen, von dem Dampf aufsteigt',
    },
    storyboard: 'Feste Kamera: Der dampfende Kuchen wird auf den Tisch gestellt. Letztes Bild = 3D-Startbild.',
  },
];

/** Dissolve from the last footage frame into the 3D scene. */
export const HANDOFF: [number, number] = [c('anrichten').start + 0.95, c('anrichten').end - 0.05];

/** The 3D scene is built in the background once the visitor gets close to it. */
export const PREPARE_3D_AT = c('teig').start;

/* ------------------------------------------------------------------ texts & overlays */

/** In/out positions of each chapter caption (timeline units). */
export const CAPTION_WINDOWS: Partial<Record<ChapterId, [number, number]>> = {
  aepfel: [c('aepfel').start + 0.15, c('aepfel').end - 0.25],
  teig: [c('teig').start + 0.15, c('teig').end - 0.25],
  fuellung: [c('fuellung').start + 0.15, c('fuellung').end - 0.25],
  ofen: [c('ofen').start + 0.15, c('ofen').end - 0.25],
  anrichten: [c('anrichten').start + 0.15, c('anrichten').end - 0.3],
  anschnitt: [c('anschnitt').start + 0.35, c('anschnitt').end - 0.3],
  kaffee: [c('kaffee').start + 0.3, c('kaffee').end - 0.15],
};

/** Opening: the cottage window opens and the camera moves through it. */
export const WINDOW_OPEN = {
  casements: [0.04, 0.5] as [number, number],
  zoom: [0.32, 0.88] as [number, number],
  titleOut: [0.22, 0.58] as [number, number],
};

/** Closing: the camera pulls back out through the window. */
export const WINDOW_CLOSE = {
  zoom: [c('finale').start + 0.05, c('finale').end - 0.2] as [number, number],
  line: [c('finale').end - 0.45, c('finale').end - 0.1] as [number, number],
};

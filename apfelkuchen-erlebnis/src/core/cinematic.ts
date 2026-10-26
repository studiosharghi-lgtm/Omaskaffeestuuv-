import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { Engine } from '../render/Engine';
import { pickQuality } from '../render/quality';
import type { FootageState } from '../render/FootageLayer';
import type { WorldFrame } from '../render/types';
import {
  CAPTION_WINDOWS,
  HANDOFF,
  NAV,
  NAV_VISIBLE,
  PREPARE_3D_AT,
  TOTAL,
  WINDOW_CLOSE,
  WINDOW_OPEN,
  chapter,
  type ChapterId,
} from '../content/story';
import { MANIFEST, hasModel, type ModelId } from '../content/media';

gsap.registerPlugin(ScrollTrigger, SplitText);

interface Options {
  onFatal: () => void;
}

const $ = <T extends Element>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * `?capture` turns the page into a frame source for the scroll video
 * (scripts/render-scrollfilm.mjs): no scrolling, no page chrome, and every frame is drawn on
 * request at an exact timeline position and clock. `&text=0` leaves out all texts so the
 * website can set them as real, editable HTML on top of the video; `&grain=` sets film grain
 * (default 0, because grain costs a lot of bitrate in a video file).
 */
interface CaptureOptions {
  text: boolean;
  grain: number;
}

function readCaptureOptions(): CaptureOptions | null {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('capture')) return null;
  const grain = Number.parseFloat(params.get('grain') ?? '0');
  return { text: params.get('text') !== '0', grain: Number.isFinite(grain) ? grain : 0 };
}

export interface FilmCapture {
  /** Timeline length in screens. */
  total: number;
  /** Draws timeline position `t` with the animation clock (steam, camera breathing) at `clock` seconds. */
  frame(t: number, clock: number): Promise<{ sceneMix: number }>;
}

export async function startCinematic({ onFatal }: Options): Promise<void> {
  const root = document.documentElement;
  const section = $<HTMLElement>(document, '#erlebnis');
  const stage = $<HTMLElement>(section, '.buehne');
  const canvas = $<HTMLCanvasElement>(stage, '.buehne__leinwand');
  const badge = $<HTMLElement>(stage, '.platzhalter');
  const loading = $<HTMLElement>(stage, '.buehne__laden');
  const nav = $<HTMLElement>(stage, '.kapitelnav');

  // Phones get a slightly shorter scroll distance for the same story.
  const lengthScale = window.matchMedia('(pointer: coarse)').matches ? 0.85 : 1;
  section.style.setProperty('--laenge', String(+(TOTAL * lengthScale).toFixed(3)));

  const capture = readCaptureOptions();
  if (capture) {
    root.classList.add('is-capture');
    root.classList.toggle('ohne-text', !capture.text);
  }

  let disposed = false;
  const splits: SplitText[] = [];
  let trigger: ScrollTrigger | null = null;
  let tl: gsap.core.Timeline | null = null;

  const engine = new Engine({
    canvas,
    quality: pickQuality(),
    motion: true,
    manual: capture !== null,
    onContextLost: () => {
      teardown();
      onFatal();
    },
  });
  if (capture) engine.setGrain(capture.grain);

  function teardown(): void {
    if (disposed) return;
    disposed = true;
    trigger?.kill();
    tl?.kill();
    splits.forEach((s) => s.revert());
    gsap.set(stage.querySelectorAll('.fenster, .fenster__fluegel, .auftakt, .kapitel__eintrag, .kapitel__text, .schlusszeile, .buehne__schleier, .kapitelnav'), {
      clearProps: 'all',
    });
    nav.replaceChildren();
    nav.hidden = true;
    badge.hidden = true;
    loading.hidden = true;
    root.classList.remove('auf-dunkel');
    section.style.removeProperty('--laenge');
    engine.dispose();
  }

  await Promise.all([document.fonts.ready, engine.footage.ready()]);
  if (disposed) return;
  engine.requestRender();

  /* ---------------------------------------------------------------- timeline */

  const timeline = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  tl = timeline;
  timeline.to({}, { duration: TOTAL }, 0);

  buildWindow(timeline, stage);
  buildCaptions(timeline, stage, splits);
  buildChrome(timeline, stage);

  /* ---------------------------------------------------------------- chapter navigation */

  nav.style.setProperty('--anzahl', String(NAV.length));
  const navButtons = NAV.map((entry, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'kapitelnav__punkt';
    const num = document.createElement('span');
    num.className = 'kapitelnav__nummer';
    num.textContent = String(i + 1);
    num.setAttribute('aria-hidden', 'true');
    b.append(num, entry.label);
    b.addEventListener('click', () => scrollToTime(entry.start + 0.04));
    nav.append(b);
    return b;
  });
  nav.hidden = false;

  function scrollToTime(time: number): void {
    if (!trigger) return;
    const y = trigger.start + (time / TOTAL) * (trigger.end - trigger.start);
    window.scrollTo({ top: y, behavior: 'smooth' });
  }

  /* ---------------------------------------------------------------- scroll binding */

  if (!capture) {
    trigger = ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: () => `+=${Math.max(1, section.offsetHeight - stage.offsetHeight)}`,
      // Native scrolling stays untouched; the timeline follows with a short, smooth catch-up.
      scrub: 0.6,
      animation: timeline,
      invalidateOnRefresh: true,
    });
  }

  let lastNavIndex = -1;
  const onTime = (t: number): void => {
    engine.setTime(t);
    updateChrome(t);
    if (t >= PREPARE_3D_AT) void prepareWorld();
  };

  // The header sits on the cream wall or on the dark film depending on where the window opening is.
  const brand = $<HTMLElement>(document, '.kopf__marke');
  const fenster = $<HTMLElement>(stage, '.fenster');
  const opening = $<HTMLElement>(stage, '.fenster__oeffnung');
  function brandOnFilm(): boolean {
    if (fenster.style.visibility === 'hidden') return true;
    const r = opening.getBoundingClientRect();
    const b = brand.getBoundingClientRect();
    const x = (b.left + b.right) / 2;
    const y = (b.top + b.bottom) / 2;
    return x > r.left && x < r.right && y > r.top && y < r.bottom;
  }

  function updateChrome(t: number): void {
    root.classList.toggle('auf-dunkel', brandOnFilm());

    let active = -1;
    NAV.forEach((entry, i) => {
      const p = Math.min(1, Math.max(0, (t - entry.start) / (entry.end - entry.start)));
      navButtons[i].style.setProperty('--fortschritt', p.toFixed(3));
      if (t >= entry.start && t < entry.end) active = i;
    });
    if (active !== lastNavIndex) {
      navButtons.forEach((b, i) => (i === active ? b.setAttribute('aria-current', 'step') : b.removeAttribute('aria-current')));
      lastNavIndex = active;
    }
    loading.hidden = !(t >= HANDOFF[0] - 0.15 && !engine.hasWorld());
  }

  timeline.eventCallback('onUpdate', () => onTime(timeline.time()));
  if (!capture) ScrollTrigger.refresh();
  onTime(timeline.time());
  engine.requestRender();

  /* ---------------------------------------------------------------- placeholder labels */

  const modelsArePlaceholders = MANIFEST.models.some((m) => !hasModel(m.id as ModelId));
  let lastBadge = '';
  engine.onRendered = (foot: FootageState, wf: WorldFrame | null) => {
    const t = engine.time;
    let html = '';
    const inIntro = t < WINDOW_OPEN.zoom[1] - 0.1;
    const inOutro = t > WINDOW_CLOSE.zoom[0] + 0.3;
    if (!inIntro && !inOutro) {
      const in3D = !!wf && wf.sceneMix > 0.5;
      if (in3D) {
        if (modelsArePlaceholders) html = '<strong>Platzhalter:</strong> 3D-Kuchen, Teller und Tasse sind nachgebaut, die Scans fehlen noch.';
      } else {
        const title = MANIFEST.sequences.find((s) => s.id === foot.clip.sequence)?.title ?? '';
        const no = foot.clip.sequence.slice(1, 3);
        if (foot.kind === 'reference') {
          html = `<strong>Platzhalter:</strong> Referenzfoto statt Filmsequenz ${no} „${title}“`;
        } else if (foot.kind === 'card') {
          html = `<strong>Platzhalter:</strong> Filmsequenz ${no} „${title}“ fehlt`;
        }
      }
    }
    if (html !== lastBadge) {
      badge.innerHTML = html;
      badge.hidden = html === '';
      lastBadge = html;
    }
  };

  /* ---------------------------------------------------------------- 3D world, built in the background */

  let worldPromise: Promise<void> | null = null;
  function prepareWorld(): Promise<void> {
    if (!worldPromise) {
      worldPromise = import('../world/World3D')
        .then(async ({ World3D }) => {
          const world = await World3D.create(engine.renderer, engine.quality, { motion: true });
          if (disposed) {
            world.dispose();
            return;
          }
          engine.setWorld(world);
          if (!capture) bindOrbit(world);
          updateChrome(engine.time);
        })
        .catch((error) => {
          console.error('Omas Apfelkuchen: 3D scene failed to load.', error);
          loading.textContent = 'Die 3D-Szene konnte nicht geladen werden.';
        });
    }
    return worldPromise;
  }

  if (capture) {
    await prepareWorld();
    engine.resize();
    const api: FilmCapture = {
      total: TOTAL,
      async frame(t, clock) {
        const time = Math.min(TOTAL, Math.max(0, t));
        timeline.time(time);
        onTime(time);
        await engine.footage.settle(time);
        engine.renderAt(clock * 1000);
        // let the compositor present both the canvas and the DOM layers before the screenshot
        await nextFrame();
        await nextFrame();
        return { sceneMix: engine.worldFrame?.sceneMix ?? 0 };
      },
    };
    (window as Window & { __omasFilm?: FilmCapture }).__omasFilm = api;
    root.dataset.capture = engine.hasWorld() ? 'bereit' : 'ohne-3d';
    return;
  }

  const ric = (window as Window & { requestIdleCallback?: Window['requestIdleCallback'] }).requestIdleCallback;
  if (ric) ric(() => void prepareWorld(), { timeout: 6000 });
  else setTimeout(() => void prepareWorld(), 2500);

  /* ---------------------------------------------------------------- pointer: drag to look around the table */

  function bindOrbit(world: { setOrbitInput(yaw: number, pitch: number): void }): void {
    let dragging = false;
    let startX = 0;
    let startYaw = 0;
    let dragYaw = 0;
    let hoverYaw = 0;
    let hoverPitch = 0;
    const push = () => {
      world.setOrbitInput(dragYaw + hoverYaw, hoverPitch);
      engine.requestRender();
    };
    canvas.addEventListener('pointermove', (e) => {
      if (dragging) {
        dragYaw = Math.max(-0.5, Math.min(0.5, startYaw + ((e.clientX - startX) / stage.clientWidth) * 1.5));
        push();
      } else if (e.pointerType === 'mouse') {
        hoverYaw = (e.clientX / window.innerWidth - 0.5) * 0.05;
        hoverPitch = (e.clientY / window.innerHeight - 0.5) * 0.035;
        push();
      }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startYaw = dragYaw;
      canvas.setPointerCapture(e.pointerId);
    });
    const end = () => {
      dragging = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      hoverYaw = hoverPitch = 0;
      push();
    });
  }
}

/* ------------------------------------------------------------------ timeline builders */

function buildWindow(tl: gsap.core.Timeline, stage: HTMLElement): void {
  const fenster = $<HTMLElement>(stage, '.fenster');
  const opening = $<HTMLElement>(stage, '.fenster__oeffnung');
  const left = $<HTMLElement>(stage, '.fenster__fluegel--links');
  const right = $<HTMLElement>(stage, '.fenster__fluegel--rechts');
  const title = $<HTMLElement>(stage, '.auftakt');

  const centre = () => ({
    x: opening.offsetLeft + opening.offsetWidth / 2,
    y: opening.offsetTop + opening.offsetHeight / 2,
  });
  const origin = () => `${centre().x}px ${centre().y}px`;
  // Scale at which the window opening covers the whole stage (plus room for the open casements).
  const coverScale = () => {
    const { x, y } = centre();
    const hw = opening.offsetWidth / 2;
    const hh = opening.offsetHeight / 2;
    const W = stage.clientWidth;
    const H = stage.clientHeight;
    return Math.max(x / hw, (W - x) / hw, y / hh, (H - y) / hh) * 1.3;
  };

  const [c0, c1] = WINDOW_OPEN.casements;
  tl.fromTo(left, { rotationY: 0 }, { rotationY: -104, duration: c1 - c0, ease: 'power2.inOut' }, c0);
  tl.fromTo(right, { rotationY: 0 }, { rotationY: 104, duration: c1 - c0 - 0.04, ease: 'power2.inOut' }, c0 + 0.04);

  const [z0, z1] = WINDOW_OPEN.zoom;
  tl.fromTo(
    fenster,
    { scale: 1, transformOrigin: origin },
    { scale: coverScale, transformOrigin: origin, duration: z1 - z0, ease: 'power3.in' },
    z0,
  );
  tl.set(fenster, { autoAlpha: 0 }, z1);

  const [o0, o1] = WINDOW_OPEN.titleOut;
  tl.fromTo(title, { autoAlpha: 1, y: 0 }, { autoAlpha: 0, y: -36, duration: o1 - o0, ease: 'power1.in' }, o0);

  const [f0, f1] = WINDOW_CLOSE.zoom;
  tl.set(fenster, { autoAlpha: 1 }, f0);
  tl.fromTo(
    fenster,
    { scale: coverScale, transformOrigin: origin },
    { scale: 1, transformOrigin: origin, duration: f1 - f0, ease: 'power3.out', immediateRender: false },
    f0,
  );
}

function buildCaptions(tl: gsap.core.Timeline, stage: HTMLElement, splits: SplitText[]): void {
  stage.querySelectorAll<HTMLElement>('.kapitel__eintrag').forEach((item) => {
    const id = item.dataset.kapitel as ChapterId;
    const win = CAPTION_WINDOWS[id];
    if (!win) return;
    const [tin, tout] = win;
    const heading = $<HTMLElement>(item, '.kapitel__titel');
    const text = $<HTMLElement>(item, '.kapitel__text');
    const split = SplitText.create(heading, { type: 'words', mask: 'words', wordsClass: 'wort', aria: 'auto' });
    splits.push(split);

    tl.set(item, { visibility: 'visible' }, tin - 0.01);
    tl.fromTo(split.words, { yPercent: 118 }, { yPercent: 0, duration: 0.34, stagger: 0.04, ease: 'power3.out' }, tin);
    tl.fromTo(text, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: 'power2.out' }, tin + 0.14);
    tl.to(split.words, { yPercent: -118, duration: 0.24, stagger: 0.025, ease: 'power2.in' }, tout);
    tl.to(text, { autoAlpha: 0, y: -10, duration: 0.2, ease: 'power1.in' }, tout);
    tl.set(item, { visibility: 'hidden' }, tout + 0.32);
  });

  const line = $<HTMLElement>(stage, '.schlusszeile');
  const [l0, l1] = WINDOW_CLOSE.line;
  tl.fromTo(line, { autoAlpha: 0, y: 22 }, { autoAlpha: 1, y: 0, duration: l1 - l0, ease: 'power2.out' }, l0);
}

function buildChrome(tl: gsap.core.Timeline, stage: HTMLElement): void {
  const scrim = $<HTMLElement>(stage, '.buehne__schleier');
  const nav = $<HTMLElement>(stage, '.kapitelnav');
  const [n0, n1] = NAV_VISIBLE;
  tl.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.4 }, n0);
  tl.to(scrim, { opacity: 0, duration: 0.3 }, chapter('finale').start);
  tl.fromTo(nav, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, n0);
  tl.to(nav, { autoAlpha: 0, duration: 0.25 }, n1);
}

/*!
 * Omas Apfelkuchen – Scrollfilm
 *
 * Shows a pre-rendered video frame by frame as the visitor scrolls: forwards plays the story,
 * backwards rewinds it. The page scrolls completely normally; this script only listens to the
 * scroll position and never touches the mouse wheel, touch gestures or keyboard.
 *
 * Without JavaScript, with "reduce motion" or with Data Saver the same section shows a calm
 * photo story instead (stills + texts), so nobody is left with an empty block.
 *
 * Markup and options: see README.md next to this file. No dependencies.
 */
(() => {
  'use strict';

  const mqReduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mqPortrait = window.matchMedia('(max-aspect-ratio: 1/1)');
  const mqCoarse = window.matchMedia('(pointer: coarse)');

  /* Moments that belong to the rendered video itself (timeline units of the story). */
  const TITLE_OUT = [0.22, 0.58]; // the opening title leaves while the window opens
  const SCRIM_IN = [0.85, 1.25]; // dark gradient behind the captions
  const SCRIM_OUT = [13.1, 13.4];
  const FRAME_ASPECT = { desktop: 16 / 9, mobil: 9 / 16 };

  const ramp = (a, b, t) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  const variantNow = () => (mqPortrait.matches ? 'mobil' : 'desktop');

  /**
   * Where the video frame sits on the stage (object-fit: cover), for texts anchored to the window.
   * Set on the section, where the CSS derives the space left of the window from it.
   */
  function layoutFrame(target, box) {
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (!w || !h) return;
    const aspect = FRAME_ASPECT[variantNow()];
    let fw = w;
    let fh = w / aspect;
    if (fh < h) {
      fh = h;
      fw = h * aspect;
    }
    target.style.setProperty('--film-links', `${((w - fw) / 2).toFixed(1)}px`);
    target.style.setProperty('--film-oben', `${((h - fh) / 2).toFixed(1)}px`);
    target.style.setProperty('--film-breite', `${fw.toFixed(1)}px`);
    target.style.setProperty('--film-hoehe', `${fh.toFixed(1)}px`);
  }

  /** Wraps each word of a heading in a mask so it can rise into place. */
  function splitWords(heading) {
    const text = heading.textContent.replace(/\s+/g, ' ').trim();
    heading.setAttribute('aria-label', text);
    const inner = document.createElement('span');
    inner.setAttribute('aria-hidden', 'true');
    text.split(' ').forEach((word, i) => {
      if (i) inner.append(' ');
      const mask = document.createElement('span');
      mask.className = 'omas-film__wort';
      const span = document.createElement('span');
      span.textContent = word;
      span.style.setProperty('--i', String(i));
      mask.append(span);
      inner.append(mask);
    });
    heading.replaceChildren(inner);
  }

  class Scrollfilm {
    constructor(section) {
      const d = section.dataset;
      this.section = section;
      this.stage = section.querySelector('.omas-film__buehne');
      this.video = section.querySelector('.omas-film__video');
      this.title = section.querySelector('.omas-film__auftakt');
      this.scrim = section.querySelector('.omas-film__schleier');
      this.schluss = section.querySelector('.omas-film__schluss');
      this.closingLine = section.querySelector('.omas-film__schlusszeile');
      this.posterBox = section.querySelector('.omas-film__poster');

      this.story = Number.parseFloat(d.story) || 14.3;
      this.frames = Number.parseInt(d.bilder, 10) || 600;
      this.sources = { desktop: d.filmDesktop, mobil: d.filmMobil };
      const screens = (Number.parseFloat(d.bildschirme) || this.story) * (mqCoarse.matches ? 0.85 : 1);
      section.style.setProperty('--omas-film-laenge', screens.toFixed(3));

      this.items = [...section.querySelectorAll('.omas-film__kapitel > li')].map((li) => ({
        li,
        from: Number.parseFloat(li.dataset.von),
        to: Number.parseFloat(li.dataset.bis),
        state: '',
      }));
      this.closingFrom = Number.parseFloat(this.schluss?.dataset.von) || this.story - 0.45;
      this.closingTo = Number.parseFloat(this.schluss?.dataset.bis) || this.story - 0.1;

      // Stills stand in while the video loads (and if it cannot be played at all).
      this.stills = [{ from: 0, img: null }];
      for (const it of this.items) {
        const img = it.li.querySelector('.omas-film__bild');
        if (img) this.stills.push({ from: it.from, img });
      }
      const finalImg = this.schluss?.querySelector('.omas-film__bild');
      if (finalImg) this.stills.push({ from: Number.parseFloat(this.schluss.dataset.bildAb) || this.story - 1.2, img: finalImg });

      this.interim = document.createElement('img');
      this.interim.className = 'omas-film__zwischenbild';
      this.interim.alt = '';
      this.interim.decoding = 'async';
      this.interim.setAttribute('aria-hidden', 'true');
      this.video.after(this.interim);

      this.loadingNote = document.createElement('p');
      this.loadingNote.className = 'omas-film__laden';
      this.loadingNote.textContent = 'Der Film lädt …';
      this.loadingNote.hidden = true;
      this.loadingNote.setAttribute('aria-hidden', 'true');
      this.stage.append(this.loadingNote);

      section.querySelectorAll('.omas-film__kapitel h3').forEach(splitWords);
      section.classList.add('ist-film');

      this.target = 0;
      this.shown = 0;
      this.first = true;
      this.raf = 0;
      this.last = 0;
      this.near = false;
      this.ready = false;
      this.failed = false;
      this.loadedVariant = null;
      this.loadToken = 0;
      this.objectUrl = null;
      this.lastFrame = -1;
      this.fps = 30;
      this.shownStill = null;

      this.tick = this.tick.bind(this);
      this.bind();
      this.resize();
    }

    bind() {
      const v = this.video;
      v.muted = true;
      v.playsInline = true;
      v.addEventListener('loadeddata', () => this.onVideoReady());
      v.addEventListener('seeked', () => {
        // Show the video only once it sits on the right frame (no flash of frame 1).
        if (this.ready && !this.section.classList.contains('ist-bereit')) {
          this.section.classList.add('ist-bereit');
          this.interim.classList.remove('ist-sichtbar');
          this.shownStill = null;
        }
        this.kick();
      });
      v.addEventListener('error', () => {
        this.failed = true;
        this.kick();
      });

      // Start loading about one and a half screens before the section arrives.
      const io = new IntersectionObserver(
        (entries) => {
          this.near = entries.some((e) => e.isIntersecting);
          if (this.near) {
            this.load();
            this.measure();
            this.kick();
          }
        },
        { rootMargin: '150% 0px 150% 0px' },
      );
      io.observe(this.section);

      window.addEventListener(
        'scroll',
        () => {
          if (!this.near) return;
          this.measure();
          this.kick();
        },
        { passive: true },
      );
      window.addEventListener('resize', () => {
        this.resize();
        this.kick();
      });
      mqPortrait.addEventListener('change', () => {
        this.resize();
        if (this.near) this.load();
        this.kick();
      });
    }

    resize() {
      layoutFrame(this.section, this.posterBox || this.stage);
      this.stickyTop = Number.parseFloat(getComputedStyle(this.stage).top) || 0;
      this.distance = Math.max(1, this.section.offsetHeight - this.stage.offsetHeight);
      this.measure();
      this.shown = this.target;
    }

    measure() {
      const top = this.section.getBoundingClientRect().top;
      this.target = Math.min(1, Math.max(0, (this.stickyTop - top) / this.distance));
      if (this.first) {
        this.shown = this.target;
        this.first = false;
      }
    }

    /* ---------------------------------------------------------------- video */

    load() {
      const variant = variantNow();
      if (this.loadedVariant === variant) return;
      this.loadedVariant = variant;
      this.ready = false;
      this.failed = false;
      this.lastFrame = -1;
      this.section.classList.remove('ist-bereit');
      const url = this.sources[variant] || this.sources.desktop;
      const token = ++this.loadToken;
      const use = (src) => {
        if (token !== this.loadToken) return;
        this.video.preload = 'auto';
        this.video.src = src;
        this.video.load();
      };
      // Downloading the whole file first makes every seek instant; streaming is the fallback
      // (e.g. when the page is opened from disk or the video lives on another domain).
      if (window.fetch && window.location.protocol !== 'file:') {
        fetch(url)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.blob();
          })
          .then((blob) => {
            if (token !== this.loadToken) return;
            if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
            this.objectUrl = URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
            use(this.objectUrl);
          })
          .catch(() => use(url));
      } else {
        use(url);
      }
    }

    onVideoReady() {
      const v = this.video;
      if (v.duration > 0 && Number.isFinite(v.duration)) this.fps = this.frames / v.duration;
      this.ready = true;
      this.lastFrame = -1;
      // iOS only paints seeked frames after the video has played once (muted, so this is allowed).
      const unlock = () => {
        const p = v.play();
        if (p && typeof p.then === 'function') {
          p.then(
            () => {
              v.pause();
              this.lastFrame = -1;
              this.kick();
            },
            () => {
              // Autoplay blocked (e.g. iPhone in Low Power Mode): retry on the first touch.
              const retry = () => unlock();
              window.addEventListener('touchstart', retry, { once: true, passive: true });
              window.addEventListener('pointerdown', retry, { once: true, passive: true });
            },
          );
        } else {
          v.pause();
        }
      };
      unlock();
      this.kick();
    }

    /* ---------------------------------------------------------------- drawing */

    kick() {
      if (!this.raf) {
        this.last = performance.now();
        this.raf = requestAnimationFrame(this.tick);
      }
    }

    tick(now) {
      this.raf = 0;
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      // a short, smooth catch-up, so wheel steps become motion instead of jumps
      this.shown += (this.target - this.shown) * (1 - Math.exp(-dt * 9));
      if (Math.abs(this.target - this.shown) < 0.00015) this.shown = this.target;
      const t = this.shown * this.story;
      const settled = this.drawFrame(t);
      this.drawTexts(t);
      if (!settled || this.shown !== this.target) this.raf = requestAnimationFrame(this.tick);
    }

    /** Returns true once the picture on screen matches `t`. */
    drawFrame(t) {
      if (this.ready && !this.failed) {
        const frame = Math.round((t / this.story) * (this.frames - 1));
        if (frame === this.lastFrame) return true;
        if (this.video.seeking) return false;
        this.lastFrame = frame;
        const time = (frame + 0.5) / this.fps;
        this.video.currentTime = Math.min(time, Math.max(0, this.video.duration - 0.001));
        return false;
      }

      // video not there (yet): the still of the current chapter
      let still = this.stills[0];
      for (const s of this.stills) if (t >= s.from) still = s;
      if (still !== this.shownStill) {
        this.shownStill = still;
        if (!still.img) {
          this.interim.classList.remove('ist-sichtbar');
        } else {
          const src = (variantNow() === 'mobil' && still.img.dataset.mobil) || still.img.currentSrc || still.img.src;
          if (this.interim.getAttribute('src') !== src) this.interim.src = src;
          this.interim.classList.add('ist-sichtbar');
        }
      }
      this.loadingNote.hidden = this.failed || t < 0.9;
      return true;
    }

    drawTexts(t) {
      const out = ramp(TITLE_OUT[0], TITLE_OUT[1], t);
      const e = out * out;
      this.title.style.opacity = (1 - e).toFixed(3);
      this.title.style.transform = `translateY(${(-36 * e).toFixed(1)}px)`;
      this.title.style.visibility = e >= 1 ? 'hidden' : '';

      if (this.scrim) {
        this.scrim.style.opacity = (ramp(SCRIM_IN[0], SCRIM_IN[1], t) * (1 - ramp(SCRIM_OUT[0], SCRIM_OUT[1], t))).toFixed(3);
      }

      if (this.closingLine) {
        const c = 1 - (1 - ramp(this.closingFrom, this.closingTo, t)) ** 3;
        this.closingLine.style.opacity = c.toFixed(3);
        this.closingLine.style.transform = `translateY(${(22 * (1 - c)).toFixed(1)}px)`;
      }

      for (const it of this.items) {
        const state = t < it.from ? 'vor' : t < it.to ? 'an' : 'nach';
        if (state === it.state) continue;
        // jumping straight from before to after (fast scrolling): no flash through the frame
        const jump = (it.state === 'vor' && state === 'nach') || (it.state === 'nach' && state === 'vor') || it.state === '';
        if (jump) {
          it.li.classList.add('ist-sprung');
          requestAnimationFrame(() => requestAnimationFrame(() => it.li.classList.remove('ist-sprung')));
        }
        it.li.dataset.zustand = state;
        it.state = state;
      }
    }
  }

  function setupCalm(section) {
    const box = section.querySelector('.omas-film__poster');
    if (!box) return;
    const layout = () => layoutFrame(section, box);
    layout();
    window.addEventListener('resize', layout);
  }

  function init(section) {
    if (!section || section.dataset.omasFilm) return;
    section.dataset.omasFilm = 'an';
    const saveData = navigator.connection && navigator.connection.saveData === true;
    const video = section.querySelector('.omas-film__video');
    const canPlay = !!video && typeof video.canPlayType === 'function' && video.canPlayType('video/mp4') !== '';
    if (mqReduce.matches || saveData || !canPlay || !('IntersectionObserver' in window)) {
      section.dataset.omasFilm = 'ruhig';
      setupCalm(section);
      return;
    }
    try {
      new Scrollfilm(section);
    } catch (error) {
      console.error('Omas Scrollfilm:', error);
      section.classList.remove('ist-film');
      setupCalm(section);
    }
  }

  window.OmasScrollfilm = { init };
  const start = () => document.querySelectorAll('.omas-film').forEach(init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

#!/usr/bin/env node
/*
 * Renders the scroll video ("Scrollfilm") for embedding on another website.
 *
 * The page is opened in headless Chromium with `?capture`, which draws every frame on request
 * at an exact timeline position (see src/core/cinematic.ts). Frames are saved as PNG and then
 * encoded into an MP4 that seeks well when a page scrubs it with the scroll position.
 *
 *   npm run build
 *   npm run film:render -- --variant desktop          # 16:9 video
 *   npm run film:render -- --variant mobil            # 9:16 video
 *
 * Result: scrollfilm/omas-scrollfilm/media/apfelkuchen-scrollfilm-<variant>.mp4 plus nine stills
 * (apfelkuchen-<variant>-01.jpg … 09.jpg) that the embed uses as poster, while loading and for the
 * calm version. See scrollfilm/README.md for embedding.
 *
 * Options
 *   --variant desktop|mobil   which framing to record (default desktop)
 *   --frames 600              number of frames for the whole story (default 600)
 *   --fps 30                  frame rate written into the file and used as animation clock
 *   --text                    bake the captions into the video (default: no texts; the embed sets them as HTML)
 *   --url http://…/           use an already running preview instead of starting `vite preview`
 *   --out <folder>            where the PNG frames go (default scrollfilm/render)
 *   --media <folder>          where video and stills go (default scrollfilm/omas-scrollfilm/media)
 *   --size 720x1280           size of the encoded video (default 1920x1080 / 720x1280)
 *   --crf 24 --gop 6          H.264 quality and keyframe distance (short GOP = fast seeking)
 *   --range 0-599             render only these frames (several processes can share the work)
 *   --quality high|medium|low 3D render quality (default high)
 *   --gpu                     use the machine's GPU instead of the software renderer
 *   --no-encode               only render frames
 *   --encode-only             only encode frames rendered earlier
 *
 * Rendering resumes where it stopped: existing frames are kept. Needs Playwright with Chromium
 * (`npm i -D playwright && npx playwright install chromium`) and ffmpeg for encoding.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    variant: 'desktop',
    frames: 600,
    fps: 30,
    text: false,
    url: null,
    out: 'scrollfilm/render',
    media: 'scrollfilm/omas-scrollfilm/media',
    range: null,
    gpu: false,
    encode: true,
    render: true,
    quality: 'high',
    size: null,
    crf: null,
    gop: 6,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--variant') args.variant = next();
    else if (a === '--frames') args.frames = Number.parseInt(next(), 10);
    else if (a === '--fps') args.fps = Number.parseFloat(next());
    else if (a === '--text') args.text = true;
    else if (a === '--url') args.url = next();
    else if (a === '--out') args.out = next();
    else if (a === '--range') args.range = next().split('-').map((n) => Number.parseInt(n, 10));
    else if (a === '--gpu') args.gpu = true;
    else if (a === '--quality') args.quality = next();
    else if (a === '--no-encode') args.encode = false;
    else if (a === '--encode-only') args.render = false;
    else if (a === '--media') args.media = next();
    else if (a === '--size') args.size = next().split('x').map((n) => Number.parseInt(n, 10));
    else if (a === '--crf') args.crf = Number.parseFloat(next());
    else if (a === '--gop') args.gop = Number.parseInt(next(), 10);
    else throw new Error(`Unknown option ${a}`);
  }
  if (!['desktop', 'mobil'].includes(args.variant)) throw new Error('--variant must be desktop or mobil');
  if (!(args.frames > 1)) throw new Error('--frames must be at least 2');
  return args;
}

const VARIANTS = {
  // CSS viewport × device pixel ratio = video size. The mobile frame is narrower than any phone
  // (9:16), so on phones the video always fills the height and the page layout lines up.
  desktop: { viewport: { width: 1920, height: 1080 }, scale: 1, mobile: false, size: [1920, 1080], crf: 24 },
  // rendered directly at 720×1280: plenty for phones and half the 3D render time of 1080×1920
  mobil: { viewport: { width: 540, height: 960 }, scale: 4 / 3, mobile: true, size: [720, 1280], crf: 24 },
};

/**
 * Story positions of the nine stills: opening, one per caption, closing.
 * They must match the order of the images in the embed markup (scrollfilm/vorschau.html).
 */
const STILLS = [0, 1.75, 3.55, 5.35, 7.0, 8.45, 11.45, 12.5, 14.3];
const STORY = 14.3;

const pad = (n) => String(n).padStart(5, '0');

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Preview server did not answer at ${url}`);
}

function startPreview(port) {
  const vite = join(root, 'node_modules', '.bin', 'vite');
  if (!existsSync(join(root, 'dist', 'index.html'))) throw new Error('No build found: run `npm run build` first.');
  const child = spawn(vite, ['preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
  return child;
}

async function renderFrames(args, framesDir) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Playwright is missing: npm i -D playwright && npx playwright install chromium');
  }

  const variant = VARIANTS[args.variant];
  const launchArgs = args.gpu
    ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization']
    : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const browser = await chromium.launch({ args: launchArgs });
  const context = await browser.newContext({
    viewport: variant.viewport,
    deviceScaleFactor: variant.scale,
    isMobile: variant.mobile,
    hasTouch: variant.mobile,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console]', m.text());
  });

  const url = new URL(args.url);
  url.searchParams.set('capture', '');
  url.searchParams.set('quality', args.quality);
  if (!args.text) url.searchParams.set('text', '0');
  await page.goto(url.toString(), { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.capture, null, { timeout: 15 * 60_000, polling: 500 });
  const state = await page.evaluate(() => document.documentElement.dataset.capture);
  if (state !== 'bereit') console.warn('Warning: the 3D scene did not load; the video will end on the footage.');
  const total = await page.evaluate(() => window.__omasFilm.total);

  const [from, to] = args.range ?? [0, args.frames - 1];
  const started = Date.now();
  let done = 0;
  for (let i = from; i <= Math.min(to, args.frames - 1); i++) {
    const file = join(framesDir, `${pad(i + 1)}.png`);
    if (existsSync(file) && statSync(file).size > 0) continue;
    const t = (i / (args.frames - 1)) * total;
    const clock = i / args.fps;
    const t0 = Date.now();
    const info = await page.evaluate(([tt, cc]) => window.__omasFilm.frame(tt, cc), [t, clock]);
    const t1 = Date.now();
    await page.screenshot({ path: file, type: 'png', timeout: 10 * 60_000 });
    done++;
    if (process.env.FILM_VERBOSE) {
      console.log(`frame ${i + 1}  t=${t.toFixed(3)}  draw ${((t1 - t0) / 1000).toFixed(1)} s  shot ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    } else if (done === 1 || done % 10 === 0) {
      const per = (Date.now() - started) / done / 1000;
      console.log(`frame ${i + 1}/${args.frames}  t=${t.toFixed(3)}  3D=${info.sceneMix.toFixed(2)}  ${per.toFixed(1)} s/frame`);
    }
  }
  await browser.close();
}

function encode(args, framesDir) {
  const count = readdirSync(framesDir).filter((f) => /^\d{5}\.png$/.test(f)).length;
  if (count < args.frames) {
    console.log(`${count}/${args.frames} frames present; encoding skipped until all are rendered.`);
    return;
  }
  const probe = spawnSync('ffmpeg', ['-version']);
  if (probe.status !== 0) {
    console.log('ffmpeg not found; frames are in', framesDir);
    return;
  }
  const mediaDir = resolve(root, args.media);
  mkdirSync(mediaDir, { recursive: true });
  const variant = VARIANTS[args.variant];
  const [w, h] = args.size ?? variant.size;
  const crf = args.crf ?? variant.crf;
  const scale = ['-vf', `scale=${w}:${h}:flags=lanczos`];
  const run = (cmd) => {
    console.log('ffmpeg', cmd.join(' '));
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...cmd], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error('ffmpeg failed');
  };

  // H.264 for every browser. A keyframe every few frames and no B-frames: a seek only has to
  // decode a handful of frames, so scrubbing stays smooth on phones too. faststart puts the index
  // at the front, so the browser knows the length right away.
  const mp4 = join(mediaDir, `apfelkuchen-scrollfilm-${args.variant}.mp4`);
  run([
    '-y', '-framerate', String(args.fps), '-i', join(framesDir, '%05d.png'),
    ...scale,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-profile:v', 'high',
    '-g', String(args.gop), '-keyint_min', String(args.gop), '-sc_threshold', '0', '-bf', '0',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4,
  ]);

  // Stills: poster (01), one per chapter, closing (09).
  STILLS.forEach((t, i) => {
    const frame = Math.round((t / STORY) * (args.frames - 1)) + 1;
    const out = join(mediaDir, `apfelkuchen-${args.variant}-${String(i + 1).padStart(2, '0')}.jpg`);
    run(['-y', '-i', join(framesDir, `${pad(frame)}.png`), ...scale, '-q:v', '3', out]);
  });
  console.log('Written:', mp4, `(${(statSync(mp4).size / 1048576).toFixed(1)} MB) and ${STILLS.length} stills`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(root, args.out);
  const framesDir = join(outDir, `frames-${args.variant}`);
  mkdirSync(framesDir, { recursive: true });

  if (args.render) {
    let preview = null;
    if (!args.url) {
      const port = 4183;
      preview = startPreview(port);
      args.url = `http://localhost:${port}/`;
      await waitForServer(args.url, 30_000);
    }
    try {
      await renderFrames(args, framesDir);
    } finally {
      preview?.kill();
    }
  }
  if (args.encode) encode(args, framesDir);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

# Omas Apfelkuchen — scroll experience

A pinned, scroll-driven film for Oma’s Kaffeestuuv: the visitor looks through the cottage window
into the bakery, watches the apple cake being made in real footage, and the last film frame
dissolves into a 3D table where the first slice is cut and served with a cappuccino.

- **Footage** — photographic image sequences scrubbed frame by frame with GSAP ScrollTrigger.
  Scrolling back plays everything in reverse; native scrolling is never hijacked.
- **3D** — Three.js final scene (cake, cut slice with apple filling, ceramic plate, fork,
  cappuccino with latte art and rising steam), its camera locked to the last film frame and then
  set free. Drag sideways in the final scene to look around.
- **One look** — footage and 3D go through the same composite pass (grade, vignette, grain), so
  the cut between them is hard to see.

> **Status:** no footage or scans exist yet. The page runs complete with **labelled placeholders**:
> the supplied reference photos stand in for the film (with virtual camera moves), and procedural 3D
> models stand in for the scans. `ASSETS.md` lists exactly what is still needed.

## Run

```bash
npm install
npm run dev          # http://localhost:5173, reloads when media files are added
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/
npm run media:check  # which footage/scans are present, which are placeholders
```

Node 18.18+ (tested with Node 22). `?quality=low|medium|high` overrides the automatic quality
level, useful for testing on phones.

## Editing

| What | Where |
|------|-------|
| German texts (captions, opening, visit section) | `index.html` |
| When things happen while scrolling (chapter lengths, caption timing, clip windows, dissolve) | `src/content/story.ts` |
| What stands in while footage is missing (which reference photo, virtual camera move) | `src/content/story.ts` → `CLIPS[].placeholder` |
| 3D camera path, focus pulls, slice motion, steam | `src/world/choreography.ts` |
| Camera of the last film frame (match on set, see `ASSETS.md` B) | `src/world/choreography.ts` → `HANDOFF_CAMERA` |
| Colours, type, layout | `src/styles/main.css` |

The timeline unit is one “screen”: scrolling by the height of the pinned stage advances the
story by 1. The story is 14.3 screens long (×0.85 on touch devices).

## Adding real media

1. Film the shots and convert them: `npm run media:frames -- clip.mov s01-aepfel --duration 4`
   (details and specs in `ASSETS.md`).
2. Put scans into `public/media/models/` and the final photo into `public/media/posters/`.
3. `npm run media:check`, then `npm run build`.

The build scans `public/media/` (plugin in `vite.config.ts`, logic in `scripts/media-inventory.mjs`)
and tells the page which frames and models exist, so it never requests a missing file. Each item
switches from placeholder to real on its own; the placeholder labels disappear accordingly.

## How it works

```
index.html                 content (German), works without JavaScript
src/main.ts                picks the animated or the calm version
src/core/cinematic.ts      GSAP timeline + ScrollTrigger, window opening, captions, chapter nav
src/render/Engine.ts       WebGL renderer: 3D → half-res depth of field → steam → composite
src/render/FootageLayer.ts which clip/frame is on screen, reference-photo placeholders
src/render/FrameLoader.ts  progressive, coarse-to-fine loading of image sequences
src/render/shaders.ts      composite (footage + 3D, tone mapping, grade, vignette, grain), bokeh
src/world/World3D.ts       the 3D table, camera matching, scans or procedural stand-ins
src/world/*.ts             cake geometry, procedural materials, tableware, props, light, steam
src/static/staticStory.ts  the calm version: stills + captions in reading order
```

- **Pinning** is CSS `position: sticky` driven by one ScrollTrigger with a short scrub
  (`scrub: 0.6`), which survives mobile address-bar resizing better than JS pinning.
- **Footage → 3D**: the 3D camera renders exactly the part of the last film frame that is on
  screen (a view offset into the measured film camera), then eases into its own lens and path.
- **Loading**: Three.js and the 3D scene are separate chunks, built in the background during the
  first chapters. Frames load coarse-to-fine around the scroll position and are released when far
  away. Rendering pauses when the stage is off screen or the tab is hidden.
- **Quality**: resolution, MSAA, shadow map and depth-of-field samples adapt to the device and
  step down automatically if frames take too long.

## Accessibility and fallbacks

- `prefers-reduced-motion`, or the **“Ruhige Ansicht”** button, shows the calm version: every
  chapter as a still with its caption in normal reading order. The 3D stills are rendered once.
- Without WebGL 2 the calm version uses photos only; without JavaScript the texts are still there.
- Captions are real HTML text; the canvas is decorative (`aria-hidden`). Keyboard users get a skip
  link to the address and opening hours, and the chapter navigation is made of buttons.

## Privacy

No third-party requests: fonts (Fraunces, Jost) are bundled from `@fontsource-variable`, no CDN,
no analytics. This matches the main site, which also self-hosts its fonts.

## Deploying next to the main site

`dist/` is self-contained with relative paths, so it can live in any sub-folder, e.g.
`https://omaskaffeestuuv.de/apfelkuchen/`. Link to it from the “So backt Oma” section of the main
site. The footer links to the main site for Impressum and Datenschutz; if this page is hosted on
its own, point those links at the real Impressum and Datenschutz pages.

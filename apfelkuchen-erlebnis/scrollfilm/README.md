# Omas Apfelkuchen – Scrollfilm (embed for the café website)

The apple cake story as a **pre-rendered video that plays with the page's scroll position**:
scrolling down plays it, scrolling up rewinds it. Scrolling itself stays completely normal; the
script never touches the mouse wheel, touch gestures or keys. Texts are real HTML on top of the
video, so they stay sharp, readable for screen readers and search engines, and editable.

`vorschau.html` is a working preview: open it through any web server (or directly from disk).

## What the video shows

The video is rendered from the scroll experience in this project (`npm run film:render`). The
chapters up to "Frisch aus dem Ofen" use the three supplied reference photos with camera moves; the
ending (slice, plate, cappuccino) is the procedural 3D stand-in. **There is no filmed baking footage
in it yet.** Once the film sequences and scans from `../ASSETS.md` exist, re-render and replace
the files in `omas-scrollfilm/media/`; the embed code stays the same.

## Files

```
omas-scrollfilm/
  omas-scrollfilm.css        styles, scoped to .omas-film
  omas-scrollfilm.js         15 KB (5 KB gzipped), no dependencies
  fonts/                     Fraunces + Jost (self-hosted, SIL Open Font License)
  media/
    apfelkuchen-scrollfilm-desktop.mp4   1920×1080, 600 frames (landscape screens)
    apfelkuchen-scrollfilm-mobil.mp4     720×1280, 600 frames (portrait screens)
    apfelkuchen-desktop-01…09.jpg        stills: poster, chapters, ending
    apfelkuchen-mobil-01…09.jpg
```

## Embedding

1. Upload the folder `omas-scrollfilm/` to the website (e.g. next to the page).
2. Copy everything between `ab hier kopieren` and `bis hier kopieren` from `vorschau.html` into
   the page where the film should appear. If the folder lives somewhere else, adjust the paths
   (`omas-scrollfilm/…`) in the snippet.
3. If the site has a **fixed header**, give the film its height so the film is not hidden under it:

   ```css
   :root { --omas-film-oben: 72px; }
   ```

4. Single-page sites that insert the section later can start it with
   `OmasScrollfilm.init(document.querySelector('.omas-film'))`.

The videos must be served as files (most hosts do). If they are on another domain, that domain
should allow CORS; otherwise the script streams them directly, which scrubs a little less smoothly.

## Editing

- **Texts**: edit them in the snippet. `data-von` / `data-bis` on each chapter set when its caption
  appears and leaves, on the film's timeline (0 to 14.3).
- **Scroll length**: `data-bildschirme="11"` on the section shortens the film to 11 screen
  heights of scrolling (default 14.3; phones use 85 % of it).
- The opening title and the closing line are placed relative to the window in the video, so they
  line up on every screen size.

## Behaviour

| Situation | What visitors see |
|---|---|
| Normal | The pinned film; the matching video (16:9 or 9:16) loads about 1.5 screens before the section, as one file, so seeking is instant. Until it is ready, the still of the current chapter is shown with a small "Der Film lädt …" note. |
| "Reduce motion" setting, Data Saver, no JavaScript, no MP4 support | A calm photo story: the opening, one still per chapter with its text, the ending. Nothing moves. |
| Keyboard | "Film überspringen" link at the start of the section. |
| iPhone in Low Power Mode | Videos may not be painted until the first touch; the script retries on the first touch automatically. |

Sizes: desktop video ≈ see `media/`, phone video is smaller; only one of them is loaded per visit.

## Re-rendering

In the project folder (needs Playwright with Chromium and ffmpeg):

```bash
npm run build
npm run film:render -- --variant desktop
npm run film:render -- --variant mobil
```

Frames go to `scrollfilm/render/`, the video and stills to `scrollfilm/omas-scrollfilm/media/`.
Rendering resumes where it stopped. Options are listed at the top of `scripts/render-scrollfilm.mjs`
(frame count, size, quality, `--gpu`). Without a GPU, the 3D part takes about 10 s per frame.

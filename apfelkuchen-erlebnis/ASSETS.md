# Asset requirements — Omas Apfelkuchen

Everything the experience still needs to become fully photographic. Until a file exists, the page
shows a **clearly labelled placeholder** (dashed “Platzhalter” badge + the “Platzhalter” list in the
header). Nothing here has been filmed or scanned yet; the build only references files that exist.

Check the current state at any time:

```bash
npm run media:check            # list what is present / missing
npm run media:check -- --strict  # exit code 1 while anything is missing (use before launch)
```

| # | What | Where | Status |
|---|------|-------|--------|
| A | 5 film sequences (desktop + mobile variant each) | `public/media/sequences/<id>/{desktop,mobile}/0001.webp…` | missing — reference photos stand in |
| B | Measured camera of the handoff frame (S05) | `src/world/choreography.ts` → `HANDOFF_CAMERA` | defaults fitted to the reference photo |
| C | 4 photogrammetry scans | `public/media/models/*.glb` | missing — procedural 3D stand-ins |
| D | 1 photo of the final table | `public/media/posters/finale.webp` | missing — reference photo / 3D still stand in |
| E | Approval of the German captions | `index.html` | draft |

---

## A. Film sequences

Five shots, played frame by frame as the visitor scrolls (forwards and backwards). Each shot is
delivered as two numbered WebP sequences: a 16:9 desktop variant and a 9:16 mobile variant.

| ID | Folder | Shows | Camera | Desktop | Mobile |
|----|--------|-------|--------|---------|--------|
| S01 | `s01-aepfel` | Hands slicing apples into thin wedges (skin on) | top-down, 90°, locked off or very slow slide | 96 frames (4 s) | 48 frames |
| S02 | `s02-teig` | Flour, butter, eggs become dough; dough pressed into a 26 cm springform | top-down, 90° | 96 frames (4 s) | 48 frames |
| S03 | `s03-fuellung` | Apple wedges laid ring by ring, cinnamon sugar sprinkled over | top-down, 90° | 96 frames (4 s) | 48 frames |
| S04 | `s04-ofen` | Time-lapse through the oven door: the cake rises and turns golden | front, through the glass | 84 frames (3.5 s) | 42 frames |
| S05 | `s05-anrichten` | The steaming cake is set down on the table; camera locked; **last 24 frames static** | low three-quarter view, see B | 72 frames (3 s) | 36 frames (separate vertical take) |

Frame counts are recommendations: the page uses however many contiguous frames exist
(`0001.webp`, `0002.webp`, …). More frames = smoother scrubbing, more data.

**Capture**

- 4K (3840×2160) or 6K, 24 fps (25 fps is fine), 180° shutter, log/raw profile.
  The mobile crop uses only the middle third of a 16:9 frame, hence the high resolution.
- S04: still photos every 30–40 s over the whole bake (≈ 90 photos), assembled into a clip.
- S05 mobile: shoot a **separate vertical take** (camera on its side) so the whole cake fits 9:16.
- Hands only, no faces (no model releases needed). No logos, text or watermarks.

**Look and continuity** (the 3D finale has to match this)

- Same wooden table, props (cinnamon sticks, crumbs, fork) and light in every shot.
- Main light: a large soft window or softbox **behind-left of the cake, about 40° high**; soft fill
  from the front-right; warm white (≈ 3800–4200 K). The 3D scene is lit the same way.
- Grade warm and natural, blacks rich but not clipped. Do **not** bake in grain, vignette or heavy
  LUTs: the page adds the same film grain, vignette and warmth to footage *and* 3D, which is what
  hides the cut between them.

**Delivery** — convert with the included script (needs `ffmpeg`):

```bash
npm run media:frames -- path/to/S01.mov s01-aepfel --start 00:00:03 --duration 4
npm run media:frames -- path/to/S05_vertical.mov s05-anrichten --only mobile --duration 3
```

This writes 1920×1080 desktop frames and 1080×1920 mobile frames (half frame rate) as WebP q74,
replacing older frames of that sequence. Budget per sequence: ≈ 8–11 MB desktop, ≈ 2–3 MB mobile.
Frames load progressively, coarse to fine, only near the visitor's scroll position.

---

## B. The handoff frame (S05 → 3D)

The last frame of S05 and the first frame of the 3D scene must be the same picture. The 3D camera
reproduces the film camera exactly, including whatever part of the frame the stage currently shows.

**On set**, for the final, static part of S05:

| | Desktop take (16:9) | Mobile take (9:16) |
|---|---|---|
| Camera distance in front of the cake centre | 0.54 m | 0.66 m |
| Lens height above the table top | 0.13 m | 0.16 m |
| Aimed at (above the cake centre) | 5.7 cm | 5.0 cm |
| Vertical field of view | 24° (≈ 48 mm on full-frame, 16:9) | 40° (≈ 50 mm on full-frame, camera turned vertical) |
| Cake | 26 cm Ø springform, centred, standing still | same |

Then **measure what was actually used** (distance, height, sideways offset, focal length, sensor
crop) and enter it in `src/world/choreography.ts`:

```ts
export const HANDOFF_CAMERA = {
  desktop: { pos: new Vector3(x, height, distance), target: new Vector3(0, aimHeight, 0), fov: verticalFovDeg, aspect: 16 / 9 },
  mobile:  { pos: new Vector3(x, height, distance), target: new Vector3(0, aimHeight, 0), fov: verticalFovDeg, aspect: 9 / 16 },
  // reference: fitted to the placeholder photo, no longer used once S05 exists
};
```

Units are metres; the cake centre on the table top is the origin, the camera looks towards −Z.
Vertical FOV from a full-frame focal length `f`: `2 · atan(sensorHeight / (2 · f))` with sensor
height 20.25 mm for a 16:9 crop of a full-frame sensor (36 mm when the camera is turned vertical).
Afterwards scroll to “Frisch aus dem Ofen” and nudge the values until the 3D cake sits exactly on
the filmed one during the dissolve.

---

## C. Photogrammetry scans

Real scans replace the procedural stand-ins automatically. The cake switches only when **both**
cake files exist, so body and slice always match.

| File | Content |
|------|---------|
| `public/media/models/cake-body.glb` | the same cake after the first slice was taken out (both cut faces visible) |
| `public/media/models/cake-slice.glb` | that first slice, scanned right after cutting |
| `public/media/models/plate.glb` | the stoneware plate, empty |
| `public/media/models/cup.glb` | cup on saucer with the cappuccino; latte art in the coffee texture |

**Conventions**

- glTF 2.0 binary (`.glb`), metres, Y up, table top at y = 0.
- `cake-body.glb` and `cake-slice.glb` share **one** coordinate frame: origin at the cake centre on
  the table, so body + slice placed at the origin form the whole cake. Cut the slice on the side
  facing the plate (front-right as seen from the S05 camera); the code reads the cut direction from
  the slice's position.
- `plate.glb`, `cup.glb`: origin at the bottom centre. The slice lands on the plate's flat well;
  its height is measured from the scan.
- Geometry ≤ 150 k triangles per cake file, ≤ 50 k for plate and cup.
- Textures: base colour 2048–4096 px (plus normal and roughness maps), WebP.
- Compress: `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 2048`
  (Meshopt is decoded by the page; Draco is not). Target ≤ 6 MB per cake file, ≤ 3 MB plate/cup.

**Capture tips**: turntable photogrammetry (e.g. RealityCapture, Metashape) with 150–250 photos,
cross-polarised flat light so no reflections are baked into the textures. Scan the slice within
minutes of cutting, while the filling is glossy. If the latte art smears in the scan, photograph
the coffee surface straight from above and use it as that face's texture.

---

## D. Photo of the final table

`public/media/posters/finale.webp` — 1920×1080 photo of the final composition (slice on the plate,
cappuccino behind it, same table and light), taken from roughly the final 3D camera angle.
Used by the calm version on devices without WebGL, and as the sharing image: once it exists,
add `<meta property="og:image" content="https://<final-url>/media/posters/finale.webp">` to `index.html`.

---

## E. Copy to approve (German)

Draft captions in `index.html`; please have the café confirm them. Lines that echo the existing
site are marked.

| Chapter | Heading | Text |
|---------|---------|------|
| Opening | Omas Apfelkuchen | Ein Blick in die Backstube von Oma’s Kaffeestuuv am Schönberger Strand. / Scrollen Sie langsam. Guter Kuchen braucht Zeit. |
| Äpfel | Zuerst die Äpfel. | Frisch und knackig, in feine Spalten geschnitten. |
| Teig | Dann der Teig. | Mehl, frische Butter und Eier. Keine Fertigmischung, nur das Gute. *(from the site)* |
| Füllung | Schicht um Schicht. | Die Apfelspalten kommen dicht an dicht auf den Teig, dazu Zimt und Zucker. |
| Ofen | Ab in den Ofen. | Bis er goldbraun ist und die ganze Stuuv nach Zimt duftet. |
| Aus dem Ofen | Frisch aus dem Ofen. | Er dampft noch. Ein paar Minuten Geduld. |
| Anschnitt | Das erste Stück. | Saftige Äpfel, zarter Teig, ein Hauch Zimt. |
| Kaffee | Dazu ein Cappuccino. | Und ein Fensterplatz in der Stuuv. |
| Closing | Wo die Zeit langsam wird. *(the café's tagline)* | |
| Visit | Ein Stück für Sie. | Omas Apfelkuchen nach Hausrezept, mit frischen Äpfeln und Zimt. … Promenade 15, 24217 Schönberg (Holstein), täglich 12:00–17:30 Uhr *(address and hours as on the site, October 2026)* |

The sequence shown on film should match the café's real recipe. If Oma's cake is made differently
(the site's own five steps describe a stirred batter that is turned out and topped with apples),
adjust the shot list and captions together.

---

## Reference photos (temporary)

`public/media/reference/` can hold the three photos supplied for art direction
(`pie-raw-topdown.webp`, `cake-baked-steam.webp`, `slice-cappuccino.webp`). They stand in for the
missing footage and are labelled as placeholders on the page. The folder is listed in `.gitignore`
because the photos' usage rights are not confirmed; without them the page shows storyboard cards
for the missing shots instead. Delete the folder once the real sequences are in place.

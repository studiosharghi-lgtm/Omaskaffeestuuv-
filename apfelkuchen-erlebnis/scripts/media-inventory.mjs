// Scans public/media/ against src/content/media.manifest.json.
// Shared by the Vite plugin (vite.config.ts) and the CLI (scripts/check-media.mjs),
// so the browser bundle only ever references media files that exist on disk.

import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const FRAME_PATTERN = /^(\d{4})\.(webp|avif|jpg|jpeg)$/i;

export function loadManifest(projectRoot) {
  const file = join(projectRoot, 'src', 'content', 'media.manifest.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Reads width/height from the first bytes of a WebP, JPEG or PNG file. Returns null if unknown. */
export function readImageSize(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const buf = Buffer.alloc(64 * 1024);
    const len = readSync(fd, buf, 0, buf.length, 0);
    const b = buf.subarray(0, len);

    // PNG
    if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    // WebP (RIFF....WEBP)
    if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8X') {
        return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
      }
      if (chunk === 'VP8 ') {
        return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
      }
    }
    // JPEG: walk segments to the first SOFn marker
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        const size = b.readUInt16BE(i + 2);
        const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSOF) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
        i += 2 + size;
      }
    }
  } catch {
    /* unreadable: treated as unknown size */
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

function scanSequenceVariant(dir, expected) {
  const result = { frames: 0, ext: null, width: null, height: null, bytes: 0, warnings: [] };
  if (!existsSync(dir)) return result;

  const files = readdirSync(dir).filter((f) => FRAME_PATTERN.test(f)).sort();
  if (files.length === 0) return result;

  const ext = files[0].split('.').pop().toLowerCase();
  // Count the contiguous run 0001, 0002, ... so a gap never produces a request for a missing file.
  let count = 0;
  const names = new Set(files.map((f) => f.toLowerCase()));
  while (names.has(`${String(count + 1).padStart(4, '0')}.${ext}`)) count++;

  if (count === 0) {
    result.warnings.push(`Numbering must start at 0001.${ext}`);
    return result;
  }
  if (count < files.length) {
    result.warnings.push(`Frame ${String(count + 1).padStart(4, '0')} is missing; only frames 0001–${String(count).padStart(4, '0')} are used.`);
  }
  if (files.some((f) => !f.toLowerCase().endsWith(`.${ext}`))) {
    result.warnings.push(`Mixed file types; only .${ext} frames are used.`);
  }

  let bytes = 0;
  for (let i = 1; i <= count; i++) {
    bytes += statSync(join(dir, `${String(i).padStart(4, '0')}.${ext}`)).size;
  }

  const size = readImageSize(join(dir, `0001.${ext}`));
  result.frames = count;
  result.ext = ext;
  result.width = size?.width ?? null;
  result.height = size?.height ?? null;
  result.bytes = bytes;

  if (size && expected) {
    const landscape = expected.width >= expected.height;
    if (landscape !== size.width >= size.height) {
      result.warnings.push(`Expected ${landscape ? 'landscape' : 'portrait'} frames (${expected.width}×${expected.height}), found ${size.width}×${size.height}.`);
    }
  }
  return result;
}

/**
 * @param {string} projectRoot  folder containing src/ and public/
 * @param {string} publicDir    absolute path of Vite's publicDir
 */
export function scanMedia(projectRoot, publicDir) {
  const manifest = loadManifest(projectRoot);
  const mediaDir = join(publicDir, 'media');
  const inventory = { sequences: {}, models: {}, posters: {}, reference: {} };

  for (const seq of manifest.sequences) {
    inventory.sequences[seq.id] = {};
    for (const [variant, spec] of Object.entries(seq.variants)) {
      inventory.sequences[seq.id][variant] = scanSequenceVariant(join(mediaDir, 'sequences', seq.id, variant), spec);
    }
  }
  for (const group of ['models', 'posters', 'reference']) {
    for (const item of manifest[group]) {
      const path = join(mediaDir, item.file);
      inventory[group][item.id] = existsSync(path) && statSync(path).size > 0;
    }
  }
  return { manifest, inventory };
}

/** Human-readable report of what is still missing. Returns { lines, missingCount }. */
export function describeMissing({ manifest, inventory }) {
  const lines = [];
  let missingCount = 0;

  for (const seq of manifest.sequences) {
    for (const variant of Object.keys(seq.variants)) {
      const v = inventory.sequences[seq.id][variant];
      const spec = seq.variants[variant];
      if (v.frames === 0) {
        missingCount++;
        // mobile variants run at half the frame rate (see scripts/extract-frames.sh)
        const frames = variant === 'mobile' ? Math.round(seq.recommended.frames / 2) : seq.recommended.frames;
        lines.push(`missing  sequence ${seq.id}/${variant}  (${seq.title}; ~${frames} frames, ${spec.width}×${spec.height})`);
      } else {
        const mb = (v.bytes / 1048576).toFixed(1);
        lines.push(`ok       sequence ${seq.id}/${variant}  ${v.frames} × .${v.ext} ${v.width ?? '?'}×${v.height ?? '?'}  ${mb} MB`);
      }
      for (const w of v.warnings) lines.push(`         ↳ ${w}`);
    }
  }
  for (const group of ['models', 'posters']) {
    for (const item of manifest[group]) {
      if (inventory[group][item.id]) {
        lines.push(`ok       ${group.slice(0, -1)} ${item.file}`);
      } else {
        missingCount++;
        lines.push(`missing  ${group.slice(0, -1)} ${item.file}  (${item.title})`);
      }
    }
  }
  return { lines, missingCount };
}

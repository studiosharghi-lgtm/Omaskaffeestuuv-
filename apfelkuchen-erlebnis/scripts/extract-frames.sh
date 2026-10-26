#!/usr/bin/env bash
# Turns a source clip into the frame sequences the page plays on scroll.
#
#   npm run media:frames -- <video> <sequence-id> [options]
#   bash scripts/extract-frames.sh <video> <sequence-id> [options]
#
# sequence-id: s01-aepfel | s02-teig | s03-fuellung | s04-ofen | s05-anrichten
#
# options:
#   --start <time>      start in the clip (e.g. 00:00:02.5)          default 0
#   --duration <sec>    length to use                                default: whole clip
#   --fps <n>           desktop frame rate (mobile gets half)         default 24
#   --crop-x <0..1>     horizontal centre of the portrait (mobile) crop default 0.5
#   --quality <0..100>  WebP quality                                  default 74
#   --only <variant>    desktop | mobile — e.g. a separate vertical take for mobile
#
# Writes public/media/sequences/<id>/desktop/0001.webp … (1920×1080)
#    and public/media/sequences/<id>/mobile/0001.webp …  (1080×1920, cropped from the centre)
# Existing frames of the written variant(s) are replaced. Shoot in 4K or higher: from a 16:9
# frame the portrait crop uses only the middle third. A vertical source is used full-frame.
# Run `npm run media:check` afterwards.

set -euo pipefail

usage() { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }

[[ $# -ge 2 ]] || usage
INPUT="$1"; ID="$2"; shift 2
START="0"; DURATION=""; FPS="24"; CROPX="0.5"; QUALITY="74"; ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --fps) FPS="$2"; shift 2 ;;
    --crop-x) CROPX="$2"; shift 2 ;;
    --quality) QUALITY="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

case "$ID" in
  s01-aepfel|s02-teig|s03-fuellung|s04-ofen|s05-anrichten) ;;
  *) echo "Unknown sequence id '$ID'. Use one of: s01-aepfel s02-teig s03-fuellung s04-ofen s05-anrichten" >&2; exit 1 ;;
esac
case "$ONLY" in ""|desktop|mobile) ;; *) echo "--only must be desktop or mobile" >&2; exit 1 ;; esac
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (https://ffmpeg.org)." >&2; exit 1; }
[[ -f "$INPUT" ]] || { echo "Video not found: $INPUT" >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/media/sequences/$ID"
VARIANTS=(desktop mobile)
[[ -n "$ONLY" ]] && VARIANTS=("$ONLY")
for V in "${VARIANTS[@]}"; do
  mkdir -p "$OUT/$V"
  # Old frames would otherwise extend the new sequence if the new clip is shorter.
  find "$OUT/$V" -maxdepth 1 -type f \( -name '*.webp' -o -name '*.avif' -o -name '*.jpg' -o -name '*.jpeg' \) -delete
done

TRIM=(-ss "$START")
[[ -n "$DURATION" ]] && TRIM+=(-t "$DURATION")
MOBILE_FPS=$(awk "BEGIN { print $FPS / 2 }")

if [[ " ${VARIANTS[*]} " == *" desktop "* ]]; then
  echo "→ desktop frames (1920×1080, ${FPS} fps)"
  ffmpeg -hide_banner -loglevel error -y "${TRIM[@]}" -i "$INPUT" \
    -vf "fps=${FPS},scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=1920:1080,format=yuv420p" \
    -c:v libwebp -quality "$QUALITY" -compression_level 6 -preset photo \
    "$OUT/desktop/%04d.webp"
fi

if [[ " ${VARIANTS[*]} " == *" mobile "* ]]; then
  echo "→ mobile frames (1080×1920, ${MOBILE_FPS} fps, crop centre x=${CROPX})"
  ffmpeg -hide_banner -loglevel error -y "${TRIM[@]}" -i "$INPUT" \
    -vf "fps=${MOBILE_FPS},crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-min(iw,ih*9/16))*${CROPX}':y='(ih-min(ih,iw*16/9))/2',scale=1080:1920:flags=lanczos,format=yuv420p" \
    -c:v libwebp -quality "$QUALITY" -compression_level 6 -preset photo \
    "$OUT/mobile/%04d.webp"
fi

for V in "${VARIANTS[@]}"; do
  N=$(find "$OUT/$V" -name '*.webp' | wc -l | tr -d ' ')
  S=$(du -sh "$OUT/$V" | cut -f1)
  echo "✓ $ID/$V: $N frames ($S)"
done
echo "  Next: npm run media:check, then npm run build (or reload npm run dev)."

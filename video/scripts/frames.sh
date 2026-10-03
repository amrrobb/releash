#!/usr/bin/env bash
# Extract one frame per caption cue (mid-cue) and at every shot boundary of the render, for checking by eye.
#   bash scripts/frames.sh [video]   -> out/frames/*.jpg
set -euo pipefail
cd "$(dirname "$0")/.."
V="${1:-out/releash-demo-nomusic.mp4}"
mkdir -p out/frames && rm -f out/frames/*.jpg
npx tsx -e '
import { timeline } from "./src/beats.ts";
for (const s of timeline()) {
  for (const [i, c] of s.cueTimes.entries()) console.log(`${(s.start + (c.start + c.end) / 2).toFixed(2)} ${s.id}-${i}`);
  console.log(`${(s.start + s.dur - 0.2).toFixed(2)} ${s.id}-end`);
}' | while read -r t name; do
  ffmpeg -loglevel error -y -ss "$t" -i "$V" -frames:v 1 -q:v 3 "out/frames/$(printf '%06.2f' "$t")-$name.jpg"
done
ls out/frames | wc -l

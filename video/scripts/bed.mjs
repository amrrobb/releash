// Mux a quiet, flat music bed under the rendered (silent, captions-only) cut.
//
//   node scripts/bed.mjs [track.mp3]     default: ~/Music/Walen - Gameboy (freetouse.com).mp3
//
// The track is the one the traderush video shipped (Free To Use licence, attribution in the description:
// see video/CREDITS.md). traderush's own bed.mp3 is NOT reused: it is arranged with dropouts at that film's cue
// times, which would land at random points here. This loops the original with a crossfade, normalises it to a
// low loudness (-30 LUFS, well under any voiceover), fades in over 2 s and out over 4 s, and writes
// out/releash-demo.mp4. out/releash-demo-nomusic.mp4 stays silent for recording a voiceover over it.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";

const VIDEO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const SRC = process.argv[2] ?? `${os.homedir()}/Music/Walen - Gameboy (freetouse.com).mp3`;
const IN = `${VIDEO}/out/releash-demo-nomusic.mp4`;
const OUT = `${VIDEO}/out/releash-demo.mp4`;
if (!existsSync(SRC)) throw new Error(`no track at ${SRC}`);
if (!existsSync(IN)) throw new Error(`render first: ${IN}`);
const probe = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
const dur = probe(IN), tdur = probe(SRC);
const XF = 4;
const copies = Math.max(2, Math.ceil((dur + XF) / (tdur - XF)));
const inputs = [];
for (let i = 0; i < copies; i++) inputs.push("-i", SRC);
let f = "", prev = "[1:a]";
for (let i = 2; i <= copies; i++) { const l = i === copies ? "[loop]" : `[x${i}]`; f += `${prev}[${i}:a]acrossfade=d=${XF}:c1=tri:c2=tri${l};`; prev = l; }
f += `[loop]atrim=0:${dur.toFixed(2)},loudnorm=I=-30:TP=-6:LRA=7,afade=t=in:d=2,afade=t=out:st=${(dur - 4).toFixed(2)}:d=4[a]`;
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", IN, ...inputs, "-filter_complex", f, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", "-movflags", "+faststart", OUT]);
console.log(`wrote ${OUT} (${dur.toFixed(1)} s, ${copies} copies of a ${tdur.toFixed(1)} s track)`);

// Write video/narration.txt from the same cues the captions use, with the timestamps of the rendered cut,
// so a voiceover can be recorded over the captions-only render line by line.
import { writeFileSync } from "node:fs";
import { timeline, WPS } from "../src/beats";

const tc = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const t = timeline();
const total = t[t.length - 1].start + t[t.length - 1].dur;
let out = `Releash demo video: narration with timestamps (render length ${tc(total)}, 30 fps).\n`;
out += `Generated from video/src/beats.ts by \`npm run narration\`. Timed at ${WPS} words a second.\n`;
out += `Each line starts at its timestamp; read it at a calm pace and it ends before the next one.\n\n`;
for (const s of t) {
  out += `## ${s.id}  [${tc(s.start)} - ${tc(s.start + s.dur)}]\n`;
  for (const c of s.cueTimes) out += `${tc(s.start + c.start)}  ${c.text}\n`;
  out += "\n";
}
writeFileSync(new URL("../narration.txt", import.meta.url), out);
console.log(out);

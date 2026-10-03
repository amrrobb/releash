// Cut one take into one clip per beat, at the marks the driver wrote after verifying each effect.
//
//   node scripts/slice.mjs            # TAKE=1 by default; reads marks/take-N.json + captures/take-N.webm
//
// Wall clock -> video time: both flashes are found in the video and mapped linearly. No offset is assumed.
// Every clip ends at its own beat's `end`, which the driver records BEFORE the next beat starts, so a clip can
// never show the next beat's state (e.g. LIQUIDATED inside the Friday-close clip).
// Clips are re-encoded at 30 fps (the composition's rate), yuv420p, keyframe every 15 frames, and padded with
// 8 s of the last frame so a shot that holds longer than its footage freezes instead of going black.
// Writes public/capture/<beat>.mp4 and src/clips.json (event times in clip seconds, rects, scraped text).
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const VIDEO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const TAKE = process.env.TAKE ?? "1";
const OUT = `${VIDEO}/public/capture`;
mkdirSync(OUT, { recursive: true });

function flashes(file) {
  // 8x8 thumbnails of every frame, with showinfo printing each frame's pts_time on stderr.
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-vf", "scale=8:8,showinfo", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });
  const times = [...r.stderr.toString().matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const buf = r.stdout, F = 8 * 8 * 3;
  const n = Math.min(times.length, Math.floor(buf.length / F));
  const magenta = [];
  for (let i = 0; i < n; i++) {
    let hits = 0;
    for (let p = 0; p < 64; p++) {
      const R = buf[i * F + p * 3], G = buf[i * F + p * 3 + 1], B = buf[i * F + p * 3 + 2];
      if (R > 200 && G < 80 && B > 200) hits++;
    }
    magenta.push(hits > 56);
  }
  // Onsets of magenta runs.
  const on = [];
  for (let i = 0; i < n; i++) if (magenta[i] && !magenta[i - 1]) on.push(times[i]);
  return { on, duration: times[n - 1] };
}

function mapper(marks, file) {
  const { on, duration } = flashes(file);
  if (on.length < 2) throw new Error(`${file}: found ${on.length} flash onsets, need 2 (start, end)`);
  const ws = marks.flashes.find((f) => f.name === "start").wall, we = marks.flashes.find((f) => f.name === "end").wall;
  const vs = on[0], ve = on[on.length - 1];
  const k = (ve - vs) / ((we - ws) / 1000);
  console.log(`  ${file.split("/").pop()}: flashes at ${vs.toFixed(2)}s and ${ve.toFixed(2)}s, wall span ${((we - ws) / 1000).toFixed(2)}s, rate ${k.toFixed(4)}, video ${duration.toFixed(1)}s`);
  if (Math.abs(k - 1) > 0.02) console.log("  WARNING: video/wall rate differs from 1 by more than 2%");
  return (w) => vs + ((w - ws) / 1000) * k;
}

function cut(file, name, from, to) {
  const out = `${OUT}/${name}.mp4`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", from.toFixed(3), "-i", file, "-t", (to - from).toFixed(3),
    "-vf", "fps=30,tpad=stop_mode=clone:stop_duration=8", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-g", "15", "-an", out]);
  return out;
}

const clips = {};
function sliceTake(marksFile, videoFile, plan) {
  const marks = JSON.parse(readFileSync(marksFile, "utf8"));
  if (!existsSync(videoFile)) throw new Error(`no ${videoFile}`);
  const v = mapper(marks, videoFile);
  for (const [name, { beat, from, to }] of Object.entries(plan)) {
    const b = marks.beats[beat];
    if (!b) { console.log(`  SKIP ${name}: beat "${beat}" has no verified mark in ${marksFile.split("/").pop()}`); continue; }
    const w0 = from(b), w1 = to(b);
    const v0 = v(w0), v1 = v(w1);
    cut(videoFile, name, v0, v1);
    const events = {};
    for (const [k, val] of Object.entries(b)) if (typeof val === "number" && k !== "start" && k !== "end") events[k] = Math.round(((val - w0) / 1000) * 100) / 100;
    events.start = Math.round(((b.start - w0) / 1000) * 100) / 100;
    events.end = Math.round(((b.end - w0) / 1000) * 100) / 100;
    clips[name] = { file: `capture/${name}.mp4`, dur: Math.round((v1 - v0) * 100) / 100, events, rects: b.rects ?? null, data: b.data ?? null, take: marks.take };
    console.log(`  ${name.padEnd(15)} ${v0.toFixed(2)}s -> ${v1.toFixed(2)}s (${(v1 - v0).toFixed(1)}s) events ${JSON.stringify(events)}`);
  }
}

// Each clip starts a little before its click (so the cursor and the press are on screen) and ends at the beat's
// own end. Never later: `end` is recorded before the next beat begins.
const S = 1000;
sliceTake(`${VIDEO}/marks/take-${TAKE}.json`, `${VIDEO}/captures/take-${TAKE}.webm`, {
  intro: { beat: "intro", from: (b) => b.effect, to: (b) => b.end },
  renew: { beat: "renew", from: (b) => b.click - 2.5 * S, to: (b) => b.end },
  lever: { beat: "lever", from: (b) => b.start, to: (b) => b.end },
  attempt: { beat: "attempt", from: (b) => b.click - 2 * S, to: (b) => b.end },
  decay: { beat: "decay", from: (b) => b.effect, to: (b) => b.end },
  close: { beat: "close", from: (b) => b.click - 2 * S, to: (b) => b.end },
  gap: { beat: "gap", from: (b) => b.click - 2 * S, to: (b) => b.end },
  revoke: { beat: "revoke", from: (b) => b.click - 2 * S, to: (b) => b.end },
  revokedAttempt: { beat: "revokedAttempt", from: (b) => b.click - 2 * S, to: (b) => b.end },
});
// The landing-page take (scripts/hero.mjs). hero-2 was filmed in the reset state; the first hero take ran during
// take 1 and showed a filled meter under the hero, so it is not used.
const HERO = process.env.HERO ?? "hero-2";
sliceTake(`${VIDEO}/marks/${HERO}.json`, `${VIDEO}/captures/${HERO}.webm`, { hero: { beat: "hero", from: (b) => b.start, to: (b) => b.end } });
writeFileSync(`${VIDEO}/src/clips.json`, JSON.stringify(clips, null, 2) + "\n");
console.log(`\nwrote src/clips.json with ${Object.keys(clips).length} clips`);

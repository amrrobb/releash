import React from "react";
import { AbsoluteFill, Easing, Freeze, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, FPS, H, MONO, SANS, W } from "./theme";

export type Rect = { x: number; y: number; w: number; h: number };

/** One continuous piece of a clip. `from` is clip seconds; `len` is shot seconds (the last part fills the rest).
 *  `cam` frames a rect of the recorded viewport (which IS the video frame: 1920x1080 at dsf 1). */
export type Part = { src?: string; still?: boolean; from: number; len?: number; cam?: Rect | [Rect, Rect]; camAt?: [number, number]; skip?: string };

const FULL: Rect = { x: 0, y: 0, w: W, h: H };

function transformFor(r: Rect) {
  // Scale so the rect fills the frame (never below 1, never past 2.4: the source is 1080p).
  const s = Math.max(1, Math.min(2.4, Math.min(W / r.w, H / r.h)));
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let tx = W / 2 - cx * s, ty = H / 2 - cy * s;
  // Never show past the edge of the recording.
  tx = Math.min(0, Math.max(W - W * s, tx));
  ty = Math.min(0, Math.max(H - H * s, ty));
  return { s, tx, ty };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const PartView: React.FC<{ src: string; part: Part; dur: number }> = ({ src, part, dur }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const [a, b] = Array.isArray(part.cam) ? part.cam : [part.cam ?? FULL, part.cam ?? FULL];
  const [t0, t1] = part.camAt ?? [0, Math.min(1.2, dur)];
  const k = interpolate(t, [t0, Math.max(t0 + 0.01, t1)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.45, 0, 0.2, 1) });
  const A = transformFor(a), B = transformFor(b);
  const s = lerp(A.s, B.s, k), tx = lerp(A.tx, B.tx, k), ty = lerp(A.ty, B.ty, k);
  return (
    <AbsoluteFill style={{ background: C.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }}>
        {part.still ? (
          // A held frame of a static screen (nothing on it is changing), used where the narration needs longer.
          <Freeze frame={0}>
            <OffthreadVideo src={staticFile(src)} startFrom={Math.round(part.from * FPS)} muted style={{ width: W, height: H }} />
          </Freeze>
        ) : (
          <OffthreadVideo src={staticFile(src)} startFrom={Math.round(part.from * FPS)} muted style={{ width: W, height: H }} />
        )}
      </AbsoluteFill>
      {part.skip && <SkipChip text={part.skip} />}
    </AbsoluteFill>
  );
};

/** A jump cut is labelled on screen with how much real time it skipped, so the edit stays honest. */
const SkipChip: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6, 2.2 * FPS, 2.6 * FPS], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 40, right: 48, opacity: o, fontFamily: MONO, fontSize: 30, color: "#fff", background: "rgba(11,13,16,0.88)", border: "none", borderRadius: 999, padding: "10px 22px" }}>
      ✂ {text}
    </div>
  );
};

export const Footage: React.FC<{ src: string; parts: Part[]; dur: number; live?: string }> = ({ src, parts, dur, live }) => {
  let at = 0;
  const fixed = parts.slice(0, -1).reduce((s, p) => s + (p.len ?? 0), 0);
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {parts.map((p, i) => {
        const len = i === parts.length - 1 ? Math.max(0.5, dur - fixed) : p.len ?? 1;
        const from = Math.round(at * FPS);
        at += len;
        return (
          <Sequence key={i} from={from} durationInFrames={Math.round(len * FPS)} layout="none">
            <PartView src={p.src ?? src} part={p} dur={len} />
          </Sequence>
        );
      })}
      {live && <LiveChip text={live} />}
    </AbsoluteFill>
  );
};

const LiveChip: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 8, 3.2 * FPS, 3.8 * FPS], [0, 1, 1, 0], { extrapolateRight: "clamp" });
  return (
  <div style={{ opacity: o, position: "absolute", top: 40, left: 48, display: "flex", alignItems: "center", gap: 12, fontFamily: SANS, fontWeight: 700, fontSize: 24, letterSpacing: "0.06em", textTransform: "uppercase", color: "#fff", background: "rgba(11,13,16,0.88)", border: "none", borderRadius: 999, padding: "10px 22px" }}>
    <span style={{ width: 12, height: 12, borderRadius: 6, background: "#3aa64c" }} />
    {text}
  </div>
  );
};

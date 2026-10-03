import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, FPS, SANS } from "./theme";

export type Cue = { text: string; start: number; end: number };

/** The narration, as subtitles. Same words as SUBMISSION.md's script (and video/narration.txt). */
export const Captions: React.FC<{ cues: Cue[] }> = ({ cues }) => {
  const f = useCurrentFrame();
  const t = f / FPS;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;
  const o = interpolate(t, [cue.start, cue.start + 0.15, cue.end - 0.15, cue.end], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, display: "flex", justifyContent: "center", opacity: o, pointerEvents: "none" }}>
      <div
        style={{
          maxWidth: 1560,
          fontFamily: SANS,
          fontWeight: 600,
          fontSize: 44,
          lineHeight: 1.3,
          color: "#ffffff",
          textAlign: "center",
          background: "rgba(11, 13, 16, 0.88)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          padding: "16px 34px",
          boxShadow: "0 12px 40px rgba(16,24,40,0.25)",
          textWrap: "balance",
        }}
      >
        {cue.text}
      </div>
    </div>
  );
};

import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { timeline, type Timed } from "./beats";
import { Captions } from "./Caption";
import { Closing, ColdOpen, Contract, Freeze, Title, Weekend } from "./Cards";
import { Footage } from "./Footage";
import clips from "./clips.json";
import { C, FPS } from "./theme";

const CARDS = { ColdOpen, Freeze, Weekend, Title, Contract, Closing } as const;

/** A short fade at every shot boundary, so cuts between cards and footage do not flash. */
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const f = useCurrentFrame();
  const o = interpolate(f, [0, 6, dur * FPS - 6, dur * FPS], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const ShotView: React.FC<{ s: Timed }> = ({ s }) => {
  const Card = s.card ? CARDS[s.card] : null;
  const clip = s.clip ? (clips as Record<string, { file: string }>)[s.clip] : null;
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Fade dur={s.dur}>
        {Card && <Card />}
        {clip && s.parts && <Footage src={clip.file} parts={s.parts} dur={s.dur} live={s.live} />}
      </Fade>
      <Captions cues={s.cueTimes} />
    </AbsoluteFill>
  );
};

export const Releash: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    {timeline().map((s) => (
      <Sequence key={s.id} from={Math.round(s.start * FPS)} durationInFrames={Math.round(s.dur * FPS)} name={s.id}>
        <ShotView s={s} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

export const totalFrames = () => {
  const t = timeline();
  const last = t[t.length - 1];
  return Math.round((last.start + last.dur) * FPS);
};

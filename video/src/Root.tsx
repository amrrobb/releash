import React from "react";
import { Composition } from "remotion";
import { Releash, totalFrames } from "./Releash";
import { FPS, H, W } from "./theme";

export const RemotionRoot: React.FC = () => (
  <Composition id="Releash" component={Releash} fps={FPS} width={W} height={H} durationInFrames={totalFrames()} />
);

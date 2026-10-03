import { useEffect, useState } from "react";
import { chainNow } from "./chain";

/** Chain-anchored "now" (seconds, fractional), refreshed every animation frame (capped ~30 fps). */
export function useChainNow(fps = 30): number {
  const [now, setNow] = useState(chainNow);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last >= 1000 / fps) {
        last = t;
        setNow(chainNow());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fps]);
  return now;
}

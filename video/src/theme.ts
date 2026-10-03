import { loadFont as loadSans } from "@remotion/google-fonts/InterTight";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// The app's own fonts (Inter Tight + JetBrains Mono), so the cards and the footage read as one product.
export const SANS = loadSans("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

// The redesigned light theme (web/src/styles.css at 6f05fed).
export const C = {
  bg: "#f7f8f9",
  surface: "#ffffff",
  surface2: "#f2f3f5",
  line: "#e6e8eb",
  line2: "#d6d9de",
  text: "#0b0d10",
  muted: "#5f6672",
  dim: "#5f6672",
  green: "#1d7f36",
  greenUi: "#3aa64c",
  greenSoft: "#eef8e8",
  red: "#c42b1c",
  redSoft: "#fdecea",
  amber: "#b26b00",
  violet: "#5a48e0",
  violetSoft: "#efedfd",
  ink: "#0b0d10",
} as const;

export const FPS = 30;
export const W = 1920;
export const H = 1080;

import { loadFont as loadSans } from "@remotion/google-fonts/HankenGrotesk";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// The app's own tokens (web/src/styles.css), so the cards and the footage read as one product.
export const SANS = loadSans("normal", { weights: ["400", "500", "600", "700", "800"], subsets: ["latin"] }).fontFamily;
export const MONO = loadMono("normal", { weights: ["400", "500", "600"], subsets: ["latin"] }).fontFamily;

export const C = {
  bg: "#0a0c0b",
  surface: "#111413",
  surface2: "#171b19",
  line: "#222826",
  line2: "#2d3431",
  text: "#edf1ee",
  muted: "#929b96",
  dim: "#5f6863",
  green: "#00c805",
  greenSoft: "rgba(0, 200, 5, 0.12)",
  red: "#ff5000",
  redSoft: "rgba(255, 80, 0, 0.12)",
  amber: "#f2b33d",
} as const;

export const FPS = 30;
export const W = 1920;
export const H = 1080;

import { CUTOFF_HALVINGS, LIQ_THRESHOLD_BPS } from "../config";

/**
 * Port of ReleashVault.limitAt, but with a fractional `elapsed` so the meter drains smoothly between
 * reads. At integer seconds it equals the contract (up to integer rounding).
 * Halves every half-life, interpolates linearly toward the next halving inside a period, zero from
 * CUTOFF_HALVINGS half-lives on.
 */
export function limitAt(base: number, elapsed: number, halfLife: number): number {
  if (elapsed < 0) elapsed = 0;
  const periods = Math.floor(elapsed / halfLife);
  if (periods >= CUTOFF_HALVINGS) return 0;
  const halved = base / 2 ** periods;
  return halved - (halved * (elapsed % halfLife)) / (2 * halfLife);
}

/** USDG has 6 decimals, rNVDA 18, the feed 8. */
export const usd = (raw: bigint) => Number(raw) / 1e6;
export const stock = (raw: bigint) => Number(raw) / 1e18;
export const px8 = (raw: bigint) => Number(raw) / 1e8;

/** Price at which LTV reaches the liquidation threshold: debt / (collateral * 0.70). */
export function liquidationPrice(collateral: bigint, debt: bigint): number | null {
  if (collateral === 0n || debt === 0n) return null;
  return usd(debt) / (stock(collateral) * (LIQ_THRESHOLD_BPS / 10_000));
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

export const fmtUsd = (n: number) => money.format(n);
export const fmtUsd0 = (n: number) => money0.format(n);
export const fmtNum = (n: number) => num.format(n);
export const fmtPct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export function fmtDuration(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtAgo(s: number): string {
  s = Math.max(0, Math.floor(s));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

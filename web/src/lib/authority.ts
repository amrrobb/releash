import { CUTOFF_HALVINGS, DEPLOYMENT } from "../config";
import { limitAt, usd } from "./math";
import { hasAgent, type VaultState } from "./reads";

/**
 * The agent's add-debt permission, derived client-side from the chain state and a chain-anchored clock
 * (ReleashVault.limitAt with fractional elapsed). Reduce-debt never depends on any of this.
 */
export type Phase = "none" | "unrenewed" | "revoked" | "expired" | "paused" | "decaying";

export type Authority = {
  phase: Phase;
  base: number; // ceiling at full strength (USDG)
  ceiling: number; // authority now (USDG)
  debt: number;
  canAdd: number;
  halfLife: number;
  elapsed: number; // since renewal
  period: number; // halvings passed
  countdown: number; // seconds to the next halving (or to zero in the last period)
  live: boolean; // renewed, not revoked, not expired
};

export function authorityOf(state: VaultState | undefined, now: number): Authority {
  const m = state?.mandate;
  const halfLife = state?.halfLife ?? DEPLOYMENT.halfLife;
  const base = m ? usd(m.authorityBase) : 0;
  const debt = state ? usd(state.position.debt) : 0;
  const last = m ? Number(m.lastRenewed) : 0;
  const elapsed = last ? Math.max(0, now - last) : 0;
  const period = Math.floor(elapsed / halfLife);
  const live = hasAgent(m) && !m!.revoked && last > 0 && period < CUTOFF_HALVINGS;
  const ceiling = live ? limitAt(base, elapsed, halfLife) : 0;
  const canAdd = Math.max(0, ceiling - debt);
  const phase: Phase = !hasAgent(m) ? "none" : m!.revoked ? "revoked" : last === 0 ? "unrenewed" : !live ? "expired" : canAdd > 0 ? "decaying" : "paused";
  return { phase, base, ceiling, debt, canAdd, halfLife, elapsed, period, countdown: halfLife - (elapsed % halfLife), live };
}

/** Label and one-line explanation for the "Add debt" row, per phase. */
export const ADD_DEBT: Record<Phase, { label: string; line: string }> = {
  none: { label: "Not set", line: "Appoint an agent and give it a debt ceiling." },
  unrenewed: { label: "Waiting for World ID", line: "The agent cannot add debt until a person renews it." },
  revoked: { label: "Revoked", line: "You stopped new debt. Reducing debt stays allowed." },
  expired: { label: "Permission expired", line: "Nobody renewed for three half-lives. Renew to restore it." },
  paused: { label: "Paused", line: "The permission ceiling is now below your debt." },
  decaying: { label: "Decaying", line: "The agent may borrow up to the ceiling, which halves every half-life." },
};

export const fmtHalfLife = (s: number) => (s % 60 === 0 && s < 3600 ? `${s / 60}-minute` : s % 3600 === 0 ? `${s / 3600}-hour` : `${s}-second`);

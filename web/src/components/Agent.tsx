import { lazy, Suspense } from "react";
import type { Address, WalletClient } from "viem";
import { ABI, DEPLOYMENT, WORLD_APP_ID, WORLD_SIMULATE } from "../config";
import { ADD_DEBT, fmtHalfLife, type Authority, type Phase } from "../lib/authority";
import { fmtDuration, fmtUsd, fmtUsd0 } from "../lib/math";
import { useRenew, RENEW_ACTION } from "../lib/renew";
import { useTx } from "../lib/tx";
import { ArrowRight, ArrowUp, Check, Minus, Pause } from "./icons";

const WorldIdWidget = lazy(() => import("./WorldIdWidget"));

export function TxLine({ tx }: { tx: ReturnType<typeof useTx> }) {
  if (tx.error) return <p className="txstatus txstatus--err txline" role="alert">{tx.error.message}</p>;
  if (tx.done) return <p className="txstatus txstatus--ok txline" role="status">Confirmed on-chain.</p>;
  return null;
}

const pct = (v: number, base: number) => (base > 0 ? Math.min(100, Math.max(0, (v / base) * 100)) : 0);

/** The "Agent debt ceiling" scale: $0 to the full-strength ceiling, the live ceiling as a knob, your debt as a mark. */
export function CeilingBar({ a, compact = false }: { a: Authority; compact?: boolean }) {
  const knob = pct(a.ceiling, a.base);
  const debt = pct(a.debt, a.base);
  // Two labels above the bar (compact) push apart when the marks are close.
  const near = Math.abs(knob - debt) < 16;
  const debtShift = compact && near ? (debt <= knob ? "translateX(-100%)" : "translateX(0)") : undefined;
  const knobShift = compact && near ? (debt <= knob ? "translateX(-20%)" : "translateX(-100%)") : undefined;
  return (
    <div className="ceiling" data-testid="authority-meter">
      <div className="ceiling__track" aria-hidden>
        <div className="ceiling__rail" />
        <div className="ceiling__fill" style={{ width: `${knob}%` }} />
        {a.debt > 0 && a.base > 0 && (
          <>
            <div className="ceiling__debt" style={{ left: `${debt}%` }} />
            <div className="ceiling__debtlbl num" style={{ left: `${Math.min(92, Math.max(8, debt))}%`, transform: debtShift }}>
              {compact ? "Current debt" : `Your debt ${fmtUsd0(a.debt)}`}
              <span>{compact ? fmtUsd0(a.debt) : `(${debt.toFixed(2)}%)`}</span>
            </div>
          </>
        )}
        <div className="ceiling__knob" style={{ left: `${knob}%` }} />
        {compact && (
          <div className="ceiling__debtlbl num" style={{ left: `${Math.min(92, Math.max(8, knob))}%`, transform: knobShift }}>
            Your ceiling<span>{fmtUsd0(a.ceiling)}</span>
          </div>
        )}
      </div>
      <div className="ceiling__scale num">
        {knob > 9 && <span className="lo">$0</span>}
        {!compact && (
          <span className="ceiling__knoblbl" style={{ left: `${Math.min(90, Math.max(8, knob))}%` }}>
            Ceiling {fmtUsd0(a.ceiling)}
            <span>({knob.toFixed(2)}%)</span>
          </span>
        )}
        {knob < 88 && <span className="hi">{fmtUsd0(a.base)}</span>}
      </div>
      <p className="sr" role="img" aria-label={`Agent debt ceiling ${fmtUsd(a.ceiling)} of ${fmtUsd(a.base)}; your debt ${fmtUsd(a.debt)}`} />
    </div>
  );
}

const ICON: Record<Phase, { cls: string; el: React.ReactElement; tone: string }> = {
  decaying: { cls: "violet", el: <ArrowUp />, tone: "violet" },
  paused: { cls: "violet", el: <Pause />, tone: "violet" },
  unrenewed: { cls: "grey", el: <Pause />, tone: "grey" },
  expired: { cls: "grey", el: <Pause />, tone: "grey" },
  revoked: { cls: "grey", el: <Minus />, tone: "grey" },
  none: { cls: "grey", el: <Minus />, tone: "grey" },
};

export function ReduceRow({ hasAgent, tinted = false }: { hasAgent: boolean; tinted?: boolean }) {
  return (
    <div className={tinted ? "reduce" : "power"}>
      <span className="power__icon power__icon--green"><Check /></span>
      <div>
        <h3>Reduce debt</h3>
        <p>{hasAgent ? "Your agent can sell collateral to repay the loan, even after permission expires." : "Appoint an agent to let it repay for you. You can always repay yourself."}</p>
      </div>
      <span className="power__state power__state--green">{hasAgent ? "Always allowed" : "You only"}</span>
    </div>
  );
}

export function AddRow({ a, renewing }: { a: Authority; renewing: boolean }) {
  const s = ADD_DEBT[a.phase];
  const i = ICON[a.phase];
  return (
    <div className="power">
      <span className={`power__icon power__icon--${i.cls}`}>{i.el}</span>
      <div>
        <h3>Add debt</h3>
        <p>{renewing ? "Renewal in progress: waiting for the proof and the chain." : s.line}</p>
      </div>
      <span className={`power__state power__state--${i.tone}`}>{renewing ? "Renewing…" : s.label}</span>
    </div>
  );
}

export function Figures({ a, canLabel = "Can borrow now", ceilLabel = "Agent debt ceiling" }: { a: Authority; canLabel?: string; ceilLabel?: string }) {
  return (
    <div className="figures">
      <div>
        <div className="mid num" data-testid="authority-value">{fmtUsd(a.ceiling)}</div>
        <div className="lbl">{ceilLabel}</div>
      </div>
      <div>
        <div className="mid num" data-testid="can-add">{fmtUsd(a.canAdd)}</div>
        <div className="lbl">{canLabel}</div>
      </div>
    </div>
  );
}

export function CeilingNote({ a }: { a: Authority }) {
  const hl = `${fmtHalfLife(a.halfLife)} demo half-life`;
  if (!a.live) {
    return <p className="ceiling__note">{a.phase === "revoked" ? "Renew to allow new debt again" : a.phase === "none" ? "No agent appointed" : "Renew to restore the ceiling"} · {hl}</p>;
  }
  const last = a.period === 2;
  return (
    <p className="ceiling__note">
      {a.phase === "paused" ? "Borrowing resumes only when the ceiling exceeds your debt." : "The ceiling halves every half-life unless you renew."}
      <br />
      {last ? "Drops to zero in " : "Next halving in "}
      <span className="countdown num">{fmtDuration(a.countdown)}</span> · {hl}
    </p>
  );
}

/** Renew and Revoke state, owned by the card so the "Add debt" row can show "Renewing…". */
export function useAgentControls(owner?: Address, agent?: Address, wallet?: WalletClient) {
  const renewTx = useTx(wallet);
  const revokeTx = useTx(wallet);
  const r = useRenew(renewTx, owner, agent);
  return { owner, agent, renewTx, revokeTx, r };
}

/**
 * Renew (simulated on this deployment) and Revoke. `.renew` and `.mandate` wrap their status lines: the
 * rehearsal and video drivers wait for `.renew .txstatus--ok` and `.mandate .txstatus--ok`.
 */
export function AgentActions({ c, a, disabledReason, fine }: { c: ReturnType<typeof useAgentControls>; a: Authority; disabledReason?: string; fine: React.ReactNode }) {
  const { owner, agent, renewTx, revokeTx, r } = c;
  const blocked = !!disabledReason || !owner;
  const revoke = () => revokeTx.run("revoke", [{ address: DEPLOYMENT.vault, abi: ABI.vault, functionName: "revoke", args: [] }]);
  return (
    <>
      <div className="actions-row">
        <div className="renew">
          {WORLD_SIMULATE ? (
            <button className="btn btn--dark btn--lg" onClick={r.simulate} disabled={blocked || !agent || r.busy} data-testid="simulate">
              {r.stage ?? "Renew with World ID (simulated)"} <ArrowRight />
            </button>
          ) : (
            <button className="btn btn--dark btn--lg" onClick={r.startReal} disabled={blocked || !agent || r.busy || !WORLD_APP_ID} data-testid="renew">
              {r.stage ?? "Renew with World ID"} <ArrowRight />
            </button>
          )}
          {r.err && <p className="txstatus txstatus--err txline" role="alert">{r.err}</p>}
          <TxLine tx={renewTx} />
        </div>
        <div className="mandate">
          <button className="btn btn--line btn--lg" onClick={revoke} disabled={blocked || a.phase === "none" || a.phase === "revoked" || !!revokeTx.pending} data-testid="revoke">
            {revokeTx.pending ? "Revoking…" : "Revoke"}
          </button>
          <TxLine tx={revokeTx} />
        </div>
        <div className="fine">{fine}</div>
      </div>
      {disabledReason && <p className="warn">{disabledReason}</p>}
      {r.ctx && owner && (
        <Suspense fallback={null}>
          <WorldIdWidget ctx={r.ctx} appId={WORLD_APP_ID} action={RENEW_ACTION} signal={owner} open={r.open} onOpenChange={r.setOpen} onSuccess={(res) => r.finish(res)} onError={(c) => r.setErr(`World ID: ${c}`)} />
        </Suspense>
      )}
    </>
  );
}

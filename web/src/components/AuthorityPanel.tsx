import { useEffect, useState } from "react";
import { getAddress, isAddress, parseUnits, type Address } from "viem";
import { ABI, CUTOFF_HALVINGS, DEPLOYMENT } from "../config";
import { fmtDuration, fmtUsd, limitAt, short, usd } from "../lib/math";
import { hasAgent, type VaultState } from "../lib/reads";
import { useTx } from "../lib/tx";
import { useChainNow } from "../lib/useNow";
import { RenewWorldId } from "./RenewWorldId";
import { TxStatus } from "./TxStatus";

const V = { address: DEPLOYMENT.vault, abi: ABI.vault };
const HALF_LIFE = DEPLOYMENT.halfLife;

type Phase = "none" | "unrenewed" | "revoked" | "decayed" | "live";

export function AuthorityPanel({ owner, state }: { owner?: Address; state?: VaultState }) {
  const now = useChainNow();
  const m = state?.mandate;
  const base = m ? usd(m.authorityBase) : 0;
  const debt = state ? usd(state.position.debt) : 0;
  const lastRenewed = m ? Number(m.lastRenewed) : 0;
  const elapsed = Math.max(0, now - lastRenewed);
  const period = Math.floor(elapsed / HALF_LIFE);

  const phase: Phase = !hasAgent(m) ? "none" : m!.revoked ? "revoked" : lastRenewed === 0 ? "unrenewed" : period >= CUTOFF_HALVINGS ? "decayed" : "live";
  const authority = phase === "live" ? limitAt(base, elapsed, HALF_LIFE) : 0;
  const canAdd = Math.max(0, authority - debt);
  const fill = base > 0 ? authority / base : 0;
  const debtMark = base > 0 ? Math.min(1, debt / base) : 0;
  const countdown = HALF_LIFE - (elapsed % HALF_LIFE);
  const ring = countdown / HALF_LIFE;

  const headline: Record<Phase, string> = {
    none: "No agent appointed",
    unrenewed: "Waiting for World ID",
    revoked: "Revoked",
    decayed: "Decayed to zero",
    live: "",
  };
  const subline: Record<Phase, string> = {
    none: "Appoint an agent and give it a debt ceiling below.",
    unrenewed: "The agent cannot add debt until a human renews it.",
    revoked: "You stopped the agent from adding debt. It can still deleverage.",
    decayed: `Nobody renewed for ${CUTOFF_HALVINGS} half-lives. The agent may only reduce risk.`,
    live: "",
  };

  return (
    <section className="panel authority" aria-labelledby="auth-h">
      <header className="panel__head">
        <h2 id="auth-h">Agent authority</h2>
        <span className="quiet">half-life {fmtDuration(HALF_LIFE)}{HALF_LIFE < 3600 ? " (demo)" : ""}</span>
      </header>

      <div className={`meter meter--${phase}`} data-testid="authority-meter">
        <div className="meter__top">
          <div>
            <div className="meter__value num" data-testid="authority-value">
              {phase === "live" ? fmtUsd(authority) : fmtUsd(0)}
            </div>
            <div className="meter__caption">
              {phase === "live" ? (
                <>max debt the agent may bring you to · of {fmtUsd(base)} at full strength</>
              ) : (
                <>
                  <strong>{headline[phase]}.</strong> {subline[phase]}
                </>
              )}
            </div>
          </div>
          {phase === "live" && (
            <div className="countdown" aria-label="Next halving">
              <svg viewBox="0 0 44 44" aria-hidden>
                <circle cx="22" cy="22" r="19" className="countdown__bg" />
                <circle cx="22" cy="22" r="19" className="countdown__fg" style={{ strokeDashoffset: `${(1 - ring) * 119.4}` }} />
              </svg>
              <div>
                <div className="num countdown__time">{fmtDuration(countdown)}</div>
                <div className="countdown__label">{period === CUTOFF_HALVINGS - 1 ? "until zero" : "next halving"}</div>
              </div>
            </div>
          )}
        </div>

        <div className="meter__track">
          <div className="meter__fill" style={{ width: `${fill * 100}%` }} />
          {[0.5, 0.25, 0.125].map((t, i) => (
            <div key={t} className={`meter__tick ${period > i && phase === "live" ? "passed" : ""}`} style={{ left: `${t * 100}%` }}>
              <span>{["½", "¼", "⅛"][i]}</span>
            </div>
          ))}
          {debt > 0 && base > 0 && (
            <div className="meter__debt" style={{ left: `${debtMark * 100}%` }} title="Current debt">
              <span>debt</span>
            </div>
          )}
        </div>
        <div className="meter__foot quiet">
          {phase === "live" ? `Renewed ${fmtDuration(elapsed)} ago with World ID` : phase === "decayed" ? `Last renewed ${fmtDuration(elapsed)} ago` : " "}
        </div>
      </div>

      <ul className="asym">
        <li className="asym__row asym__row--yes">
          <span className="asym__mark" aria-hidden>✓</span>
          <div>
            <strong>Can always reduce risk</strong>
            <span>Deleverage 10% or 30% at any time. Survives revoke and decay.{phase === "none" && " (Needs an agent.)"}</span>
          </div>
        </li>
        <li className={`asym__row ${canAdd > 0 ? "asym__row--live" : "asym__row--no"}`}>
          <span className="asym__mark" aria-hidden>{canAdd > 0 ? "+" : "×"}</span>
          <div>
            <strong>
              Can add debt: <span className="num" data-testid="can-add">{canAdd > 0 ? `up to ${fmtUsd(canAdd)}` : "$0.00"}</span>
              {canAdd > 0 && <em> decaying</em>}
            </strong>
            <span>
              {canAdd > 0
                ? "Authority minus current debt. Halves every half-life unless you renew."
                : phase === "live"
                  ? "Your debt is already at the agent's ceiling."
                  : "Renew with World ID to restore it."}
            </span>
          </div>
        </li>
      </ul>

      <RenewWorldId owner={owner} agent={hasAgent(m) ? m!.agent : undefined} disabled={!hasAgent(m)} />

      <MandateControls owner={owner} state={state} />
    </section>
  );
}

function MandateControls({ owner, state }: { owner?: Address; state?: VaultState }) {
  const m = state?.mandate;
  const current = hasAgent(m) ? m!.agent : undefined;
  const preset = (DEPLOYMENT as { agent?: Address }).agent;
  const [agent, setAgent] = useState("");
  const [base, setBase] = useState("9000");
  const tx = useTx();

  // Prefill once the chain tells us what the mandate is.
  useEffect(() => {
    if (agent) return;
    if (current) setAgent(current);
    else if (preset) setAgent(preset);
  }, [current, preset, agent]);
  useEffect(() => {
    if (m && m.authorityBase > 0n) setBase(String(usd(m.authorityBase)));
  }, [m?.authorityBase]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = isAddress(agent) && Number(base) >= 0;
  const changesAgent = valid && current && getAddress(agent) !== current;

  const set = () => tx.run("mandate", [{ ...V, functionName: "setMandate", args: [getAddress(agent), parseUnits(base || "0", 6)] }]);
  const revoke = () => tx.run("revoke", [{ ...V, functionName: "revoke", args: [] }]);
  const fire = () => tx.run("fire", [{ ...V, functionName: "fire", args: [] }]);

  return (
    <div className="mandate">
      <h3>Mandate</h3>
      <div className="mandate__grid">
        <label className="field field--stack">
          <span className="label">Agent address</span>
          <input value={agent} onChange={(e) => setAgent(e.target.value.trim())} placeholder="0x…" spellCheck={false} data-testid="agent-input" />
        </label>
        <label className="field field--stack">
          <span className="label">Authority ceiling (USDG)</span>
          <input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="base-input" />
        </label>
      </div>
      {changesAgent && <p className="warn">A new agent starts unrenewed: it needs a fresh World ID proof before it can add debt.</p>}
      <div className="mandate__buttons">
        <button className="btn btn--secondary" onClick={set} disabled={!owner || !valid || !!tx.pending} data-testid="set-mandate">
          {tx.pending === "mandate" ? "Confirming…" : current ? "Update mandate" : "Appoint agent"}
        </button>
        {current && <span className="quiet">Current: <span className="mono">{short(current)}</span></span>}
      </div>

      <div className="kill">
        <div className="kill__row">
          <button className="btn btn--outline" onClick={revoke} disabled={!current || m?.revoked || !!tx.pending} data-testid="revoke">
            {tx.pending === "revoke" ? "Revoking…" : "Revoke"}
          </button>
          <span>Agent stops adding debt, instantly. It can still deleverage you.</span>
        </div>
        <div className="kill__row">
          <button className="btn btn--danger" onClick={fire} disabled={!current || !!tx.pending} data-testid="fire">
            {tx.pending === "fire" ? "Firing…" : "Fire"}
          </button>
          <span>Removes the agent entirely, including its right to deleverage.</span>
        </div>
      </div>
      <TxStatus tx={tx} />
    </div>
  );
}

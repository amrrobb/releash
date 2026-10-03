import { useEffect, useState } from "react";
import { getAddress, isAddress, maxUint256, parseUnits, type Address } from "viem";
import { Activity } from "../components/Activity";
import { AddRow, AgentActions, CeilingBar, CeilingNote, Figures, ReduceRow, TxLine, useAgentControls } from "../components/Agent";
import { ArrowUpRight, ChevronRight } from "../components/icons";
import { Market } from "../components/Market";
import { ABI, AGENT_ADDRESS, DEPLOYMENT, LIQ_THRESHOLD_BPS, MAX_LTV_BPS } from "../config";
import { ADD_DEBT, authorityOf, type Phase } from "../lib/authority";
import { fmtNum, fmtUsd, liquidationPrice, px8, short, stock, usd } from "../lib/math";
import { hasAgent, useVault, type VaultState } from "../lib/reads";
import { useSigner } from "../lib/signer";
import { useTx, type Call } from "../lib/tx";
import { useChainNow } from "../lib/useNow";

const V = { address: DEPLOYMENT.vault, abi: ABI.vault };
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

function LtvBar({ state }: { state?: VaultState }) {
  const ltv = state && Number.isFinite(state.ltvBps) ? state.ltvBps : state ? 10_000 : 0;
  const cur = Math.min(100, ltv / 100);
  const zone = ltv > LIQ_THRESHOLD_BPS ? " ltv__fill--bad" : ltv > MAX_LTV_BPS ? " ltv__fill--warn" : "";
  // Labels above the marks: keep "Current" clear of "Borrow limit" when they nearly touch.
  const curShift = Math.abs(cur - 50) < 9 ? (cur <= 50 ? "translateX(-100%)" : "translateX(0)") : undefined;
  const limShift = Math.abs(cur - 50) < 9 ? (cur <= 50 ? "translateX(-10%)" : "translateX(-90%)") : undefined;
  const liq = state ? liquidationPrice(state.position.collateral, state.position.debt) : null;
  const price = state ? px8(state.price8) : 0;
  return (
    <div className="ltv" role="meter" aria-label="Loan to value" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(cur)}>
      <div className="ltv__head">
        <span className="ltv__title">Loan to value (LTV)</span>
      </div>
      <div className="ltv__track">
        <div className="ltv__rail" />
        <div className={`ltv__fill${zone}`} style={{ width: `${cur}%` }} />
        <div className="ltv__mark" style={{ left: "50%" }} />
        <div className="ltv__mark ltv__mark--liq" style={{ left: "70%" }} />
        {state && state.position.debt > 0n && <div className="ltv__knob" style={{ left: `${cur}%` }} />}
        <div className="ltv__lbl ltv__lbl--cur num" style={{ left: `${Math.max(4, cur)}%`, transform: curShift }}><span className="w">Current</span><b>{state ? pct(ltv) : "—"}</b></div>
        <div className="ltv__lbl num" style={{ left: "50%", transform: limShift }}><span className="w">Borrow limit</span><b style={{ fontWeight: 400 }}>50.0%</b></div>
        <div className="ltv__lbl num" style={{ left: "70%" }}><span className="w">Liquidation</span><b style={{ fontWeight: 400 }}>70.0%</b></div>
      </div>
      <div className="ltv__scale num"><span>0%</span><span>100%</span></div>
      <p className="ltv__liq num">
        <span>Liquidation price {liq ? fmtUsd(liq) : "—"}</span>
        {liq && price > 0 && <><i aria-hidden /><span>{Math.abs(((price - liq) / price) * 100).toFixed(1)}% {liq < price ? "below" : "above"} current price</span></>}
      </p>
    </div>
  );
}

function PositionCard({ state }: { state?: VaultState }) {
  const equity = state ? usd(state.value) - usd(state.position.debt) : undefined;
  return (
    <section className="card pos" aria-labelledby="pos-h">
      <h2 id="pos-h" className="card__title">Your position</h2>
      <div className="big num" style={{ marginTop: 14, fontSize: 52 }}>{equity === undefined ? "—" : fmtUsd(equity)}</div>
      <div className="cap">Your equity</div>
      <div className="pos__row">
        <div>
          <div className="mid num">{state ? fmtUsd(usd(state.value)) : "—"}</div>
          <div className="lbl">Collateral<br /><span className="num">{state ? `${fmtNum(stock(state.position.collateral))} rNVDA` : "rNVDA"}</span></div>
        </div>
        <div>
          <div className="mid num">{state ? fmtUsd(usd(state.position.debt)) : "—"}</div>
          <div className="lbl">Debt<br />USDG</div>
        </div>
      </div>
      <LtvBar state={state} />
    </section>
  );
}

type Action = "deposit" | "borrow" | "repay" | "withdraw";
const TABS: { id: Action; label: string; title: string; unit: "rNVDA" | "USDG" }[] = [
  { id: "deposit", label: "Deposit", title: "Deposit rNVDA", unit: "rNVDA" },
  { id: "borrow", label: "Borrow", title: "Borrow USDG", unit: "USDG" },
  { id: "repay", label: "Repay", title: "Repay USDG", unit: "USDG" },
  { id: "withdraw", label: "Withdraw", title: "Withdraw rNVDA", unit: "rNVDA" },
];

function TradeCard({ owner, state }: { owner?: Address; state?: VaultState }) {
  const s = useSigner();
  const [action, setAction] = useState<Action>("borrow");
  const [amount, setAmount] = useState("");
  const tx = useTx();
  const tab = TABS.find((t) => t.id === action)!;
  const value = state ? usd(state.value) : 0;
  const debt = state ? usd(state.position.debt) : 0;
  const price = state ? px8(state.price8) : 0;
  const col = state ? stock(state.position.collateral) : 0;
  const amt = Number(amount) || 0;
  const maxBorrow = Math.max(0, value * 0.5 - debt);
  const maxWithdraw = debt === 0 ? col : Math.max(0, col - debt / 0.5 / (price || 1));
  const after =
    action === "borrow" ? (debt + amt) / (value || 1)
    : action === "repay" ? Math.max(0, debt - amt) / (value || 1)
    : action === "deposit" ? debt / (value + amt * price || 1)
    : debt / Math.max(1e-9, value - amt * price);
  const avail =
    action === "borrow" ? ["Available to borrow", fmtUsd(maxBorrow)]
    : action === "repay" ? ["Debt outstanding", fmtUsd(debt)]
    : action === "deposit" ? ["In your wallet", `${fmtNum(state ? stock(state.walletStock) : 0)} rNVDA`]
    : ["Withdrawable at 50% LTV", `${fmtNum(maxWithdraw)} rNVDA`];

  function calls(): Call[] {
    if (!state || !owner) return [];
    const raw = parseUnits(amount || "0", tab.unit === "rNVDA" ? 18 : 6);
    const list: Call[] = [];
    if (action === "deposit" && state.allowStock < raw) list.push({ address: DEPLOYMENT.rnvda, abi: ABI.stock, functionName: "approve", args: [DEPLOYMENT.vault, maxUint256] });
    if (action === "repay" && state.allowUsdg < raw) list.push({ address: DEPLOYMENT.usdg, abi: ABI.usdg, functionName: "approve", args: [DEPLOYMENT.vault, maxUint256] });
    list.push({ ...V, functionName: action, args: action === "repay" ? [owner, raw] : [raw] });
    return list;
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await tx.run(action, calls)) setAmount("");
  }
  function fillMax() {
    if (!state) return;
    const v = action === "deposit" ? stock(state.walletStock) : action === "withdraw" ? maxWithdraw : action === "repay" ? Math.min(debt, usd(state.walletUsdg)) : maxBorrow;
    setAmount(String(Math.max(0, Math.floor(v * 100) / 100)));
  }
  const faucet = () =>
    tx.run("faucet", [
      { address: DEPLOYMENT.rnvda, abi: ABI.stock, functionName: "mint", args: [owner, parseUnits("100", 18)] },
      { address: DEPLOYMENT.usdg, abi: ABI.usdg, functionName: "mint", args: [owner, parseUnits("10000", 6)] },
    ]);

  return (
    <section className="card trade" aria-label="Manage your loan">
      <div className="tabs" role="tablist" aria-label="Action">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === action} onClick={() => { setAction(t.id); setAmount(""); tx.clear(); }}>{t.label}</button>
        ))}
      </div>
      {!owner ? (
        <div style={{ display: "grid", gap: 12 }}>
          <h2>Connect to manage a position</h2>
          <p className="muted">Anyone can play the borrower: connect a wallet on Robinhood Chain testnet, or use the shared demo account.</p>
          <button className="btn btn--dark" onClick={s.connectInjected}>Connect wallet</button>
          {s.demoAvailable && <button className="btn btn--line" onClick={s.useDemo} data-testid="use-demo">Use the demo account</button>}
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          <h2>{tab.title}</h2>
          <label className="amount">
            <span className="sr">{tab.title} amount</span>
            <input inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="amount" />
            <span className="amount__unit">{tab.unit}</span>
            <button type="button" className="link" onClick={fillMax}>Max</button>
          </label>
          <div className="kv num">
            <div><span>{avail[0]}</span><b>{avail[1]}</b></div>
            <div><span>LTV after {action === "borrow" ? "borrowing" : action === "repay" ? "repaying" : action === "deposit" ? "depositing" : "withdrawing"}</span><b>{state && amt > 0 ? `${(after * 100).toFixed(1)}%` : "—"}</b></div>
          </div>
          <button className="btn btn--dark" disabled={!amt || !!tx.pending} data-testid="submit-action">{tx.pending && tx.pending !== "faucet" ? "Confirming…" : tab.title}</button>
          <TxLine tx={tx} />
        </form>
      )}
      <div className="trade__foot num">
        <span>Wallet: {state ? `${fmtNum(stock(state.walletStock))} rNVDA · ${fmtNum(usd(state.walletUsdg))} USDG` : "—"}</span>
        <button className="link" onClick={faucet} disabled={!owner || !!tx.pending} data-testid="faucet">{tx.pending === "faucet" ? "Minting…" : "Get test tokens"} <ArrowUpRight /></button>
      </div>
    </section>
  );
}

const BADGE: Record<Phase, string> = { none: "badge--grey", unrenewed: "badge--grey", revoked: "badge--grey", expired: "badge--grey", paused: "badge--violet", decaying: "badge--violet" };

function PermissionsCard({ owner, state }: { owner?: Address; state?: VaultState }) {
  const s = useSigner();
  const now = useChainNow();
  const a = authorityOf(state, now);
  const m = state?.mandate;
  const current = hasAgent(m) ? m!.agent : undefined;
  const c = useAgentControls(owner, current, s.wallet);
  const [agent, setAgent] = useState("");
  const [base, setBase] = useState("9500");
  const tx = useTx();
  useEffect(() => {
    if (agent) return;
    if (current) setAgent(current);
    else if (AGENT_ADDRESS) setAgent(AGENT_ADDRESS);
  }, [current, agent]);
  useEffect(() => {
    if (m && m.authorityBase > 0n) setBase(String(usd(m.authorityBase)));
  }, [m?.authorityBase]); // eslint-disable-line react-hooks/exhaustive-deps
  const valid = isAddress(agent) && Number(base) >= 0;
  const changesAgent = valid && !!current && getAddress(agent) !== current;
  const setMandate = () => tx.run("mandate", [{ ...V, functionName: "setMandate", args: [getAddress(agent), parseUnits(base || "0", 6)] }]);
  const fire = () => tx.run("fire", [{ ...V, functionName: "fire", args: [] }]);
  const label = c.r.busy ? "Renewing…" : ADD_DEBT[a.phase].label;

  return (
    <section className="card perm authority" aria-labelledby="perm-h">
      <div className="card__head">
        <h2 id="perm-h" className="card__title">Agent permissions</h2>
        <span className={`badge ${c.r.busy ? "badge--violet" : BADGE[a.phase]}`}>{label}</span>
      </div>
      <Figures a={a} ceilLabel="Current debt ceiling" canLabel="Agent can add" />
      <ReduceRow hasAgent={!!current} tinted />
      {a.phase !== "decaying" && a.phase !== "paused" && (
        <div className="powers" style={{ borderTop: 0, marginTop: 4 }}>
          <AddRow a={a} renewing={c.r.busy} />
        </div>
      )}
      <p style={{ fontSize: 16, fontWeight: 500, marginTop: 16 }}>Agent debt ceiling</p>
      <CeilingBar a={a} compact />
      <CeilingNote a={a} />
      <AgentActions
        c={c}
        a={a}
        disabledReason={!owner ? "Connect a wallet or use the demo account first." : undefined}
        fine={<span data-testid="real-flow-note">Revoking stops new debt. The agent can still repay.<br />Real World App flow is not enabled on this deployment.</span>}
      />
      <details className="settings" open={!current}>
        <summary>
          <ChevronRight /> Agent settings
          <span className="muted num">{current ? `Ceiling ${fmtNum(a.base)} USDG · agent ${short(current)}` : "No agent appointed"}</span>
        </summary>
        <div className="settings__body mandate">
          <div className="fields">
            <label className="field">Agent address<input value={agent} onChange={(e) => setAgent(e.target.value.trim())} placeholder="0x…" spellCheck={false} data-testid="agent-input" /></label>
            <label className="field">Ceiling at full strength (USDG)<input inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="base-input" /></label>
            <button className="btn btn--line" onClick={setMandate} disabled={!owner || !valid || !!tx.pending} data-testid="set-mandate">{tx.pending === "mandate" ? "Confirming…" : current ? "Update" : "Appoint agent"}</button>
          </div>
          {changesAgent && <p className="warn">A new agent starts without permission to add debt until you renew with World ID.</p>}
          <div className="danger-row">
            <button className="btn btn--danger" onClick={fire} disabled={!owner || !current || !!tx.pending} data-testid="fire">{tx.pending === "fire" ? "Removing…" : "Fire agent"}</button>
            <span>Removes the agent entirely, including its right to reduce debt.</span>
          </div>
          <TxLine tx={tx} />
        </div>
      </details>
    </section>
  );
}

/** A borrower's own dashboard: the connected wallet (or the demo account) is the borrower. */
export function AppPage() {
  const { address } = useSigner();
  const vault = useVault(address);
  const state = vault.data;
  return (
    <main className="wrap">
      <div className="pagehead">
        <div>
          <h1>My position</h1>
          <p className="sub">Manage your loan and your agent's permissions.</p>
        </div>
        <Market state={state} />
      </div>
      {vault.isError && <p className="warn" role="alert" style={{ marginBottom: 12 }}>Can't read the vault right now. Is the RPC up?</p>}
      <div className="app">
        <PositionCard state={state} />
        <TradeCard owner={address} state={state} />
        <PermissionsCard owner={address} state={state} />
        <Activity owner={address} variant="app" />
      </div>
      <p className="app__foot">Robinhood Chain testnet · Mock assets · Simulated World ID</p>
    </main>
  );
}

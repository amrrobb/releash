import { useState } from "react";
import { maxUint256, parseUnits, type Address } from "viem";
import { ABI, DEPLOYMENT } from "../config";
import { fmtNum, fmtUsd, liquidationPrice, px8, stock, usd } from "../lib/math";
import type { VaultState } from "../lib/reads";
import { useTx, type Call } from "../lib/tx";
import { LtvGauge } from "./LtvGauge";
import { TxStatus } from "./TxStatus";

type Action = "deposit" | "borrow" | "repay" | "withdraw";
const ACTIONS: { id: Action; label: string; unit: string }[] = [
  { id: "deposit", label: "Deposit", unit: "rNVDA" },
  { id: "borrow", label: "Borrow", unit: "USDG" },
  { id: "repay", label: "Repay", unit: "USDG" },
  { id: "withdraw", label: "Withdraw", unit: "rNVDA" },
];

const V = { address: DEPLOYMENT.vault, abi: ABI.vault };

export function PositionCard({ owner, state }: { owner?: Address; state?: VaultState }) {
  const [action, setAction] = useState<Action>("deposit");
  const [amount, setAmount] = useState("");
  const tx = useTx();

  const col = state ? stock(state.position.collateral) : 0;
  const debt = state ? usd(state.position.debt) : 0;
  const price = state ? px8(state.price8) : 0;
  const liq = state ? liquidationPrice(state.position.collateral, state.position.debt) : null;
  const maxBorrow = state ? Math.max(0, usd(state.value) * 0.5 - debt) : 0;

  function calls(): Call[] {
    if (!state || !owner) return [];
    const isStock = action === "deposit" || action === "withdraw";
    const raw = parseUnits(amount || "0", isStock ? 18 : 6);
    const list: Call[] = [];
    if (action === "deposit" && state.allowStock < raw)
      list.push({ address: DEPLOYMENT.rnvda, abi: ABI.stock, functionName: "approve", args: [DEPLOYMENT.vault, maxUint256] });
    if (action === "repay" && state.allowUsdg < raw)
      list.push({ address: DEPLOYMENT.usdg, abi: ABI.usdg, functionName: "approve", args: [DEPLOYMENT.vault, maxUint256] });
    const args = action === "repay" ? [owner, raw] : [raw];
    list.push({ ...V, functionName: action, args });
    return list;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (await tx.run(action, calls)) setAmount("");
  }

  function fillMax() {
    if (!state) return;
    const v =
      action === "deposit" ? stock(state.walletStock)
      : action === "withdraw" ? col
      : action === "repay" ? Math.min(debt, usd(state.walletUsdg))
      : Math.floor(maxBorrow * 100) / 100;
    setAmount(String(Math.max(0, Math.floor(v * 1e6) / 1e6)));
  }

  const faucet = () =>
    tx.run("faucet", [
      { address: DEPLOYMENT.rnvda, abi: ABI.stock, functionName: "mint", args: [owner, parseUnits("100", 18)] },
      { address: DEPLOYMENT.usdg, abi: ABI.usdg, functionName: "mint", args: [owner, parseUnits("10000", 6)] },
    ]);

  return (
    <section className="panel position" aria-labelledby="pos-h">
      <header className="panel__head">
        <h2 id="pos-h">Your position</h2>
        {state && <span className="quiet num">rNVDA {fmtUsd(price)}</span>}
      </header>

      <dl className="stats">
        <div>
          <dt>Collateral</dt>
          <dd className="num">{fmtNum(col)} <small>rNVDA</small></dd>
          <dd className="sub num">{state ? fmtUsd(usd(state.value)) : "—"}</dd>
        </div>
        <div>
          <dt>Debt</dt>
          <dd className="num">{fmtUsd(debt).replace("$", "")} <small>USDG</small></dd>
          <dd className="sub num">{state ? `${fmtUsd(maxBorrow)} more at 50%` : "—"}</dd>
        </div>
      </dl>

      <LtvGauge ltvBps={state?.ltvBps ?? 0} />

      <div className="liqprice">
        <span className="label">Liquidation price</span>
        <span className="num">{liq ? fmtUsd(liq) : "—"}</span>
        {liq && price > 0 && <span className="quiet num">{(((liq - price) / price) * 100).toFixed(1)}% from here</span>}
      </div>

      <form className="actions" onSubmit={submit}>
        <div className="seg" role="tablist" aria-label="Position action">
          {ACTIONS.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={action === a.id} className={action === a.id ? "on" : ""} onClick={() => { setAction(a.id); setAmount(""); tx.clear(); }}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="field">
          <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={`${action} amount`} data-testid="amount" />
          <span className="field__unit">{ACTIONS.find((a) => a.id === action)!.unit}</span>
          <button type="button" className="link" onClick={fillMax}>max</button>
        </div>
        <button className="btn btn--primary" disabled={!owner || !amount || Number(amount) <= 0 || !!tx.pending} data-testid="submit-action">
          {tx.pending && tx.pending !== "faucet" ? "Confirming…" : ACTIONS.find((a) => a.id === action)!.label}
        </button>
      </form>

      <TxStatus tx={tx} />

      <div className="wallet-row">
        <span className="quiet num">
          Wallet: {state ? `${fmtNum(stock(state.walletStock))} rNVDA · ${fmtNum(usd(state.walletUsdg))} USDG` : "—"}
        </span>
        <button className="btn btn--ghost btn--sm" onClick={faucet} disabled={!owner || !!tx.pending} data-testid="faucet">
          {tx.pending === "faucet" ? "Minting…" : "Faucet: 100 rNVDA + 10k USDG"}
        </button>
      </div>
    </section>
  );
}

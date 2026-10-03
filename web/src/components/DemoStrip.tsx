import type { Address } from "viem";
import { CONTROL_OWNER } from "../config";
import { useMarket } from "../lib/backend";
import { fmtNum, fmtUsd, px8, short, stock, usd } from "../lib/math";
import { useEvents, useVault, type VaultState } from "../lib/reads";
import { LtvGauge } from "./LtvGauge";

function Side({ title, tag, owner, state, liquidated }: { title: string; tag: string; owner?: Address; state?: VaultState; liquidated: boolean }) {
  const status = !state ? "—" : liquidated ? "LIQUIDATED" : state.liquidatable ? "LIQUIDATABLE" : "SAFE";
  return (
    <div className={`side side--${status.toLowerCase()}`} data-testid={`side-${tag}`}>
      <div className="side__head">
        <div>
          <h3>{title}</h3>
          <span className="quiet mono">{owner ? short(owner) : "not configured"}</span>
        </div>
        <span className={`pill pill--${status.toLowerCase()}`}>{status}</span>
      </div>
      <LtvGauge ltvBps={state?.ltvBps ?? 0} size="sm" />
      <div className="side__stats num">
        <span>{state ? fmtNum(stock(state.position.collateral)) : "—"} rNVDA</span>
        <span>{state ? fmtUsd(usd(state.position.debt)) : "—"} debt</span>
      </div>
    </div>
  );
}

/** ?demo=1 only: the control position (same start, no agent) next to yours. */
export function DemoStrip({ owner, state }: { owner?: Address; state?: VaultState }) {
  const control = useVault(CONTROL_OWNER);
  const controlEvents = useEvents(CONTROL_OWNER);
  const mineEvents = useEvents(owner);
  const market = useMarket();
  const liq = (evs?: { name: string }[]) => !!evs?.some((e) => e.name === "Liquidated");

  return (
    <section className="demostrip" aria-label="Demo comparison">
      <div className="demostrip__inner">
        <div className="demostrip__market">
          <span className="label">Demo · market</span>
          <strong className={market.data?.open === false ? "closed" : ""}>{market.data ? market.data.label : "unknown"}</strong>
          <span className="quiet num">rNVDA {state ? fmtUsd(px8(state.price8)) : "—"}</span>
        </div>
        <Side title="With Releash" tag="releash" owner={owner} state={state} liquidated={liq(mineEvents.data)} />
        <Side
          title="Control · no agent"
          tag="control"
          owner={CONTROL_OWNER}
          state={control.data}
          liquidated={liq(controlEvents.data)}
        />
      </div>
    </section>
  );
}

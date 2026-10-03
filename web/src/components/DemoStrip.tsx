import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { CONTROL_OWNER, DEMO_KEY, EXPLORER } from "../config";
import { api, useMarket } from "../lib/backend";
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
          <span className="quiet mono">
            {owner ? EXPLORER ? <a href={`${EXPLORER}/address/${owner}`} target="_blank" rel="noreferrer">{short(owner)}</a> : short(owner) : "not configured"}
          </span>
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

// ---------------------------------------------------------------- demo actors

type Actors = { alice?: Address; control?: Address };
const KEY = "releash.demoActors";
function loadActors(): Actors {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return { alice: isAddress(v.alice ?? "") ? v.alice : undefined, control: isAddress(v.control ?? "") ? v.control : undefined };
  } catch {
    return {};
  }
}
function saveActors(a: Actors) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // per-viewer convenience only
  }
}

type AttemptResponse = { blocked: boolean; error?: string; errorArgs?: string[]; txHash?: string };
type ResetResponse = { alice?: { owner?: string }; control?: { owner?: string }; agent?: string };

/** ?demo=1 only: the control position (same start, no agent) next to Alice's, plus the stage controls. */
export function DemoStrip({ owner, state }: { owner?: Address; state?: VaultState }) {
  const [actors, setActors] = useState<Actors>(loadActors);
  const alice = actors.alice ?? owner;
  const controlOwner = actors.control ?? CONTROL_OWNER;
  // The connected account's reads are already polled by the app; only poll Alice separately if she differs.
  const aliceIsMe = !!owner && !!alice && alice.toLowerCase() === owner.toLowerCase();
  const aliceVault = useVault(aliceIsMe ? undefined : alice);
  const aliceState = aliceIsMe ? state : aliceVault.data;
  const control = useVault(controlOwner);
  const controlEvents = useEvents(controlOwner);
  const aliceEvents = useEvents(alice);
  const market = useMarket();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "bad"; text: string; txHash?: string } | null>(null);
  const liq = (evs?: { name: string }[]) => !!evs?.some((e) => e.name === "Liquidated");

  async function run(label: string, path: string, body: unknown, describe: (r: never) => { tone: "ok" | "bad"; text: string; txHash?: string }) {
    setPending(label);
    setResult(null);
    try {
      const r = await api<never>(path, body, { "x-demo-key": DEMO_KEY });
      setResult(describe(r));
    } catch (e) {
      setResult({ tone: "bad", text: `${label} failed: ${(e as Error).message}` });
    } finally {
      setPending(null);
      await qc.invalidateQueries();
    }
  }

  const close = () => run("Friday close", "/api/demo/close", {}, () => ({ tone: "ok", text: "Market closed for the weekend. Price frozen." }));
  const gap = () => run("Monday gap", "/api/demo/gap", { pct: -35 }, () => ({ tone: "ok", text: "Monday open: price gapped −35%." }));
  const attempt = () =>
    run("Agent attempt", "/api/demo/attempt-borrow", { owner: alice, amount: "1500" }, (r: AttemptResponse) =>
      r.blocked
        ? { tone: "bad", text: `Blocked on-chain: ${r.error ?? "Reverted"}${r.errorArgs?.length ? `(${r.errorArgs.join(", ")})` : ""}`, txHash: r.txHash }
        : { tone: "ok", text: "Allowed: the agent borrowed $1,500 within its authority.", txHash: r.txHash },
    );
  const reset = () =>
    run("Reset", "/api/demo/reset", {}, (r: ResetResponse) => {
      const next: Actors = {
        alice: r.alice?.owner && isAddress(r.alice.owner) ? getAddress(r.alice.owner) : actors.alice,
        control: r.control?.owner && isAddress(r.control.owner) ? getAddress(r.control.owner) : actors.control,
      };
      setActors(next);
      saveActors(next);
      return { tone: "ok", text: "Demo reset: Alice and the control start again from the same position." };
    });

  const busy = !!pending;
  const noKey = !DEMO_KEY;
  return (
    <section className="demostrip" aria-label="Demo comparison">
      <div className="demostrip__inner">
        <div className="demostrip__market">
          <span className="label">Demo · market</span>
          <strong className={!market.data ? "unknown" : market.data.open === false ? "closed" : ""}>{market.data ? market.data.label : "unknown"}</strong>
          <span className="quiet num">rNVDA {aliceState ? fmtUsd(px8(aliceState.price8)) : "—"}</span>
        </div>
        <Side title="Alice · with Releash" tag="releash" owner={alice} state={aliceState} liquidated={liq(aliceEvents.data)} />
        <Side title="Control · no agent" tag="control" owner={controlOwner} state={control.data} liquidated={liq(controlEvents.data)} />
      </div>
      <div className="demostrip__controls">
        <button className="btn btn--ghost btn--sm" onClick={close} disabled={busy || noKey} data-testid="demo-close">{pending === "Friday close" ? "Closing…" : "Friday close"}</button>
        <button className="btn btn--ghost btn--sm" onClick={gap} disabled={busy || noKey} data-testid="demo-gap">{pending === "Monday gap" ? "Gapping…" : "Monday gap −35%"}</button>
        <button className="btn btn--ghost btn--sm" onClick={attempt} disabled={busy || noKey || !alice} data-testid="demo-attempt">{pending === "Agent attempt" ? "Agent trying…" : "Agent tries $1,500"}</button>
        <button className="btn btn--ghost btn--sm" onClick={reset} disabled={busy || noKey} data-testid="demo-reset">{pending === "Reset" ? "Resetting…" : "Reset demo"}</button>
        <span className={`demostrip__result ${result ? `demostrip__result--${result.tone}` : ""}`} role="status" data-testid="demo-result">
          {noKey ? "Demo controls need VITE_DEMO_KEY." : pending ? `${pending}…` : result?.text}
          {result?.txHash && (EXPLORER ? <a className="mono" href={`${EXPLORER}/tx/${result.txHash}`} target="_blank" rel="noreferrer"> {short(result.txHash)}</a> : <span className="mono"> {short(result.txHash)}</span>)}
        </span>
      </div>
    </section>
  );
}

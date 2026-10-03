import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getAddress, isAddress, type Address } from "viem";
import { AddRow, AgentActions, CeilingBar, CeilingNote, Figures, ReduceRow, useAgentControls } from "../components/Agent";
import { Activity } from "../components/Activity";
import { Market } from "../components/Market";
import { CONTROL_OWNER, DEMO_KEY, EXPLORER } from "../config";
import { authorityOf } from "../lib/authority";
import { api, useMarket } from "../lib/backend";
import { demoAccount, demoWallet } from "../lib/chain";
import { fmtNum, fmtPct, fmtUsd, short, usd } from "../lib/math";
import { hasAgent, useEvents, useVault, type VaultState } from "../lib/reads";
import { useChainNow } from "../lib/useNow";

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

type Ev = { name: string; blockNumber: bigint; args: Record<string, unknown> };
/** Liquidations after the position was last opened (Reset demo re-borrows; older runs must not count). */
function liquidationsSinceOpen(evs?: Ev[]): Ev[] {
  if (!evs?.length) return [];
  const opened = evs.reduce((m, e) => (e.name === "Borrowed" && e.blockNumber > m ? e.blockNumber : m), -1n);
  return evs.filter((e) => e.name === "Liquidated" && e.blockNumber >= opened);
}
const equityOf = (s?: VaultState) => (s ? usd(s.value) - usd(s.position.debt) : undefined);
const ltvText = (s?: VaultState) => (!s ? "—" : Number.isFinite(s.ltvBps) ? fmtPct(s.ltvBps) : "∞");

function Side({ title, tag, owner, state, events }: { title: string; tag: "releash" | "control"; owner?: Address; state?: VaultState; events?: Ev[] }) {
  const liqs = liquidationsSinceOpen(events);
  const status = !state ? "—" : liqs.length ? "LIQUIDATED" : state.liquidatable ? "LIQUIDATABLE" : "SAFE";
  const lost = liqs.reduce((sum, e) => sum + Number(e.args.collateralSeized as bigint) / 1e18, 0);
  const equity = equityOf(state);
  return (
    <div className="compare__side" data-testid={`side-${tag}`}>
      <div className="compare__title">
        <h2>{title}</h2>
        <span className={`pill badge ${status === "SAFE" ? "badge--safe" : status === "—" ? "badge--grey" : "badge--bad"}`}>{status}</span>
        {owner && EXPLORER ? (
          <a className="compare__addr num" href={`${EXPLORER}/address/${owner}`} target="_blank" rel="noreferrer" aria-label={`${title} position on the explorer`}>{short(owner)}</a>
        ) : (
          <span className="compare__addr num">{owner ? short(owner) : "not configured"}</span>
        )}
      </div>
      <div className="big num" data-testid={`equity-${tag}`}>{equity === undefined ? "—" : fmtUsd(equity)}</div>
      <div className="cap">Equity remaining</div>
      {lost > 0 ? (
        <p className="compare__lost num" data-testid={`lost-${tag}`}>{fmtNum(lost)} rNVDA lost to liquidation</p>
      ) : (
        <div className="compare__foot num">
          <span>Debt<strong>{state ? fmtUsd(usd(state.position.debt)) : "—"}</strong></span>
          <i aria-hidden />
          <span>LTV<strong>{ltvText(state)}</strong></span>
        </div>
      )}
    </div>
  );
}

type Btn = "close" | "gap" | "attempt" | "reset";

/** The judge path: one screen, Alice vs the control, the four demo buttons, Alice's agent and its actions. */
export function DemoPage() {
  const [actors, setActors] = useState<Actors>(loadActors);
  // This page always acts as Alice, the demo account. A connected wallet elsewhere never signs here.
  const alice = demoAccount?.address;
  const mismatch = !!actors.alice && !!alice && actors.alice.toLowerCase() !== alice.toLowerCase();
  const controlOwner = actors.control ?? CONTROL_OWNER;

  const vault = useVault(alice);
  const state = vault.data;
  const control = useVault(controlOwner);
  const aliceEvents = useEvents(alice);
  const controlEvents = useEvents(controlOwner);
  const market = useMarket();
  const now = useChainNow();
  const a = authorityOf(state, now);
  const agent = hasAgent(state?.mandate) ? state!.mandate.agent : undefined;
  const c = useAgentControls(alice, agent, demoWallet);

  const qc = useQueryClient();
  const [pending, setPending] = useState<Btn | null>(null);
  const [last, setLast] = useState<Btn | null>(null);
  const [result, setResult] = useState<{ tone: "ok" | "bad"; text: string; txHash?: string } | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!pending) return setSince(null);
    setSince(Date.now());
    const id = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [pending]);
  const elapsed = since ? Math.floor((Date.now() - since) / 1000) : 0;

  async function run<T>(b: Btn, path: string, body: unknown, describe: (r: T) => { tone: "ok" | "bad"; text: string; txHash?: string }) {
    setPending(b);
    setResult(null);
    try {
      const r = await api<T>(path, body, { "x-demo-key": DEMO_KEY });
      setResult(describe(r));
      setLast(b);
    } catch (e) {
      setResult({ tone: "bad", text: `Failed: ${(e as Error).message}` });
    } finally {
      setPending(null);
      await qc.invalidateQueries();
    }
  }
  type Attempt = { blocked: boolean; error?: string; errorArgs?: string[]; txHash?: string };
  type Reset = { alice?: { owner?: string }; control?: { owner?: string } };
  const close = () => run("close", "/api/demo/close", {}, () => ({ tone: "ok", text: "Market closed · price frozen for the weekend" }));
  const gap = () => run("gap", "/api/demo/gap", { pct: -35 }, () => ({ tone: "ok", text: "Monday open · price dropped 35%" }));
  const attempt = () =>
    run<Attempt>("attempt", "/api/demo/attempt-borrow", { owner: alice, amount: "1500" }, (r) =>
      r.blocked
        ? { tone: "bad", text: `Blocked on-chain: ${r.error ?? "Reverted"}${r.errorArgs?.length ? `(${r.errorArgs.join(", ")})` : ""}`, txHash: r.txHash }
        : { tone: "ok", text: "Allowed: the agent borrowed $1,500 within its ceiling.", txHash: r.txHash },
    );
  const reset = () =>
    run<Reset>("reset", "/api/demo/reset", {}, (r) => {
      const next: Actors = {
        alice: r.alice?.owner && isAddress(r.alice.owner) ? getAddress(r.alice.owner) : actors.alice,
        control: r.control?.owner && isAddress(r.control.owner) ? getAddress(r.control.owner) : actors.control,
      };
      setActors(next);
      saveActors(next);
      setLast(null);
      return { tone: "ok", text: "Demo reset · both positions start again from the same place" };
    });

  const eqA = equityOf(state);
  const eqC = equityOf(control.data);
  const controlLiquidated = liquidationsSinceOpen(controlEvents.data).length > 0;
  const delta = eqA !== undefined && eqC !== undefined ? eqA - eqC : 0;
  const showDelta = controlLiquidated && delta > 0 && !!state?.position.collateral;
  const busy = !!pending;
  const noKey = !DEMO_KEY;
  const label: Record<Btn, string> = { close: "Closing", gap: "Gapping", attempt: "Agent trying", reset: "Resetting" };

  return (
    <main className="wrap demo">
      <div className="pagehead" style={{ paddingBottom: 6 }}>
        <div>
          <p className="eyebrow">Interactive demo</p>
          <h1>A safer Monday.</h1>
          <p className="sub">See how expiring permissions protect a stock-backed loan.</p>
        </div>
        <Market state={state} />
      </div>

      <section className="demostrip" aria-label="Scenario and comparison">
        <div className="scenario" role="group" aria-label="Scenario">
          <span className="scenario__label">Scenario</span>
          <button className={`btn${last === "close" ? " is-on" : ""}`} onClick={close} disabled={busy || noKey || market.data?.open === false} data-testid="demo-close">Friday close</button>
          <button className={`btn${last === "gap" ? " is-on" : ""}`} onClick={gap} disabled={busy || noKey} data-testid="demo-gap">Monday gap −35%</button>
          <button className={`btn${last === "attempt" ? " is-on" : ""}`} onClick={attempt} disabled={busy || noKey || !alice} data-testid="demo-attempt">Agent tries $1,500</button>
          <span className={`scenario__result${result?.tone === "bad" ? " scenario__result--bad" : ""}`} role="status" data-testid="demo-result" data-pending={pending ? "1" : undefined}>
            {noKey
              ? "Demo controls need VITE_DEMO_KEY."
              : pending
                ? `${label[pending]}… ${elapsed}s${pending === "reset" ? " (takes up to a minute)" : ""}`
                : result?.text ?? "Press Reset demo first for a clean run, then step through Friday and Monday."}
            {result?.txHash && EXPLORER && <> · <a href={`${EXPLORER}/tx/${result.txHash}`} target="_blank" rel="noreferrer" className="num">{short(result.txHash)}</a></>}
          </span>
          <button className="btn scenario__reset" onClick={reset} disabled={busy || noKey} data-testid="demo-reset">Reset demo</button>
        </div>

        <div className="card compare">
          <Side title="With Releash" tag="releash" owner={alice} state={state} events={aliceEvents.data} />
          <Side title="Without Releash" tag="control" owner={controlOwner} state={control.data} events={controlEvents.data} />
          <div className={`kept${showDelta ? "" : " kept--wait"}`} data-testid="equity-delta" aria-live="polite">
            {showDelta ? (
              <>
                <p className="kept__label">Releash kept</p>
                <p className="kept__value num">{fmtUsd(delta)}</p>
                <p className="kept__sub">more equity</p>
              </>
            ) : (
              <p className="kept__wait">Same stock, same market — watch Monday</p>
            )}
          </div>
        </div>
      </section>

      <div className="demo__main">
        <section className="card authority" aria-labelledby="agent-h">
          <div className="card__head">
            <h2 id="agent-h" className="card__title">What your agent can do</h2>
            <span className="live"><i className={`dot${vault.isError ? " dot--red" : ""}`} aria-hidden />{vault.isError ? "Chain unreachable" : "Live"}</span>
          </div>
          <div className="powers">
            <ReduceRow hasAgent={!!agent} />
            <AddRow a={a} renewing={c.r.busy} />
          </div>
          <Figures a={a} />
          <div style={{ marginLeft: 46 }}>
            <CeilingBar a={a} />
            <CeilingNote a={a} />
          </div>
          <AgentActions
            c={c}
            a={a}
            disabledReason={!demoWallet ? "This build has no demo account (VITE_DEMO_PK)." : mismatch ? `Reset reported Alice as ${short(actors.alice)}, but this page signs as ${short(alice)}. Renew and Revoke are off to avoid acting on the wrong borrower.` : undefined}
            fine={<>Renewal restores the ceiling. Reducing debt stays allowed.<br />Simulated proof · testnet</>}
          />
        </section>
        <Activity owner={alice} variant="demo" />
      </div>

      <footer className="demo__foot">
        <span>Shared demo account — anyone can press these. Press Reset demo first (~1 min) for a clean run.</span>
        <span>Robinhood Chain testnet · Mock assets · World ID simulated</span>
      </footer>
    </main>
  );
}

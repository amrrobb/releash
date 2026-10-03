import type { Address } from "viem";
import { EXPLORER } from "../config";
import { useAgentLog, type AgentEntry } from "../lib/backend";
import { fmtNum, fmtUsd, short } from "../lib/math";
import { useEvents, type ChainEvent } from "../lib/reads";

type Item = {
  id: string;
  ts: number;
  tone: "ok" | "bad" | "info" | "dim";
  source: "agent" | "chain";
  title: string;
  detail?: string;
  txHash?: string;
  count?: number;
  effect?: string;
};

const n = (v: unknown) => Number(v as bigint);

function fromChain(e: ChainEvent, owner: Address): Item | null {
  const a = e.args;
  const byOwner = typeof a.by === "string" && a.by.toLowerCase() === owner.toLowerCase();
  const who = byOwner ? "You" : "Agent";
  const base = { id: e.id, ts: e.ts, source: "chain" as const, txHash: e.txHash };
  switch (e.name) {
    case "Borrowed":
      return { ...base, tone: byOwner ? "dim" : "ok", title: `${who} borrowed ${fmtUsd(n(a.amount) / 1e6)}`, detail: `Debt now ${fmtUsd(n(a.newDebt) / 1e6)}` };
    case "Deleveraged":
      return { ...base, tone: "ok", title: `${who} deleveraged ${n(a.bps) / 100}%`, detail: `Sold ${fmtNum(n(a.collateralSold) / 1e18)} rNVDA, repaid ${fmtUsd(n(a.debtRepaid) / 1e6)}` };
    case "Renewed":
      return { ...base, tone: "ok", title: "Renewed with World ID", detail: "Authority refilled, decay clock restarted" };
    case "Liquidated":
      return { ...base, tone: "bad", title: "Liquidated", detail: `${fmtUsd(n(a.debtRepaid) / 1e6)} repaid, ${fmtNum(n(a.collateralSeized) / 1e18)} rNVDA seized` };
    case "MandateSet":
      return { ...base, tone: "info", title: `Mandate set: agent ${short(a.agent as string)}`, detail: `Ceiling ${fmtUsd(n(a.authorityBase) / 1e6)}` };
    case "Revoked":
      return { ...base, tone: "info", title: "Revoked", detail: "Agent can no longer add debt. Deleverage still allowed." };
    case "Fired":
      return { ...base, tone: "info", title: `Fired agent ${short(a.agent as string)}` };
    case "Deposited":
      return { ...base, tone: "dim", title: `Deposited ${fmtNum(n(a.amount) / 1e18)} rNVDA` };
    case "Withdrawn":
      return { ...base, tone: "dim", title: `Withdrew ${fmtNum(n(a.amount) / 1e18)} rNVDA` };
    case "Repaid":
      return { ...base, tone: "dim", title: `Repaid ${fmtUsd(n(a.amount) / 1e6)}`, detail: `Debt now ${fmtUsd(n(a.newDebt) / 1e6)}` };
    default:
      return null;
  }
}

const ACTION_TITLE: Record<string, string> = {
  hold: "Agent holds",
  deleverage10: "Agent: deleverage 10%",
  deleverage30: "Agent: deleverage 30%",
  borrow: "Agent: borrow",
};

function fromAgent(e: AgentEntry): Item {
  const title = (ACTION_TITLE[e.action] ?? `Agent: ${e.action}`) + (e.action === "borrow" && e.amount ? ` ${fmtUsd(e.amount)}` : "");
  if (e.blocked)
    return { id: `a-${e.id}`, ts: e.ts, source: "agent", tone: "bad", title: `Blocked on-chain: ${e.error ?? "Reverted"}`, detail: `${title}. ${e.reason}`, txHash: e.txHash };
  // A decision the agent did not send (cooldown, no room) must not read as if it happened.
  if (e.action !== "hold" && !e.txHash && /not sent/i.test(e.reason))
    return { id: `a-${e.id}`, ts: e.ts, source: "agent", tone: "dim", title: `${title} (skipped)`, detail: e.reason };
  return { id: `a-${e.id}`, ts: e.ts, source: "agent", tone: e.action === "hold" ? "dim" : "info", title, detail: e.reason, txHash: e.txHash };
}

export function Feed({ owner }: { owner?: Address }) {
  const log = useAgentLog(owner);
  const events = useEvents(owner);

  let items: Item[] = [];
  if (owner) {
    const chain = events.data ?? [];
    // Deleverage and liquidation also emit Repaid in the same tx; show the specific event only.
    const special = new Set(chain.filter((e) => e.name === "Deleveraged" || e.name === "Liquidated").map((e) => e.txHash));
    const agentItems = (log.data ?? []).map(fromAgent);
    // An agent decision and the on-chain event it caused share a tx: show one line, reason + effect.
    const chainItems = chain
      .filter((e) => !(e.name === "Repaid" && special.has(e.txHash)))
      .map((e) => fromChain(e, owner))
      .filter((x): x is Item => !!x);
    const byTx = new Map(chainItems.filter((c) => c.txHash && c.tone !== "dim").map((c) => [c.txHash!.toLowerCase(), c]));
    const merged = new Set<string>();
    for (const a of agentItems) {
      const c = a.txHash && a.tone !== "bad" ? byTx.get(a.txHash.toLowerCase()) : undefined;
      if (!c) continue;
      merged.add(c.id);
      a.tone = c.tone;
      a.title = c.title;
      a.effect = c.detail;
      a.source = "chain";
    }
    items = [...chainItems.filter((c) => !merged.has(c.id)), ...agentItems].sort((a, b) => b.ts - a.ts);
    // Collapse runs of identical "hold" lines so the feed stays readable at one decision per 10 s.
    const out: Item[] = [];
    for (const it of items) {
      const prev = out[out.length - 1];
      if (prev && it.source === "agent" && prev.source === "agent" && it.tone === "dim" && prev.tone === "dim" && it.title === prev.title) {
        prev.count = (prev.count ?? 1) + 1;
        continue;
      }
      out.push({ ...it });
    }
    items = out.slice(0, 80);
  }

  // Pin the newest thing the agent actually did (borrow, deleverage, or a refused attempt).
  const pinned = items.find((it) => /^(Agent (borrowed|deleveraged)|Blocked on-chain)/.test(it.title));

  return (
    <section className="panel feed" aria-labelledby="feed-h">
      <header className="panel__head">
        <h2 id="feed-h">Agent feed</h2>
        <span className={`dot ${log.isError ? "dot--off" : "dot--on"}`} title={log.isError ? "Agent log unavailable" : "Live"} />
      </header>
      {log.isError && <p className="quiet small notice">Agent log offline. Showing on-chain events only.</p>}
      {pinned && (
        <div key={pinned.id} className={`feed__pin feed__pin--${pinned.tone}`} data-testid="feed-pinned">
          <div className="feed__pin-label">Latest agent action · <time className="num">{new Date(pinned.ts * 1000).toLocaleTimeString("en-GB")}</time></div>
          <div className="feed__title">{pinned.title}</div>
          {pinned.effect && <div className="feed__detail feed__effect num">{pinned.effect}</div>}
          {pinned.detail && <div className="feed__detail">{pinned.detail}</div>}
        </div>
      )}
      {!owner ? (
        <p className="empty">Connect to see your agent's decisions.</p>
      ) : items.length === 0 ? (
        <p className="empty">Nothing yet. Decisions and on-chain events appear here as they happen.</p>
      ) : (
        <ol className="feed__list" data-testid="feed">
          {items.map((it) => (
            <li key={it.id} className={`feed__item feed__item--${it.tone}`}>
              <time className="num">{new Date(it.ts * 1000).toLocaleTimeString("en-GB")}</time>
              <div>
                <div className="feed__title">
                  {it.title}
                  {it.count && it.count > 1 ? <span className="quiet"> ×{it.count}</span> : null}
                </div>
                {it.detail && <div className="feed__detail">{it.detail}</div>}
                {it.effect && <div className="feed__detail feed__effect num">{it.effect}</div>}
                <div className="feed__meta">
                  <span>{it.effect ? "agent · on-chain" : it.source === "chain" ? "on-chain" : "agent"}</span>
                  {it.txHash && (EXPLORER ? <a href={`${EXPLORER}/tx/${it.txHash}`} target="_blank" rel="noreferrer" className="mono">{short(it.txHash)}</a> : <span className="mono">{short(it.txHash)}</span>)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

import type { Address } from "viem";
import { useAgentLog, type AgentEntry } from "./backend";
import { fmtNum, fmtUsd, short } from "./math";
import { useEvents, type ChainEvent } from "./reads";

export type Kind =
  | "borrow" | "deleverage" | "blocked" | "liquidated" | "renewed" | "mandate" | "revoked" | "fired"
  | "deposit" | "withdraw" | "repay" | "hold" | "skipped";

export type Item = {
  id: string;
  ts: number;
  kind: Kind;
  title: string;
  detail?: string; // one honest line
  effect?: string; // what happened on-chain
  raw?: string; // the agent's full reason (model probabilities included)
  source: string; // JEV, CLAUDE, GUARD, MANDATE, RULES, AGENT, ON-CHAIN
  txHash?: string;
  action: boolean; // borrow, deleverage or blocked: what the agent actually did
};

/** The true decision source, as the agent logged it. A demo-button request is not a model decision. */
export function sourceTag(s?: string): string {
  switch ((s ?? "").toLowerCase()) {
    case "jev": return "JEV";
    case "cached": return "JEV · CACHED";
    case "claude": return "CLAUDE";
    case "guard": return "GUARD";
    case "mandate": return "MANDATE";
    case "rules": return "RULES";
    case "manual": return "AGENT";
    default: return s ? s.toUpperCase() : "AGENT";
  }
}

const n = (v: unknown) => Number(v as bigint);
const head = (reason: string) => reason.split(/\s*Jev:/)[0].replace(/^Blocked by Releash:[^.]*\.\s*/, "").trim();

function fromChain(e: ChainEvent, owner: Address): Item | null {
  const a = e.args;
  const byOwner = typeof a.by === "string" && a.by.toLowerCase() === owner.toLowerCase();
  const base = { id: e.id, ts: e.ts, source: "ON-CHAIN", txHash: e.txHash, action: false };
  switch (e.name) {
    case "Borrowed":
      return { ...base, kind: "borrow", action: !byOwner, title: `${byOwner ? "You" : "Agent"} borrowed ${fmtUsd(n(a.amount) / 1e6)}`, effect: `Debt now ${fmtUsd(n(a.newDebt) / 1e6)}` };
    case "Deleveraged":
      return { ...base, kind: "deleverage", action: !byOwner, title: `${byOwner ? "You" : "Agent"} deleveraged ${n(a.bps) / 100}%`, effect: `Sold ${fmtNum(n(a.collateralSold) / 1e18)} rNVDA, repaid ${fmtUsd(n(a.debtRepaid) / 1e6)}` };
    case "Renewed":
      return { ...base, kind: "renewed", title: "Renewed", detail: "Permission ceiling restored." };
    case "Liquidated":
      return { ...base, kind: "liquidated", title: "Liquidated", detail: `${fmtUsd(n(a.debtRepaid) / 1e6)} repaid, ${fmtNum(n(a.collateralSeized) / 1e18)} rNVDA seized` };
    case "MandateSet":
      return { ...base, kind: "mandate", title: "Mandate set", detail: `Ceiling set to ${fmtNum(n(a.authorityBase) / 1e6)} USDG for agent ${short(a.agent as string)}.` };
    case "Revoked":
      return { ...base, kind: "revoked", title: "Revoked", detail: "No new debt. Reducing debt stays allowed." };
    case "Fired":
      return { ...base, kind: "fired", title: "Agent removed", detail: `Agent ${short(a.agent as string)} has no permissions left.` };
    case "Deposited":
      return { ...base, kind: "deposit", title: `Deposited ${fmtNum(n(a.amount) / 1e18)} rNVDA` };
    case "Withdrawn":
      return { ...base, kind: "withdraw", title: `Withdrew ${fmtNum(n(a.amount) / 1e18)} rNVDA` };
    case "Repaid":
      return { ...base, kind: "repay", title: `Repaid ${fmtUsd(n(a.amount) / 1e6)}`, effect: `Debt now ${fmtUsd(n(a.newDebt) / 1e6)}` };
    default:
      return null;
  }
}

const BLOCK_REASON: Record<string, string> = {
  AuthorityExceeded: "Borrow request exceeded the ceiling",
  MandateRevoked: "Borrowing is revoked; only reducing debt is allowed",
  LtvExceeded: "Borrow would pass the 50% LTV limit",
  NotAgent: "Caller is not the appointed agent",
  StalePrice: "Price too old to borrow against",
};

function fromAgent(e: AgentEntry & { skipped?: unknown }): Item {
  const source = sourceTag(e.source);
  const raw = e.reason;
  const base = { id: `a-${e.id}`, ts: e.ts, source, raw, txHash: e.txHash };
  const amt = e.amount ? ` ${fmtUsd(e.amount)}` : "";
  if (e.blocked) {
    const why = e.error && BLOCK_REASON[e.error] ? BLOCK_REASON[e.error] : "Reverted on-chain";
    return { ...base, kind: "blocked", action: true, title: "Blocked on-chain", detail: `${e.action === "borrow" ? `Borrow${amt}: ` : ""}${why} (${e.error ?? "Reverted"}).` };
  }
  const skipped = !!e.skipped || (!e.txHash && /not sent/i.test(raw));
  if (e.action === "hold") return { ...base, kind: "hold", action: false, title: "Agent holds", detail: head(raw) };
  const label = e.action === "borrow" ? `borrow${amt}` : e.action === "deleverage30" ? "deleverage 30%" : e.action === "deleverage10" ? "deleverage 10%" : e.action;
  if (skipped) return { ...base, kind: "skipped", action: false, title: `Agent: ${label} (skipped)`, detail: head(raw) };
  // Executed decisions: a short line that the entry's own fields make true.
  let detail = head(raw);
  if (e.action === "borrow") detail = "Within the active debt ceiling.";
  else if (e.source === "mandate") detail = "Your weekend rule reduced debt before the market reopened.";
  else if (e.source === "guard") detail = "LTV above the 55% line: trimmed without asking the model.";
  return { ...base, kind: e.action === "borrow" ? "borrow" : "deleverage", action: true, title: `Agent ${e.action === "borrow" ? `borrowed${amt}` : label.replace("deleverage", "deleveraged")}`, detail };
}

/**
 * Agent decisions (backend log) merged with vault events (chain) by tx hash, newest first.
 * `sinceMandate` drops everything before the latest MandateSet / Fired, so a fresh demo run never opens
 * with the previous run's rows (Reset demo sets the mandate again).
 */
export function useActivity(owner: Address | undefined, opts: { sinceMandate?: boolean; actionsOnly?: boolean; limit?: number } = {}) {
  const log = useAgentLog(owner);
  const events = useEvents(owner);
  let items: Item[] = [];
  if (owner) {
    const chain = events.data ?? [];
    const special = new Set(chain.filter((e) => e.name === "Deleveraged" || e.name === "Liquidated").map((e) => e.txHash));
    const chainItems = chain.filter((e) => !(e.name === "Repaid" && special.has(e.txHash))).map((e) => fromChain(e, owner)).filter((x): x is Item => !!x);
    const agentItems = (log.data ?? []).map((e) => fromAgent(e as AgentEntry & { skipped?: unknown }));
    const byTx = new Map(chainItems.filter((c) => c.txHash && (c.kind === "borrow" || c.kind === "deleverage")).map((c) => [c.txHash!.toLowerCase(), c]));
    const merged = new Set<string>();
    for (const a of agentItems) {
      const c = a.txHash && a.kind !== "blocked" ? byTx.get(a.txHash.toLowerCase()) : undefined;
      if (!c) continue;
      merged.add(c.id);
      a.title = c.title;
      a.effect = c.effect;
      a.ts = c.ts;
    }
    items = [...chainItems.filter((c) => !merged.has(c.id)), ...agentItems].sort((x, y) => y.ts - x.ts);
    if (opts.sinceMandate) {
      const at = items.find((it) => it.kind === "mandate" || it.kind === "fired")?.ts;
      if (at !== undefined) items = items.filter((it) => it.ts >= at);
    }
    // Agent-originated chain events with no log line yet still count as actions.
    if (opts.actionsOnly) items = items.filter((it) => it.action || it.kind === "liquidated");
    items = items.slice(0, opts.limit ?? 80);
  }
  return { items, logOffline: log.isError, loading: !events.data && !events.isError };
}

export const fmtClock = (ts: number) => new Date(ts * 1000).toLocaleTimeString("en-GB");

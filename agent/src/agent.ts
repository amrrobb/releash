import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodeEventLog, encodeFunctionData, getAddress, type Address, type Hash, type TransactionReceipt } from "viem";
import { AGENT_DIR, CHAIN_ID, LOCAL, allErrorsAbi, decodeError, dep, jsonSafe, poolAbi, pub, vaultAbi, settle, sleep, withNonceRetry, type Wallet } from "./chain.js";
import { readMarket, type Market } from "./market.js";

export const LOG_FILE = process.env.AGENT_LOG ?? `${AGENT_DIR}${LOCAL ? "log.jsonl" : `log.${CHAIN_ID}.jsonl`}`;
const MANDATES_FILE = process.env.MANDATES_FILE ?? `${AGENT_DIR}mandates.json`;

export const GUARD_HARD_BPS = 6500; // > 65% LTV: deleverage 30%, no model asked
export const GUARD_SOFT_BPS = 5500; // > 55% LTV: deleverage 10%
const LEVER_CAP_BPS = Number(process.env.LEVER_CAP_BPS ?? 4900); // never lever above this LTV (contract max 50%)
const DECAY_SAFETY_S = Number(process.env.DECAY_SAFETY_S ?? 2); // seconds of decay to leave for the tx to land
const MIN_BORROW = 50_000000n; // 50 USDG

export type Action = "hold" | "deleverage10" | "deleverage30" | "borrow";
export type Decision = {
  action: Action;
  amount?: bigint; // USDG, 6 dec (borrow only)
  reason: string;
  source: "guard" | "mandate" | "jev" | "claude" | "rules" | "manual" | "cached";
  jev?: { choice: string; confidence: number; probabilities: Record<string, number> };
  overridden?: string;
};

export type MandateCfg = { text: string; weekendMaxLtvBps: number };
export function mandateFor(owner: Address): MandateCfg {
  const all = existsSync(MANDATES_FILE) ? JSON.parse(readFileSync(MANDATES_FILE, "utf8")) : {};
  return all[owner.toLowerCase()] ?? all.default ?? { text: "Keep me safe.", weekendMaxLtvBps: 4500 };
}

/** Everything the agent looks at, read at ONE block so the numbers belong together. */
export async function readState(owner: Address) {
  for (let i = 0; ; i++) {
    try {
      return await readStateOnce(owner);
    } catch (e) {
      if (i >= 4) throw e; // a load-balanced node may not have the block yet
      await sleep(700);
    }
  }
}
async function readStateOnce(owner: Address) {
  const blockNumber = await pub.getBlockNumber({ cacheTime: 0 }); // viem caches it per pollingInterval
  const block = await pub.getBlock({ blockNumber });
  const r = (functionName: string, args: unknown[] = []) =>
    pub.readContract({ address: dep.vault, abi: vaultAbi, functionName, args, blockNumber }) as Promise<any>;
  const [pos, health, authority, mandate, price] = await Promise.all([
    r("positions", [owner]),
    r("healthOf", [owner]),
    r("authorityNow", [owner]),
    r("mandates", [owner]),
    r("price"),
  ]);
  const [collateral, debt] = pos as bigint[];
  const [value, , ltvBps, liquidatable] = health as [bigint, bigint, bigint, boolean];
  const [agent, authorityBase, lastRenewed, revoked] = mandate as [Address, bigint, bigint, boolean];
  const [price8, updatedAt] = price as bigint[];
  return {
    owner,
    block: blockNumber,
    chainTs: block.timestamp,
    collateral,
    debt,
    value,
    ltvBps: Number(ltvBps > 10n ** 9n ? 10n ** 9n : ltvBps),
    liquidatable,
    agent,
    authorityBase,
    lastRenewed,
    revoked,
    authority: authority as bigint,
    price8,
    priceAge: Number(block.timestamp - updatedAt),
    market: readMarket(),
  };
}
export type State = Awaited<ReturnType<typeof readStateOnce>>;

/** How much the agent may add right now: up to its authority (less a few seconds of decay so the tx
 * still fits when mined) and never above LEVER_CAP_BPS LTV. */
export function borrowRoom(s: State) {
  const decay = (s.authorityBase * BigInt(DECAY_SAFETY_S)) / BigInt(2 * dep.halfLife);
  const byAuthority = s.authority - decay;
  const byLtv = (s.value * BigInt(LEVER_CAP_BPS)) / 10_000n;
  const ceiling = byAuthority < byLtv ? byAuthority : byLtv;
  return ceiling > s.debt ? ceiling - s.debt : 0n;
}

export function guard(s: State): Decision | null {
  if (s.debt === 0n) return null;
  if (s.ltvBps > GUARD_HARD_BPS) return { action: "deleverage30", reason: `LTV ${pct(s.ltvBps)} is above the 65% hard line; selling 30% without asking the model.`, source: "guard" };
  if (s.ltvBps > GUARD_SOFT_BPS) return { action: "deleverage10", reason: `LTV ${pct(s.ltvBps)} is above the 55% line; trimming 10% without asking the model.`, source: "guard" };
  return null;
}

/** Mandate constraints that are checked deterministically, whatever the model said. */
function mandateRule(s: State, m: MandateCfg): Decision | null {
  if (!s.market.open && s.debt > 0n && s.ltvBps > m.weekendMaxLtvBps) {
    // 30%: a 10% trim leaves too little room for a Monday gap (slippage eats part of it).
    return {
      action: "deleverage30",
      reason: `Market is closed for the weekend and LTV ${pct(s.ltvBps)} is above your weekend limit of ${pct(m.weekendMaxLtvBps)}; de-risking before a Monday gap.`,
      source: "mandate",
    };
  }
  return null;
}

export function rules(s: State, m: MandateCfg): Decision {
  const r = mandateRule(s, m);
  if (r) return { ...r, source: "rules" };
  const room = borrowRoom(s);
  if (s.market.open && !s.revoked && room >= MIN_BORROW && s.agent !== "0x0000000000000000000000000000000000000000")
    return { action: "borrow", amount: room, reason: `Market is open and calm, LTV ${pct(s.ltvBps)}, ${usd(room)} USDG of renewed authority unused; levering up within it.`, source: "rules" };
  return { action: "hold", reason: holdReason(s), source: "rules" };
}

function holdReason(s: State) {
  const l = `LTV ${pct(s.ltvBps)}`;
  if (s.revoked) return `Revoked; the agent can only reduce risk. ${l}, holding.`;
  if (s.lastRenewed === 0n) return `Waiting for a World ID renewal; the agent can only reduce risk. ${l}, holding.`;
  if (s.authority === 0n) return `Authority has decayed to zero; the agent can only reduce risk. ${l}, holding.`;
  if (!s.market.open) return `Weekend, ${l} is within your limit; holding.`;
  return `${l}, authority ${usd(s.authority)} USDG vs debt ${usd(s.debt)}; nothing to do.`;
}

// ------------------------------------------------------------------ models

const OR = "https://openrouter.ai/api";
const JEV_MODEL = process.env.AGENT_MODEL ?? "~typesafe/jev-latest";
const FALLBACK_MODEL = process.env.FALLBACK_MODEL ?? "anthropic/claude-haiku-4.5";
const JEV_MIN_CONFIDENCE = Number(process.env.JEV_MIN_CONFIDENCE ?? 0.35);
const JEV_MAP: Record<string, Action> = { hold: "hold", deleverage_10: "deleverage10", deleverage_30: "deleverage30", borrow_more: "borrow" };

function facts(s: State, m: MandateCfg) {
  return {
    borrower_mandate: m.text,
    weekend_max_ltv: pct(m.weekendMaxLtvBps),
    market: s.market.open ? "open" : "closed (weekend, price frozen)",
    stock_price_usd: Number(s.price8) / 1e8,
    collateral_value_usd: usd(s.value),
    debt_usd: usd(s.debt),
    ltv: pct(s.ltvBps),
    max_borrow_ltv: "50%",
    liquidation_ltv: "70%",
    agent_borrow_authority_usd: usd(s.authority),
    unused_authority_usd: usd(borrowRoom(s)),
    mandate_revoked: s.revoked,
  };
}

async function askJev(s: State, m: MandateCfg, apiKey: string) {
  const res = await fetch(`${OR}/alpha/decisions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model: JEV_MODEL,
      state: facts(s, m),
      questions: {
        action: {
          type: "choice",
          instructions: "You manage a stock-backed USDG loan under the borrower's mandate. What should the loan agent do now?",
          criteria: {
            hold: "Position is within the mandate; do nothing.",
            deleverage_10: "Repay 10% of debt; LTV slightly above what the mandate wants.",
            deleverage_30: "Repay 30% of debt; liquidation risk or weekend gap risk is high.",
            borrow_more: "Market is open and calm, LTV is low and the borrower granted unused authority to lever up.",
          },
        },
      },
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  const a = body?.answers?.action;
  if (!res.ok || !a?.choice) throw new Error(`jev ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return { choice: String(a.choice), confidence: Number(a.confidence), probabilities: a.probabilities ?? {} };
}

const CLAUDE_MIN_INTERVAL_S = Number(process.env.CLAUDE_MIN_INTERVAL_S ?? 60);
const CLAUDE_DAILY_CAP = Number(process.env.CLAUDE_DAILY_CAP ?? 20);
const CLAUDE_BUDGET_FILE = process.env.CLAUDE_BUDGET_FILE ?? `${dirname(LOG_FILE)}/claude-budget.${CHAIN_ID}.json`;
const lastClaude = new Map<string, number>();
/** Hard cap on Claude calls per UTC day across restarts (credit is tiny). Fails closed: unreadable = spent. */
function takeClaudeBudget(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  let b = { day, count: 0 };
  try {
    if (existsSync(CLAUDE_BUDGET_FILE)) b = JSON.parse(readFileSync(CLAUDE_BUDGET_FILE, "utf8"));
  } catch {
    return false;
  }
  if (b.day !== day) b = { day, count: 0 };
  if (b.count >= CLAUDE_DAILY_CAP) return false;
  b.count++;
  writeFileSync(`${CLAUDE_BUDGET_FILE}.tmp`, JSON.stringify(b));
  renameSync(`${CLAUDE_BUDGET_FILE}.tmp`, CLAUDE_BUDGET_FILE);
  return true;
}
async function askClaude(s: State, m: MandateCfg, apiKey: string): Promise<Decision> {
  const k = s.owner.toLowerCase();
  const now = Date.now() / 1000;
  if (now - (lastClaude.get(k) ?? 0) < CLAUDE_MIN_INTERVAL_S) throw new Error(`claude budget: at most one call per ${CLAUDE_MIN_INTERVAL_S}s per owner`);
  if (!takeClaudeBudget()) throw new Error(`claude budget: daily cap of ${CLAUDE_DAILY_CAP} calls reached`);
  lastClaude.set(k, now);
  const res = await fetch(`${OR}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: FALLBACK_MODEL,
      max_tokens: 200,
      messages: [
        { role: "system", content: "You are a loan risk agent. Pick exactly one action from the menu. Reply with JSON only: {\"action\":\"hold|deleverage10|deleverage30|borrow\",\"reason\":\"one sentence for the borrower\"}." },
        { role: "user", content: JSON.stringify(facts(s, m)) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "decision",
          strict: true,
          schema: { type: "object", additionalProperties: false, required: ["action", "reason"], properties: { action: { type: "string", enum: ["hold", "deleverage10", "deleverage30", "borrow"] }, reason: { type: "string" } } },
        },
      },
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  const text = body?.choices?.[0]?.message?.content ?? "";
  const j = JSON.parse(String(text).slice(String(text).indexOf("{"), String(text).lastIndexOf("}") + 1));
  if (!["hold", "deleverage10", "deleverage30", "borrow"].includes(j.action)) throw new Error(`claude gave ${text.slice(0, 120)}`);
  return { action: j.action, reason: String(j.reason).slice(0, 280), source: "claude" };
}

function jevReason(s: State, a: Action, j: { confidence: number; probabilities: Record<string, number> }) {
  const p = Object.entries(j.probabilities).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ");
  const why = a === "hold" ? holdReason(s) : a === "borrow" ? `Market ${s.market.open ? "open" : "closed"}, LTV ${pct(s.ltvBps)}, unused authority ${usd(borrowRoom(s))} USDG.` : `LTV ${pct(s.ltvBps)}, market ${s.market.open ? "open" : "closed"}.`;
  return `${why} Jev: ${p} (confidence ${Math.round(j.confidence * 100)}%).`;
}

/** Guard first, then the model (Jev, Claude if Jev is unsure or down), then deterministic mandate checks. */
/** Model calls cost credit: ask again only when the state moved materially. */
const MODEL_REFRESH_S = Number(process.env.MODEL_REFRESH_S ?? 60);
type Snap = { ltvBps: number; bucket: number; open: boolean; revoked: boolean; lastRenewed: bigint; at: number; d: Decision };
const modelCache = new Map<string, Snap>();
const bucketOf = (s: State) => (s.authority === 0n || s.authorityBase === 0n ? 0 : 1 + Number((s.authority * 4n) / (s.authorityBase + 1n)));
function material(s: State, c: Snap | undefined) {
  if (!c) return "first look";
  if (s.lastRenewed !== c.lastRenewed) return "new World renewal";
  if (Math.abs(s.ltvBps - c.ltvBps) >= 50) return "LTV moved";
  if (bucketOf(s) !== c.bucket) return "authority bucket changed";
  if (s.market.open !== c.open) return "market changed";
  if (s.revoked !== c.revoked) return "revoke changed";
  if (Date.now() / 1000 - c.at >= MODEL_REFRESH_S) return "refresh";
  return null;
}

export async function decide(s: State, opts: { useModel?: boolean } = {}): Promise<Decision> {
  const g = guard(s);
  if (g) return g;
  const m = mandateFor(s.owner);
  const apiKey = process.env.OPENROUTER_API_KEY;
  const useModel = (opts.useModel ?? true) && !!apiKey && process.env.AGENT_SOURCE !== "rules";
  if (!useModel) return rules(s, m);

  const key = s.owner.toLowerCase();
  const cached = modelCache.get(key);
  const why = material(s, cached);
  let d: Decision;
  if (!why && cached) {
    d = { ...cached.d, source: "cached", amount: undefined };
  } else {
    d = await askModel(s, m, apiKey!);
    modelCache.set(key, { ltvBps: s.ltvBps, bucket: bucketOf(s), open: s.market.open, revoked: s.revoked, lastRenewed: s.lastRenewed, at: Date.now() / 1000, d });
  }
  return finalize(s, m, d, why === "new World renewal");
}

async function askModel(s: State, m: MandateCfg, apiKey: string): Promise<Decision> {
  let d: Decision;
  try {
    const j = await askJev(s, m, apiKey!);
    const action = JEV_MAP[j.choice] ?? "hold";
    if (j.confidence >= JEV_MIN_CONFIDENCE) d = { action, reason: jevReason(s, action, j), source: "jev", jev: j };
    else {
      try {
        d = { ...(await askClaude(s, m, apiKey!)), jev: j };
      } catch (e) {
        console.warn(`claude fallback failed: ${(e as Error).message}`);
        d = { ...rules(s, m), jev: j };
      }
    }
  } catch (e) {
    console.warn(`jev failed: ${(e as Error).message}`);
    try {
      d = await askClaude(s, m, apiKey!);
    } catch (e2) {
      console.warn(`claude failed: ${(e2 as Error).message}`);
      d = rules(s, m);
    }
  }
  return d;
}

function finalize(s: State, m: MandateCfg, d: Decision, freshRenewal: boolean): Decision {
  // The mandate's hard constraints win over the model.
  const mr = mandateRule(s, m);
  if (mr && d.action !== "deleverage30" && d.action !== mr.action) return { ...mr, jev: d.jev, overridden: `${d.source}:${d.action}` };
  // The mandate grants leverage up to the renewed authority while the market is open: right after a
  // World renewal the agent uses it at once (authority starts decaying from the proof).
  if (freshRenewal && d.action === "hold" && s.market.open && !s.revoked && borrowRoom(s) >= MIN_BORROW)
    d = { ...d, action: "borrow", reason: `Fresh World renewal and the market is open: levering up within your authority as the mandate allows. ${d.reason}`, overridden: `${d.source}:hold` };
  if (d.action === "borrow") {
    const room = borrowRoom(s);
    if (!s.market.open) return { action: "hold", reason: "The model wanted to borrow, but the market is closed and your mandate says no leverage over the weekend.", source: "mandate", jev: d.jev, overridden: `${d.source}:borrow` };
    if (room < MIN_BORROW) return { action: "hold", reason: holdReason(s), source: d.source, jev: d.jev, overridden: room === 0n ? `${d.source}:borrow (no room)` : undefined };
    d.amount = room;
  }
  return d;
}

// ------------------------------------------------------------------ acting

export type Outcome = { txHash?: Hash; blocked?: boolean; skipped?: string; retriedWith?: number; error?: ReturnType<typeof decodeError>; result?: Record<string, unknown> };

function events(receipt: TransactionReceipt) {
  const out: Record<string, any> = {};
  for (const l of receipt.logs) {
    if (l.address.toLowerCase() !== dep.vault.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }) as any;
      out[e.eventName] = jsonSafe(e.args);
    } catch {}
  }
  return out;
}

/** Simulates, then sends. A refused borrow is also broadcast with a fixed gas limit (BROADCAST_BLOCKED=0
 * to skip) so the block lands on chain as a reverted tx anyone can look up. */
async function call(w: Wallet, functionName: string, args: unknown[], broadcastOnRevert: boolean): Promise<Outcome> {
  try {
    const { request } = await pub.simulateContract({ account: w.account, address: dep.vault, abi: [...vaultAbi, ...allErrorsAbi], functionName, args } as any);
    const hash = await withNonceRetry(w, () => w.writeContract(request as any));
    const receipt = await pub.waitForTransactionReceipt({ hash });
    await settle();
    if (receipt.status !== "success") return { txHash: hash, blocked: true, error: { name: "Reverted", shortMessage: "reverted when mined", args: undefined, details: undefined } };
    return { txHash: hash, result: events(receipt) };
  } catch (err) {
    const error = decodeError(err);
    console.warn(`${functionName} refused: ${error.name} ${error.args ?? ""} | ${error.shortMessage} | details: ${error.details ?? "-"}`);
    if (error.name === "Unknown") return { blocked: true, error }; // not a contract refusal: RPC / nonce / network
    let txHash: Hash | undefined;
    if (broadcastOnRevert && process.env.BROADCAST_BLOCKED !== "0") {
      try {
        txHash = await withNonceRetry(w, () => w.sendTransaction({ to: dep.vault, data: encodeFunctionData({ abi: vaultAbi, functionName, args } as any), gas: 300_000n } as any));
        await pub.waitForTransactionReceipt({ hash: txHash });
        await settle();
      } catch (e) {
        console.warn(`broadcast of refused tx failed: ${decodeError(e).shortMessage}`);
      }
    }
    return { blocked: true, error, txHash };
  }
}

/** Self-imposed: at most one deleverage per owner every DELEVERAGE_COOLDOWN_S (chain time), so the
 * agent's sells are not a predictable stream to sandwich. Disclosed in the README. */
const DELEVERAGE_COOLDOWN_S = Number(process.env.DELEVERAGE_COOLDOWN_S ?? 20);
const lastDeleverage = new Map<string, bigint>();

async function deleverageCall(w: Wallet, owner: Address, bps: number): Promise<Outcome> {
  // Debt read at the latest block (the state may be a few seconds old).
  const [, debt] = (await pub.readContract({ address: dep.vault, abi: vaultAbi, functionName: "positions", args: [owner] })) as bigint[];
  const target = (debt * BigInt(bps)) / 10_000n;
  if (target === 0n) return {};
  const colIn = (await pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "getAmountIn", args: [dep.usdg, target] })) as bigint;
  const maxIn = (colIn * 102n) / 100n;
  return call(w, "deleverage", [owner, bps, maxIn], false);
}

export async function act(w: Wallet, owner: Address, d: Decision, s: State): Promise<Outcome> {
  if (d.action === "hold") return {};
  if (d.action === "borrow") {
    if (!d.amount || d.amount <= 0n) return {};
    return call(w, "agentBorrow", [owner, d.amount], true);
  }
  const k = owner.toLowerCase();
  const last = lastDeleverage.get(k);
  if (last !== undefined && s.chainTs - last < BigInt(DELEVERAGE_COOLDOWN_S))
    return { skipped: `deleverage cooldown: last one ${s.chainTs - last}s ago, minimum ${DELEVERAGE_COOLDOWN_S}s` };
  const bps = d.action === "deleverage30" ? 3000 : 1000;
  let o = await deleverageCall(w, owner, bps);
  if (o.blocked && o.error?.name === "SlippageExceeded" && bps === 3000) {
    console.warn(`deleverage 30% for ${owner} refused: pool is too far below the oracle (SlippageExceeded ${o.error.args?.join(", ")}); is the keeper keeping the pool at the oracle? Retrying with 10%.`);
    o = await deleverageCall(w, owner, 1000);
    o.retriedWith = 1000;
  }
  if (!o.blocked && o.txHash) lastDeleverage.set(k, s.chainTs);
  return o;
}

const HOLD_LOG_S = Number(process.env.HOLD_LOG_S ?? 300);
const lastLogged = new Map<string, { action: string; at: number }>();
/** Holds are logged when they follow a different action, or every HOLD_LOG_S: the feed stays readable. */
function logDecision(entry: Record<string, any>) {
  const k = String(entry.owner).toLowerCase();
  const prev = lastLogged.get(k);
  const now = Date.now() / 1000;
  if (entry.action === "hold" && !entry.txHash && prev?.action === "hold" && now - prev.at < HOLD_LOG_S) return;
  lastLogged.set(k, { action: entry.action, at: now });
  log(entry);
}

export function log(entry: Record<string, unknown>) {
  appendFileSync(LOG_FILE, JSON.stringify(jsonSafe(entry)) + "\n");
}

export function summarize(s: State) {
  return {
    block: Number(s.block),
    chainTs: Number(s.chainTs),
    collateral: Number(s.collateral) / 1e18,
    debt: usd(s.debt),
    value: usd(s.value),
    ltvBps: s.ltvBps,
    liquidatable: s.liquidatable,
    authority: usd(s.authority),
    authorityBase: usd(s.authorityBase),
    revoked: s.revoked,
    price: Number(s.price8) / 1e8,
    priceAge: s.priceAge,
    market: s.market.label,
  };
}

/** One full pass for one owner: read, decide, act, log. Returns the log entry. */
export async function step(w: Wallet, owner: Address, opts: { decision?: Decision; useModel?: boolean } = {}) {
  owner = getAddress(owner);
  const s = await readState(owner);
  if (s.agent.toLowerCase() !== w.account.address.toLowerCase()) {
    const entry = { ts: new Date().toISOString(), owner, state: summarize(s), action: "hold", reason: s.agent === "0x0000000000000000000000000000000000000000" ? "No mandate: this borrower has not appointed an agent." : `Mandate names another agent (${s.agent}).`, source: "rules" };
    logDecision(entry);
    return entry;
  }
  const d = opts.decision ?? (await decide(s, { useModel: opts.useModel }));
  const o = await act(w, owner, d, s);
  const entry = {
    ts: new Date().toISOString(),
    owner,
    state: summarize(s),
    action: d.action,
    amount: d.amount !== undefined ? usd(d.amount) : undefined,
    reason: o.skipped ? `${d.reason} Not sent: ${o.skipped}.` : o.blocked ? `Blocked by Releash: ${o.error?.name}${o.error?.args ? `(${o.error.args.join(", ")})` : ""}. ${d.reason}` : d.reason,
    source: d.source,
    jev: d.jev,
    overridden: d.overridden,
    txHash: o.txHash,
    blocked: o.blocked,
    error: o.error,
    result: o.result,
    skipped: o.skipped,
    retriedWith: o.retriedWith,
  };
  if (opts.decision) log(entry); // manual attempts always show
  else logDecision(entry);
  return entry;
}

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
const usd = (x: bigint) => Math.round(Number(x) / 1e4) / 100;

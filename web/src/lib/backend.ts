import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { BACKEND_URL } from "../config";

export class BackendError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    });
  } catch {
    throw new BackendError("Backend unreachable", 0);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body
  }
  if (!res.ok) {
    const j = json as { error?: string; message?: string; detail?: string } | null;
    throw new BackendError(j?.error ?? j?.message ?? j?.detail ?? `Backend ${res.status}`, res.status);
  }
  return json as T;
}

// ---------------------------------------------------------------- market clock

export type Market = {
  open: boolean;
  label: string; // OPEN, WEEKEND, CLOSED
  frozenSince?: number; // unix seconds
  nextOpen?: number;
  price?: number;
};

/** Accepts a few plausible shapes from the keeper's market.json; anything unknown degrades to null. */
function normalizeMarket(raw: unknown): Market | null {
  if (!raw || typeof raw !== "object") return null;
  const m = ((raw as Record<string, unknown>).market ?? raw) as Record<string, unknown>;
  const state = String(m.state ?? m.status ?? m.label ?? "").toUpperCase();
  const open = typeof m.open === "boolean" ? m.open : state ? state === "OPEN" : true;
  const label = state || (open ? "OPEN" : "WEEKEND");
  const t = (v: unknown) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v === "number") return v > 1e12 ? v / 1000 : v;
    const d = Date.parse(String(v));
    return Number.isNaN(d) ? undefined : d / 1000;
  };
  return {
    open,
    label: open ? "OPEN" : label === "OPEN" ? "CLOSED" : label,
    frozenSince: t(m.frozenSince ?? m.closedAt ?? m.closeAt ?? m.since),
    nextOpen: t(m.nextOpen ?? m.opensAt ?? m.nextOpenAt),
    price: typeof m.price === "number" ? m.price : undefined,
  };
}

export function useMarket() {
  return useQuery({
    queryKey: ["market"],
    queryFn: async () => normalizeMarket(await api("/api/market")),
    refetchInterval: 2000,
    retry: false,
  });
}

// ---------------------------------------------------------------- agent log

export type AgentEntry = {
  kind: "agent";
  id: string;
  ts: number;
  action: string;
  reason: string;
  amount?: number;
  ltvBps?: number;
  blocked: boolean;
  error?: string;
  txHash?: string;
  source?: string;
};

function normalizeEntry(e: Record<string, unknown>, i: number): AgentEntry {
  const tsRaw = e.ts ?? e.time ?? e.timestamp ?? e.at;
  let ts = typeof tsRaw === "number" ? tsRaw : Date.parse(String(tsRaw)) / 1000;
  if (ts > 1e12) ts /= 1000;
  if (!Number.isFinite(ts)) ts = 0;
  const decision = (e.decision ?? {}) as Record<string, unknown>;
  const result = (e.result ?? {}) as Record<string, unknown>;
  const error = (e.error ?? e.errorName ?? result.error ?? result.errorName) as string | undefined;
  const status = String(e.status ?? result.status ?? "");
  const blocked = Boolean(e.blocked ?? result.blocked) || /blocked|revert/i.test(status) || !!error;
  const ltv = e.ltvBps ?? (e.state as Record<string, unknown> | undefined)?.ltvBps;
  return {
    kind: "agent",
    id: String(e.id ?? `${ts}-${i}`),
    ts,
    action: String(e.action ?? decision.action ?? "hold"),
    reason: String(e.reason ?? decision.reason ?? ""),
    amount: typeof (e.amount ?? decision.amount) === "number" ? ((e.amount ?? decision.amount) as number) : undefined,
    ltvBps: typeof ltv === "number" ? ltv : undefined,
    blocked,
    error: error ? String(error).replace(/^Blocked on-chain:\s*/i, "") : undefined,
    txHash: (e.txHash ?? e.tx ?? result.txHash) as string | undefined,
    source: (e.source ?? e.by) as string | undefined,
  };
}

export function useAgentLog(owner: Address | undefined) {
  return useQuery({
    queryKey: ["agentlog", owner],
    queryFn: async () => {
      const raw = await api<unknown>(`/api/agent/log?owner=${owner}`);
      const list = Array.isArray(raw) ? raw : ((raw as { entries?: unknown[]; log?: unknown[] })?.entries ?? (raw as { log?: unknown[] })?.log ?? []);
      return (list as Record<string, unknown>[]).map(normalizeEntry);
    },
    enabled: !!owner,
    refetchInterval: 2000,
    retry: false,
  });
}

// ---------------------------------------------------------------- renew

export type RenewalResponse = {
  renewal: { owner: Address; agent: Address; issuedAt: string | number; deadline: string | number };
  signature: `0x${string}`;
};

export type RpContextResponse = {
  app_id?: string;
  action?: string;
  environment?: "production" | "staging";
  allow_legacy_proofs?: boolean;
  rp_context: { rp_id: string; nonce: string; created_at: number; expires_at: number; signature: string };
};

/** IDKit v4 needs a fresh rp_context signed by the backend for each request. */
export async function fetchRpContext(): Promise<RpContextResponse> {
  try {
    return await api<RpContextResponse>("/api/rp-context", {});
  } catch (e) {
    if (e instanceof BackendError && (e.status === 404 || e.status === 405)) return api<RpContextResponse>("/api/rp-context");
    throw e;
  }
}

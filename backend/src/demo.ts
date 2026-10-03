/** Demo-only routes (DEMO_ENABLED=1 + header x-demo-key == DEMO_KEY). They drive the keeper, demo setup
 * and the agent's "attempt" through the agent package's own functions, in this process. */
import { timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, parseUnits } from "viem";

const bad = (status: number, message: string) => Object.assign(new Error(message), { status });

export async function demoRoutes(env: NodeJS.ProcessEnv = process.env) {
  const key = env.DEMO_KEY ?? "";
  if (key.length < 8) throw new Error("DEMO_ENABLED=1 needs DEMO_KEY (at least 8 characters)");
  // Imported lazily: these modules read CHAIN_ID / RPC_URL / *_PK from the environment at load time.
  const keeper = await import("../../agent/keeper.js");
  const { setup } = await import("../../agent/demo-setup.js");
  const agentMod = await import("../../agent/src/agent.js");
  const chain = await import("../../agent/src/chain.js");
  const agentWallet = chain.wallet(chain.key("AGENT_PK"));

  // One demo action at a time: they share the keeper key (nonces) and the market file.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  const authorized = (header: string | undefined) => {
    const a = Buffer.from(header ?? "");
    const b = Buffer.from(key);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const guard = <T>(fn: (body: any) => Promise<T>) => async (body: any, _q: URLSearchParams, headers: Record<string, string | string[] | undefined>) => {
    if (!authorized(headers["x-demo-key"] as string | undefined)) throw bad(401, "demo key required (x-demo-key)");
    return serial(() => fn(body ?? {}));
  };

  console.warn(`[DEMO] demo routes enabled: /api/demo/{close,gap,reset,attempt-borrow} (agent ${agentWallet.account.address})`);
  return {
    "POST /api/demo/close": guard(async () => ({ ok: true, market: "WEEKEND", ...(await keeper.close()) })),
    "POST /api/demo/gap": guard(async (b) => {
      const pct = Number(b.pct ?? -35);
      if (!Number.isFinite(pct) || pct <= -90 || pct >= 100) throw bad(400, "pct must be a number between -90 and 100");
      return { ok: true, ...(await keeper.gap(pct)) };
    }),
    "POST /api/demo/reset": guard(async () => ({ ok: true, ...(await setup()) })),
    "POST /api/demo/attempt-borrow": guard(async (b) => {
      if (!isAddress(b.owner ?? "")) throw bad(400, "owner must be an address");
      let amount: bigint;
      try {
        amount = parseUnits(String(b.amount ?? ""), 6);
      } catch {
        throw bad(400, "amount must be a USDG amount, e.g. \"1500\"");
      }
      if (amount <= 0n) throw bad(400, "amount must be positive");
      const entry: any = await agentMod.step(agentWallet, getAddress(b.owner), {
        decision: { action: "borrow", amount, reason: `Demo: the agent tries to borrow ${b.amount} USDG.`, source: "manual" },
      });
      return { ok: true, blocked: !!entry.blocked, error: entry.error?.name, errorArgs: entry.error?.args, txHash: entry.txHash, entry };
    }),
  };
}

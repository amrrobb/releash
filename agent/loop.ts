/** Agent loop (SPEC §5): every LOOP_MS (10 s) per owner in WATCH: read, guard, decide, act, log. */
import { getAddress, type Address } from "viem";
import { key, wallet, CHAIN_ID, pub, dep, vaultAbi } from "./src/chain.js";
import { step, LOG_FILE } from "./src/agent.js";
import { isMain } from "./src/main.js";

export function watchList(): Address[] {
  const raw = process.env.WATCH ?? "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((a) => getAddress(a));
}

async function main() {
  const agent = wallet(key("AGENT_PK"));
  const owners = watchList();
  if (!owners.length) throw new Error("WATCH is empty: set WATCH=0xOwner1,0xOwner2");
  const ms = Number(process.env.LOOP_MS ?? 10_000);
  const src = process.env.OPENROUTER_API_KEY && process.env.AGENT_SOURCE !== "rules" ? "jev -> claude -> rules" : "rules (no OPENROUTER_API_KEY or AGENT_SOURCE=rules)";
  console.log(`agent ${agent.account.address} on chain ${CHAIN_ID}, watching ${owners.join(", ")}, every ${ms} ms, decisions: ${src}, log: ${LOG_FILE}`);
  for (;;) {
    for (const owner of owners) {
      try {
        const e: any = await step(agent, owner);
        console.log(`${e.ts} ${owner.slice(0, 8)} LTV ${(e.state.ltvBps / 100).toFixed(1)}% auth ${e.state.authority} -> ${e.action}${e.amount ? ` ${e.amount}` : ""} [${e.source}]${e.blocked ? ` BLOCKED ${e.error?.name}` : ""}${e.txHash ? ` ${e.txHash}` : ""}`);
      } catch (err: any) {
        console.error(`step ${owner} failed: ${err.shortMessage ?? err.message} | details: ${err.details ?? "-"}`);
      }
    }
    // Sleep in 1 s slices; a fresh World renewal wakes the loop at once, because authority decays
    // from the moment of the proof (with a 60 s half-life the lever-up window is only seconds).
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await renewedSince(owners)) break;
    }
  }
}

const seen = new Map<string, bigint>();
async function renewedSince(owners: Address[]) {
  let changed = false;
  for (const o of owners) {
    try {
      const m = (await pub.readContract({ address: dep.vault, abi: vaultAbi, functionName: "mandates", args: [o] })) as any[];
      const last = m[2] as bigint;
      const prev = seen.get(o);
      seen.set(o, last);
      if (prev !== undefined && last !== prev) changed = true;
    } catch {}
  }
  return changed;
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

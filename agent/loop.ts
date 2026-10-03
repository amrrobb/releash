/** Agent loop (SPEC §5): every LOOP_MS (10 s) per owner in WATCH: read, guard, decide, act, log. */
import { getAddress, type Address } from "viem";
import { key, wallet, CHAIN_ID } from "./src/chain.js";
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
    await new Promise((r) => setTimeout(r, ms));
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

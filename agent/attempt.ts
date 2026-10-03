/** Demo trigger: make the agent attempt one action through the normal path (logged like any decision).
 *   tsx attempt.ts borrow 1500 0xOwner      try to add 1,500 USDG (blocked if beyond authority)
 *   tsx attempt.ts deleverage30 0xOwner
 */
import { getAddress, parseUnits } from "viem";
import { key, wallet } from "./src/chain.js";
import { step, type Action } from "./src/agent.js";

const [action, a, b] = process.argv.slice(2) as [Action, string, string];
const amount = action === "borrow" ? parseUnits(a, 6) : undefined;
const owner = getAddress(action === "borrow" ? b : a);
const e = await step(wallet(key("AGENT_PK")), owner, { decision: { action, amount, reason: `Manual demo attempt: ${action}${a && action === "borrow" ? ` ${a} USDG` : ""}.`, source: "manual" } });
console.log(JSON.stringify(e, null, 2));

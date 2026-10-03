/** Liquidates any watched owner above the 70% threshold, repaying the 50% close factor. */
import { getAddress, type Address } from "viem";
import { dep, key, pub, send, usdgAbi, vaultAbi, wallet, decodeError, jsonSafe, LOCAL } from "./src/chain.js";
import { isMain } from "./src/main.js";
import { decodeEventLog } from "viem";

const liq = wallet(key("LIQUIDATOR_PK"));

export async function liquidateOnce(owners: Address[]) {
  const done: any[] = [];
  for (const owner of owners) {
    const [, debt, ltvBps, liquidatable] = (await pub.readContract({ address: dep.vault, abi: vaultAbi, functionName: "healthOf", args: [owner] })) as [bigint, bigint, bigint, boolean];
    if (!liquidatable) continue;
    const repay = (debt * 5000n) / 10_000n;
    try {
      const bal = (await pub.readContract({ address: dep.usdg, abi: usdgAbi, functionName: "balanceOf", args: [liq.account.address] })) as bigint;
      if (bal < repay) await send(liq, dep.usdg, usdgAbi, "mint", [liq.account.address, 100_000n * 10n ** 6n]); // open demo faucet
      const allowance = (await pub.readContract({ address: dep.usdg, abi: usdgAbi, functionName: "allowance", args: [liq.account.address, dep.vault] })) as bigint;
      if (allowance < repay) await send(liq, dep.usdg, usdgAbi, "approve", [dep.vault, 2n ** 256n - 1n]);
      const receipt = await send(liq, dep.vault, vaultAbi, "liquidate", [owner, repay]);
      const ev = receipt.logs.map((l) => { try { return decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }) as any; } catch { return null; } }).find((e) => e?.eventName === "Liquidated");
      const r = { owner, ltvBps: Number(ltvBps), txHash: receipt.transactionHash, ...jsonSafe(ev?.args ?? {}) };
      console.log(`LIQUIDATED ${owner} at LTV ${(Number(ltvBps) / 100).toFixed(1)}%: repaid ${Number(ev?.args?.debtRepaid ?? 0n) / 1e6} USDG, seized ${Number(ev?.args?.collateralSeized ?? 0n) / 1e18} rNVDA (${receipt.transactionHash})`);
      done.push(r);
    } catch (err) {
      const e = decodeError(err);
      console.warn(`liquidate ${owner} failed: ${e.name} | ${e.shortMessage} | details: ${e.details ?? "-"}`);
    }
  }
  return done;
}

async function main() {
  const owners = (process.env.WATCH ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((a) => getAddress(a));
  if (!owners.length) throw new Error("WATCH is empty");
  console.log(`liquidator ${liq.account.address} watching ${owners.join(", ")}${LOCAL ? " (anvil)" : ""}`);
  for (;;) {
    await liquidateOnce(owners).catch((e) => console.error(e.shortMessage ?? e));
    await new Promise((r) => setTimeout(r, Number(process.env.LOOP_MS ?? 5000)));
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });

/** End-to-end demo story on anvil (SPEC §7). Every number printed comes from a receipt's events or a
 * read at a mined block. Do not run loop.ts on the agent key at the same time (nonce collisions).
 *   CHAIN_ID=31337 npx tsx e2e.ts            (decisions: rules; E2E_MODEL=1 to ask Jev/Claude)
 *   BACKEND_URL=http://127.0.0.1:8787 ...    use a running backend (must have WORLD_SIMULATE=1)
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeEventLog, type Address } from "viem";
import { dep, key, LOCAL, pub, send, vaultAbi, wallet, jsonSafe, sleep, CHAIN_ID } from "./src/chain.js";
import { readState, step, summarize } from "./src/agent.js";
import { rebalancePool, oraclePrice } from "./src/market.js";
import { setup } from "./demo-setup.js";
import { close, gap } from "./keeper.js";
import { liquidateOnce } from "./liquidator.js";

const SKIP_DECAY = process.env.E2E_SKIP_DECAY === "1";
const txs: [string, string | undefined][] = [];
const useModel = process.env.E2E_MODEL === "1";
if (!useModel) process.env.AGENT_SOURCE = "rules";

const agent = wallet(key("AGENT_PK"));
const alice = wallet(key("ALICE_PK"));
const keeperW = wallet(key("KEEPER_PK"));
const A = alice.account.address;
const C = wallet(key("CONTROL_PK")).account.address;

const rows: string[] = [];
let failures = 0;
function beat(name: string, ok: boolean, detail: string) {
  if (!ok) failures++;
  const line = `${ok ? "PASS" : "FAIL"}  ${name.padEnd(44)} ${detail}`;
  rows.push(line);
  console.log(line);
}
const n6 = (x: unknown) => (Number(x) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const n18 = (x: unknown) => (Number(x) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 3 });
const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;
/** anvil: jump chain time. Public chain: wait in real time. */
async function warp(seconds: number) {
  if (!LOCAL) return sleep((seconds + 2) * 1000);
  await pub.request({ method: "evm_increaseTime" as any, params: [seconds] as any });
  await pub.request({ method: "evm_mine" as any, params: [] as any });
}
async function health(o: Address) {
  const [value, debt, ltv, liq] = (await pub.readContract({ address: dep.vault, abi: vaultAbi, functionName: "healthOf", args: [o] })) as [bigint, bigint, bigint, boolean];
  const [col] = (await pub.readContract({ address: dep.vault, abi: vaultAbi, functionName: "positions", args: [o] })) as bigint[];
  return { value, debt, ltv: Number(ltv), liq, col };
}

async function backend() {
  if (process.env.BACKEND_URL) return { url: process.env.BACKEND_URL, close: async () => {} };
  const { loadConfig } = await import("../backend/src/config.js");
  const { startServer } = await import("../backend/src/server.js");
  const cfg = loadConfig({ ...process.env, WORLD_SIMULATE: "1", PORT: "0", DB_PATH: join(mkdtempSync(join(tmpdir(), "releash-e2e-")), "e2e.db") });
  return startServer(cfg);
}

async function main() {
  console.log("== setup");
  const s0 = await setup();
  console.log(JSON.stringify(s0));
  const st0 = await readState(A);
  beat("setup: Alice 100 rNVDA / 8,000 USDG, mandate 9,500", st0.debt === 8000_000000n && st0.authorityBase === 9500_000000n, `LTV ${pct(st0.ltvBps)}, authority ${n6(st0.authority)} (not renewed for this mandate yet)`);

  console.log("== renew via backend (WORLD_SIMULATE)");
  const srv = await backend();
  const nullifier = `0xe2e${Date.now().toString(16)}`;
  let rr: any, r: any;
  // A revoke in the previous run raised renewalFloor to that second: a renewal signed in the same
  // second is RenewalNotNewer, so ask again with a fresh one (what the web does too).
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${srv.url}/api/renew`, { method: "POST", body: JSON.stringify({ owner: A, agent: agent.account.address, idkitResult: { responses: [{ identifier: "proof_of_human", nullifier }] } }) });
    const body: any = await res.json();
    if (res.status !== 200) throw new Error(`renew ${res.status}: ${JSON.stringify(body)}`);
    r = { ...body.renewal, issuedAt: BigInt(body.renewal.issuedAt), deadline: BigInt(body.renewal.deadline) };
    // issuedAt may be a second ahead of the chain (just above renewalFloor): wait for chain time.
    while ((await pub.getBlock({ blockTag: "latest" })).timestamp < r.issuedAt) await sleep(300);
    try {
      rr = await send(alice, dep.vault, vaultAbi, "renew", [r, body.signature]);
      break;
    } catch (e) {
      if (attempt >= 3 || !String((e as any).shortMessage ?? e).includes("RenewalNotNewer") && !JSON.stringify((e as any).cause?.data ?? "").includes("RenewalNotNewer")) throw e;
      await new Promise((ok) => setTimeout(ok, 1200));
    }
  }
  const renewed = rr.logs.map((l) => { try { return decodeEventLog({ abi: vaultAbi, data: l.data, topics: l.topics }) as any; } catch { return null; } }).find((e) => e?.eventName === "Renewed");
  txs.push(["renew (World)", rr.transactionHash]);
  beat("World renew accepted on chain", renewed?.args.issuedAt === r.issuedAt, `Renewed.issuedAt ${renewed?.args.issuedAt} (tx ${rr.transactionHash.slice(0, 10)})`);

  console.log("== agent levers up within authority");
  const e1: any = await step(agent, A, { useModel });
  beat("agent levers up within authority (~8,800)", e1.action === "borrow" && !e1.blocked && BigInt(e1.result?.Borrowed?.newDebt ?? 0) >= 8_800_000000n, `+${n6(e1.result?.Borrowed?.amount)} USDG -> debt ${n6(e1.result?.Borrowed?.newDebt)} (authority was ${e1.state.authority}) [${e1.source}]`);

  txs.push(["agent borrow (within authority)", e1.txHash]);
  console.log("== agent tries beyond authority");
  const st2 = await readState(A);
  const over = st2.authority - st2.debt + 500_000000n;
  const e2: any = await step(agent, A, { decision: { action: "borrow", amount: over > 0n ? over : 500_000000n, reason: "Demo: try to borrow 500 USDG past the authority.", source: "manual" } });
  beat("agent borrow beyond authority is BLOCKED", !!e2.blocked && e2.error?.name === "AuthorityExceeded", `${e2.error?.name}(${e2.error?.args?.map(n6).join(", ")}) reverted tx ${e2.txHash?.slice(0, 10) ?? "-"}`);

  txs.push(["agent borrow beyond authority (reverted AuthorityExceeded)", e2.txHash]);
  console.log("== time passes: authority decays");
  const decay: string[] = [];
  if (SKIP_DECAY) {
    // Zero authority without waiting 3 half-lives: fire and re-appoint, which leaves the mandate unrenewed.
    await send(alice, dep.vault, vaultAbi, "fire", []);
    await send(alice, dep.vault, vaultAbi, "setMandate", [agent.account.address, 9500_000000n]);
    decay.push("skipped (E2E_SKIP_DECAY=1): mandate re-appointed unrenewed");
  } else {
    if (!LOCAL) console.log(`waiting ${3 * dep.halfLife}s of real time for 3 half-lives...`);
    for (let i = 1; i <= 3; i++) {
      await warp(dep.halfLife);
      const s = await readState(A);
      decay.push(`t+${Number(s.chainTs - r.issuedAt)}s ${n6(s.authority)}`);
    }
  }
  const st3 = await readState(A);
  beat("authority halves, then hits zero", st3.authority === 0n, decay.join(" | "));
  const e3: any = await step(agent, A, { decision: { action: "borrow", amount: 100_000000n, reason: "Demo: borrow 100 USDG with zero authority.", source: "manual" } });
  beat("borrow with decayed authority is BLOCKED", !!e3.blocked && e3.error?.name === "AuthorityExceeded", `${e3.error?.name}(${e3.error?.args?.map(n6).join(", ")})`);

  console.log("== Friday close: agent de-risks before the weekend");
  await close();
  const pre = await health(A);
  const e4: any = await step(agent, A, { useModel });
  const d4 = e4.result?.Deleveraged;
  const post = await health(A);
  beat("weekend: agent deleverages (authority 0)", !!d4, `${e4.action} [${e4.source}] sold ${n18(d4?.collateralSold)} rNVDA, repaid ${n6(d4?.debtRepaid)}: LTV ${pct(pre.ltv)} -> ${pct(post.ltv)}`);

  txs.push(["weekend deleverage 30%", e4.txHash]);
  console.log("== Monday gap -35%");
  const g = await gap(-35);
  const ctl = await health(C);
  const al = await health(A);
  beat("after gap: control is liquidatable", ctl.liq, `price ${g.before} -> ${g.after} (pool ${g.pool.toFixed(2)}), control LTV ${pct(ctl.ltv)}, Alice LTV ${pct(al.ltv)}`);
  const liq = await liquidateOnce([A, C]);
  const ctlAfter = await health(C);
  const lc = liq.find((x) => x.owner === C);
  beat("liquidator liquidates control", !!lc, `repaid ${n6(lc?.debtRepaid)} USDG, seized ${n18(lc?.collateralSeized)} rNVDA; control now ${n18(ctlAfter.col)} rNVDA / ${n6(ctlAfter.debt)} USDG`);
  txs.push(["liquidation of control", lc?.txHash]);
  beat("Alice is not liquidated", !liq.find((x) => x.owner === A) && !(await health(A)).liq, `Alice LTV ${pct(al.ltv)} < 70%`);
  await warp(21); // agent cooldown: one deleverage per 20 s per owner
  const e5: any = await step(agent, A, { useModel });
  const a5 = await health(A);
  beat("agent guard trims Alice after the gap", !!e5.result?.Deleveraged || e5.action === "hold", `${e5.action} [${e5.source}] -> LTV ${pct(a5.ltv)}`);

  console.log("== revoke: close always, open only while alive");
  const rv = await send(alice, dep.vault, vaultAbi, "revoke", []);
  txs.push(["revoke", rv.transactionHash]);
  const { price8 } = await oraclePrice();
  await rebalancePool(keeperW, Number(price8) / 1e8); // keep the pool at the oracle (agent slippage cap is 15%)
  await warp(21);
  const e6: any = await step(agent, A, { decision: { action: "deleverage10", reason: "Demo: deleverage after revoke.", source: "manual" } });
  beat("after revoke: agent deleverage still works", !!e6.result?.Deleveraged, `repaid ${n6(e6.result?.Deleveraged?.debtRepaid)} USDG (tx ${e6.txHash?.slice(0, 10)})`);
  const e7: any = await step(agent, A, { decision: { action: "borrow", amount: 100_000000n, reason: "Demo: borrow after revoke.", source: "manual" } });
  beat("after revoke: agent borrow BLOCKED", !!e7.blocked && e7.error?.name === "MandateRevoked", `${e7.error?.name} reverted tx ${e7.txHash?.slice(0, 10) ?? "-"}`);

  txs.push(["deleverage after revoke", e6.txHash]);
  txs.push(["agent borrow after revoke (reverted MandateRevoked)", e7.txHash]);
  await srv.close();
  const fa = summarize(await readState(A));
  const fc = await health(C);
  console.log("\n================ SUMMARY (on-chain) ================");
  for (const l of rows) console.log(l);
  console.log(`\nAlice   : ${fa.collateral.toFixed(3)} rNVDA, debt ${fa.debt} USDG, LTV ${pct(fa.ltvBps)}, liquidatable ${fa.liquidatable}, authority ${fa.authority}, revoked ${fa.revoked}`);
  console.log(`Control : ${n18(fc.col)} rNVDA, debt ${n6(fc.debt)} USDG, LTV ${pct(fc.ltv)}  (lost ${n18(100n * 10n ** 18n - fc.col)} rNVDA to the liquidator)`);
  console.log(`\nchain ${CHAIN_ID} key transactions:`);
  for (const [k, h] of txs) console.log(`  ${k.padEnd(56)} ${h ?? "-"}`);
  console.log(`price ${fa.price}, market ${fa.market}. ${failures ? `${failures} FAILED` : "ALL BEATS PASSED"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("e2e crashed:", e.shortMessage ?? e, "| details:", e.details ?? "-", jsonSafe(e.stack ?? "")); process.exit(2); });

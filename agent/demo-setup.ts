/** Brings the two demo positions to a known start (idempotent, safe to re-run):
 *  - Alice: 100 rNVDA, 8,000 USDG debt, mandate(agent, 9,000 USDG)
 *  - Control: 100 rNVDA, CONTROL_DEBT (default 8,800) USDG debt, no mandate
 * Control starts at 8,800, the debt Alice's agent levers her to, so both carry the same exposure into
 * the Monday gap. With 8,000 the control sits at 68.4% LTV after a -35% gap: below the 70% threshold,
 * nothing to liquidate.
 * Also: price 180 + pool at the oracle, market OPEN, vault liquidity topped up, gas on anvil. */
import { parseEther, type Address } from "viem";
import { dep, key, LOCAL, pub, send, stockAbi, usdgAbi, vaultAbi, wallet, fmt, type Wallet } from "./src/chain.js";
import { isMain } from "./src/main.js";
import { setPrice } from "./keeper.js";

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const COLLATERAL = 100n * E18;
const ALICE_DEBT = BigInt(process.env.ALICE_DEBT ?? 8000) * E6;
const CONTROL_DEBT = BigInt(process.env.CONTROL_DEBT ?? 8800) * E6;
const AUTHORITY = BigInt(process.env.AUTHORITY ?? 9000) * E6;

const read = (address: Address, abi: any, functionName: string, args: unknown[] = []) => pub.readContract({ address, abi, functionName, args }) as Promise<any>;

async function approveMax(w: Wallet, token: Address, abi: any) {
  const a = (await read(token, abi, "allowance", [w.account.address, dep.vault])) as bigint;
  if (a < 2n ** 200n) await send(w, token, abi, "approve", [dep.vault, 2n ** 256n - 1n]);
}

async function reconcile(w: Wallet, debtTarget: bigint) {
  const me = w.account.address;
  await approveMax(w, dep.rnvda, stockAbi);
  await approveMax(w, dep.usdg, usdgAbi);
  let [col, debt] = (await read(dep.vault, vaultAbi, "positions", [me])) as bigint[];
  if (col < COLLATERAL) {
    await send(w, dep.rnvda, stockAbi, "mint", [me, COLLATERAL - col]);
    await send(w, dep.vault, vaultAbi, "deposit", [COLLATERAL - col]);
  }
  if (debt > debtTarget) {
    await send(w, dep.usdg, usdgAbi, "mint", [me, debt - debtTarget]);
    await send(w, dep.vault, vaultAbi, "repay", [me, debt - debtTarget]);
  } else if (debt < debtTarget) {
    await send(w, dep.vault, vaultAbi, "borrow", [debtTarget - debt]);
  }
  [col] = (await read(dep.vault, vaultAbi, "positions", [me])) as bigint[];
  if (col > COLLATERAL) await send(w, dep.vault, vaultAbi, "withdraw", [col - COLLATERAL]);
  const [c, d] = (await read(dep.vault, vaultAbi, "positions", [me])) as bigint[];
  return { owner: me, collateral: fmt(c, 18), debt: fmt(d) };
}

export async function setup() {
  const keeper = wallet(key("KEEPER_PK"));
  const agent = wallet(key("AGENT_PK"));
  const alice = wallet(key("ALICE_PK"));
  const control = wallet(key("CONTROL_PK"));
  const liq = wallet(key("LIQUIDATOR_PK"));

  if (LOCAL) {
    for (const w of [keeper, agent, alice, control, liq]) {
      const b = await pub.getBalance({ address: w.account.address });
      if (b < parseEther("100")) await pub.request({ method: "anvil_setBalance" as any, params: [w.account.address, "0x56BC75E2D63100000"] as any }); // 100 ETH
    }
  }

  // Price 180 + pool + market OPEN (also makes the price fresh for borrow).
  await setPrice(180);

  // Vault liquidity: each run strands debt in the demo positions.
  const liquidity = (await read(dep.usdg, usdgAbi, "balanceOf", [dep.vault])) as bigint;
  if (liquidity < 50_000n * E6) {
    await send(keeper, dep.usdg, usdgAbi, "mint", [keeper.account.address, 100_000n * E6]);
    await approveMax(keeper, dep.usdg, usdgAbi);
    await send(keeper, dep.vault, vaultAbi, "fund", [100_000n * E6]);
  }

  // Control first: it must have no agent.
  const [controlAgent] = (await read(dep.vault, vaultAbi, "mandates", [control.account.address])) as [Address];
  if (controlAgent !== "0x0000000000000000000000000000000000000000") await send(control, dep.vault, vaultAbi, "fire", []);
  const c = await reconcile(control, CONTROL_DEBT);

  const a = await reconcile(alice, ALICE_DEBT);
  // Fresh mandate: an earlier renewal or revoke must not carry over, so the demo starts unrenewed.
  const [aAgent, , aRenewed, aRevoked] = (await read(dep.vault, vaultAbi, "mandates", [alice.account.address])) as [Address, bigint, bigint, boolean];
  if (aAgent !== "0x0000000000000000000000000000000000000000" && (aRenewed !== 0n || aRevoked || aAgent.toLowerCase() !== agent.account.address.toLowerCase()))
    await send(alice, dep.vault, vaultAbi, "fire", []);
  await send(alice, dep.vault, vaultAbi, "setMandate", [agent.account.address, AUTHORITY]);

  return { alice: a, control: c, agent: agent.account.address, liquidator: liq.account.address, authorityBase: fmt(AUTHORITY) };
}

if (isMain(import.meta.url)) {
  setup()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.log(`\nWATCH=${r.alice.owner},${r.control.owner}`);
    })
    .catch((e) => { console.error(e.shortMessage ?? e, "| details:", e.details ?? "-"); process.exit(1); });
}

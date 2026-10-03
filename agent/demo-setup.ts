/** Brings the two demo positions to a known start (idempotent, safe to re-run):
 *  - Alice: 100 rNVDA, 8,000 USDG debt, mandate(agent, 9,500 USDG): ~15 s after a renewal to lever to 8,800
 *  - Control: 100 rNVDA, CONTROL_DEBT (default 8,800) USDG debt, no mandate
 * Control starts at 8,800, the debt Alice's agent levers her to, so both carry the same exposure into
 * the Monday gap. With 8,000 the control sits at 68.4% LTV after a -35% gap: below the 70% threshold,
 * nothing to liquidate.
 * Also: price 180 + pool at the oracle, market OPEN, vault liquidity topped up, gas on anvil. */
import { parseEther, type Address } from "viem";
import { dep, key, LOCAL, pub, send, sleep, stockAbi, usdgAbi, vaultAbi, wallet, fmt, type Wallet } from "./src/chain.js";
import { isMain } from "./src/main.js";
import { setPrice } from "./keeper.js";
import { pauseKeeper, resumeKeeper, rebalancePool, setOracle } from "./src/market.js";

const E18 = 10n ** 18n;
const E6 = 10n ** 6n;
const COLLATERAL = 100n * E18;
const ALICE_DEBT = BigInt(process.env.ALICE_DEBT ?? 8000) * E6;
const CONTROL_DEBT = BigInt(process.env.CONTROL_DEBT ?? 8800) * E6;
const AUTHORITY = BigInt(process.env.AUTHORITY ?? 9500) * E6;

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

const START_PRICE = Number(process.env.START_PRICE ?? 180);

/** Re-runnable: every step reads the chain and only does what is still missing. Order matters:
 * price and pool first (receipts awaited), positions only against the restored price. */
export async function setup() {
  const t0 = Date.now();
  pauseKeeper(10 * 60_000);
  // A tick that passed its pause check just before this may still be sending: let it land first.
  if (!LOCAL) await sleep(Number(process.env.RESET_TICK_DRAIN_MS ?? 8000));
  try {
    return await setupInner(t0);
  } finally {
    resumeKeeper();
  }
}

/** Reads the vault's own price (what borrow checks) until it is the start price; re-sets it if a
 * stray writer moved it. Throws rather than borrowing against the wrong price. */
async function ensurePrice(keeper: Wallet) {
  const want = BigInt(Math.round(START_PRICE * 1e8));
  for (let i = 0; i < 4; i++) {
    const [p8] = (await read(dep.vault, vaultAbi, "price")) as bigint[];
    if (p8 === want) return;
    console.warn(`reset: vault price ${Number(p8) / 1e8}, expected ${START_PRICE}; setting it again`);
    await setOracle(keeper, START_PRICE);
    await rebalancePool(keeper, START_PRICE);
    if (!LOCAL) await sleep(1500);
  }
  throw new Error(`reset: vault price is not ${START_PRICE} after 4 attempts`);
}

async function setupInner(t0: number) {
  const keeper = wallet(key("KEEPER_PK"));
  const agent = wallet(key("AGENT_PK"));
  const alice = wallet(key("ALICE_PK"));
  const control = wallet(key("CONTROL_PK"));
  const liq = wallet(key("LIQUIDATOR_PK"));

  for (const w of [keeper, agent, alice, control, liq]) {
    const b = await pub.getBalance({ address: w.account.address });
    if (LOCAL) {
      if (b < parseEther("100")) await pub.request({ method: "anvil_setBalance" as any, params: [w.account.address, "0x56BC75E2D63100000"] as any }); // 100 ETH
    } else if (w !== keeper && b < parseEther(process.env.GAS_FLOOR ?? "0.0003")) {
      // Public testnet: top up gas from the keeper (deployer). ~2e-6 ETH per tx at 0.01 gwei.
      const hash = await keeper.sendTransaction({ to: w.account.address, value: parseEther(process.env.GAS_TOPUP ?? "0.0005") } as any);
      await pub.waitForTransactionReceipt({ hash });
      console.log(`gas top-up ${w.account.address}: ${hash}`);
    }
  }

  // 1-2. Price + keeper reference + pool, market OPEN (also makes the price fresh for borrow).
  await setPrice(START_PRICE);
  await ensurePrice(keeper);
  const tPrice = Date.now();

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
  // 3. Positions, each against the price read back from the vault.
  await ensurePrice(keeper);
  const c = await reconcile(control, CONTROL_DEBT);

  await ensurePrice(keeper);
  const a = await reconcile(alice, ALICE_DEBT);
  // Fresh mandate: an earlier renewal or revoke must not carry over, so the demo starts unrenewed.
  const [aAgent, , aRenewed, aRevoked] = (await read(dep.vault, vaultAbi, "mandates", [alice.account.address])) as [Address, bigint, bigint, boolean];
  if (aAgent !== "0x0000000000000000000000000000000000000000" && (aRenewed !== 0n || aRevoked || aAgent.toLowerCase() !== agent.account.address.toLowerCase()))
    await send(alice, dep.vault, vaultAbi, "fire", []);
  await send(alice, dep.vault, vaultAbi, "setMandate", [agent.account.address, AUTHORITY]);

  const timings = { priceAndPoolS: Math.round((tPrice - t0) / 1000), totalS: Math.round((Date.now() - t0) / 1000) };
  return { alice: a, control: c, agent: agent.account.address, liquidator: liq.account.address, authorityBase: fmt(AUTHORITY), price: START_PRICE, timings };
}

if (isMain(import.meta.url)) {
  setup()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      console.log(`\nWATCH=${r.alice.owner},${r.control.owner}`);
    })
    .catch((e) => { console.error(e.shortMessage ?? e, "| details:", e.details ?? "-"); process.exit(1); });
}

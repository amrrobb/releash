import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type Address } from "viem";
import { AGENT_DIR, CHAIN_ID, LOCAL, dep, feedAbi, poolAbi, pub, send, stockAbi, usdgAbi, latestTs, type Wallet } from "./chain.js";

export const MARKET_FILE = process.env.MARKET_FILE ?? `${AGENT_DIR}${LOCAL ? "market.json" : `market.${CHAIN_ID}.json`}`;

/** anchor: the price the keeper's walk reverts to (set by `price`/reset and by a demo gap). */
export type Market = { open: boolean; label: "OPEN" | "WEEKEND"; fridayCloseAt?: number; mondayOpenAt?: number; price: number; anchor?: number; keeperPausedUntil?: number };

/** Bounded, mean-reverting walk: pull 20% of the way back to the anchor, add up to +-0.5% noise,
 * clamp to anchor +-5%. Unattended for days the price stays where the demo left it, so the agent
 * never trims Alice to dust and the control is never liquidated without a button press. */
export const WALK = { pull: 0.2, noise: 0.005, band: 0.05 };
export function nextPrice(cur: number, anchor: number, rand = Math.random()) {
  const target = cur + WALK.pull * (anchor - cur);
  const p = target * (1 + (rand - 0.5) * 2 * WALK.noise);
  const lo = anchor * (1 - WALK.band), hi = anchor * (1 + WALK.band);
  return Math.round(Math.min(hi, Math.max(lo, p)) * 100) / 100;
}

export function readMarket(): Market {
  try {
    if (existsSync(MARKET_FILE)) return JSON.parse(readFileSync(MARKET_FILE, "utf8"));
  } catch (e) {
    console.warn(`market.json unreadable (${(e as Error).message}); treating market as OPEN`);
  }
  return { open: true, label: "OPEN", price: 0 };
}

/** Atomic write: a torn market.json would flip the agent's weekend logic. */
export function writeMarket(m: Market) {
  writeFileSync(`${MARKET_FILE}.tmp`, JSON.stringify(m, null, 2));
  renameSync(`${MARKET_FILE}.tmp`, MARKET_FILE);
}

/** The keeper tick and a demo reset both write the price with the same key: the reset pauses the tick
 * (wall-clock ms; expires on its own if a reset dies half way). */
export function keeperPaused(m = readMarket()) {
  return (m.keeperPausedUntil ?? 0) > Date.now();
}
export function pauseKeeper(ms: number) {
  writeMarket({ ...readMarket(), keeperPausedUntil: Date.now() + ms });
}
export function resumeKeeper() {
  const { keeperPausedUntil: _, ...m } = readMarket();
  writeMarket(m as Market);
}

/** Oracle price in USD (8 dec on chain). */
export async function oraclePrice() {
  const [, answer, , updatedAt] = (await pub.readContract({ address: dep.feed, abi: feedAbi, functionName: "latestRoundData" })) as bigint[];
  return { price8: answer, updatedAt };
}

export async function setOracle(keeper: Wallet, priceUsd: number) {
  const price8 = BigInt(Math.round(priceUsd * 1e8));
  return send(keeper, dep.feed, feedAbi, "setPrice", [price8]);
}

/** Pool price in USD per rNVDA. */
export async function poolPrice() {
  const { rStock, rUsd } = await poolReserves();
  return (Number(rUsd) / 1e6) / (Number(rStock) / 1e18);
}

async function poolReserves() {
  const token0 = ((await pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "token0" })) as Address).toLowerCase();
  const [r0, r1] = (await pub.readContract({ address: dep.pool, abi: poolAbi, functionName: "reserves" })) as bigint[];
  const stockIs0 = token0 === dep.rnvda.toLowerCase();
  return { rStock: stockIs0 ? r0 : r1, rUsd: stockIs0 ? r1 : r0 };
}

const STOCK_CAP = 1000n * 10n ** 18n;
const USD_CAP = 100_000n * 10n ** 6n;

function sqrt(n: bigint) {
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  for (let i = 0; i < 6; i++) x = (x + n / x) >> 1n;
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

/** Moves the pool's spot price to `priceUsd` by SWAPPING the keeper's own inventory into it (constant
 * product, so the pool does not grow). The old mint-into-pool + sync grew the reserves every gap/reset
 * cycle (~1000x after a day of demos), and each reset needed hundreds of capped mints. Swaps return the
 * other token to the keeper, so the next move back is paid from inventory; only a shortfall is minted. */
export async function rebalancePool(keeper: Wallet, priceUsd: number) {
  const { rStock, rUsd } = await poolReserves();
  const p6 = BigInt(Math.round(priceUsd * 1e6)); // USDG (6 dec) per 1e18 rNVDA
  const k = rStock * rUsd;
  let token: Address, abi: any, amountIn: bigint, cap: bigint;
  if (rUsd * 10n ** 18n > rStock * p6) {
    // too expensive: sell rNVDA into the pool
    const target = sqrt((k * 10n ** 18n) / p6);
    amountIn = ((target - rStock) * 10_000n) / 9_970n;
    token = dep.rnvda; abi = stockAbi; cap = STOCK_CAP;
  } else {
    const target = sqrt((k * p6) / 10n ** 18n);
    amountIn = ((target - rUsd) * 10_000n) / 9_970n;
    token = dep.usdg; abi = usdgAbi; cap = USD_CAP;
  }
  // Within 0.1%: nothing to do.
  if (amountIn <= 0n || (token === dep.rnvda ? amountIn * 1000n < rStock : amountIn * 1000n < rUsd)) return poolPrice();
  const me = keeper.account.address;
  const bal = (await pub.readContract({ address: token, abi, functionName: "balanceOf", args: [me] })) as bigint;
  for (let left = amountIn > bal ? amountIn - bal : 0n; left > 0n; ) {
    const amt = left > cap ? cap : left;
    await send(keeper, token, abi, "mint", [me, amt]);
    left -= amt;
  }
  const allowance = (await pub.readContract({ address: token, abi, functionName: "allowance", args: [me, dep.pool] })) as bigint;
  if (allowance < amountIn) await send(keeper, token, abi, "approve", [dep.pool, 2n ** 256n - 1n]);
  await send(keeper, dep.pool, poolAbi, "swapExactIn", [token, amountIn, 0n, me]);
  return poolPrice();
}

/** Mints enough rNVDA to the keeper that a gap of `pct` can be paid from inventory (run once, idle). */
export async function stockInventoryFor(keeper: Wallet, pct: number) {
  const { rStock } = await poolReserves();
  const need = (rStock * BigInt(Math.round((Math.sqrt(1 / (1 + pct / 100)) - 1) * 1e6))) / 1_000_000n + rStock / 100n;
  const me = keeper.account.address;
  const bal = (await pub.readContract({ address: dep.rnvda, abi: stockAbi, functionName: "balanceOf", args: [me] })) as bigint;
  let minted = 0;
  for (let left = need > bal ? need - bal : 0n; left > 0n; minted++) {
    const amt = left > STOCK_CAP ? STOCK_CAP : left;
    await send(keeper, dep.rnvda, stockAbi, "mint", [me, amt]);
    left -= amt;
  }
  return { need: Number(need) / 1e18, had: Number(bal) / 1e18, mintTxs: minted };
}

export async function chainNow() {
  return Number(await latestTs());
}

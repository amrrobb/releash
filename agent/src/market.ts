import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { type Address } from "viem";
import { AGENT_DIR, dep, feedAbi, poolAbi, pub, send, stockAbi, usdgAbi, latestTs, type Wallet } from "./chain.js";

export const MARKET_FILE = process.env.MARKET_FILE ?? `${AGENT_DIR}market.json`;

export type Market = { open: boolean; label: "OPEN" | "WEEKEND"; fridayCloseAt?: number; mondayOpenAt?: number; price: number };

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

/** Moves the pool's spot price to `priceUsd` by minting one side straight into the pool and syncing
 * (the mocks' mint is an open demo faucet). Mints are capped per call, so loop. */
export async function rebalancePool(keeper: Wallet, priceUsd: number) {
  const { rStock, rUsd } = await poolReserves();
  const p6 = BigInt(Math.round(priceUsd * 1e6)); // USDG (6 dec) per 1e18 rNVDA
  const target = (rStock * p6) / 10n ** 18n; // USDG reserve that would put the pool at the price
  let token: Address, abi, need: bigint, cap: bigint;
  if (rUsd > target) {
    // pool too expensive: add rNVDA until rUsd / rStock = price
    need = (rUsd * 10n ** 18n) / p6 - rStock;
    token = dep.rnvda; abi = stockAbi; cap = STOCK_CAP;
  } else {
    need = target - rUsd;
    token = dep.usdg; abi = usdgAbi; cap = USD_CAP;
  }
  if (need > 0n) {
    let left = need;
    while (left > 0n) {
      const amt = left > cap ? cap : left;
      await send(keeper, token, abi, "mint", [dep.pool, amt]);
      left -= amt;
    }
    await send(keeper, dep.pool, poolAbi, "sync", []);
  }
  return poolPrice();
}

export async function chainNow() {
  return Number(await latestTs());
}

/** Demo keeper: oracle price + fake market clock + pool kept at the oracle.
 *   tsx keeper.ts price 180   set price (and pool), market OPEN
 *   tsx keeper.ts close       Friday close: price frozen, market WEEKEND
 *   tsx keeper.ts gap -35     Monday open: price -35%, pool moved, market OPEN
 *   tsx keeper.ts tick        while OPEN, bounded mean-reverting walk around the anchor every 120 s (TICK_MS)
 *   tsx keeper.ts inventory -35  pre-mint rNVDA so a gap is a single swap (idle, once)
 *   tsx keeper.ts status
 */
import { key, wallet, fmt } from "./src/chain.js";
import { isMain } from "./src/main.js";
import { chainNow, stockInventoryFor, keeperPaused, nextPrice, oraclePrice, poolPrice, readMarket, rebalancePool, setOracle, writeMarket } from "./src/market.js";

const keeper = wallet(key("KEEPER_PK"));

export async function setPrice(priceUsd: number) {
  // Reference first: a tick that starts now walks around the new price, never the old one.
  const pause = readMarket().keeperPausedUntil;
  writeMarket({ open: true, label: "OPEN", price: priceUsd, anchor: priceUsd, keeperPausedUntil: pause });
  await setOracle(keeper, priceUsd);
  const pool = await rebalancePool(keeper, priceUsd);
  return { price: priceUsd, pool };
}

export async function close() {
  const { price8 } = await oraclePrice();
  const price = Number(price8) / 1e8;
  writeMarket({ open: false, label: "WEEKEND", fridayCloseAt: await chainNow(), price, anchor: readMarket().anchor });
  return { price };
}

export async function gap(pct: number) {
  const { price8 } = await oraclePrice();
  const before = Number(price8) / 1e8;
  const after = Math.round(before * (1 + pct / 100) * 100) / 100;
  await setOracle(keeper, after);
  const pool = await rebalancePool(keeper, after);
  // Agent deleverage reverts SlippageExceeded when the pool sits ~13% under the oracle.
  if (Math.abs(pool - after) / after > 0.1) console.error(`WARNING: pool ${pool.toFixed(2)} is more than 10% from the oracle ${after}; agent deleverage may revert SlippageExceeded`);
  const m = readMarket();
  writeMarket({ open: true, label: "OPEN", fridayCloseAt: m.fridayCloseAt, mondayOpenAt: await chainNow(), price: after, anchor: after });
  return { before, after, pool };
}

/** Cosmetic random walk while OPEN. Gas matters on a public chain: one setPrice per TICK_MS (120 s),
 * skipped when the move is under TICK_MIN_MOVE (0.2%); the pool is only re-synced when it has drifted
 * more than POOL_DRIFT (2%) from the oracle (agent deleverage tolerates 15%). */
async function tick() {
  const ms = Number(process.env.TICK_MS ?? 120_000);
  const minMove = Number(process.env.TICK_MIN_MOVE ?? 0.002);
  const drift = Number(process.env.POOL_DRIFT ?? 0.02);
  console.log(`keeper tick every ${ms} ms, min move ${minMove * 100}%, pool resync above ${drift * 100}% drift`);
  for (;;) {
    const m = readMarket();
    if (keeperPaused(m)) console.log(`${new Date().toISOString()} tick paused (demo reset in progress)`);
    else if (m.open) {
      try {
        const { price8 } = await oraclePrice();
        const cur = Number(price8) / 1e8;
        const anchor = m.anchor ?? Number(process.env.KEEPER_ANCHOR ?? 180);
        const p = nextPrice(cur, anchor);
        if (Math.abs(p - cur) / cur < minMove) console.log(`${new Date().toISOString()} tick skipped (${cur} -> ${p} is under ${minMove * 100}%)`);
        else if (keeperPaused() || readMarket().anchor !== m.anchor) console.log(`${new Date().toISOString()} tick dropped (reset started)`);
        else {
          await setOracle(keeper, p);
          const pool = await poolPrice();
          if (Math.abs(pool - p) / p > drift && !keeperPaused()) await rebalancePool(keeper, p);
          // close() may have landed while those txs mined: only update the price, never reopen.
          const now = readMarket();
          if (now.open && !keeperPaused(now)) writeMarket({ ...now, price: p });
          console.log(`${new Date().toISOString()} tick ${p} (pool ${pool.toFixed(2)})`);
        }
      } catch (e) {
        console.error("tick failed:", (e as any).shortMessage ?? e, (e as any).details ?? "");
      }
    } else console.log(`${new Date().toISOString()} WEEKEND: price frozen at ${m.price}`);
    await new Promise((r) => setTimeout(r, ms));
  }
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "price") console.log(await setPrice(Number(arg)));
  else if (cmd === "close") console.log("Friday close", await close());
  else if (cmd === "gap") console.log("Monday gap", await gap(Number(arg)));
  else if (cmd === "tick") await tick();
  else if (cmd === "inventory") console.log(await stockInventoryFor(keeper, Number(arg ?? -35)));
  else if (cmd === "status") {
    const { price8, updatedAt } = await oraclePrice();
    console.log({ market: readMarket(), oracle: fmt(price8, 8), updatedAt: Number(updatedAt), pool: await poolPrice() });
  } else {
    console.log("usage: keeper.ts price <usd> | close | gap <pct> | tick | status");
    process.exit(1);
  }
}

if (isMain(import.meta.url)) main().catch((e) => { console.error(e.shortMessage ?? e, e.details ?? ""); process.exit(1); });

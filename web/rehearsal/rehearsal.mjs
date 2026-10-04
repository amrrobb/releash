// G5 rehearsal on the hosted site (Releash demo, Robinhood Chain testnet 46630).
//
// Real pointer clicks; before each click the button must be enabled AND be the element at the click point;
// after each click the EFFECT is asserted in the UI and on-chain (cast call against the public RPC).
// A caption overlay names each beat so the recording doubles as a fallback demo video.
//
// Run:   cd web && VID_DIR=/tmp/releash-vid node rehearsal/rehearsal.mjs
//        BEATS=6,7,9 runs only those beats (e.g. close, gap, reset); SITE=<url> overrides the page.
// Needs: Foundry `cast` on PATH, Playwright chromium (pnpm exec playwright install chromium), ffmpeg optional.
// DNS:   if this machine cannot resolve releash-api.robbyn.xyz (stale negative cache), launch chromium with
//        args ["--host-resolver-rules=MAP releash-api.robbyn.xyz 77.237.243.126"] (HOST_MAP=1 below does this).
//        `cast` uses the public RPC and is unaffected.
// Side effects: drives the shared demo (reset, renew, close, gap, revoke). Ends with Reset demo.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const OUT = `${ROOT}/web/rehearsal`;
const VID = process.env.VID_DIR ?? `${OUT}/video`;
const ONLY = process.env.BEATS ? new Set(process.env.BEATS.split(",").map(Number)) : null;
mkdirSync(OUT, { recursive: true });
const dep = JSON.parse(readFileSync(`${ROOT}/deployments/46630.json`, "utf8"));
const RPC = "https://rpc.testnet.chain.robinhood.com";
const ALICE = "0x454a7cBDc89474dfD4bC7d0A8536eDF1378ED991";
const SITE_URL = process.env.SITE ?? "https://releash.robbyn.xyz/?demo=1";

const cast = (sig, args = "") => execSync(`cast call ${dep.vault} "${sig}" ${args} --rpc-url ${RPC}`, { encoding: "utf8" }).trim().split("\n").map((l) => l.split(" ")[0]);
const pos = (a) => { const [c, d] = cast("positions(address)(uint128,uint128)", a); return { col: Number(c) / 1e18, debt: Number(d) / 1e6 }; };
const mandate = (a) => { const [agent, base, last, revoked] = cast("mandates(address)(address,uint128,uint64,bool)", a); return { agent, base: Number(base) / 1e6, last: Number(last), revoked: revoked === "true" }; };
const auth = (a) => Number(cast("authorityNow(address)(uint256)", a)[0]) / 1e6;
const price = () => Number(cast("price()(uint256,uint256)")[0]) / 1e8;
const health = (a) => { const [v, d, ltv, liq] = cast("healthOf(address)(uint256,uint256,uint256,bool)", a); return { ltv: Number(ltv) / 100, liq: liq === "true" }; };

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1);
const results = [];
let beatNo = 0;

const browser = await chromium.launch(process.env.HOST_MAP ? { args: ["--host-resolver-rules=MAP releash-api.robbyn.xyz 77.237.243.126"] } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: VID, size: { width: 1280, height: 800 } } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));

async function caption(text) {
  await page.evaluate((t) => {
    let d = document.getElementById("__cap");
    if (!d) {
      d = document.createElement("div");
      d.id = "__cap";
      d.style.cssText = "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:9999;background:rgba(0,0,0,.82);color:#fff;font:600 17px/1.3 'Hanken Grotesk',sans-serif;padding:10px 18px;border-radius:999px;border:1px solid #2d3431;pointer-events:none;max-width:90vw;text-align:center";
      document.body.append(d);
    }
    d.textContent = t;
  }, text);
}

async function click(testid) {
  const b = page.getByTestId(testid);
  // Centre it: scrollIntoViewIfNeeded can park a button under the sticky header.
  await b.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
  const deadline = Date.now() + 30_000;
  while (!(await b.isEnabled())) {
    if (Date.now() > deadline) throw new Error(`${testid} stayed disabled`);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(400); // let any scroll settle before measuring
  const box = await b.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  // The point must hit the button itself, not the sticky header or an overlay.
  const hits = await page.evaluate(([x, y, id]) => !!document.elementFromPoint(x, y)?.closest(`[data-testid="${id}"]`), [x, y, testid]);
  if (!hits) throw new Error(`${testid}: something else is on top of it at (${x | 0}, ${y | 0})`);
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
}

const feedTexts = () => page.locator(".feed__item").allInnerTexts();
async function waitFeed(re, before, timeout) {
  const seen = new Set(before);
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = (await feedTexts()).find((t) => re.test(t) && !seen.has(t));
    if (hit) return hit.replace(/\s+/g, " ");
    await page.waitForTimeout(1000);
  }
  return null;
}
// The strip shows "<action>…" while pending, then the result. Wait for the pending state first, so a
// previous beat's result is never mistaken for this one's.
async function waitDemoResult(timeout) {
  const sel = '[data-testid="demo-result"]';
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute("data-pending") === "1", sel, { timeout: 10_000 });
  await page.waitForFunction((s) => {
    const e = document.querySelector(s);
    return !!e && e.getAttribute("data-pending") !== "1" && (e.textContent ?? "").length > 0;
  }, sel, { timeout });
  return (await page.getByTestId("demo-result").innerText()).trim();
}
async function until(fn, timeout, every = 2000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await page.waitForTimeout(every);
  }
}

async function beat(name, fn) {
  beatNo++;
  if (ONLY && !ONLY.has(beatNo)) return true;
  const start = Date.now();
  await caption(`${beatNo}. ${name}`);
  let ok = false, note = "";
  try {
    note = (await fn()) ?? "";
    ok = true;
  } catch (e) {
    note = `FAIL: ${e.message.split("\n")[0]}`;
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${String(beatNo).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}.png` });
  results.push({ n: beatNo, name, ok, secs, note });
  console.log(`[${el()}s] beat ${beatNo} ${name}: ${ok ? "PASS" : "FAIL"} (${secs}s) ${note}`);
  writeFileSync(`${OUT}/.results.json`, JSON.stringify(results, null, 2));
  return ok;
}

await page.goto(SITE_URL, { waitUntil: "load" }); await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {}); // /demo polls getLogs continuously
await page.getByTestId("address").waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);

// The control owner: from the page (explorer link on the control card); Reset demo refreshes it.
let control = await page.getByTestId("side-control").locator("a").first().getAttribute("href").then((h) => h?.split("/address/")[1]).catch(() => undefined);
await beat("Reset demo", async () => {
  await click("demo-reset");
  const r = await waitDemoResult(300_000);
  if (!/Demo reset/.test(r)) throw new Error(r);
  control = await page.evaluate(() => JSON.parse(localStorage.getItem("releash.demoActors") ?? "{}").control);
  const a = pos(ALICE), c = control ? pos(control) : null, m = mandate(ALICE);
  await page.waitForTimeout(3000);
  return `UI "${r}". chain: Alice ${a.col} rNVDA / ${a.debt} USDG, base ${m.base}, lastRenewed ${m.last}; control ${control} debt ${c?.debt}; price ${price()}`;
});

await beat("Renew with World ID (simulated)", async () => {
  await click("simulate");
  await page.locator(".renew .txstatus--ok").waitFor({ timeout: 120_000 }).catch(async () => {
    throw new Error(await page.locator(".renew .txstatus, .renew [role=alert]").first().innerText().catch(() => "no confirmation"));
  });
  await page.waitForTimeout(2500);
  const ui = await page.getByTestId("authority-value").innerText();
  const m = mandate(ALICE);
  if (ui === "$0.00") throw new Error("meter still empty");
  return `UI meter ${ui}; chain lastRenewed ${m.last}, authorityNow ${auth(ALICE)}`;
});

await beat("Agent levers up", async () => {
  const before = await feedTexts();
  const hit = await waitFeed(/Agent borrowed/, before, 120_000);
  const a = pos(ALICE);
  if (!hit) throw new Error(`no lever-up in the feed within 120 s (chain debt ${a.debt})`);
  return `feed "${hit.slice(0, 120)}"; chain debt ${a.debt}`;
});

await beat("Agent tries $1,500", async () => {
  const before = await feedTexts();
  const debt0 = pos(ALICE).debt;
  await click("demo-attempt");
  const r = await waitDemoResult(120_000);
  if (!/Blocked on-chain: AuthorityExceeded/.test(r)) throw new Error(`strip says "${r}"`);
  const hit = await waitFeed(/Blocked on-chain[\s\S]*AuthorityExceeded/, before, 30_000);
  const debt1 = pos(ALICE).debt;
  return `strip "${r}"; feed ${hit ? "shows red line" : "MISSING red line"}; chain debt ${debt0} -> ${debt1}`;
});

await beat("Authority decays", async () => {
  const ui0 = await page.getByTestId("authority-value").innerText();
  const c0 = auth(ALICE);
  await page.getByTestId("authority-meter").scrollIntoViewIfNeeded();
  await page.waitForTimeout(60_000);
  const ui1 = await page.getByTestId("authority-value").innerText();
  const c1 = auth(ALICE);
  if (ui0 === ui1) throw new Error("meter did not move");
  return `UI ${ui0} -> ${ui1}; chain authorityNow ${c0} -> ${c1}`;
});

await beat("Friday close", async () => {
  const before = await feedTexts();
  const d0 = pos(ALICE).debt;
  await page.getByTestId("demo-close").scrollIntoViewIfNeeded();
  await click("demo-close");
  const r = await waitDemoResult(120_000);
  if (!/Market closed/.test(r)) throw new Error(r);
  await page.waitForTimeout(3000);
  const badge = await page.getByTestId("market").innerText().catch(() => "?");
  const pill = await page.getByTestId("side-control").locator(".pill").innerText();
  if (pill === "LIQUIDATED") throw new Error("control shows LIQUIDATED before the gap");
  const deltaPre = (await page.getByTestId("equity-delta").innerText()).replace(/\s+/g, " ");
  if (/\$/.test(deltaPre)) throw new Error(`delta shows a number before the gap: "${deltaPre}"`);
  const hit = await waitFeed(/deleveraged 30%/, before, 120_000);
  const d1 = pos(ALICE).debt;
  if (!hit) throw new Error(`badge "${badge.replace(/\n/g, " ")}"; no 30% deleverage within 120 s (debt ${d0} -> ${d1})`);
  return `badge "${badge.replace(/\n/g, " ")}"; control pill before gap ${pill}; delta "${deltaPre}"; feed "${hit.slice(0, 140)}"; chain debt ${d0} -> ${d1}`;
});

await beat("Monday gap -35%", async () => {
  await click("demo-gap");
  const r = await waitDemoResult(120_000);
  if (!/gapped|dropped/.test(r)) throw new Error(r);
  const st = await until(async () => {
    const c = await page.getByTestId("side-control").locator(".pill").innerText();
    return c === "LIQUIDATED" ? c : null;
  }, 150_000);
  const a = await page.getByTestId("side-releash").locator(".pill").innerText();
  const hc = control ? health(control) : null, ha = health(ALICE);
  if (!st) throw new Error(`control pill never LIQUIDATED (chain control ltv ${hc?.ltv}% liq ${hc?.liq})`);
  if (a !== "SAFE") throw new Error(`Alice pill ${a}`);
  const deltaPost = (await page.getByTestId("equity-delta").innerText()).replace(/\s+/g, " ");
  if (!/Releash kept \$/.test(deltaPost)) throw new Error(`delta after the gap: "${deltaPost}"`);
  return `delta "${deltaPost}"; price ${price()}; strip control ${st}, Alice ${a}; chain control ${control ? JSON.stringify(pos(control)) : "?"} ltv ${hc?.ltv}%, Alice ltv ${ha.ltv}% liq ${ha.liq}`;
});

await beat("Revoke", async () => {
  const before = await feedTexts();
  await click("revoke");
  await page.locator(".mandate .txstatus--ok").waitFor({ timeout: 120_000 });
  const m = mandate(ALICE);
  if (!m.revoked) throw new Error("chain says not revoked");
  const ui = await page.getByTestId("can-add").innerText();
  // Bring the meter and the feed back into view so the recording shows what happens next.
  await page.getByTestId("authority-meter").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo({ top: 260, behavior: "instant" }));
  const d0 = pos(ALICE).debt;
  const hit = await waitFeed(/[Dd]eleveraged/, before, 60_000);
  const d1 = pos(ALICE).debt;
  return `chain revoked=${m.revoked}; can-add ${ui}; after revoke: ${hit ? `feed "${hit.slice(0, 140)}"` : "agent did NOT deleverage within 60 s"}; debt ${d0} -> ${d1}; Alice ltv ${health(ALICE).ltv}%`;
});

await beat("Reset demo (end)", async () => {
  await click("demo-reset");
  const r = await waitDemoResult(300_000);
  if (!/Demo reset/.test(r)) throw new Error(r);
  const a = pos(ALICE);
  return `UI "${r}"; chain Alice debt ${a.debt}, price ${price()}`;
});

await caption("End of rehearsal");
await page.waitForTimeout(1500);
const video = page.video();
await ctx.close();
await video.saveAs(`${VID}/rehearsal.webm`);
await browser.close();
console.log(JSON.stringify(results, null, 2));

// One live take of the hosted Releash demo, recorded for the video.
//
// Derived from web/rehearsal/rehearsal.mjs (same click and verification helpers), with three changes:
//   1. The recorded frame IS the viewport: 1920x1080 at deviceScaleFactor 1, recordVideo at the same size.
//      (1280x720 at dsf 1.5 was probed and records a 1280x720 picture in the corner of a grey 1920 canvas.)
//   2. No caption overlay in the page. Captions live in the Remotion composition.
//   3. Marks. A beat writes its mark ONLY after its effect was verified in the UI AND on-chain (cast call).
//      A failed beat writes no mark, and the slicer refuses to cut a beat that has none.
//
// Sync: a full-screen magenta flash is painted at the start and at the end, at recorded wall-clock times. The
// slicer finds both flashes in the video and maps wall time to video time linearly, so neither the recorder's
// start delay nor any drift is guessed.
//
// Run:   cd video && node scripts/take.mjs            (TAKE=2 for a second take; never overwrites another take)
//        HOST_MAP=1 if this machine cannot resolve releash-api.robbyn.xyz
// Output: captures/take-N.webm (master, gitignored) and marks/take-N.json (committed)
// Side effects: drives the SHARED demo account (reset, renew, close, gap, revoke). Ends with Reset demo.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync } from "node:fs";

const VIDEO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const TAKE = process.env.TAKE ?? "1";
const CAP = `${VIDEO}/captures`;
const MARKS = `${VIDEO}/marks`;
mkdirSync(CAP, { recursive: true });
mkdirSync(MARKS, { recursive: true });
const OUT_VIDEO = `${CAP}/take-${TAKE}.webm`;
const OUT_MARKS = `${MARKS}/take-${TAKE}.json`;
if (existsSync(OUT_MARKS) && !process.env.FORCE) throw new Error(`${OUT_MARKS} exists; use another TAKE=`);

const dep = JSON.parse(readFileSync(`${ROOT}/deployments/46630.json`, "utf8"));
const RPC = "https://rpc.testnet.chain.robinhood.com";
const ALICE = "0x454a7cBDc89474dfD4bC7d0A8536eDF1378ED991";
const SITE_URL = process.env.SITE ?? "https://releash.robbyn.xyz/?demo=1";
const W = 1920, H = 1080;

const cast = (sig, args = "") => execSync(`cast call ${dep.vault} "${sig}" ${args} --rpc-url ${RPC}`, { encoding: "utf8" }).trim().split("\n").map((l) => l.split(" ")[0]);
const pos = (a) => { const [c, d] = cast("positions(address)(uint128,uint128)", a); return { col: Number(c) / 1e18, debt: Number(d) / 1e6 }; };
const mandate = (a) => { const [agent, base, last, revoked] = cast("mandates(address)(address,uint128,uint64,bool)", a); return { agent, base: Number(base) / 1e6, last: Number(last), revoked: revoked === "true" }; };
const auth = (a) => Number(cast("authorityNow(address)(uint256)", a)[0]) / 1e6;
const price = () => Number(cast("price()(uint256,uint256)")[0]) / 1e8;
const health = (a) => { const [, , ltv, liq] = cast("healthOf(address)(uint256,uint256,uint256,bool)", a); return { ltv: Number(ltv) / 100, liq: liq === "true" }; };

const take = { take: TAKE, site: SITE_URL, viewport: { width: W, height: H }, startedAt: new Date().toISOString(), flashes: [], beats: {}, failed: [], log: [] };
const save = () => writeFileSync(OUT_MARKS, JSON.stringify(take, null, 2) + "\n");
const now = () => Date.now();
const log = (s) => { const line = `[${new Date().toISOString().slice(11, 19)}] ${s}`; console.log(line); take.log.push(line); };

const browser = await chromium.launch(process.env.HOST_MAP ? { args: ["--host-resolver-rules=MAP releash-api.robbyn.xyz 77.237.243.126"] } : {});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: `${CAP}/tmp-${TAKE}`, size: { width: W, height: H } } });
const page = await ctx.newPage();
page.on("pageerror", (e) => log(`PAGEERROR ${e.message}`));

async function flash(name) {
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.id = "__flash";
    d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#ff00ff";
    document.body.append(d);
  });
  // Two animation frames: the overlay is on screen, not merely in the DOM.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const t = now();
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById("__flash")?.remove());
  take.flashes.push({ name, wall: t });
  save();
}

async function click(testid) {
  const b = page.getByTestId(testid);
  await b.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
  const deadline = now() + 30_000;
  while (!(await b.isEnabled())) {
    if (now() > deadline) throw new Error(`${testid} stayed disabled`);
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(400);
  const box = await b.boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const hits = await page.evaluate(([x, y, id]) => !!document.elementFromPoint(x, y)?.closest(`[data-testid="${id}"]`), [x, y, testid]);
  if (!hits) throw new Error(`${testid}: something else is on top of it at (${x | 0}, ${y | 0})`);
  await page.mouse.move(x, y, { steps: 12 });
  await page.waitForTimeout(250);
  const t = now();
  await page.mouse.down();
  await page.mouse.up();
  return t;
}

const feedTexts = () => page.locator(".feed__item").allInnerTexts();
async function waitFeed(re, before, timeout) {
  const seen = new Set(before);
  const end = now() + timeout;
  while (now() < end) {
    const hit = (await feedTexts()).find((t) => re.test(t) && !seen.has(t));
    if (hit) return hit.replace(/\s+/g, " ");
    await page.waitForTimeout(500);
  }
  return null;
}
async function waitDemoResult(timeout) {
  const sel = '[data-testid="demo-result"]';
  await page.waitForFunction((s) => document.querySelector(s)?.getAttribute("data-pending") === "1", sel, { timeout: 10_000 });
  await page.waitForFunction((s) => {
    const e = document.querySelector(s);
    return !!e && e.getAttribute("data-pending") !== "1" && (e.textContent ?? "").length > 0;
  }, sel, { timeout });
  return (await page.getByTestId("demo-result").innerText()).trim();
}
async function until(fn, timeout, every = 1000) {
  const end = now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (now() > end) return null;
    await page.waitForTimeout(every);
  }
}
const text = async (testid) => (await page.getByTestId(testid).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const pinned = () => text("feed-pinned");
async function rects() {
  return page.evaluate(() => {
    const out = { scrollY: window.scrollY };
    for (const id of ["authority-meter", "authority-value", "feed-pinned", "feed", "side-releash", "side-control", "equity-delta", "demo-result", "market", "simulate", "revoke", "can-add", "demo-close", "demo-gap", "demo-attempt"]) {
      const e = document.querySelector(`[data-testid="${id}"]`);
      if (!e) continue;
      const r = e.getBoundingClientRect();
      out[id] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    for (const [k, sel] of [["authority-panel", "section.authority"], ["feed-panel", "section.feed"], ["strip", "section.demostrip"], ["countdown", ".countdown"]]) {
      const e = document.querySelector(sel);
      if (!e) continue;
      const r = e.getBoundingClientRect();
      out[k] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }
    return out;
  });
}
async function scrollTo(y) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
  await page.waitForTimeout(300);
}

// Each beat: fn returns { t: {click?, effect}, data } after verifying; the mark is written only then.
let ourRenewTs = 0;
async function beat(name, fn, { film = true } = {}) {
  const start = now();
  log(`beat ${name} ...`);
  try {
    const r = await fn();
    const end = now();
    if (film) {
      take.beats[name] = { start, ...r.t, end, rects: r.rects ?? (await rects()), data: r.data };
      save();
    }
    log(`beat ${name}: PASS ${JSON.stringify(r.data).slice(0, 400)}`);
    return true;
  } catch (e) {
    take.failed.push({ name, error: e.message.split("\n")[0], at: now() });
    save();
    log(`beat ${name}: FAIL ${e.message.split("\n")[0]}`);
    return false;
  }
}
// Someone else pressing Reset or Renew on the shared account shows up as a lastRenewed we did not cause.
function assertUntouched(where) {
  const m = mandate(ALICE);
  if (ourRenewTs && m.last !== ourRenewTs) throw new Error(`${where}: lastRenewed ${m.last} is not our renewal ${ourRenewTs} (someone else acted on the demo account)`);
  return m;
}

await page.goto(SITE_URL, { waitUntil: "networkidle" });
await page.getByTestId("address").waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
await flash("start");

let control;
const ok = (await beat("reset", async () => {
  await scrollTo(0);
  const click0 = await click("demo-reset");
  const r = await waitDemoResult(300_000);
  if (!/Demo reset/.test(r)) throw new Error(r);
  control = await page.evaluate(() => JSON.parse(localStorage.getItem("releash.demoActors") ?? "{}").control);
  const a = pos(ALICE), c = pos(control), m = mandate(ALICE);
  if (Math.abs(a.debt - 8000) > 1 || Math.abs(a.col - 100) > 0.01) throw new Error(`Alice not reset: ${JSON.stringify(a)}`);
  if (Math.abs(c.debt - 8800) > 1) throw new Error(`control not reset: ${JSON.stringify(c)}`);
  if (m.revoked || m.last !== 0) throw new Error(`mandate not fresh: ${JSON.stringify(m)}`);
  return { t: { click: click0, effect: now() }, data: { ui: r, alice: a, control: c, controlAddr: control, mandate: m, price: price() } };
}, { film: false }));
if (!ok) throw new Error("reset failed; nothing to film");
take.control = control;
await page.waitForTimeout(3000);

await beat("intro", async () => {
  await scrollTo(0);
  await page.waitForTimeout(1500);
  const t0 = now();
  const delta = await text("equity-delta");
  if (/\$/.test(delta)) throw new Error(`delta shows a number before the gap: ${delta}`);
  const pa = await page.getByTestId("side-releash").locator(".pill").innerText();
  const pc = await page.getByTestId("side-control").locator(".pill").innerText();
  if (pa !== "SAFE" || pc !== "SAFE") throw new Error(`pills ${pa}/${pc}`);
  const meter = await text("authority-value");
  if (meter !== "$0.00") throw new Error(`meter ${meter} before renew`);
  await page.waitForTimeout(7000);
  return { t: { effect: t0 }, data: { delta, pills: [pa, pc], meter, equityAlice: await text("equity-releash"), equityControl: await text("equity-control"), market: await text("market") } };
});

await beat("renew", async () => {
  await scrollTo(0);
  const c = await click("simulate");
  await page.locator(".renew .txstatus--ok").waitFor({ timeout: 120_000 }).catch(async () => {
    throw new Error(await page.locator(".renew .txstatus, .renew [role=alert]").first().innerText().catch(() => "no confirmation"));
  });
  const eff = now();
  await until(async () => (await text("authority-value")) !== "$0.00", 15_000, 300);
  const m = mandate(ALICE);
  if (!m.last) throw new Error("chain lastRenewed is 0");
  ourRenewTs = m.last;
  const a = auth(ALICE);
  if (!(a > 0)) throw new Error(`authorityNow ${a}`);
  await page.waitForTimeout(1500);
  return { t: { click: c, effect: eff }, data: { meter: await text("authority-value"), canAdd: await text("can-add"), chainLastRenewed: m.last, chainAuthority: a, buttonLabel: await text("simulate") } };
});

await beat("lever", async () => {
  const before = await feedTexts();
  const debt0 = pos(ALICE).debt;
  const hit = await waitFeed(/Agent borrowed/, before, 150_000);
  const eff = now();
  if (!hit) throw new Error(`no lever-up within 150 s (chain debt ${pos(ALICE).debt})`);
  await page.waitForTimeout(1200);
  const d = pos(ALICE).debt;
  if (!(d > debt0 + 1)) throw new Error(`chain debt did not rise: ${debt0} -> ${d}`);
  assertUntouched("lever");
  const pin = await pinned();
  const r = await rects();
  await page.waitForTimeout(4000);
  return { t: { effect: eff }, rects: r, data: { feed: hit, pinned: pin, jev: /Jev:/.test(hit), chainDebt: [debt0, d], meter: await text("authority-value") } };
});

await beat("attempt", async () => {
  const before = await feedTexts();
  const d0 = pos(ALICE).debt;
  const c = await click("demo-attempt");
  const r = await waitDemoResult(120_000);
  const eff = now();
  if (!/Blocked on-chain: AuthorityExceeded/.test(r)) throw new Error(`strip says "${r}"`);
  const hit = await waitFeed(/Blocked on-chain[\s\S]*AuthorityExceeded/, before, 30_000);
  const d1 = pos(ALICE).debt;
  if (Math.abs(d1 - d0) > 0.01) throw new Error(`debt moved ${d0} -> ${d1}`);
  assertUntouched("attempt");
  const rr = await rects();
  await page.waitForTimeout(3500);
  return { t: { click: c, effect: eff }, rects: rr, data: { strip: r, feed: hit, pinned: await pinned(), chainDebt: [d0, d1] } };
});

await beat("decay", async () => {
  await scrollTo(0);
  const t0 = now();
  const samples = [];
  const c0 = auth(ALICE);
  // Sample the meter and countdown; stay through at least one halving (half-life 120 s).
  const end = t0 + 75_000;
  while (now() < end) {
    samples.push({ t: now(), meter: await text("authority-value"), countdown: (await page.locator(".countdown").innerText().catch(() => "")).replace(/\s+/g, " ") });
    await page.waitForTimeout(1000);
  }
  const c1 = auth(ALICE);
  if (!(c1 < c0)) throw new Error(`chain authority did not fall ${c0} -> ${c1}`);
  if (samples[0].meter === samples.at(-1).meter) throw new Error("meter did not move");
  assertUntouched("decay");
  return { t: { effect: t0 }, data: { chainAuthority: [c0, c1], samples } };
});

await beat("close", async () => {
  const before = await feedTexts();
  const d0 = pos(ALICE).debt;
  await scrollTo(0);
  const c = await click("demo-close");
  const r = await waitDemoResult(120_000);
  if (!/Market closed/.test(r)) throw new Error(r);
  const closedAt = now();
  await page.waitForTimeout(1500);
  const badge = await text("market");
  const pill = await page.getByTestId("side-control").locator(".pill").innerText();
  if (pill === "LIQUIDATED") throw new Error("control shows LIQUIDATED before the gap");
  const deltaPre = await text("equity-delta");
  if (/\$/.test(deltaPre)) throw new Error(`delta shows a number before the gap: "${deltaPre}"`);
  const hit = await waitFeed(/deleveraged 30%/, before, 120_000);
  const eff = now();
  if (!hit) throw new Error(`no 30% deleverage within 120 s (debt ${d0} -> ${pos(ALICE).debt})`);
  await page.waitForTimeout(1500);
  const d1 = pos(ALICE).debt;
  if (!(d1 < d0 * 0.8)) throw new Error(`chain debt ${d0} -> ${d1}, not a 30% cut`);
  assertUntouched("close");
  const pin = await pinned();
  const pill2 = await page.getByTestId("side-control").locator(".pill").innerText();
  if (pill2 === "LIQUIDATED") throw new Error("control LIQUIDATED before the gap (after 30%)");
  const rr = await rects();
  await page.waitForTimeout(3500);
  return { t: { click: c, closed: closedAt, effect: eff }, rects: rr, data: { strip: r, badge, pillControl: pill2, deltaPre, feed: hit, pinned: pin, mandateReason: /weekend|mandate|market closed/i.test(hit), chainDebt: [d0, d1] } };
});

await beat("gap", async () => {
  await scrollTo(0);
  const c = await click("demo-gap");
  const r = await waitDemoResult(120_000);
  if (!/gapped|dropped/.test(r)) throw new Error(r);
  const gappedAt = now();
  const st = await until(async () => ((await page.getByTestId("side-control").locator(".pill").innerText()) === "LIQUIDATED" ? "LIQUIDATED" : null), 150_000, 500);
  const liqAt = now();
  if (!st) throw new Error("control never LIQUIDATED");
  const delta = await until(async () => { const d = await text("equity-delta"); return /Releash kept \$/.test(d) ? d : null; }, 30_000, 500);
  const eff = now();
  if (!delta) throw new Error(`delta after the gap: ${await text("equity-delta")}`);
  const pa = await page.getByTestId("side-releash").locator(".pill").innerText();
  if (pa !== "SAFE") throw new Error(`Alice pill ${pa}`);
  const p = price(), ha = health(ALICE), hc = health(control);
  if (!(p < 125)) throw new Error(`price ${p}`);
  if (ha.liq) throw new Error("Alice liquidatable on-chain");
  assertUntouched("gap");
  await page.waitForTimeout(800);
  const data = {
    strip: r, delta, pillAlice: pa, pillControl: st, price: p,
    equityAlice: await text("equity-releash"), equityControl: await text("equity-control"),
    lostControl: await text("lost-control"),
    sideAlice: await text("side-releash"), sideControl: await text("side-control"),
    chainAlice: { ...pos(ALICE), ltv: ha.ltv }, chainControl: { ...pos(control), ltv: hc.ltv },
  };
  const rr = await rects();
  await page.waitForTimeout(5000);
  return { t: { click: c, gapped: gappedAt, liquidated: liqAt, effect: eff }, rects: rr, data };
});

await beat("revoke", async () => {
  const before = await feedTexts();
  const c = await click("revoke");
  await page.locator(".mandate .txstatus--ok").waitFor({ timeout: 120_000 });
  const revokedAt = now();
  const m = mandate(ALICE);
  if (!m.revoked) throw new Error("chain says not revoked");
  const canAdd = await text("can-add");
  // Keep the meter, Revoke and the feed in one frame.
  const top = await page.evaluate(() => document.querySelector("section.authority").getBoundingClientRect().top + window.scrollY - 70);
  await scrollTo(top);
  const d0 = pos(ALICE).debt;
  const hit = await waitFeed(/[Dd]eleveraged/, before, 90_000);
  const eff = now();
  if (!hit) throw new Error(`no deleverage within 90 s of revoke (debt ${d0})`);
  await page.waitForTimeout(1500);
  const d1 = pos(ALICE).debt;
  if (!(d1 < d0)) throw new Error(`chain debt ${d0} -> ${d1}`);
  const pin = await pinned();
  const rr = await rects();
  await page.waitForTimeout(3500);
  return { t: { click: c, revoked: revokedAt, effect: eff }, rects: rr, data: { chainRevoked: m.revoked, canAdd, feed: hit, pinned: pin, guardReason: /without asking the model/.test(hit), chainDebt: [d0, d1] } };
});

await beat("revokedAttempt", async () => {
  const before = await feedTexts();
  await scrollTo(0);
  const d0 = pos(ALICE).debt;
  const c = await click("demo-attempt");
  const r = await waitDemoResult(120_000);
  const eff = now();
  if (!/Blocked on-chain/.test(r)) throw new Error(`strip says "${r}"`);
  const hit = await waitFeed(/Blocked on-chain/, before, 30_000);
  const d1 = pos(ALICE).debt;
  if (d1 > d0 + 0.01) throw new Error(`debt rose ${d0} -> ${d1}`);
  const rr = await rects();
  await page.waitForTimeout(4000);
  return { t: { click: c, effect: eff }, rects: rr, data: { strip: r, feed: hit, chainDebt: [d0, d1] } };
});

await flash("end");
take.endedAt = new Date().toISOString();
save();

// Leave the shared demo clean (not filmed).
await beat("resetEnd", async () => {
  await scrollTo(0);
  // Reset can race the keeper and fail ("borrow reverted"); retry, and check the chain, not just the label.
  for (let i = 1; ; i++) {
    const c = await click("demo-reset");
    const r = await waitDemoResult(300_000);
    const a = pos(ALICE);
    if (/Demo reset/.test(r) && Math.abs(a.debt - 8000) < 1) return { t: { click: c }, data: { ui: r, alice: a, price: price(), tries: i } };
    if (i >= 3) throw new Error(`reset did not take after ${i} tries: "${r}", Alice ${JSON.stringify(a)}`);
    log(`reset try ${i}: "${r}"; retrying`);
    await page.waitForTimeout(5000);
  }
}, { film: false });

const video = page.video();
await ctx.close();
await video.saveAs(OUT_VIDEO);
await browser.close();
save();
log(`saved ${OUT_VIDEO} and ${OUT_MARKS}; beats ${Object.keys(take.beats).join(",")}; failed ${take.failed.map((f) => f.name).join(",") || "none"}`);

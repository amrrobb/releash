// Read-only take of /security: hold on the contract rules, then a slow scroll to the deployed-contracts table.
// Same frame == viewport rule and flash sync as take.mjs. Output captures/<NAME>.webm, marks/<NAME>.json.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const VIDEO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const NAME = process.env.NAME ?? "security-1";
mkdirSync(`${VIDEO}/captures`, { recursive: true });
const W = 1920, H = 1080;
const take = { take: NAME, site: "https://releash.robbyn.xyz/security", flashes: [], beats: {} };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: `${VIDEO}/captures/tmp-${NAME}`, size: { width: W, height: H } } });
const page = await ctx.newPage();
async function flash(name) {
  await page.evaluate(() => { const d = document.createElement("div"); d.id = "__flash"; d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#ff00ff"; document.body.append(d); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  take.flashes.push({ name, wall: Date.now() });
  await page.waitForTimeout(700);
  await page.evaluate(() => document.getElementById("__flash")?.remove());
}
await page.goto(take.site, { waitUntil: "networkidle" });
await page.locator("#rules").waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await flash("start");
await page.waitForTimeout(800);
const t0 = Date.now();
const rules = (await page.locator("#rules").innerText()).replace(/\s+/g, " ");
const contracts = (await page.locator("#contracts").innerText()).replace(/\s+/g, " ");
if (!/No admin/i.test(rules)) throw new Error(`rules: ${rules}`);
const verified = (contracts.match(/Verified/g) ?? []).length;
if (verified < 5) throw new Error(`only ${verified} Verified marks: ${contracts}`);
await page.waitForTimeout(3000);
const s0 = Date.now();
const target = await page.evaluate(() => Math.min(document.documentElement.scrollHeight - innerHeight, document.querySelector("#contracts").getBoundingClientRect().top + scrollY - 200));
for (let i = 1; i <= 75; i++) { await page.evaluate((y) => window.scrollTo(0, y), Math.round(target * (0.5 - 0.5 * Math.cos(Math.PI * i / 75)))); await page.waitForTimeout(33); }
await page.waitForTimeout(3500);
take.beats.security = { start: t0, effect: t0, scroll: s0, end: Date.now(), data: { rules, contracts, verified, scrollTarget: target } };
await flash("end");
const v = page.video();
await ctx.close();
await v.saveAs(`${VIDEO}/captures/${NAME}.webm`);
await browser.close();
writeFileSync(`${VIDEO}/marks/${NAME}.json`, JSON.stringify(take, null, 2) + "\n");
console.log(JSON.stringify(take.beats.security.data).slice(0, 600));

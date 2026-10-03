// Read-only take of the landing page (no ?demo=1): the hero, then a slow scroll to the app.
// Same frame == viewport rule and the same flash sync as take.mjs. Output captures/${NAME}.webm, marks/${NAME}.json.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const VIDEO = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
mkdirSync(`${VIDEO}/captures`, { recursive: true });
mkdirSync(`${VIDEO}/marks`, { recursive: true });
const W = 1920, H = 1080;
const NAME = process.env.NAME ?? "hero";
const take = { take: NAME, site: "https://releash.robbyn.xyz/", flashes: [], beats: {} };
const browser = await chromium.launch(process.env.HOST_MAP ? { args: ["--host-resolver-rules=MAP releash-api.robbyn.xyz 77.237.243.126"] } : {});
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
await page.locator("#hero-h").waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await flash("start");
await page.waitForTimeout(800);
const t0 = Date.now();
const h1 = (await page.locator("#hero-h").innerText()).replace(/\s+/g, " ");
if (!/Step away/.test(h1)) throw new Error(`hero says ${h1}`);
// The redesigned landing (/) has no live meter: it is a static story page. The take starts from /demo.
const meter = "n/a";
await page.waitForTimeout(6000);
const s0 = Date.now();
// Smooth scroll to the app grid.
const target = await page.evaluate(() => document.querySelector("#story").getBoundingClientRect().top + window.scrollY - 80);
for (let i = 1; i <= 60; i++) { await page.evaluate((y) => window.scrollTo(0, y), Math.round(target * (0.5 - 0.5 * Math.cos(Math.PI * i / 60)))); await page.waitForTimeout(33); }
await page.waitForTimeout(3000);
take.beats.hero = { start: t0, effect: t0, scroll: s0, end: Date.now(), data: { h1, meter } };
await flash("end");
const v = page.video();
await ctx.close();
await v.saveAs(`${VIDEO}/captures/${NAME}.webm`);
await browser.close();
writeFileSync(`${VIDEO}/marks/${NAME}.json`, JSON.stringify(take, null, 2) + "\n");
console.log(JSON.stringify(take.beats));

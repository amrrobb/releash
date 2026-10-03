// Read-only check of the driver contract (docs/UI-AUDIT.md §3.6) against a running site. Presses nothing.
// Run: cd web && node rehearsal/contract-check.mjs [https://releash.robbyn.xyz]
// Exit code 1 on any failure. Run after every deploy.
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const BASE = (process.argv[2] ?? "https://releash.robbyn.xyz").replace(/\/$/, "");
const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? "ok  " : "FAIL"} ${msg}`); };

const IDS = ["address", "market", "authority-meter", "authority-value", "can-add", "simulate", "revoke", "feed",
  "side-releash", "side-control", "equity-releash", "equity-control", "equity-delta", "demo-close", "demo-gap", "demo-attempt", "demo-reset", "demo-result"];

const browser = await chromium.launch();
const errors = {};
async function open(path, w = 1440, h = 900) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  errors[path] = [];
  page.on("console", (m) => { if (m.type() === "error") errors[path].push(m.text()); });
  page.on("pageerror", (e) => errors[path].push(`PAGEERROR ${e.message}`));
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  return page;
}

// /demo: ids, pills, control address link, sections, no fixed/sticky layers except the header.
const d = await open("/demo", 1920, 1080);
for (const id of IDS) ok((await d.getByTestId(id).count()) > 0, `/demo has [data-testid=${id}]`);
for (const side of ["side-releash", "side-control"]) {
  const pill = await d.getByTestId(side).locator(".pill").first().innerText().catch(() => "");
  ok(/^(SAFE|LIQUIDATED|LIQUIDATABLE)$/.test(pill.trim()), `${side} .pill reads SAFE/LIQUIDATED/LIQUIDATABLE (got "${pill.trim()}")`);
}
const href = await d.getByTestId("side-control").locator("a").first().getAttribute("href").catch(() => null);
ok(!!href && href.includes("/address/"), `side-control first <a> links /address/ (got ${href})`);
for (const sel of ["section.authority", "section.feed", "section.demostrip", ".renew", ".mandate"]) ok((await d.locator(sel).count()) > 0, `/demo has ${sel}`);
const auth = (await d.getByTestId("authority-value").innerText()).trim();
ok(/^\$[\d,]+\.\d\d$/.test(auth), `authority-value is fmtUsd (got "${auth}")`);
const delta = (await d.getByTestId("equity-delta").innerText()).trim();
ok(!/\$/.test(delta) || /Releash kept\s+\$/.test(delta), `equity-delta is the waiting line or "Releash kept $" (got "${delta.replace(/\s+/g, " ")}")`);
ok((await d.getByTestId("demo-result").count()) === 1, "one demo-result");
const fixed = await d.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => {
  const p = getComputedStyle(e).position;
  return (p === "fixed" || p === "sticky") && !e.closest("header.nav");
}).map((e) => e.tagName + "." + e.className).slice(0, 5));
ok(fixed.length === 0, `no fixed/sticky layer besides the header (${fixed.join(", ")})`);
const sh = await d.evaluate(() => document.documentElement.scrollHeight);
ok(sh <= 1080, `/demo fits 1920x1080 without scrolling (scrollHeight ${sh})`);
const small = await d.evaluate(() => [...document.querySelectorAll("button, a.btn, [role=tab]")].filter((e) => {
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.height < 44 && !e.classList.contains("link");
}).map((e) => (e.textContent ?? "").trim().slice(0, 24)));
ok(small.length === 0, `/demo buttons are >= 44px tall (${small.join(" | ")})`);

// 44px targets on every route: the box itself, or an invisible ::after hit area around it.
for (const [path, w] of [["/", 1440], ["/demo", 1440], ["/app", 1440], ["/security", 1440], ["/demo", 375], ["/app", 375]]) {
  const pg = await open(path, w, 900);
  const small = await pg.evaluate(() => [...document.querySelectorAll("a, button, summary")].filter((e) => {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || getComputedStyle(e).visibility === "hidden") return false;
    const a = getComputedStyle(e, "::after");
    const extra = a.content !== "none" && a.position === "absolute" ? -(parseFloat(a.top) || 0) - (parseFloat(a.bottom) || 0) : 0;
    return r.height + Math.max(0, extra) < 44;
  }).map((e) => `${e.tagName.toLowerCase()}:${(e.textContent ?? "").trim().slice(0, 22)}(${Math.round(e.getBoundingClientRect().height)})`));
  ok(small.length === 0, `${path}@${w} targets >= 44px (${small.slice(0, 6).join(" | ")})`);
  await pg.close();
}

// Redirect and deep links.
const r = await open("/?demo=1");
ok(new URL(r.url()).pathname === "/demo", `/?demo=1 lands on /demo (got ${r.url()})`);
for (const p of ["/", "/app", "/security"]) await open(p);
for (const p of ["/demo", "/security", "/app"]) {
  const code = execSync(`curl -s -o /dev/null -w "%{http_code}" ${BASE}${p}`, { encoding: "utf8" }).trim();
  ok(code === "200", `GET ${p} -> 200 (got ${code})`);
}
const html = execSync(`curl -s ${BASE}/security`, { encoding: "utf8" });
ok(/src="\/assets\//.test(html), "index.html uses absolute /assets/ paths");
for (const [p, list] of Object.entries(errors)) ok(list.length === 0, `no console errors on ${p} (${list.slice(0, 2).join(" | ")})`);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : "\nALL OK");
process.exit(fails.length ? 1 : 0);

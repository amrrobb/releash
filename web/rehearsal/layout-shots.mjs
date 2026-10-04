// Read-only layout capture: every page at the review viewports, full page + above the fold. Presses nothing.
// Run: cd web && OUT=screenshots/layout/before node rehearsal/layout-shots.mjs [base]
// Also prints horizontal overflow (scrollWidth > viewport) per shot.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = (process.argv[2] ?? "https://releash.robbyn.xyz").replace(/\/$/, "");
const OUT = process.env.OUT ?? "screenshots/layout/before";
const VPS = (process.env.VPS ?? "1440x900,1280x800,1920x1080,390x844,375x812").split(",").map((v) => v.split("x").map(Number));
const PAGES = (process.env.PAGES ?? "/,/demo,/app,/security").split(",");
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.HOST_MAP ? { args: ["--host-resolver-rules=MAP releash-api.robbyn.xyz 77.237.243.126"] } : {});
for (const [w, h] of VPS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  for (const p of PAGES) {
    await page.goto(BASE + p, { waitUntil: "load" });
    await page.waitForTimeout(3500);
    const name = (p === "/" ? "landing" : p.slice(1)) + `-${w}`;
    await page.screenshot({ path: `${OUT}/${name}-fold.png` });
    await page.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight,
      wide: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 4).map((e) => e.tagName + "." + String(e.className).slice(0, 30)) }));
    console.log(`${name} scrollW=${m.sw} scrollH=${m.sh}${m.sw > w ? " OVERFLOW " + m.wide.join(",") : ""}`);
  }
  await page.close();
}
await browser.close();

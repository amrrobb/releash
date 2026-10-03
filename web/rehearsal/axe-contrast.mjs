// axe-core color-contrast on every route at 1440 and 375. Run: cd web && node rehearsal/axe-contrast.mjs [base]
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const BASE = (process.argv[2] ?? "https://releash.robbyn.xyz").replace(/\/$/, "");
const b = await chromium.launch();
let bad = 0;
for (const path of ["/", "/demo", "/app", "/security"]) for (const w of [1440, 375]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const r = await new AxeBuilder({ page: p }).withRules(["color-contrast"]).analyze();
  const nodes = r.violations.flatMap((v) => v.nodes);
  bad += nodes.length;
  console.log(`${path}@${w}: ${nodes.length} contrast violations`);
  for (const n of nodes.slice(0, 6)) console.log("   ", n.target.join(" "), "|", (n.any[0]?.message ?? "").slice(0, 140));
  await ctx.close();
}
await b.close();
console.log(bad ? `${bad} violations` : "NO CONTRAST VIOLATIONS");
process.exit(bad ? 1 : 0);

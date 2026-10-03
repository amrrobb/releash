// Press Reset demo on the hosted site and wait for the result (used to leave the shared demo clean).
import { chromium } from "playwright";
const b = await chromium.launch(process.env.HOST_MAP ? { args: ["--host-resolver-rules=MAP releash-api.robbyn.xyz 77.237.243.126"] } : {});
const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await p.goto("https://releash.robbyn.xyz/?demo=1", { waitUntil: "networkidle" });
await p.getByTestId("address").waitFor({ timeout: 30000 });
await p.waitForTimeout(2000);
await p.getByTestId("demo-reset").click();
await p.waitForFunction(() => document.querySelector('[data-testid="demo-result"]')?.getAttribute("data-pending") === "1", null, { timeout: 10000 });
await p.waitForFunction(() => { const e = document.querySelector('[data-testid="demo-result"]'); return e && e.getAttribute("data-pending") !== "1" && e.textContent; }, null, { timeout: 300000 });
console.log(await p.getByTestId("demo-result").innerText());
await b.close();

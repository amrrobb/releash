/** A load-balanced RPC node can lack the block another node just reported. /api/market and /api/renew
 * must survive that instead of answering 500. The proxy refuses the first pinned eth_call like such a node. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";

test("/api/market answers 200 when a lagging node refuses the pinned block", async () => {
  const upstream = loadConfig({ ...process.env, WORLD_SIMULATE: "1" }).rpcUrl;
  let refused = 0;
  const proxy = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const msg = JSON.parse(body);
    const pinned = !Array.isArray(msg) && msg.method === "eth_call" && /^0x[0-9a-f]+$/i.test(String(msg.params?.[1] ?? ""));
    if (pinned && refused < 2) {
      refused++;
      return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: `unsupported block number ${parseInt(msg.params[1], 16)}` } }));
    }
    const r = await fetch(upstream, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    res.writeHead(r.status, { "Content-Type": "application/json" }).end(await r.text());
  });
  await new Promise<void>((r) => proxy.listen(0, r));
  const rpc = `http://127.0.0.1:${(proxy.address() as any).port}`;
  const srv = await startServer(loadConfig({ ...process.env, WORLD_SIMULATE: "1", PORT: "0", RPC_URL: rpc, DB_PATH: join(mkdtempSync(join(tmpdir(), "releash-lag-")), "t.db") }));
  try {
    const res = await fetch(`${srv.url}/api/market`);
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(typeof (await res.json()).oraclePrice, "number");
    assert.equal(refused, 2, "the proxy really refused pinned reads");
  } finally {
    await srv.close();
    proxy.close();
  }
});

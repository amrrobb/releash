import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPublicClient, defineChain, getAddress, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, type Config } from "./config.js";
import { openStore } from "./store.js";
import { issueRpContext, verifyHuman } from "./world.js";
import { demoRoutes } from "./demo.js";

const bad = (status: number, message: string) => Object.assign(new Error(message), { status });

export async function startServer(config: Config = loadConfig()) {
  const chain = defineChain({ id: config.chainId, name: `chain-${config.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
  const pub = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const signer = privateKeyToAccount(config.signerPk);
  const vault = config.deployments.vault;
  const read = (functionName: string, args: unknown[] = [], blockNumber?: bigint) => pub.readContract({ address: vault, abi: config.vaultAbi, functionName, args, blockNumber } as any) as Promise<any>;
  /** Reads that must describe ONE block. The public RPC is load-balanced: the node that answers the
   * pinned read may not have the block the previous node reported ("unsupported block number"), which
   * made /api/market 500. Retry with a fresh head, then fall back to the latest block, unpinned. */
  async function atOneBlock<T>(fn: (block: { number: bigint; timestamp: bigint }) => Promise<T>): Promise<T> {
    for (let i = 0; i < 3; i++) {
      try {
        const block = await pub.getBlock({ blockTag: "latest" });
        return await fn({ number: block.number!, timestamp: block.timestamp });
      } catch (e: any) {
        if (!/unsupported block number|header not found|unknown block/i.test(`${e?.details ?? ""} ${e?.shortMessage ?? ""} ${e?.message ?? ""}`)) throw e;
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    const block = await pub.getBlock({ blockTag: "latest" });
    return fn({ number: undefined as any, timestamp: block.timestamp });
  }
  const readJsonFile = async (path: string, fallback: any) => {
    for (let i = 0; i < 2; i++) {
      try {
        return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
      } catch {
        await new Promise((r) => setTimeout(r, 50)); // a writer mid-rename: read again
      }
    }
    return fallback;
  };

  // The vault only accepts signatures from its immutable worldSigner: refuse to start with any other key.
  const onChainSigner = (await read("worldSigner")) as Address;
  if (onChainSigner.toLowerCase() !== signer.address.toLowerCase()) throw new Error(`WORLD_SIGNER_PK is ${signer.address}, but the vault's worldSigner is ${onChainSigner}`);
  const store = openStore(config.dbPath);
  if (config.world.simulate) console.warn("[WORLD_SIMULATE] World ID proofs are NOT verified with the Developer Portal. Local dev only.");

  const routes: Record<string, (body: any, q: URLSearchParams, headers: Record<string, string | string[] | undefined>) => Promise<unknown>> = {
    "GET /api/health": async () => ({ ok: true, chainId: config.chainId, vault, worldSigner: signer.address, worldSimulate: config.world.simulate, action: config.world.action, block: Number(await pub.getBlockNumber()) }),

    "POST /api/rp-context": async (body) => issueRpContext(config.world, store, body?.environment),

    /** Verify a World ID proof for `owner`, then sign a Renewal the owner's wallet submits to vault.renew. */
    "POST /api/renew": async (body) => {
      if (!isAddress(body?.owner ?? "") || !isAddress(body?.agent ?? "")) throw bad(400, "owner and agent must be addresses");
      const owner = getAddress(body.owner);
      const agent = getAddress(body.agent);
      const [mAgent] = (await read("mandates", [owner])) as [Address];
      if (mAgent.toLowerCase() !== agent.toLowerCase()) throw bad(400, mAgent === "0x0000000000000000000000000000000000000000" ? "this account has no agent: setMandate first" : `the mandate names agent ${mAgent}, not ${agent}`);

      const human = await verifyHuman(config.world, store, owner, body?.idkitResult);
      const refused = store.bindHuman(human.nullifier, owner, human.credential, human.simulated);
      if (refused) throw bad(409, refused);

      // Chain time, not wall time: renew() needs issuedAt <= block.timestamp and issuedAt above both
      // lastRenewed and renewalFloor (raised to "now" by revoke / fire / agent change). Right after a
      // revoke that can be one second ahead of the chain: the submitter waits until chain time >= issuedAt.
      const { block, floor, m } = await atOneBlock(async (block) => {
        const [floor, m] = await Promise.all([read("renewalFloor", [owner], block.number), read("mandates", [owner], block.number)]);
        return { block, floor, m };
      });
      let issuedAt = block.timestamp;
      if (BigInt(floor) + 1n > issuedAt) issuedAt = BigInt(floor) + 1n;
      if (BigInt(m[2]) + 1n > issuedAt) issuedAt = BigInt(m[2]) + 1n;
      const renewal = { owner, agent, issuedAt, deadline: issuedAt + BigInt(config.deadlineSeconds) };
      const signature = await signer.signTypedData({
        domain: { name: "Releash", version: "1", chainId: config.chainId, verifyingContract: vault },
        types: { Renewal: [{ name: "owner", type: "address" }, { name: "agent", type: "address" }, { name: "issuedAt", type: "uint64" }, { name: "deadline", type: "uint64" }] },
        primaryType: "Renewal",
        message: renewal,
      });
      console.log(`renewal signed for ${owner} (agent ${agent}) issuedAt ${issuedAt}${human.simulated ? " [SIMULATED human]" : ` [${human.credential}]`}`);
      return { renewal: { owner, agent, issuedAt: issuedAt.toString(), deadline: renewal.deadline.toString() }, signature, simulated: human.simulated, chainTs: block.timestamp.toString(), submitAfter: issuedAt.toString() };
    },

    "GET /api/agent/log": async (_b, q) => {
      const owner = q.get("owner")?.toLowerCase();
      const limit = Math.min(Number(q.get("limit") ?? 50), 500);
      if (!existsSync(config.agentLog)) return { entries: [] };
      const lines = readFileSync(config.agentLog, "utf8").split("\n").filter(Boolean);
      const out: unknown[] = [];
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        try {
          const e = JSON.parse(lines[i]);
          if (!owner || String(e.owner).toLowerCase() === owner) out.push(e);
        } catch {} // a line being appended right now
      }
      return { entries: out };
    },

    "GET /api/market": async () => {
      const market = await readJsonFile(config.marketFile, { open: true, label: "OPEN" });
      return atOneBlock(async (block) => {
        const [price8, updatedAt] = (await read("price", [], block.number)) as bigint[];
        return { ...market, oraclePrice: Number(price8) / 1e8, updatedAt: Number(updatedAt), chainTs: Number(block.timestamp), priceAge: Number(block.timestamp - updatedAt) };
      });
    },
  };

  if (process.env.DEMO_ENABLED === "1") Object.assign(routes, await demoRoutes());

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-demo-key");
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://x");
    const route = routes[`${req.method} ${url.pathname}`];
    const reply = (status: number, body: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    if (!route) return reply(404, { error: "not found" });
    try {
      let body: any = undefined;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const raw = Buffer.concat(chunks).toString();
        if (raw.length > 200_000) throw bad(413, "body too large");
        body = raw ? JSON.parse(raw) : {};
      }
      reply(200, await route(body, url.searchParams, req.headers));
    } catch (err: any) {
      const status = err.status ?? (err instanceof SyntaxError ? 400 : 500);
      if (status >= 500) console.error(err.shortMessage ?? err.message, err.details ?? "");
      reply(status, { error: err.shortMessage ?? err.message, ...(err.portal ? { portal: err.portal } : {}) });
    }
  });
  await new Promise<void>((r) => server.listen(config.port, r));
  const port = (server.address() as any).port as number;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.close(() => r()); store.close(); }),
  };
}

const isMain = (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; } })();
if (isMain) {
  const config = loadConfig();
  startServer(config)
    .then((s) => console.log(`releash backend on ${s.url} (chain ${config.chainId}, vault ${config.deployments.vault})`))
    .catch((e) => { console.error(e.message ?? e); process.exit(1); });
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Abi, type Address, type Hex } from "viem";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Anvil key #1 is the demo world signer; used only on 31337 when WORLD_SIGNER_PK is unset. */
const ANVIL_WORLD_SIGNER = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const chainId = Number(env.CHAIN_ID ?? 31337);
  const local = chainId === 31337;
  const deployments = JSON.parse(readFileSync(`${ROOT}deployments/${chainId}.json`, "utf8")) as { vault: Address; worldSigner: Address; feed: Address; halfLife: number };
  const vaultAbi = JSON.parse(readFileSync(`${ROOT}deployments/abi/ReleashVault.json`, "utf8")) as Abi;
  const rpcUrl = env.RPC_URL ?? (local ? "http://127.0.0.1:8545" : "");
  if (!rpcUrl) throw new Error(`RPC_URL is required for chain ${chainId}`);
  const signerPk = (env.WORLD_SIGNER_PK ?? (local ? ANVIL_WORLD_SIGNER : "")) as Hex;
  if (!signerPk) throw new Error("WORLD_SIGNER_PK is required");
  return {
    chainId,
    rpcUrl,
    port: Number(env.PORT ?? 8787),
    deployments,
    vaultAbi,
    signerPk,
    deadlineSeconds: Number(env.RENEWAL_TTL ?? 600),
    dbPath: env.DB_PATH ?? `${ROOT}backend/releash-${chainId}-${deployments.vault.toLowerCase()}.db`,
    agentLog: env.AGENT_LOG ?? `${ROOT}agent/${local ? "log.jsonl" : `log.${chainId}.jsonl`}`,
    marketFile: env.MARKET_FILE ?? `${ROOT}agent/${local ? "market.json" : `market.${chainId}.json`}`,
    world: {
      simulate: env.WORLD_SIMULATE === "1" || env.WORLD_SIMULATE === "true",
      appId: env.WORLD_APP_ID,
      rpId: env.WORLD_RP_ID,
      signingKey: env.WORLD_RP_SIGNING_KEY,
      action: env.WORLD_ACTION ?? "releash-renew",
      verifyUrl: env.WORLD_VERIFY_URL ?? "https://developer.world.org/api/v4/verify",
      environment: env.WORLD_ENVIRONMENT ?? "staging",
      stagingToken: env.WORLD_STAGING_TOKEN,
      allowLegacy: env.WORLD_ALLOW_LEGACY === "1" || env.WORLD_ALLOW_LEGACY === "true",
      credentials: (env.WORLD_CREDENTIALS ?? "proof_of_human").split(",").map((c) => c.trim()).filter(Boolean),
    },
  };
}
export type Config = ReturnType<typeof loadConfig>;
export type World = Config["world"];

export function requireWorld(world: World) {
  const missing = [
    ["WORLD_APP_ID", world.appId],
    ["WORLD_RP_ID", world.rpId],
    ["WORLD_RP_SIGNING_KEY", world.signingKey],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw Object.assign(new Error(`World ID is not configured: set ${missing.join(", ")} (or WORLD_SIMULATE=1 for local dev).`), { status: 503 });
}

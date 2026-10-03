import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Abi,
  type Address,
  type Hex,
  BaseError,
  ContractFunctionRevertedError,
} from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const AGENT_DIR = fileURLToPath(new URL("..", import.meta.url));

export const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);
export const LOCAL = CHAIN_ID === 31337;
export const RPC_URL = process.env.RPC_URL ?? (LOCAL ? "http://127.0.0.1:8545" : "");
if (!RPC_URL) throw new Error(`RPC_URL is required for chain ${CHAIN_ID}`);

export type Deployment = {
  chainId: number;
  vault: Address;
  usdg: Address;
  rnvda: Address;
  feed: Address;
  pool: Address;
  worldSigner: Address;
  keeper: Address;
  halfLife: number;
};
export const dep: Deployment = JSON.parse(readFileSync(`${ROOT}deployments/${CHAIN_ID}.json`, "utf8"));

const abi = (n: string) => JSON.parse(readFileSync(`${ROOT}deployments/abi/${n}.json`, "utf8")) as Abi;
export const vaultAbi = abi("ReleashVault");
export const poolAbi = abi("MockPool");
export const feedAbi = abi("MockPriceFeed");
export const usdgAbi = abi("MockUSDG");
export const stockAbi = abi("MockStock");
/** Every custom error the stack can throw, so a revert from any contract decodes. */
export const allErrorsAbi = [...vaultAbi, ...poolAbi, ...feedAbi, ...usdgAbi, ...stockAbi].filter((x) => x.type === "error");

export const chain = defineChain({
  id: CHAIN_ID,
  name: LOCAL ? "Anvil" : `chain-${CHAIN_ID}`,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});
const pollingInterval = LOCAL ? 200 : 500;
export const pub = createPublicClient({ chain, transport: http(RPC_URL), pollingInterval });

/** Anvil default keys: used only on 31337 when the env var is unset. */
const ANVIL_KEYS: Record<string, Hex> = {
  KEEPER_PK: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  AGENT_PK: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  ALICE_PK: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  CONTROL_PK: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  LIQUIDATOR_PK: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
};
export function key(name: keyof typeof ANVIL_KEYS | string): Hex {
  const v = process.env[name] ?? (LOCAL ? ANVIL_KEYS[name] : undefined);
  if (!v) throw new Error(`${name} is required on chain ${CHAIN_ID}`);
  return v as Hex;
}
/** On a load-balanced public RPC a node may not have applied our last tx yet: track nonces locally
 * (one wallet object per key per process), and give nodes a moment after each receipt. */
const wallets = new Map<string, any>();
export function wallet(pk: Hex) {
  const hit = wallets.get(pk);
  if (hit) return hit as ReturnType<typeof mk>;
  const w = mk(pk);
  wallets.set(pk, w);
  return w;
}
function mk(pk: Hex) {
  const account = LOCAL ? privateKeyToAccount(pk) : privateKeyToAccount(pk, { nonceManager });
  return createWalletClient({ account, chain, transport: http(RPC_URL), pollingInterval });
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SETTLE_MS = Number(process.env.SETTLE_MS ?? (LOCAL ? 0 : 1500));
export const settle = () => (SETTLE_MS ? sleep(SETTLE_MS) : Promise.resolve());
export type Wallet = ReturnType<typeof wallet>;

/** Several processes share some keys (backend demo routes, keeper, agent loop), each with its own
 * local nonce tracker. On a nonce error, resync from the chain and resend. */
export async function withNonceRetry<T>(w: Wallet, sendTx: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await sendTx();
    } catch (e) {
      const msg = `${(e as BaseError)?.shortMessage ?? ""} ${(e as { details?: string })?.details ?? ""} ${(e as Error)?.message ?? ""}`;
      if (LOCAL || i >= 3 || !/nonce/i.test(msg)) throw e;
      nonceManager.reset({ address: w.account.address, chainId: chain.id });
      await sleep(1000 + i * 500);
    }
  }
}

/** Sends a contract call after simulating it; waits for the receipt. Throws on revert. */
export async function send(w: Wallet, address: Address, abi: Abi, functionName: string, args: unknown[]) {
  let request: any;
  // A lagging node can refuse a call that depends on our previous tx (allowance, balance): retry.
  for (let i = 0; ; i++) {
    try {
      ({ request } = await pub.simulateContract({ account: w.account, address, abi, functionName, args } as any));
      break;
    } catch (e) {
      if (LOCAL || i >= 4) throw e;
      await sleep(1000);
    }
  }
  const hash = await withNonceRetry(w, () => w.writeContract(request as any));
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
  await settle();
  return receipt;
}

/** { name, args, shortMessage, details } from a viem error; name is the custom error if one decoded. */
export function decodeError(err: unknown) {
  const e = err as BaseError & { details?: string };
  const reverted = e instanceof BaseError ? (e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null) : null;
  return {
    name: reverted?.data?.errorName ?? reverted?.reason ?? "Unknown",
    args: reverted?.data?.args?.map((a) => (typeof a === "bigint" ? a.toString() : a)),
    shortMessage: e?.shortMessage ?? String((e as Error)?.message ?? e),
    details: e?.details,
  };
}

export const latestTs = async () => (await pub.getBlock({ blockTag: "latest" })).timestamp;
export const usd = (x: bigint) => Number(x) / 1e6;
export const fmt = (x: bigint, d = 6, p = 2) => (Number(x) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: p });
export const jsonSafe = (o: unknown) => JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

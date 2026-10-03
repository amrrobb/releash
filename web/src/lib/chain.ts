import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, DEMO_PK, RPC_URL } from "../config";

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

export const demoAccount = DEMO_PK ? privateKeyToAccount(DEMO_PK) : undefined;
export const demoWallet: WalletClient | undefined = demoAccount
  ? createWalletClient({ account: demoAccount, chain: CHAIN, transport: http(RPC_URL) })
  : undefined;

/**
 * Chain clock. Blocks only appear when something happens (anvil automine, Arbitrum), so the latest
 * block's timestamp can sit still for minutes. We keep the largest observed (block.timestamp - wall)
 * and read chainNow = wall + offset. A stale block only lowers the estimate, so the max converges to
 * the clock the next transaction will see, and it follows evm_increaseTime once a block lands.
 */
let offset: number | null = null;
export function observeBlock(timestamp: bigint) {
  const o = Number(timestamp) - Date.now() / 1000;
  if (offset === null || o > offset) offset = o;
}
export function chainNow(): number {
  return Date.now() / 1000 + (offset ?? 0);
}

/** Decodes a revert into the contract's error name (e.g. "AuthorityExceeded") plus the RPC details. */
export function explainError(err: unknown): { name: string; message: string } {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? "Reverted";
      const args = revert.data?.args?.length ? `(${revert.data.args.map(String).join(", ")})` : "";
      return { name, message: `Blocked on-chain: ${name}${args}` };
    }
    const details = (err as BaseError & { details?: string }).details;
    if (/rejected|denied/i.test(err.shortMessage + (details ?? ""))) return { name: "Rejected", message: "You rejected the request in your wallet." };
    return { name: "Error", message: details ? `${err.shortMessage} (${details})` : err.shortMessage };
  }
  return { name: "Error", message: err instanceof Error ? err.message : String(err) };
}

/** Simulate first (decoded revert name before the wallet pops), then send and wait for the receipt. */
export async function send(
  wallet: WalletClient,
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] },
) {
  const account = wallet.account;
  if (!account) throw new Error("No account connected");
  const { request } = await publicClient.simulateContract({ ...call, account } as Parameters<typeof publicClient.simulateContract>[0]);
  const hash = await wallet.writeContract({ ...(request as Parameters<WalletClient["writeContract"]>[0]), chain: CHAIN, account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Transaction reverted (${hash})`);
  observeBlock((await publicClient.getBlock({ blockNumber: receipt.blockNumber })).timestamp);
  return receipt;
}

/**
 * The backend may sign a renewal issued in the near future (max(latest block, renewalFloor + 1)),
 * and renew() rejects issuedAt > block.timestamp. Wait until the chain's clock reaches it.
 */
export async function waitForChainTime(ts: number, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const b = await publicClient.getBlock({ blockTag: "latest" });
    observeBlock(b.timestamp);
    if (Number(b.timestamp) >= ts || Date.now() > until) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

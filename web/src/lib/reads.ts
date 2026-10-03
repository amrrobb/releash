import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, type Address, type Log } from "viem";
import { ABI, DEPLOYMENT } from "../config";
import { observeBlock, publicClient } from "./chain";

export type Position = { collateral: bigint; debt: bigint };
export type Mandate = { agent: Address; authorityBase: bigint; lastRenewed: bigint; revoked: boolean };
export type VaultState = {
  blockNumber: bigint;
  blockTime: number;
  position: Position;
  mandate: Mandate;
  authorityNow: bigint;
  value: bigint;
  ltvBps: number;
  liquidatable: boolean;
  price8: bigint;
  priceUpdatedAt: number;
  walletUsdg: bigint;
  walletStock: bigint;
  allowUsdg: bigint;
  allowStock: bigint;
  vaultLiquidity: bigint;
  /** Read from the vault (immutable), not the deployment JSON, so the meter can never drift from the contract. */
  halfLife: number;
};

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const V = { address: DEPLOYMENT.vault, abi: ABI.vault } as const;

/** One poll = one block. Every read is pinned to the same blockNumber so a screen never mixes states. */
async function readVault(owner: Address): Promise<VaultState> {
  const block = await publicClient.getBlock({ blockTag: "latest" });
  observeBlock(block.timestamp);
  const blockNumber = block.number!;
  const at = { blockNumber } as const;
  const r = <T,>(address: Address, abi: typeof ABI.vault, functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address, abi, functionName, args, ...at }) as Promise<T>;

  const [pos, man, auth, price, health, walletUsdg, walletStock, allowUsdg, allowStock, vaultLiquidity, halfLife] = await Promise.all([
    r<readonly [bigint, bigint]>(V.address, V.abi, "positions", [owner]),
    r<readonly [Address, bigint, bigint, boolean]>(V.address, V.abi, "mandates", [owner]),
    r<bigint>(V.address, V.abi, "authorityNow", [owner]),
    r<readonly [bigint, bigint]>(V.address, V.abi, "price"),
    r<readonly [bigint, bigint, bigint, boolean]>(V.address, V.abi, "healthOf", [owner]),
    r<bigint>(DEPLOYMENT.usdg, ABI.usdg, "balanceOf", [owner]),
    r<bigint>(DEPLOYMENT.rnvda, ABI.stock, "balanceOf", [owner]),
    r<bigint>(DEPLOYMENT.usdg, ABI.usdg, "allowance", [owner, DEPLOYMENT.vault]),
    r<bigint>(DEPLOYMENT.rnvda, ABI.stock, "allowance", [owner, DEPLOYMENT.vault]),
    r<bigint>(DEPLOYMENT.usdg, ABI.usdg, "balanceOf", [DEPLOYMENT.vault]),
    r<bigint>(V.address, V.abi, "halfLife"),
  ]);

  const ltv = health[2];
  return {
    blockNumber,
    blockTime: Number(block.timestamp),
    position: { collateral: pos[0], debt: pos[1] },
    mandate: { agent: man[0], authorityBase: man[1], lastRenewed: man[2], revoked: man[3] },
    authorityNow: auth,
    value: health[0],
    ltvBps: ltv > 10_000_000n ? Number.POSITIVE_INFINITY : Number(ltv),
    liquidatable: health[3],
    price8: price[0],
    priceUpdatedAt: Number(price[1]),
    walletUsdg,
    walletStock,
    allowUsdg,
    allowStock,
    vaultLiquidity,
    halfLife: Number(halfLife),
  };
}

export function useVault(owner: Address | undefined) {
  return useQuery({
    queryKey: ["vault", owner],
    queryFn: () => readVault(owner!),
    enabled: !!owner,
    refetchInterval: 1500,
    retry: false,
  });
}

export const hasAgent = (m?: Mandate) => !!m && m.agent !== ZERO;

// ---------------------------------------------------------------- events

export type ChainEvent = {
  kind: "chain";
  id: string;
  name: string;
  args: Record<string, unknown>;
  ts: number;
  txHash: string;
  blockNumber: bigint;
};

const blockTimes = new Map<bigint, number>();
async function blockTime(n: bigint) {
  const hit = blockTimes.get(n);
  if (hit !== undefined) return hit;
  const b = await publicClient.getBlock({ blockNumber: n });
  blockTimes.set(n, Number(b.timestamp));
  return Number(b.timestamp);
}

/** Vault logs from startBlock, fetched incrementally in chunks (public RPCs cap the range). */
const cache = { from: BigInt(DEPLOYMENT.startBlock ?? 0), logs: [] as Log[] };
const CHUNK = 9_000n;
let inflight: Promise<Log[]> | null = null;
function vaultLogs(): Promise<Log[]> {
  // Two owners (you + the control) poll at once; one fetch serves both so no range is read twice.
  inflight ??= fetchLogs().finally(() => {
    inflight = null;
  });
  return inflight;
}
async function fetchLogs(): Promise<Log[]> {
  const head = await publicClient.getBlockNumber();
  while (cache.from <= head) {
    const to = cache.from + CHUNK - 1n < head ? cache.from + CHUNK - 1n : head;
    const logs = await publicClient.getLogs({ address: DEPLOYMENT.vault, fromBlock: cache.from, toBlock: to });
    cache.logs.push(...logs);
    cache.from = to + 1n;
  }
  return cache.logs;
}

async function readEvents(owner: Address): Promise<ChainEvent[]> {
  const logs = await vaultLogs();
  const out: ChainEvent[] = [];
  for (const log of logs) {
    let decoded;
    try {
      decoded = decodeEventLog({ abi: ABI.vault, data: log.data, topics: log.topics });
    } catch {
      continue;
    }
    const args = (decoded.args ?? {}) as Record<string, unknown>;
    const who = (args.owner ?? args.from) as string | undefined;
    if (!who || who.toLowerCase() !== owner.toLowerCase()) continue;
    out.push({
      kind: "chain",
      id: `${log.transactionHash}-${log.logIndex}`,
      name: String(decoded.eventName),
      args,
      ts: await blockTime(log.blockNumber!),
      txHash: log.transactionHash!,
      blockNumber: log.blockNumber!,
    });
  }
  return out;
}

export function useEvents(owner: Address | undefined) {
  return useQuery({
    queryKey: ["events", owner],
    queryFn: () => readEvents(owner!),
    enabled: !!owner,
    refetchInterval: 2000,
    retry: false,
  });
}

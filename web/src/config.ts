import { defineChain, type Abi, type Address, type Hex } from "viem";
import { foundry } from "viem/chains";

/** Every address comes from ../deployments/<chainId>.json. Nothing is hardcoded here. */
type Deployment = {
  chainId: number;
  vault: Address;
  usdg: Address;
  rnvda: Address;
  feed: Address;
  pool: Address;
  worldSigner: Address;
  keeper?: Address;
  halfLife: number;
  startBlock: number;
};

const deployments = import.meta.glob("../../deployments/*.json", { eager: true, import: "default" }) as Record<
  string,
  Deployment
>;
const abis = import.meta.glob("../../deployments/abi/*.json", { eager: true, import: "default" }) as Record<string, Abi>;

const env = import.meta.env;

export const CHAIN_ID = Number(env.VITE_CHAIN_ID ?? 31337);
export const RPC_URL: string = env.VITE_RPC_URL ?? (CHAIN_ID === 46630 ? "https://rpc.testnet.chain.robinhood.com" : "http://127.0.0.1:8545");
export const BACKEND_URL: string = (env.VITE_BACKEND_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
export const WORLD_APP_ID: string = env.VITE_WORLD_APP_ID ?? "";
export const WORLD_SIMULATE = env.VITE_WORLD_SIMULATE === "1";
export const DEMO_PK = (env.VITE_DEMO_PK || undefined) as Hex | undefined;
/** Optional: prefills the mandate form with the agent the demo runs. */
export const AGENT_ADDRESS = (env.VITE_AGENT_ADDRESS || undefined) as Address | undefined;
export const CONTROL_OWNER = (env.VITE_CONTROL_OWNER || undefined) as Address | undefined;

const found = Object.entries(deployments).find(([path]) => path.endsWith(`/${CHAIN_ID}.json`));
if (!found) throw new Error(`No deployments/${CHAIN_ID}.json. Deploy first or set VITE_CHAIN_ID.`);
export const DEPLOYMENT: Deployment = found[1];

function abi(name: string): Abi {
  const hit = Object.entries(abis).find(([path]) => path.endsWith(`/${name}.json`));
  if (!hit) throw new Error(`Missing deployments/abi/${name}.json`);
  return hit[1];
}

export const ABI = {
  vault: abi("ReleashVault"),
  usdg: abi("MockUSDG"),
  stock: abi("MockStock"),
  feed: abi("MockPriceFeed"),
  pool: abi("MockPool"),
};

export const CHAIN =
  CHAIN_ID === 31337
    ? { ...foundry, rpcUrls: { default: { http: [RPC_URL] } } }
    : defineChain({
        id: CHAIN_ID,
        name: CHAIN_ID === 46630 ? "Robinhood Chain Testnet" : `Chain ${CHAIN_ID}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [RPC_URL] } },
        blockExplorers:
          CHAIN_ID === 46630
            ? { default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" } }
            : undefined,
      });

export const EXPLORER = CHAIN.blockExplorers?.default.url;

/** Contract constants mirrored for display. The contract is the authority; these only draw lines. */
export const MAX_LTV_BPS = 5000;
export const LIQ_THRESHOLD_BPS = 7000;
export const CUTOFF_HALVINGS = 3;
export const MAX_PRICE_AGE = 3 * 24 * 3600;

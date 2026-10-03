import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Address, WalletClient } from "viem";
import { createConfig, http, useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { CHAIN, RPC_URL } from "../config";
import { demoAccount, demoWallet } from "./chain";

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [injected()],
  transports: { [CHAIN.id]: http(RPC_URL) },
});

type Mode = "demo" | "injected" | null;
type Signer = {
  mode: Mode;
  address?: Address;
  wallet?: WalletClient;
  wrongChain: boolean;
  demoAvailable: boolean;
  useDemo: () => void;
  connectInjected: () => void;
  switchChain: () => void;
  disconnect: () => void;
  connecting: boolean;
};

const Ctx = createContext<Signer | null>(null);
const KEY = "releash.mode";

function savedMode(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "demo" || v === "injected" ? v : null;
  } catch {
    return null;
  }
}
function saveMode(m: Mode) {
  try {
    if (m) localStorage.setItem(KEY, m);
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

export function SignerProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => savedMode() ?? (demoWallet ? "demo" : null));
  const conn = useConnection();
  const connectors = useConnectors();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: injectedWallet } = useWalletClient({ chainId: CHAIN.id });

  useEffect(() => saveMode(mode), [mode]);

  const value = useMemo<Signer>(() => {
    const base = {
      demoAvailable: !!demoWallet,
      connecting: isPending,
      useDemo: () => setMode("demo"),
      connectInjected: () => {
        setMode("injected");
        const c = connectors[0];
        if (c && !conn.isConnected) connect({ connector: c, chainId: CHAIN.id });
      },
      switchChain: () => switchChain({ chainId: CHAIN.id }),
      disconnect: () => {
        if (mode === "injected") disconnect();
        setMode(null);
      },
    };
    if (mode === "demo" && demoWallet && demoAccount) {
      return { ...base, mode, address: demoAccount.address, wallet: demoWallet, wrongChain: false };
    }
    if (mode === "injected" && conn.isConnected && conn.address) {
      const wrongChain = conn.chainId !== CHAIN.id;
      return { ...base, mode, address: conn.address, wallet: wrongChain ? undefined : injectedWallet, wrongChain };
    }
    return { ...base, mode: null, wrongChain: false };
  }, [mode, conn.isConnected, conn.address, conn.chainId, injectedWallet, connectors, connect, disconnect, switchChain, isPending]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSigner() {
  const s = useContext(Ctx);
  if (!s) throw new Error("SignerProvider missing");
  return s;
}

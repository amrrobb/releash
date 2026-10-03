import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Abi, Address } from "viem";
import { explainError, send } from "./chain";
import { useSigner } from "./signer";

export type Call = { address: Address; abi: Abi; functionName: string; args: readonly unknown[] };

/** Runs one or more calls in order (e.g. approve then deposit) and refreshes reads afterwards. */
export function useTx() {
  const { wallet } = useSigner();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ name: string; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function run(label: string, calls: Call[] | (() => Call[] | Promise<Call[]>)): Promise<boolean> {
    if (!wallet) {
      setError({ name: "NoWallet", message: "Connect a wallet or use the demo account first." });
      return false;
    }
    setPending(label);
    setError(null);
    setDone(null);
    try {
      const list = typeof calls === "function" ? await calls() : calls;
      for (const c of list) await send(wallet, c);
      setDone(label);
      return true;
    } catch (e) {
      console.error(label, e);
      setError(explainError(e));
      return false;
    } finally {
      setPending(null);
      await qc.invalidateQueries();
    }
  }

  return { run, pending, error, done, clear: () => setError(null) };
}

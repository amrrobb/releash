import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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

  /** Returns null on success, else the decoded error (also shown via `error`). */
  async function attempt(label: string, calls: Call[] | (() => Call[] | Promise<Call[]>)): Promise<{ name: string; message: string } | null> {
    if (!wallet) {
      const e = { name: "NoWallet", message: "Connect a wallet or use the demo account first." };
      setError(e);
      return e;
    }
    setPending(label);
    setError(null);
    setDone(null);
    try {
      const list = typeof calls === "function" ? await calls() : calls;
      for (const c of list) await send(wallet, c);
      setDone(label);
      return null;
    } catch (e) {
      console.error(label, e);
      const x = explainError(e);
      setError(x);
      return x;
    } finally {
      setPending(null);
      await qc.invalidateQueries();
    }
  }

  // "Confirmed on-chain" is a moment, not a state: clear it so it never reads as stale.
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(null), 6000);
    return () => clearTimeout(id);
  }, [done]);

  const run = async (label: string, calls: Call[] | (() => Call[] | Promise<Call[]>)) => (await attempt(label, calls)) === null;

  return { run, attempt, setError, pending, error, done, clear: () => setError(null) };
}

import type { useTx } from "../lib/tx";

export function TxStatus({ tx }: { tx: ReturnType<typeof useTx> }) {
  if (tx.error)
    return (
      <p className="txstatus txstatus--err" role="alert">
        {tx.error.message}
      </p>
    );
  if (tx.done) return <p className="txstatus txstatus--ok">Confirmed on-chain.</p>;
  return null;
}

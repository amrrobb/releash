import { useState } from "react";
import type { Address } from "viem";
import { ABI, DEPLOYMENT } from "../config";
import { api, BackendError, fetchRpContext, type RenewalResponse, type RpContextResponse } from "./backend";
import { waitForChainTime } from "./chain";
import type { useTx } from "./tx";

export const RENEW_ACTION = "releash-renew";

/**
 * World ID renewal. The backend verifies the proof (or accepts the simulator on WORLD_SIMULATE=1
 * deployments), binds the nullifier to the owner and signs a Renewal; the owner's wallet submits renew().
 * World ID proves a unique, present human. It is not KYC.
 */
export function useRenew(tx: ReturnType<typeof useTx>, owner?: Address, agent?: Address) {
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ctx, setCtx] = useState<RpContextResponse | null>(null);
  const [open, setOpen] = useState(false);

  async function finish(idkitResult: unknown) {
    if (!owner || !agent) return;
    setStage("Verifying…");
    try {
      // renew() reverts RenewalNotNewer when a revoke, fire or agent change landed in the same second
      // (renewalFloor moved). One fresh signature from the backend usually clears it.
      for (let i = 0; i < 2; i++) {
        let out: RenewalResponse;
        try {
          out = await api<RenewalResponse>("/api/renew", { owner, agent, idkitResult });
        } catch (e) {
          if (i === 1) {
            tx.setError({ name: "RenewalNotNewer", message: "Renewal superseded — try again." });
            break;
          }
          throw e;
        }
        const r = out.renewal;
        if (Number(r.issuedAt) > 0) {
          setStage("Waiting for the chain…");
          await waitForChainTime(Number(r.issuedAt));
        }
        setStage("Confirming…");
        const fail = await tx.attempt("renew", [
          {
            address: DEPLOYMENT.vault,
            abi: ABI.vault,
            functionName: "renew",
            args: [{ owner: r.owner, agent: r.agent, issuedAt: BigInt(r.issuedAt), deadline: BigInt(r.deadline) }, out.signature],
          },
        ]);
        if (!fail || fail.name !== "RenewalNotNewer") break;
        if (i === 1) tx.setError({ name: "RenewalNotNewer", message: "Renewal superseded — try again." });
        else await new Promise((res) => setTimeout(res, 1100));
      }
    } catch (e) {
      setErr(e instanceof BackendError && e.status === 0 ? "Backend unreachable: cannot renew right now." : (e as Error).message);
    } finally {
      setStage(null);
    }
  }

  /** Demo bypass for WORLD_SIMULATE=1 deployments: no phone on stage, labelled "(simulated)" everywhere. */
  const simulate = () => {
    setErr(null);
    tx.clear();
    return finish({ simulated: true, action: RENEW_ACTION, signal: owner, environment: "staging" });
  };

  async function startReal() {
    setErr(null);
    tx.clear();
    setStage("Preparing World ID…");
    try {
      setCtx(await fetchRpContext());
      setOpen(true);
    } catch (e) {
      const status = e instanceof BackendError ? e.status : -1;
      setErr(status === 0 ? "World ID unavailable: backend unreachable." : status === 503 || status === 404 ? "World ID isn't configured on this deployment." : (e as Error).message);
    } finally {
      setStage(null);
    }
  }

  return { stage, err, setErr, ctx, open, setOpen, simulate, startReal, finish, busy: !!stage || tx.pending === "renew" };
}

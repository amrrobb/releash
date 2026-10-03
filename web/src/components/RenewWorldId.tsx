import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import { useState } from "react";
import type { Address } from "viem";
import { ABI, DEPLOYMENT, WORLD_APP_ID, WORLD_SIMULATE } from "../config";
import { api, BackendError, fetchRpContext, type RenewalResponse, type RpContextResponse } from "../lib/backend";
import { useTx } from "../lib/tx";
import { TxStatus } from "./TxStatus";

const ACTION = "releash-renew";

/**
 * World ID proves a unique, present human (not KYC). The backend verifies the proof, binds the
 * nullifier to the owner and signs a Renewal; the borrower's own wallet submits vault.renew.
 */
export function RenewWorldId({ owner, agent, disabled }: { owner?: Address; agent?: Address; disabled: boolean }) {
  const tx = useTx();
  const [ctx, setCtx] = useState<RpContextResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function finish(idkitResult: unknown) {
    if (!owner || !agent) return;
    setStage("Verifying proof…");
    try {
      const out = await api<RenewalResponse>("/api/renew", { owner, agent, idkitResult });
      setStage("Submitting renewal…");
      const r = out.renewal;
      await tx.run("renew", [
        {
          address: DEPLOYMENT.vault,
          abi: ABI.vault,
          functionName: "renew",
          args: [{ owner: r.owner, agent: r.agent, issuedAt: BigInt(r.issuedAt), deadline: BigInt(r.deadline) }, out.signature],
        },
      ]);
    } catch (e) {
      setErr(e instanceof BackendError && e.status === 0 ? "Backend unreachable: cannot verify World ID right now." : (e as Error).message);
    } finally {
      setStage(null);
    }
  }

  async function startReal() {
    setErr(null);
    tx.clear();
    setStage("Preparing World ID…");
    try {
      setCtx(await fetchRpContext());
      setOpen(true);
    } catch (e) {
      const status = e instanceof BackendError ? e.status : -1;
      setErr(status === 0 ? "World ID unavailable: backend unreachable." : status === 503 || status === 404 ? "World ID isn't configured on the backend yet." : (e as Error).message);
    } finally {
      setStage(null);
    }
  }

  const simulate = () => {
    setErr(null);
    tx.clear();
    // Demo bypass (backend runs WORLD_SIMULATE=1): no phone on stage. Labelled as simulated in the UI.
    return finish({ simulated: true, action: ACTION, signal: owner, environment: "staging" });
  };

  const busy = !!stage || !!tx.pending;
  return (
    <div className="renew">
      <div className="renew__buttons">
        <button className="btn btn--primary btn--lg" onClick={startReal} disabled={disabled || !owner || busy || !WORLD_APP_ID} data-testid="renew">
          <WorldGlyph /> {stage ?? (tx.pending === "renew" ? "Confirming…" : "Renew with World ID")}
        </button>
        {WORLD_SIMULATE && (
          <button className="btn btn--ghost" onClick={simulate} disabled={disabled || !owner || busy} data-testid="simulate">
            Simulate World ID <span className="tag">demo</span>
          </button>
        )}
      </div>
      <p className="quiet small">
        {disabled ? "Appoint an agent first." : !WORLD_APP_ID ? "World ID app id not set (VITE_WORLD_APP_ID)." : "Proves a unique, present human. Not KYC. Refills authority and restarts the decay clock."}
      </p>
      {err && <p className="txstatus txstatus--err" role="alert">{err}</p>}
      <TxStatus tx={tx} />
      {ctx && owner && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={(ctx.app_id ?? WORLD_APP_ID) as `app_${string}`}
          action={ctx.action ?? ACTION}
          rp_context={ctx.rp_context as RpContext}
          allow_legacy_proofs={ctx.allow_legacy_proofs ?? false}
          environment={ctx.environment}
          preset={proofOfHuman({ signal: owner })}
          onSuccess={(result: IDKitResult) => finish(result)}
          onError={(code) => setErr(`World ID: ${code}`)}
        />
      )}
    </div>
  );
}

function WorldGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19M12 2.5c3 3.2 3 15.8 0 19" />
    </svg>
  );
}

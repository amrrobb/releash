import { IDKitRequestWidget, proofOfHuman, type IDKitResult, type RpContext } from "@worldcoin/idkit";
import type { RpContextResponse } from "../lib/backend";

/** Loaded on demand (React.lazy) so IDKit and its wasm stay out of the first page load. */
export default function WorldIdWidget(props: {
  ctx: RpContextResponse;
  appId: string;
  action: string;
  signal: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (result: IDKitResult) => void;
  onError: (code: string) => void;
}) {
  const { ctx } = props;
  return (
    <IDKitRequestWidget
      open={props.open}
      onOpenChange={props.onOpenChange}
      app_id={(ctx.app_id ?? props.appId) as `app_${string}`}
      action={ctx.action ?? props.action}
      rp_context={ctx.rp_context as RpContext}
      allow_legacy_proofs={ctx.allow_legacy_proofs ?? false}
      environment={ctx.environment}
      preset={proofOfHuman({ signal: props.signal })}
      onSuccess={props.onSuccess}
      onError={(code) => props.onError(String(code))}
    />
  );
}

import { useMarket } from "../lib/backend";
import { fmtAgo, fmtUsd, px8 } from "../lib/math";
import type { VaultState } from "../lib/reads";
import { useChainNow } from "../lib/useNow";

/** Market clock (keeper, via backend) and the oracle price (chain). Price always comes from the vault read. */
export function Market({ state }: { state?: VaultState }) {
  const market = useMarket();
  const now = useChainNow(2);
  const m = market.data;
  const price = state ? fmtUsd(px8(state.price8)) : "—";
  const closed = m && !m.open;
  return (
    <div className="market" data-testid="market">
      <div className="market__state">
        <i className={`dot${!m ? " dot--off" : closed ? " dot--off" : ""}`} aria-hidden />
        {!m ? "Market status unavailable" : closed ? "Market closed · weekend" : "Market open"}
      </div>
      <div className="market__price">
        <span>rNVDA</span>
        <strong className="num">{price}</strong>
      </div>
      {closed && (
        <div className="market__frozen num">
          Price frozen since Fri 16:00{m.frozenSince ? ` (${fmtAgo(now - m.frozenSince).replace(" ago", "")})` : ""}
        </div>
      )}
      {!m && state && <div className="market__frozen num">Oracle updated {fmtAgo(now - state.priceUpdatedAt)}</div>}
    </div>
  );
}

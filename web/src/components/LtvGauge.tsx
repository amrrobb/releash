import { LIQ_THRESHOLD_BPS, MAX_LTV_BPS } from "../config";
import { fmtPct } from "../lib/math";

/** Horizontal LTV gauge, 0 to 100%, with the borrow line (50%) and the liquidation line (70%). */
export function LtvGauge({ ltvBps, size = "lg" }: { ltvBps: number; size?: "lg" | "sm" }) {
  const finite = Number.isFinite(ltvBps);
  const pct = finite ? Math.min(100, ltvBps / 100) : 100;
  const zone = !finite || ltvBps > LIQ_THRESHOLD_BPS ? "danger" : ltvBps > MAX_LTV_BPS ? "warn" : "ok";
  return (
    <div className={`gauge gauge--${size} gauge--${zone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Loan to value">
      <div className="gauge__head">
        <span className="label">LTV</span>
        <span className="gauge__value num">{finite ? fmtPct(ltvBps) : "∞"}</span>
      </div>
      <div className="gauge__track">
        <div className="gauge__liqzone" style={{ left: `${LIQ_THRESHOLD_BPS / 100}%` }} />
        <div className="gauge__fill" style={{ width: `${pct}%` }} />
        <div className="gauge__line gauge__line--borrow" style={{ left: `${MAX_LTV_BPS / 100}%` }} />
        <div className="gauge__line gauge__line--liq" style={{ left: `${LIQ_THRESHOLD_BPS / 100}%` }} />
      </div>
      <div className="gauge__scale">
        <span style={{ left: "0%" }}>0</span>
        <span style={{ left: `${MAX_LTV_BPS / 100}%` }}>50</span>
        <span className="gauge__scale-liq" style={{ left: `${LIQ_THRESHOLD_BPS / 100}%` }}>70</span>
        <span style={{ left: "100%" }}>100</span>
      </div>
      {size === "lg" && (
        <div className="gauge__legend">
          <span><i className="lg-borrow" />borrow limit 50%</span>
          <span><i className="lg-liq" />liquidation 70%</span>
        </div>
      )}
    </div>
  );
}

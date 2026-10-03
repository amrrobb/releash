import { CHAIN } from "../config";
import { useMarket } from "../lib/backend";
import { fmtAgo, fmtUsd, px8, short } from "../lib/math";
import type { VaultState } from "../lib/reads";
import { useSigner } from "../lib/signer";
import { useChainNow } from "../lib/useNow";

export function Wordmark() {
  return (
    <span className="wordmark" aria-label="Releash">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M5 19c0-8 6-14 14-14" />
        <circle cx="19" cy="5" r="1.6" fill="currentColor" stroke="none" />
        <path d="M5 19h6" />
      </svg>
      Releash
    </span>
  );
}

/** The keeper's close is a demo stand-in for the Friday 16:00 ET close: show the nominal close plus
 * how long the price has really been frozen (chain time), not the demo's wall-clock weekday. */
function frozenText(since: number | undefined, now: number) {
  return `since Fri 16:00${since ? ` (${fmtAgo(now - since).replace(" ago", "")})` : ""}`;
}

export function MarketBadge({ state }: { state?: VaultState }) {
  const market = useMarket();
  const now = useChainNow(2);
  const m = market.data;
  const age = state ? now - state.priceUpdatedAt : null;
  const price = state ? fmtUsd(px8(state.price8)) : null;

  if (!m) {
    return (
      <div className="market market--unknown" title="Market clock unavailable (backend offline)">
        <span className="market__state">MARKET ?</span>
        {price && <span className="market__detail num">rNVDA {price} · updated {fmtAgo(age ?? 0)}</span>}
      </div>
    );
  }
  return (
    <div className={`market ${m.open ? "market--open" : "market--closed"}`} data-testid="market">
      <span className="market__state">
        <i className="market__dot" aria-hidden />
        {m.label}
      </span>
      <span className="market__detail num">
        {m.open
          ? `rNVDA ${price ?? ""}`
          : `price frozen ${frozenText(m.frozenSince, now)}${price ? ` at ${price}` : ""}`}
      </span>
    </div>
  );
}

export function Header({ state }: { state?: VaultState }) {
  const s = useSigner();
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <Wordmark />
        <MarketBadge state={state} />
        <div className="connect">
          {s.address ? (
            <>
              {s.mode === "demo" && <span className="tag tag--demo" title="Signs with a local key from VITE_DEMO_PK. Testnet only.">demo account</span>}
              {s.wrongChain ? (
                <button className="btn btn--danger btn--sm" onClick={s.switchChain}>Switch to {CHAIN.name}</button>
              ) : (
                <span className="addr mono" data-testid="address">{short(s.address)}</span>
              )}
              <button className="btn btn--ghost btn--sm" onClick={s.disconnect}>Disconnect</button>
            </>
          ) : (
            <>
              {s.demoAvailable && (
                <button className="btn btn--ghost btn--sm" onClick={s.useDemo} data-testid="use-demo">Demo account</button>
              )}
              <button className="btn btn--primary btn--sm" onClick={s.connectInjected} disabled={s.connecting}>
                {s.connecting ? "Connecting…" : "Connect wallet"}
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

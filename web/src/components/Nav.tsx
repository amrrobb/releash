import { useEffect, useRef, useState } from "react";
import { CHAIN } from "../config";
import { demoAccount } from "../lib/chain";
import { short } from "../lib/math";
import { Link, usePath, type Route } from "../lib/router";
import { useSigner } from "../lib/signer";
import { ArrowUpRight, Chevron, Logo } from "./icons";

export const REPO_URL = "https://github.com/amrrobb/releash";

const LINKS: { to: Route; label: string }[] = [
  { to: "/demo", label: "Demo" },
  { to: "/app", label: "My position" },
  { to: "/security", label: "Security" },
];

/** The account chip. On /demo it always shows the demo account: that page acts as Alice and nobody else. */
function Account({ demoOnly }: { demoOnly: boolean }) {
  const s = useSigner();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const addr = demoOnly ? demoAccount?.address : s.address;
  const label = addr ? short(addr) : s.connecting ? "Connecting…" : "Connect";
  return (
    <div className="account" ref={ref}>
      <button className="account__btn" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <span className="num" data-testid={addr ? "address" : undefined}>{label}</span>
        <Chevron />
      </button>
      {open && (
        <div className="account__menu" role="menu">
          {demoOnly ? (
            <p>The demo acts as Alice, the shared demo account (a local testnet key). Use My position for your own wallet.</p>
          ) : (
            <>
              <p>
                {s.mode === "demo" ? "Demo account: a local testnet key." : s.mode === "injected" ? `Your wallet on ${CHAIN.name}.` : "Choose how to sign."}
              </p>
              {s.wrongChain && <button role="menuitem" onClick={s.switchChain}>Switch to {CHAIN.name}</button>}
              {s.mode !== "demo" && s.demoAvailable && <button role="menuitem" data-testid="use-demo" onClick={() => { s.useDemo(); setOpen(false); }}>Use the demo account</button>}
              {s.mode !== "injected" && <button role="menuitem" onClick={() => { s.connectInjected(); setOpen(false); }}>Connect wallet</button>}
              {s.mode && <button role="menuitem" onClick={() => { s.disconnect(); setOpen(false); }}>Disconnect</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Nav() {
  const path = usePath();
  return (
    <header className="nav">
      <div className="nav__inner">
        <Link to="/" className="logo" aria-label="Releash home">
          <Logo />
          Releash
        </Link>
        <nav className="nav__links" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} aria-current={path === l.to ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="nav__right">
          {path === "/" ? (
            <Link to="/demo" className="btn btn--dark">
              Open live demo <ArrowUpRight />
            </Link>
          ) : (
            <>
              <span className="netpill"><i className="dot" aria-hidden /> <span>Testnet</span></span>
              {path === "/security" ? (
                <a className="btn btn--line" href={REPO_URL} target="_blank" rel="noreferrer">View source <ArrowUpRight /></a>
              ) : (
                <Account demoOnly={path === "/demo"} />
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

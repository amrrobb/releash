import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Address } from "viem";
import { ArrowUpRight, Chevron, Doc, Layers } from "../components/icons";
import { REPO_URL } from "../components/Nav";
import { CHAIN, DEPLOYMENT, EXPLORER } from "../config";
import { short } from "../lib/math";
import { Link } from "../lib/router";

const RULES = [
  ["Borrowing has a ceiling", "Agent debt cannot exceed its current authority."],
  ["Authority decays", "The ceiling halves over time and expires after three half-lives."],
  ["Repayment stays available", "Decay and revoke do not remove the agent's right to reduce debt."],
  ["No admin can move your position", "The contract enforces the allowed actions."],
];

const TRUST = [
  ["Renewal signer", "The backend checks the World ID proof and signs a one-time renewal. It cannot move funds."],
  ["Human presence, not KYC", "World ID proves a unique, present human."],
  ["Agent removal", "Fire removes all agent permissions, including repayment."],
];

const CONTRACTS: { name: string; key: "vault" | "usdg" | "rnvda" | "feed" | "pool"; kind: string }[] = [
  { name: "ReleashVault", key: "vault", kind: "Testnet" },
  { name: "USDG", key: "usdg", kind: "Mock token" },
  { name: "rNVDA", key: "rnvda", kind: "Mock token" },
  { name: "NVDA/USD feed", key: "feed", kind: "Mock feed" },
  { name: "rNVDA/USDG pool", key: "pool", kind: "Mock pool" },
];

/** Robinhood Chain mainnet integration targets. Documentation only: nothing here calls them. */
const MAINNET = [
  ["USDG", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
  ["NVDA token", "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEc"],
  ["Chainlink NVDA/USD", "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15"],
];

/** Blockscout's own answer; the badge appears only when it says verified. */
function Verified({ addr }: { addr: Address }) {
  const q = useQuery({
    queryKey: ["verified", addr],
    enabled: !!EXPLORER,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => (await (await fetch(`${EXPLORER}/api/v2/smart-contracts/${addr}`)).json())?.is_verified === true,
  });
  return q.data ? <span className="verified">✓ Verified</span> : null;
}

const SECTIONS = [
  ["rules", "Contract rules"],
  ["trust", "Trust assumptions"],
  ["contracts", "Contracts"],
  ["review", "Review & testing"],
] as const;

export function SecurityPage() {
  const [on, setOn] = useState<string>("rules");
  return (
    <main>
      <div className="wrap">
        <div className="pagehead">
          <div>
            <h1>Security &amp; trust</h1>
            <p className="sub">What the contract enforces. What this deployment assumes.</p>
          </div>
        </div>
        <div className="trustbar" role="note">
          <i className="dot" aria-hidden />
          <div>
            <h2>Testnet deployment</h2>
            <p>Mock assets and price feed. World ID renewal is simulated here.</p>
          </div>
        </div>

        <div className="sec">
          <nav className="sec__nav" aria-label="On this page">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className={on === id ? "is-on" : ""} onClick={() => setOn(id)}>{label}</a>
            ))}
          </nav>
          <div style={{ display: "grid", gap: 16 }}>
            <div className="sec__grid">
              <section className="card sec__card" id="rules" aria-labelledby="rules-h">
                <h2 id="rules-h">Enforced by the contract</h2>
                <ol className="rules">
                  {RULES.map(([t, d], i) => (
                    <li key={t}>
                      <span className="no num">{String(i + 1).padStart(2, "0")}</span>
                      <div><h3>{t}</h3><p>{d}</p></div>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="card sec__card" id="trust" aria-labelledby="trust-h">
                <h2 id="trust-h">Trust assumptions</h2>
                <ul className="trust">
                  {TRUST.map(([t, d]) => (
                    <li key={t}>
                      <i className="dot" aria-hidden />
                      <div><h3>{t}</h3><p>{d}</p></div>
                    </li>
                  ))}
                </ul>
                <a className="link" href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">Read implementation notes <ArrowUpRight /></a>
              </section>
            </div>

            <section className="card sec__card" id="contracts" aria-labelledby="contracts-h">
              <h2 id="contracts-h" style={{ borderBottom: 0, paddingBottom: 0 }}>
                Deployed contracts <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 8 }}>{CHAIN.name}</span>
              </h2>
              <table className="contracts">
                <thead><tr><th>Contract</th><th>Deployment</th><th>Reference</th></tr></thead>
                <tbody>
                  {CONTRACTS.map((c) => {
                    const addr = DEPLOYMENT[c.key];
                    return (
                      <tr key={c.key}>
                        <td>{c.name}</td>
                        <td><span className={`chip${c.key === "vault" ? " chip--green" : ""}`}>{c.kind}</span></td>
                        <td>
                          {EXPLORER ? (
                            <a className="link num" href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">{c.key === "vault" ? short(addr) : "View on explorer"} <ArrowUpRight /></a>
                          ) : (
                            <span className="num">{short(addr)}</span>
                          )}
                          <Verified addr={addr} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>

            <section className="card extra" id="review" aria-label="Review and integration targets">
              <div className="extra__row">
                <span className="ico"><Layers /></span>
                <div><h3>Review &amp; testing</h3><p>Test suite, invariants and disclosed limitations.</p></div>
                <a className="link" href={REPO_URL} target="_blank" rel="noreferrer">View repository <ArrowUpRight /></a>
              </div>
              <details>
                <summary className="extra__row">
                  <span className="ico"><Doc /></span>
                  <div><h3>Mainnet integration targets</h3><p>USDG · NVDA token · Chainlink NVDA/USD</p></div>
                  <Chevron className="chev" />
                </summary>
                <ul className="targets">
                  {MAINNET.map(([n, a]) => (
                    <li key={a}><span className="muted">{n}</span> <a className="link num" href={`https://robinhoodchain.blockscout.com/address/${a}`} target="_blank" rel="noreferrer">{short(a)} <ArrowUpRight /></a></li>
                  ))}
                  <li className="muted">Robinhood Chain mainnet. Listed for reference; this deployment does not call them.</li>
                </ul>
              </details>
            </section>
          </div>
        </div>
      </div>
      <footer className="sitefoot">
        <div className="wrap">
          <span>Releash · {CHAIN.name}</span>
          <nav aria-label="Footer"><Link to="/demo">Demo</Link> / <Link to="/app">My position</Link> / <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a></nav>
        </div>
      </footer>
    </main>
  );
}

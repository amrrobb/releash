import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { CHAIN, DEPLOYMENT, EXPLORER } from "../config";
import { short } from "../lib/math";

const CONTRACTS: { label: string; key: "vault" | "usdg" | "rnvda" | "feed" | "pool" }[] = [
  { label: "ReleashVault", key: "vault" },
  { label: "USDG (mock)", key: "usdg" },
  { label: "rNVDA (mock)", key: "rnvda" },
  { label: "NVDA/USD feed (mock)", key: "feed" },
  { label: "rNVDA/USDG pool (mock)", key: "pool" },
];

/** Robinhood Chain mainnet integration targets. Documentation only: nothing here calls them. */
const MAINNET = [
  { label: "USDG", addr: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" },
  { label: "NVDA (tokenized stock)", addr: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEc" },
  { label: "Chainlink NVDA/USD", addr: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
];

/** Asks Blockscout whether the source is verified; shows a badge only on a positive answer. */
function useVerified(addr: Address) {
  return useQuery({
    queryKey: ["verified", addr],
    enabled: !!EXPLORER,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`${EXPLORER}/api/v2/smart-contracts/${addr}`);
      if (!res.ok) return false;
      return (await res.json())?.is_verified === true;
    },
  });
}

function ContractRow({ label, addr }: { label: string; addr: Address }) {
  const verified = useVerified(addr);
  return (
    <li>
      <span>{label}</span>
      {EXPLORER ? (
        <a className="mono" href={`${EXPLORER}/address/${addr}`} target="_blank" rel="noreferrer">{short(addr)}</a>
      ) : (
        <span className="mono">{short(addr)}</span>
      )}
      {verified.data && <span className="tag tag--ok">verified</span>}
    </li>
  );
}

export function HowItWorks() {
  return (
    <section className="how" aria-labelledby="how-h">
      <div className="how__grid">
        <div>
          <h2 id="how-h">How it works</h2>
          <ol className="how__steps">
            <li><strong>Deposit and borrow.</strong> Lock tokenized stock, borrow USDG up to 50% LTV. Liquidation starts above 70%.</li>
            <li><strong>Hand an agent a mandate.</strong> It may add debt up to a ceiling you set. That ceiling halves every half-life and hits zero after three, unless you renew.</li>
            <li><strong>Renew by being there.</strong> A World ID proof restarts the clock. Go quiet for the weekend and the agent can only make you safer.</li>
            <li><strong>The contract is the last guard.</strong> The model picks from a fixed menu; anything beyond its authority reverts on-chain.</li>
          </ol>
        </div>
        <div>
          <h3>Trust assumptions</h3>
          <ul className="how__trust">
            <li>Our backend checks the World ID proof and signs a one-time renewal. It cannot move funds; the vault only accepts its signature to restart the clock.</li>
            <li>World ID proves a unique, present human — it is not KYC.</li>
            <li>On testnet, USDG, the NVDA token, its price feed and the pool are mocks we deploy. On Robinhood Chain mainnet the integration targets are:</li>
          </ul>
          <ul className="how__list">
            {MAINNET.map((m) => (
              <li key={m.addr}><span>{m.label}</span><span className="mono">{short(m.addr)}</span></li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Contracts on {CHAIN.name}</h3>
          <ul className="how__list">
            {CONTRACTS.map((c) => (
              <ContractRow key={c.key} label={c.label} addr={DEPLOYMENT[c.key]} />
            ))}
          </ul>
          <p className="quiet small">No admin can move a position. Deleverage never depends on authority.</p>
        </div>
      </div>
    </section>
  );
}

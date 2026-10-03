import { AuthorityPanel } from "./components/AuthorityPanel";
import { DemoStrip } from "./components/DemoStrip";
import { Feed } from "./components/Feed";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { PositionCard } from "./components/PositionCard";
import { CHAIN, DEPLOYMENT } from "./config";
import { short } from "./lib/math";
import { useVault } from "./lib/reads";
import { useSigner } from "./lib/signer";

const demo = new URLSearchParams(window.location.search).get("demo") === "1";

export default function App() {
  const { address } = useSigner();
  const vault = useVault(address);
  const state = vault.data;

  return (
    <>
      <Header state={state} />
      {demo && <DemoStrip owner={address} state={state} />}
      <main>
        {!demo && <Hero />}
        {vault.isError && (
          <p className="banner" role="alert">
            Can't read the vault on {CHAIN.name}. Is the RPC up? ({(vault.error as Error)?.message?.split("\n")[0]})
          </p>
        )}
        {!address && (
          <p className="banner banner--info">Connect a wallet, or use the demo account, to open a position. Anyone can play the borrower.</p>
        )}
        <div className="grid">
          <div className="col col--left">
            <PositionCard owner={address} state={state} />
          </div>
          <div className="col col--center">
            <AuthorityPanel owner={address} state={state} />
          </div>
          <div className="col col--right">
            <Feed owner={address} />
          </div>
        </div>
      </main>
      <footer className="foot">
        <span>{CHAIN.name} · vault <span className="mono">{short(DEPLOYMENT.vault)}</span></span>
        <span>Testnet only. Mock rNVDA and USDG. World ID proves a unique human, not identity.</span>
      </footer>
    </>
  );
}

import { Link } from "../lib/router";
import { ArrowRight, ArrowUpRight, Check, Fingerprint, Pause } from "../components/icons";

/** A static picture of the agent card: no live data, so it carries no "Live" claim. */
function Illustration() {
  return (
    <div className="illus" aria-label="Illustration of the agent's two permissions">
      <div className="illus__frame" style={{ left: 290, right: 70, top: 0, height: 60 }} aria-hidden />
      <div className="illus__frame" style={{ left: 0, top: 74, width: 60, height: 330, borderColor: "#d8d4fb", borderRight: 0, borderRadius: "18px 0 0 18px" }} aria-hidden />
      <div className="illus__frame" style={{ right: 0, top: 230, width: 50, height: 180, borderColor: "#d8d4fb", borderLeft: 0, borderRadius: "0 18px 18px 0" }} aria-hidden />
      <div className="card illus__card">
        <div className="card__head">
          <h2 className="card__title" style={{ fontSize: 20 }}>What your agent can do</h2>
          <span className="chip">Example</span>
        </div>
        <div className="powers">
          <div className="power" style={{ paddingBottom: 6 }}>
            <span className="power__icon power__icon--green"><Check /></span>
            <div>
              <h3>Reduce debt</h3>
              <p>Your agent can sell collateral to repay the loan.</p>
            </div>
            <span className="power__state power__state--green">Always allowed</span>
          </div>
          <div className="illus__bar" aria-hidden>
            <i style={{ width: "98%", background: "linear-gradient(90deg, #a6e48d, #7fd35c)" }} />
            <b style={{ left: "98%", background: "var(--green-ui)" }} />
          </div>
          <div className="power" style={{ paddingBottom: 6, marginTop: 10 }}>
            <span className="power__icon power__icon--violet"><Pause /></span>
            <div>
              <h3>Add debt</h3>
              <p>The permission ceiling is now below your debt.</p>
            </div>
            <span className="power__state power__state--violet">Permission expires</span>
          </div>
          <div className="illus__bar" aria-hidden>
            <i style={{ width: "46%", background: "linear-gradient(90deg, var(--violet-fill), #7f6ff0)" }} />
            <b style={{ left: "46%", background: "var(--violet)" }} />
          </div>
        </div>
      </div>
      <Link to="/demo" className="card illus__renew">
        <span className="ring"><Fingerprint className="" /></span>
        <span>Renew with World ID <em>(simulated)</em></span>
        <ArrowRight className="go" />
      </Link>
    </div>
  );
}

const STEPS = [
  { day: "Friday", what: "Market closes", why: "Prices freeze. The loan remains active." },
  { day: "Weekend", what: "Permission shrinks", why: "The agent can still repay debt." },
  { day: "Monday", what: "The market gaps down", why: "Compare the protected position in the demo." },
];

export function LandingPage() {
  return (
    <main>
      <div className="wrap">
        <section className="hero" aria-labelledby="hero-h">
          <div>
            <p className="eyebrow">Stock-backed loans · <b>Robinhood Chain</b></p>
            <h1 id="hero-h"><span>Step away.</span><br /><span>Keep risk in check.</span></h1>
            <p className="hero__lede">An agent that can always reduce your debt.<br />Permission to borrow more fades until you renew.</p>
            <div className="hero__cta">
              <Link to="/demo" className="btn btn--dark">Open live demo <ArrowUpRight /></Link>
              <Link to="/app" className="btn btn--line">Use with your wallet</Link>
            </div>
            <p className="hero__meta"><i className="dot" aria-hidden /> Testnet demo · Simulated World ID</p>
          </div>
          <Illustration />
        </section>
      </div>

      <div className="band">
        <div className="wrap">
          <section className="story grid" id="story" aria-labelledby="story-h">
            <h2 id="story-h">The market closes.&nbsp; Your loan stays open.</h2>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.day}>
                  <span className="no num">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{s.day}</h3>
                    <p className="what">{s.what}</p>
                    <p className="why">{s.why}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="evidence">
              Why it matters: the Chainlink NVDA/USD feed on Robinhood Chain mainnet went 52 hours without an update on each of
              the last three weekends, and 78 hours over Labor Day. A loan priced by it can't react until Monday.
            </p>
          </section>

          <section className="result" aria-label="Sample result">
            <h2>Same market.<br />Different outcome.</h2>
            <i aria-hidden />
            <div>
              <p className="figure num">$1,907.62</p>
              <p className="figure-sub">more equity kept in the sample demo</p>
              <p className="figure-note">Illustrative testnet result.</p>
            </div>
            <Link to="/demo" className="link">Watch the scenario <ArrowUpRight /></Link>
          </section>

          <p className="builton" aria-label="Built on">
            <span>Built on</span>
            <span><b aria-hidden>◆</b> Robinhood Chain</span> ·
            <span><b aria-hidden>$</b> USDG</span> ·
            <span><b aria-hidden>◎</b> World ID</span> ·
            <span><b aria-hidden>↑</b> Jev</span>
          </p>
        </div>
      </div>
      <footer className="sitefoot">
        <div className="wrap">
          <span>Releash · Robinhood Chain testnet · Mock assets · World ID proves a unique, present human — it is not KYC.</span>
          <nav aria-label="Footer"><Link to="/demo">Demo</Link> / <Link to="/app">My position</Link> / <Link to="/security">Security</Link></nav>
        </div>
      </footer>
    </main>
  );
}

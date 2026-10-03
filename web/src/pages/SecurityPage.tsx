// Placeholder until the /security redesign ships.
import { Link } from "../lib/router";

export function SecurityPage() {
  return (
    <main className="wrap">
      <div className="pagehead">
        <div>
          <h1>Security &amp; trust</h1>
          <p className="sub">Being rebuilt to the new design.</p>
        </div>
      </div>
      <Link to="/demo" className="btn btn--dark">Open the demo</Link>
    </main>
  );
}

// Placeholder until the /app redesign ships (next step).
import { Link } from "../lib/router";

export function AppPage() {
  return (
    <main className="wrap">
      <div className="pagehead">
        <div>
          <h1>My position</h1>
          <p className="sub">Being rebuilt to the new design. Use the demo meanwhile.</p>
        </div>
      </div>
      <Link to="/demo" className="btn btn--dark">Open the demo</Link>
    </main>
  );
}

import type { Address } from "viem";
import { EXPLORER } from "../config";
import { fmtClock, useActivity, type Item, type Kind } from "../lib/activity";
import { Link } from "../lib/router";
import { ArrowDown, ArrowUp, ArrowUpRight, Ban, Check, Doc, Minus, Pause, Refresh } from "./icons";

const ICON: Partial<Record<Kind, [string, React.ReactElement]>> = {
  deleverage: ["green", <ArrowDown />],
  repay: ["green", <ArrowDown />],
  borrow: ["violet", <ArrowUp />],
  blocked: ["red", <Ban />],
  liquidated: ["red", <Ban />],
  renewed: ["violet", <Refresh />],
  mandate: ["grey", <Doc />],
  revoked: ["grey", <Minus />],
  fired: ["grey", <Minus />],
  hold: ["grey", <Pause />],
  skipped: ["grey", <Pause />],
  deposit: ["grey", <Check />],
  withdraw: ["grey", <ArrowUp />],
};

function Row({ it, pinned, full }: { it: Item; pinned: boolean; full: boolean }) {
  const [tone, icon] = ICON[it.kind] ?? ["grey", <Doc />];
  const muted = it.kind === "hold" || it.kind === "skipped";
  return (
    <li className={`feed__item${muted ? " feed__item--muted" : ""}`} data-testid={pinned ? "feed-pinned" : undefined} title={it.raw}>
      <span className={`feed__icon feed__icon--${tone}`}>{icon}</span>
      <div>
        <div className="feed__title num">{it.title}</div>
        {it.detail && <p className="feed__detail">{it.detail}</p>}
        {it.effect && <p className="feed__effect num">{it.effect}</p>}
        {full && it.raw && it.raw !== it.detail && /Jev:|model/.test(it.raw) && <p className="feed__raw">{it.raw}</p>}
        <div className="feed__meta">
          <span><span className="src">{it.source}</span> · <time className="num">{fmtClock(it.ts)}</time></span>
          {it.txHash && EXPLORER && (
            <a className="link" href={`${EXPLORER}/tx/${it.txHash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight /></a>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * /demo: only what the agent did since the current mandate (Reset demo sets it), newest first, 3 rows.
 * /app: every decision and event, holds included.
 */
export function Activity({ owner, variant }: { owner?: Address; variant: "demo" | "app" }) {
  const demo = variant === "demo";
  const { items, logOffline } = useActivity(owner, demo ? { sinceMandate: true, actionsOnly: true, limit: 3 } : { limit: 40 });
  // The pinned row is the newest thing the agent actually did, never a hold or a skip.
  const pinnedId = items.find((it) => it.action)?.id;
  return (
    <section className="card feed" aria-labelledby="feed-h">
      <div className="card__head">
        <h2 id="feed-h" className="card__title">{demo ? "Activity" : "Recent activity"}</h2>
        {demo ? <Link to="/app" className="link link--ink">View all <ArrowUpRight /></Link> : <span className="live"><i className={`dot${logOffline ? " dot--off" : ""}`} aria-hidden />{logOffline ? "Agent log offline" : "Live"}</span>}
      </div>
      {logOffline && <p className="feed__detail">Agent log offline. Showing on-chain events only.</p>}
      <ol className="feed__list" data-testid="feed">
        {items.map((it) => <Row key={it.id} it={it} pinned={it.id === pinnedId} full={!demo} />)}
      </ol>
      {items.length === 0 && (
        <p className="feed__empty">{demo ? "Nothing yet. What the agent does in this run appears here." : "Nothing yet. Decisions and on-chain events appear here as they happen."}</p>
      )}
      <p className="feed__note">Rules and model decisions are labeled separately: JEV and CLAUDE are models; GUARD, MANDATE and RULES are fixed rules.</p>
    </section>
  );
}

// The cut: one entry per shot, with the narration it carries.
//
// The narration follows docs/SUBMISSION.md §2 (shortened to fit 2:30–3:00), and the same cues feed the on-screen
// captions and video/narration.txt, so the subtitles, the script and a recorded voiceover cannot drift apart.
//
// Claims discipline (SUBMISSION.md):
//  - every number in a caption is read from what the take scraped (src/clips.json) or from a frame check
//    (marks/take-N.notes.json), never typed from an earlier run;
//  - Jev is credited only on the lever-up line, whose pinned feed entry shows Jev's probabilities (frame check);
//  - World ID is said to run in simulator mode; USDG is a testnet mock (contract card).
import clipsJson from "./clips.json";
import notes from "../marks/take-4.notes.json";
import type { Part, Rect } from "./Footage";

type Clip = { file: string; dur: number; events: Record<string, number>; data: Record<string, unknown> | null };
const clips = clipsJson as unknown as Record<string, Clip>;

export type Shot = {
  id: string;
  kind: "card" | "footage";
  card?: "ColdOpen" | "Freeze" | "Weekend" | "Title" | "Contract" | "Closing";
  clip?: string;
  parts?: Part[];
  live?: string;
  /** A cue is a string, or {text, at} to start it at a shot second (to land on the event it describes). */
  cues: (string | { text: string; at: number })[];
  /** Seconds of picture after the last word (silence on the beat). */
  hold?: number;
  min?: number;
};

const need = (name: string) => {
  const c = clips[name];
  if (!c) throw new Error(`no clip "${name}" in src/clips.json: its beat was not verified in the take`);
  return c;
};
const str = (c: Clip, k: string) => String(c.data?.[k] ?? "");
const match = (s: string, re: RegExp, what: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`could not read ${what} from "${s}"`);
  return m[1];
};

// ── numbers read from the take (take 3, redesigned /demo at web 6f05fed)
const ev = (c: Clip, k: string) => {
  const v = c.events[k];
  if (typeof v !== "number") throw new Error(`clip ${c.file} has no event "${k}"`);
  return v;
};
const lever = need("lever");
const borrowed = match(str(lever, "feed"), /Agent borrowed \$([\d,]+)(?:\.00)?/, "the lever-up amount");
const renew = need("renew");
const close = need("close");
const closePct = match(str(close, "feed"), /deleveraged (\d+)%/, "the Friday deleverage");
if (!/weekend rule|weekend limit/i.test(str(close, "feed"))) throw new Error("the Friday line's reason is not the mandate's weekend rule");
const gap = need("gap");
const deltaNow = Number(match(str(gap, "delta"), /\$([\d,.]+)/, "the equity delta").replace(/,/g, ""));
const deltaShown = Object.values(notes.gapDelta.values).map((v) => Number(String(v).replace(/[$,]/g, "")));
const deltaFloor = Math.floor(Math.min(deltaNow, ...deltaShown) / 100) * 100;
const lost = Number(match(str(gap, "lostControl"), /([\d.]+) rNVDA/, "collateral lost")).toFixed(1);
const revoke = need("revoke");
// The post-revoke trim is optional in the take (it depends on the LTV after the gap); say it only if it happened.
const trimmed = typeof revoke.events.trim === "number";
const trimPct = trimmed ? match(str(revoke, "pinned") + " " + str(revoke, "feed"), /deleveraged (\d+)%/, "the post-revoke deleverage") : "";
const guardOnRevoke = trimmed && /GUARD/.test(str(revoke, "pinned"));
const revoked = need("revokedAttempt");
if (!/MandateRevoked/.test(str(revoked, "strip"))) throw new Error("the post-revoke borrow was not blocked with MandateRevoked");
const attempt = need("attempt");
if (!/AuthorityExceeded/.test(str(attempt, "strip"))) throw new Error("the $1,500 attempt was not blocked with AuthorityExceeded");
// Jev is credited only if its chip ("JEV · <choice> <p>%") is on the lever-up row, checked on the frames.
const jevOnLever = Boolean(notes.leverJev?.chip);
const sec = need("security");

// ── framing. /demo fits 1920x1080 at scroll 0, so every rect is in the same space for the whole take.
const box = (x: number, y: number, w: number): Rect => ({ x, y, w, h: (w * 9) / 16 });
const FULL: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
const PAGE = box(250, 30, 1420); // the content column
const CARDS = box(262, 150, 1396); // scenario bar, the two positions and the delta
const AGENT = box(250, 560, 920); // "What your agent can do": reduce debt, add debt, ceiling, Renew / Revoke
const ACTIVITY = box(1100, 470, 580); // the activity rows
const RESULT = box(820, 196, 860); // the scenario result line and the top activity rows
const DELTA = box(740, 262, 920); // Without Releash + Releash kept
const LIVE = "Live · releash.robbyn.xyz/demo · Robinhood Chain testnet";

const rClick = ev(renew, "click");
const leverAt = 3.6 + (renew.dur - (rClick - 0.6)); // shot second the lever clip starts
const closeA = 5.0, closeB = ev(close, "effect") - 3.2;
const gapA = 3.0, gapB = ev(gap, "gapped") - 1.2;
const revA = 3.2, revB = trimmed ? ev(revoke, "trim") - 1.2 : ev(revoke, "revoked") + 1.0, revBLen = trimmed ? 4.2 : 3.0;

export const SHOTS: Shot[] = [
  { id: "cold", kind: "card", card: "ColdOpen", min: 8, cues: ["This is the Chainlink NVDA price feed on Robinhood Chain mainnet.", "Stock feeds run 24/5."] },
  { id: "freeze", kind: "card", card: "Freeze", cues: ["On each of the last three weekends it was silent for 52 hours,", "and for 78 hours over Labor Day."] },
  { id: "weekend", kind: "card", card: "Weekend", min: 8, cues: ["Borrow against tokenized NVDA and log off on Friday,", "and nobody is watching your loan when Monday opens with a gap."] },
  { id: "title", kind: "card", card: "Title", cues: ["Releash: auto-deleverage for stock-backed loans on Robinhood Chain."] },
  {
    id: "hero", kind: "footage", clip: "hero",
    // The landing page, held on the hero. The take later scrolls to a sample result with a different number
    // from this run, so that part is not used.
    parts: [{ from: 0, len: 5.6, cam: [FULL, box(200, 40, 1520)], camAt: [0.2, 5.6] }, { still: true, from: 5.6, cam: box(200, 40, 1520) }],
    cues: ["Your agent can always reduce your debt.", "Permission to borrow more fades until you renew it with World ID."],
  },
  {
    id: "intro", kind: "footage", clip: "intro", live: LIVE,
    parts: [{ from: 0, cam: [FULL, CARDS], camAt: [0.4, 1.9] }],
    cues: ["With Releash: Alice, whose agent watches her loan.", "Without Releash: the same 100 NVDA, and no agent."],
  },
  {
    id: "renew", kind: "footage", clip: "renew", live: LIVE,
    parts: [
      // Held frame before the click: the ceiling is $0 and waiting, nothing on screen is moving.
      { still: true, from: rClick - 0.6, len: 3.6, cam: [PAGE, AGENT], camAt: [0.3, 1.6] },
      { from: rClick - 0.6, len: renew.dur - (rClick - 0.6), cam: AGENT },
      { src: "capture/lever.mp4", from: 0, cam: [AGENT, ACTIVITY], camAt: [0.6, 2.0] },
    ],
    cues: [
      "Add debt: the agent may lever Alice up to 9,500 USDG,",
      "but only after World ID proves a human is present.",
      "Here World ID runs in simulator mode.",
      { text: `Within seconds the agent borrows $${borrowed}.`, at: leverAt + ev(lever, "effect") - 0.2 },
      ...(jevOnLever ? [`The JEV chip is Jev, TypeSafe's decision model, choosing from the contract's fixed menu.`] : []),
      "The USDG goes to Alice, never the agent.",
    ],
  },
  {
    id: "attempt", kind: "footage", clip: "attempt", live: LIVE, hold: 2,
    parts: [{ from: ev(attempt, "click") - 1.2, cam: [PAGE, RESULT], camAt: [ev(attempt, "effect") - ev(attempt, "click") + 0.6, ev(attempt, "effect") - ev(attempt, "click") + 1.8] }],
    cues: ["Now it tries to borrow 1,500 more.", "The vault checks debt against the ceiling at this block,", "and the transaction is blocked on-chain."],
  },
  {
    id: "decay", kind: "footage", clip: "decay", live: LIVE,
    parts: [
      { from: 0, len: 4.5, cam: AGENT },
      { from: 62, skip: "60 s later", cam: AGENT },
    ],
    cues: ["Alice goes offline.", "Every two minutes here, daily in production, the ceiling halves.", "Nothing expires. Reduce debt stays always allowed."],
  },
  {
    id: "close", kind: "footage", clip: "close", live: LIVE,
    parts: [
      { from: ev(close, "click") - 1.0, len: closeA, cam: [PAGE, box(262, 40, 1396)], camAt: [2.0, 3.2] },
      { from: closeB, skip: `${Math.round(closeB - (ev(close, "click") - 1.0 + closeA))} s later`, cam: [CARDS, ACTIVITY], camAt: [2.6, 3.8] },
    ],
    cues: [
      "Friday close: the price freezes.",
      "Alice's mandate caps her weekend LTV, and its rules can override the model.",
      { text: `So the agent repays ${closePct}% of the debt by selling collateral.`, at: closeA + 3.1 },
      "Reducing debt needs no permission.",
    ],
  },
  {
    id: "gap", kind: "footage", clip: "gap", live: LIVE, hold: 2,
    parts: [
      { from: ev(gap, "click") - 1.0, len: gapA, cam: CARDS },
      { from: gapB, skip: `${Math.round(gapB - (ev(gap, "click") - 1.0 + gapA))} s later`, cam: [CARDS, DELTA], camAt: [ev(gap, "liquidated") - gapB + 4.2, ev(gap, "liquidated") - gapB + 5.6] },
    ],
    cues: [
      { text: "Monday opens 35% lower.", at: gapA + 1.0 },
      { text: `Without Releash is liquidated and loses ${lost} rNVDA.`, at: gapA + (ev(gap, "liquidated") - gapB) },
      "With Releash is still safe.",
      `Same stock, same drop: Releash kept over $${deltaFloor.toLocaleString("en-US")} more equity.`,
    ],
  },
  {
    id: "revoke", kind: "footage", clip: "revoke", live: LIVE,
    parts: [
      { from: ev(revoke, "click") - 1.0, len: revA, cam: AGENT },
      { from: revB, len: revBLen, ...(trimmed ? { skip: `${Math.round(revB - (ev(revoke, "click") - 1.0 + revA))} s later`, cam: ACTIVITY } : { cam: AGENT }) },
      { src: "capture/revokedAttempt.mp4", from: ev(revoked, "click") - 1.0, skip: "a moment later", cam: [PAGE, RESULT], camAt: [ev(revoked, "effect") - ev(revoked, "click") + 0.4, ev(revoked, "effect") - ev(revoked, "click") + 1.6] },
    ],
    cues: [
      "Alice revokes the agent.",
      trimmed
        ? guardOnRevoke ? `A fixed LTV guard still trims ${trimPct}%: reducing debt survives revoke.` : `It can still reduce debt, and trims another ${trimPct}%.`
        : "Add debt is revoked. Reduce debt stays always allowed.",
      { text: "But borrowing is blocked on-chain.", at: revA + revBLen + (ev(revoked, "effect") - ev(revoked, "click") + 1.0) },
      "Close always. Open only while you're alive.",
    ],
  },
  {
    id: "security", kind: "footage", clip: "security",
    parts: [{ from: 0, cam: FULL }],
    min: Math.min(8.5, sec.dur),
    cues: ["No owner, no admin, no upgrade path.", "All five contracts are verified on Blockscout."],
  },
  {
    id: "contract", kind: "card", card: "Contract", min: 8,
    cues: ["41 tests; invariants checked against deliberately broken contracts.", "An adversarial review's two signature-replay bugs are fixed, with regression tests."],
  },
  {
    id: "closing", kind: "card", card: "Closing", hold: 2.5,
    cues: ["Built for lending venues to plug in as an auto-deleverage module.", "Production is a change of constructor arguments: Paxos USDG and the Chainlink NVDA feed."],
  },
];

/** Speaking pace for the timing: SUBMISSION.md's ceiling is 2.4 words a second; 2.3 leaves room to breathe. */
export const WPS = 2.3;
const LEAD = 0.35;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export type Timed = Shot & { start: number; dur: number; cueTimes: { text: string; start: number; end: number }[] };

export function timeline(): Timed[] {
  let at = 0;
  return SHOTS.map((s) => {
    let t = LEAD;
    const cueTimes = s.cues.map((c) => {
      const text = typeof c === "string" ? c : c.text;
      if (typeof c !== "string") t = Math.max(t, c.at);
      const d = words(text) / WPS + 0.25;
      const out = { text, start: t, end: t + d };
      t += d;
      return out;
    });
    const dur = Math.max(t + (s.hold ?? 0.5), s.min ?? 0);
    const out = { ...s, start: at, dur, cueTimes };
    at += dur;
    return out;
  });
}

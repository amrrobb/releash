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
import notes from "../marks/take-1.notes.json";
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

// ── numbers read from the take
const lever = need("lever");
const borrowed = match(str(lever, "feed"), /Agent borrowed \$([\d,]+)(?:\.00)?/, "the lever-up amount");
const close = need("close");
const closePct = match(str(close, "feed"), /deleveraged (\d+)%/, "the Friday deleverage");
if (!/weekend limit/.test(str(close, "feed"))) throw new Error("the Friday line's reason is not the mandate's weekend rule");
const gap = need("gap");
const deltaNow = Number(match(str(gap, "delta"), /\$([\d,.]+)/, "the equity delta").replace(/,/g, ""));
const deltaShown = Object.values(notes.gapDelta.values).map((v) => Number(v.replace(/[$,]/g, "")));
const deltaFloor = Math.floor(Math.min(deltaNow, ...deltaShown) / 100) * 100;
const lost = Number(match(str(gap, "lostControl"), /([\d.]+) rNVDA/, "collateral lost")).toFixed(1);
const revoke = need("revoke");
const trimPct = match(str(revoke, "feed"), /deleveraged (\d+)%/, "the post-revoke deleverage");
const revoked = need("revokedAttempt");
if (!/MandateRevoked/.test(str(revoked, "strip"))) throw new Error("the post-revoke borrow was not blocked with MandateRevoked");
const attempt = need("attempt");
if (!/AuthorityExceeded/.test(str(attempt, "strip"))) throw new Error("the $1,500 attempt was not blocked with AuthorityExceeded");
const jevOnLever = Boolean(notes.leverJev?.visibleFrom);

// ── framing helpers. All rects are in the recorded viewport (1920x1080), at the scroll the take measured.
const box = (x: number, y: number, w: number): Rect => ({ x, y, w, h: (w * 9) / 16 });
const FULL: Rect = { x: 0, y: 0, w: 1920, h: 1080 };
const APP = box(300, 0, 1320); // the app column, edge to edge
const STRIP = box(300, 30, 1320);
const LIVE = "Live · releash.robbyn.xyz · Robinhood Chain testnet";

export const SHOTS: Shot[] = [
  { id: "cold", kind: "card", card: "ColdOpen", min: 8, cues: ["This is the Chainlink NVDA price feed on Robinhood Chain mainnet.", "Stock feeds run 24/5."] },
  { id: "freeze", kind: "card", card: "Freeze", cues: ["On each of the last three weekends it was silent for 52 hours,", "and for 78 hours over Labor Day."] },
  { id: "weekend", kind: "card", card: "Weekend", min: 8, cues: ["Borrow against tokenized NVDA and log off on Friday,", "and nobody is watching your loan when Monday opens with a gap."] },
  { id: "title", kind: "card", card: "Title", cues: ["Releash: auto-deleverage for stock-backed loans on Robinhood Chain."] },
  {
    id: "hero", kind: "footage", clip: "hero", live: LIVE,
    // The landing page, held on the hero copy. The take's later scroll to the app is not used: this read-only
    // capture ran during the main take, so the app below the hero shows a later state than the next shots.
    parts: [{ from: 0, len: 5.8, cam: [FULL, box(60, 40, 1800)], camAt: [0.2, 5.8] }, { still: true, from: 5.8, cam: box(60, 40, 1800) }],
    cues: ["Your agent can always make the loan safer.", "It can only add debt while you keep proving you are still there."],
  },
  {
    id: "intro", kind: "footage", clip: "intro", live: LIVE,
    parts: [{ from: 0, cam: [APP, STRIP], camAt: [0.3, 1.8] }],
    cues: ["Alice has a Releash agent.", "The control borrower holds the same 100 NVDA, with no agent."],
  },
  {
    id: "renew", kind: "footage", clip: "renew", live: LIVE,
    parts: [
      // Held frame before the click: the meter is empty and waiting, nothing on screen is moving.
      { still: true, from: 1.85, len: 3.6, cam: [APP, box(400, 377, 1240)], camAt: [0.3, 1.6] },
      // The page scrolled to the Renew button at 1.93 s; play from just after, the click lands at 2.5 s.
      { from: 2.0, len: 6.6, cam: box(400, 60, 1240) },
      { src: "capture/lever.mp4", from: 0, cam: [box(400, 60, 1240), box(1130, 70, 560)], camAt: [1.4, 2.8] },
    ],
    cues: [
      "Alice's mandate lets the agent lever her up to 9,500 USDG,",
      "but only after World ID proves a human is present.",
      "Here World ID runs in simulator mode.",
      { text: `Within seconds the agent borrows $${borrowed}.`, at: 11.9 },
      ...(jevOnLever ? [{ text: "Jev, TypeSafe's decision model, picks from the contract's fixed menu of actions.", at: 10.2 + 5.1 }] : []),
      "The USDG goes to Alice, never the agent.",
    ],
  },
  {
    id: "attempt", kind: "footage", clip: "attempt", live: LIVE, hold: 2,
    parts: [{ from: 1.2, cam: [APP, box(780, 300, 860)], camAt: [5.8, 7.2] }],
    cues: ["Now it tries to borrow 1,500 more.", "The vault checks debt against authority at this block,", "and the transaction reverts on-chain."],
  },
  {
    id: "decay", kind: "footage", clip: "decay", live: LIVE,
    parts: [
      { from: 0, len: 4.5, cam: box(560, 380, 820) },
      { from: 62, skip: "60 s later", cam: box(560, 380, 820) },
    ],
    cues: ["Alice goes offline.", "Every two minutes here, daily in production, the ceiling halves.", "Nothing expires. It just cannot add debt."],
  },
  {
    id: "close", kind: "footage", clip: "close", live: LIVE,
    parts: [
      { from: 1.0, len: 5.5, cam: [APP, box(300, 0, 1000)], camAt: [2.2, 3.4] },
      { from: 15.5, skip: "10 s later", cam: [box(900, 80, 900), box(1060, 330, 720)], camAt: [1.4, 2.8] },
    ],
    cues: [
      "Friday close: the price freezes.",
      "Alice's mandate caps her weekend LTV, and its rules can override the model.",
      `So the agent repays ${closePct}% of the debt by selling collateral.`,
      "Reducing risk needs no authority.",
    ],
  },
  {
    id: "gap", kind: "footage", clip: "gap", live: LIVE, hold: 2,
    parts: [
      { from: 1.0, len: 2.6, cam: APP },
      { from: 46.4, skip: "44 s later", cam: [STRIP, box(870, 0, 800)], camAt: [7.4, 8.8] },
    ],
    cues: [
      "Monday opens 35% lower.",
      { text: `The control borrower is liquidated and loses ${lost} rNVDA.`, at: 4.5 },
      "Alice is still safe.",
      `Same stock, same gap: Releash kept over $${deltaFloor.toLocaleString("en-US")} more equity.`,
    ],
  },
  {
    id: "revoke", kind: "footage", clip: "revoke", live: LIVE,
    parts: [
      { from: 1.6, len: 2.8, cam: APP },
      { from: 24.2, len: 2.8, skip: "20 s later", cam: box(660, 50, 960) },
      { src: "capture/revokedAttempt.mp4", from: 1.8, skip: "6 s later", cam: [APP, box(780, 330, 860)], camAt: [3.4, 4.6] },
    ],
    cues: [
      "Alice revokes the agent.",
      `It can still deleverage, and trims another ${trimPct}%,`,
      { text: "but borrowing now reverts.", at: 10.2 },
      "Close always. Open only while you're alive.",
    ],
  },
  {
    id: "contract", kind: "card", card: "Contract", min: 9,
    cues: ["No owner, no admin, no upgrade path.", "41 tests; invariants checked against deliberately broken contracts.", "An adversarial review's two signature-replay bugs are fixed, with regression tests."],
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

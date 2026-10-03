# Releash: UI/UX audit of the hosted app

Audited 4 Oct 2026 against https://releash.robbyn.xyz and https://releash.robbyn.xyz/?demo=1, by reading the screens only. No demo button was pressed. Screenshots are mine, taken with Playwright at 1440, 1280 and 375 (DPR 2) and stored in `docs/ui-audit/`. I also used the repo's rehearsal frames (`web/rehearsal/03-*.png`, `07-*.png`) for the live and post-gap states, which an audit-only pass cannot produce.

Method: ui-ux-pro-max's priority order (accessibility, interaction, layout, typography and colour, motion, forms and feedback, data), plus impeccable's slop and anti-pattern lens. The owner's verdict was "terlalu slop" (too generic, reads as AI-made). That verdict holds, so most of this document is a redesign direction (§3). §2 lists the fixes that are worth making even if the redesign never ships.

One telling detail: I ran ui-ux-pro-max's design-system generator on "fintech lending risk dashboard". It recommended "Dark Mode (OLED), dark bg + green positive indicators, Fira Code headings", which is almost exactly what ships today. The current UI is the default answer, and that is the problem.

---

## 1. Score

| Area | /10 | One-line reason |
|---|---|---|
| First 10 s comprehension | 4 | On the landing page the slogan is clear. On `?demo=1`, the URL judges get, it is missing entirely (`App.tsx`: `{!demo && <Hero />}`). On both, the "alive" half shows a grey `$0.00` over an invisible track. |
| Visual hierarchy | 5 | Three equal columns compete. The one idea that matters (authority decays, debt cannot follow it up) is a 18 px bar in the middle column. |
| Information density | 4 | Each agent feed row is 5 to 7 lines because of a `Jev: hold 88%, borrow_more 11% …` dump. The mandate form and Fire/Revoke share the hero panel with the hero metric. |
| Accessibility | 6 | The focus ring is correct (2 px green, every control). `prefers-reduced-motion` is handled globally. The meter track (1.07:1) and ticks (1.45:1) fail non-text contrast. `--dim` text is 3.0 to 3.4:1 at 11 to 12 px. Most buttons are 34 px tall. |
| Typography and spacing | 5 | One sans plus JetBrains Mono on every number, including prose numbers. Small uppercase tracked labels appear in about 8 places. There is no type scale: sizes 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 22, 26, 28, 30, 34, and clamp(40 to 64). |
| Colour semantics | 5 | Green, amber and red are mostly consistent on LTV. They are inverted on authority: "Can add debt: $0.00" is red with a ×, but zero borrowing room is the safe state this product sells. |
| Empty, loading and error states | 6 | Better than most hackathon UIs: there are RPC-down, backend-down, feed-offline and not-configured branches. But the idle state is the screen every judge lands on, and it looks broken. |
| Mobile (375) | 5 | No horizontal scroll. The header uses 275 of 812 px. "OPEN" appears twice. The feed is about 4,000 px below the demo buttons. |
| Copy clarity | 6 | The hero copy is good. The panel and the feed contradict each other ("Waiting for World ID" vs "Authority has decayed to zero"). "Jev" is never explained. |
| Trust signals | 7 | Contracts show live Blockscout "verified" tags, every feed row links its transaction, and mainnet targets are listed. The links are rendered in the least legible colour on the page. |
| Originality (slop) | 2 | See §3.1. |
| **Overall** | **50 / 100** | It works and it is honest. It looks like every dark DeFi dashboard of 2024. |

---

## 2. Findings: P0 and P1 (about 90 min, ordered by impact per minute)

Screenshot references: `docs/ui-audit/<name>.png`.

### P0: breaks the demo or comprehension

**P0-1. The thesis is missing on `?demo=1`. 10 min.**
- Where: `web/src/App.tsx` (`{!demo && <Hero />}`), `DemoStrip.tsx` `.demostrip__market`. Screenshots `demo-1440-fold.png`, `demo-1280-full.png`.
- What's wrong: a judge given the demo link never reads "Close always. Open only while you're alive." The strip's left column spends 170 px repeating "DEMO · MARKET OPEN rNVDA $181.30", which the header pill already shows.
- Fix: replace the `.demostrip__market` contents with the thesis. Put `<p className="thesis">Close always.<br/><span>Open only while you're alive.</span></p>` at 22/1.1, weight 800, with the span in `--muted`, followed by the existing market state as a one-line subtitle. Do NOT reuse `id="hero-h"`, because `video/scripts/hero.mjs` reads it on the landing page only.

**P0-2. The idle authority panel looks broken. 20 min.**
- Where: `AuthorityPanel.tsx`, `.meter__track` / `.meter__tick` in `styles.css` lines 168–172. Screenshot `home-1440-fold.png`, centre column.
- What's wrong: the page's biggest element is a grey `$0.00`. The track is `--surface-2` on `--surface` at **1.07:1**, so it is invisible (WCAG 1.4.11 needs 3:1). The ½ ¼ ⅛ tick labels are 11 px `--dim` and render as "%" smudges. A white "debt" marker floats at 84% of a bar nobody can see. The only thing that explains "alive" is the caption.
- Fix:
  1. Give the track `box-shadow: inset 0 0 0 1px #5f6863` (3.2:1).
  2. When `phase !== "live"`, draw a dashed "potential" outline across the whole track: `.meter__ghost { position:absolute; inset:0; border:1px dashed var(--green); border-radius:6px; opacity:.6 }`.
  3. Change the caption for `unrenewed` to: "Renew to give the agent up to {fmtUsd(base)} of borrowing room. It halves every {half-life}."
  4. Raise tick labels to 12 px `--muted`, and label them with values (`$4,750`) instead of glyphs.
  5. Keep `authority-value` text exactly `$0.00`, because both `rehearsal.mjs` and `hero.mjs` compare it.

**P0-3. The panel and the feed contradict each other. 5 min.**
- Where: `agent/src/agent.ts:121`. Screenshot `home-1440-fold.png`: the panel says "Waiting for World ID", the first feed row says "Authority has decayed to zero".
- What's wrong: two reasons for one state, on one screen. A judge cannot tell whether the system is waiting or expired.
- Fix: branch on `s.lastRenewed === 0n` and return "No World ID renewal yet: I may only reduce risk." Keep the "decayed" text for the real decay case.

### P1: judges will notice

**P1-1. The "Can add debt: $0.00" row is red, so the safe state reads as an error. 5 min.**
- Where: `AuthorityPanel.tsx` `.asym__row--no`, `styles.css` lines 186–187.
- What's wrong: red × plus a red figure means "failure" in every fintech UI. Here it is the default and correct posture ("open only while alive").
- Fix: for `phase !== "live"`, use a neutral style. Mark `−` in `--muted` on `--surface-2`, figure in `--text`. Copy: "Can add debt: $0.00. Locked until a human renews." Keep red only for `Blocked on-chain` and for liquidation.

**P1-2. Model jargon floods the feed. 10 min.**
- Where: `Feed.tsx` `fromAgent`. Screenshot `home-1440-full.png`, right column.
- What's wrong: every agent row carries `Jev: hold 88%, borrow_more 11%, deleverage_30 1%, deleverage_10 0% (confidence 84%)`. That is four lines of snake_case, and "Jev" is never explained. Judges skim the feed for one thing: what did it do, and did the contract stop it.
- Fix: split `e.reason` on `/ Jev: /`. Show the human half as `.feed__detail`. Render the model half as a single `.feed__model` line ("model: hold 88% · conf 84%") at 12 px `--muted`, with the full text in `title`. Feed regexes the drivers rely on match titles, not details, so they are safe.

**P1-3. Trust links are in the least legible colour on the page. 3 min.**
- Where: `styles.css` `--dim: #5f6863`, used by `.feed__meta a`, `.feed__item time`, `.foot`, `.gauge__scale`, `.meter__tick span`, `.weekend__day`.
- What's wrong: **3.41:1** on bg, **3.22** on surface, **3.02** on surface-2, all at 11 to 12 px. That fails AA 4.5:1. The tx hashes are the proof that it is on-chain.
- Fix: set `--dim: #808a84`, which gives 5.50 / 5.19 / 4.88. Underline tx links on hover only, and add `↗` after them.

**P1-4. Demo-reset debris reads as history. 10 min.**
- Where: `Feed.tsx`. Screenshot `home-1440-full.png`, which shows "Fired agent 0xf585…" → "Mandate set" → "You borrowed $4,849.41" → "Deposited 37.2285 rNVDA".
- What's wrong: a fresh visitor's first on-chain events say the user *fired the agent* and borrowed an odd amount. That is plumbing from `Reset demo`, but it reads like a story.
- Fix: find the latest `MandateSet`. Render everything older inside `<details className="feed__older"><summary>Earlier runs ({n})</summary>…</details>`. `.feed__item` stays on the visible rows, so `rehearsal.mjs` `feedTexts()` still sees new lines.

**P1-5. A disabled dead button sits under the main call to action. 5 min.**
- Where: `RenewWorldId.tsx` `.renew__real`. Screenshot `home-1440-full.png`.
- What's wrong: a 40%-opacity "Real World App flow" pill-button next to "Implemented, not enabled" looks like a bug, and it is a tab stop that does nothing.
- Fix: delete the button. Keep one line of text: "Simulated proof. The real World App flow is built (RenewWorldId.tsx) but off on this deployment." Link the file on GitHub.

**P1-6. Touch targets are 34 px. 5 min.**
- Where: `.btn--sm` (`padding: 6px 12px` gives 34 px), `.seg button` (34), `.link` "max" (33×20), tx links (16 px tall).
- What's wrong: there are 92 to 98 interactive elements under 44 px on every page, including Disconnect, all 4 demo buttons, and the Deposit/Borrow tabs.
- Fix: `@media (pointer: coarse) { .btn--sm, .seg button { min-height: 44px } .link { padding: 12px 8px } }`. Desktop density stays unchanged.

**P1-7. The feed is clipped mid-row with no affordance. 5 min.**
- Where: `.feed { max-height: calc(100vh - 110px) }` and `.feed__list { overflow-y:auto }`. Screenshot `home-1440-full.png`: the last row is cut through "AGENT 0xd867…".
- Fix: add `.feed__list { mask-image: linear-gradient(#000 calc(100% - 40px), transparent) }`, and `overscroll-behavior: contain`.

**P0 + P1 total: 78 min.**

### P2: polish (do these only inside the §3 redesign)

- **Header at 375 px** (`home-375-fold.png`): the wordmark sits alone on row 1, the account chips on row 2, the market on row 3, and the header ends at 275 px. Fix: hide `.addr` and `tag--demo` under 480 px, and put the market inline as a dot plus "OPEN".
- **"OPEN" appears twice on mobile demo** (`demo-375-fold.png`): the header pill plus the strip's 34 px green "OPEN".
- **Feed is about 4,000 px below the demo buttons at 375.** At ≤720 px, `.col--center { grid-row:1 }` puts authority first, then position, then feed. A judge on a phone presses "Agent tries $1,500" and sees nothing happen. Show the result toast inline (it already exists, `demo-result`) and add the pinned action under it.
- **Control starts with $800 less equity** ($9,330 vs $10,130) because of the 8,800 starting debt (SPEC §7). Judges may read this as rigged. Add a subtitle to the control card: "borrowed 8,800 by hand (same 100 rNVDA)".
- **The `−36.7% from here` line** uses a hyphen-minus in mono. Use `−` (U+2212) and the proportional font.
- **`.seg` uses `role="tablist"`** with no `tabpanel` and no arrow-key handling. Use `role="radiogroup"` with `aria-checked`, or plain buttons with `aria-pressed`.
- **The `.countdown` `aria-label="Next halving"`** has no value. Use `aria-label={`Next halving in ${fmtDuration(countdown)}`}`.
- **`/api/market` intermittently returns 500** (2 of 3 cold loads in my run). `useMarket` has `retry:false`, so on a cold-load failure the header says "MARKET ?" for up to 2 s. Set `retry: 2`, and investigate the backend (likely an RPC 429 behind it).
- **The mandate agent-address input truncates** the address mid-character with no ellipsis. Show `short(agent)` with an Edit affordance.
- **The `.foot` rule is wider than `main`'s content**: `.foot` max-width 1320 includes its padding, `main` adds 24 px gutters.

What is already right and should be kept:
- the focus ring on every control
- the global reduced-motion kill switch
- LTV gauge semantics (50 borrow line, 70 hatched liquidation zone)
- the Blockscout-verified tags
- the decision that the delta card shows no figure until the control is liquidated

---

## 3. De-slop redesign direction

### 3.1 Slop tells, named and located

| # | Tell | Where |
|---|---|---|
| 1 | **Three equal rounded dark cards** as the whole app: `340px / 1fr / 360px`, same `--surface`, same 1px `--line`, same 14px radius, same 20px padding. Nothing is dominant. | `styles.css` `.grid` (l.97), `.panel` (l.98) |
| 2 | **Radius 999 on everything**: buttons, tags, market chip, pills, segmented control, address chip. Every control is the same pill, so none signals its role. | `.btn` l.60, `.tag` l.75, `.market` l.50, `.pill` l.233, `.seg` l.139, `.addr` l.48 |
| 3 | **Green-on-black "crypto dashboard" palette.** `#0a0c0b` bg, `#00c805` green, glow `box-shadow: 0 0 24px rgba(0,200,5,.25)`, gradient fill. | `:root` l.2–15, `.meter__fill` l.169 |
| 4 | **Monospace on every number**, including prose-like ones ("$1,065.00 more at 50%", "−37.0% from here", "Wallet: 0 rNVDA · 44,827.665 USDG", the 64 px hero figure). Mono reads as "terminal", not "money". | `.num` l.36, used in every component |
| 5 | **Small uppercase tracked labels** (`12px / .08em / 600`) in about 8 places: COLLATERAL, DEBT, LTV, LIQUIDATION PRICE, MANDATE, AGENT ADDRESS, EQUITY, TRUST ASSUMPTIONS, NEXT HALVING. | `.label` l.40, `.stats dt` l.107, `.mandate h3`, `.how h3`, `.countdown__label` |
| 6 | **Giant two-tone hero slogan plus a vertical dot timeline** on the right (Fri / Sat–Sun / Mon) with staggered `rise` animation. This is the 2024 landing-page template. | `Hero.tsx`, `.hero h1 span` l.83, `.weekend` l.85–93 |
| 7 | **"Built on Robinhood Chain · USDG · World ID"** as a grey sponsor line under the hero. | `.builton` l.94 |
| 8 | **Green eyebrow above the H1** ("Auto-deleverage for tokenized-stock loans"). | `.eyebrow` l.81 |
| 9 | **The ✓ / × / + circle-bullet "feature list"** inside the hero panel. | `.asym__mark` l.183 |
| 10 | **A dashed placeholder card** that says "Same stock, same market — watch Monday" and holds space for a number. | `.delta:not(.delta--up)` l.314 |
| 11 | **A pulsing green "live" dot** with no label. | `.dot--on` l.204, `.market--open .market__dot` |
| 12 | **The hero metric is a progress bar.** The product's idea is a *function over time* (halving, cliff to zero at 3 half-lives, debt as a ceiling it must not cross). A bar shows one number and hides the shape. | `AuthorityPanel.tsx` `.meter__track` |
| 13 | **A two-tone circular countdown ring** next to a big number. This is a stock "timer" widget. | `.countdown` l.162–167 |
| 14 | **A "How it works" 4-step list plus a 3-column footer** of trust bullets, all at the same weight. | `HowItWorks.tsx`, `.how__grid` |

### 3.2 The concept: "The Leash"

**Point of view.** Releash is a loan document that only stays loose while you're there. The page should read like a quiet, printed risk statement with **one live instrument** on it: the leash. That is a chart of how much debt the agent may bring you to, over time. Everything else is ledger text around it.

Not a dashboard, no cards, no glow. Light paper, black ink, and one colour that means "the agent may still act".

I evaluated the coordinator's example (a live decay curve instead of a bar meter). It is right, with two corrections and one addition:

1. **The curve is not steps.** `web/src/lib/math.ts` `limitAt` and the contract decay **linearly inside each half-life**: from H to H/2, slope −H/(2·HL). Then the slope halves at each period. After 3 half-lives it **drops vertically from base/8 to 0** (`CUTOFF_HALVINGS = 3`). With the demo numbers (9,500 base, 120 s): 9,500 → 4,750 at 2:00 → 2,375 at 4:00 → 1,187.50 at 6:00, then a cliff to $0. The chart must draw exactly that polyline. A curve that disagrees with the contract is a trust bug in a fintech demo.
2. **Renewals as resets** do not need history on the x-axis. Make the x-axis "time since the last World ID renewal" (0 to 6:30). A renewal snaps the cursor back to 0, with a 300 ms ease and none under reduced motion. Past cycles are noise.
3. **Addition, and this is the sharpest idea in the redesign: label the crossing.** Where the authority line falls below the debt line, shade the region beneath debt and above authority with a hatch. Put a label at the crossing point: **"From 0:18 the agent can only make you safer."** That crossing *is* the leash tightening, and it is the product's sentence ("close always, open only while alive") drawn as geometry. It moves as debt moves: when the agent deleverages, the debt line drops and the crossing slides right.

### 3.3 Tokens

Fonts (Google Fonts, one request):

```
https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap
```

- **Newsreader**: the thesis, section titles, and the one hero figure. An editorial serif with optical sizes, so it reads as "statement", not "app".
- **IBM Plex Sans**: all UI and all numbers, with `font-variant-numeric: tabular-nums lining-nums`. ui-ux-pro-max's typography search ranks it first for finance ("Financial Trust").
- **IBM Plex Mono**: **only** addresses and tx hashes. Nothing else is mono.
- Delete Hanken Grotesk and JetBrains Mono.

Colour (light; contrast measured on `--paper`):

```css
:root {
  --paper:  #f6f3ec;  /* page */
  --ink:    #16181a;  /* text, debt line          16.1:1 */
  --muted:  #5c605f;  /* secondary text            5.8:1 */
  --faint:  #8a8d8a;  /* future curve, axis (graphics only, 3.0:1, never text) */
  --rule:   #d9d3c7;  /* hairlines (decorative) */
  --leash:  #0a7d32;  /* the ONE accent: live authority, the Renew button  4.75:1 */
  --leash-wash: rgba(10,125,50,.08);
  --hazard: #c2410c;  /* liquidation line/zone, blocked attempts, liquidated  4.67:1 */
  --hatch:  repeating-linear-gradient(135deg, rgba(22,24,26,.10) 0 1px, transparent 1px 6px);
  color-scheme: light;
  font: 400 16px/1.5 "IBM Plex Sans", system-ui, sans-serif;
}
```

Colour semantics:
- `--leash` (green) means **only** "the agent may still add debt" (the live authority line, the Renew action).
- `--hazard` means **only** liquidation and contract refusals.
- Debt is ink.
- "Can only get safer" is a neutral hatch, deliberately not green and not red: it is the calm default.
- Amber is deleted. The 50% borrow line becomes an ink tick, so the LTV gauge goes ink → hazard only.
- If dark mode is wanted, invert `--paper` and `--ink` and keep the same two accents. Do not add a third.

Type scale (1.25 ratio, 16 base). These are the only sizes allowed:

| Token | px / line-height | Used for |
|---|---|---|
| `--t-display` | Newsreader 56/1.0, 600, opsz 72, -0.02em | the thesis (landing), the hero figure |
| `--t-h1` | Newsreader 36/1.1 | the thesis (demo strip), "Monday" result figure |
| `--t-h2` | Newsreader 24/1.2 | section titles: Position, Agent log, Contracts |
| `--t-lead` | Plex 20/1.45 | lede, chart annotations |
| `--t-body` | Plex 16/1.5 | everything else |
| `--t-small` | Plex 13/1.4, 500 | axis labels, timestamps, meta |

No uppercase tracking anywhere. Labels are sentence case at `--t-small`, `--muted`.

Grid: 12 columns, `max-width: 1200px`, 24 px gutter, 16 px at ≤720. Rhythm in multiples of 8 (8, 16, 24, 48, 96). There is one radius, 4 px, on inputs and buttons only. Sections are separated by `1px var(--rule)` hairlines and 48 px of space. No card backgrounds, no shadows, no glow.

### 3.4 Layout and the four key components

```
┌ 12 col ───────────────────────────────────────────────────────────┐
│ Releash      Market closed · price frozen since Fri 16:00 at $181.30   0x454a…D991 │  ← 56px bar, text only
├───────────────────────────────────────────────────────────────────┤
│ Close always.                              │  [demo only]          │
│ Open only while you're alive.   (7 col)    │  Alice   $10,130 SAFE │
│ lede (1 sentence)                          │  Control  $9,330 SAFE │
│                                            │  → "Releash kept $x"  │  (5 col)
├───────────────────────────────────────────────────────────────────┤
│  THE LEASH (8 col, 360px tall)             │  Ledger (4 col)       │
│  $9,500 ─╲                                 │  Collateral  100 rNVDA│
│           ╲___ $4,750                      │  Debt       $8,798    │
│  debt ━━━━━━╳━━━━━━━━━━━━━  $8,798         │  LTV 44.1% ━━━━│━━▒▒ │
│        "from 0:18 only safer" ▨▨▨▨▨▨▨       │  Liq. price $114.29   │
│  ●now 0:12  $9,012     next halving 1:48   │  [Renew with World ID]│
│  0      2:00      4:00      6:00 ┃cliff    │  Revoke · Fire        │
├───────────────────────────────────────────────────────────────────┤
│ Agent log (full width, ruled table)                                │
│ 13:55:37  Borrowed $798.44   LTV 44.6%, room left   0x55c4…f3e5 ↗  │
│ 13:56:16  Blocked by contract: AuthorityExceeded     0xd867…f66b ↗  │ ← hazard text, no fill
├───────────────────────────────────────────────────────────────────┤
│ How it is enforced · Contracts (verified) · Mainnet targets         │
└───────────────────────────────────────────────────────────────────┘
```

At ≤720 everything stacks in this order: thesis → (demo comparison) → Leash (240 px tall) → ledger → log. The log sits right after the controls, so a phone judge sees the effect of a press.

**1. The Leash chart** (`AuthorityPanel.tsx`; replaces `.meter`, `.countdown`, `.asym`). Inline SVG, about 120 lines, no chart library. `viewBox="0 0 800 360"`. The x domain is `[0, 3.25·HL]` and the y domain is `[0, max(base, debt)·1.08]`.
- **Future path**: the full `limitAt` polyline from 0 to 3·HL, plus a vertical segment to 0 at 3·HL. 1.5 px, `--faint`, dashed `4 4`.
- **Elapsed path**: the same polyline from 0 to `elapsed`, 2.5 px, `--leash`. Under it, a `--leash-wash` area fill, only between the curve and the debt line where authority > debt ("room the agent has").
- **Debt line**: horizontal at `debt`, 1.5 px `--ink`, right-aligned label "debt $8,798".
- **Hatch region**: where authority < debt, fill between the debt line and the curve with `--hatch`. Label the crossing x with a 1 px ink tick and the annotation "From {t} the agent can only make you safer" (`--t-lead`, Newsreader italic 20).
- **Now cursor**: a 1 px ink vertical at `elapsed`, an 8 px dot on the curve, and a label above it holding **the hero number**. That label is `<span data-testid="authority-value">` in Newsreader `--t-display` with tabular figures. Under it: "may still borrow up to {canAdd}" (`data-testid="can-add"`).
- **Countdown**: plain text at the top right, `<div class="countdown">1:48 <span>to next halving</span></div>`. No ring.
- **Axis**: half-life marks at 2:00, 4:00 and 6:00 with value labels ($4,750 / $2,375 / $1,187), and "cliff to $0" at 6:00 in `--muted` 13 px.
- **Idle states** (the screen every judge lands on, so design it first):
  - `unrenewed`: draw the full future path dashed in `--faint`, plus the debt line. The cursor sits at x=0, y=0. The label reads `$0.00` and the annotation reads "Renew to give the agent up to $9,500. It halves every 2:00 and reaches zero at 6:00." The picture shows what renewing *would* buy, not an empty bar.
  - `decayed`: the full path solid `--faint`, the cursor past the cliff, the annotation "Nobody renewed for 6:00. The agent may only reduce risk."
  - `revoked`: no curve, a flat ink line at $0 across the whole width, and "Revoked. The agent can still deleverage, never borrow."
  - `none`: the axis only, and "Appoint an agent below."
- **Motion**: the cursor moves via `requestAnimationFrame` with no CSS transition. On renewal, a 300 ms ease of the cursor back to x=0. Both are skipped under `prefers-reduced-motion`.

**2. Ledger column** (`PositionCard.tsx` plus the controls from `AuthorityPanel`). A `<dl>` with hairline rows: label left in `--muted` 16, value right in Plex tabular 16/600. Then the LTV gauge: 6 px tall, ink fill, a hazard hatch from 70 to 100, ink tick at 50, no amber. Then the action:
- **Renew with World ID (simulated)**: full-width, 48 px, `--leash` bg, white text, 4 px radius. It is the only filled button on the page.
- **Revoke** and **Fire**: text buttons in a row under it. Revoke in ink, Fire in hazard, both underlined on hover, with 44 px hit areas. Each has its one-line consequence underneath in `--t-small`.
- The mandate form and the deposit/borrow/repay/withdraw/faucet controls go behind a `<details><summary>Manage position and mandate</summary>`. A judge needs none of them, and they are a third of today's pixels.

**3. Agent log** (`Feed.tsx`). A full-width ruled table instead of a sticky card. Columns: time (13 px muted) | what happened (16 px ink; `Blocked by contract: …` in `--hazard` text with no tinted background) | why (the human half of the reason, 16 px muted) | effect ("Debt now $8,798", tabular) | tx (Plex Mono 13 with ↗). The model probabilities go in a `title` tooltip. Show the newest 12 rows plus "Show earlier (n)". The pinned "latest agent action" becomes simply the first row, set at `--t-lead` for 5 s after it lands.

**4. Demo comparison** (`DemoStrip.tsx`, `?demo=1` only). Two ledger lines, not cards:
- `Alice, with Releash ........ $10,130.00   SAFE`
- `Control, no agent ......... $9,330.00   SAFE`

Below them, the result slot. Before the gap it is one muted sentence: "Same stock, same −35% Monday. Watch the bottom line." After the gap it becomes Newsreader `--t-h1` "Releash kept **$1,907.62** more equity" in `--leash`. LIQUIDATED is set in `--hazard` small caps, with no filled pill. The four demo buttons sit in a row in 13 px Plex, 4 px radius, ink outline, 44 px tall. Their result line stays where it is today.

### 3.5 Delete

- **Delete outright:**
  - the `.weekend` timeline
  - `.eyebrow`
  - `.builton` (move "Robinhood Chain · World ID" into the footer)
  - the "How it works" 4-step list (the chart replaces it)
  - `.asym` ✓/× rows
  - the countdown ring SVG
  - `.meter__fill` gradient and glow
  - the dashed `.delta` placeholder
  - the pulsing dots
  - `.tag--demo` "DEMO ACCOUNT" chip (fold it into the header as text: "Demo account 0x454a…D991")
  - the disabled "Real World App flow" button
  - the `.panel` card chrome, the 999 radius, all uppercase-tracked labels
  - Hanken Grotesk, JetBrains Mono, amber
- **Keep:** the trust content (contracts with verified tags, mainnet targets, "backend cannot move funds"). Restyle it as one 3-column hairline table at the bottom.

### 3.6 Driver contract: what the redesign must not break

From `web/rehearsal/rehearsal.mjs`, `video/scripts/take.mjs`, `video/scripts/hero.mjs` and `video/scripts/reset.mjs`.

**Test ids. Keep all of them, on elements of the same meaning:**
`address`, `market`, `use-demo`, `authority-meter`, `authority-value`, `can-add`, `simulate`, `renew`, `real-flow-note`, `revoke`, `fire`, `set-mandate`, `agent-input`, `base-input`, `amount`, `submit-action`, `faucet`, `feed`, `feed-pinned`, `side-releash`, `side-control`, `equity-*`, `lost-*`, `equity-delta`, `demo-close`, `demo-gap`, `demo-attempt`, `demo-reset`, `demo-result`.

**Text and attribute invariants the drivers assert:**
- `authority-value` innerText is exactly `fmtUsd(...)`. It is `$0.00` when not live (rehearsal beat 2 and `hero.mjs` both compare it), and it must change second to second while live.
- `equity-delta` must contain **no `$`** before the gap (rehearsal Friday beat throws otherwise) and must match `/Releash kept \$/` after it. The proposed waiting sentence has no `$`.
- `.pill` must exist **inside** `side-releash` and `side-control`, with innerText `SAFE` / `LIQUIDATED` / `LIQUIDATABLE`. Keep the class even if it is restyled as text.
- `side-control` must contain a first `<a>` whose href contains `/address/` (the control owner is read from it).
- `demo-result` must keep `data-pending="1"` while busy, and its result texts: `Demo reset`, `Market closed`, `gapped`, `Blocked on-chain: AuthorityExceeded`.
- `.feed__item` must stay the class of each log row. Rows must keep the title texts `Agent borrowed`, `Agent deleveraged 10%/30%` (`/deleveraged 30%/`, `/[Dd]eleveraged/`) and `Blocked on-chain: AuthorityExceeded`. Use "Blocked on-chain:" not "Blocked by contract:" in the title, or update the regexes in the same commit.
- `.renew .txstatus--ok` and `.mandate .txstatus--ok`: `TxStatus` must stay nested inside an element with class `renew` (World ID) and `mandate` (Revoke/Fire). If Revoke moves into the ledger, wrap that block in `.mandate`.
- `.countdown` must exist while live, and its innerText holds the time (`take.mjs` samples it).
- `#hero-h` on `/` must contain "Close always". `.grid` must exist (`hero.mjs` scrolls to it).
- `section.authority`, `section.feed` and `section.demostrip` are measured for the video's zoom rects (`take.mjs rects()`).
- localStorage keys `releash.demoActors` and `releash.mode`.

**Geometry:** the drivers' `click()` centres each button and fails if `elementFromPoint` hits anything else. So add **no sticky or fixed layer over controls**: the chart must not be sticky, and the header must stay the only sticky element. Any `<details>` that hides `amount` / `faucet` / `set-mandate` is fine for the drivers, which never press those, but `revoke` must stay visible without opening anything.

**Video:** every layout change invalidates `video/marks/*.json` and `video/stills/`. The Remotion cut must be re-captured after the redesign.

### 3.7 Estimate and order (one engineer)

| # | Step | Min |
|---|---|---|
| 1 | Tokens, fonts and type scale in `styles.css`; delete card chrome, pills, uppercase labels and amber | 25 |
| 2 | Leash chart (SVG, `limitAt` polyline, debt line, hatch and crossing label, cursor, 4 idle states), keeping `authority-meter` / `authority-value` / `can-add` / `.countdown` | 60 |
| 3 | 7/5 then 8/4 asymmetric layout; ledger column; Renew/Revoke/Fire; `<details>` for manage | 25 |
| 4 | Agent log as a ruled table, model text split, older-runs collapse (absorbs P1-2 and P1-4) | 20 |
| 5 | Demo comparison as ledger lines plus the result slot, thesis on `?demo=1` (absorbs P0-1) | 15 |
| 6 | 375 pass (header, stack order, 44 px targets) and a contrast spot-check | 15 |
| 7 | Run `rehearsal.mjs` once end to end against the hosted build (Reset first), then fix whatever fails | 20 |
| | **Total** | **≈ 180 min** |

Re-capturing the video (`take.mjs` + `hero.mjs` + Remotion render) is **not** in the 3 h. Budget another 45 to 60 min, or ship the redesign only if that time exists before submission.

If 3 h is not available: do §2 (78 min) and step 2 alone (the chart, 60 min). The chart is where the product's idea becomes visible, and it replaces the most generic element on the page.

# Releash — app brief for mockups

What the app is, who looks at it, and every element and state the screen must hold. It deliberately says nothing about visual style; that is yours to decide.

---

## 1. The product in three sentences

Releash protects a loan backed by tokenized stock (rNVDA) on Robinhood Chain. An AI agent watches the loan and may **always** make it safer (repay part of the debt by selling some stock), but it may only **add** debt up to a ceiling that halves every half-life unless the owner proves, with World ID, that they are still around. If the owner disappears over a weekend, the position can only get safer, so a Monday price gap doesn't liquidate it.

**Tagline:** "Close always. Open only while you're alive."
**One-liner:** Auto-deleverage for stock-backed loans on Robinhood Chain.

## 2. Who looks at the screen, and what they must get

| Viewer | Context | Must understand within ~10 seconds |
| --- | --- | --- |
| Hackathon judge (primary) | Opens the link cold or watches a 3-minute video. Knows DeFi, doesn't know the product. | (1) There is a loan. (2) An agent has two powers: reduce risk (always on) and add debt (decaying). (3) The add-debt power is shrinking right now, and renewing it takes a human. (4) Proof: next to it, a position without Releash gets liquidated. |
| Borrower (the persona "Alice") | Owns the position. | How safe am I, what can my agent do right now, how long until its power halves, what did it just do and why. |

The single idea to visualise is the **asymmetry**: one power that never fades, one that fades over time. Today that is a horizontal bar plus two text rows, and it reads as a generic progress bar.

## 3. Layout today (one page)

1. **Header:** wordmark, market badge, account.
2. **Demo strip** (only with `?demo=1`): Alice vs Control side by side, plus the demo buttons.
3. **Three columns:** Your position · Agent authority · Agent feed.
4. **Hero / intro:** tagline and the Friday→Monday story. It currently sits above the app when the strip is hidden.
5. **How it works**, trust assumptions, contract list, footer.

Order and grouping are free to change. What must stay is **every element below**.

## 4. Elements, with real sample values

All values come from the live run on Robinhood testnet. The UI polls the chain every 1–2 s, and the authority figure is interpolated so it ticks smoothly.

### 4.1 Header
- **Wordmark:** "Releash".
- **Market badge:** `OPEN` or `WEEKEND`.
  - OPEN shows the price: "rNVDA $180.00".
  - WEEKEND reads "price frozen since Fri 16:00 (3m) at $180.00".
  - Unknown state: "MARKET ?".
- **Account:** "DEMO ACCOUNT" tag, short address `0x454a…D991`, and Disconnect. Also the variants "Connect wallet" and wrong-network.

### 4.2 Your position (Alice)
| Field | Sample | Notes |
| --- | --- | --- |
| Collateral | 100 rNVDA · $18,000.00 | Stock amount and its dollar value. |
| Debt | 8,000.00 USDG | Under it: "$1,000.00 more at 50%" (headroom to the borrow limit). |
| LTV | 44.5% | Gauge from 0 to 100 with two markers: **borrow limit 50%** and **liquidation 70%**. Green under 50, amber 50–70, red above 70. |
| Liquidation price | $114.29 · "−36.5% from here" | |
| Actions | Deposit / Borrow / Repay / Withdraw | Inline form: amount, "max", submit. |
| Faucet | "100 rNVDA + 10k USDG" | Testnet only. |
| Wallet line | "Wallet: 0 rNVDA · 0 USDG" | |

### 4.3 Agent authority (the core element)
| Field | Sample | Notes |
| --- | --- | --- |
| Authority now | **$9,223.00**, decaying live | "Max debt the agent may bring you to · of $9,500.00 at full strength". Drains about $40/s just after a renewal in the demo. |
| Next halving | countdown `1:34`, as a ring today | The demo half-life is 2:00. It hits zero after 3 half-lives (6:00). |
| Halving marks | ½ · ¼ · ⅛ of the base | |
| Current debt | a marker on the same scale | **Key relation:** the agent can add debt only while authority > debt. The gap between them is "Can add debt: $1,223". |
| Since renewal | "Renewed 1:55 ago with World ID" | |
| Power 1 | ✓ **Can always reduce risk.** "Deleverage 10% or 30% at any time. Survives revoke and decay." | Never changes. |
| Power 2 | **Can add debt: up to $X** | Shrinks to $0. |
| Primary action | **Renew with World ID (simulated)** | Restarts the clock and refills the authority. |
| Secondary | "Real World App flow — implemented, not enabled on this deployment" | Disabled. |
| Mandate form | Agent address · Authority ceiling (USDG), default 9,500 · "Appoint agent" | |
| Revoke | "Agent stops adding debt, instantly. It can still deleverage you." | |
| Fire | "Removes the agent entirely, including its right to deleverage." | Destructive. |

**Authority states, all of which need a design:**
1. No agent appointed: "Appoint an agent and give it a debt ceiling below."
2. Waiting for World ID: agent set, never renewed, authority $0.
3. Live and decaying: the normal case.
4. Decayed to zero: "Renew with World ID to restore it."
5. Revoked: add-debt is off, reduce-risk is still on.
6. Renew pending: wallet and chain confirmation in progress.

### 4.4 Agent feed
A reverse-chronological list of what the agent decided and what happened on-chain. Every entry has a time, a title, a one-line reason, and a source tag with a transaction link.

| Entry type | Sample title | Sample reason / detail | Source tag |
| --- | --- | --- | --- |
| Borrow | Agent borrowed $820.00 | "Market open and calm; within authority." Jev probabilities: borrow_more 63% · hold 31% · … | `JEV` · tx link |
| Blocked (red) | Blocked on-chain: AuthorityExceeded | "Agent: borrow $1,500.00." Args: 10,320 > 9,222.9 | AGENT · tx link |
| Deleverage 30% | Agent deleveraged 30% | "Market is closed for the weekend and LTV 46.6% is above your weekend limit of 45.0%. Sold 13.36 rNVDA, repaid $2,381.40." | MANDATE · tx link |
| Deleverage 10% | Agent deleveraged 10% | "LTV 58.4% is above the 55% line; trimming 10% without asking the model." | GUARD · tx link |
| Hold | Agent holds | "LTV 46.6%, authority 8,035 vs debt 7,938; nothing to do." | JEV / RULES, muted |
| Skipped | Agent: deleverage 10% (skipped) | cooldown | grey |
| On-chain events | Renewed · Mandate set · Revoked · Fired · Liquidated | | ON-CHAIN · tx link |

- **Pinned card** above the list: "Latest agent action". It only shows borrow, deleverage or blocked entries, never holds.
- **Empty states:**
  - "Nothing yet. Decisions and on-chain events appear here as they happen."
  - "Agent log offline. Showing on-chain events only."
- **Decision sources:** `JEV` (the model), `CLAUDE` (fallback model), `GUARD` (deterministic LTV rule), `MANDATE` (the owner's weekend rule), `RULES`. Show the true source honestly; never imply the model decided a rule's action.

### 4.5 Demo strip (`?demo=1`): the proof
Two positions with the same stock and the same market. One has Releash, one doesn't.

| | Alice · with Releash | Control · no agent |
| --- | --- | --- |
| Address | 0x454a…D991 | 0x3C6D…1603 |
| Status badge | SAFE | SAFE → **LIQUIDATED** |
| Equity (big number) | $4,558.62 | $2,651.00 |
| LTV gauge | 55.8% | 62.6% |
| Collateral · debt | 86.55 rNVDA · $5,543.02 debt | 60.34 rNVDA · $4,400.00 debt |
| After liquidation | — | "Lost to liquidation: 39.59 rNVDA" |

- **Middle column:**
  - Before the control is liquidated it shows only "Same stock, same market — watch Monday" (no number).
  - After the liquidation: **"Releash kept $1,907.62 more equity"**. This is the money shot.
- **Market column:** "DEMO · MARKET", OPEN/WEEKEND, and the price.
- **Buttons:**
  - **Friday close**: market goes to WEEKEND and the price freezes.
  - **Monday gap −35%**: the price gaps down.
  - **Agent tries $1,500**: the agent attempts a borrow beyond its authority, and the contract blocks it.
  - **Reset demo**: takes up to about a minute; shows an elapsed-seconds counter.
- Each button shows its result inline (for example "Monday open: price gapped −35%." or a tx link). Buttons are disabled while a call is pending.
- **Note:** "Shared demo account — anyone can press these. Press Reset demo first (~1 min) for a clean run."

### 4.6 Story / how it works (static)
1. **Fri 16:00 — Market closes.** The stock stops trading. The on-chain price freezes; your loan doesn't.
2. **Sat–Sun — You're offline.** News breaks. Nobody can trade the stock, nobody watches your position.
3. **Mon 09:30 — Gap down −35%.** Without Releash, liquidated at the open. With it, the agent de-risked on Friday.

**How it works:**
1. **Deposit and borrow.** Lock tokenized stock and borrow USDG up to 50% LTV. Liquidation starts above 70%.
2. **Hand an agent a mandate.** It may add debt up to a ceiling you set. That ceiling halves every half-life and hits zero after three, unless you renew.
3. **Renew by being there.** A World ID proof restarts the clock. Go quiet for the weekend and the agent can only make you safer.
4. **The contract is the last guard.** The model picks from a fixed menu; anything beyond its authority reverts on-chain.

**Evidence worth showing:** the real Chainlink NVDA/USD feed on Robinhood Chain mainnet went **52 h** without an update on each of the last three weekends and **78 h** over Labor Day. Its heartbeat is 24 h.

**Trust and contracts block:**
- "Our backend checks the World ID proof and signs a one-time renewal. It cannot move funds."
- "World ID proves a unique, present human — it is not KYC."
- Testnet mocks, with the mainnet integration targets listed: USDG `0x5fc5…d168`, NVDA token `0xd060…9EEc`, Chainlink NVDA/USD `0x379E…9F15`.
- Contracts on Robinhood Chain testnet, each with a VERIFIED badge and an explorer link:
  - ReleashVault `0xD346…5D50`
  - USDG (mock)
  - rNVDA (mock)
  - NVDA/USD feed (mock)
  - rNVDA/USDG pool (mock)
- "No admin can move a position. Deleverage never depends on authority."

## 5. The demo sequence the screen has to carry (about 3 minutes)

1. Reset done: Alice holds 100 rNVDA, owes 8,000, mandate 9,500, not renewed. Authority $0, "Waiting for World ID".
2. **Renew with World ID (simulated)**: the authority fills to about $9,250 and starts draining.
3. About 4 s later the agent borrows $820 (debt 8,820). The feed shows the line with Jev's probabilities.
4. **Agent tries $1,500**: blocked on-chain, `AuthorityExceeded`, shown in red.
5. About 60 s pass and the authority visibly drains, roughly $8,670 → $6,280.
6. **Friday close**: the badge switches to WEEKEND and the agent deleverages 30% (source MANDATE).
7. **Monday gap −35%**: the price drops to about $117. The control is LIQUIDATED and Alice stays SAFE. "Releash kept $X more equity" appears.
8. **Revoke**: "Can add debt" goes to $0. The agent still trims 10% on its own (source GUARD) about 20 s later.

Moments that need the most visual weight: **the drain (2–5)**, **blocked (4)**, and **SAFE vs LIQUIDATED with the equity difference (7)**.

## 6. Constraints for the mockup

- **Viewports:**
  - Primary desktop: 1440 and 1280 wide.
  - Recording: 1920×1080.
  - Mobile: 375; it must work, but nobody demos on it.
- **Live values:**
  - Numbers that change every second: authority, countdown, prices, LTV.
  - Avoid layouts that jump when a value widens. Use tabular figures.
- **Copy rules:**
  - Don't call World ID KYC.
  - Don't imply the AI "decides" what a rule decided.
  - Mark mocks as mocks.
- **The rehearsal and video driver** (`web/rehearsal/rehearsal.mjs`) finds things by visible text, so keep these labels or tell me the new ones:
  - Buttons: "Friday close", "Monday gap −35%", "Agent tries $1,500", "Reset demo", "Renew with World ID (simulated)", "Revoke".
  - Status words: "SAFE", "LIQUIDATED".
  - Phrases: "Releash kept", "more equity", "Blocked on-chain".
  - Feed titles: "Agent borrowed", "Agent deleveraged".
- **Stack:** React, Vite, plain CSS (`web/src/styles.css`). Fonts from Google Fonts. No UI kit.

## 7. What's free to change

Everything visual:
- Layout, grouping, hierarchy.
- How authority is drawn: a curve, a dial, a leash, a timeline.
- Typography, colour, whether the hero sits above or beside the app, whether "How it works" is a separate section or folded into the app.

Live screenshots for reference: `web/screenshots/hosted-demo-1280.png`, `web/rehearsal/07-monday-gap-35.png`, `video/stills/`.

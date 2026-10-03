# G5 rehearsal — hosted site (3 Oct 2026, 13:43–13:48 JST)

Site https://releash.robbyn.xyz/?demo=1 with backend https://releash-api.robbyn.xyz on Robinhood Chain testnet (46630).
Playwright, 1280x800, real pointer clicks. Before each click the driver checked that the button was enabled and that
the button itself was the element at the click point. After each click it checked the effect in the UI and on-chain
with `cast call` against the public RPC. Video: `rehearsal.mp4` (4 min 35 s, caption per beat). The `.webm` original
is kept locally and not committed.

## Result: 9 / 9 beats pass (final run)

| # | Beat | Time | UI evidence | On-chain evidence |
|---|------|------|-------------|-------------------|
| 1 | Reset demo | 57 s | "Demo reset: …" | Alice 100 rNVDA / 8,000 debt, ceiling 9,500, never renewed; control debt 8,800; price 180 |
| 2 | Renew (Simulate World ID) | 8 s | meter $9,252 | lastRenewed set, authorityNow 9,222.9 |
| 3 | Agent levers up | 4 s | feed "Agent borrowed $820.00" + Jev reason | debt 8,820 |
| 4 | Agent tries $1,500 | 7 s | strip + red feed line "Blocked on-chain: AuthorityExceeded(10320000000, 8945833334)" | debt unchanged 8,820 |
| 5 | Decay, 60 s | 61 s | meter $8,674 → $6,278 | authorityNow 8,668.8 → 6,293.8 |
| 6 | Friday close | 12 s | badge "WEEKEND · price frozen since Fri 16:00"; feed "Agent deleveraged 30%"; control still SAFE | debt 7,938 → 5,556.6 |
| 7 | Monday gap −35% | 20 s | control LIQUIDATED, Alice SAFE | price 116.5; control 60.3 rNVDA / 4,400 debt; Alice LTV 55.8%, not liquidatable |
| 8 | Revoke | 30 s | "Revoked"; can add $0.00; feed "Agent deleveraged 10%" 22 s after the revoke | revoked = true; debt 5,000.9 → 4,500.8 |
| 9 | Reset demo (end) | 54 s | "Demo reset: …" | Alice debt 8,000, price 180 |

On revoke: the agent did deleverage on its own, within 22 s. The LTV guard (above 55% after the gap) triggered it. No
manual trigger was needed.

## Found and fixed during the rehearsal (committed and redeployed with deploy/web.sh)
- **Control showed LIQUIDATED before the gap.** The pill counted any past `Liquidated` event, and an earlier run's
  liquidation survives Reset demo. It now counts only a liquidation after the control's latest borrow.
- **A skipped decision read as an action.** "Agent: deleverage 10%" appeared for a decision the agent did not send
  (cooldown). It now reads "Agent: deleverage 10% (skipped)" in grey.
- **The revoke beat scrolled the meter and feed off screen.** Revoke and Fire now sit directly under Renew.

## Flaky or confusing for a judge
- **Reset demo takes 17–57 s.** It is slow after a full run. Press it before the judges arrive, never live.
- **Two decisions for one 10% on the Friday beat.** At close the agent first trims 10% (LTV 49%), then 30% about 15 s
  later. The 30% line is the beat; the extra 10% line just above it can read as noise.
- **The feed scrolls the 30% line away.** After the gap the feed fills with guard deleverages and "skipped" lines, and
  the 30% line drops below the fold at 1280x800.
- **Same LTV for both positions after the gap.** In one run both showed 62.1% LTV (control liquidated down to it,
  Alice deleveraged to it). The difference that matters is collateral kept: about 85 rNVDA against 60.5 rNVDA.
- **Stale confirmations.** "Confirmed on-chain" under Renew stays visible after later actions, which is harmless but
  reads as stale.
- **Rehearsal-driver bugs (not the app).** Earlier runs failed only because of the driver: a previous result read as
  the new one, and a button parked under the sticky header. Both are fixed in the driver.

## UI fixes I would still make (not done)
1. In the demo strip, show "collateral kept" for Alice next to "lost to liquidation" for the control. That is the
   punchline, and the LTVs alone can match.
2. Pin the latest non-hold agent action above the feed list, so the 30% line stays visible during the gap.
3. Clear the "Confirmed on-chain" notices after about 6 s.
4. Show an elapsed timer while Reset demo runs, since it can take close to a minute.

## Batch 4 follow-up (13:51–13:54 JST, beats 2, 3, 6, 7 and 9 rerun with `BEATS=2,3,6,7,9`; all pass)
- **Equity in the demo strip.** Each card now shows equity (collateral at the oracle price minus debt). The control
  shows "Lost to liquidation: X rNVDA", read from the `Liquidated` events. A column between the cards reads
  "Releash kept $X more equity". In `07-monday-gap-35.png`: Alice $3,786.99, control $2,629.00, delta $1,157.99, and
  the control lost 39.66 rNVDA. All of these match `cast` (85.28 × 116.49 − 6,147.25; 60.34 × 116.49 − 4,400).
- **Delta before the gap.** Right after a reset the delta shows about $800 because the starting debts differ (8,000
  against 8,800), and pool slippage shows as "De-risking cost so far" until the gap. Both are true, but say it on stage.
- **Latest agent action is pinned** at the top of the feed. "Confirmed on-chain" clears after 6 s. Reset demo shows an
  elapsed-seconds counter.
- The 01–09 screenshots for beats 2, 3, 6, 7 and 9 now show the new UI. Driver: `rehearsal.mjs`; see its header.

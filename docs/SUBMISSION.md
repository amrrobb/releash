# Releash: submission (Arbitrum Open House Singapore, Online Buildathon, HackQuest)

Deadline: `2026-10-04T15:59Z` (Mon 5 Oct 00:59 JST). Target: submitted by Sun 4 Oct 15:00 JST.
Before pasting: fill the two `_n_` rows in README (live app, video) and make sure the GitHub repo is public (or `engineering-AF` is invited). This repo has no git remote yet, and the provenance answer below points judges at the commit history.

---

## 1. HackQuest form answers

### Name
Releash

### One-liner
Auto-deleverage for stock-backed loans on Robinhood Chain: the agent can always make the loan safer, but can only add debt while you keep proving with World ID that you are still there.

### Short description
Tokenized-stock oracles stop updating over the weekend, and Monday gaps liquidate leveraged borrowers who are offline. Releash is a lending vault on Robinhood Chain that gives an agent asymmetric authority. Deleverage is always allowed, through decay and revoke. Adding debt has a ceiling that halves every half-life unless a World ID proof renews it. When the owner goes quiet, the position can only get safer.

### Long description
Borrowers on Robinhood Chain can post tokenized stocks as collateral, but the price feeds behind them run 24/5. The Chainlink NVDA/USD feed on Robinhood Chain mainnet did not update for 52 hours on each of three consecutive September weekends, and for 78 hours over Labor Day (round history in `docs/RESEARCH.md`). A borrower who logs off on Friday meets the Monday gap with no one watching. Most agent permission schemes we found use a hard expiry. When the permission expires, every action stops, protective ones included, so for a leveraged loan an expiry ends in liquidation.

Releash splits the agent's authority in two:
- **Reduce risk** (repay 10% or 30% of debt by selling collateral): always allowed. It ignores decay, revoke and a stale weekend price.
- **Add debt:** capped by an authority ceiling that halves every half-life and reaches zero after three. A World ID proof renews it, and the owner can revoke it at once. Borrowed USDG always goes to the owner, never to the agent.

`ReleashVault` has no owner, no admin and no upgrade path. Renewals are EIP-712 signatures from a backend that verifies the World ID proof. They are bound to the chain, the vault and the agent, and each can be used once. Revoke, fire or an agent change voids every outstanding renewal.

The agent loop works in a fixed order:
1. A deterministic LTV guard acts first.
2. The borrower's mandate rules apply next.
3. Jev (TypeSafe's decision model, via OpenRouter) is asked to pick one of the contract's four actions, with Claude Haiku as the fallback.
4. The contract has the last word: an out-of-authority borrow reverts on-chain.

On Robinhood Chain testnet, a borrower and an identical control position both took a −35% Monday gap. The control was liquidated. The Releash position had deleveraged before the Friday close, so it survived the gap. After the owner revoked the agent, it could still deleverage but could not borrow.

The contracts are tested with Foundry: 41 tests, including invariant tests that we checked against deliberately broken contracts. The vault also went through an adversarial review: its two contract defects and one liquidation issue are fixed with regression tests, and its two design limits are disclosed. The vault takes the collateral, debt asset, feed and pool as constructor arguments, so moving to Paxos USDG and the real NVDA feed on mainnet means changing those arguments.

### Link to frontend / demo
https://releash.robbyn.xyz
(Demo controls: https://releash.robbyn.xyz/?demo=1)

### Core contract addresses (one per line)
```
Robinhood Chain: 0xD3464DDE25e58D0AAC85a47E587ae1E272a95D50 — ReleashVault (lending vault with decaying agent authority, World ID renewal, deleverage, liquidation; no admin)
Robinhood Chain: 0xC803754D776cc2766e35970d026d28Ac69F02a6d — MockPriceFeed (Chainlink AggregatorV3-shaped NVDA/USD feed, 8 decimals, demo keeper; stands in for Chainlink NVDA/USD 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 on mainnet 4663)
```

### Factory / pool contracts
```
Robinhood Chain: 0x78A4e755dc67a72EA9193A7920602ac1CBd051Bb — MockPool (constant-product rNVDA/USDG pool, 0.3% fee; the venue deleverage and liquidation sell into). No factory.
```

### Token contract addresses
```
Robinhood Chain: 0x64D9f65c80cc4188026C229EaA01f852C2189C2D — MockUSDG (6 decimals, mock of Paxos USDG; integration targets: Paxos USDG testnet 0x7E955252E15c84f5768B83c41a71F9eba181802F on 46630, mainnet 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 on 4663)
Robinhood Chain: 0xFd36E77E5D3Dc407db4a7d6e1d1D62A87c74EA3d — MockStock rNVDA (18 decimals, mock of the NVDA stock token; mainnet target 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEc on 4663)
```

### Contract Address
```
0xD3464DDE25e58D0AAC85a47E587ae1E272a95D50
```

### Which parts of the code were produced during the Buildathon
Everything in this repository was written on 3–4 Oct 2026, during the Buildathon. The commit history is the record: every commit is dated 3 or 4 Oct 2026. That covers:
- the contracts (`ReleashVault` and the mocks);
- the Foundry unit, invariant and end-to-end tests;
- the deploy scripts and the deployment on Robinhood Chain testnet;
- the backend (World ID verification and the EIP-712 renewal signer);
- the agent loop, keeper and liquidator;
- the web app and the hosting setup.

Releash continues **Leash** (ETHGlobal Tokyo, Sept 2026), from which it carries over:
- the idea of decaying agent authority renewed with World ID;
- the `limitAt` decay curve;
- the shape of the IDKit v4 verification code, ported and adapted in `backend/src/world.ts`.

Leash's ENS roles, 1inch Aqua and SwapVM integration were dropped. New in Releash:
- the lending vault;
- the deleverage/borrow asymmetry;
- the EIP-712 renewal with a renewal floor;
- the invariants;
- the Jev/Claude agent;
- the UI.

### Sponsor tech used (checkboxes)
- [x] **Robinhood Chain:** all five contracts are deployed on Robinhood Chain testnet (46630) and verified on Blockscout. The agent, keeper and liquidator run against it. The weekend-freeze evidence comes from the Chainlink NVDA/USD feed on Robinhood Chain mainnet.
- [x] **Paxos / USDG:** USDG is the debt asset, but on testnet it is a **mock** with the same 6 decimals (`MockUSDG`). The vault takes the debt token as a constructor argument. Targets are Paxos USDG testnet `0x7E955252E15c84f5768B83c41a71F9eba181802F` (46630) and mainnet `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (4663). We did not obtain testnet USDG in time to fund the vault with it.
- [x] **OpenZeppelin:** the vault uses `ReentrancyGuard` (every state-changing function), `SafeERC20`, `EIP712` and `ECDSA` (World ID renewals), `SafeCast` and `Math`. The mocks use `ERC20`.
- [ ] Alchemy: not used (public Robinhood RPC).

### Profile fields
Email, Telegram, GitHub and Twitter are required. The human fills these in.

---

## 2. Demo video script (target 2:45, hard limit 3:00)

**How it is recorded.** Record the live app at `https://releash.robbyn.xyz/?demo=1` in one browser at 1280 px.

**Protagonist.** Alice. Connect an injected wallet (Rabby or MetaMask) that holds `ALICE_PK` (`0xf32156839de91C9F6B9441D2c49A7d11aFadD527`). On the hosted build, the "demo account" button connects `0x454a…`, a different borrower. The demo strip and the "Agent tries $1,500" button act on Alice, so the main panel must be Alice too.

**Time.** The half-life is 120 s, so authority falls from 9,000 to 0 in 360 s. Three places in the script are **jump cuts**, marked ✂. Keep the chain clock or the authority countdown on screen across each cut, so the edit stays honest. Do not narrate numbers you do not see on screen. Expected values are given so the recorder knows when a take has gone wrong.

### Before recording: checklist

1. **Keys are not shared.** Stop any laptop `loop.ts`, `keeper.ts`, `liquidator.ts` or `demo-setup.ts` that uses the agent, keeper, Alice, Control or liquidator keys. Two senders on one key collide on nonces (`deploy/README.md`).
2. **Agents are running on the VPS.** They are off by default.
   - Start them with `deploy/agents.sh start`.
   - Check `deploy/agents.sh status` shows `loop`, `liquidator` and `keeper` up.
   - `deploy/agents.sh logs loop` must show ticks for Alice. `WATCH` must include Alice and Control.
   - Without the liquidator, Control shows LIQUIDATABLE, not LIQUIDATED.
3. **Backend is up.**
   - `curl -s https://releash-api.robbyn.xyz/api/health` returns `ok: true`, `chainId: 46630` and vault `0xD346…`.
   - `curl -s https://releash-api.robbyn.xyz/api/market` returns `OPEN`, price 180.
4. **Reset the demo.** Press **Reset demo** in the strip. Expected result:
   - Alice: 100 rNVDA, 8,000 USDG debt, agent mandate with a 9,000 ceiling.
   - Control: 100 rNVDA, 8,800 debt, no agent.
   - Market OPEN at $180, both SAFE.
   - The authority panel must **not** read "Revoked" (after a previous take, Reset keeps the same agent).
5. **Connected account is Alice.** The header address equals the strip's Alice address (`0xf321…D527`).
6. **Vault and pool balances.** Read `vault.debtAsset` balance of the vault and `pool.reserves()`:
   - The vault needs well over 1,000 USDG free.
   - The pool should sit near 50,000 USDG and about 278 rNVDA at $180.
   - Keeper ticks keep minting into the pool, which makes it deeper over time. If reserves have grown a lot, slippage will look smaller than in the README, so read the numbers off the screen.
   - Use `cast call 0x64D9f65c80cc4188026C229EaA01f852C2189C2D 'balanceOf(address)(uint256)' 0xD3464DDE25e58D0AAC85a47E587ae1E272a95D50 --rpc-url https://rpc.testnet.chain.robinhood.com` and `cast call 0x78A4e755dc67a72EA9193A7920602ac1CBd051Bb 'reserves()(uint256,uint256)' --rpc-url https://rpc.testnet.chain.robinhood.com`.
7. **Read the mainnet feed age live**, for the cold open:
   ```bash
   cast call 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' --rpc-url https://rpc.mainnet.chain.robinhood.com
   date -u +%s
   ```
   - The age is `now − field 4` (`updatedAt`).
   - On Sat 3 Oct the last update was Fri 2 Oct 17:07 UTC (`1790960852`). On Sunday it should be over 36 h.
   - Write the exact hours into the narration. Only say "past its own 24 h heartbeat" if the age really is above 24 h.
8. **Jev is reachable.**
   - OpenRouter credit is above zero (`GET /api/v1/credits`).
   - `OPENROUTER_API_KEY` is set in `/opt/releash/.env.releash`.
   - `AGENT_SOURCE` is not `rules`.
   - Tail `/opt/releash/data/log.46630.jsonl` for a line with `"source":"jev"`. On the 3 Oct testnet run there were **none**. If none appears, use narration variant B at 1:40.
9. **World ID.** The hosted build runs `WORLD_SIMULATE=1`. Open the staging window in the World Developer Portal first. The video says "simulated proof" on screen.
10. **Nobody else is pressing buttons.** The demo key ships in the public bundle, so any visitor to `?demo=1` can press Reset mid-take. Watch the feed for a reset you did not make, and re-take if one appears.
11. **Do one full dry run** within an hour of the real take.

### Script

| Time | Shot (screen) | Narration (exact) |
|---|---|---|
| 0:00–0:20 | Terminal: the `cast call` on the mainnet Chainlink NVDA/USD feed, with the `updatedAt` field highlighted and the computed age next to it. Then a static card with the RESEARCH table: 52.1 h, 52.1 h, 51.9 h, 78.2 h. | "This is the Chainlink NVDA price feed on Robinhood Chain mainnet. It last updated [N] hours ago. Stock feeds run 24/5. On each of the last three weekends this one was silent for 52 hours, and for 78 hours over Labor Day. If you borrowed against tokenized NVDA and logged off on Friday, nobody is watching your loan when Monday opens with a gap." |
| 0:20–0:35 | Landing hero of releash.robbyn.xyz, then scroll to the app with the demo strip. Alice and Control side by side, both SAFE. | "Releash is auto-deleverage for stock-backed loans on Robinhood Chain. Your agent can always make the loan safer. It can only add debt while you keep proving that you are still there. On the left is Alice with a Releash agent. On the right is a control borrower with the same 100 NVDA and no agent." |
| 0:35–0:55 | Authority panel: mandate with a 9,000 USDG ceiling, meter empty. Click **Renew with World ID** and complete the simulated proof. The meter fills. Within seconds the feed shows "Agent: borrow", debt goes to about 8,775, and the meter starts draining. | "Alice gives the agent a mandate: it may lever her up to 9,000 USDG of debt. That authority only exists after a human proves presence with World ID. This is the staging simulator. The meter fills, and the agent uses it right away, borrowing within its ceiling. The USDG goes to Alice, never to the agent." |
| 0:55–1:10 | Press **Agent tries $1,500**. A red feed line: "Blocked on-chain: AuthorityExceeded(…)". Click the tx link and show the reverted tx on the Blockscout explorer. | "Now the agent tries to borrow 1,500 more. The model can say whatever it likes. The vault checks total debt against the authority at this block, and the transaction reverts on-chain. That is a real failed transaction on Robinhood Chain." |
| 1:10–1:25 | ✂ The meter decays. Show the half-life countdown, then a cut to the next halving, then a cut to "decayed". | "Alice goes offline. Every two minutes in this demo, and every day in production, the ceiling halves. After three half-lives it is zero. Nothing expires, and the agent is not frozen. It just cannot add debt any more." |
| 1:25–1:50 | Press **Friday close**. The strip shows WEEKEND and the price is frozen. Seconds later a feed line appears: "Agent: deleverage 30%", with its reason, then "Sold … rNVDA, repaid …". LTV falls from about 48.8% to about 40.4%. | **Variant A** (the line includes "Jev: deleverage_30 x%, …"): "The market closes. Alice's mandate says to stay under 45% LTV over the weekend. The agent asks Jev, a decision model from TypeSafe, to choose among exactly the contract's actions. Here are its probabilities: deleverage 30% at [x]%. The agent repays 30% of the debt by selling collateral. That needs no authority at all." **Variant B** (no Jev line): "The market closes. Alice's mandate says to stay under 45% LTV over the weekend. That rule is checked before the model is asked, so the agent repays 30% of the debt by selling collateral. That needs no authority at all." |
| 1:50–2:10 | Press **Monday gap −35%**. The price goes to about $117. Control turns red: LTV about 75%, then LIQUIDATED (liquidator tx). Alice stays SAFE at about 62%. The guard line "LTV 62.1% is above the 55% line; trimming 10%" follows. | "Monday opens 35% lower. The control borrower is at 75% LTV, past the 70% line, and gets liquidated with a bonus taken from its collateral. Alice is at 62% and safe, and the agent trims another 10% on its own. Same start, same gap: one position is liquidated and one is not." |
| 2:10–2:25 | Press **Revoke** right after the Monday trim, while LTV is still above 55%. The panel reads "Revoked". ✂ Cut to the next guard trim (the 20 s cooldown): "Agent: deleverage 10%". Press **Agent tries $1,500**: "Blocked on-chain: MandateRevoked". | "Alice revokes the agent. It can still deleverage, as you see here, but borrowing now reverts. Close always, open only while you are alive." |
| 2:25–2:45 | Code card: `deleverage()` reads only `mandates[owner].agent`. The `forge test` summary: 41 passed. The invariant names. One line on the review. | "The vault has no owner, no admin and no upgrade path. Invariant tests run random sequences of time, price, revoke and renew. They check that the agent never ends above its authority and that deleverage never reverts for an authority, revoke or stale-price reason. We broke the contract on purpose to prove the tests catch it. An adversarial review found two signature-replay bugs. Both are fixed with regression tests, and the remaining limits are disclosed in the README." |
| 2:45–3:00 | The README "Demo result" table and the integration-target addresses. | "Who pays: lending venues on Robinhood Chain, which plug Releash in as an auto-deleverage module and pay a fee per liquidation it prevents. Borrowers keep their collateral, and the venue avoids fire sales into thin pools. The production deployment is a change of constructor arguments: Paxos USDG and the Chainlink NVDA feed. Releash." |

Pacing notes:
- About 2.4 words per second is the ceiling. If the take runs long, cut the explorer click at 0:55 first, then the code card.
- The only places to linger are the red "Blocked on-chain" line and the LIQUIDATED/SAFE split. Give each 2 s of silence.
- Lever-up timing: authority stays above 8,775 for only about 6 s after the renewal lands. Do not press Friday close until debt reads about 8,775. At 8,000, LTV is 44.4%, under the 45% weekend limit, so the agent holds and the Friday beat does not happen. If the lever-up is missed, reset and re-take.

---

## 3. Product–market fit (judge-facing)

**Who has the problem.** Anyone who borrows against tokenized stocks on Robinhood Chain:
- The collateral trades 24/7 on-chain, but its oracle runs 24/5. The mainnet NVDA/USD feed went 52 h without an update on three consecutive weekends and 78 h over Labor Day (our reads of the round history, `docs/RESEARCH.md`).
- Weekend news is priced in all at once on Monday.
- Liquidity for stock tokens on Robinhood Chain is thin. Per our research, the main NVDA/USDG pool held under $1M; we have not re-verified this. A liquidation there is a fire sale.

**Who pays, and why.**
- The buyer is the lending venue, not the borrower. A venue that lists stock collateral carries the bad-debt risk of every Monday gap and the reputational cost of liquidating retail users who were asleep.
- Releash plugs in as an auto-deleverage module: the borrower opts in, an agent watches the position, and the venue's vault enforces the asymmetric authority.
- Proposed pricing: a fee per liquidation avoided, measured on-chain as a deleverage that happens before a position crosses its liquidation threshold. This model is a proposal and has not been validated with a venue.

**Why now.**
- Per our research (not independently verified), Morpho shut down its Auto-Deleverage feature in May 2026, leaving no automatic de-risking on the main lending rail.
- Robinhood Chain mainnet already hosts stock tokens, Paxos USDG and Chainlink equity feeds. We checked the addresses we target on-chain on 3 Oct.

**Alternatives and why they fall short.**

| Alternative | What happens on a Monday gap |
| --- | --- |
| Plain stock-token lending (per our research, at least three such Open House submissions on Robinhood Chain: RoboLend, RobinLend, ShortStack) | No agent. The offline borrower is liquidated. |
| Agent with full control of the loan | Works, but it is a key no borrower should hand out. It could borrow the position to the limit or move funds. |
| Agent permissions with a hard expiry (session keys, time-boxed delegations) | They **fail closed**: at expiry every action stops, protective ones included. For a leveraged loan, that ends in liquidation. |
| Guardrail + World ID designs (per our research, at least six ETHGlobal 2026 projects; the closest, HumanMandate, raises the limit on re-verification) | None separates risk-reducing from risk-adding authority, so a lapsed human still freezes the agent. |
| **Releash** | Fails **safe**: adding debt decays to zero, while reducing risk never needs renewal and survives revoke. |

**Honest limits** (also in the README):
- World ID is verified off-chain by a backend whose key signs renewals. That key cannot move funds.
- The owner's key alone can also restore authority.
- The agent can extract value by sandwiching its own deleverage, up to the 15% slippage ceiling. Off-chain rate limiting is the only mitigation in this version; a TWAP or RFQ route is the production fix.
- A 24/7 pool trading more than about 13% below a frozen oracle blocks the agent's deleverage, though the owner's path still works.
- Testnet assets are mocks.

## 4. Roadmap (for the Grants track)

| Milestone | Ships |
| --- | --- |
| M1 (2 weeks) | Real Paxos USDG on testnet as the debt asset. On-chain cooldown for agent deleverage. Deleverage priced against a pool TWAP instead of the 15% ceiling. |
| M2 (1–2 months) | Releash as a module for an existing Robinhood Chain lending venue instead of its own vault. On-chain World ID verification if a verifier is deployed on Robinhood Chain. External audit. |
| M3 (3 months) | Mainnet pilot with one venue on NVDA/TSLA collateral, fee per avoided liquidation, public dashboard of avoided liquidations. |
| M4 (6 months) | More stock collateral, mandates written in plain language and parsed into on-chain parameters, more agent providers behind the same contract guard. |

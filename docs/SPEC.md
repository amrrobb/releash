# Releash — SPEC (reconstructed, frozen 3 Oct 12:30 JST)

The original handoff was truncated after section 1. This file replaces sections 2–7. Change the interface only with a commit that updates this file, the backend, the agent and the web in one go.

## 1. Product in one paragraph

A borrower deposits rNVDA and borrows USDG. They hand an agent a **mandate**: "keep me safe, and you may lever me up to X USDG of debt". The authority to **add** debt (X) halves every half-life (1 day in production, 120 s in the demo) and reaches zero after 3 half-lives, unless the borrower renews it by proving with World ID that they are still there. The authority to **reduce** risk (deleverage 10% or 30% of debt by selling collateral into the pool) never decays, survives revoke, and needs no renewal. A borrower who goes offline on Friday ends up with a position that can only get safer. Without Releash (the control position), a Monday gap gets the position liquidated.

## 2. Actors

| Actor | Can |
| --- | --- |
| Borrower (any wallet) | deposit, withdraw, borrow, repay, setMandate, revoke, fire, deleverage own position |
| Agent (address in mandate) | `agentBorrow` within `authorityNow`, `deleverage` |
| World signer (backend key) | signs `Renewal` after verifying a World ID proof server side. Cannot touch funds. |
| Anyone | submit a signed `Renewal`, `liquidate` unhealthy positions |
| Keeper (demo) | `MockPriceFeed.setPrice`, `MockPool` rebalance to the oracle |

## 3. Contracts

### 3.1 Mocks
- `MockUSDG` — ERC20, 6 decimals, name "Mock Paxos USDG", symbol "USDG". `mint(to, amt)` capped at 100,000e6 per call (open, demo faucet).
- `MockStock` — ERC20, 18 decimals, "Mock Robinhood NVIDIA", "rNVDA". `mint(to, amt)` capped at 1,000e18 per call.
- `MockPriceFeed` — Chainlink `AggregatorV3Interface` subset: `decimals()=8`, `latestRoundData()`, `description()`. `setPrice(int256)` keeper-only, bumps roundId and updatedAt. `setKeeper` owner-only.
- `MockPool` — constant-product rNVDA/USDG, 0.3% fee. `swapExactIn(tokenIn, amountIn, minOut, to)`, `getAmountIn(tokenOut, amountOut)`, `getAmountOut(tokenIn, amountIn)`, `addLiquidity`, `reserves()`. Thin on purpose (demo: 50,000 USDG / ~278 rNVDA, a 30% deleverage of an 8,800 debt costs ~5% slippage) so slippage is visible.

### 3.2 `ReleashVault`

Immutables: `collateral (rNVDA)`, `debtAsset (USDG)`, `feed`, `pool`, `worldSigner`, `halfLife`.
Constants: `MAX_LTV_BPS = 5000` (borrow up to 50%), `LIQ_THRESHOLD_BPS = 7000`, `LIQ_BONUS_BPS = 500`, `CLOSE_FACTOR_BPS = 5000`, `MAX_DELEVERAGE_SLIPPAGE_BPS = 1500` (agent-only ceiling vs oracle), `MAX_PRICE_AGE = 3 days` (borrow/withdraw need a price at most this old; deleverage and liquidate do not), `CUTOFF_HALVINGS = 3`.

USDG liquidity: the vault lends from its own USDG balance. `fund(amount)` lets anyone add liquidity (demo: deployer seeds). No interest (disclosed).

```solidity
struct Position {
    uint128 collateral;     // rNVDA, 18 dec
    uint128 debt;           // USDG, 6 dec
}
struct Mandate {
    address agent;          // zero = none
    uint128 authorityBase;  // max debt (USDG) the agent may bring the position to, at full strength
    uint64  lastRenewed;    // timestamp of the World proof (Renewal.issuedAt); 0 = never
    bool    revoked;        // true = agent may not add debt; deleverage still allowed
}
struct Renewal {            // EIP-712, domain {name:"Releash", version:"1", chainId, verifyingContract: vault}
    address owner;
    address agent;
    uint64  issuedAt;
    uint64  deadline;
}
```

Borrower functions:
- `deposit(uint128 amount)`, `withdraw(uint128 amount)` (fresh price, health ≥ MAX_LTV after), `borrow(uint128 amount)` (fresh price, LTV ≤ MAX_LTV after), `repay(address owner, uint128 amount)` (anyone may repay for anyone).
- `setMandate(address agent, uint128 authorityBase)` — new agent or new base. Resets `revoked=false`, keeps `lastRenewed` only if the agent is unchanged, else 0 (a new agent needs a fresh World proof).
- `revoke()` — `revoked = true`. Agent can no longer add debt, instantly. Deleverage unaffected.
- `fire()` — deletes the mandate. Agent can do nothing any more.

Renewal:
- `renew(Renewal r, bytes sig)` — anyone can submit. Requires: signer == worldSigner, `r.agent == mandate.agent`, `r.issuedAt > lastRenewed`, `r.issuedAt <= block.timestamp`, `block.timestamp <= r.deadline`. Sets `lastRenewed = r.issuedAt`, `revoked = false`. Strictly increasing `issuedAt` makes every signature single-use.

Agent functions:
- `agentBorrow(address owner, uint128 amount)` — `msg.sender == mandate.agent`, `!revoked`, fresh price, `debt + amount <= authorityNow(owner)`, LTV ≤ MAX_LTV after. USDG goes to the **owner**, never the agent.
- `deleverage(address owner, uint16 bps, uint128 maxCollateralIn)` — `msg.sender == owner || msg.sender == mandate.agent` (even when revoked or decayed). `bps ∈ {1000, 3000}`. Repays `debt * bps / 10000` by selling collateral into `pool` (exact-out via `getAmountIn`). Reverts if `collateralIn > maxCollateralIn` or > position collateral. When the agent calls, the collateral sold must also be ≤ oracle-fair amount × (1 + MAX_DELEVERAGE_SLIPPAGE_BPS), so a rogue agent cannot dump the position into a manipulated pool. **Reads no mandate state except `agent`.**

Liquidation:
- `liquidate(address owner, uint128 repayAmount)` — anyone, when `debt * 10000 > collateralValue * LIQ_THRESHOLD_BPS`. `repayAmount ≤ debt * CLOSE_FACTOR`. Liquidator pays USDG, receives `repay / price × (1 + bonus)` collateral (capped at position collateral). Uses the latest oracle price even if stale (a frozen weekend price is exactly the product's problem).

Views:
- `authorityNow(owner)` — 0 if no agent, revoked, or never renewed; else `limitAt(authorityBase, now - lastRenewed)`.
- `limitAt(base, elapsed)` — `base >> (elapsed / halfLife)`, linear interpolation to the next halving inside the period, 0 from `3 * halfLife` (port of Leash `Vault.limitAt`).
- `healthOf(owner) → (collateralValue, debt, ltvBps, liquidatable)`; `collateralValue(owner)`; `price() → (price8, updatedAt)`; `positions(owner)`, `mandates(owner)`; `renewalDigest(Renewal)`.

Events (indexed by the web/agent via logs):
`Deposited(owner, amount)`, `Withdrawn(owner, amount)`, `Borrowed(owner, by, amount, newDebt)`, `Repaid(owner, payer, amount, newDebt)`, `MandateSet(owner, agent, authorityBase)`, `Revoked(owner)`, `Fired(owner, agent)`, `Renewed(owner, agent, issuedAt)`, `Deleveraged(owner, by, bps, collateralSold, debtRepaid)`, `Liquidated(owner, liquidator, debtRepaid, collateralSeized)`, `Funded(from, amount)`.

Errors: `NotAgent`, `NotOwnerOrAgent`, `MandateRevoked`, `AuthorityExceeded(uint256 newDebt, uint256 authority)`, `LtvExceeded`, `StalePrice`, `BadSignature`, `RenewalNotNewer`, `RenewalExpired`, `RenewalFromFuture`, `AgentMismatch`, `BadBps`, `SlippageExceeded`, `InsufficientCollateral`, `InsufficientLiquidity`, `Healthy`, `RepayTooLarge`, `ZeroAmount`, `NoDebt`.

Security: ReentrancyGuard on every state-changing external, SafeERC20, checks-effects-interactions, `uint128` amounts, no owner/admin on the vault at all.

## 4. Backend (`backend/`)

- `POST /api/renew` body `{ owner, agent, idkitResult }`. Verifies the IDKit proof with the World Developer Portal (port of Leash `world.js`), action `releash-renew`, signal = owner address. Binds nullifier → owner in SQLite (one human cannot renew someone else's mandate; one owner, one human). Returns `{ renewal, signature }`; the **frontend** submits `renew` from the user's wallet (or the relayer submits if time allows).
- `GET /api/health`.
- Demo bypass: `WORLD_SIMULATE=1` accepts the World staging simulator; clearly labelled in README.

## 5. Agent (`agent/`)

Loop every 10 s (demo) per watched owner:
1. Read position, health, `authorityNow`, price + age, market clock (keeper's `market.json`: open/closed, next open).
2. Deterministic guard: if LTV > 65% → deleverage30 without asking the LLM. If LTV > 55% → deleverage10.
3. Otherwise ask the LLM (Jev via OpenRouter; fallback Claude) with the mandate text and state; response schema `{ action: "hold"|"deleverage10"|"deleverage30"|"borrow", amount?: number, reason: string }`. Weekend-aware: before market close with LTV above the borrower's weekend target → deleverage.
4. Contract is the last guard: a `borrow` the authority does not allow reverts `AuthorityExceeded`; the agent logs it as "blocked by Releash" (this is a demo beat).
5. Append every decision to `agent/log.jsonl`; the web reads it through the backend (`GET /api/agent/log`).

## 6. Web (`web/`)

One page, wallet connect (injected), Robinhood testnet.
- Left: **your position** (collateral, debt, LTV gauge, liquidation price) and **agent authority** meter (decaying live, countdown to next halving, "renew with World ID" button, revoke, fire).
- Right: **agent feed** (decisions with reasons, blocked attempts in red), market clock (OPEN / WEEKEND, frozen price badge).
- Demo strip (only with `?demo=1`): faucet, "Friday close", "Monday gap −35%", side-by-side **control** position (no agent) that gets liquidated.

## 7. Demo story (3 min)

1. Alice deposits 100 rNVDA ($180 each), borrows 8,000 USDG (44% LTV). Mandate: authority 9,000 USDG, half-life 120 s. Control borrows 8,800 by hand (at 8,000 a −35% gap stops at 68.4%, under the 70% line).
2. Renews with World ID: meter fills. Agent levers up to 8,800 within authority (allowed).
3. Agent tries to borrow beyond authority → blocked by the contract on-chain (red).
4. Time passes: meter halves, halves again. Alice is "offline".
5. Friday close: agent de-risks 30% before the weekend. Price frozen.
6. Monday gap −35%: control position (same start, no agent) is liquidated. Alice's survives.
7. Revoke: agent can still deleverage, cannot borrow. "Close always, open only while alive."

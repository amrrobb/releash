// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {ReleashVault} from "../src/ReleashVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPool} from "../src/interfaces/IPool.sol";

contract ReleashVaultTest is Base {
    // ------------------------------------------------------------ lending basics

    function test_depositBorrowRepayWithdraw() public {
        _open(alice, 100e18, 8_000e6);
        assertEq(usdg.balanceOf(alice), 8_000e6);
        (uint256 value, uint256 debt, uint256 ltv, bool liq) = vault.healthOf(alice);
        assertEq(value, 18_000e6);
        assertEq(debt, 8_000e6);
        assertEq(ltv, 4_445);
        assertFalse(liq);

        vm.startPrank(alice);
        vault.repay(alice, 8_000e6);
        vault.withdraw(100e18);
        vm.stopPrank();
        assertEq(nvda.balanceOf(alice), 100e18);
        assertEq(_debt(alice), 0);
    }

    function test_borrowAboveMaxLtvReverts() public {
        _open(alice, 100e18, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ReleashVault.LtvExceeded.selector, 5_001));
        vault.borrow(9_001e6);
    }

    function test_withdrawThatBreaksLtvReverts() public {
        _open(alice, 100e18, 8_000e6);
        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(20e18);
    }

    function test_borrowNeedsFreshPrice() public {
        _open(alice, 100e18, 0);
        vm.warp(block.timestamp + 3 days + 1);
        vm.prank(alice);
        vm.expectRevert();
        vault.borrow(1_000e6);
    }

    function test_borrowNeedsLiquidity() public {
        _open(alice, 10_000e18, 0);
        vm.prank(alice);
        vm.expectRevert(ReleashVault.InsufficientLiquidity.selector);
        vault.borrow(100_001e6);
    }

    function test_anyoneCanRepay() public {
        _open(alice, 100e18, 8_000e6);
        _mintUsdg(bob, 1_000e6);
        vm.startPrank(bob);
        usdg.approve(address(vault), 1_000e6);
        vault.repay(alice, 1_000e6);
        vm.stopPrank();
        assertEq(_debt(alice), 7_000e6);
    }

    function test_repayMoreThanDebtReverts() public {
        _open(alice, 100e18, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(ReleashVault.RepayTooLarge.selector);
        vault.repay(alice, 1_001e6);
    }

    // ------------------------------------------------------------ decay math

    function test_limitAtHalvesAndCutsOff() public view {
        uint256 base = 9_000e6;
        assertEq(vault.limitAt(base, 0), base);
        assertEq(vault.limitAt(base, HALF_LIFE / 2), base * 3 / 4);
        assertEq(vault.limitAt(base, HALF_LIFE), base / 2);
        assertEq(vault.limitAt(base, 2 * HALF_LIFE), base / 4);
        assertEq(vault.limitAt(base, 3 * HALF_LIFE - 1) > 0, true);
        assertEq(vault.limitAt(base, 3 * HALF_LIFE), 0);
        assertEq(vault.limitAt(base, 365 days), 0);
    }

    function testFuzz_limitAtMonotonic(uint128 base, uint32 a, uint32 b) public view {
        (uint256 lo, uint256 hi) = a < b ? (uint256(a), uint256(b)) : (uint256(b), uint256(a));
        assertLe(vault.limitAt(base, hi), vault.limitAt(base, lo));
        assertLe(vault.limitAt(base, lo), base);
    }

    function test_authorityZeroUntilRenewed() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);
        assertEq(vault.authorityNow(alice), 0);
        _renew(alice);
        assertEq(vault.authorityNow(alice), 9_000e6);
        vm.warp(block.timestamp + HALF_LIFE);
        assertEq(vault.authorityNow(alice), 4_500e6);
        assertEq(vault.nextHalvingIn(alice), HALF_LIFE);
    }

    // ------------------------------------------------------------ renewal

    function test_renewRejectsWrongSigner() public {
        _mandate(alice, 9_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(r, 0xBAD);
        vm.expectRevert(ReleashVault.BadSignature.selector);
        vault.renew(r, sig);
    }

    function test_renewIsSingleUse() public {
        _mandate(alice, 9_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(r, signerPk);
        vault.renew(r, sig);
        vm.expectRevert(ReleashVault.RenewalNotNewer.selector);
        vault.renew(r, sig);
    }

    function test_renewRejectsFutureAndExpired() public {
        _mandate(alice, 9_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp + 1));
        bytes memory sig = _sign(r, signerPk);
        vm.expectRevert(ReleashVault.RenewalFromFuture.selector);
        vault.renew(r, sig);

        r = _renewal(alice, uint64(block.timestamp));
        sig = _sign(r, signerPk);
        vm.warp(block.timestamp + 601);
        vm.expectRevert(ReleashVault.RenewalExpired.selector);
        vault.renew(r, sig);
    }

    function test_renewBoundToAgent() public {
        _mandate(alice, 9_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        r.agent = bob;
        bytes memory sig = _sign(r, signerPk);
        vm.expectRevert(ReleashVault.AgentMismatch.selector);
        vault.renew(r, sig);
    }

    function test_renewSignatureNotReplayableOnOtherVault() public {
        _mandate(alice, 9_000e6);
        ReleashVault other = new ReleashVault(
            IERC20(address(nvda)), IERC20(address(usdg)), feed, IPool(address(pool)), signer, HALF_LIFE
        );
        vm.prank(alice);
        other.setMandate(agent, 9_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(r, signerPk); // signed for `vault`
        vm.expectRevert(ReleashVault.BadSignature.selector);
        other.renew(r, sig);
    }

    function test_changingAgentResetsRenewal() public {
        _mandate(alice, 9_000e6);
        _renew(alice);
        vm.prank(alice);
        vault.setMandate(bob, 9_000e6);
        assertEq(vault.authorityNow(alice), 0);
        // Same agent, new base: renewal survives.
        _mandate(alice, 9_000e6);
        vm.warp(block.timestamp + 1);
        _renew(alice);
        _mandate(alice, 6_000e6);
        assertEq(vault.authorityNow(alice), 6_000e6);
    }

    // ------------------------------------------------------------ agent borrow

    function test_agentBorrowWithinAuthorityPaysOwner() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 8_800e6);
        _renew(alice);
        vm.prank(agent);
        vault.agentBorrow(alice, 800e6);
        assertEq(_debt(alice), 8_800e6);
        assertEq(usdg.balanceOf(alice), 8_800e6);
        assertEq(usdg.balanceOf(agent), 0);
    }

    function test_agentBorrowBeyondAuthorityBlocked() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 8_800e6);
        _renew(alice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReleashVault.AuthorityExceeded.selector, 8_801e6, 8_800e6));
        vault.agentBorrow(alice, 801e6);
    }

    function test_agentBorrowBlockedAfterDecay() public {
        _open(alice, 100e18, 4_000e6);
        _mandate(alice, 8_000e6);
        _renew(alice);
        vm.warp(block.timestamp + HALF_LIFE); // authority 4,000 = current debt
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReleashVault.AuthorityExceeded.selector, 4_001e6, 4_000e6));
        vault.agentBorrow(alice, 1e6);
    }

    function test_agentBorrowBlockedAfterRevoke() public {
        _open(alice, 100e18, 4_000e6);
        _mandate(alice, 8_000e6);
        _renew(alice);
        vm.prank(alice);
        vault.revoke();
        vm.prank(agent);
        vm.expectRevert(ReleashVault.MandateRevoked.selector);
        vault.agentBorrow(alice, 1e6);
    }

    function test_agentBorrowStillRespectsLtv() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 20_000e6);
        _renew(alice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReleashVault.LtvExceeded.selector, 5_556));
        vault.agentBorrow(alice, 2_000e6);
    }

    function test_strangerCannotAgentBorrow() public {
        _open(alice, 100e18, 4_000e6);
        _mandate(alice, 8_000e6);
        _renew(alice);
        vm.prank(bob);
        vm.expectRevert(ReleashVault.NotAgent.selector);
        vault.agentBorrow(alice, 1e6);
    }

    // ------------------------------------------------------------ deleverage

    function test_deleverageAfterRevokeAndFullDecay() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);
        _renew(alice);
        vm.prank(alice);
        vault.revoke();
        vm.warp(block.timestamp + 10 days); // decayed to zero AND price stale
        assertEq(vault.authorityNow(alice), 0);

        uint128 colBefore = _col(alice);
        vm.prank(agent);
        vault.deleverage(alice, 3_000, type(uint128).max);
        assertEq(_debt(alice), 5_600e6);
        uint256 sold = colBefore - _col(alice);
        // 2,400 USDG at $180 is 13.33 rNVDA fair; thin pool costs a few percent more.
        assertGt(sold, 13.33e18);
        assertLt(sold, 13.33e18 * 115 / 100);
    }

    function test_deleverageNeverRenewed() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);
        vm.prank(agent);
        vault.deleverage(alice, 1_000, type(uint128).max);
        assertEq(_debt(alice), 7_200e6);
    }

    function test_deleverageOnlyAllowedSizes() public {
        _open(alice, 100e18, 8_000e6);
        vm.prank(alice);
        vm.expectRevert(ReleashVault.BadBps.selector);
        vault.deleverage(alice, 10_000, type(uint128).max);
    }

    function test_deleverageCallerSlippageBound() public {
        _open(alice, 100e18, 8_000e6);
        vm.prank(alice);
        vm.expectRevert();
        vault.deleverage(alice, 3_000, 13e18);
    }

    function test_agentCannotDumpIntoManipulatedPool() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);
        // Someone drains USDG from the pool: the pool now prices rNVDA far below the oracle.
        _mintNvda(bob, 200e18);
        vm.startPrank(bob);
        nvda.approve(address(pool), type(uint256).max);
        pool.swapExactIn(address(nvda), 200e18, 0, bob);
        vm.stopPrank();

        vm.prank(agent);
        vm.expectRevert();
        vault.deleverage(alice, 3_000, type(uint128).max);

        // The owner is not bound by the agent's ceiling and can still choose to de-risk.
        vm.prank(alice);
        vault.deleverage(alice, 1_000, type(uint128).max);
        assertEq(_debt(alice), 7_200e6);
    }

    function test_firedAgentCannotDeleverage() public {
        _open(alice, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);
        vm.prank(alice);
        vault.fire();
        vm.prank(agent);
        vm.expectRevert(ReleashVault.NotOwnerOrAgent.selector);
        vault.deleverage(alice, 1_000, type(uint128).max);
    }

    function test_strangerCannotDeleverage() public {
        _open(alice, 100e18, 8_000e6);
        vm.prank(bob);
        vm.expectRevert(ReleashVault.NotOwnerOrAgent.selector);
        vault.deleverage(alice, 1_000, type(uint128).max);
    }

    function test_deleverageWithoutDebtReverts() public {
        _open(alice, 100e18, 0);
        vm.prank(alice);
        vm.expectRevert(ReleashVault.NoDebt.selector);
        vault.deleverage(alice, 1_000, type(uint128).max);
    }

    // ------------------------------------------------------------ liquidation

    function test_liquidateAfterGap() public {
        _open(bob, 100e18, 8_800e6);
        vm.expectRevert(ReleashVault.Healthy.selector);
        vm.prank(liquidator);
        vault.liquidate(bob, 1_000e6);

        _setPrice(117e8); // Monday gap -35%: 8,800 / 11,700 = 75% LTV
        (,, uint256 ltv, bool liq) = vault.healthOf(bob);
        assertEq(ltv, 7_522);
        assertTrue(liq);

        vm.prank(liquidator);
        vault.liquidate(bob, 4_400e6);
        assertEq(_debt(bob), 4_400e6);
        // 4,400 / 117 * 1.05 = 39.487 rNVDA
        assertApproxEqAbs(nvda.balanceOf(liquidator), 39.487179487179487179e18, 1e12);
    }

    function test_liquidateCloseFactor() public {
        _open(bob, 100e18, 8_800e6);
        _setPrice(117e8);
        vm.prank(liquidator);
        vm.expectRevert(ReleashVault.RepayTooLarge.selector);
        vault.liquidate(bob, 4_401e6);
    }

    function test_liquidateUsesStalePrice() public {
        _open(bob, 100e18, 8_800e6);
        _setPrice(117e8);
        vm.warp(block.timestamp + 5 days);
        vm.prank(liquidator);
        vault.liquidate(bob, 1_000e6);
        assertEq(_debt(bob), 7_800e6);
    }

    // ------------------------------------------------------------ review regressions (docs/REVIEW-contracts.md)

    function test_A1_usedRenewalNotReplayableAfterFireAndRehire() public {
        _open(alice, 100e18, 4_000e6);
        _mandate(alice, 8_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(r, signerPk);
        vault.renew(r, sig);
        vm.startPrank(alice);
        vault.fire();
        vault.setMandate(agent, 8_000e6);
        vm.stopPrank();
        vm.expectRevert(ReleashVault.RenewalNotNewer.selector);
        vault.renew(r, sig);
    }

    function test_A1_renewalNotReplayableAfterAgentSwapBack() public {
        _mandate(alice, 8_000e6);
        ReleashVault.Renewal memory r = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(r, signerPk);
        vault.renew(r, sig);
        vm.warp(block.timestamp + 5);
        vm.startPrank(alice);
        vault.setMandate(bob, 8_000e6);
        vault.setMandate(agent, 8_000e6);
        vm.stopPrank();
        vm.expectRevert(ReleashVault.RenewalNotNewer.selector);
        vault.renew(r, sig);
    }

    function test_A2_revokeCancelsUnsubmittedRenewal() public {
        _mandate(alice, 8_000e6);
        _renew(alice);
        vm.warp(block.timestamp + 10);
        ReleashVault.Renewal memory pending = _renewal(alice, uint64(block.timestamp));
        bytes memory sig = _sign(pending, signerPk);
        vm.prank(alice);
        vault.revoke();
        vm.expectRevert(ReleashVault.RenewalNotNewer.selector);
        vault.renew(pending, sig);
        // A fresh proof after the revoke works.
        vm.warp(block.timestamp + 1);
        _renew(alice);
        assertEq(vault.authorityNow(alice), 8_000e6);
    }

    function test_C2_cappedSeizeChargesOnlyWhatCollateralIsWorth() public {
        _open(bob, 100e18, 9_000e6);
        _setPrice(40e8); // collateral $4,000 against 9,000 debt: a 4,500 repay would seize 118 rNVDA
        uint256 before = usdg.balanceOf(liquidator);
        vm.prank(liquidator);
        vault.liquidate(bob, 4_500e6);
        assertEq(_col(bob), 0);
        assertEq(nvda.balanceOf(liquidator), 100e18);
        // $4,000 of collateral, bonus included, is worth 4,000 / 1.05 = 3,809.52 USDG of repayment.
        assertEq(before - usdg.balanceOf(liquidator), 3_809_523_809);
        assertEq(_debt(bob), 9_000e6 - 3_809_523_809);
    }
}

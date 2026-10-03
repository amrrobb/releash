// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {ReleashVault} from "../src/ReleashVault.sol";

/// @notice The demo story (SPEC §7) end to end: two identical positions, one with a Releash agent,
/// one without. A Friday close, a decayed mandate, a Monday gap. Only the control is liquidated.
contract ReleashE2ETest is Base {
    address control = makeAddr("control");

    function test_demoStory() public {
        // 1. Both open 100 rNVDA at $180 and borrow 8,000 USDG.
        _open(alice, 100e18, 8_000e6);
        _open(control, 100e18, 8_000e6);
        _mandate(alice, 9_000e6);

        // 2. Alice proves she is there; the agent levers within authority, on her behalf.
        _renew(alice);
        vm.prank(agent);
        vault.agentBorrow(alice, 800e6);
        // The control borrows the same amount by hand.
        vm.prank(control);
        vault.borrow(800e6);

        // 3. The agent tries to go beyond authority: blocked on-chain.
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ReleashVault.AuthorityExceeded.selector, 9_000e6 + 1, 9_000e6));
        vault.agentBorrow(alice, 200e6 + 1);

        // 4. Alice goes offline. Two half-lives later the agent can add nothing beyond what she owes.
        vm.warp(block.timestamp + 2 * HALF_LIFE);
        assertEq(vault.authorityNow(alice), 2_250e6);
        vm.prank(agent);
        vm.expectRevert();
        vault.agentBorrow(alice, 1e6);

        // 5. Friday close: the agent de-risks 30% before the weekend. It needs no fresh authority.
        vm.prank(agent);
        vault.deleverage(alice, 3_000, type(uint128).max);
        assertEq(_debt(alice), 6_160e6);

        // The weekend: the feed does not move for two and a half days.
        vm.warp(block.timestamp + 2.5 days);

        // 6. Monday gap -35%.
        _setPrice(117e8);
        (,,, bool aliceLiq) = vault.healthOf(alice);
        (,, uint256 controlLtv, bool controlLiq) = vault.healthOf(control);
        assertFalse(aliceLiq, "Releash position survives the gap");
        assertTrue(controlLiq, "control position is liquidatable");
        assertGt(controlLtv, 7_000);

        vm.prank(liquidator);
        vault.liquidate(control, 4_400e6);
        assertEq(_debt(control), 4_400e6);

        // 7. Revoke: the agent can still save the position, never add to it.
        vm.prank(alice);
        vault.revoke();
        vm.prank(agent);
        vm.expectRevert(ReleashVault.MandateRevoked.selector);
        vault.agentBorrow(alice, 1e6);

        // Keep the pool near the new oracle price, as a real market would after the open.
        _rebalancePoolTo(117e8);
        vm.prank(agent);
        vault.deleverage(alice, 1_000, type(uint128).max);
        assertEq(_debt(alice), 5_544e6);

        emit log_named_uint("alice collateral left (rNVDA, 1e18)", _col(alice));
        emit log_named_uint("control collateral left (rNVDA, 1e18)", _col(control));
        assertGt(_col(alice), _col(control), "Releash keeps more of the stock");
        // Equity at the Monday price: collateral value minus debt.
        uint256 aliceEquity = vault.collateralValue(alice) - _debt(alice);
        uint256 controlEquity = vault.collateralValue(control) - _debt(control);
        emit log_named_uint("alice equity (USDG)", aliceEquity / 1e6);
        emit log_named_uint("control equity (USDG)", controlEquity / 1e6);
        assertGt(aliceEquity, controlEquity + 1_000e6, "Releash saves over $1,000 of equity");
    }

    function _rebalancePoolTo(uint256 px) internal {
        (uint256 r0, uint256 r1) = pool.reserves();
        uint256 wantNvda = r1 * 1e20 / px;
        if (wantNvda > r0) _mintNvda(address(pool), wantNvda - r0);
        pool.sync();
    }
}

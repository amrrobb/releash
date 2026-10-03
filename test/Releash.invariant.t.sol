// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {ReleashVault} from "../src/ReleashVault.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockPool} from "../src/mocks/MockPool.sol";

/// @notice Drives one borrower, one agent and the world (time, price, revoke, renew) at random.
/// Records every violation of the two properties the product rests on.
contract Handler is Test {
    ReleashVault vault;
    MockUSDG usdg;
    MockStock nvda;
    MockPriceFeed feed;
    MockPool pool;
    address alice;
    address agent;
    address keeper;
    uint256 signerPk;

    /// @notice Times the agent's debt ended above authority at the moment of an agent borrow.
    uint256 public authorityBreaches;
    /// @notice Times a deleverage reverted with an authority-related error.
    uint256 public deleverageBlockedByAuthority;
    uint256 public deleverageCalls;
    uint256 public deleverageOk;
    uint256 public agentBorrowOk;
    uint256 public agentBorrowCalls;

    constructor(
        ReleashVault vault_,
        MockUSDG usdg_,
        MockStock nvda_,
        MockPriceFeed feed_,
        MockPool pool_,
        address alice_,
        address agent_,
        address keeper_,
        uint256 signerPk_
    ) {
        vault = vault_;
        usdg = usdg_;
        nvda = nvda_;
        feed = feed_;
        pool = pool_;
        alice = alice_;
        agent = agent_;
        keeper = keeper_;
        signerPk = signerPk_;
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 4 hours));
    }

    function movePrice(uint16 pctSeed, bool up) external {
        (uint256 px,) = vault.price();
        uint256 pct = bound(pctSeed, 0, 20);
        uint256 next = up ? px * (100 + pct) / 100 : px * (100 - pct) / 100;
        if (next < 10e8) next = 10e8;
        vm.prank(keeper);
        feed.setPrice(int256(next));
    }

    function revoke() external {
        vm.prank(alice);
        vault.revoke();
    }

    function setMandate(uint128 base) external {
        vm.prank(alice);
        vault.setMandate(agent, uint128(bound(base, 0, 20_000e6)));
    }

    function renew() external {
        (,, uint64 last,) = vault.mandates(alice);
        if (block.timestamp <= last) return;
        ReleashVault.Renewal memory r =
            ReleashVault.Renewal(alice, agent, uint64(block.timestamp), uint64(block.timestamp + 600));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, vault.renewalDigest(r));
        try vault.renew(r, abi.encodePacked(rr, s, v)) {} catch {}
    }

    function agentBorrow(uint128 amount) external {
        amount = uint128(bound(amount, 1, 5_000e6));
        uint256 authority = vault.authorityNow(alice);
        agentBorrowCalls++;
        vm.prank(agent);
        try vault.agentBorrow(alice, amount) {
            agentBorrowOk++;
            (, uint128 debt) = vault.positions(alice);
            if (debt > authority) authorityBreaches++;
        } catch {}
    }

    function ownerBorrow(uint128 amount) external {
        amount = uint128(bound(amount, 1, 3_000e6));
        vm.prank(alice);
        try vault.borrow(amount) {} catch {}
    }

    function ownerRepay(uint128 amount) external {
        (, uint128 debt) = vault.positions(alice);
        if (debt == 0) return;
        amount = uint128(bound(amount, 1, debt));
        vm.prank(alice);
        try vault.repay(alice, amount) {} catch {}
    }

    function deleverage(bool large) external {
        (uint128 col, uint128 debt) = vault.positions(alice);
        (address a,,,) = vault.mandates(alice);
        if (a != agent || debt == 0 || col == 0) return;
        deleverageCalls++;
        // Keep the pool at the oracle price so slippage is never the reason it reverts.
        _syncPool();
        uint16 bps = large ? 3_000 : 1_000;
        vm.prank(agent);
        try vault.deleverage(alice, bps, type(uint128).max) {
            deleverageOk++;
        } catch (bytes memory err) {
            bytes4 sel = bytes4(err);
            if (
                sel == ReleashVault.MandateRevoked.selector || sel == ReleashVault.NotAgent.selector
                    || sel == ReleashVault.NotOwnerOrAgent.selector || sel == ReleashVault.StalePrice.selector
                    || sel == bytes4(keccak256("AuthorityExceeded(uint256,uint256)"))
            ) deleverageBlockedByAuthority++;
        }
    }

    /// @dev Rebuild the pool at the oracle price with deep enough liquidity.
    function _syncPool() internal {
        (uint256 px,) = vault.price();
        (uint256 r0, uint256 r1) = pool.reserves();
        uint256 wantUsdg = r0 * px / 1e20;
        if (wantUsdg > r1) {
            uint256 add = wantUsdg - r1;
            while (add > 0) {
                uint256 a = add > 100_000e6 ? 100_000e6 : add;
                usdg.mint(address(pool), a);
                add -= a;
            }
        } else {
            uint256 wantNvda = r1 * 1e20 / px;
            uint256 add = wantNvda - r0;
            while (add > 0) {
                uint256 a = add > 1_000e18 ? 1_000e18 : add;
                nvda.mint(address(pool), a);
                add -= a;
            }
        }
        pool.sync();
    }
}

contract ReleashInvariantTest is Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        _open(alice, 100e18, 6_000e6);
        _mandate(alice, 9_000e6);
        _renew(alice);
        handler = new Handler(vault, usdg, nvda, feed, pool, alice, agent, keeper, signerPk);
        targetContract(address(handler));
    }

    /// @notice An agent borrow never leaves debt above the authority it had at that moment.
    function invariant_agentNeverExceedsAuthority() public view {
        assertEq(handler.authorityBreaches(), 0);
    }

    /// @notice Deleverage never fails because of authority, decay, revoke or a stale price.
    function invariant_deleverageNeverBlockedByAuthority() public view {
        assertEq(handler.deleverageBlockedByAuthority(), 0);
    }

    /// @notice The vault always holds the collateral it owes its single borrower.
    function invariant_collateralBacked() public view {
        (uint128 col,) = vault.positions(alice);
        assertGe(nvda.balanceOf(address(vault)), col);
    }
}

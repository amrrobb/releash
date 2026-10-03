// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReleashVault} from "../src/ReleashVault.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockPool} from "../src/mocks/MockPool.sol";
import {IPool} from "../src/interfaces/IPool.sol";

abstract contract Base is Test {
    uint256 constant HALF_LIFE = 60;
    int256 constant PRICE = 180e8;

    MockUSDG usdg;
    MockStock nvda;
    MockPriceFeed feed;
    MockPool pool;
    ReleashVault vault;

    uint256 signerPk = 0xA11CE5;
    address signer;
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address agent = makeAddr("agent");
    address bob = makeAddr("bob");
    address liquidator = makeAddr("liquidator");

    function setUp() public virtual {
        vm.warp(1_760_000_000);
        signer = vm.addr(signerPk);
        usdg = new MockUSDG();
        nvda = new MockStock("Mock Robinhood NVIDIA", "rNVDA");
        feed = new MockPriceFeed("rNVDA / USD", PRICE, keeper);
        pool = new MockPool(address(nvda), address(usdg));
        vault = new ReleashVault(
            IERC20(address(nvda)), IERC20(address(usdg)), feed, IPool(address(pool)), signer, HALF_LIFE
        );

        _mintUsdg(address(this), 200_000e6);
        _mintNvda(address(this), 278e18);
        usdg.approve(address(pool), type(uint256).max);
        nvda.approve(address(pool), type(uint256).max);
        pool.addLiquidity(277.777777777777777777e18, 50_000e6);
        usdg.approve(address(vault), type(uint256).max);
        vault.fund(100_000e6);

        _mintUsdg(liquidator, 100_000e6);
        vm.prank(liquidator);
        usdg.approve(address(vault), type(uint256).max);
    }

    // ------------------------------------------------------------ helpers

    function _mintUsdg(address to, uint256 amount) internal {
        while (amount > 0) {
            uint256 a = amount > 100_000e6 ? 100_000e6 : amount;
            usdg.mint(to, a);
            amount -= a;
        }
    }

    function _mintNvda(address to, uint256 amount) internal {
        while (amount > 0) {
            uint256 a = amount > 1_000e18 ? 1_000e18 : amount;
            nvda.mint(to, a);
            amount -= a;
        }
    }

    /// @dev 100 rNVDA ($18,000), 8,000 USDG debt (44.4% LTV).
    function _open(address who, uint128 col, uint128 debt) internal {
        _mintNvda(who, col);
        vm.startPrank(who);
        nvda.approve(address(vault), type(uint256).max);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(col);
        if (debt > 0) vault.borrow(debt);
        vm.stopPrank();
    }

    function _mandate(address who, uint128 base) internal {
        vm.prank(who);
        vault.setMandate(agent, base);
    }

    function _renewal(address owner, uint64 issuedAt) internal view returns (ReleashVault.Renewal memory r) {
        r = ReleashVault.Renewal({owner: owner, agent: agent, issuedAt: issuedAt, deadline: issuedAt + 600});
    }

    function _sign(ReleashVault.Renewal memory r, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, vault.renewalDigest(r));
        return abi.encodePacked(rr, s, v);
    }

    function _renew(address owner) internal {
        ReleashVault.Renewal memory r = _renewal(owner, uint64(block.timestamp));
        vault.renew(r, _sign(r, signerPk));
    }

    function _setPrice(int256 p) internal {
        vm.prank(keeper);
        feed.setPrice(p);
    }

    function _debt(address who) internal view returns (uint128 d) {
        (, d) = vault.positions(who);
    }

    function _col(address who) internal view returns (uint128 c) {
        (c,) = vault.positions(who);
    }
}

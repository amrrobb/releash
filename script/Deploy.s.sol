// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReleashVault} from "../src/ReleashVault.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStock} from "../src/mocks/MockStock.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockPool} from "../src/mocks/MockPool.sol";
import {IPool} from "../src/interfaces/IPool.sol";

/// @notice Deploys the demo stack and seeds liquidity.
/// Env: DEPLOYER_PK, WORLD_SIGNER, KEEPER (defaults to deployer), HALF_LIFE (default 120).
contract Deploy is Script {
    int256 constant START_PRICE = 180e8; // $180

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address deployer = vm.addr(pk);
        address worldSigner = vm.envAddress("WORLD_SIGNER");
        address keeper = vm.envOr("KEEPER", deployer);
        uint256 halfLife = vm.envOr("HALF_LIFE", uint256(120));

        vm.startBroadcast(pk);
        MockUSDG usdg = new MockUSDG();
        MockStock nvda = new MockStock("Mock Robinhood NVIDIA", "rNVDA");
        MockPriceFeed feed = new MockPriceFeed("rNVDA / USD", START_PRICE, keeper);
        MockPool pool = new MockPool(address(nvda), address(usdg));
        ReleashVault vault = new ReleashVault(
            IERC20(address(nvda)), IERC20(address(usdg)), feed, IPool(address(pool)), worldSigner, halfLife
        );

        // Pool: 50,000 USDG against 277.78 rNVDA (price 180).
        usdg.mint(deployer, 50_000e6);
        nvda.mint(deployer, 277.777777777777777777e18);
        usdg.approve(address(pool), type(uint256).max);
        nvda.approve(address(pool), type(uint256).max);
        pool.addLiquidity(277.777777777777777777e18, 50_000e6);

        // Vault lending liquidity: 100,000 USDG.
        usdg.mint(deployer, 100_000e6);
        usdg.approve(address(vault), type(uint256).max);
        vault.fund(100_000e6);
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "halfLife", halfLife);
        vm.serializeUint(o, "startBlock", block.number);
        vm.serializeAddress(o, "worldSigner", worldSigner);
        vm.serializeAddress(o, "keeper", keeper);
        vm.serializeAddress(o, "usdg", address(usdg));
        vm.serializeAddress(o, "rnvda", address(nvda));
        vm.serializeAddress(o, "feed", address(feed));
        vm.serializeAddress(o, "pool", address(pool));
        string memory json = vm.serializeAddress(o, "vault", address(vault));
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console.log("vault", address(vault));
    }
}

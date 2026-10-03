// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stand-in for Paxos USDG (6 decimals). Open mint for the demo faucet.
contract MockUSDG is ERC20 {
    uint256 public constant MAX_MINT = 100_000e6;

    error MintTooLarge();

    constructor() ERC20("Mock Paxos USDG", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(amount <= MAX_MINT, MintTooLarge());
        _mint(to, amount);
    }
}

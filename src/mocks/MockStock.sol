// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Testnet stand-in for a Robinhood stock token (18 decimals). Open mint for the demo faucet.
contract MockStock is ERC20 {
    uint256 public constant MAX_MINT = 1_000e18;

    error MintTooLarge();

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        require(amount <= MAX_MINT, MintTooLarge());
        _mint(to, amount);
    }
}

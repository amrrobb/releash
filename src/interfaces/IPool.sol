// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice What ReleashVault needs from a stock/USDG pool.
interface IPool {
    function getAmountIn(address tokenOut, uint256 amountOut) external view returns (uint256 amountIn);
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut);
    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut);
}

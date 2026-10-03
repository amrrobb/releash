// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPool} from "../interfaces/IPool.sol";

/// @notice Minimal constant-product pool (0.3% fee) for one stock token and USDG. Deliberately thin:
/// the demo needs slippage to be visible, as it is on the real NVDA/USDG pool.
contract MockPool is IPool, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 30;

    address public immutable token0;
    address public immutable token1;
    uint256 public reserve0;
    uint256 public reserve1;

    event LiquidityAdded(address indexed from, uint256 amount0, uint256 amount1);
    event Swapped(address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);
    event Synced(uint256 reserve0, uint256 reserve1);

    error UnknownToken();
    error InsufficientOutput();
    error InsufficientLiquidity();
    error ZeroAmount();

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    function reserves() external view returns (uint256, uint256) {
        return (reserve0, reserve1);
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external nonReentrant {
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        reserve0 += amount0;
        reserve1 += amount1;
        emit LiquidityAdded(msg.sender, amount0, amount1);
    }

    /// @notice Demo keeper hook: absorbs any tokens sent directly into the reserves, so a keeper can
    /// move the pool price toward the oracle by transferring one side in.
    function sync() external {
        reserve0 = IERC20(token0).balanceOf(address(this));
        reserve1 = IERC20(token1).balanceOf(address(this));
        emit Synced(reserve0, reserve1);
    }

    function getAmountOut(address tokenIn, uint256 amountIn) public view returns (uint256) {
        (uint256 rIn, uint256 rOut) = _reservesFor(tokenIn);
        uint256 inWithFee = amountIn * (10_000 - FEE_BPS);
        return inWithFee * rOut / (rIn * 10_000 + inWithFee);
    }

    function getAmountIn(address tokenOut, uint256 amountOut) external view returns (uint256) {
        address tokenIn = tokenOut == token0 ? token1 : tokenOut == token1 ? token0 : address(0);
        require(tokenIn != address(0), UnknownToken());
        (uint256 rIn, uint256 rOut) = _reservesFor(tokenIn);
        require(amountOut < rOut, InsufficientLiquidity());
        return rIn * amountOut * 10_000 / ((rOut - amountOut) * (10_000 - FEE_BPS)) + 1;
    }

    function swapExactIn(address tokenIn, uint256 amountIn, uint256 minOut, address to)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        require(amountIn > 0, ZeroAmount());
        amountOut = getAmountOut(tokenIn, amountIn);
        require(amountOut >= minOut && amountOut > 0, InsufficientOutput());
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        if (tokenIn == token0) {
            reserve0 += amountIn;
            reserve1 -= amountOut;
            IERC20(token1).safeTransfer(to, amountOut);
        } else {
            reserve1 += amountIn;
            reserve0 -= amountOut;
            IERC20(token0).safeTransfer(to, amountOut);
        }
        emit Swapped(tokenIn, amountIn, amountOut, to);
    }

    function _reservesFor(address tokenIn) internal view returns (uint256 rIn, uint256 rOut) {
        if (tokenIn == token0) return (reserve0, reserve1);
        if (tokenIn == token1) return (reserve1, reserve0);
        revert UnknownToken();
    }
}

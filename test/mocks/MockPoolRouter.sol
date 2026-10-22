// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IPoolRouter} from "../../src/interfaces/IPoolRouter.sol";
import {MockMUSD} from "./MockMUSD.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @notice MUSD -> mUSDC at a set rate (basis points of par), 18 to 6 decimals.
contract MockPoolRouter is IPoolRouter {
    MockMUSD public immutable musd;
    MockUSDC public immutable usdc;
    uint256 public rateBps = 9_980;
    /// When set, swaps leave part of the allowance unspent, like a router that
    /// pulls less than approved.
    bool public pullLess;

    constructor(MockMUSD musd_, MockUSDC usdc_) {
        musd = musd_;
        usdc = usdc_;
    }

    function setRateBps(uint256 bps) external {
        rateBps = bps;
    }

    function setPullLess(bool v) external {
        pullLess = v;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata)
        public
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountIn * rateBps / 10_000 / 1e12;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "expired");
        require(routes[0].from == address(musd) && routes[0].to == address(usdc), "bad route");
        amounts = getAmountsOut(amountIn, routes);
        if (amounts[1] < amountOutMin) revert InsufficientOutputAmount();
        IERC20(address(musd))
            .transferFrom(msg.sender, address(this), pullLess ? amountIn - 1 : amountIn);
        usdc.mint(to, amounts[1]);
    }
}

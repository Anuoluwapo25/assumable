// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Mezo Pools' basic-pool router (Aerodrome-style).
/// @dev Mainnet 0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706,
///      testnet 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9.
interface IPoolRouter {
    /// Reverted with when a swap would return less than `amountOutMin`.
    error InsufficientOutputAmount();

    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, Route[] calldata routes)
        external
        view
        returns (uint256[] memory amounts);
}

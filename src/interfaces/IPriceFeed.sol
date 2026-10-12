// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice MUSD's own oracle. The market prices a position's equity at the
///         same BTC price the protocol liquidates it at.
/// @dev From mezo-org/musd `IPriceFeed.sol`.
interface IPriceFeed {
    /// @return The BTC price in USD, scaled to 1e18.
    function fetchPrice() external view returns (uint256);
}

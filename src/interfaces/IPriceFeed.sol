// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice MUSD's own oracle. Reused rather than introducing a second price
///         source, so the vault values BTC exactly as the protocol it backstops
///         does — if the two ever disagreed, the vault's accounting would drift
///         from the liquidations that produce its yield.
/// @dev From mezo-org/musd `IPriceFeed.sol`.
interface IPriceFeed {
    /// @return The BTC price in USD. Liquity-derived feeds scale this to 1e18;
    ///         `BackstopVault` asserts that assumption at deploy time.
    function fetchPrice() external view returns (uint256);
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IYieldAdapter
/// @notice The savings leg's destination, abstracted away from any one venue.
///
/// RemitStream routes the saved slice of every remittance into a yield venue on
/// Mezo — in production, the MUSD Savings Vault, where a deposit of MUSD mints
/// sMUSD and the share price appreciates as Bitcoin borrowers pay loan interest
/// and origination fees.
///
/// The indirection exists for one reason: the venue is a live external protocol
/// whose interface we do not control. `ERC4626YieldAdapter` covers it if the
/// vault is ERC-4626; if it is not, a different adapter is written and nothing
/// upstream of this interface changes. `SavingsVault` and `AutoSplitRouter`
/// never learn which venue they are saving into.
interface IYieldAdapter {
    /// @notice The asset this adapter accepts. Always MUSD in production.
    function asset() external view returns (address);

    /// @notice Deposit `assets` of `asset()` and return the shares minted.
    /// @dev The caller must have transferred `assets` to the adapter first, or
    ///      approved the adapter for `assets`. Implementations state which.
    ///      Shares are held by the caller, not by the end beneficiary — the
    ///      router's `SavingsVault` is the custodian and does the per-user
    ///      accounting.
    function deposit(uint256 assets) external returns (uint256 shares);

    /// @notice Burn `shares` and send the redeemed assets to `receiver`.
    function redeem(uint256 shares, address receiver) external returns (uint256 assets);

    /// @notice What `shares` are currently worth in `asset()` terms.
    /// @dev Monotonically non-decreasing per share while the venue is healthy.
    ///      The gap between this and the principal recorded by `SavingsVault`
    ///      is the yield a recipient has earned.
    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    /// @notice What `assets` would mint right now, before fees.
    function convertToShares(uint256 assets) external view returns (uint256 shares);

    /// @notice Total assets this adapter currently controls on the venue.
    function totalAssets() external view returns (uint256);
}

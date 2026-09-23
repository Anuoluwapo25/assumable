// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The subset of Mezo's MUSD Stability Pool this vault depends on.
/// @dev Signatures taken from mezo-org/musd `IStabilityPool.sol`.
///
///      Two behaviours of the real pool drive this vault's whole design, and
///      neither is obvious from the signatures alone:
///
///      1. **Collateral gains are pushed, not pulled.** There is no `claim`.
///         Both `provideToSP` and `withdrawFromSP` send any accrued BTC to the
///         caller as native value before doing anything else, so a contract
///         depositor must be payable and must expect BTC to arrive unannounced.
///
///      2. **`withdrawFromSP` with a non-zero amount reverts while any
///         undercollateralized Trove exists** (`_requireNoUnderCollateralizedTroves`).
///         `withdrawFromSP(0)` skips that check, which is why harvesting always
///         works even when withdrawing principal does not.
interface IStabilityPool {
    /// @notice Deposit MUSD. Pushes any accrued collateral gain to the caller first.
    function provideToSP(uint256 _amount) external;

    /// @notice Withdraw MUSD, capped at the caller's compounded deposit.
    ///         Pushes any accrued collateral gain first. Pass 0 to harvest only.
    function withdrawFromSP(uint256 _amount) external;

    /// @notice Send accrued collateral gain straight to the caller's Trove.
    function withdrawCollateralGainToTrove(address _upperHint, address _lowerHint) external;

    /// @notice The depositor's MUSD after liquidation losses: d0 * P / P0.
    function getCompoundedMUSDDeposit(address _depositor) external view returns (uint256);

    /// @notice Collateral earned since the depositor's snapshot: d0 * (S - S0) / P0.
    function getDepositorCollateralGain(address _depositor) external view returns (uint256);

    function getTotalMUSDDeposits() external view returns (uint256);

    function getCollateralBalance() external view returns (uint256);
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISink
/// @notice A destination a receive policy can route MUSD into.
///
/// Sluice routes income, it does not decide where income should go. A sink is
/// the thing that decides: deposit into the MUSD Savings Vault, service a Trove,
/// fund a payroll escrow, buy BTC. The router knows none of that. It knows how
/// much each sink will take and how to hand it over.
///
/// @dev Implementations must hold to three rules. The router's accounting is
///      only sound if they do.
///
///      1. `deposit` is called after the router has already transferred
///         `amount` of `asset()` to the sink. A sink must verify receipt rather
///         than trust the caller, because `deposit` is permissionless.
///
///      2. `deposit` must apply the entire `amount` or revert. Partial
///         application would strand MUSD in the sink with no owner. The router
///         asks `capacity` first precisely so a sink never has to partially
///         accept.
///
///      3. `capacity` must not overstate. The router treats it as a hard limit
///         and cascades the excess to the next leg of the policy; a sink that
///         overstates will be handed more than it can apply and revert the
///         whole payment.
///
///      Sinks are chosen by the account that owns the policy, not by the
///      router, and are deliberately not allowlisted. A hostile sink can burn
///      a payer's gas or revert their payment, but it can never reach funds
///      belonging to anyone other than the account that chose it.
interface ISink {
    /// @notice The token this sink accepts. Must be MUSD to be routable.
    function asset() external view returns (address);

    /// @notice The most this sink can apply for `account` right now.
    /// @dev `type(uint256).max` means unbounded. Capacity is expected to move
    ///      with external protocol state — a Trove sink reports the debt that
    ///      is legally repayable, a vault sink reports the vault's own deposit
    ///      limit — which is what lets a policy drain one obligation and spill
    ///      the remainder into the next automatically.
    function capacity(address account) external view returns (uint256);

    /// @notice Apply `amount`, already transferred here, on behalf of `account`.
    /// @return applied Always `amount`. Returned so the router can assert it.
    function deposit(address account, uint256 amount) external returns (uint256 applied);

    /// @notice What `account` currently holds through this sink, in `asset()`
    ///         terms. For dashboards; the router never reads it.
    function balanceOf(address account) external view returns (uint256);
}

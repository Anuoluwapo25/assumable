// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice One cash-out, as created by the off-ramp backend and signed by it.
///         The user never picks where the money goes: `depositAddress` is the
///         provider's, issued for this order, and only a signed order is honoured.
struct CashOutOrder {
    /// The backend's id for the payout; tracked through events.
    bytes32 orderId;
    /// The position to borrow against, or 0 to open a new one.
    uint256 tokenId;
    /// Who may execute the order.
    address owner;
    /// The allowlisted adapter that delivers the MUSD.
    address adapter;
    /// Where the adapter sends the funds: an MUSD address on Mezo (Route A) or
    /// a USDC address on Ethereum (Route B).
    address depositAddress;
    /// MUSD handed to the adapter.
    uint256 musdAmount;
    /// Least the adapter may deliver, in its output token's units.
    uint256 minOut;
    uint64 expiry;
}

/// @notice Delivers MUSD to an off-ramp. The module transfers `order.musdAmount`
///         MUSD to the adapter, then calls `payout` in the same transaction.
///         An adapter keeps nothing between calls.
interface IOfframpAdapter {
    /// @return delivered The amount sent on, in the adapter's output token.
    function payout(CashOutOrder calldata order) external returns (uint256 delivered);
}

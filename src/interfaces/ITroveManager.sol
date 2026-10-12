// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The slice of MUSD's TroveManager the marketplace reads.
/// @dev From mezo-org/musd `ITroveManager.sol`.
interface ITroveManager {
    enum Status {
        nonExistent,
        active,
        closedByOwner,
        closedByLiquidation,
        closedByRedemption
    }

    function getTroveStatus(address borrower) external view returns (Status);

    /// @return The Trove's collateral ratio at `price`, scaled to 1e18.
    function getCurrentICR(address borrower, uint256 price) external view returns (uint256);

    /// @dev Total collateral is `coll + pendingCollateral`; total debt is the
    ///      sum of the four debt terms.
    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (
            uint256 coll,
            uint256 principal,
            uint256 interest,
            uint256 pendingCollateral,
            uint256 pendingPrincipal,
            uint256 pendingInterest
        );

    /// @return The Trove's fixed interest rate, in basis points (100 == 1%).
    function getTroveInterestRate(address borrower) external view returns (uint16);
}

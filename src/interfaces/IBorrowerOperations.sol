// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice MUSD's BorrowerOperations: every Trove change goes through here,
///         always on the caller's own Trove.
/// @dev From mezo-org/musd `IBorrowerOperations.sol`. Collateral is native BTC.
interface IBorrowerOperations {
    function openTrove(uint256 debtAmount, address upperHint, address lowerHint) external payable;
    function addColl(address upperHint, address lowerHint) external payable;
    function withdrawColl(uint256 amount, address upperHint, address lowerHint) external;
    function withdrawMUSD(uint256 amount, address upperHint, address lowerHint) external;
    function repayMUSD(uint256 amount, address upperHint, address lowerHint) external;
    function closeTrove() external;
    function refinance(address upperHint, address lowerHint) external;
    function claimCollateral() external;
}

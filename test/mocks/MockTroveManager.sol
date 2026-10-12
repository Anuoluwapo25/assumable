// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IBorrowerOperations} from "../../src/interfaces/IBorrowerOperations.sol";
import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";
import {ITroveManager} from "../../src/interfaces/ITroveManager.sol";
import {MockMUSD} from "./MockMUSD.sol";

/// @notice MUSD's Trove bookkeeping and borrower operations in one contract,
///         with the rules that matter to the market: a Trove belongs to the
///         address that opened it, carries a 200 MUSD gas reserve, keeps its
///         interest rate from opening, and must stay at or above 110%.
contract MockTroveManager is ITroveManager, IBorrowerOperations {
    uint256 constant MCR = 1.1e18;
    uint256 constant GAS_COMPENSATION = 200e18;

    struct Trove {
        uint256 coll;
        uint256 debt;
        uint16 rate;
        Status status;
    }

    MockMUSD public immutable musd;
    IPriceFeed public immutable feed;
    uint16 public interestRate = 100;
    mapping(address => Trove) public troves;
    mapping(address => uint256) public surplus;

    constructor(MockMUSD musd_, IPriceFeed feed_) {
        musd = musd_;
        feed = feed_;
    }

    // ---- governance & keeper stand-ins -------------------------------------

    function setInterestRate(uint16 rate) external {
        interestRate = rate;
    }

    /// Liquidation: the Trove is gone, and so is its collateral.
    function liquidate(address borrower) external {
        require(getCurrentICR(borrower, feed.fetchPrice()) < MCR, "not liquidatable");
        delete troves[borrower];
        troves[borrower].status = Status.closedByLiquidation;
    }

    /// Full redemption: debt paid off in collateral at face value; the rest
    /// waits as surplus for `claimCollateral`.
    function redeemFully(address borrower) external {
        Trove memory t = troves[borrower];
        uint256 taken = t.debt * 1e18 / feed.fetchPrice();
        surplus[borrower] += t.coll - taken;
        delete troves[borrower];
        troves[borrower].status = Status.closedByRedemption;
    }

    // ---- IBorrowerOperations ----------------------------------------------

    function openTrove(uint256 debtAmount, address, address) external payable {
        require(troves[msg.sender].status != Status.active, "trove active");
        troves[msg.sender] =
            Trove(msg.value, debtAmount + GAS_COMPENSATION, interestRate, Status.active);
        _requireHealthy(msg.sender);
        musd.mint(msg.sender, debtAmount);
    }

    function addColl(address, address) external payable {
        _requireActive(msg.sender);
        troves[msg.sender].coll += msg.value;
    }

    function withdrawColl(uint256 amount, address, address) external {
        _requireActive(msg.sender);
        troves[msg.sender].coll -= amount;
        _requireHealthy(msg.sender);
        _send(msg.sender, amount);
    }

    function withdrawMUSD(uint256 amount, address, address) external {
        _requireActive(msg.sender);
        troves[msg.sender].debt += amount;
        _requireHealthy(msg.sender);
        musd.mint(msg.sender, amount);
    }

    function repayMUSD(uint256 amount, address, address) external {
        _requireActive(msg.sender);
        troves[msg.sender].debt -= amount;
        musd.burn(msg.sender, amount);
    }

    function closeTrove() external {
        _requireActive(msg.sender);
        Trove memory t = troves[msg.sender];
        musd.burn(msg.sender, t.debt - GAS_COMPENSATION);
        delete troves[msg.sender];
        troves[msg.sender].status = Status.closedByOwner;
        _send(msg.sender, t.coll);
    }

    function refinance(address, address) external {
        _requireActive(msg.sender);
        troves[msg.sender].rate = interestRate;
    }

    function claimCollateral() external {
        uint256 amount = surplus[msg.sender];
        require(amount > 0, "nothing to claim");
        surplus[msg.sender] = 0;
        _send(msg.sender, amount);
    }

    // ---- ITroveManager ------------------------------------------------------

    function getTroveStatus(address borrower) external view returns (Status) {
        return troves[borrower].status;
    }

    function getCurrentICR(address borrower, uint256 price) public view returns (uint256) {
        Trove memory t = troves[borrower];
        return t.debt == 0 ? type(uint256).max : t.coll * price / t.debt;
    }

    function getEntireDebtAndColl(address borrower)
        external
        view
        returns (uint256, uint256, uint256, uint256, uint256, uint256)
    {
        Trove memory t = troves[borrower];
        return (t.coll, t.debt, 0, 0, 0, 0);
    }

    function getTroveInterestRate(address borrower) external view returns (uint16) {
        return troves[borrower].rate;
    }

    // ---- internal -----------------------------------------------------------

    function _requireActive(address borrower) internal view {
        require(troves[borrower].status == Status.active, "trove not active");
    }

    function _requireHealthy(address borrower) internal view {
        require(getCurrentICR(borrower, feed.fetchPrice()) >= MCR, "ICR below MCR");
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "BTC send failed");
    }
}

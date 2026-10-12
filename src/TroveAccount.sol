// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IBorrowerOperations} from "./interfaces/IBorrowerOperations.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";

/// @title TroveAccount
/// @notice The borrower of record for one MUSD Trove, controlled by whoever
///         holds the matching TrovePositions NFT.
///
/// MUSD ties a Trove to the address that opened it, so a Trove can't be
/// handed to anyone else. This account opens the Trove instead of a person,
/// and takes orders from the NFT's current holder. Transferring the NFT
/// therefore transfers the Trove: its BTC, its debt, and its fixed interest
/// rate, without closing or repaying anything.
///
/// The account never keeps value between calls. Borrowed MUSD and withdrawn
/// BTC go straight to the holder, so nothing is left inside for a buyer to
/// inherit by surprise or a seller to leave behind.
contract TroveAccount is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    IERC20 public immutable musd;

    IERC721 public positions;
    uint256 public tokenId;

    error NotHolder();
    error BTCTransferFailed();

    constructor(
        IBorrowerOperations borrowerOperations_,
        ITroveManager troveManager_,
        IERC20 musd_
    ) {
        borrowerOperations = borrowerOperations_;
        troveManager = troveManager_;
        musd = musd_;
        _disableInitializers();
    }

    function initialize(IERC721 positions_, uint256 tokenId_) external initializer {
        positions = positions_;
        tokenId = tokenId_;
    }

    /// @notice The NFT holder, who controls this Trove.
    function holder() public view returns (address) {
        return positions.ownerOf(tokenId);
    }

    modifier onlyHolder() {
        if (msg.sender != holder()) revert NotHolder();
        _;
    }

    // ----------------------------------------------------------------------
    // Holder actions
    // ----------------------------------------------------------------------

    /// @notice Opens the Trove with the BTC sent, borrowing `debt` MUSD to the
    ///         holder. TrovePositions may call it too, to mint and open in one
    ///         transaction.
    function open(uint256 debt, address upperHint, address lowerHint)
        external
        payable
        nonReentrant
    {
        address to = holder();
        if (msg.sender != to && msg.sender != address(positions)) revert NotHolder();
        borrowerOperations.openTrove{value: msg.value}(debt, upperHint, lowerHint);
        _sendMUSD(to);
    }

    function withdrawColl(uint256 amount, address upperHint, address lowerHint)
        external
        onlyHolder
        nonReentrant
    {
        borrowerOperations.withdrawColl(amount, upperHint, lowerHint);
        _sendBTC(msg.sender);
    }

    function borrow(uint256 amount, address upperHint, address lowerHint)
        external
        onlyHolder
        nonReentrant
    {
        borrowerOperations.withdrawMUSD(amount, upperHint, lowerHint);
        _sendMUSD(msg.sender);
    }

    /// @notice Repays the whole debt from the holder's MUSD and returns all
    ///         BTC to them. The holder approves this account for the debt
    ///         less MUSD's 200 MUSD gas compensation, which the protocol
    ///         settles itself.
    function close() external onlyHolder nonReentrant {
        uint256 debt = _debt();
        musd.safeTransferFrom(msg.sender, address(this), debt - 200e18);
        borrowerOperations.closeTrove();
        _sendBTC(msg.sender);
        _sendMUSD(msg.sender);
    }

    /// @notice Moves the Trove onto MUSD's current interest rate (for a fee).
    function refinance(address upperHint, address lowerHint) external onlyHolder nonReentrant {
        borrowerOperations.refinance(upperHint, lowerHint);
    }

    // ----------------------------------------------------------------------
    // Anyone: these only ever make the Trove safer, or pay out to the holder
    // ----------------------------------------------------------------------

    /// @notice Adds the BTC sent as collateral. Open to anyone, so a friend,
    ///         a bot or a prospective buyer can rescue the position.
    function addColl(address upperHint, address lowerHint) external payable nonReentrant {
        borrowerOperations.addColl{value: msg.value}(upperHint, lowerHint);
    }

    /// @notice Repays `amount` of debt from the caller's MUSD. Open to anyone.
    function repay(uint256 amount, address upperHint, address lowerHint) external nonReentrant {
        musd.safeTransferFrom(msg.sender, address(this), amount);
        borrowerOperations.repayMUSD(amount, upperHint, lowerHint);
    }

    /// @notice After a liquidation or redemption leaves surplus collateral,
    ///         claims it for the holder.
    function claimCollateral() external nonReentrant {
        borrowerOperations.claimCollateral();
        _sendBTC(holder());
    }

    /// @notice Sends anything that reached the account outside the flows
    ///         above (BTC force-sent, MUSD transferred in) to the holder.
    function sweep() external nonReentrant {
        address to = holder();
        _sendBTC(to);
        _sendMUSD(to);
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    /// @return coll BTC collateral, including pending rewards.
    /// @return debt Total MUSD debt: principal, interest and pending terms.
    function position() external view returns (uint256 coll, uint256 debt) {
        (uint256 c,,, uint256 pc,,) = troveManager.getEntireDebtAndColl(address(this));
        return (c + pc, _debt());
    }

    // ----------------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------------

    function _debt() internal view returns (uint256) {
        (, uint256 p, uint256 i,, uint256 pp, uint256 pi) =
            troveManager.getEntireDebtAndColl(address(this));
        return p + i + pp + pi;
    }

    function _sendBTC(address to) internal {
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert BTCTransferFailed();
    }

    function _sendMUSD(address to) internal {
        uint256 amount = musd.balanceOf(address(this));
        if (amount > 0) musd.safeTransfer(to, amount);
    }

    /// @dev MUSD pays out withdrawn and surplus collateral as native BTC.
    receive() external payable {}
}

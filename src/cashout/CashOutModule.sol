// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";
import {TroveAccount} from "../TroveAccount.sol";
import {TroveMarket} from "../TroveMarket.sol";
import {TrovePositions} from "../TrovePositions.sol";
import {CashOutOrder, IOfframpAdapter} from "./IOfframpAdapter.sol";

/// @title CashOutModule
/// @notice Turns BTC into a payout in one transaction: draws MUSD from the
///         caller's Trove (adding BTC first if they send some), checks the loan
///         stays well inside a safety cap, and hands the MUSD to an approved
///         off-ramp adapter.
///
/// It works over Assumable as it is. `TroveAccount` only borrows for the NFT's
/// holder, so for the length of the call this module holds the NFT, borrows,
/// and gives it straight back, before any adapter runs. The holder approves
/// the module on `TrovePositions` once. The module never keeps MUSD, BTC or an
/// NFT between calls, and its owner has no power over anyone's funds: only over
/// which adapters and which order signer are trusted, and the LTV cap below a
/// hard ceiling.
///
/// Destinations come from the backend, never the caller: an order names the
/// provider's deposit address and is signed (EIP-712) by `orderSigner`.
contract CashOutModule is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "CashOutOrder(bytes32 orderId,uint256 tokenId,address owner,address adapter,"
        "address depositAddress,uint256 musdAmount,uint256 minOut,uint64 expiry)"
    );

    /// The owner can lower the cap freely but never raise it past 60% LTV.
    /// MUSD liquidates at 110% collateral, about 90.9% LTV.
    uint16 public constant MAX_LTV_CEILING_BPS = 6_000;

    TrovePositions public immutable positions;
    TroveMarket public immutable market;
    IPriceFeed public immutable priceFeed;
    IERC20 public immutable musd;

    address public orderSigner;
    /// Highest LTV a cash-out may leave the Trove at, in basis points. Debt
    /// includes MUSD's 200 MUSD gas reserve, so the real cap is a little tighter.
    uint16 public maxLtvBps = 4_000;
    mapping(address => bool) public isAdapter;
    mapping(bytes32 => bool) public orderUsed;

    event CashOut(
        bytes32 indexed orderId,
        uint256 indexed tokenId,
        address indexed owner,
        address adapter,
        uint256 musdAmount,
        uint256 delivered,
        uint256 ltvBps
    );
    event Repaid(
        bytes32 indexed onrampOrderId,
        uint256 indexed tokenId,
        address indexed payer,
        uint256 amount
    );
    event AdapterSet(address indexed adapter, bool allowed);
    event OrderSignerSet(address indexed signer);
    event MaxLtvSet(uint16 bps);

    error NotOwner();
    error Listed();
    error InvalidOrder();
    error OrderExpired();
    error OrderAlreadyUsed();
    error AdapterNotAllowed();
    error BadSignature();
    error LtvAboveMax(uint256 ltvBps, uint256 maxBps);
    error DeliveredBelowMin(uint256 delivered, uint256 minOut);
    error AdapterLeftFunds();
    error InvalidLtv();
    error NoPosition();
    error ZeroAmount();

    constructor(
        TrovePositions positions_,
        TroveMarket market_,
        IPriceFeed priceFeed_,
        IERC20 musd_,
        address orderSigner_,
        address owner_
    ) Ownable(owner_) EIP712("Assumable Cash Out", "1") {
        require(address(market_.positions()) == address(positions_), "market/positions mismatch");
        positions = positions_;
        market = market_;
        priceFeed = priceFeed_;
        musd = musd_;
        orderSigner = orderSigner_;
        emit OrderSignerSet(orderSigner_);
    }

    // ----------------------------------------------------------------------
    // Cash out
    // ----------------------------------------------------------------------

    /// @notice Borrows `order.musdAmount` against the caller's position, with
    ///         any BTC sent added as collateral first, and pays it out.
    function cashOut(
        CashOutOrder calldata order,
        bytes calldata signature,
        address upperHint,
        address lowerHint
    ) external payable nonReentrant whenNotPaused returns (uint256 delivered) {
        if (order.tokenId == 0) revert InvalidOrder();
        _useOrder(order, signature);
        uint256 id = order.tokenId;
        if (positions.ownerOf(id) != msg.sender) revert NotOwner();
        // A buyer is looking at this position's numbers; don't move them.
        if (_listed(id, msg.sender)) revert Listed();

        uint256 before = musd.balanceOf(address(this));
        TroveAccount account = positions.accountOf(id);

        positions.transferFrom(msg.sender, address(this), id);
        if (msg.value > 0) account.addColl{value: msg.value}(upperHint, lowerHint);
        account.borrow(order.musdAmount, upperHint, lowerHint);
        positions.transferFrom(address(this), msg.sender, id);

        uint256 ltv = _checkLtv(account);
        delivered = _payout(order, before);
        emit CashOut(order.orderId, id, msg.sender, order.adapter, order.musdAmount, delivered, ltv);
    }

    /// @notice First cash-out: opens a position for the caller with the BTC
    ///         sent, borrowing `debt`, and pays `order.musdAmount` of it out.
    ///         MUSD's minimum loan can exceed the payout; the rest goes to the
    ///         caller's wallet.
    function openAndCashOut(
        CashOutOrder calldata order,
        bytes calldata signature,
        uint256 debt,
        address upperHint,
        address lowerHint
    ) external payable nonReentrant whenNotPaused returns (uint256 id, uint256 delivered) {
        if (order.tokenId != 0 || debt < order.musdAmount) revert InvalidOrder();
        _useOrder(order, signature);

        uint256 before = musd.balanceOf(address(this));
        TroveAccount account;
        // Minted to this module, so it is the holder while the Trove opens.
        (id, account) = positions.createPosition();
        account.open{value: msg.value}(debt, upperHint, lowerHint);
        positions.transferFrom(address(this), msg.sender, id);

        uint256 ltv = _checkLtv(account);
        if (debt > order.musdAmount) musd.safeTransfer(msg.sender, debt - order.musdAmount);
        delivered = _payout(order, before);
        emit CashOut(order.orderId, id, msg.sender, order.adapter, order.musdAmount, delivered, ltv);
    }

    // ----------------------------------------------------------------------
    // Pay back
    // ----------------------------------------------------------------------

    /// @notice Repays `amount` of a position's debt from the caller's MUSD,
    ///         tagged with the on-ramp order that bought it. Never paused:
    ///         paying back only makes a loan safer.
    function repay(
        uint256 tokenId,
        uint256 amount,
        bytes32 onrampOrderId,
        address upperHint,
        address lowerHint
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        TroveAccount account = positions.accountOf(tokenId);
        if (address(account) == address(0)) revert NoPosition();

        musd.safeTransferFrom(msg.sender, address(this), amount);
        musd.forceApprove(address(account), amount);
        account.repay(amount, upperHint, lowerHint);
        if (musd.allowance(address(this), address(account)) != 0) {
            musd.forceApprove(address(account), 0);
        }
        emit Repaid(onrampOrderId, tokenId, msg.sender, amount);
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    /// @notice The EIP-712 digest the order signer signs.
    function hashOrder(CashOutOrder calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ORDER_TYPEHASH,
                    order.orderId,
                    order.tokenId,
                    order.owner,
                    order.adapter,
                    order.depositAddress,
                    order.musdAmount,
                    order.minOut,
                    order.expiry
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ----------------------------------------------------------------------
    // Admin: trust settings only, never funds
    // ----------------------------------------------------------------------

    function setAdapter(address adapter, bool allowed) external onlyOwner {
        isAdapter[adapter] = allowed;
        emit AdapterSet(adapter, allowed);
    }

    function setOrderSigner(address signer) external onlyOwner {
        orderSigner = signer;
        emit OrderSignerSet(signer);
    }

    function setMaxLtvBps(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > MAX_LTV_CEILING_BPS) revert InvalidLtv();
        maxLtvBps = bps;
        emit MaxLtvSet(bps);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ----------------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------------

    function _useOrder(CashOutOrder calldata order, bytes calldata signature) internal {
        if (order.musdAmount == 0) revert ZeroAmount();
        if (order.owner != msg.sender) revert NotOwner();
        if (order.depositAddress == address(0)) revert InvalidOrder();
        if (block.timestamp > order.expiry) revert OrderExpired();
        if (!isAdapter[order.adapter]) revert AdapterNotAllowed();
        if (orderUsed[order.orderId]) revert OrderAlreadyUsed();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashOrder(order), signature);
        if (err != ECDSA.RecoverError.NoError || signer != orderSigner) revert BadSignature();
        orderUsed[order.orderId] = true;
    }

    function _listed(uint256 id, address owner) internal view returns (bool) {
        (address seller,,,, uint64 expiry) = market.listings(id);
        return seller == owner && block.timestamp <= expiry;
    }

    function _checkLtv(TroveAccount account) internal view returns (uint256 ltvBps) {
        (uint256 coll, uint256 debt) = account.position();
        uint256 value = coll * priceFeed.fetchPrice() / 1e18;
        ltvBps = value == 0 ? type(uint256).max : debt * 10_000 / value;
        if (ltvBps > maxLtvBps) revert LtvAboveMax(ltvBps, maxLtvBps);
    }

    function _payout(CashOutOrder calldata order, uint256 balanceBefore)
        internal
        returns (uint256 delivered)
    {
        musd.safeTransfer(order.adapter, order.musdAmount);
        delivered = IOfframpAdapter(order.adapter).payout(order);
        if (delivered < order.minOut) revert DeliveredBelowMin(delivered, order.minOut);
        if (musd.balanceOf(address(this)) != balanceBefore) revert AdapterLeftFunds();
    }
}

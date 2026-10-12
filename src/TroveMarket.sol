// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {ITroveManager} from "./interfaces/ITroveManager.sol";
import {TroveAccount} from "./TroveAccount.sol";
import {TrovePositions} from "./TrovePositions.sol";

/// @title TroveMarket
/// @notice Buy and sell live MUSD Troves, paid in MUSD.
///
/// A seller who borrowed MUSD and spent it can't close their Trove without
/// buying that MUSD back. Here they sell the whole position instead: the
/// buyer pays for the equity (BTC value minus debt) and takes over the BTC,
/// the debt and the Trove's fixed interest rate. Nothing is repaid, closed
/// or liquidated.
///
/// Listings are non-custodial. The seller keeps the NFT, so they can still
/// add collateral while listed. Because the seller could also *weaken* the
/// position after listing, every purchase carries the buyer's own limits
/// (max price, max debt, min collateral), checked in the same transaction
/// as the transfer.
///
/// Offers work the other way round: a buyer escrows MUSD against any
/// position, listed or not, with the same limits, and its holder can accept.
contract TroveMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Pricing {
        /// `value` is the price in MUSD.
        Fixed,
        /// `value` is a share of live equity in basis points: 9500 sells at
        /// 95% of (BTC value - debt) at MUSD's oracle price. Above 10000 asks
        /// a premium, e.g. for a Trove locked at a low rate.
        EquityShare
    }

    struct Listing {
        address seller;
        Pricing pricing;
        uint256 value;
        /// Floor for equity pricing, so a BTC drop can't sell it for less.
        uint256 minPrice;
        uint64 expiry;
    }

    struct Offer {
        uint256 amount;
        uint256 maxDebt;
        uint256 minColl;
        uint64 expiry;
    }

    struct Quote {
        bool active;
        uint256 coll;
        uint256 debt;
        uint256 icr;
        uint16 interestRate;
        /// BTC value minus debt, in MUSD. Zero if underwater.
        uint256 equity;
        /// Zero when not listed or not buyable.
        uint256 price;
    }

    uint256 public constant MAX_EQUITY_SHARE = 20_000;

    IERC20 public immutable musd;
    TrovePositions public immutable positions;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;

    mapping(uint256 => Listing) public listings;
    mapping(uint256 => mapping(address => Offer)) public offers;

    event Listed(
        uint256 indexed tokenId,
        address indexed seller,
        Pricing pricing,
        uint256 value,
        uint256 minPrice,
        uint64 expiry
    );
    event Unlisted(uint256 indexed tokenId);
    event Sold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 coll,
        uint256 debt
    );
    event OfferMade(
        uint256 indexed tokenId,
        address indexed buyer,
        uint256 amount,
        uint256 maxDebt,
        uint256 minColl,
        uint64 expiry
    );
    event OfferCancelled(uint256 indexed tokenId, address indexed buyer);

    error NotOwner();
    error NotApproved();
    error InvalidPricing();
    error NotListed();
    error Expired();
    error StaleListing();
    error TroveNotActive();
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error DebtAboveMax(uint256 debt, uint256 maxDebt);
    error CollBelowMin(uint256 coll, uint256 minColl);
    error NoEquity();
    error NoOffer();
    error OfferBelowMin(uint256 amount, uint256 minAmount);

    constructor(
        TrovePositions positions_,
        IERC20 musd_,
        ITroveManager troveManager_,
        IPriceFeed priceFeed_
    ) {
        positions = positions_;
        musd = musd_;
        troveManager = troveManager_;
        priceFeed = priceFeed_;
    }

    // ----------------------------------------------------------------------
    // Listings
    // ----------------------------------------------------------------------

    function list(uint256 tokenId, Pricing pricing, uint256 value, uint256 minPrice, uint64 expiry)
        external
    {
        if (positions.ownerOf(tokenId) != msg.sender) revert NotOwner();
        if (!_approved(msg.sender, tokenId)) revert NotApproved();
        if (expiry <= block.timestamp) revert Expired();
        if (value == 0 || (pricing == Pricing.EquityShare && value > MAX_EQUITY_SHARE)) {
            revert InvalidPricing();
        }
        listings[tokenId] = Listing(msg.sender, pricing, value, minPrice, expiry);
        emit Listed(tokenId, msg.sender, pricing, value, minPrice, expiry);
    }

    /// @notice Removes a listing. The seller can always; anyone can once it
    ///         has gone stale (the NFT changed hands outside the market).
    function unlist(uint256 tokenId) external {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (msg.sender != l.seller && positions.ownerOf(tokenId) == l.seller) revert NotOwner();
        delete listings[tokenId];
        emit Unlisted(tokenId);
    }

    /// @notice Buys a listed position.
    /// @param maxPrice Most MUSD the buyer will pay (equity prices move with BTC).
    /// @param maxDebt  Most debt the buyer will take on.
    /// @param minColl  Least BTC collateral the buyer will accept.
    function buy(uint256 tokenId, uint256 maxPrice, uint256 maxDebt, uint256 minColl)
        external
        nonReentrant
    {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (block.timestamp > l.expiry) revert Expired();
        if (positions.ownerOf(tokenId) != l.seller) revert StaleListing();

        (uint256 coll, uint256 debt, uint256 equity) = _checked(tokenId, maxDebt, minColl);
        uint256 price = _price(l, equity);
        if (price > maxPrice) revert PriceAboveMax(price, maxPrice);

        delete listings[tokenId];
        musd.safeTransferFrom(msg.sender, l.seller, price);
        positions.transferFrom(l.seller, msg.sender, tokenId);
        emit Sold(tokenId, l.seller, msg.sender, price, coll, debt);
    }

    // ----------------------------------------------------------------------
    // Offers
    // ----------------------------------------------------------------------

    /// @notice Escrows `amount` MUSD as an offer for a position, replacing
    ///         any earlier offer from the caller on it.
    function makeOffer(
        uint256 tokenId,
        uint256 amount,
        uint256 maxDebt,
        uint256 minColl,
        uint64 expiry
    ) external nonReentrant {
        if (expiry <= block.timestamp) revert Expired();
        positions.ownerOf(tokenId); // reverts for a token that doesn't exist
        uint256 previous = offers[tokenId][msg.sender].amount;
        offers[tokenId][msg.sender] = Offer(amount, maxDebt, minColl, expiry);

        if (amount > previous) musd.safeTransferFrom(msg.sender, address(this), amount - previous);
        else if (previous > amount) musd.safeTransfer(msg.sender, previous - amount);
        emit OfferMade(tokenId, msg.sender, amount, maxDebt, minColl, expiry);
    }

    function cancelOffer(uint256 tokenId) external nonReentrant {
        uint256 amount = offers[tokenId][msg.sender].amount;
        if (amount == 0) revert NoOffer();
        delete offers[tokenId][msg.sender];
        musd.safeTransfer(msg.sender, amount);
        emit OfferCancelled(tokenId, msg.sender);
    }

    /// @notice The position's holder sells it to `buyer` at their offer.
    /// @param minAmount Protects the seller if the buyer lowers their offer
    ///        in the same block.
    function acceptOffer(uint256 tokenId, address buyer, uint256 minAmount) external nonReentrant {
        if (positions.ownerOf(tokenId) != msg.sender) revert NotOwner();
        Offer memory o = offers[tokenId][buyer];
        if (o.amount == 0) revert NoOffer();
        if (o.amount < minAmount) revert OfferBelowMin(o.amount, minAmount);
        if (block.timestamp > o.expiry) revert Expired();

        (uint256 coll, uint256 debt,) = _checked(tokenId, o.maxDebt, o.minColl);

        delete offers[tokenId][buyer];
        delete listings[tokenId];
        musd.safeTransfer(msg.sender, o.amount);
        positions.transferFrom(msg.sender, buyer, tokenId);
        emit Sold(tokenId, msg.sender, buyer, o.amount, coll, debt);
    }

    // ----------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------

    /// @notice Everything a buyer needs to judge a position, at MUSD's price now.
    function quote(uint256 tokenId) external view returns (Quote memory q) {
        address account = address(positions.accountOf(tokenId));
        q.active = troveManager.getTroveStatus(account) == ITroveManager.Status.active;
        if (!q.active) return q;

        uint256 btcPrice = priceFeed.fetchPrice();
        (q.coll, q.debt) = TroveAccount(payable(account)).position();
        q.icr = troveManager.getCurrentICR(account, btcPrice);
        q.interestRate = troveManager.getTroveInterestRate(account);
        q.equity = _equity(q.coll, q.debt, btcPrice);

        Listing memory l = listings[tokenId];
        if (
            l.seller != address(0) && block.timestamp <= l.expiry
                && positions.ownerOf(tokenId) == l.seller && q.equity > 0
        ) {
            q.price = _price(l, q.equity);
        }
    }

    // ----------------------------------------------------------------------
    // Internal
    // ----------------------------------------------------------------------

    function _checked(uint256 tokenId, uint256 maxDebt, uint256 minColl)
        internal
        view
        returns (uint256 coll, uint256 debt, uint256 equity)
    {
        TroveAccount account = positions.accountOf(tokenId);
        if (troveManager.getTroveStatus(address(account)) != ITroveManager.Status.active) {
            revert TroveNotActive();
        }
        (coll, debt) = account.position();
        if (debt > maxDebt) revert DebtAboveMax(debt, maxDebt);
        if (coll < minColl) revert CollBelowMin(coll, minColl);
        equity = _equity(coll, debt, priceFeed.fetchPrice());
    }

    function _price(Listing memory l, uint256 equity) internal pure returns (uint256 price) {
        if (l.pricing == Pricing.Fixed) return l.value;
        if (equity == 0) revert NoEquity();
        price = equity * l.value / 10_000;
        if (price < l.minPrice) price = l.minPrice;
    }

    function _equity(uint256 coll, uint256 debt, uint256 btcPrice) internal pure returns (uint256) {
        uint256 value = coll * btcPrice / 1e18;
        return value > debt ? value - debt : 0;
    }

    function _approved(address owner, uint256 tokenId) internal view returns (bool) {
        return positions.getApproved(tokenId) == address(this)
            || positions.isApprovedForAll(owner, address(this));
    }
}

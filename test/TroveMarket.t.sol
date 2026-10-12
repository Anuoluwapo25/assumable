// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {TroveAccount} from "../src/TroveAccount.sol";
import {TroveMarket} from "../src/TroveMarket.sol";
import {TrovePositions} from "../src/TrovePositions.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";

import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {MockTroveManager} from "./mocks/MockTroveManager.sol";

contract TroveMarketTest is Test {
    MockMUSD musd;
    MockPriceFeed feed;
    MockTroveManager mezo;
    TrovePositions positions;
    TroveMarket market;

    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address stranger = makeAddr("stranger");

    // 0.1 BTC at $80k against 4,000 MUSD (+200 gas reserve): 190%.
    uint256 constant PRICE = 80_000e18;
    uint256 constant COLL = 0.1e18;
    uint256 constant BORROW = 4_000e18;
    uint256 constant DEBT = BORROW + 200e18;
    uint256 constant EQUITY = 8_000e18 - DEBT; // 3,800 MUSD

    uint256 id;
    TroveAccount account;

    function setUp() public {
        musd = new MockMUSD();
        feed = new MockPriceFeed(PRICE);
        mezo = new MockTroveManager(musd, feed);
        TroveAccount impl = new TroveAccount(
            IBorrowerOperations(address(mezo)), ITroveManager(address(mezo)), IERC20(address(musd))
        );
        positions = new TrovePositions(address(impl));
        market = new TroveMarket(
            positions,
            IERC20(address(musd)),
            ITroveManager(address(mezo)),
            IPriceFeed(address(feed))
        );

        vm.deal(seller, 1 ether);
        vm.deal(buyer, 1 ether);
        vm.prank(seller);
        (id, account) = positions.openPosition{value: COLL}(BORROW, address(0), address(0));

        musd.mint(buyer, 20_000e18);
        vm.prank(buyer);
        musd.approve(address(market), type(uint256).max);
        vm.prank(seller);
        positions.setApprovalForAll(address(market), true);
    }

    function _list(TroveMarket.Pricing pricing, uint256 value, uint256 minPrice) internal {
        vm.prank(seller);
        market.list(id, pricing, value, minPrice, uint64(block.timestamp + 7 days));
    }

    function _buy() internal {
        vm.prank(buyer);
        market.buy(id, type(uint256).max, type(uint256).max, 0);
    }

    // ---- positions & accounts ----------------------------------------------

    function test_openPositionOpensTroveOwnedByAccount() public view {
        assertEq(positions.ownerOf(id), seller);
        assertEq(address(positions.accountOf(id)), address(account));
        assertEq(positions.tokenOfAccount(address(account)), id);
        assertEq(uint8(mezo.getTroveStatus(address(account))), uint8(ITroveManager.Status.active));
        assertEq(musd.balanceOf(seller), BORROW, "borrowed MUSD goes to the holder");
        (uint256 coll, uint256 debt) = account.position();
        assertEq(coll, COLL);
        assertEq(debt, DEBT);
        assertEq(musd.balanceOf(address(account)), 0);
    }

    function test_onlyHolderControlsTheTrove() public {
        vm.startPrank(stranger);
        vm.expectRevert(TroveAccount.NotHolder.selector);
        account.withdrawColl(0.01e18, address(0), address(0));
        vm.expectRevert(TroveAccount.NotHolder.selector);
        account.borrow(1e18, address(0), address(0));
        vm.expectRevert(TroveAccount.NotHolder.selector);
        account.close();
        vm.expectRevert(TroveAccount.NotHolder.selector);
        account.refinance(address(0), address(0));
        vm.stopPrank();
    }

    function test_holderWithdrawsAndBorrowsToThemselves() public {
        uint256 btcBefore = seller.balance;
        vm.startPrank(seller);
        account.withdrawColl(0.01e18, address(0), address(0));
        account.borrow(500e18, address(0), address(0));
        vm.stopPrank();
        assertEq(seller.balance, btcBefore + 0.01e18);
        assertEq(musd.balanceOf(seller), BORROW + 500e18);
        assertEq(address(account).balance, 0);
    }

    function test_anyoneCanAddCollateralOrRepay() public {
        vm.prank(stranger);
        vm.deal(stranger, 1 ether);
        account.addColl{value: 0.05e18}(address(0), address(0));

        musd.mint(stranger, 100e18);
        vm.startPrank(stranger);
        musd.approve(address(account), 100e18);
        account.repay(100e18, address(0), address(0));
        vm.stopPrank();

        (uint256 coll, uint256 debt) = account.position();
        assertEq(coll, COLL + 0.05e18);
        assertEq(debt, DEBT - 100e18);
    }

    function test_closeRepaysFromHolderAndReturnsBTC() public {
        uint256 btcBefore = seller.balance;
        vm.startPrank(seller);
        musd.approve(address(account), DEBT - 200e18);
        account.close();
        vm.stopPrank();
        assertEq(musd.balanceOf(seller), 0);
        assertEq(seller.balance, btcBefore + COLL);
        assertEq(
            uint8(mezo.getTroveStatus(address(account))), uint8(ITroveManager.Status.closedByOwner)
        );
    }

    function test_surplusAfterRedemptionGoesToCurrentHolder() public {
        vm.prank(seller);
        positions.transferFrom(seller, buyer, id);
        mezo.redeemFully(address(account));

        uint256 before = buyer.balance;
        vm.prank(stranger);
        account.claimCollateral();
        // 0.1 BTC - 4,200 / 80,000
        assertEq(buyer.balance - before, COLL - DEBT * 1e18 / PRICE);
    }

    function test_accountCannotBeReinitialized() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        account.initialize(positions, 99);
    }

    // ---- the point: transferring the NFT transfers the Trove --------------

    function test_transferMovesControlAndKeepsLockedRate() public {
        mezo.setInterestRate(500); // governance raises the rate to 5%
        vm.prank(seller);
        positions.transferFrom(seller, buyer, id);

        assertEq(mezo.getTroveInterestRate(address(account)), 100, "still 1%");
        vm.prank(seller);
        vm.expectRevert(TroveAccount.NotHolder.selector);
        account.borrow(1e18, address(0), address(0));
        vm.prank(buyer);
        account.borrow(100e18, address(0), address(0));
        assertEq(musd.balanceOf(buyer), 20_000e18 + 100e18);

        vm.prank(stranger);
        vm.deal(stranger, 1 ether);
        (, TroveAccount fresh) = positions.openPosition{value: COLL}(BORROW, address(0), address(0));
        assertEq(mezo.getTroveInterestRate(address(fresh)), 500, "new Troves pay today's rate");
    }

    // ---- listings ------------------------------------------------------------

    function test_fixedPriceSale() public {
        _list(TroveMarket.Pricing.Fixed, 3_500e18, 0);
        _buy();

        assertEq(positions.ownerOf(id), buyer);
        assertEq(musd.balanceOf(seller), BORROW + 3_500e18);
        assertEq(musd.balanceOf(buyer), 20_000e18 - 3_500e18);
        (address listed,,,,) = market.listings(id);
        assertEq(listed, address(0), "listing cleared");
    }

    function test_equityPricingFollowsBTC() public {
        _list(TroveMarket.Pricing.EquityShare, 9_500, 0); // 95% of equity

        TroveMarket.Quote memory q = market.quote(id);
        assertEq(q.equity, EQUITY);
        assertEq(q.price, EQUITY * 9_500 / 10_000);
        assertEq(q.interestRate, 100);

        feed.setPrice(100_000e18); // equity: 10,000 - 4,200 = 5,800
        assertEq(market.quote(id).price, 5_800e18 * 9_500 / 10_000);

        uint256 before = musd.balanceOf(seller);
        _buy();
        assertEq(musd.balanceOf(seller) - before, 5_510e18);
    }

    function test_equityPricingRespectsFloor() public {
        _list(TroveMarket.Pricing.EquityShare, 9_500, 3_000e18);
        feed.setPrice(60_000e18); // equity 1,800: 95% = 1,710, under the floor
        assertEq(market.quote(id).price, 3_000e18);
    }

    function test_buyerLimitsBlockAWeakenedPosition() public {
        _list(TroveMarket.Pricing.Fixed, 3_500e18, 0);
        // After listing, the seller pulls BTC out and borrows more.
        vm.startPrank(seller);
        account.withdrawColl(0.02e18, address(0), address(0));
        account.borrow(500e18, address(0), address(0));
        vm.stopPrank();

        vm.startPrank(buyer);
        vm.expectRevert(abi.encodeWithSelector(TroveMarket.CollBelowMin.selector, 0.08e18, COLL));
        market.buy(id, 3_500e18, type(uint256).max, COLL);
        vm.expectRevert(
            abi.encodeWithSelector(TroveMarket.DebtAboveMax.selector, DEBT + 500e18, DEBT)
        );
        market.buy(id, 3_500e18, DEBT, 0);
        vm.stopPrank();
    }

    function test_maxPriceProtectsAgainstABTCRally() public {
        _list(TroveMarket.Pricing.EquityShare, 10_000, 0);
        feed.setPrice(120_000e18);
        uint256 price = market.quote(id).price;
        vm.prank(buyer);
        vm.expectRevert(abi.encodeWithSelector(TroveMarket.PriceAboveMax.selector, price, EQUITY));
        market.buy(id, EQUITY, type(uint256).max, 0);
    }

    function test_listingRequiresOwnerAndApproval() public {
        vm.prank(stranger);
        vm.expectRevert(TroveMarket.NotOwner.selector);
        market.list(id, TroveMarket.Pricing.Fixed, 1e18, 0, uint64(block.timestamp + 1));

        vm.startPrank(seller);
        positions.setApprovalForAll(address(market), false);
        vm.expectRevert(TroveMarket.NotApproved.selector);
        market.list(id, TroveMarket.Pricing.Fixed, 1e18, 0, uint64(block.timestamp + 1));
        vm.stopPrank();
    }

    function test_invalidPricingReverts() public {
        vm.startPrank(seller);
        vm.expectRevert(TroveMarket.InvalidPricing.selector);
        market.list(id, TroveMarket.Pricing.Fixed, 0, 0, uint64(block.timestamp + 1));
        vm.expectRevert(TroveMarket.InvalidPricing.selector);
        market.list(id, TroveMarket.Pricing.EquityShare, 20_001, 0, uint64(block.timestamp + 1));
        vm.stopPrank();
    }

    function test_staleListingAfterTransfer() public {
        _list(TroveMarket.Pricing.Fixed, 3_500e18, 0);
        vm.prank(seller);
        positions.transferFrom(seller, stranger, id);

        vm.prank(buyer);
        vm.expectRevert(TroveMarket.StaleListing.selector);
        market.buy(id, type(uint256).max, type(uint256).max, 0);
        assertEq(market.quote(id).price, 0);

        vm.prank(buyer); // anyone can clear a stale listing
        market.unlist(id);
    }

    function test_onlySellerUnlistsALiveListing() public {
        _list(TroveMarket.Pricing.Fixed, 3_500e18, 0);
        vm.prank(stranger);
        vm.expectRevert(TroveMarket.NotOwner.selector);
        market.unlist(id);
        vm.prank(seller);
        market.unlist(id);
    }

    function test_expiredListing() public {
        _list(TroveMarket.Pricing.Fixed, 3_500e18, 0);
        vm.warp(block.timestamp + 8 days);
        vm.prank(buyer);
        vm.expectRevert(TroveMarket.Expired.selector);
        market.buy(id, type(uint256).max, type(uint256).max, 0);
    }

    function test_liquidatedPositionCannotBeBought() public {
        _list(TroveMarket.Pricing.Fixed, 3_500e18, 0);
        feed.setPrice(45_000e18); // 4,500 / 4,200 = 107%
        mezo.liquidate(address(account));

        vm.prank(buyer);
        vm.expectRevert(TroveMarket.TroveNotActive.selector);
        market.buy(id, type(uint256).max, type(uint256).max, 0);
        assertFalse(market.quote(id).active);
    }

    // ---- offers ----------------------------------------------------------------

    function test_offerEscrowsAndSettles() public {
        vm.prank(buyer);
        market.makeOffer(id, 3_000e18, DEBT, COLL, uint64(block.timestamp + 1 days));
        assertEq(musd.balanceOf(address(market)), 3_000e18);

        vm.prank(seller);
        market.acceptOffer(id, buyer, 3_000e18);
        assertEq(positions.ownerOf(id), buyer);
        assertEq(musd.balanceOf(seller), BORROW + 3_000e18);
        assertEq(musd.balanceOf(address(market)), 0);
    }

    function test_offerCanBeRaisedLoweredAndCancelled() public {
        vm.startPrank(buyer);
        market.makeOffer(id, 3_000e18, DEBT, 0, uint64(block.timestamp + 1 days));
        market.makeOffer(id, 3_400e18, DEBT, 0, uint64(block.timestamp + 1 days));
        assertEq(musd.balanceOf(address(market)), 3_400e18);
        market.makeOffer(id, 2_000e18, DEBT, 0, uint64(block.timestamp + 1 days));
        assertEq(musd.balanceOf(address(market)), 2_000e18);
        market.cancelOffer(id);
        vm.stopPrank();
        assertEq(musd.balanceOf(buyer), 20_000e18);
        assertEq(musd.balanceOf(address(market)), 0);
    }

    function test_offerLimitsProtectBuyer() public {
        vm.prank(buyer);
        market.makeOffer(id, 3_000e18, DEBT, COLL, uint64(block.timestamp + 1 days));
        vm.startPrank(seller);
        account.withdrawColl(0.01e18, address(0), address(0));
        vm.expectRevert(abi.encodeWithSelector(TroveMarket.CollBelowMin.selector, 0.09e18, COLL));
        market.acceptOffer(id, buyer, 0);
        vm.stopPrank();
    }

    function test_minAmountProtectsSeller() public {
        vm.prank(buyer);
        market.makeOffer(id, 3_000e18, DEBT, 0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        vm.expectRevert(
            abi.encodeWithSelector(TroveMarket.OfferBelowMin.selector, 3_000e18, 3_100e18)
        );
        market.acceptOffer(id, buyer, 3_100e18);
    }

    function test_onlyHolderAcceptsOffers() public {
        vm.prank(buyer);
        market.makeOffer(id, 3_000e18, DEBT, 0, uint64(block.timestamp + 1 days));
        vm.prank(stranger);
        vm.expectRevert(TroveMarket.NotOwner.selector);
        market.acceptOffer(id, buyer, 0);
    }

    function test_acceptingAnOfferClearsTheListing() public {
        _list(TroveMarket.Pricing.Fixed, 3_500e18, 0);
        vm.prank(buyer);
        market.makeOffer(id, 3_200e18, DEBT, 0, uint64(block.timestamp + 1 days));
        vm.prank(seller);
        market.acceptOffer(id, buyer, 0);
        (address listed,,,,) = market.listings(id);
        assertEq(listed, address(0));
    }
}

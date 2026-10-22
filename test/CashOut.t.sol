// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {TroveAccount} from "../src/TroveAccount.sol";
import {TroveMarket} from "../src/TroveMarket.sol";
import {TrovePositions} from "../src/TrovePositions.sol";
import {IAssetsBridge} from "../src/interfaces/IAssetsBridge.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {IPoolRouter} from "../src/interfaces/IPoolRouter.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";
import {CashOutModule} from "../src/cashout/CashOutModule.sol";
import {CashOutOrder} from "../src/cashout/IOfframpAdapter.sol";
import {DirectMUSDAdapter} from "../src/cashout/DirectMUSDAdapter.sol";
import {OfframpAdapterBase} from "../src/cashout/OfframpAdapterBase.sol";
import {SwapBridgeAdapter} from "../src/cashout/SwapBridgeAdapter.sol";

import {MockAssetsBridge} from "./mocks/MockAssetsBridge.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockPoolRouter} from "./mocks/MockPoolRouter.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {MockTroveManager} from "./mocks/MockTroveManager.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CashOutTest is Test {
    MockMUSD musd;
    MockUSDC usdc;
    MockPriceFeed feed;
    MockTroveManager mezo;
    MockPoolRouter router;
    MockAssetsBridge bridge;
    TrovePositions positions;
    TroveMarket market;
    CashOutModule module;
    DirectMUSDAdapter direct;
    SwapBridgeAdapter swapBridge;

    address admin = makeAddr("admin");
    address user = makeAddr("user");
    address stranger = makeAddr("stranger");
    address provider = makeAddr("provider deposit");
    address signer;
    uint256 signerKey;

    // 0.2 BTC at $80k ($16,000) against 2,000 MUSD (+200 gas reserve): 13.75% LTV.
    uint256 constant PRICE = 80_000e18;
    uint256 constant COLL = 0.2e18;
    uint256 constant BORROW = 2_000e18;

    uint256 id;
    TroveAccount account;
    uint256 nonce;
    bytes32 domain;

    function setUp() public {
        (signer, signerKey) = makeAddrAndKey("order signer");
        musd = new MockMUSD();
        usdc = new MockUSDC();
        feed = new MockPriceFeed(PRICE);
        mezo = new MockTroveManager(musd, feed);
        router = new MockPoolRouter(musd, usdc);
        bridge = new MockAssetsBridge();
        bridge.setMinBridgeOutAmount(address(usdc), 20e6);

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
        module = new CashOutModule(
            positions, market, IPriceFeed(address(feed)), IERC20(address(musd)), signer, admin
        );
        direct = new DirectMUSDAdapter(address(module), IERC20(address(musd)), admin);
        swapBridge = new SwapBridgeAdapter(
            address(module),
            IERC20(address(musd)),
            IERC20(address(usdc)),
            IPoolRouter(address(router)),
            makeAddr("factory"),
            IAssetsBridge(address(bridge)),
            0,
            1_000e18,
            admin
        );
        domain = module.domainSeparator();
        vm.startPrank(admin);
        module.setAdapter(address(direct), true);
        module.setAdapter(address(swapBridge), true);
        vm.stopPrank();

        vm.deal(user, 10 ether);
        vm.deal(stranger, 10 ether);
        vm.startPrank(user);
        (id, account) = positions.openPosition{value: COLL}(BORROW, address(0), address(0));
        positions.setApprovalForAll(address(module), true);
        vm.stopPrank();
    }

    // ---- helpers -------------------------------------------------------------

    function _order(address adapter, uint256 tokenId, uint256 amount, uint256 minOut)
        internal
        returns (CashOutOrder memory o)
    {
        o = CashOutOrder({
            orderId: keccak256(abi.encode("order", nonce++)),
            tokenId: tokenId,
            owner: user,
            adapter: adapter,
            depositAddress: provider,
            musdAmount: amount,
            minOut: minOut,
            expiry: uint64(block.timestamp + 10 minutes)
        });
    }

    function _sign(CashOutOrder memory o) internal view returns (bytes memory) {
        return _signWith(signerKey, o);
    }

    /// The EIP-712 digest, built here rather than read from the module, so it
    /// also checks the module's hashing (and makes no call that would swallow
    /// a pending `vm.expectRevert`).
    function _digest(CashOutOrder memory o) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "CashOutOrder(bytes32 orderId,uint256 tokenId,address owner,address adapter,"
                    "address depositAddress,uint256 musdAmount,uint256 minOut,uint64 expiry)"
                ),
                o.orderId,
                o.tokenId,
                o.owner,
                o.adapter,
                o.depositAddress,
                o.musdAmount,
                o.minOut,
                o.expiry
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _signWith(uint256 key, CashOutOrder memory o) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _digest(o));
        return abi.encodePacked(r, s, v);
    }

    function _cashOut(CashOutOrder memory o) internal returns (uint256) {
        return _cashOutAs(user, 0, o, _sign(o));
    }

    function _cashOutAs(address who, uint256 btc, CashOutOrder memory o, bytes memory sig)
        internal
        returns (uint256)
    {
        vm.prank(who);
        return module.cashOut{value: btc}(o, sig, address(0), address(0));
    }

    function _expectNoResidue() internal view {
        assertEq(musd.balanceOf(address(module)), 0, "module keeps no MUSD");
        assertEq(musd.balanceOf(address(direct)), 0, "direct adapter keeps no MUSD");
        assertEq(musd.balanceOf(address(swapBridge)), 0, "swap adapter keeps no MUSD");
        assertEq(usdc.balanceOf(address(swapBridge)), 0, "swap adapter keeps no mUSDC");
        assertEq(musd.allowance(address(swapBridge), address(router)), 0, "no router approval");
        assertEq(usdc.allowance(address(swapBridge), address(bridge)), 0, "no bridge approval");
        assertEq(address(module).balance, 0, "module keeps no BTC");
    }

    // ---- happy paths ---------------------------------------------------------

    function test_digestMatchesModule() public {
        CashOutOrder memory o = _order(address(direct), id, 1e18, 0);
        assertEq(_digest(o), module.hashOrder(o));
    }

    function test_routeA_sendsMUSDToProvider() public {
        CashOutOrder memory o = _order(address(direct), id, 1_000e18, 1_000e18);
        vm.expectEmit(true, true, true, false, address(module));
        emit CashOutModule.CashOut(o.orderId, id, user, address(direct), 1_000e18, 1_000e18, 0);
        uint256 delivered = _cashOut(o);

        assertEq(delivered, 1_000e18);
        assertEq(musd.balanceOf(provider), 1_000e18);
        assertEq(musd.balanceOf(user), BORROW, "the user's own MUSD is untouched");
        assertEq(positions.ownerOf(id), user, "NFT returned");
        (, uint256 debt) = account.position();
        assertEq(debt, BORROW + 200e18 + 1_000e18);
        assertTrue(module.orderUsed(o.orderId));
        _expectNoResidue();
    }

    function test_routeB_swapsAndBridgesToEthereum() public {
        // 500 MUSD at 99.8% -> 499 mUSDC.
        CashOutOrder memory o = _order(address(swapBridge), id, 500e18, 495e6);
        uint256 delivered = _cashOut(o);

        assertEq(delivered, 499e6);
        assertEq(bridge.unlockCount(), 1);
        (address token, uint256 amount, uint8 chain, bytes memory recipient, address sender) =
            bridge.unlocks(0);
        assertEq(token, address(usdc));
        assertEq(amount, 499e6);
        assertEq(chain, 0, "Ethereum");
        assertEq(recipient, abi.encodePacked(provider));
        assertEq(sender, address(swapBridge));
        assertEq(usdc.totalSupply(), 0, "mUSDC burned by the bridge");
        _expectNoResidue();
    }

    function test_addsBTCThenBorrows() public {
        // 5,000 more MUSD alone would leave 7,200 / 16,000 = 45% LTV.
        CashOutOrder memory o = _order(address(direct), id, 5_000e18, 0);
        _cashOutAs(user, 0.1 ether, o, _sign(o));
        (uint256 coll, uint256 debt) = account.position();
        assertEq(coll, COLL + 0.1 ether);
        assertEq(debt, 7_200e18); // 30% of $24,000
        _expectNoResidue();
    }

    function test_openAndCashOut_newUserGetsPositionAndSurplus() public {
        address fresh = makeAddr("fresh");
        vm.deal(fresh, 1 ether);
        CashOutOrder memory o = _order(address(direct), 0, 300e18, 300e18);
        o.owner = fresh;
        bytes memory sig = _sign(o);

        vm.prank(fresh);
        (uint256 newId, uint256 delivered) =
            module.openAndCashOut{value: 0.1 ether}(o, sig, 1_800e18, address(0), address(0));

        assertEq(delivered, 300e18);
        assertEq(positions.ownerOf(newId), fresh);
        assertEq(musd.balanceOf(provider), 300e18);
        assertEq(musd.balanceOf(fresh), 1_500e18, "minimum-loan surplus to the wallet");
        (uint256 coll, uint256 debt) = positions.accountOf(newId).position();
        assertEq(coll, 0.1 ether);
        assertEq(debt, 2_000e18);
        _expectNoResidue();
    }

    // ---- safety cap ----------------------------------------------------------

    function test_ltvCapRejects() public {
        CashOutOrder memory o = _order(address(direct), id, 5_000e18, 0);
        vm.expectRevert(abi.encodeWithSelector(CashOutModule.LtvAboveMax.selector, 4_500, 4_000));
        _cashOut(o);
        assertEq(positions.ownerOf(id), user);
    }

    function test_ltvCapAtBoundary() public {
        // Exactly 40%: 6,400 debt against $16,000.
        CashOutOrder memory o = _order(address(direct), id, 4_200e18, 0);
        _cashOut(o);
        (, uint256 debt) = account.position();
        assertEq(debt * 10_000 / 16_000e18, 4_000);
    }

    function test_ltvCapFollowsPrice() public {
        feed.setPrice(50_000e18); // 2,200 + 1,000 against $10,000 = 32%
        _cashOut(_order(address(direct), id, 1_000e18, 0));
        feed.setPrice(40_000e18); // 3,200 + 100 against $8,000 = 41.25%
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(abi.encodeWithSelector(CashOutModule.LtvAboveMax.selector, 4_125, 4_000));
        _cashOut(o);
    }

    function test_openAndCashOutRespectsCap() public {
        address fresh = makeAddr("fresh");
        vm.deal(fresh, 1 ether);
        CashOutOrder memory o = _order(address(direct), 0, 300e18, 0);
        o.owner = fresh;
        bytes memory sig = _sign(o);
        // 0.05 BTC = $4,000 against 2,000 debt: 50%.
        vm.prank(fresh);
        vm.expectRevert(abi.encodeWithSelector(CashOutModule.LtvAboveMax.selector, 5_000, 4_000));
        module.openAndCashOut{value: 0.05 ether}(o, sig, 1_800e18, address(0), address(0));
    }

    function test_maxLtvHasHardCeiling() public {
        vm.startPrank(admin);
        vm.expectRevert(CashOutModule.InvalidLtv.selector);
        module.setMaxLtvBps(6_001);
        vm.expectRevert(CashOutModule.InvalidLtv.selector);
        module.setMaxLtvBps(0);
        module.setMaxLtvBps(2_500);
        vm.stopPrank();
        assertEq(module.maxLtvBps(), 2_500);

        vm.prank(stranger);
        vm.expectRevert();
        module.setMaxLtvBps(5_000);
    }

    // ---- slippage and minimums -----------------------------------------------

    function test_slippageRejects() public {
        router.setRateBps(9_000); // the pool moved: 500 MUSD now buys 450 mUSDC
        CashOutOrder memory o = _order(address(swapBridge), id, 500e18, 495e6);
        vm.expectRevert(IPoolRouter.InsufficientOutputAmount.selector);
        _cashOut(o);
        _expectNoResidue();
    }

    function test_moduleEnforcesMinOutEvenIfAdapterDoesNot() public {
        // Route A delivers musdAmount; asking for more must fail in the module.
        CashOutOrder memory o = _order(address(direct), id, 100e18, 101e18);
        vm.expectRevert(
            abi.encodeWithSelector(CashOutModule.DeliveredBelowMin.selector, 100e18, 101e18)
        );
        _cashOut(o);
    }

    function test_routeBRejectsBelowBridgeMinimum() public {
        // 20 MUSD -> 19.96 mUSDC, under the bridge's 20 mUSDC minimum.
        CashOutOrder memory o = _order(address(swapBridge), id, 20e18, 0);
        vm.expectRevert(
            abi.encodeWithSelector(SwapBridgeAdapter.BelowBridgeMin.selector, 19.96e6, 20e6)
        );
        _cashOut(o);
    }

    function test_routeBOwnFloorAppliesAboveGovernanceMinimum() public {
        vm.prank(admin);
        swapBridge.setLimits(50e6, 1_000e18);
        assertEq(swapBridge.bridgeMinimum(), 50e6);
        CashOutOrder memory o = _order(address(swapBridge), id, 40e18, 0);
        vm.expectRevert(
            abi.encodeWithSelector(SwapBridgeAdapter.BelowBridgeMin.selector, 39.92e6, 50e6)
        );
        _cashOut(o);
    }

    function test_routeBCapsOrderSize() public {
        CashOutOrder memory o = _order(address(swapBridge), id, 1_001e18, 0);
        vm.expectRevert(
            abi.encodeWithSelector(SwapBridgeAdapter.AboveMaxIn.selector, 1_001e18, 1_000e18)
        );
        _cashOut(o);
    }

    function test_routeBRejectsPartialSwap() public {
        router.setPullLess(true);
        CashOutOrder memory o = _order(address(swapBridge), id, 500e18, 0);
        vm.expectRevert(SwapBridgeAdapter.SwapIncomplete.selector);
        _cashOut(o);
    }

    // ---- who may cash out ----------------------------------------------------

    function test_nonOwnerRejected() public {
        // A valid order for the user, sent by someone else.
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        bytes memory sig = _sign(o);
        vm.expectRevert(CashOutModule.NotOwner.selector);
        _cashOutAs(stranger, 0, o, sig);

        // A valid order made out to the stranger, against the user's position.
        o.owner = stranger;
        sig = _sign(o);
        vm.expectRevert(CashOutModule.NotOwner.selector);
        _cashOutAs(stranger, 0, o, sig);
    }

    function test_formerOwnerRejectedAfterSale() public {
        vm.prank(user);
        positions.transferFrom(user, stranger, id);
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(CashOutModule.NotOwner.selector);
        _cashOut(o);
    }

    function test_requiresNFTApproval() public {
        vm.prank(user);
        positions.setApprovalForAll(address(module), false);
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert();
        _cashOut(o);
    }

    // ---- listing lock --------------------------------------------------------

    function test_blockedWhileListed() public {
        vm.startPrank(user);
        positions.setApprovalForAll(address(market), true);
        market.list(id, TroveMarket.Pricing.Fixed, 1_000e18, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();

        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(CashOutModule.Listed.selector);
        _cashOut(o);

        vm.prank(user);
        market.unlist(id);
        _cashOut(o);
    }

    function test_expiredListingDoesNotBlock() public {
        vm.startPrank(user);
        positions.setApprovalForAll(address(market), true);
        market.list(id, TroveMarket.Pricing.Fixed, 1_000e18, 0, uint64(block.timestamp + 1 hours));
        vm.stopPrank();
        vm.warp(block.timestamp + 2 hours);
        _cashOut(_order(address(direct), id, 100e18, 0));
    }

    // ---- adapters and orders -------------------------------------------------

    function test_adapterAllowlistEnforced() public {
        vm.prank(admin);
        module.setAdapter(address(direct), false);
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(CashOutModule.AdapterNotAllowed.selector);
        _cashOut(o);

        // An adapter the admin never approved, even with a valid signature.
        DirectMUSDAdapter rogue =
            new DirectMUSDAdapter(address(module), IERC20(address(musd)), stranger);
        o = _order(address(rogue), id, 100e18, 0);
        vm.expectRevert(CashOutModule.AdapterNotAllowed.selector);
        _cashOut(o);

        vm.prank(stranger);
        vm.expectRevert();
        module.setAdapter(address(rogue), true);
    }

    function test_userCannotChooseDestination() public {
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        bytes memory sig = _sign(o);
        o.depositAddress = stranger; // tampered after signing
        vm.expectRevert(CashOutModule.BadSignature.selector);
        _cashOutAs(user, 0, o, sig);
    }

    function test_onlyOrderSignerSigns() public {
        (, uint256 otherKey) = makeAddrAndKey("not the signer");
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(CashOutModule.BadSignature.selector);
        _cashOutAs(user, 0, o, _signWith(otherKey, o));

        vm.expectRevert(CashOutModule.BadSignature.selector);
        _cashOutAs(user, 0, o, hex"deadbeef");
    }

    function test_orderCannotBeReplayed() public {
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        bytes memory sig = _sign(o);
        _cashOutAs(user, 0, o, sig);
        vm.expectRevert(CashOutModule.OrderAlreadyUsed.selector);
        _cashOutAs(user, 0, o, sig);
    }

    function test_expiredOrderRejected() public {
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        bytes memory sig = _sign(o);
        vm.warp(o.expiry + 1);
        vm.expectRevert(CashOutModule.OrderExpired.selector);
        _cashOutAs(user, 0, o, sig);
    }

    function test_orderWrongShapeRejected() public {
        CashOutOrder memory o = _order(address(direct), 0, 100e18, 0);
        vm.expectRevert(CashOutModule.InvalidOrder.selector);
        _cashOut(o); // tokenId 0 belongs to openAndCashOut

        o = _order(address(direct), id, 0, 0);
        vm.expectRevert(CashOutModule.ZeroAmount.selector);
        _cashOut(o);
    }

    function test_adaptersOnlyTakeOrdersFromModule() public {
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        musd.mint(address(direct), 100e18);
        vm.prank(stranger);
        vm.expectRevert(OfframpAdapterBase.NotModule.selector);
        direct.payout(o);
    }

    function test_destinationAllowlist() public {
        vm.startPrank(admin);
        direct.setRestrictDestinations(true);
        vm.stopPrank();
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(
            abi.encodeWithSelector(OfframpAdapterBase.DestinationNotAllowed.selector, provider)
        );
        _cashOut(o);

        vm.prank(admin);
        direct.setDestination(provider, true);
        _cashOut(o);
        assertEq(musd.balanceOf(provider), 100e18);
    }

    function test_strayMUSDDoesNotBlockCashOuts() public {
        musd.mint(address(module), 1);
        musd.mint(address(swapBridge), 1);
        _cashOut(_order(address(direct), id, 100e18, 0));
        _cashOut(_order(address(swapBridge), id, 100e18, 0));
    }

    // ---- pause and repay -----------------------------------------------------

    function test_pauseStopsCashOutButNotRepay() public {
        vm.prank(admin);
        module.pause();
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _cashOut(o);

        vm.startPrank(user);
        musd.approve(address(module), 500e18);
        module.repay(id, 500e18, bytes32("onramp-1"), address(0), address(0));
        vm.stopPrank();
        (, uint256 debt) = account.position();
        assertEq(debt, BORROW + 200e18 - 500e18);
    }

    function test_repayFromOnramp() public {
        address payer = makeAddr("onramp float");
        musd.mint(payer, 700e18);
        vm.startPrank(payer);
        musd.approve(address(module), 700e18);
        vm.expectEmit(true, true, true, true, address(module));
        emit CashOutModule.Repaid(bytes32("onramp-7"), id, payer, 700e18);
        module.repay(id, 700e18, bytes32("onramp-7"), address(0), address(0));
        vm.stopPrank();

        (, uint256 debt) = account.position();
        assertEq(debt, BORROW + 200e18 - 700e18);
        assertEq(musd.allowance(address(module), address(account)), 0, "no lingering approval");
        assertEq(musd.balanceOf(address(module)), 0);
    }

    function test_repayUnknownPosition() public {
        vm.expectRevert(CashOutModule.NoPosition.selector);
        module.repay(999, 1e18, bytes32(0), address(0), address(0));
    }

    // ---- composes with the market ---------------------------------------------

    function test_cashedOutPositionCanStillBeSold() public {
        _cashOut(_order(address(direct), id, 1_000e18, 0));
        address buyer = makeAddr("buyer");
        musd.mint(buyer, 20_000e18);

        vm.startPrank(user);
        positions.setApprovalForAll(address(market), true);
        market.list(id, TroveMarket.Pricing.EquityShare, 9_500, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();
        vm.startPrank(buyer);
        musd.approve(address(market), type(uint256).max);
        market.buy(id, type(uint256).max, type(uint256).max, 0);
        vm.stopPrank();
        assertEq(positions.ownerOf(id), buyer);

        // The seller's module approval doesn't reach the buyer's position.
        CashOutOrder memory o = _order(address(direct), id, 100e18, 0);
        vm.expectRevert(CashOutModule.NotOwner.selector);
        _cashOut(o);
    }
}

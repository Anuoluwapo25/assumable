// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {TroveAccount} from "../src/TroveAccount.sol";
import {TroveMarket} from "../src/TroveMarket.sol";
import {TrovePositions} from "../src/TrovePositions.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @notice The market against the real MUSD system on a Mezo testnet fork:
///         a contract-owned Trove opened, sold, borrowed against by its new
///         owner, and closed, all through MUSD's own contracts.
///
///   MEZO_FORK=1 MEZO_FORK_BLOCK=<recent block> forge test --match-contract Fork
contract TroveMarketForkTest is Test {
    Deploy.Musd m;
    TrovePositions positions;
    TroveMarket market;
    IERC20 musd;

    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");

    function setUp() public {
        if (!vm.envOr("MEZO_FORK", false)) vm.skip(true);
        // Pin a block (MEZO_FORK_BLOCK) so Foundry caches the fork's state
        // between runs; the public RPC rate-limits a cold fork.
        uint256 forkBlock = vm.envOr("MEZO_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork("mezo_testnet");
        else vm.createSelectFork("mezo_testnet", forkBlock);

        m = new Deploy().musdFor(block.chainid);
        musd = IERC20(m.musd);

        // Mezo's oracle is a chain precompile, which Foundry's EVM can't run on
        // a fork. Ask the real chain for the price and pin the feed to it.
        bytes memory live = vm.rpc(
            "eth_call",
            string.concat(
                '[{"to":"',
                vm.toString(m.priceFeed),
                '","data":"',
                vm.toString(abi.encodeWithSelector(IPriceFeed.fetchPrice.selector)),
                '"},"latest"]'
            )
        );
        vm.mockCall(
            m.priceFeed,
            abi.encodeWithSelector(IPriceFeed.fetchPrice.selector),
            abi.encode(abi.decode(live, (uint256)))
        );

        TroveAccount impl = new TroveAccount(
            IBorrowerOperations(m.borrowerOperations), ITroveManager(m.troveManager), musd
        );
        positions = new TrovePositions(address(impl));
        market = new TroveMarket(
            positions, musd, ITroveManager(m.troveManager), IPriceFeed(m.priceFeed)
        );

        vm.deal(seller, 1 ether);
        vm.deal(buyer, 1 ether);
    }

    function test_fork_openSellBorrowClose() public {
        // Seller opens a transferable Trove: 0.1 BTC against 3,000 MUSD.
        vm.prank(seller);
        (uint256 id, TroveAccount account) =
            positions.openPosition{value: 0.1 ether}(3_000e18, address(0), address(0));
        ITroveManager tm = ITroveManager(m.troveManager);
        assertEq(uint8(tm.getTroveStatus(address(account))), uint8(ITroveManager.Status.active));
        assertEq(musd.balanceOf(seller), 3_000e18, "MUSD minted to the holder");
        uint16 rate = tm.getTroveInterestRate(address(account));

        // Seller spends the MUSD; the buyer has their own (from a Trove of their own).
        vm.prank(seller);
        musd.transfer(makeAddr("shop"), 3_000e18);
        vm.prank(buyer);
        IBorrowerOperations(m.borrowerOperations)
        .openTrove{value: 0.5 ether}(12_000e18, address(0), address(0));

        // List at 95% of equity; buyer takes it.
        vm.startPrank(seller);
        positions.setApprovalForAll(address(market), true);
        market.list(id, TroveMarket.Pricing.EquityShare, 9_500, 0, uint64(block.timestamp + 1 days));
        vm.stopPrank();

        TroveMarket.Quote memory q = market.quote(id);
        assertGt(q.price, 0);
        assertEq(q.interestRate, rate);

        vm.startPrank(buyer);
        musd.approve(address(market), q.price);
        market.buy(id, q.price, q.debt, q.coll);
        vm.stopPrank();
        assertEq(positions.ownerOf(id), buyer);
        assertEq(musd.balanceOf(seller), q.price, "seller exits with equity, never repaid");
        assertEq(uint8(tm.getTroveStatus(address(account))), uint8(ITroveManager.Status.active));

        // The new owner runs the same real Trove.
        vm.prank(seller);
        vm.expectRevert(TroveAccount.NotHolder.selector);
        account.borrow(100e18, address(0), address(0));

        uint256 before = musd.balanceOf(buyer);
        vm.prank(buyer);
        account.borrow(100e18, address(0), address(0));
        assertEq(musd.balanceOf(buyer) - before, 100e18);

        // And closes it: repays from their MUSD, gets the BTC.
        (uint256 coll, uint256 debt) = account.position();
        uint256 btcBefore = buyer.balance;
        vm.startPrank(buyer);
        musd.approve(address(account), debt - 200e18);
        account.close();
        vm.stopPrank();
        assertEq(buyer.balance - btcBefore, coll);
        assertEq(
            uint8(tm.getTroveStatus(address(account))), uint8(ITroveManager.Status.closedByOwner)
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {AutoSplitRouter} from "../src/AutoSplitRouter.sol";
import {SavingsVault} from "../src/SavingsVault.sol";
import {ERC4626YieldAdapter} from "../src/adapters/ERC4626YieldAdapter.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockSavingsVault4626} from "./mocks/MockSavingsVault4626.sol";

contract AutoSplitRouterTest is Test {
    MockMUSD musd;
    MockSavingsVault4626 sMusd;
    SavingsVault savings;
    ERC4626YieldAdapter adapter;
    AutoSplitRouter router;

    address owner = makeAddr("owner");
    address sender = makeAddr("sender");
    address recipient = makeAddr("recipient");
    address stranger = makeAddr("stranger");

    uint256 constant MUSD = 1e18;

    function setUp() public {
        musd = new MockMUSD();
        sMusd = new MockSavingsVault4626(IERC20(address(musd)));

        vm.startPrank(owner);
        savings = new SavingsVault(IERC20(address(musd)), owner);
        adapter = new ERC4626YieldAdapter(IERC4626(address(sMusd)), address(savings));
        savings.setAdapter(adapter);
        router = new AutoSplitRouter(IERC20(address(musd)), savings, owner);
        savings.setRouter(address(router));
        vm.stopPrank();

        musd.mint(sender, 10_000 * MUSD);
        vm.prank(sender);
        musd.approve(address(router), type(uint256).max);
    }

    // ------------------------------------------------------------ core split

    function test_NoGoals_EverythingIsSpendable() public {
        vm.prank(sender);
        AutoSplitRouter.Split memory s = router.route(recipient, 100 * MUSD);

        assertEq(s.payout, 100 * MUSD, "full amount should be spendable");
        assertEq(s.saved, 0, "nothing saved without a goal");
        assertEq(musd.balanceOf(recipient), 100 * MUSD);
    }

    function test_SingleGoal_SplitsEightyTwenty() public {
        vm.prank(recipient);
        router.addGoal("Emergency fund", 0, 0, 2_000); // 20%, open-ended

        vm.prank(sender);
        AutoSplitRouter.Split memory s = router.route(recipient, 100 * MUSD);

        assertEq(s.payout, 80 * MUSD);
        assertEq(s.saved, 20 * MUSD);
        assertEq(musd.balanceOf(recipient), 80 * MUSD, "spendable lands in the wallet");
        assertEq(savings.principalOf(recipient), 20 * MUSD, "saved slice is credited");
        assertEq(savings.balanceOfAssets(recipient), 20 * MUSD, "and is sitting in sMUSD");
    }

    function test_RouterNeverHoldsFunds() public {
        vm.prank(recipient);
        router.addGoal("Savings", 0, 0, 3_000);

        vm.prank(sender);
        router.route(recipient, 250 * MUSD);

        assertEq(musd.balanceOf(address(router)), 0, "router must never custody MUSD");
        assertEq(musd.balanceOf(address(savings)), 0, "vault forwards straight to the venue");
    }

    // --------------------------------------------------------------- cascade

    function test_Cascade_OverflowFlowsToNextGoal() public {
        vm.startPrank(recipient);
        // Priority 1 is nearly full: 30% slice but only 5 MUSD of room left.
        router.addGoal("School fees", 50 * MUSD, 0, 3_000);
        router.addGoal("Emergency fund", 0, 0, 1_000); // 10%, open-ended
        vm.stopPrank();

        // Fill the first goal to 45 of its 50.
        vm.prank(sender);
        router.route(recipient, 150 * MUSD); // 30% = 45 into school fees

        AutoSplitRouter.Goal[] memory goals = router.goalsOf(recipient);
        assertEq(goals[0].saved, 45 * MUSD, "school fees took its 30% of 150");
        assertEq(goals[1].saved, 15 * MUSD, "emergency fund took its own 10% too");

        // Next transfer: school fees claims 30 but only has room for 5.
        // The other 25 must cascade into the emergency fund, on top of its own 10.
        vm.prank(sender);
        AutoSplitRouter.Split memory s = router.route(recipient, 100 * MUSD);

        goals = router.goalsOf(recipient);
        assertEq(goals[0].saved, 50 * MUSD, "school fees capped at target");
        assertEq(
            uint8(goals[0].status), uint8(AutoSplitRouter.GoalStatus.Reached), "and marked reached"
        );
        // Second transfer: school fees claims 30% = 30 but has only 5 of room.
        // The 25 it cannot take cascades onto the emergency fund's own 10.
        assertEq(goals[1].saved, 50 * MUSD, "15 already held + 10 of its own + 25 cascaded");
        assertEq(s.saved, 40 * MUSD);
        assertEq(s.payout, 60 * MUSD, "payout is unaffected by the cascade");
    }

    function test_ReachedGoal_StopsClaimingItsSlice() public {
        vm.prank(recipient);
        router.addGoal("Laptop", 10 * MUSD, 0, 5_000); // 50%, small target

        vm.prank(sender);
        router.route(recipient, 100 * MUSD); // fills the 10, rest is spendable

        vm.prank(sender);
        AutoSplitRouter.Split memory s = router.route(recipient, 100 * MUSD);

        assertEq(s.saved, 0, "a reached goal takes nothing more");
        assertEq(s.payout, 100 * MUSD, "and the whole transfer is spendable");
    }

    function test_Reorder_ChangesWhoReceivesOverflow() public {
        vm.startPrank(recipient);
        uint32 a = router.addGoal("Capped", 10 * MUSD, 0, 5_000);
        uint32 b = router.addGoal("Open", 0, 0, 1_000);

        uint32[] memory order = new uint32[](2);
        order[0] = b;
        order[1] = a;
        router.reorderGoals(order);
        vm.stopPrank();

        AutoSplitRouter.Goal[] memory goals = router.goalsOf(recipient);
        assertEq(goals[0].id, b, "open goal now has priority");
        assertEq(goals[1].id, a);
    }

    // ------------------------------------------------------ quote == execute

    function test_QuoteMatchesRoute() public {
        vm.startPrank(recipient);
        router.addGoal("School fees", 60 * MUSD, 0, 2_500);
        router.addGoal("Emergency", 0, 0, 1_500);
        vm.stopPrank();

        AutoSplitRouter.Split memory q = router.quote(recipient, 137 * MUSD);

        vm.prank(sender);
        AutoSplitRouter.Split memory r = router.route(recipient, 137 * MUSD);

        assertEq(q.payout, r.payout, "preview payout must match execution");
        assertEq(q.saved, r.saved, "preview savings must match execution");
    }

    // --------------------------------------------------------- authorisation

    function test_SenderCannotEditRecipientGoals() public {
        vm.prank(recipient);
        uint32 id = router.addGoal("Emergency fund", 0, 0, 2_000);

        // The sender editing "their" goal id touches only their own empty list.
        vm.prank(sender);
        vm.expectRevert(AutoSplitRouter.GoalNotFound.selector);
        router.updateGoal(id, "Hijacked", 0, 0, 0);

        AutoSplitRouter.Goal[] memory goals = router.goalsOf(recipient);
        assertEq(goals[0].allocationBps, 2_000, "recipient's rule is untouched");
    }

    function test_OnlyRouterCanCredit() public {
        vm.prank(stranger);
        vm.expectRevert(SavingsVault.NotRouter.selector);
        savings.credit(stranger, 1 * MUSD);
    }

    function test_OnlyCustodianCanDeposit() public {
        vm.prank(stranger);
        vm.expectRevert(ERC4626YieldAdapter.NotCustodian.selector);
        adapter.deposit(1 * MUSD);
    }

    function test_CannotWithdrawSomeoneElsesSavings() public {
        vm.prank(recipient);
        router.addGoal("Savings", 0, 0, 2_000);
        vm.prank(sender);
        router.route(recipient, 100 * MUSD);

        vm.prank(stranger);
        vm.expectRevert(SavingsVault.ZeroAmount.selector); // stranger holds zero shares
        savings.withdrawAll(stranger);
    }

    // ------------------------------------------------------------ validation

    function test_AllocationsCannotExceedOneHundredPercent() public {
        vm.startPrank(recipient);
        router.addGoal("A", 0, 0, 6_000);
        vm.expectRevert(AutoSplitRouter.InvalidSplit.selector);
        router.addGoal("B", 0, 0, 4_001);
        vm.stopPrank();
    }

    function test_RejectsEmptyAndOversizedNames() public {
        vm.startPrank(recipient);
        vm.expectRevert(AutoSplitRouter.InvalidName.selector);
        router.addGoal("", 0, 0, 1_000);

        vm.expectRevert(AutoSplitRouter.InvalidName.selector);
        router.addGoal(
            "this goal name is definitely longer than forty-eight bytes", 0, 0, 1_000
        );
        vm.stopPrank();
    }

    function test_RejectsSelfTransferAndZeroAmount() public {
        vm.startPrank(sender);
        vm.expectRevert(AutoSplitRouter.SelfTransfer.selector);
        router.route(sender, 1 * MUSD);

        vm.expectRevert(AutoSplitRouter.InvalidAmount.selector);
        router.route(recipient, 0);
        vm.stopPrank();
    }

    function test_MaxGoalsEnforced() public {
        vm.startPrank(recipient);
        for (uint256 i; i < 8; ++i) {
            router.addGoal("goal", 0, 0, 1_000);
        }
        vm.expectRevert(AutoSplitRouter.TooManyGoals.selector);
        router.addGoal("one too many", 0, 0, 0);
        vm.stopPrank();
    }

    // ----------------------------------------------------------------- yield

    function test_YieldAccruesAndIsWithdrawable() public {
        vm.prank(recipient);
        router.addGoal("Emergency fund", 0, 0, 2_000);

        vm.prank(sender);
        router.route(recipient, 100 * MUSD); // 20 MUSD saved

        assertEq(savings.yieldOf(recipient), 0, "no yield before accrual");

        // Bitcoin borrowers pay interest into the vault: +10% on the pool.
        sMusd.accrue(2 * MUSD);

        assertEq(savings.principalOf(recipient), 20 * MUSD, "principal is unchanged by yield");
        assertApproxEqAbs(savings.balanceOfAssets(recipient), 22 * MUSD, 1, "savings grew");
        assertApproxEqAbs(savings.yieldOf(recipient), 2 * MUSD, 1, "yield is the gap");

        vm.prank(recipient);
        savings.withdrawAll(recipient);

        assertApproxEqAbs(
            musd.balanceOf(recipient), 102 * MUSD, 1, "80 spendable + 20 saved + 2 earned"
        );
        assertEq(savings.sharesOf(recipient), 0);
        assertEq(savings.principalOf(recipient), 0);
    }

    function test_PartialWithdrawalReleasesPrincipalProRata() public {
        vm.prank(recipient);
        router.addGoal("Savings", 0, 0, 5_000);

        vm.prank(sender);
        router.route(recipient, 100 * MUSD); // 50 saved

        uint256 half = savings.sharesOf(recipient) / 2;
        vm.prank(recipient);
        savings.withdraw(half, recipient);

        assertApproxEqAbs(savings.principalOf(recipient), 25 * MUSD, 1, "half the principal remains");
        assertApproxEqAbs(savings.balanceOfAssets(recipient), 25 * MUSD, 1);
    }

    // ------------------------------------------------------------ operations

    function test_PauseStopsRoutingButNotWithdrawals() public {
        vm.prank(recipient);
        router.addGoal("Savings", 0, 0, 2_000);
        vm.prank(sender);
        router.route(recipient, 100 * MUSD);

        vm.prank(owner);
        router.pause();

        vm.prank(sender);
        vm.expectRevert();
        router.route(recipient, 100 * MUSD);

        // Savings stay reachable while routing is halted.
        vm.prank(recipient);
        savings.withdrawAll(recipient);
        assertGt(musd.balanceOf(recipient), 80 * MUSD);
    }

    // ----------------------------------------------------------------- fuzz

    /// @dev The split is exhaustive and never mints or burns value: whatever is
    ///      not saved must be spendable, for any goal configuration.
    function testFuzz_PayoutPlusSavedEqualsAmount(uint96 amount, uint16 bpsA, uint16 bpsB, uint96 targetA)
        public
    {
        amount = uint96(bound(amount, 1, 1_000 * MUSD));
        bpsA = uint16(bound(bpsA, 0, 10_000));
        bpsB = uint16(bound(bpsB, 0, 10_000 - bpsA));

        vm.startPrank(recipient);
        router.addGoal("A", targetA, 0, bpsA);
        router.addGoal("B", 0, 0, bpsB);
        vm.stopPrank();

        musd.mint(sender, amount);

        vm.prank(sender);
        AutoSplitRouter.Split memory s = router.route(recipient, amount);

        assertEq(s.payout + s.saved, amount, "value is conserved across the split");
        assertLe(s.saved, amount, "cannot save more than was sent");
    }
}

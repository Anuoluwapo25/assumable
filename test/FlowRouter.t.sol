// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {FlowRouter} from "../src/FlowRouter.sol";
import {ISink} from "../src/interfaces/ISink.sol";
import {SavingsSink} from "../src/sinks/SavingsSink.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockSavingsVault4626} from "./mocks/MockSavingsVault4626.sol";
import {CappedSink} from "./mocks/CappedSink.sol";
import {HostileSink} from "./mocks/HostileSink.sol";

contract FlowRouterTest is Test {
    MockMUSD musd;
    MockSavingsVault4626 sMusd;
    FlowRouter router;
    SavingsSink savings;
    CappedSink debtLike;

    address payer = makeAddr("payer");
    address recipient = makeAddr("recipient");
    address stranger = makeAddr("stranger");

    uint256 constant ONE = 1e18;
    bytes32 constant SAVE = keccak256("savings");
    bytes32 constant DEBT = keccak256("debt");

    function setUp() public {
        musd = new MockMUSD();
        sMusd = new MockSavingsVault4626(IERC20(address(musd)));
        router = new FlowRouter(IERC20(address(musd)));
        savings = new SavingsSink(IERC4626(address(sMusd)));
        debtLike = new CappedSink(IERC20(address(musd)));

        musd.mint(payer, 100_000 * ONE);
        vm.prank(payer);
        musd.approve(address(router), type(uint256).max);
    }

    // ------------------------------------------------------------- helpers

    function _leg(ISink sink, uint16 bps, bytes32 ref, uint256 cap)
        internal
        pure
        returns (FlowRouter.Leg memory)
    {
        return FlowRouter.Leg({sink: sink, bps: bps, ref: ref, cap: cap});
    }

    function _setPolicy(address who, FlowRouter.Leg[] memory legs) internal {
        vm.prank(who);
        router.setPolicy(legs);
    }

    function _one(FlowRouter.Leg memory a) internal pure returns (FlowRouter.Leg[] memory legs) {
        legs = new FlowRouter.Leg[](1);
        legs[0] = a;
    }

    function _two(FlowRouter.Leg memory a, FlowRouter.Leg memory b)
        internal
        pure
        returns (FlowRouter.Leg[] memory legs)
    {
        legs = new FlowRouter.Leg[](2);
        legs[0] = a;
        legs[1] = b;
    }

    // ---------------------------------------------------------- base routing

    function test_NoPolicy_EverythingIsSpendable() public {
        vm.prank(payer);
        uint256 spendable = router.route(recipient, 1_000 * ONE);

        assertEq(spendable, 1_000 * ONE);
        assertEq(musd.balanceOf(recipient), 1_000 * ONE);
    }

    function test_SavingsLeg_SplitsAndMintsSharesToRecipient() public {
        _setPolicy(recipient, _one(_leg(savings, 2_000, SAVE, 0)));

        vm.prank(payer);
        uint256 spendable = router.route(recipient, 1_000 * ONE);

        assertEq(spendable, 800 * ONE, "80% is spendable");
        assertEq(musd.balanceOf(recipient), 800 * ONE);
        assertEq(router.filled(recipient, SAVE), 200 * ONE, "progress recorded");
        assertEq(savings.balanceOf(recipient), 200 * ONE, "200 MUSD now saved");
    }

    /// @dev The property that distinguishes this from a custodial splitter.
    function test_SavingsAreNonCustodial_SharesLandInTheRecipientsWallet() public {
        _setPolicy(recipient, _one(_leg(savings, 5_000, SAVE, 0)));

        vm.prank(payer);
        router.route(recipient, 1_000 * ONE);

        assertGt(sMusd.balanceOf(recipient), 0, "recipient holds sMUSD directly");
        assertEq(sMusd.balanceOf(address(savings)), 0, "the sink keeps no shares");
        assertEq(sMusd.balanceOf(address(router)), 0, "the router keeps no shares");

        // Nobody's permission is needed to leave.
        uint256 shares = sMusd.balanceOf(recipient);
        vm.prank(recipient);
        sMusd.redeem(shares, recipient, recipient);
        assertApproxEqAbs(musd.balanceOf(recipient), 1_000 * ONE, 1, "exited freely");
    }

    function test_ProtocolHoldsNoFunds() public {
        _setPolicy(recipient, _two(_leg(savings, 3_000, SAVE, 0), _leg(debtLike, 2_000, DEBT, 0)));
        debtLike.setCapacity(recipient, type(uint256).max);

        vm.prank(payer);
        router.route(recipient, 1_000 * ONE);

        assertEq(musd.balanceOf(address(router)), 0, "router never custodies MUSD");
        assertEq(musd.balanceOf(address(savings)), 0, "savings sink is stateless");
    }

    // ---------------------------------------------------------- the cascade

    /// @dev A leg bounded by its own target spills the remainder onward.
    function test_Cascade_WhenLegHitsItsCap() public {
        _setPolicy(
            recipient,
            _two(
                _leg(savings, 5_000, SAVE, 300 * ONE), // 50%, but capped at 300
                _leg(debtLike, 1_000, DEBT, 0) // 10%, uncapped
            )
        );
        debtLike.setCapacity(recipient, type(uint256).max);

        vm.prank(payer);
        uint256 spendable = router.route(recipient, 1_000 * ONE);

        assertEq(router.filled(recipient, SAVE), 300 * ONE, "savings stopped at its cap");
        // 500 claimed, 300 taken, 200 cascades onto the second leg's own 100.
        assertEq(router.filled(recipient, DEBT), 300 * ONE, "100 of its own + 200 cascaded");
        assertEq(spendable, 400 * ONE, "the rest is spendable");
    }

    /// @dev The behaviour that needs no transaction from the recipient: when an
    ///      obligation is satisfied, its share moves to the next leg by itself.
    ///      This is a Trove being paid off and the freed income becoming savings.
    function test_Cascade_WhenSinkCapacityRunsOut() public {
        _setPolicy(
            recipient,
            _two(
                _leg(debtLike, 5_000, DEBT, 0), // 50% toward the obligation
                _leg(savings, 2_000, SAVE, 0) // 20% to savings
            )
        );
        // Only 300 MUSD of debt left to service.
        debtLike.setCapacity(recipient, 300 * ONE);

        vm.prank(payer);
        uint256 spendable = router.route(recipient, 1_000 * ONE);

        assertEq(debtLike.appliedTo(recipient), 300 * ONE, "took only what was owed");
        // 500 claimed, 300 applied, 200 cascades onto savings' own 200.
        assertEq(savings.balanceOf(recipient), 400 * ONE, "the overflow was saved");
        assertEq(spendable, 300 * ONE);

        // Debt is now clear. The next payment routes the whole 50% to savings.
        vm.prank(payer);
        router.route(recipient, 1_000 * ONE);

        assertEq(debtLike.appliedTo(recipient), 300 * ONE, "nothing more was owed");
        assertApproxEqAbs(
            savings.balanceOf(recipient), 1_100 * ONE, 2, "700 more saved, with no policy change"
        );
    }

    function test_ResetProgress_ReopensACappedLeg() public {
        _setPolicy(recipient, _one(_leg(savings, 5_000, SAVE, 100 * ONE)));

        vm.prank(payer);
        router.route(recipient, 1_000 * ONE);
        assertEq(router.filled(recipient, SAVE), 100 * ONE);

        vm.prank(recipient);
        router.resetProgress(SAVE);

        vm.prank(payer);
        router.route(recipient, 1_000 * ONE);
        assertEq(router.filled(recipient, SAVE), 100 * ONE, "the leg funded again");
    }

    /// @dev Progress is keyed to `ref`, not to a position in the array, so
    ///      editing a policy must not silently restart a half-funded goal.
    function test_ProgressSurvivesAPolicyEdit() public {
        _setPolicy(recipient, _one(_leg(savings, 5_000, SAVE, 1_000 * ONE)));

        vm.prank(payer);
        router.route(recipient, 1_000 * ONE);
        assertEq(router.filled(recipient, SAVE), 500 * ONE);

        // Reorder and re-rate the same goal.
        _setPolicy(
            recipient, _two(_leg(debtLike, 1_000, DEBT, 0), _leg(savings, 1_000, SAVE, 1_000 * ONE))
        );
        debtLike.setCapacity(recipient, type(uint256).max);

        assertEq(router.filled(recipient, SAVE), 500 * ONE, "still half funded");
        assertEq(router.headroomOf(recipient, 1), 500 * ONE, "cap accounts for prior progress");
    }

    // --------------------------------------------------------- preview parity

    function test_PreviewMatchesExecution() public {
        _setPolicy(
            recipient, _two(_leg(debtLike, 3_300, DEBT, 0), _leg(savings, 2_500, SAVE, 777 * ONE))
        );
        debtLike.setCapacity(recipient, 191 * ONE);

        (uint256 previewSpendable, FlowRouter.Allocation[] memory plan) =
            router.preview(recipient, 1_337 * ONE);

        vm.prank(payer);
        uint256 spendable = router.route(recipient, 1_337 * ONE);

        assertEq(previewSpendable, spendable, "preview must match execution");
        assertEq(plan.length, 2);
        assertEq(plan[0].amount, debtLike.appliedTo(recipient));
        assertEq(plan[1].amount, router.filled(recipient, SAVE));
    }

    // ------------------------------------------------------------- sovereignty

    function test_PayerCannotSetOrChangeARecipientsPolicy() public {
        _setPolicy(recipient, _one(_leg(savings, 2_000, SAVE, 0)));

        // The payer's own policy is their own; it cannot reach the recipient's.
        _setPolicy(payer, _one(_leg(savings, 9_000, SAVE, 0)));

        FlowRouter.Leg[] memory theirs = router.policyOf(recipient);
        assertEq(theirs[0].bps, 2_000, "recipient's policy is untouched");
    }

    function test_RecipientCanOptOutAtAnyTime() public {
        _setPolicy(recipient, _one(_leg(savings, 5_000, SAVE, 0)));

        vm.prank(recipient);
        router.clearPolicy();

        vm.prank(payer);
        uint256 spendable = router.route(recipient, 1_000 * ONE);
        assertEq(spendable, 1_000 * ONE, "everything spendable once the policy is cleared");
    }

    // -------------------------------------------------------------- validation

    function test_RejectsOverAllocation() public {
        FlowRouter.Leg[] memory legs =
            _two(_leg(savings, 6_000, SAVE, 0), _leg(debtLike, 4_001, DEBT, 0));
        vm.prank(recipient);
        vm.expectRevert(FlowRouter.AllocationExceedsUnity.selector);
        router.setPolicy(legs);
    }

    function test_RejectsDuplicateRefs() public {
        FlowRouter.Leg[] memory legs =
            _two(_leg(savings, 1_000, SAVE, 0), _leg(debtLike, 1_000, SAVE, 0));
        vm.prank(recipient);
        vm.expectRevert(FlowRouter.DuplicateRef.selector);
        router.setPolicy(legs);
    }

    function test_RejectsSinkOnTheWrongAsset() public {
        MockMUSD other = new MockMUSD();
        CappedSink wrongAsset = new CappedSink(IERC20(address(other)));

        FlowRouter.Leg[] memory legs = _one(_leg(wrongAsset, 1_000, DEBT, 0));
        vm.prank(recipient);
        vm.expectRevert(FlowRouter.SinkAssetMismatch.selector);
        router.setPolicy(legs);
    }

    function test_RejectsTooManyLegs() public {
        FlowRouter.Leg[] memory legs = new FlowRouter.Leg[](9);
        for (uint256 i; i < 9; ++i) {
            legs[i] = _leg(savings, 100, bytes32(i), 0);
        }
        vm.prank(recipient);
        vm.expectRevert(FlowRouter.TooManyLegs.selector);
        router.setPolicy(legs);
    }

    function test_RejectsSelfPaymentAndZero() public {
        vm.startPrank(payer);
        vm.expectRevert(FlowRouter.SelfPayment.selector);
        router.route(payer, ONE);

        vm.expectRevert(FlowRouter.ZeroAmount.selector);
        router.route(recipient, 0);
        vm.stopPrank();
    }

    // -------------------------------------------------- hostile sink handling

    function test_HostileSink_CannotReenterRoute() public {
        HostileSink hostile = new HostileSink(IERC20(address(musd)), router);
        hostile.arm(HostileSink.Mode.Reenter, stranger);

        _setPolicy(recipient, _one(_leg(hostile, 5_000, DEBT, 0)));

        vm.prank(payer);
        vm.expectRevert(); // ReentrancyGuardReentrantCall
        router.route(recipient, 1_000 * ONE);
    }

    function test_HostileSink_CannotStrandFundsByUnderApplying() public {
        HostileSink hostile = new HostileSink(IERC20(address(musd)), router);
        hostile.arm(HostileSink.Mode.UnderApply, recipient);

        _setPolicy(recipient, _one(_leg(hostile, 5_000, DEBT, 0)));

        vm.prank(payer);
        vm.expectRevert(FlowRouter.SinkRejectedDeposit.selector);
        router.route(recipient, 1_000 * ONE);
    }

    /// @dev A sink that overstates capacity reverts its own payment and nobody
    ///      else's. The damage is contained to the account that chose it.
    function test_HostileSink_OnlyHarmsTheAccountThatChoseIt() public {
        HostileSink hostile = new HostileSink(IERC20(address(musd)), router);
        hostile.arm(HostileSink.Mode.OverstateCapacity, recipient);

        _setPolicy(recipient, _one(_leg(hostile, 5_000, DEBT, 0)));
        _setPolicy(stranger, _one(_leg(savings, 5_000, SAVE, 0)));

        vm.prank(payer);
        vm.expectRevert();
        router.route(recipient, 1_000 * ONE);

        // An unrelated account is unaffected.
        vm.prank(payer);
        router.route(stranger, 1_000 * ONE);
        assertEq(savings.balanceOf(stranger), 500 * ONE);
    }

    // ------------------------------------------------------------------ yield

    function test_SavedIncomeEarnsProtocolRevenue() public {
        _setPolicy(recipient, _one(_leg(savings, 2_000, SAVE, 0)));

        vm.prank(payer);
        router.route(recipient, 1_000 * ONE);
        assertEq(savings.balanceOf(recipient), 200 * ONE);

        // Bitcoin borrowers pay interest into the vault: +10% on the pool.
        sMusd.accrue(20 * ONE);

        assertApproxEqAbs(savings.balanceOf(recipient), 220 * ONE, 1, "savings grew on their own");
        assertEq(router.filled(recipient, SAVE), 200 * ONE, "progress counts principal, not yield");
    }

    // ------------------------------------------------------------------- fuzz

    /// @dev Value is conserved for any policy: what is not routed is spendable,
    ///      and nothing is created or destroyed in between.
    function testFuzz_ConservesValue(
        uint96 amount,
        uint16 bpsA,
        uint16 bpsB,
        uint96 cap,
        uint96 sinkRoom
    ) public {
        amount = uint96(bound(amount, 1, 10_000 * ONE));
        bpsA = uint16(bound(bpsA, 0, 10_000));
        bpsB = uint16(bound(bpsB, 0, 10_000 - bpsA));

        _setPolicy(recipient, _two(_leg(debtLike, bpsA, DEBT, 0), _leg(savings, bpsB, SAVE, cap)));
        debtLike.setCapacity(recipient, sinkRoom);

        uint256 before = musd.balanceOf(payer);

        vm.prank(payer);
        uint256 spendable = router.route(recipient, amount);

        uint256 spent = before - musd.balanceOf(payer);
        assertEq(spent, amount, "the payer is debited exactly once, for the full amount");
        assertLe(spendable, amount);
        assertEq(
            spendable + debtLike.appliedTo(recipient) + router.filled(recipient, SAVE),
            amount,
            "spendable + routed == amount"
        );
    }
}

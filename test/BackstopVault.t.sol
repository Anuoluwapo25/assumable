// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {BackstopVault} from "../src/BackstopVault.sol";
import {ISwapper} from "../src/interfaces/ISwapper.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";
import {MockStabilityPool} from "./mocks/MockStabilityPool.sol";
import {MockPriceFeed} from "./mocks/MockPriceFeed.sol";
import {MockSwapper} from "./mocks/MockSwapper.sol";

contract BackstopVaultTest is Test {
    MockMUSD musd;
    MockStabilityPool pool;
    MockPriceFeed feed;
    MockSwapper swapper;
    BackstopVault vault;

    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");

    uint256 constant ONE = 1e18;
    uint256 constant BTC_PRICE = 100_000 * ONE;

    function setUp() public {
        musd = new MockMUSD();
        pool = new MockStabilityPool(musd);
        feed = new MockPriceFeed(BTC_PRICE);
        swapper = new MockSwapper(musd, BTC_PRICE);

        vault = new BackstopVault(IERC20(address(musd)), pool, feed, swapper, owner);

        _fund(alice, 1_000_000 * ONE);
        _fund(bob, 1_000_000 * ONE);
        vm.deal(address(this), 1_000 ether);
    }

    function _fund(address who, uint256 amount) internal {
        musd.mint(who, amount);
        vm.prank(who);
        musd.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return vault.deposit(amount, who);
    }

    /// @dev A liquidation the pool profits from: it burns `debt` MUSD and
    ///      receives BTC worth ~10% more, which is the discount depositors earn.
    function _liquidate(uint256 debt) internal {
        uint256 btc = (debt * 110 / 100) * ONE / BTC_PRICE;
        pool.simulateLiquidation{value: btc}(debt, btc);
    }

    // ----------------------------------------------------------- base wiring

    function test_DepositsGoStraightIntoTheStabilityPool() public {
        _deposit(alice, 100_000 * ONE);

        assertEq(pool.getCompoundedMUSDDeposit(address(vault)), 100_000 * ONE, "supplied to pool");
        assertEq(musd.balanceOf(address(vault)), 0, "nothing left idle");
        assertEq(vault.totalAssets(), 100_000 * ONE);
    }

    function test_SharesTrackProportionalOwnership() public {
        _deposit(alice, 100_000 * ONE);
        _deposit(bob, 300_000 * ONE);

        assertApproxEqRel(vault.maxWithdraw(alice), 100_000 * ONE, 1e12);
        assertApproxEqRel(vault.maxWithdraw(bob), 300_000 * ONE, 1e12);
    }

    // ------------------------------------------------- the central invariant

    /// @dev The reason `totalAssets` counts unharvested BTC. A liquidation burns
    ///      pooled MUSD at the same instant it credits BTC. If the vault only
    ///      saw the MUSD, the share price would crater on liquidation and leap
    ///      on harvest — and anyone could deposit between the two.
    function test_SharePriceDoesNotCraterOnLiquidation() public {
        _deposit(alice, 100_000 * ONE);
        uint256 before = vault.convertToAssets(ONE);

        _liquidate(20_000 * ONE);

        uint256 afterLiquidation = vault.convertToAssets(ONE);
        assertGe(afterLiquidation, before, "liquidations are profitable, not a loss");
        // The pool's MUSD alone fell by 20%; the share price must not follow it.
        // 20k of MUSD burned, 22k of BTC received: a 2k gain on a 100k
        // deposit. Net of the 1% haircut on the unharvested BTC, ~1.78%.
        assertApproxEqRel(
            afterLiquidation, before * 10_178 / 10_000, 0.005e18, "~1.8% gain, net of haircut"
        );
    }

    function test_HarvestCannotBeSandwiched() public {
        _deposit(alice, 100_000 * ONE);
        _liquidate(20_000 * ONE);

        uint256 beforeHarvest = vault.convertToAssets(ONE);

        vm.prank(keeper);
        vault.harvest(0);

        uint256 afterHarvest = vault.convertToAssets(ONE);

        // The harvest may only nudge the price up as the haircut is released,
        // never jump it - so there is no window worth front-running.
        assertGe(afterHarvest, beforeHarvest, "harvest never lowers the share price");
        assertApproxEqRel(afterHarvest, beforeHarvest, 0.015e18, "and never jumps it");
    }

    // --------------------------------------------------------------- harvest

    function test_HarvestCompoundsGainsBackIntoThePool() public {
        _deposit(alice, 100_000 * ONE);
        _liquidate(20_000 * ONE);

        uint256 pooledBefore = pool.getCompoundedMUSDDeposit(address(vault));

        vm.prank(keeper);
        uint256 musdOut = vault.harvest(0);

        assertGt(musdOut, 0, "BTC was converted");
        assertGt(
            pool.getCompoundedMUSDDeposit(address(vault)),
            pooledBefore,
            "and redeposited, so it now absorbs liquidations too"
        );
        assertEq(address(vault).balance, 0, "no BTC left stranded");
    }

    function test_LiquidationsAreNetProfitableForDepositors() public {
        _deposit(alice, 100_000 * ONE);

        for (uint256 i; i < 5; ++i) {
            _liquidate(10_000 * ONE);
            vm.prank(keeper);
            vault.harvest(0);
        }

        assertGt(vault.maxWithdraw(alice), 100_000 * ONE, "alice is ahead after five liquidations");
    }

    function test_HarvestPaysTheKeeper() public {
        _deposit(alice, 100_000 * ONE);
        _liquidate(20_000 * ONE);

        vm.prank(keeper);
        vault.harvest(0);

        assertGt(musd.balanceOf(keeper), 0, "keepers are paid, so harvests happen");
    }

    function test_HarvestRevertsWithNothingToDo() public {
        _deposit(alice, 100_000 * ONE);

        vm.expectRevert(BackstopVault.NothingToHarvest.selector);
        vault.harvest(0);
    }

    // ------------------------------------------------------ swap protection

    /// @dev The floor comes from MUSD's own oracle, not from the caller, so a
    ///      keeper passing `minMusdOut = 0` still cannot donate the harvest to
    ///      a sandwich.
    function test_OracleFloorHoldsEvenWhenTheCallerAsksForNothing() public {
        _deposit(alice, 100_000 * ONE);
        _liquidate(20_000 * ONE);

        swapper.setQualityBps(8_000); // venue 20% worse than oracle

        vm.prank(keeper);
        vm.expectRevert(bytes("MockSwapper: slippage"));
        vault.harvest(0);
    }

    function test_SmallSlippageWithinToleranceIsAccepted() public {
        _deposit(alice, 100_000 * ONE);
        _liquidate(20_000 * ONE);

        swapper.setQualityBps(9_950); // 0.5% worse, inside the 1% tolerance

        vm.prank(keeper);
        vault.harvest(0);
        assertEq(address(vault).balance, 0);
    }

    // ------------------------------------------------------------ withdrawal

    function test_WithdrawReturnsPrincipalPlusEarnings() public {
        _deposit(alice, 100_000 * ONE);
        _liquidate(20_000 * ONE);
        vm.prank(keeper);
        vault.harvest(0);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);

        assertGt(musd.balanceOf(alice), 1_000_000 * ONE, "left with more than she arrived with");
        assertEq(vault.balanceOf(alice), 0);
    }

    /// @dev The pool refuses principal withdrawals while a Trove is liquidatable.
    ///      That is a protocol condition, not a vault fault, and it is reported
    ///      as one so a UI can explain it instead of showing a raw revert.
    function test_BlockedWithdrawalsAreReportedClearly() public {
        _deposit(alice, 100_000 * ONE);
        pool.setBlockWithdrawals(true);

        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vm.expectRevert(BackstopVault.WithdrawalsBlockedByPendingLiquidations.selector);
        vault.redeem(shares, alice, alice);
    }

    function test_MultipleDepositorsShareGainsProRata() public {
        _deposit(alice, 100_000 * ONE);
        _deposit(bob, 100_000 * ONE);

        _liquidate(40_000 * ONE);
        vm.prank(keeper);
        vault.harvest(0);

        assertApproxEqRel(
            vault.maxWithdraw(alice), vault.maxWithdraw(bob), 1e12, "equal stakes, equal gains"
        );
    }

    /// @dev A depositor who arrives after the liquidation must not collect any
    ///      of it, even before the harvest converts it.
    function test_LateDepositorDoesNotShareEarlierGains() public {
        _deposit(alice, 100_000 * ONE);
        _liquidate(20_000 * ONE);

        _deposit(bob, 100_000 * ONE);
        vm.prank(keeper);
        vault.harvest(0);

        assertGt(
            vault.maxWithdraw(alice), vault.maxWithdraw(bob), "alice took the risk, alice earns"
        );
        assertApproxEqRel(vault.maxWithdraw(bob), 100_000 * ONE, 0.005e18, "bob is roughly flat");
    }

    // ------------------------------------------------------------- ownership

    function test_OnlyOwnerTunesTheVault() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vault.setSwapper(ISwapper(address(swapper)));

        vm.prank(owner);
        vault.setHarvestFeeBps(100);
        assertEq(vault.harvestFeeBps(), 100);
    }

    function test_OwnerCannotSetAPredatoryFeeOrTolerance() public {
        vm.startPrank(owner);
        vm.expectRevert(BackstopVault.FeeTooHigh.selector);
        vault.setHarvestFeeBps(501);

        vm.expectRevert(BackstopVault.SwapQualityTooLow.selector);
        vault.setSwapQualityBps(8_999);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ fuzz

    /// @dev However liquidations and harvests interleave, a harvest must never
    ///      reduce the value of a share.
    function testFuzz_HarvestNeverDilutes(uint96 deposit, uint96 debt) public {
        uint256 d = bound(deposit, 1_000 * ONE, 500_000 * ONE);
        uint256 x = bound(debt, 1 * ONE, d / 2);

        _deposit(alice, d);
        _liquidate(x);

        uint256 before = vault.convertToAssets(ONE);
        vm.prank(keeper);
        vault.harvest(0);

        assertGe(vault.convertToAssets(ONE), before, "a harvest can only help");
    }
}

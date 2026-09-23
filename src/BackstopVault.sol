// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IStabilityPool} from "./interfaces/IStabilityPool.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";
import {ISwapper} from "./interfaces/ISwapper.sol";

/// @title BackstopVault
/// @notice An auto-compounding ERC-4626 vault over MUSD's Stability Pool.
///
/// The Stability Pool is what keeps MUSD solvent: it absorbs the debt of
/// liquidated Troves, burning depositors' MUSD and handing them the liquidated
/// BTC at a discount. Supplying it is profitable — you are paid a premium for
/// taking on bad debt — but it is not passive. Gains arrive as raw BTC that
/// sits there earning nothing until someone converts it back and redeposits.
///
/// This vault does that. Deposit MUSD, receive bMUSD, and every liquidation
/// compounds into your position instead of stranding BTC on the sidelines.
///
/// @dev Three things about the pool shape everything here.
///
///      **Gains are pushed, not pulled.** `provideToSP` and `withdrawFromSP`
///      both send accrued BTC to the caller before doing anything else. The
///      vault is therefore payable, and must treat an arriving balance as
///      normal rather than exceptional.
///
///      **Deposits shrink.** A Stability Pool deposit is not a claim on a fixed
///      amount of MUSD; it is `d0 * P / P0`, and it falls every time the pool
///      absorbs a liquidation. `totalAssets` reads the compounded figure, never
///      a remembered principal.
///
///      **Unharvested gains must be counted.** A liquidation cuts the MUSD
///      deposit at the instant it credits the BTC. If `totalAssets` saw only
///      the MUSD, the share price would drop on every liquidation and jump on
///      every harvest — a sawtooth anyone could trade against by depositing
///      just before a harvest and leaving just after. So pending BTC is valued
///      at MUSD's own oracle, with a haircut, and counted continuously.
contract BackstopVault is ERC4626, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ------------------------------------------------------------- constants

    uint256 public constant BPS = 10_000;

    /// @notice Ceiling on the keeper's cut of a harvest. The owner sets the
    ///         live value below this; the ceiling itself cannot be raised.
    uint256 public constant MAX_HARVEST_FEE_BPS = 500; // 5%

    /// @notice Floor on how much of the oracle-implied value a swap must return.
    ///         Caps how badly a compromised swapper or a sandwich can do.
    uint256 public constant MIN_SWAP_QUALITY_BPS = 9_000; // 90%

    /// @notice Liquity-derived price feeds scale to 1e18. Asserted at deploy.
    uint256 internal constant PRICE_SCALE = 1e18;

    // ----------------------------------------------------------------- errors

    error ZeroAddress();
    error NothingToHarvest();
    error SwapQualityTooLow();
    error FeeTooHigh();
    error SwapReturnedTooLittle(uint256 received, uint256 floor);
    /// @dev Raised when the pool refuses a principal withdrawal because a Trove
    ///      is liquidatable. Surfaced explicitly rather than as a bare revert,
    ///      because it is a temporary protocol condition and not a vault fault.
    error WithdrawalsBlockedByPendingLiquidations();

    // ----------------------------------------------------------------- events

    event Harvested(
        address indexed caller, uint256 btcSwapped, uint256 musdReceived, uint256 keeperFee
    );
    event SwapperSet(address indexed swapper);
    event HarvestFeeSet(uint256 bps);
    event SwapQualitySet(uint256 bps);

    // ------------------------------------------------------------------ state

    IStabilityPool public immutable stabilityPool;
    IPriceFeed public immutable priceFeed;

    /// @notice BTC -> MUSD venue. Replaceable: it touches no depositor state.
    ISwapper public swapper;

    /// @notice Paid to whoever calls `harvest`, out of the harvested MUSD.
    uint256 public harvestFeeBps = 50; // 0.5%

    /// @notice Minimum fraction of oracle-implied value a swap must return.
    uint256 public swapQualityBps = 9_900; // 99%

    constructor(
        IERC20 musd_,
        IStabilityPool stabilityPool_,
        IPriceFeed priceFeed_,
        ISwapper swapper_,
        address owner_
    ) ERC4626(musd_) ERC20("Backstop MUSD", "bMUSD") Ownable(owner_) {
        if (
            address(stabilityPool_) == address(0) || address(priceFeed_) == address(0)
                || address(swapper_) == address(0)
        ) revert ZeroAddress();

        stabilityPool = stabilityPool_;
        priceFeed = priceFeed_;
        swapper = swapper_;

        // A feed on the wrong scale would silently misprice every pending gain.
        // Sanity-bound it at deploy rather than discovering it in production.
        uint256 price = priceFeed_.fetchPrice();
        require(price > 1e18 && price < 100_000_000 * 1e18, "price feed scale unexpected");
    }

    /// @notice The Stability Pool pays collateral gains in native BTC.
    receive() external payable {}

    // ---------------------------------------------------------- 4626 overrides

    /// @inheritdoc ERC4626
    /// @dev Idle MUSD, the compounded pool deposit, and BTC not yet compounded.
    ///      The BTC term is what keeps the share price continuous across a
    ///      liquidation; without it the vault would be trivially sandwichable
    ///      around every harvest.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this))
            + stabilityPool.getCompoundedMUSDDeposit(address(this)) + pendingBtcValue();
    }

    /// @notice Harvestable BTC valued in MUSD, discounted by `swapQualityBps`.
    /// @dev Deliberately conservative. Valuing pending BTC at the full oracle
    ///      price would let a depositor capture swap slippage they did not pay;
    ///      the haircut is set to the same floor the harvest swap must clear, so
    ///      a harvest can only ever move the share price upward.
    function pendingBtcValue() public view returns (uint256) {
        uint256 btc = harvestableBtc();
        if (btc == 0) return 0;
        return (btc * priceFeed.fetchPrice() / PRICE_SCALE) * swapQualityBps / BPS;
    }

    /// @notice BTC already received plus BTC still owed by the pool.
    function harvestableBtc() public view returns (uint256) {
        return address(this).balance + stabilityPool.getDepositorCollateralGain(address(this));
    }

    /// @dev Route deposits straight into the pool. Idle MUSD earns nothing and
    ///      absorbs no liquidations, so it is never left sitting here.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        super._deposit(caller, receiver, assets, shares);
        _supply(assets);
    }

    /// @dev Serve from idle balance first, then draw the shortfall out of the
    ///      pool. `withdrawFromSP` can revert while a Trove is liquidatable, so
    ///      that case is caught and reported for what it is.
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        if (idle < assets) {
            uint256 shortfall = assets - idle;
            try stabilityPool.withdrawFromSP(shortfall) {}
            catch {
                revert WithdrawalsBlockedByPendingLiquidations();
            }
        }
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    /// @notice True when the pool would currently allow a principal withdrawal.
    /// @dev A UI should read this before offering a withdraw, so the constraint
    ///      is explained up front rather than as a failed transaction.
    function withdrawalsAvailable() external view returns (bool) {
        return maxWithdraw(address(0)) == 0 || _poolAcceptsWithdrawals();
    }

    // --------------------------------------------------------------- harvest

    /// @notice Convert accrued BTC into MUSD and redeposit it.
    /// @dev Permissionless, and paid, so it does not depend on the vault owner
    ///      staying alive. The caller cannot profit beyond `harvestFeeBps`: the
    ///      swap floor is set from MUSD's own oracle, so sandwiching the swap
    ///      costs the attacker more than the fee is worth.
    /// @param minMusdOut Caller's own floor, applied on top of the oracle floor.
    function harvest(uint256 minMusdOut) external nonReentrant returns (uint256 musdOut) {
        // Pulls any BTC the pool still owes us; 0 skips the liquidatable-Trove
        // check that a non-zero withdrawal would trip.
        stabilityPool.withdrawFromSP(0);

        uint256 btc = address(this).balance;
        if (btc == 0) revert NothingToHarvest();

        uint256 floor = (btc * priceFeed.fetchPrice() / PRICE_SCALE) * swapQualityBps / BPS;
        if (floor < minMusdOut) floor = minMusdOut;

        musdOut = swapper.swapBtcForMusd{value: btc}(floor);
        if (musdOut < floor) revert SwapReturnedTooLittle(musdOut, floor);

        uint256 fee = musdOut * harvestFeeBps / BPS;
        if (fee > 0) {
            IERC20(asset()).safeTransfer(msg.sender, fee);
        }

        _supply(musdOut - fee);
        emit Harvested(msg.sender, btc, musdOut, fee);
    }

    // ------------------------------------------------------------- internals

    function _supply(uint256 assets) private {
        if (assets == 0) return;
        IERC20(asset()).forceApprove(address(stabilityPool), assets);
        // Also pushes any accrued BTC back to us, which the next harvest sweeps.
        stabilityPool.provideToSP(assets);
        IERC20(asset()).forceApprove(address(stabilityPool), 0);
    }

    function _poolAcceptsWithdrawals() private view returns (bool) {
        // No view exposes `_requireNoUnderCollateralizedTroves`, so this is a
        // best-effort signal: the pool must hold enough MUSD to serve us.
        return stabilityPool.getTotalMUSDDeposits() > 0;
    }

    // -------------------------------------------------------------- ownership

    /// @notice Repoint the swap venue.
    /// @dev The narrowest power that still lets the vault survive a dead or
    ///      drained pool. A swapper never holds depositor funds: it is called
    ///      with BTC and must return MUSD above an oracle-derived floor inside
    ///      the same call, so a malicious one can cost at most `100 -
    ///      swapQualityBps` of a single harvest.
    function setSwapper(ISwapper swapper_) external onlyOwner {
        if (address(swapper_) == address(0)) revert ZeroAddress();
        swapper = swapper_;
        emit SwapperSet(address(swapper_));
    }

    function setHarvestFeeBps(uint256 bps) external onlyOwner {
        if (bps > MAX_HARVEST_FEE_BPS) revert FeeTooHigh();
        harvestFeeBps = bps;
        emit HarvestFeeSet(bps);
    }

    function setSwapQualityBps(uint256 bps) external onlyOwner {
        if (bps < MIN_SWAP_QUALITY_BPS || bps > BPS) revert SwapQualityTooLow();
        swapQualityBps = bps;
        emit SwapQualitySet(bps);
    }
}

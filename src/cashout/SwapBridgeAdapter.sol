// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IAssetsBridge} from "../interfaces/IAssetsBridge.sol";
import {IPoolRouter} from "../interfaces/IPoolRouter.sol";
import {CashOutOrder} from "./IOfframpAdapter.sol";
import {OfframpAdapterBase} from "./OfframpAdapterBase.sol";

/// @title SwapBridgeAdapter (Route B)
/// @notice For a provider that takes USDC on Ethereum: swaps MUSD to mUSDC in
///         Mezo's MUSD/mUSDC stable pool, then bridges it out through Mezo's
///         native bridge to the order's deposit address, where it arrives as
///         real USDC (less the bridge's flat fee, taken on Ethereum).
///
/// `order.minOut` is in mUSDC (6 decimals) and bounds the swap's slippage.
/// The pool is thin, so `maxMusdIn` caps a single order.
contract SwapBridgeAdapter is OfframpAdapterBase {
    using SafeERC20 for IERC20;

    uint8 public constant ETHEREUM = 0;

    IERC20 public immutable musd;
    IERC20 public immutable usdc;
    IPoolRouter public immutable router;
    address public immutable poolFactory;
    IAssetsBridge public immutable bridge;

    /// Our own floor on top of the bridge's governance minimum (20 mUSDC on mainnet).
    uint256 public minBridgeOut;
    uint256 public maxMusdIn;

    event Bridged(
        bytes32 indexed orderId, address indexed recipient, uint256 musdIn, uint256 usdcOut
    );
    event LimitsSet(uint256 minBridgeOut, uint256 maxMusdIn);

    error AboveMaxIn(uint256 amount, uint256 maxIn);
    error BelowBridgeMin(uint256 amount, uint256 minAmount);
    error BridgeOutFailed();
    error SwapIncomplete();

    constructor(
        address module_,
        IERC20 musd_,
        IERC20 usdc_,
        IPoolRouter router_,
        address poolFactory_,
        IAssetsBridge bridge_,
        uint256 minBridgeOut_,
        uint256 maxMusdIn_,
        address owner_
    ) OfframpAdapterBase(module_, owner_) {
        musd = musd_;
        usdc = usdc_;
        router = router_;
        poolFactory = poolFactory_;
        bridge = bridge_;
        minBridgeOut = minBridgeOut_;
        maxMusdIn = maxMusdIn_;
        emit LimitsSet(minBridgeOut_, maxMusdIn_);
    }

    function setLimits(uint256 minBridgeOut_, uint256 maxMusdIn_) external onlyOwner {
        minBridgeOut = minBridgeOut_;
        maxMusdIn = maxMusdIn_;
        emit LimitsSet(minBridgeOut_, maxMusdIn_);
    }

    /// @notice The bridge minimum that applies now: ours or governance's, whichever is higher.
    function bridgeMinimum() public view returns (uint256) {
        uint256 onchain = bridge.getMinBridgeOutAmount(address(usdc));
        return onchain > minBridgeOut ? onchain : minBridgeOut;
    }

    function _payout(CashOutOrder calldata order) internal override returns (uint256 out) {
        uint256 amount = order.musdAmount;
        if (amount > maxMusdIn) revert AboveMaxIn(amount, maxMusdIn);

        IPoolRouter.Route[] memory routes = new IPoolRouter.Route[](1);
        routes[0] = IPoolRouter.Route(address(musd), address(usdc), true, poolFactory);

        uint256 musdBefore = musd.balanceOf(address(this));
        uint256 usdcBefore = usdc.balanceOf(address(this));
        musd.forceApprove(address(router), amount);
        router.swapExactTokensForTokens(
            amount, order.minOut, routes, address(this), block.timestamp
        );
        if (musd.allowance(address(this), address(router)) != 0) {
            musd.forceApprove(address(router), 0);
        }
        if (musd.balanceOf(address(this)) != musdBefore - amount) revert SwapIncomplete();
        out = usdc.balanceOf(address(this)) - usdcBefore;

        uint256 floor = bridgeMinimum();
        if (out < floor) revert BelowBridgeMin(out, floor);

        // The precompile burns with `burnFrom`, which spends exactly this approval.
        usdc.forceApprove(address(bridge), out);
        if (!bridge.bridgeOut(address(usdc), out, ETHEREUM, abi.encodePacked(order.depositAddress)))
        {
            revert BridgeOutFailed();
        }
        if (usdc.allowance(address(this), address(bridge)) != 0) {
            usdc.forceApprove(address(bridge), 0);
        }
        emit Bridged(order.orderId, order.depositAddress, amount, out);
    }
}

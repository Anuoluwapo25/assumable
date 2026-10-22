// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {CashOutOrder} from "./IOfframpAdapter.sol";
import {OfframpAdapterBase} from "./OfframpAdapterBase.sol";

/// @title DirectMUSDAdapter (Route A)
/// @notice For a provider that takes MUSD on Mezo: sends it straight to the
///         order's deposit address. No swap, no bridge, no slippage.
contract DirectMUSDAdapter is OfframpAdapterBase {
    using SafeERC20 for IERC20;

    IERC20 public immutable musd;

    event SentMUSD(bytes32 indexed orderId, address indexed depositAddress, uint256 amount);

    constructor(address module_, IERC20 musd_, address owner_) OfframpAdapterBase(module_, owner_) {
        musd = musd_;
    }

    function _payout(CashOutOrder calldata order) internal override returns (uint256) {
        musd.safeTransfer(order.depositAddress, order.musdAmount);
        emit SentMUSD(order.orderId, order.depositAddress, order.musdAmount);
        return order.musdAmount;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISwapper} from "../../src/interfaces/ISwapper.sol";
import {MockMUSD} from "./MockMUSD.sol";

/// @dev Converts BTC to MUSD at the configured price, with an adjustable
///      shortfall so the vault's oracle floor can be tested against a bad venue.
contract MockSwapper is ISwapper {
    MockMUSD public immutable musd;
    uint256 public price;
    uint256 public qualityBps = 10_000;

    constructor(MockMUSD musd_, uint256 price_) {
        musd = musd_;
        price = price_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
    }

    /// @param bps Fraction of the fair quote actually delivered. 9_500 == 5% worse.
    function setQualityBps(uint256 bps) external {
        qualityBps = bps;
    }

    function swapBtcForMusd(uint256 minMusdOut) external payable returns (uint256) {
        uint256 out = (msg.value * price / 1e18) * qualityBps / 10_000;
        require(out >= minMusdOut, "MockSwapper: slippage");
        musd.mint(msg.sender, out);
        return out;
    }
}

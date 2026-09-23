// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPriceFeed} from "../../src/interfaces/IPriceFeed.sol";

contract MockPriceFeed is IPriceFeed {
    uint256 public price;

    constructor(uint256 price_) {
        price = price_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
    }

    function fetchPrice() external view returns (uint256) {
        return price;
    }
}

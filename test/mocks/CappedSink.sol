// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISink} from "../../src/interfaces/ISink.sol";

/// @dev A sink with externally controlled capacity, standing in for one bounded
///      by live protocol state — a Trove sink that will only take what is
///      actually repayable, for instance.
contract CappedSink is ISink {
    IERC20 public immutable musd;

    mapping(address => uint256) public capacityOf;
    mapping(address => uint256) public appliedTo;

    constructor(IERC20 musd_) {
        musd = musd_;
    }

    function setCapacity(address account, uint256 amount) external {
        capacityOf[account] = amount;
    }

    function asset() external view returns (address) {
        return address(musd);
    }

    function capacity(address account) external view returns (uint256) {
        return capacityOf[account];
    }

    function deposit(address account, uint256 amount) external returns (uint256) {
        require(musd.balanceOf(address(this)) >= amount, "not received");
        appliedTo[account] += amount;
        capacityOf[account] -= amount;
        return amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return appliedTo[account];
    }
}

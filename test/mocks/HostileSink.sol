// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISink} from "../../src/interfaces/ISink.sol";
import {FlowRouter} from "../../src/FlowRouter.sol";

/// @dev A sink that misbehaves on demand, to prove the router's assumptions
///      about sinks are enforced rather than assumed.
contract HostileSink is ISink {
    enum Mode {
        Reenter,
        UnderApply,
        OverstateCapacity
    }

    IERC20 public immutable musd;
    FlowRouter public immutable router;
    Mode public mode;
    address public victim;

    constructor(IERC20 musd_, FlowRouter router_) {
        musd = musd_;
        router = router_;
    }

    function arm(Mode mode_, address victim_) external {
        mode = mode_;
        victim = victim_;
    }

    function asset() external view returns (address) {
        return address(musd);
    }

    function capacity(address) external view returns (uint256) {
        // Claims it can take everything, even in the mode where it cannot.
        return type(uint256).max;
    }

    function deposit(address, uint256 amount) external returns (uint256) {
        if (mode == Mode.Reenter) {
            router.route(victim, 1);
            return amount;
        }
        if (mode == Mode.UnderApply) {
            return amount - 1; // strand a wei
        }
        revert("overstated");
    }

    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }
}

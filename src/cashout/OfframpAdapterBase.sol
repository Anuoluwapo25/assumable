// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {CashOutOrder, IOfframpAdapter} from "./IOfframpAdapter.sol";

/// @notice What every adapter shares: only the module can trigger a payout,
///         and the owner can pin deposit addresses to an allowlist, so even a
///         leaked order-signing key can't send funds anywhere new.
abstract contract OfframpAdapterBase is IOfframpAdapter, Ownable2Step {
    address public immutable module;

    /// When set, `depositAddress` must be on `allowedDestination`. Leave it off
    /// for providers that issue a fresh deposit address per order.
    bool public restrictDestinations;
    mapping(address => bool) public allowedDestination;

    event DestinationSet(address indexed destination, bool allowed);
    event RestrictDestinationsSet(bool restricted);

    error NotModule();
    error DestinationNotAllowed(address destination);

    constructor(address module_, address owner_) Ownable(owner_) {
        module = module_;
    }

    function payout(CashOutOrder calldata order) external returns (uint256 delivered) {
        if (msg.sender != module) revert NotModule();
        if (restrictDestinations && !allowedDestination[order.depositAddress]) {
            revert DestinationNotAllowed(order.depositAddress);
        }
        return _payout(order);
    }

    function setRestrictDestinations(bool restricted) external onlyOwner {
        restrictDestinations = restricted;
        emit RestrictDestinationsSet(restricted);
    }

    function setDestination(address destination, bool allowed) external onlyOwner {
        allowedDestination[destination] = allowed;
        emit DestinationSet(destination, allowed);
    }

    function _payout(CashOutOrder calldata order) internal virtual returns (uint256 delivered);
}

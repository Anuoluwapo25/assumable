// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Stand-in for MUSD in tests. 18 decimals, like the real token.
contract MockMUSD is ERC20 {
    constructor() ERC20("Mezo USD", "MUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

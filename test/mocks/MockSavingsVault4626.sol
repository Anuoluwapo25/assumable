// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockMUSD} from "./MockMUSD.sol";

/// @dev Stands in for Mezo's MUSD Savings Vault (sMUSD).
///
/// The real vault appreciates because Bitcoin borrowers pay loan interest and
/// origination fees into it. `accrue` reproduces that the same way it happens
/// on-chain: assets arrive, share count does not change, so every share is
/// worth more MUSD than before.
contract MockSavingsVault4626 is ERC4626 {
    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Savings MUSD", "sMUSD") {}

    /// @dev Simulate protocol fee revenue landing in the vault.
    function accrue(uint256 amount) external {
        MockMUSD(asset()).mint(address(this), amount);
    }
}

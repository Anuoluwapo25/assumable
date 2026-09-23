// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {FlowRouter} from "../src/FlowRouter.sol";
import {SavingsSink} from "../src/sinks/SavingsSink.sol";

/// @notice Deploys Sluice.
///
/// Env:
///   MUSD_ADDRESS         MUSD on the target chain. Mezo mainnet:
///                        0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186
///   SMUSD_VAULT_ADDRESS  The MUSD Savings Vault (sMUSD), ERC-4626.
///
/// Nothing here is ownable, so there is no admin key to hand over and no
/// post-deploy wiring step that could be left half-done.
contract Deploy is Script {
    function run() external {
        address musd = vm.envAddress("MUSD_ADDRESS");
        address sMusdVault = vm.envAddress("SMUSD_VAULT_ADDRESS");

        // Fail before broadcasting rather than after a half-finished deploy.
        require(IERC4626(sMusdVault).asset() == musd, "savings vault asset is not MUSD");

        vm.startBroadcast();
        FlowRouter router = new FlowRouter(IERC20(musd));
        SavingsSink savingsSink = new SavingsSink(IERC4626(sMusdVault));
        vm.stopBroadcast();

        console2.log("MUSD          ", musd);
        console2.log("sMUSD vault   ", sMusdVault);
        console2.log("FlowRouter    ", address(router));
        console2.log("SavingsSink   ", address(savingsSink));
    }
}

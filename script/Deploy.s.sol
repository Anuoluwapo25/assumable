// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {AutoSplitRouter} from "../src/AutoSplitRouter.sol";
import {SavingsVault} from "../src/SavingsVault.sol";
import {ERC4626YieldAdapter} from "../src/adapters/ERC4626YieldAdapter.sol";

/// @notice Deploys the RemitStream savings stack against Mezo's MUSD Savings Vault.
///
/// Env:
///   MUSD_ADDRESS         MUSD on the target chain. Mezo mainnet:
///                        0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186
///   SMUSD_VAULT_ADDRESS  The MUSD Savings Vault (sMUSD), ERC-4626.
///   OWNER_ADDRESS        Owner of the router and vault. Defaults to the deployer.
///
/// Deployment is ordered around one circular dependency: the adapter must know
/// its custodian, and the custodian must know its adapter. SavingsVault is
/// deployed first with the adapter unset, then bound once via `setAdapter`.
contract Deploy is Script {
    function run() external {
        address musd = vm.envAddress("MUSD_ADDRESS");
        address sMusdVault = vm.envAddress("SMUSD_VAULT_ADDRESS");
        address owner = vm.envOr("OWNER_ADDRESS", msg.sender);

        // Fail loudly here rather than after a half-finished deployment.
        require(IERC4626(sMusdVault).asset() == musd, "vault asset is not MUSD");

        vm.startBroadcast();

        SavingsVault savings = new SavingsVault(IERC20(musd), owner);
        ERC4626YieldAdapter adapter =
            new ERC4626YieldAdapter(IERC4626(sMusdVault), address(savings));
        savings.setAdapter(adapter);

        AutoSplitRouter router = new AutoSplitRouter(IERC20(musd), savings, owner);
        savings.setRouter(address(router));

        vm.stopBroadcast();

        console2.log("MUSD              ", musd);
        console2.log("sMUSD vault       ", sMusdVault);
        console2.log("SavingsVault      ", address(savings));
        console2.log("ERC4626Adapter    ", address(adapter));
        console2.log("AutoSplitRouter   ", address(router));
    }
}

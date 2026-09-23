// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BackstopVault} from "../src/BackstopVault.sol";
import {IStabilityPool} from "../src/interfaces/IStabilityPool.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ISwapper} from "../src/interfaces/ISwapper.sol";

/// @notice Deploys the Backstop vault.
///
/// Env:
///   MUSD_ADDRESS            MUSD. Mezo mainnet: 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186
///   STABILITY_POOL_ADDRESS  MUSD's StabilityPool.
///   PRICE_FEED_ADDRESS      MUSD's PriceFeed. Reused so the vault prices BTC
///                           exactly as the protocol it backstops does.
///   SWAPPER_ADDRESS         An ISwapper over Mezo Swap's BTC/MUSD pool.
///   OWNER_ADDRESS           Defaults to the deployer.
contract Deploy is Script {
    function run() external {
        address musd = vm.envAddress("MUSD_ADDRESS");
        address pool = vm.envAddress("STABILITY_POOL_ADDRESS");
        address feed = vm.envAddress("PRICE_FEED_ADDRESS");
        address swapper = vm.envAddress("SWAPPER_ADDRESS");
        address owner = vm.envOr("OWNER_ADDRESS", msg.sender);

        vm.startBroadcast();
        BackstopVault vault = new BackstopVault(
            IERC20(musd), IStabilityPool(pool), IPriceFeed(feed), ISwapper(swapper), owner
        );
        vm.stopBroadcast();

        console2.log("BackstopVault (bMUSD) ", address(vault));
        console2.log("  MUSD               ", musd);
        console2.log("  StabilityPool      ", pool);
        console2.log("  PriceFeed          ", feed);
        console2.log("  Swapper            ", swapper);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {BackstopVault} from "../src/BackstopVault.sol";
import {IStabilityPool} from "../src/interfaces/IStabilityPool.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ISwapper} from "../src/interfaces/ISwapper.sol";

import {MockMUSD} from "../test/mocks/MockMUSD.sol";
import {MockPriceFeed} from "../test/mocks/MockPriceFeed.sol";
import {MockStabilityPool} from "../test/mocks/MockStabilityPool.sol";
import {MockSwapper} from "../test/mocks/MockSwapper.sol";

/// @notice Stands up the vault against the test mocks on a local Anvil node,
///         with enough history that the web app has something real to show:
///         two depositors, a liquidation that has been harvested, and a second
///         one that has not.
///
///   anvil
///   forge script script/DemoLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
///
/// Uses Anvil's first two default keys. Never point this at a live network.
contract DemoLocal is Script {
    uint256 constant DEPLOYER_KEY =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant USER_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    uint256 constant BTC_PRICE = 61_240e18;

    function run() external {
        require(block.chainid == 31337, "local anvil only");

        address deployer = vm.addr(DEPLOYER_KEY);
        address user = vm.addr(USER_KEY);

        vm.startBroadcast(DEPLOYER_KEY);
        MockMUSD musd = new MockMUSD();
        MockPriceFeed feed = new MockPriceFeed(BTC_PRICE);
        MockStabilityPool pool = new MockStabilityPool(musd);
        MockSwapper swapper = new MockSwapper(musd, BTC_PRICE);
        BackstopVault vault = new BackstopVault(
            IERC20(address(musd)),
            IStabilityPool(address(pool)),
            IPriceFeed(address(feed)),
            ISwapper(address(swapper)),
            deployer
        );

        musd.mint(deployer, 400_000e18);
        musd.mint(user, 25_000e18);

        // Someone supplying the pool directly, so the vault is not all of it.
        musd.approve(address(pool), type(uint256).max);
        pool.provideToSP(180_000e18);

        musd.approve(address(vault), type(uint256).max);
        vault.deposit(120_000e18, deployer);
        vm.stopBroadcast();

        vm.startBroadcast(USER_KEY);
        musd.approve(address(vault), type(uint256).max);
        vault.deposit(8_500e18, user);
        vm.stopBroadcast();

        vm.startBroadcast(DEPLOYER_KEY);
        // A Trove liquidated at ~109% collateralization: 9,000 MUSD of debt
        // offset against 0.16 BTC, so the pool earns roughly a 9% premium.
        pool.simulateLiquidation{value: 0.16 ether}(9_000e18, 0.16 ether);
        vault.harvest(0);

        // A second one, left unharvested so the app has pending BTC to show.
        pool.simulateLiquidation{value: 0.072 ether}(4_050e18, 0.072 ether);
        vm.stopBroadcast();

        console2.log("NEXT_PUBLIC_VAULT_ADDRESS=%s", address(vault));
        console2.log("  pool   ", address(pool));
        console2.log("  feed   ", address(feed));
        console2.log("  user   ", user);
    }
}

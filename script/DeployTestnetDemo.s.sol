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

/// @notice A public demo of the vault on Mezo testnet, for people who want to
///         try it without waiting for a real liquidation.
///
/// The vault is the real contract. Everything under it is the test mocks: a
/// Stability Pool that reproduces the real pool's product-sum accounting but
/// lets anyone trigger a liquidation, an MUSD anyone can mint, and a swapper
/// that converts at the oracle price. The web app's demo panel drives them.
///
/// The pool is seeded small on purpose, so a single tester's liquidation or
/// deposit visibly moves it.
///
///   forge script script/DeployTestnetDemo.s.sol \
///     --rpc-url https://rpc.test.mezo.org --broadcast --slow --interactives 1
///
/// `--slow` matters: Mezo rejects a transaction whose nonce is ahead of one
/// it has not yet accepted, so they must go out one at a time.
///
/// The deployer needs about 0.002 testnet BTC: gas, plus one seed liquidation.
contract DeployTestnetDemo is Script {
    uint256 constant BTC_PRICE = 61_240e18;
    uint256 constant SEED_COLL = 0.0005 ether;

    function run() external {
        require(block.chainid == 31611, "Mezo testnet only");

        vm.startBroadcast();
        // The account actually signing. Not `msg.sender`: with --interactives
        // or --account, Foundry leaves that as its placeholder default sender.
        (, address deployer,) = vm.readCallers();

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

        // Other depositors in the pool, and the vault's first deposit.
        musd.mint(deployer, 3_000e18);
        musd.approve(address(pool), type(uint256).max);
        pool.provideToSP(2_000e18);
        musd.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e18, deployer);

        // One liquidation at ~110% collateralization, left unharvested, so the
        // first visitor finds BTC on the floor.
        uint256 debt = (SEED_COLL * BTC_PRICE / 1e18) * 10 / 11;
        pool.simulateLiquidation{value: SEED_COLL}(debt, SEED_COLL);
        vm.stopBroadcast();

        console2.log("NEXT_PUBLIC_VAULT_ADDRESS=%s", address(vault));
        console2.log("NEXT_PUBLIC_VAULT_DEPLOY_BLOCK=%s", block.number);
        console2.log("  pool   ", address(pool));
        console2.log("  musd   ", address(musd));
    }
}

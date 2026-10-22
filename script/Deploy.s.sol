// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {TroveAccount} from "../src/TroveAccount.sol";
import {TroveMarket} from "../src/TroveMarket.sol";
import {TrovePositions} from "../src/TrovePositions.sol";
import {IBorrowerOperations} from "../src/interfaces/IBorrowerOperations.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ITroveManager} from "../src/interfaces/ITroveManager.sol";

/// @notice Deploys the Trove market over the live MUSD system.
///
/// Addresses come from `config/mezo-{testnet,mainnet}.json`, which cite their sources.
///
///   forge script script/Deploy.s.sol \
///     --rpc-url https://rpc.test.mezo.org --broadcast --slow --interactives 1
///
/// `--slow` matters: Mezo rejects a transaction whose nonce is ahead of one
/// it has not yet accepted, so they must go out one at a time.
contract Deploy is Script {
    struct Musd {
        address musd;
        address borrowerOperations;
        address troveManager;
        address priceFeed;
    }

    /// @notice The MUSD system for a chain, from `config/<network>.json`.
    function musdFor(uint256 chainId) public view returns (Musd memory) {
        string memory json = vm.readFile(configPath(chainId));
        return Musd({
            musd: vm.parseJsonAddress(json, ".musd.musd"),
            borrowerOperations: vm.parseJsonAddress(json, ".musd.borrowerOperations"),
            troveManager: vm.parseJsonAddress(json, ".musd.troveManager"),
            priceFeed: vm.parseJsonAddress(json, ".musd.priceFeed")
        });
    }

    function configPath(uint256 chainId) public view returns (string memory) {
        string memory root = vm.projectRoot();
        if (chainId == 31611) return string.concat(root, "/config/mezo-testnet.json");
        if (chainId == 31612) return string.concat(root, "/config/mezo-mainnet.json");
        revert("Unsupported chain");
    }

    function run() external {
        Musd memory m = musdFor(block.chainid);

        vm.startBroadcast();
        TroveAccount implementation = new TroveAccount(
            IBorrowerOperations(m.borrowerOperations), ITroveManager(m.troveManager), IERC20(m.musd)
        );
        TrovePositions positions = new TrovePositions(address(implementation));
        TroveMarket market = new TroveMarket(
            positions, IERC20(m.musd), ITroveManager(m.troveManager), IPriceFeed(m.priceFeed)
        );
        vm.stopBroadcast();

        console2.log("TrovePositions ", address(positions));
        console2.log("TroveMarket    ", address(market));
        console2.log("TroveAccount   ", address(implementation));
        console2.log("deploy block   ", block.number);
    }
}

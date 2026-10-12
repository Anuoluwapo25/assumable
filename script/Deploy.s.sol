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
/// Addresses are from mezo-org/musd `solidity/artifacts/deployments/{matsnet,mainnet}`.
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

    function musdFor(uint256 chainId) public pure returns (Musd memory) {
        if (chainId == 31611) {
            return Musd({
                musd: 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503,
                borrowerOperations: 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5,
                troveManager: 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0,
                priceFeed: 0x86bCF0841622a5dAC14A313a15f96A95421b9366
            });
        }
        if (chainId == 31612) {
            return Musd({
                musd: 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186,
                borrowerOperations: 0x44b1bac67dDA612a41a58AAf779143B181dEe031,
                troveManager: 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193,
                priceFeed: 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88
            });
        }
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

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {TroveMarket} from "../src/TroveMarket.sol";
import {TrovePositions} from "../src/TrovePositions.sol";
import {IAssetsBridge} from "../src/interfaces/IAssetsBridge.sol";
import {IPoolRouter} from "../src/interfaces/IPoolRouter.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {CashOutModule} from "../src/cashout/CashOutModule.sol";
import {DirectMUSDAdapter} from "../src/cashout/DirectMUSDAdapter.sol";
import {SwapBridgeAdapter} from "../src/cashout/SwapBridgeAdapter.sol";
import {Deploy} from "./Deploy.s.sol";

/// @notice Deploys Cash Out over an existing Assumable deployment and the live
///         MUSD, Pools and bridge contracts. Every address is read from
///         `config/mezo-{testnet,mainnet}.json`.
///
///   ORDER_SIGNER=<backend signer address> forge script script/DeployCashOut.s.sol \
///     --rpc-url https://rpc.test.mezo.org --broadcast --slow --interactives 1
///
/// With RECORD=1 the new addresses are written back into the config file.
contract DeployCashOut is Script {
    struct Config {
        address musd;
        address priceFeed;
        address router;
        address poolFactory;
        address assetsBridge;
        address musdc;
        address positions;
        address market;
        uint16 maxLtvBps;
        uint256 minBridgeOut;
        uint256 maxMusdIn;
    }

    function load(uint256 chainId) public returns (Config memory c, string memory path) {
        path = new Deploy().configPath(chainId);
        string memory json = vm.readFile(path);
        c.musd = vm.parseJsonAddress(json, ".musd.musd");
        c.priceFeed = vm.parseJsonAddress(json, ".musd.priceFeed");
        c.router = vm.parseJsonAddress(json, ".pools.router");
        c.poolFactory = vm.parseJsonAddress(json, ".pools.poolFactory");
        c.assetsBridge = vm.parseJsonAddress(json, ".bridge.assetsBridge");
        c.musdc = vm.parseJsonAddress(json, ".bridge.musdc");
        c.positions = _optionalAddress(json, ".assumable.positions");
        c.market = _optionalAddress(json, ".assumable.market");
        c.maxLtvBps = uint16(vm.parseJsonUint(json, ".cashOut.maxLtvBps"));
        c.minBridgeOut = vm.parseJsonUint(json, ".cashOut.routeBMinBridgeOut");
        c.maxMusdIn = vm.parseJsonUint(json, ".cashOut.routeBMaxMusdIn");
    }

    function run() external {
        (Config memory c, string memory path) = load(block.chainid);
        require(c.positions != address(0) && c.market != address(0), "deploy Assumable first");
        address signer = vm.envAddress("ORDER_SIGNER");

        vm.startBroadcast();
        // --interactives leaves msg.sender as Foundry's placeholder; ask for the real one.
        (, address deployer,) = vm.readCallers();
        address owner = vm.envOr("CASHOUT_OWNER", deployer);

        CashOutModule module = new CashOutModule(
            TrovePositions(c.positions),
            TroveMarket(c.market),
            IPriceFeed(c.priceFeed),
            IERC20(c.musd),
            signer,
            deployer
        );
        DirectMUSDAdapter direct = new DirectMUSDAdapter(address(module), IERC20(c.musd), owner);
        SwapBridgeAdapter swapBridge = new SwapBridgeAdapter(
            address(module),
            IERC20(c.musd),
            IERC20(c.musdc),
            IPoolRouter(c.router),
            c.poolFactory,
            IAssetsBridge(c.assetsBridge),
            c.minBridgeOut,
            c.maxMusdIn,
            owner
        );
        module.setAdapter(address(direct), true);
        module.setAdapter(address(swapBridge), true);
        if (c.maxLtvBps != module.maxLtvBps()) module.setMaxLtvBps(c.maxLtvBps);
        if (owner != deployer) module.transferOwnership(owner);
        vm.stopBroadcast();

        console2.log("CashOutModule      ", address(module));
        console2.log("DirectMUSDAdapter  ", address(direct));
        console2.log("SwapBridgeAdapter  ", address(swapBridge));
        console2.log("order signer       ", signer);
        console2.log("deploy block       ", block.number);

        if (vm.envOr("RECORD", false)) {
            vm.writeJson(vm.toString(address(module)), path, ".cashOut.module");
            vm.writeJson(vm.toString(address(direct)), path, ".cashOut.directAdapter");
            vm.writeJson(vm.toString(address(swapBridge)), path, ".cashOut.swapBridgeAdapter");
            vm.writeJson(vm.toString(block.number), path, ".cashOut.deployBlock");
        }
    }

    /// Null in the config means "not deployed on this network yet".
    function _optionalAddress(string memory json, string memory key)
        internal
        view
        returns (address)
    {
        try this.parseAddress(json, key) returns (address a) {
            return a;
        } catch {
            return address(0);
        }
    }

    function parseAddress(string memory json, string memory key) external pure returns (address) {
        return vm.parseJsonAddress(json, key);
    }
}

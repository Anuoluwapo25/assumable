// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

import {IAssetsBridge} from "../../src/interfaces/IAssetsBridge.sol";

/// @notice Stands in for Mezo's AssetsBridge precompile, which Foundry's EVM
///         can't run: validates like `bridgeOut` and burns with `burnFrom`.
contract MockAssetsBridge is IAssetsBridge {
    struct Unlock {
        address token;
        uint256 amount;
        uint8 chain;
        bytes recipient;
        address sender;
    }

    mapping(address => uint256) public minAmount;
    Unlock[] public unlocks;

    event AssetsUnlocked(
        uint256 indexed unlockSequenceNumber,
        bytes indexed recipient,
        address indexed token,
        address sender,
        uint256 amount,
        uint8 chain
    );

    function setMinBridgeOutAmount(address token, uint256 amount) external {
        minAmount[token] = amount;
    }

    function getMinBridgeOutAmount(address token) external view returns (uint256) {
        return minAmount[token];
    }

    function bridgeOut(address token, uint256 amount, uint8 chain, bytes calldata recipient)
        external
        returns (bool)
    {
        require(amount > 0 && amount >= minAmount[token], "amount below minimum");
        require(chain == 0 && recipient.length == 20, "bad recipient");
        ERC20Burnable(token).burnFrom(msg.sender, amount);
        unlocks.push(Unlock(token, amount, chain, recipient, msg.sender));
        emit AssetsUnlocked(unlocks.length, recipient, token, msg.sender, amount, chain);
        return true;
    }

    function unlockCount() external view returns (uint256) {
        return unlocks.length;
    }
}

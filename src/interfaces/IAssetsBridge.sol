// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Mezo's AssetsBridge precompile, the entry point for bridging out
///         through the native bridge.
/// @dev From mezo-org/mezod `precompile/assetsbridge/IAssetsBridge.sol`. Lives at
///      0x7b7c000000000000000000000000000000000012 on testnet and mainnet.
///      `bridgeOut` burns from `msg.sender` (ERC-20s via `burnFrom`, so the
///      caller approves the precompile first); contracts may call it.
interface IAssetsBridge {
    /// @param chain 0 for Ethereum, 1 for Bitcoin.
    /// @param recipient A 20-byte address for Ethereum.
    function bridgeOut(address token, uint256 amount, uint8 chain, bytes calldata recipient)
        external
        returns (bool);

    /// @return The governance-set minimum bridge-out for a Mezo token (0 if unset).
    function getMinBridgeOutAmount(address mezoToken) external view returns (uint256);
}

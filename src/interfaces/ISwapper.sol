// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Converts harvested BTC into MUSD.
///
/// @dev Abstracted because Mezo Swap's router address and interface are not
///      published in the docs, and because the best venue for a given size is
///      not a decision that belongs in the vault. An implementation is a thin
///      wrapper over a pool; swapping it out never touches depositor accounting.
///
///      Implementations must send at least `minMusdOut` MUSD to `msg.sender` or
///      revert. The vault sets `minMusdOut` from its own oracle, so a swapper
///      cannot quietly under-deliver.
interface ISwapper {
    /// @param minMusdOut Hard floor on MUSD returned to the caller.
    /// @return musdOut MUSD delivered to `msg.sender`.
    function swapBtcForMusd(uint256 minMusdOut) external payable returns (uint256 musdOut);
}

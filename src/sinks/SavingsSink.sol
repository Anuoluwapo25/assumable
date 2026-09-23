// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISink} from "../interfaces/ISink.sol";

/// @title SavingsSink
/// @notice Routes a policy's savings leg into Mezo's MUSD Savings Vault.
///
/// MUSD arrives, sMUSD leaves — straight into the recipient's own wallet. The
/// share price rises as Bitcoin borrowers pay interest and origination fees
/// into the vault, so income parked here earns Mezo protocol revenue rather
/// than sitting idle.
///
/// @dev This contract is stateless and holds nothing. It mints sMUSD with
///      `receiver` set to the account, never to itself, which is the whole
///      point: there is no share ledger to get wrong, no custody to trust, no
///      withdrawal function to gate, and no balance for an exploit to find.
///      An account's savings are ordinary sMUSD in their own wallet from the
///      moment they are paid, free to be staked in the gauge, lent, or sold
///      without Sluice's involvement.
///
///      `capacity` defers to the vault's own `maxDeposit`. If Mezo caps or
///      pauses deposits, this sink's capacity collapses and the router cascades
///      the savings slice to the next leg of the policy instead of reverting
///      the payment.
contract SavingsSink is ISink {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error AssetNotReceived();
    error VaultRefusedDeposit();

    /// @notice The MUSD Savings Vault (sMUSD).
    IERC4626 public immutable vault;

    /// @notice MUSD.
    IERC20 public immutable musd;

    constructor(IERC4626 vault_) {
        if (address(vault_) == address(0)) revert ZeroAddress();
        vault = vault_;
        musd = IERC20(vault_.asset());
        if (address(musd) == address(0)) revert ZeroAddress();
    }

    /// @inheritdoc ISink
    function asset() external view returns (address) {
        return address(musd);
    }

    /// @inheritdoc ISink
    function capacity(address account) external view returns (uint256) {
        return vault.maxDeposit(account);
    }

    /// @inheritdoc ISink
    /// @dev Permissionless by design. Calling this with your own MUSD simply
    ///      gifts `account` sMUSD, which is not an attack.
    function deposit(address account, uint256 amount) external returns (uint256) {
        if (account == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        // The caller transfers before calling; trust the balance, not the caller.
        if (musd.balanceOf(address(this)) < amount) revert AssetNotReceived();

        musd.forceApprove(address(vault), amount);
        uint256 shares = vault.deposit(amount, account);
        // Leave no standing allowance behind if the vault drew less than asked.
        musd.forceApprove(address(vault), 0);

        if (shares == 0) revert VaultRefusedDeposit();
        return amount;
    }

    /// @inheritdoc ISink
    function balanceOf(address account) external view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(account));
    }
}

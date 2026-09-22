// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IYieldAdapter} from "../interfaces/IYieldAdapter.sol";

/// @title ERC4626YieldAdapter
/// @notice Binds the savings leg to an ERC-4626 vault — on Mezo, the MUSD
///         Savings Vault that mints sMUSD.
///
/// @dev Only `custodian` may move value. That is the `SavingsVault`, which owns
///      the per-recipient share ledger; this contract deliberately holds no user
///      accounting of its own, so a bug here cannot misattribute one recipient's
///      savings to another.
///
///      Shares live on this contract's balance at the vault. `SavingsVault`
///      records who owns what.
contract ERC4626YieldAdapter is IYieldAdapter {
    using SafeERC20 for IERC20;

    error NotCustodian();
    error ZeroAddress();
    error AssetMismatch();
    error NothingToDeposit();

    /// @notice The ERC-4626 vault being saved into (MUSD Savings Vault / sMUSD).
    IERC4626 public immutable vault;

    /// @notice The vault's underlying asset (MUSD).
    IERC20 public immutable underlying;

    /// @notice The only address allowed to deposit and redeem. The SavingsVault.
    address public immutable custodian;

    modifier onlyCustodian() {
        if (msg.sender != custodian) revert NotCustodian();
        _;
    }

    /// @param vault_ The ERC-4626 savings vault.
    /// @param custodian_ The SavingsVault that owns the user share ledger.
    constructor(IERC4626 vault_, address custodian_) {
        if (address(vault_) == address(0) || custodian_ == address(0)) revert ZeroAddress();

        vault = vault_;
        custodian = custodian_;
        underlying = IERC20(vault_.asset());

        if (address(underlying) == address(0)) revert AssetMismatch();
    }

    /// @inheritdoc IYieldAdapter
    function asset() external view returns (address) {
        return address(underlying);
    }

    /// @inheritdoc IYieldAdapter
    /// @dev Expects the custodian to have transferred `assets` here already.
    ///      Approves exactly `assets` and deposits; no standing allowance is
    ///      left behind for the vault to draw on later.
    function deposit(uint256 assets) external onlyCustodian returns (uint256 shares) {
        if (assets == 0) revert NothingToDeposit();

        underlying.forceApprove(address(vault), assets);
        shares = vault.deposit(assets, address(this));
        // Clear any residue if the vault pulled less than approved.
        underlying.forceApprove(address(vault), 0);
    }

    /// @inheritdoc IYieldAdapter
    function redeem(uint256 shares, address receiver)
        external
        onlyCustodian
        returns (uint256 assets)
    {
        assets = vault.redeem(shares, receiver, address(this));
    }

    /// @inheritdoc IYieldAdapter
    function convertToAssets(uint256 shares) external view returns (uint256) {
        return vault.convertToAssets(shares);
    }

    /// @inheritdoc IYieldAdapter
    function convertToShares(uint256 assets) external view returns (uint256) {
        return vault.convertToShares(assets);
    }

    /// @inheritdoc IYieldAdapter
    function totalAssets() external view returns (uint256) {
        return vault.convertToAssets(vault.balanceOf(address(this)));
    }
}

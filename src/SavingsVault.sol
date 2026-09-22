// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IYieldAdapter} from "./interfaces/IYieldAdapter.sol";

/// @title SavingsVault
/// @notice Custodian of the savings leg. Holds the yield-venue shares that back
///         every recipient's savings and records who owns which.
///
/// @dev Two invariants define this contract:
///
///      1. **Recipients own their savings.** `withdraw` is callable only by the
///         owner of the balance, at any time, with no lockup and no fee. There
///         is no admin path that moves user funds — `owner` can point the vault
///         at a yield adapter and at a router, and nothing else.
///
///      2. **Principal and yield are tracked separately.** `principalOf` counts
///         only MUSD routed in from remittances. Everything above it is yield
///         earned on Mezo. The router uses principal for savings-goal progress
///         so that a goal completes on money actually saved, and the dashboard
///         uses the gap to show what Bitcoin loan revenue has paid out.
contract SavingsVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error NotRouter();
    error ZeroAddress();
    error ZeroAmount();
    error AdapterNotSet();
    error AdapterAlreadySet();
    error AssetMismatch();
    error FundsNotReceived();
    error InsufficientShares();

    /// @notice MUSD.
    IERC20 public immutable underlying;

    /// @notice Where saved MUSD earns — the MUSD Savings Vault, via an adapter.
    IYieldAdapter public adapter;

    /// @notice The only contract permitted to credit new savings.
    address public router;

    /// @notice Yield-venue shares backing each recipient's savings.
    mapping(address => uint256) public sharesOf;

    /// @notice MUSD routed in per recipient, excluding yield.
    mapping(address => uint256) public principalOf;

    /// @notice Sum of `sharesOf`. Never exceeds the shares the adapter holds.
    uint256 public totalShares;

    event AdapterSet(address indexed adapter);
    event RouterSet(address indexed router);
    event Credited(
        address indexed beneficiary, uint256 assets, uint256 shares, uint256 principalAfter
    );
    event Withdrawn(
        address indexed beneficiary,
        address indexed receiver,
        uint256 shares,
        uint256 assets,
        uint256 principalReleased
    );

    modifier onlyRouter() {
        if (msg.sender != router) revert NotRouter();
        _;
    }

    constructor(IERC20 underlying_, address owner_) Ownable(owner_) {
        if (address(underlying_) == address(0)) revert ZeroAddress();
        underlying = underlying_;
    }

    // --------------------------------------------------------------- wiring

    /// @notice Bind the yield adapter. Settable once, because changing it would
    ///         strand the shares already credited against the old venue.
    function setAdapter(IYieldAdapter adapter_) external onlyOwner {
        if (address(adapter_) == address(0)) revert ZeroAddress();
        if (address(adapter) != address(0)) revert AdapterAlreadySet();
        if (adapter_.asset() != address(underlying)) revert AssetMismatch();

        adapter = adapter_;
        emit AdapterSet(address(adapter_));
    }

    /// @notice Point the vault at its router. Re-settable so the routing layer
    ///         can be upgraded without migrating anyone's savings — the router
    ///         can only ever add to balances, never remove them.
    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = router_;
        emit RouterSet(router_);
    }

    // -------------------------------------------------------------- crediting

    /// @notice Record `assets` of MUSD as `beneficiary`'s savings and put it to
    ///         work in the yield venue.
    /// @dev The router transfers the MUSD here before calling. This contract
    ///      confirms the funds actually arrived rather than trusting the
    ///      router's word for it.
    function credit(address beneficiary, uint256 assets)
        external
        onlyRouter
        nonReentrant
        returns (uint256 shares)
    {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (assets == 0) revert ZeroAmount();
        if (address(adapter) == address(0)) revert AdapterNotSet();
        if (underlying.balanceOf(address(this)) < assets) revert FundsNotReceived();

        underlying.safeTransfer(address(adapter), assets);
        shares = adapter.deposit(assets);

        sharesOf[beneficiary] += shares;
        principalOf[beneficiary] += assets;
        totalShares += shares;

        emit Credited(beneficiary, assets, shares, principalOf[beneficiary]);
    }

    // ------------------------------------------------------------- withdrawal

    /// @notice Redeem `shares` of your own savings to `receiver`.
    function withdraw(uint256 shares, address receiver)
        external
        nonReentrant
        returns (uint256 assets)
    {
        return _withdraw(msg.sender, shares, receiver);
    }

    /// @notice Withdraw everything, yield included.
    function withdrawAll(address receiver) external nonReentrant returns (uint256) {
        return _withdraw(msg.sender, sharesOf[msg.sender], receiver);
    }

    /// @dev Principal is released in proportion to the shares burned, so the
    ///      remaining `principalOf` still reflects un-withdrawn contributions
    ///      and a partial withdrawal cannot understate future yield.
    function _withdraw(address account, uint256 shares, address receiver)
        private
        returns (uint256 assets)
    {
        if (receiver == address(0)) revert ZeroAddress();
        if (shares == 0) revert ZeroAmount();

        uint256 held = sharesOf[account];
        if (shares > held) revert InsufficientShares();

        uint256 principal = principalOf[account];
        // Release principal pro rata; the final withdrawal clears the remainder
        // so rounding can never leave a dust principal behind with zero shares.
        uint256 principalReleased = shares == held ? principal : (principal * shares) / held;

        sharesOf[account] = held - shares;
        principalOf[account] = principal - principalReleased;
        totalShares -= shares;

        // State is settled before the external redeem; `nonReentrant` on the
        // entry points closes the door a hostile MUSD or vault could knock on.
        assets = adapter.redeem(shares, receiver);

        emit Withdrawn(account, receiver, shares, assets, principalReleased);
    }

    // ------------------------------------------------------------------ views

    /// @notice What `account`'s savings are worth in MUSD right now.
    function balanceOfAssets(address account) public view returns (uint256) {
        uint256 shares = sharesOf[account];
        if (shares == 0) return 0;
        return adapter.convertToAssets(shares);
    }

    /// @notice MUSD earned on top of what was routed in. Zero before any accrual.
    function yieldOf(address account) external view returns (uint256) {
        uint256 value = balanceOfAssets(account);
        uint256 principal = principalOf[account];
        return value > principal ? value - principal : 0;
    }
}

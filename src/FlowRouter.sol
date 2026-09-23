// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISink} from "./interfaces/ISink.sol";

/// @title FlowRouter
/// @notice A receive policy for MUSD: an account declares, once, where its
///         income should go, and every subsequent payment obeys it atomically.
///
/// An account registers an ordered list of legs. Each leg claims a share of
/// every incoming payment, in basis points, and routes it into a sink. A leg
/// can carry a cap. When a leg is full — or when its sink cannot take any more —
/// the unclaimed amount cascades to the next leg in the list. Whatever no leg
/// claims lands spendable in the account's wallet.
///
/// The cascade is the point. Because sinks report live capacity, a policy that
/// reads "40% to servicing my Trove, 30% to savings, rest spendable" stops
/// paying down debt at the moment the debt is gone and moves that 40% into
/// savings on its own, with no transaction from the account.
///
/// @dev Design constraints worth stating, because they are what make this a
///      primitive rather than an application:
///
///      **The router never custodies MUSD.** Funds move from the payer to the
///      recipient and from the payer to each sink within one call. This
///      contract's MUSD balance is zero before and after every payment, so
///      there is no pot to drain and no upgrade that could steal one.
///
///      **The router has no owner.** There is no pause, no fee switch, no
///      allowlist and no admin. A deployed FlowRouter is finished. Recipients
///      who want to stop routing empty their own policy.
///
///      **Policies are self-sovereign.** Every mutation keys off `msg.sender`.
///      A payer cannot read a policy into existence, change one, or opt out of
///      one; a recipient cannot be paid in a way that bypasses their own rules.
contract FlowRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------- constants

    /// @notice 10_000 bps == 100%.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Cap on legs per policy. The payer pays for the loop, so it is
    ///         bounded to stop a recipient griefing everyone who pays them.
    uint256 public constant MAX_LEGS = 8;

    // ----------------------------------------------------------------- types

    /// @param sink Where this leg's share goes.
    /// @param bps This leg's share of every incoming payment.
    /// @param ref Stable identity for the leg. Progress is tracked against it,
    ///        so editing a policy does not reset a half-funded goal, and a UI
    ///        can hang a human-readable label off it without putting strings
    ///        on-chain.
    /// @param cap Lifetime ceiling on what this leg will route. 0 is unbounded.
    struct Leg {
        ISink sink;
        uint16 bps;
        bytes32 ref;
        uint256 cap;
    }

    /// @notice One leg's share of a specific payment.
    struct Allocation {
        bytes32 ref;
        ISink sink;
        uint256 amount;
        bool fillsCap;
    }

    // ---------------------------------------------------------------- errors

    error ZeroAddress();
    error ZeroAmount();
    error SelfPayment();
    error TooManyLegs();
    error AllocationExceedsUnity();
    error DuplicateRef();
    error SinkAssetMismatch();
    error SinkRejectedDeposit();

    // ---------------------------------------------------------------- events

    event PolicySet(address indexed account, uint256 legs, uint256 totalBps);
    event ProgressReset(address indexed account, bytes32 indexed ref, uint256 from);
    event Routed(
        address indexed payer, address indexed recipient, uint256 amount, uint256 spendable
    );
    event LegFunded(
        address indexed recipient,
        bytes32 indexed ref,
        address indexed sink,
        address payer,
        uint256 amount,
        uint256 filledAfter
    );

    // ----------------------------------------------------------------- state

    /// @notice MUSD. Immutable: a router is bound to one asset for its life.
    IERC20 public immutable musd;

    mapping(address => Leg[]) private _policies;

    /// @notice Cumulative MUSD routed per account, per leg identity. Survives
    ///         policy edits and is what `cap` is measured against.
    mapping(address account => mapping(bytes32 ref => uint256)) public filled;

    constructor(IERC20 musd_) {
        if (address(musd_) == address(0)) revert ZeroAddress();
        musd = musd_;
    }

    // ---------------------------------------------------------------- policy

    /// @notice Replace the caller's policy wholesale.
    /// @dev Wholesale replacement rather than per-leg mutation keeps validation
    ///      total: every accepted policy is checked as a unit, so no sequence
    ///      of edits can leave one over-allocated. Progress carries across the
    ///      edit via `ref`, so raising a savings target or re-ordering legs does
    ///      not restart a goal.
    function setPolicy(Leg[] calldata legs) external {
        if (legs.length > MAX_LEGS) revert TooManyLegs();
        uint256 totalBps = _validate(legs);
        _store(_policies[msg.sender], legs);
        emit PolicySet(msg.sender, legs.length, totalBps);
    }

    /// @dev Validates the policy as a unit. Wholesale replacement rather than
    ///      per-leg mutation is what makes this total: no sequence of edits can
    ///      leave an account over-allocated, because every accepted policy was
    ///      checked complete.
    function _validate(Leg[] calldata legs) private view returns (uint256 totalBps) {
        uint256 n = legs.length;
        for (uint256 i; i < n; ++i) {
            ISink sink = legs[i].sink;
            if (address(sink) == address(0)) revert ZeroAddress();
            if (sink.asset() != address(musd)) revert SinkAssetMismatch();

            totalBps += legs[i].bps;

            // Refs key the progress ledger, so a duplicate would let two legs
            // share one cap and silently double-count.
            for (uint256 j; j < i; ++j) {
                if (legs[j].ref == legs[i].ref) revert DuplicateRef();
            }
        }
        if (totalBps > BPS_DENOMINATOR) revert AllocationExceedsUnity();
    }

    /// @dev Rewrites in place rather than delete-and-repush, so an edit that
    ///      keeps most legs costs only the fields that actually changed.
    ///      Progress carries across the edit via `ref`, so raising a savings
    ///      target or reordering legs does not restart a goal.
    function _store(Leg[] storage policy, Leg[] calldata legs) private {
        uint256 n = legs.length;
        for (uint256 i; i < n; ++i) {
            if (i == policy.length) policy.push();
            Leg storage dst = policy[i];
            dst.sink = legs[i].sink;
            dst.bps = legs[i].bps;
            dst.ref = legs[i].ref;
            dst.cap = legs[i].cap;
        }
        while (policy.length > n) {
            policy.pop();
        }
    }

    /// @notice Clear the caller's policy. All future income becomes spendable.
    function clearPolicy() external {
        delete _policies[msg.sender];
        emit PolicySet(msg.sender, 0, 0);
    }

    /// @notice Restart a capped leg, so it begins claiming its share again.
    function resetProgress(bytes32 ref) external {
        uint256 from = filled[msg.sender][ref];
        filled[msg.sender][ref] = 0;
        emit ProgressReset(msg.sender, ref, from);
    }

    // --------------------------------------------------------------- routing

    /// @notice Pay `recipient` `amount` of MUSD, honouring their policy.
    /// @dev The payer approves this router for `amount` first. Every sink is
    ///      paid from the payer's balance directly.
    /// @return spendable MUSD delivered to the recipient's wallet.
    function route(address recipient, uint256 amount)
        external
        nonReentrant
        returns (uint256 spendable)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (recipient == msg.sender) revert SelfPayment();

        Leg[] storage policy = _policies[recipient];
        (uint256 routed, Allocation[] memory allocations) = _plan(policy, recipient, amount);
        spendable = amount - routed;

        if (spendable > 0) {
            musd.safeTransferFrom(msg.sender, recipient, spendable);
        }

        for (uint256 i; i < allocations.length; ++i) {
            _settle(recipient, allocations[i]);
        }

        emit Routed(msg.sender, recipient, amount, spendable);
    }

    // ----------------------------------------------------------------- views

    /// @notice Preview a payment without moving funds.
    /// @dev `route` and `preview` share `_plan`, so what a payer is shown before
    ///      they sign is what executes.
    function preview(address recipient, uint256 amount)
        external
        view
        returns (uint256 spendable, Allocation[] memory allocations)
    {
        if (amount == 0) revert ZeroAmount();
        uint256 routed;
        (routed, allocations) = _plan(_policies[recipient], recipient, amount);
        spendable = amount - routed;
    }

    function policyOf(address account) external view returns (Leg[] memory) {
        return _policies[account];
    }

    /// @notice Remaining headroom on a leg, in MUSD. `type(uint256).max` if the
    ///         leg is uncapped.
    function headroomOf(address account, uint256 legIndex) external view returns (uint256) {
        Leg storage leg = _policies[account][legIndex];
        return _headroom(leg, account);
    }

    // ------------------------------------------------------------- internals

    /// @dev Hand one leg's share to its sink and record the progress.
    function _settle(address recipient, Allocation memory a) private {
        musd.safeTransferFrom(msg.sender, address(a.sink), a.amount);

        // A sink must apply everything or revert. Anything less would leave
        // MUSD sitting in the sink credited to nobody.
        if (a.sink.deposit(recipient, a.amount) != a.amount) revert SinkRejectedDeposit();

        uint256 filledAfter = filled[recipient][a.ref] + a.amount;
        filled[recipient][a.ref] = filledAfter;

        emit LegFunded(recipient, a.ref, address(a.sink), msg.sender, a.amount, filledAfter);
    }

    /// @dev The planner. Each leg takes its bps slice of `amount` plus anything
    ///      cascaded from the legs before it, clamped by the leg's own cap and
    ///      by what its sink will accept. What the last leg cannot absorb is
    ///      spendable.
    function _plan(Leg[] storage policy, address recipient, uint256 amount)
        private
        view
        returns (uint256 routed, Allocation[] memory allocations)
    {
        allocations = new Allocation[](policy.length);
        uint256 count;
        uint256 carry;

        for (uint256 i; i < policy.length; ++i) {
            Leg storage leg = policy[i];

            uint256 pool = (amount * leg.bps) / BPS_DENOMINATOR + carry;
            if (pool == 0) continue;

            uint256 take = _clamp(leg, recipient, pool);
            carry = pool - take;
            if (take == 0) continue;

            routed += take;
            _record(allocations[count++], leg, recipient, take);
        }

        // Shrink to the allocations actually produced.
        assembly ("memory-safe") {
            mstore(allocations, count)
        }
    }

    /// @dev Fills one slot of the plan. Written field by field rather than as a
    ///      struct literal to keep the planner's stack frame shallow.
    function _record(Allocation memory slot, Leg storage leg, address account, uint256 take)
        private
        view
    {
        slot.ref = leg.ref;
        slot.sink = leg.sink;
        slot.amount = take;
        slot.fillsCap = leg.cap != 0 && filled[account][leg.ref] + take >= leg.cap;
    }

    /// @dev How much of `pool` this leg can actually absorb: its own remaining
    ///      cap, and whatever its sink says it will take, whichever binds first.
    function _clamp(Leg storage leg, address account, uint256 pool) private view returns (uint256) {
        uint256 limit = _headroom(leg, account);
        uint256 sinkRoom = leg.sink.capacity(account);
        if (sinkRoom < limit) limit = sinkRoom;
        return pool < limit ? pool : limit;
    }

    function _headroom(Leg storage leg, address account) private view returns (uint256) {
        if (leg.cap == 0) return type(uint256).max;
        uint256 done = filled[account][leg.ref];
        return leg.cap > done ? leg.cap - done : 0;
    }
}

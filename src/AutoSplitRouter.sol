// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SavingsVault} from "./SavingsVault.sol";

/// @title AutoSplitRouter
/// @notice Splits every inbound MUSD remittance according to the *recipient's*
///         savings goals, then puts the saved slice to work on Mezo.
///
/// A recipient declares goals once — "school fees, 15%, target 500 MUSD",
/// "emergency fund, 10%, open-ended". Goals are held in priority order. Each
/// claims a slice of every inbound transfer; when a goal fills, its unclaimed
/// slice cascades to the next goal in line, and whatever no goal claims lands
/// spendable in the recipient's wallet.
///
/// @dev Three properties worth stating explicitly, because they are what make
///      this safe to put in front of migrant workers' money:
///
///      1. **The recipient owns the rule.** A sender can route money to someone
///         but can never see or change how that person saves. Every mutating
///         goal function keys off `msg.sender`, so there is no path for one
///         account to edit another's goals.
///
///      2. **The router never custodies funds.** MUSD moves from the sender
///         straight to the recipient and straight to the SavingsVault, in the
///         same transaction. This contract's MUSD balance is zero before and
///         after every call, so there is no pot for an exploit or an admin to
///         drain.
///
///      3. **Preview and execution share one planner.** `quote` and `route`
///         both call `_plan`, so the breakdown the UI shows a sender before
///         they sign is the breakdown that executes.
contract AutoSplitRouter is Ownable2Step, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------- constants

    /// @notice 10_000 bps == 100%.
    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Cap on live goals per recipient. Bounds the gas cost of `route`,
    ///         which a sender pays — an unbounded goal list would let a
    ///         recipient grief everyone who pays them.
    uint256 public constant MAX_GOALS = 8;

    /// @notice Longest a goal name may be, in bytes.
    uint256 public constant MAX_NAME_LEN = 48;

    // ----------------------------------------------------------------- types

    enum GoalStatus {
        Active, // taking a slice of every inbound transfer
        Reached, // target met; skipped by `route` until the target is raised
        Archived // retired by the owner; frees its allocation
    }

    struct Goal {
        uint32 id;
        uint16 allocationBps;
        GoalStatus status;
        uint64 deadline; // display only, never enforced on-chain
        uint256 target; // 0 means open-ended
        uint256 saved; // principal routed in; excludes vault yield
        string name;
    }

    /// @notice One goal's share of a specific split.
    struct Fill {
        uint32 goalId;
        uint256 amount;
        bool reachesTarget;
    }

    /// @notice The outcome of a split.
    struct Split {
        uint256 payout;
        uint256 saved;
    }

    struct Stats {
        uint256 totalReceived;
        uint256 totalSaved;
        uint32 transfers;
    }

    // ----------------------------------------------------------------- errors

    error ZeroAddress();
    error InvalidAmount();
    error SelfTransfer();
    error InvalidSplit();
    error GoalNotFound();
    error TooManyGoals();
    error BadReorder();
    error InvalidName();

    // ----------------------------------------------------------------- events

    event GoalCreated(
        address indexed owner,
        uint32 indexed goalId,
        string name,
        uint256 target,
        uint16 allocationBps
    );
    event GoalUpdated(
        address indexed owner,
        uint32 indexed goalId,
        uint256 target,
        uint16 allocationBps,
        GoalStatus status
    );
    event GoalsReordered(address indexed owner);
    event GoalFunded(
        address indexed owner,
        address indexed sender,
        uint32 indexed goalId,
        uint256 amount,
        uint256 savedAfter,
        bool reached
    );
    event Routed(
        address indexed sender,
        address indexed recipient,
        uint256 amount,
        uint256 payout,
        uint256 saved
    );

    // ----------------------------------------------------------------- state

    /// @notice MUSD.
    IERC20 public immutable musd;

    /// @notice Where the saved slice goes to earn.
    SavingsVault public immutable savingsVault;

    mapping(address => Goal[]) private _goals;
    mapping(address => uint32) private _nextGoalId;

    /// @notice Lifetime totals per recipient, for the dashboard.
    mapping(address => Stats) public statsOf;

    constructor(IERC20 musd_, SavingsVault savingsVault_, address owner_) Ownable(owner_) {
        if (address(musd_) == address(0) || address(savingsVault_) == address(0)) {
            revert ZeroAddress();
        }
        musd = musd_;
        savingsVault = savingsVault_;
    }

    // -------------------------------------------------------------- goals API

    /// @notice Create a savings goal owned by the caller.
    /// @param target Target in MUSD base units. 0 means open-ended.
    /// @param deadline Unix timestamp for the UI countdown. 0 means none.
    /// @param allocationBps This goal's slice of every inbound transfer. The sum
    ///        across the caller's active goals may not exceed 100%.
    function addGoal(string calldata name, uint256 target, uint64 deadline, uint16 allocationBps)
        external
        returns (uint32 id)
    {
        _validateGoalFields(name, allocationBps);

        Goal[] storage goals = _goals[msg.sender];
        if (_liveGoalCount(goals) >= MAX_GOALS) revert TooManyGoals();
        if (_activeAllocBps(goals, type(uint32).max) + allocationBps > BPS_DENOMINATOR) {
            revert InvalidSplit();
        }

        id = _nextGoalId[msg.sender]++;
        goals.push(
            Goal({
                id: id,
                allocationBps: allocationBps,
                status: GoalStatus.Active,
                deadline: deadline,
                target: target,
                saved: 0,
                name: name
            })
        );

        emit GoalCreated(msg.sender, id, name, target, allocationBps);
    }

    /// @notice Replace a goal's editable fields.
    /// @dev Raising the target above what is already saved reactivates a goal
    ///      that had been marked `Reached`.
    function updateGoal(
        uint32 goalId,
        string calldata name,
        uint256 target,
        uint64 deadline,
        uint16 allocationBps
    ) external {
        _validateGoalFields(name, allocationBps);

        Goal[] storage goals = _goals[msg.sender];
        uint256 idx = _indexOf(goals, goalId);
        if (_activeAllocBps(goals, goalId) + allocationBps > BPS_DENOMINATOR) {
            revert InvalidSplit();
        }

        Goal storage g = goals[idx];
        g.name = name;
        g.target = target;
        g.deadline = deadline;
        g.allocationBps = allocationBps;
        g.status = (target > 0 && g.saved >= target) ? GoalStatus.Reached : GoalStatus.Active;

        emit GoalUpdated(msg.sender, goalId, target, allocationBps, g.status);
    }

    /// @notice Retire a goal, freeing its allocation. The savings it already
    ///         holds stay in the vault and remain withdrawable — archiving
    ///         changes future routing only.
    function archiveGoal(uint32 goalId) external {
        Goal[] storage goals = _goals[msg.sender];
        Goal storage g = goals[_indexOf(goals, goalId)];
        g.status = GoalStatus.Archived;
        g.allocationBps = 0;

        emit GoalUpdated(msg.sender, goalId, g.target, 0, GoalStatus.Archived);
    }

    /// @notice Reorder goals. Priority decides who receives cascaded overflow
    ///         when a goal ahead in the list fills up.
    /// @param orderedIds A permutation of the caller's current goal ids.
    function reorderGoals(uint32[] calldata orderedIds) external {
        Goal[] storage goals = _goals[msg.sender];
        uint256 n = goals.length;
        if (orderedIds.length != n) revert BadReorder();

        Goal[] memory reordered = new Goal[](n);
        bool[] memory taken = new bool[](n);

        for (uint256 i; i < n; ++i) {
            uint256 idx = _indexOf(goals, orderedIds[i]);
            if (taken[idx]) revert BadReorder(); // duplicate id
            taken[idx] = true;
            reordered[i] = goals[idx];
        }

        for (uint256 i; i < n; ++i) {
            goals[i] = reordered[i];
        }

        emit GoalsReordered(msg.sender);
    }

    /// @notice Flat-percentage shim for clients that predate goals. Maps onto a
    ///         single open-ended goal named "Savings".
    function setRule(uint16 saveBps) external {
        if (saveBps > BPS_DENOMINATOR) revert InvalidSplit();

        Goal[] storage goals = _goals[msg.sender];
        for (uint256 i; i < goals.length; ++i) {
            if (keccak256(bytes(goals[i].name)) == keccak256("Savings")) {
                Goal storage g = goals[i];
                if (_activeAllocBps(goals, g.id) + saveBps > BPS_DENOMINATOR) {
                    revert InvalidSplit();
                }
                g.allocationBps = saveBps;
                g.status = saveBps > 0 ? GoalStatus.Active : GoalStatus.Archived;
                emit GoalUpdated(msg.sender, g.id, g.target, saveBps, g.status);
                return;
            }
        }

        if (_liveGoalCount(goals) >= MAX_GOALS) revert TooManyGoals();
        if (_activeAllocBps(goals, type(uint32).max) + saveBps > BPS_DENOMINATOR) {
            revert InvalidSplit();
        }

        uint32 id = _nextGoalId[msg.sender]++;
        goals.push(
            Goal({
                id: id,
                allocationBps: saveBps,
                status: GoalStatus.Active,
                deadline: 0,
                target: 0,
                saved: 0,
                name: "Savings"
            })
        );
        emit GoalCreated(msg.sender, id, "Savings", 0, saveBps);
    }

    // -------------------------------------------------------------- routing

    /// @notice Send `amount` MUSD to `recipient`, split across their goals.
    /// @dev The caller approves this contract for `amount` first. Funds move
    ///      sender -> recipient and sender -> SavingsVault directly; the router
    ///      holds nothing at any point.
    function route(address recipient, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (Split memory split)
    {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (msg.sender == recipient) revert SelfTransfer();

        Goal[] storage goals = _goals[recipient];
        (uint256 saved, Fill[] memory fills) = _plan(goals, amount);
        uint256 payout = amount - saved;

        if (payout > 0) {
            musd.safeTransferFrom(msg.sender, recipient, payout);
        }

        if (saved > 0) {
            musd.safeTransferFrom(msg.sender, address(savingsVault), saved);
            savingsVault.credit(recipient, saved);

            for (uint256 i; i < fills.length; ++i) {
                Goal storage g = goals[_indexOf(goals, fills[i].goalId)];
                g.saved += fills[i].amount;
                bool reached = g.target > 0 && g.saved >= g.target;
                if (reached) g.status = GoalStatus.Reached;

                emit GoalFunded(
                    recipient, msg.sender, fills[i].goalId, fills[i].amount, g.saved, reached
                );
            }
        }

        Stats storage s = statsOf[recipient];
        s.totalReceived += amount;
        s.totalSaved += saved;
        s.transfers += 1;

        emit Routed(msg.sender, recipient, amount, payout, saved);
        split = Split({payout: payout, saved: saved});
    }

    // ----------------------------------------------------------------- views

    /// @notice Preview a split without moving funds.
    function quote(address recipient, uint256 amount) external view returns (Split memory) {
        if (amount == 0) revert InvalidAmount();
        (uint256 saved,) = _plan(_goals[recipient], amount);
        return Split({payout: amount - saved, saved: saved});
    }

    /// @notice Preview which goals a transfer would feed, and by how much.
    /// @dev The amounts sum to `quote(recipient, amount).saved`.
    function quotePlan(address recipient, uint256 amount) external view returns (Fill[] memory) {
        if (amount == 0) revert InvalidAmount();
        (, Fill[] memory fills) = _plan(_goals[recipient], amount);
        return fills;
    }

    function goalsOf(address account) external view returns (Goal[] memory) {
        return _goals[account];
    }

    /// @notice Total bps currently claimed by the account's active goals.
    function allocatedBps(address account) external view returns (uint16) {
        return _activeAllocBps(_goals[account], type(uint32).max);
    }

    // ------------------------------------------------------------- internals

    /// @dev The split planner. `route` and `quote` share it, so the preview and
    ///      the execution can never disagree.
    ///
    ///      Each active goal gets `amount * allocationBps / 10_000` as its base
    ///      slice. A goal capped by its target takes only what fits; the
    ///      leftover cascades to the next goal in priority order. Anything left
    ///      after the last goal is the recipient's spendable payout.
    function _plan(Goal[] storage goals, uint256 amount)
        private
        view
        returns (uint256 totalSaved, Fill[] memory fills)
    {
        uint256 n = goals.length;
        Fill[] memory buf = new Fill[](n);
        uint256 count;
        uint256 carry;

        for (uint256 i; i < n; ++i) {
            Goal storage g = goals[i];
            if (g.status != GoalStatus.Active || g.allocationBps == 0) continue;

            uint256 pool = (amount * g.allocationBps) / BPS_DENOMINATOR + carry;
            if (pool == 0) continue;

            uint256 take;
            if (g.target > 0) {
                uint256 room = g.target > g.saved ? g.target - g.saved : 0;
                take = pool > room ? room : pool;
            } else {
                take = pool;
            }

            carry = pool - take;
            if (take > 0) {
                totalSaved += take;
                buf[count++] = Fill({
                    goalId: g.id,
                    amount: take,
                    reachesTarget: g.target > 0 && g.saved + take >= g.target
                });
            }
        }

        // Shrink the buffer to the fills actually produced.
        assembly {
            mstore(buf, count)
        }
        fills = buf;
    }

    function _validateGoalFields(string calldata name, uint16 allocationBps) private pure {
        uint256 len = bytes(name).length;
        if (len == 0 || len > MAX_NAME_LEN) revert InvalidName();
        if (allocationBps > BPS_DENOMINATOR) revert InvalidSplit();
    }

    /// @dev Sum of active allocations, optionally excluding one goal so an
    ///      update can be validated against its replacement value.
    function _activeAllocBps(Goal[] storage goals, uint32 excludeId)
        private
        view
        returns (uint16 total)
    {
        for (uint256 i; i < goals.length; ++i) {
            Goal storage g = goals[i];
            if (g.status == GoalStatus.Active && g.id != excludeId) {
                total += g.allocationBps;
            }
        }
    }

    function _liveGoalCount(Goal[] storage goals) private view returns (uint256 count) {
        for (uint256 i; i < goals.length; ++i) {
            if (goals[i].status != GoalStatus.Archived) ++count;
        }
    }

    function _indexOf(Goal[] storage goals, uint32 goalId) private view returns (uint256) {
        for (uint256 i; i < goals.length; ++i) {
            if (goals[i].id == goalId) return i;
        }
        revert GoalNotFound();
    }

    // ------------------------------------------------------------ operations

    /// @notice Halt new routing. Deliberately narrow: this cannot touch anyone's
    ///         savings, and withdrawals from the SavingsVault stay open while
    ///         paused. It exists to stop inbound flow if a downstream venue
    ///         misbehaves, not to gate user funds.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

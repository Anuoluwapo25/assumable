// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IStabilityPool} from "../../src/interfaces/IStabilityPool.sol";
import {MockMUSD} from "./MockMUSD.sol";

/// @dev Reproduces the real pool's product-sum accounting rather than faking a
///      balance, because the vault's correctness depends on exactly that math:
///      a deposit is `d0 * P / P0` and shrinks on liquidation, while the gain is
///      `d0 * (S - S0) / P0`. Epoch and scale rollovers are omitted; they only
///      matter once P approaches zero.
contract MockStabilityPool is IStabilityPool {
    uint256 constant PRECISION = 1e18;

    MockMUSD public immutable musd;

    uint256 public P = PRECISION;
    uint256 public S;
    uint256 public totalDeposits;

    mapping(address => uint256) public initialDeposit;
    mapping(address => uint256) public snapshotP;
    mapping(address => uint256) public snapshotS;

    /// @dev Stands in for `_requireNoUnderCollateralizedTroves`.
    bool public blockWithdrawals;

    constructor(MockMUSD musd_) {
        musd = musd_;
    }

    receive() external payable {}

    function setBlockWithdrawals(bool blocked) external {
        blockWithdrawals = blocked;
    }

    /// @dev Absorb a liquidation: burn `debtToOffset` of pooled MUSD and share
    ///      `collToAdd` BTC among depositors. Fund the BTC by sending value.
    function simulateLiquidation(uint256 debtToOffset, uint256 collToAdd) external payable {
        require(totalDeposits >= debtToOffset, "pool too small");

        uint256 collateralGainPerUnit = (collToAdd * PRECISION) / totalDeposits;
        uint256 lossPerUnit = (debtToOffset * PRECISION) / totalDeposits;

        // Liquity holds S at 1e36 scale (gain-per-unit * P) and divides by
        // PRECISION only when reading the gain. Scaling it down here instead
        // would round every small collateral gain to zero.
        S += collateralGainPerUnit * P;
        P = (P * (PRECISION - lossPerUnit)) / PRECISION;

        totalDeposits -= debtToOffset;
        musd.burn(address(this), debtToOffset);
    }

    function provideToSP(uint256 _amount) external {
        _payOutGain(msg.sender);

        uint256 compounded = getCompoundedMUSDDeposit(msg.sender);
        musd.transferFrom(msg.sender, address(this), _amount);

        totalDeposits += _amount;
        _snapshot(msg.sender, compounded + _amount);
    }

    function withdrawFromSP(uint256 _amount) external {
        if (_amount != 0 && blockWithdrawals) revert("undercollateralized troves");

        _payOutGain(msg.sender);

        uint256 compounded = getCompoundedMUSDDeposit(msg.sender);
        uint256 amount = _amount > compounded ? compounded : _amount;

        totalDeposits -= amount;
        _snapshot(msg.sender, compounded - amount);

        if (amount > 0) musd.transfer(msg.sender, amount);
    }

    function withdrawCollateralGainToTrove(address, address) external {
        revert("not used");
    }

    function getCompoundedMUSDDeposit(address _depositor) public view returns (uint256) {
        uint256 d0 = initialDeposit[_depositor];
        if (d0 == 0) return 0;
        return (d0 * P) / snapshotP[_depositor];
    }

    function getDepositorCollateralGain(address _depositor) public view returns (uint256) {
        uint256 d0 = initialDeposit[_depositor];
        if (d0 == 0) return 0;
        return (d0 * (S - snapshotS[_depositor])) / snapshotP[_depositor] / PRECISION;
    }

    function getTotalMUSDDeposits() external view returns (uint256) {
        return totalDeposits;
    }

    function getCollateralBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function _snapshot(address who, uint256 newDeposit) private {
        initialDeposit[who] = newDeposit;
        snapshotP[who] = P;
        snapshotS[who] = S;
    }

    /// @dev The real pool pushes collateral before every operation, with no
    ///      claim function. The vault has to cope with BTC arriving unbidden.
    function _payOutGain(address who) private {
        uint256 gain = getDepositorCollateralGain(who);
        if (gain == 0) return;
        _snapshot(who, getCompoundedMUSDDeposit(who));
        (bool ok,) = who.call{value: gain}("");
        require(ok, "collateral send failed");
    }
}

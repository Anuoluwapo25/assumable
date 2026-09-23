# Sluice

**Programmable receive policies for MUSD.**

An account declares, once, where its income should go. Every MUSD payment it
receives from then on obeys that policy atomically, in the same transaction as
the payment, with no keeper, no scheduled job, and no custody.

```
payer ──▶ FlowRouter ──┬──▶ leg 1  ──▶ sink   (capacity-bounded)
   MUSD                ├──▶ leg 2  ──▶ sink
                       └──▶ remainder ──▶ recipient's wallet (spendable)
```

## Why this belongs on Mezo

MUSD is income. People borrow it against Bitcoin, earn it, and get paid in it.
But a stablecoin balance is inert: every decision about what to do with it —
service the loan it came from, save it, spend it — is a separate transaction the
holder has to remember to send.

Sluice makes those decisions once and enforces them at the moment of receipt.
The two flagship destinations are Mezo's own products:

- **The MUSD Savings Vault.** Saved income becomes sMUSD in the recipient's own
  wallet, appreciating as Bitcoin borrowers pay interest and origination fees
  into the vault. Income earns Mezo protocol revenue instead of sitting idle.
- **A Trove.** Income automatically services the Bitcoin-backed loan it came
  from, so collateral stays safe without the borrower watching it. (Design
  below; shipping after the repayment-authorization question is settled.)

Remove MUSD and there is no protocol here. The sinks *are* Mezo.

## The primitive

Sluice does not decide where income should go. It decides *how much* goes where,
and hands over. Destinations are `ISink` implementations, chosen by the account
that owns the policy.

```solidity
interface ISink {
    function asset() external view returns (address);
    function capacity(address account) external view returns (uint256);
    function deposit(address account, uint256 amount) external returns (uint256 applied);
    function balanceOf(address account) external view returns (uint256);
}
```

`capacity` is the interesting one. It is live protocol state, not a user
setting, and the router treats it as a hard limit — so a policy reading

> 50% services my Trove · 20% to savings · the rest is spendable

pays down debt until the debt is gone, and then moves that 50% into savings **by
itself**, with no transaction from the account and no change to the policy. A
vault that pauses deposits, a loan that gets repaid elsewhere, a cap that fills:
all of them just change a number that the next payment reads.

That cascade is the protocol. Everything else is plumbing.

## Properties

**No custody.** MUSD moves from the payer to the recipient and from the payer to
each sink inside one call. `FlowRouter`'s MUSD balance is zero before and after
every payment. `SavingsSink` is stateless and mints sMUSD with `receiver` set to
the account, never to itself — savings are ordinary tokens in the recipient's
wallet from the instant they are paid, free to be staked in the gauge, lent, or
sold without Sluice's involvement. There is no share ledger, no withdrawal
function, and no balance for an exploit to find.

**No admin.** `FlowRouter` has no owner, no pause, no fee switch and no sink
allowlist. A deployed router is finished. Recipients who want to stop routing
clear their own policy.

**Self-sovereign policies.** Every mutation keys off `msg.sender`. A payer
cannot create, read into existence, alter, or opt out of someone else's policy;
a recipient cannot be paid in a way that bypasses their own rules.

**Blast radius of one.** Sinks are deliberately not allowlisted, because an
allowlist is an admin key and composability is the point. A hostile sink can
burn its own chooser's gas or revert their payments — it can never touch funds
belonging to anyone else. Three tests pin this down: a sink that tries to
re-enter `route`, one that under-applies a deposit to strand a wei, and one that
overstates capacity.

**Preview parity.** `preview` and `route` share one planner, so the breakdown a
payer is shown before signing is the breakdown that executes.

## Contracts

| | |
|---|---|
| [`FlowRouter.sol`](src/FlowRouter.sol) | Policy registry and the cascade. Ownerless, custody-free. |
| [`ISink.sol`](src/interfaces/ISink.sol) | The extension point. Three rules implementations must hold to. |
| [`SavingsSink.sol`](src/sinks/SavingsSink.sol) | MUSD Savings Vault. Stateless; sMUSD goes straight to the account. |

A policy is up to 8 legs of `{sink, bps, ref, cap}`. `ref` is the leg's stable
identity: progress is tracked against it, so re-rating or reordering a policy
does not restart a half-funded goal, and a UI hangs human-readable labels off it
without putting strings on-chain.

## Planned: `TroveSink`

MUSD is a [Threshold USD](https://github.com/Threshold-USD/dev) fork of Liquity;
positions are Troves. A Trove sink reports capacity as the debt that is *legally*
repayable — entire debt less the protocol's minimum-debt floor and the $200 MUSD
gas compensation held by `GasPool` — because repaying below that floor reverts
rather than closing the position. Getting that boundary right is most of the
work, and it is the reason capacity is a first-class part of `ISink`.

One open question gates it: `BorrowerOperations.repayMUSD` burns from the
caller, so a third party cannot repay another account's Trove directly. Mezo
ships `BorrowerOperationsSignatures.repayMUSDWithSignature`, explicitly for
third-party execution, but an EIP-712 signature commits to a fixed amount and a
deadline — which does not fit "repay whatever arrives, whenever it arrives." The
alternatives are a per-account proxy that owns the Trove, or a standing
authorization. **This needs confirming with the Mezo team before it is built.**

## Status

21 tests, including hostile-sink handling and a fuzzed value-conservation
invariant.

```
forge test
```

**Not yet deployed.** `SMUSD_VAULT_ADDRESS` in [`.env.example`](.env.example) is
blank on purpose: Mezo's
[contracts reference](https://mezo.org/docs/users/resources/contracts-reference/)
publishes mainnet MUSD, MEZO and pool addresses, but not the Savings Vault, and
no testnet core addresses. The vault's address and its ERC-4626 conformance are
the two things to confirm before deploying. [`Deploy.s.sol`](script/Deploy.s.sol)
asserts `vault.asset() == MUSD` before broadcasting, so a wrong address fails
early rather than leaving a half-deployed system.

```bash
cp .env.example .env   # fill in SMUSD_VAULT_ADDRESS
forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast
```

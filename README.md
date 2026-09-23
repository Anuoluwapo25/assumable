# Backstop

**An auto-compounding vault over MUSD's Stability Pool.**

Deposit MUSD, get `bMUSD`, and earn from every liquidation on Mezo — without
ever touching a BTC balance or a harvest button.

## What it does

The Stability Pool is what keeps MUSD solvent. When a Trove falls below 110%
collateralization, the pool absorbs its debt: depositors' MUSD is burned, and
they receive the liquidated BTC **at a discount**. You are paid a premium for
taking on bad debt.

The catch is that it isn't passive. Your gains arrive as raw BTC that sits idle
until you notice, convert it, and redeposit. Miss that, and you're holding an
unhedged BTC position you never asked for while your MUSD stake shrinks.

Backstop closes the loop:

```
        a Trove is liquidated
                 │
   pool burns your MUSD, pays you BTC at a discount
                 │
      harvest()  ├─▶ swaps BTC → MUSD   (floor set by MUSD's own oracle)
                 │
                 └─▶ redeposits into the pool
                         │
              your position now absorbs more, and earns more
```

Your share price rises. You never hold BTC. You never send a transaction.

## Why this is the right thing to build on Mezo

It strengthens the exact mechanism MUSD's solvency depends on. A deeper
Stability Pool means liquidations are absorbed rather than redistributed, which
is what protects every borrower on the network. Backstop doesn't compete with
anything Mezo runs — it makes their backstop bigger by making it worth
supplying.

It is also unbuildable anywhere else. The design is dictated, line by line, by
how MUSD's fork of Liquity actually behaves.

## Three protocol behaviours that shaped the code

Each of these is the kind of thing that only shows up by reading the source, and
each one breaks a naive implementation.

**Gains are pushed, not pulled.** There is no `claim` on the Stability Pool.
`provideToSP` and `withdrawFromSP` *both* send accrued BTC to the caller before
doing anything else. The vault is payable and treats BTC arriving unannounced as
routine — including during an ordinary deposit.

**`withdrawFromSP(amount)` reverts while any Trove is liquidatable.**
`_requireNoUnderCollateralizedTroves` guards it — but `withdrawFromSP(0)` skips
the check. That is why harvesting always works even when withdrawing principal
does not, and why blocked withdrawals surface as
`WithdrawalsBlockedByPendingLiquidations` rather than an unexplained revert a UI
can't act on.

**Unharvested BTC has to count toward `totalAssets`.** A liquidation cuts your
MUSD deposit at the same instant it credits the BTC. A vault that valued only
the MUSD would show its share price crater on every liquidation and leap on
every harvest — and anyone could deposit into the gap and leave after. So
pending BTC is valued continuously at MUSD's own `PriceFeed`, discounted by the
same margin the harvest swap must clear. A harvest can then only ever move the
share price *up*. [`test_HarvestCannotBeSandwiched`](test/BackstopVault.t.sol)
pins it.

## Security

- **Harvest is permissionless and paid.** A keeper fee (0.5%, hard-capped at 5%)
  means compounding doesn't depend on the deployer staying alive.
- **The swap floor comes from the oracle, not the caller.** A keeper passing
  `minMusdOut = 0` still cannot hand the harvest to a sandwich; the vault
  computes its own floor and rejects anything below it.
- **The owner cannot reach deposits.** The only powers are repointing the swap
  venue and tuning the fee and slippage tolerance, both bounded by constants
  that cannot be raised. A malicious swapper costs at most the slippage
  tolerance on a single harvest, because it is called and settled in one
  transaction and never custodies anything.
- **ERC-4626 via OpenZeppelin**, so the first-depositor inflation attack is
  handled by virtual shares rather than by hand.

17 tests, including a faithful re-implementation of the pool's product-sum
(`P`/`S`) snapshot accounting in [the mock](test/mocks/MockStabilityPool.sol), so
liquidation tests exercise the real math rather than a stubbed balance.

```
forge test
```

## Before deploying

Two addresses are missing from the public docs and must be confirmed before
this can run on-chain:

- **`StabilityPool` and `PriceFeed`.** Mezo's
  [contracts reference](https://mezo.org/docs/users/resources/contracts-reference/)
  publishes MUSD, MEZO and pool addresses, but not MUSD's core contracts. They
  are in the `mezo-org/musd` deployment artifacts, or ask in Discord.
- **A BTC/MUSD swap venue.** The mainnet
  [MUSD/BTC pool](https://mezo.org/docs/users/resources/contracts-reference/) is
  `0x52e604c44417233b6CcEDDDc0d640A405Caacefb`, but Mezo Swap's router interface
  isn't published. [`ISwapper`](src/interfaces/ISwapper.sol) exists so that
  binding is a single small contract, written once the interface is known,
  touching no depositor accounting.

One assumption to verify: `IPriceFeed.fetchPrice()` is assumed to return 18
decimals, as Liquity-derived feeds do. The constructor sanity-bounds it so a
mis-scaled feed fails at deploy rather than silently mispricing every gain.

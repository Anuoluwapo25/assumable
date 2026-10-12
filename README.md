# Assumable

**Assumable loans for Bitcoin: buy and sell live MUSD Troves on Mezo.**

In real estate, an *assumable mortgage* lets a buyer take over the seller's
loan, rate and all, together with the house. Assumable does the same for
MUSD: you sell your whole Trove, meaning its BTC, its debt and its locked
interest rate, in one transaction. You never repay it or close it.

## The problem

MUSD lets you borrow against BTC without selling it. Most people borrow
MUSD in order to **spend** it. That leaves them stuck:

- **Exiting means buying the debt back.** MUSD ties a Trove to the address
  that opened it. The only way out is to repay the whole debt. If you spent
  the MUSD, you first have to buy it all back on the market, with slippage,
  just to reach your own BTC.
- **A low rate can't be passed on.** Each Trove keeps the interest rate it
  was opened at. When governance raises the rate for new Troves, an old 1%
  Trove becomes valuable to someone, but there's no way to sell it.
- **Liquidation is the only other exit.** A borrower who can't repay can
  only wait until they're liquidated, which costs them the liquidation
  penalty on top.

## How it works

```
TrovePositions (ERC-721) ── mints NFT #n and deploys ──▶ TroveAccount #n (minimal clone)
                                                          └─ the borrower of record of a real MUSD Trove

   whoever holds NFT #n controls TroveAccount #n
   transferring the NFT = transferring the Trove, its BTC, its debt and its locked rate

TroveMarket
   list(id, pricing)   fixed MUSD price, or a share of live equity priced by MUSD's oracle
   buy(id, maxPrice, maxDebt, minColl)
                       atomic: MUSD to the seller, NFT to the buyer;
                       reverts if the Trove changed since the buyer looked
   makeOffer / acceptOffer
                       buyers escrow MUSD against any position, listed or not
```

- **`TroveAccount`** opens and runs the Trove through MUSD's own
  `BorrowerOperations`, and only follows orders from the current NFT
  holder. Borrowed MUSD and withdrawn BTC go straight to the holder, so the
  account never holds value that a buyer could inherit or a seller could
  leave behind. Anyone can add collateral or repay, since that only makes
  the Trove safer.
- **Listings are non-custodial.** The seller keeps the NFT, so they can
  still rescue the Trove in a crash. Because the seller could also *weaken*
  the Trove after listing, every purchase carries the buyer's own limits on
  price, debt and collateral, checked in the same transaction as the
  transfer.
- **Equity pricing** asks, for example, 97% of (BTC value − debt) at MUSD's
  oracle price, so the price follows BTC with no manual updates. A seller
  can set an optional floor. A premium above 100% fits Troves locked at a
  rate below today's.
- **Offers** let a buyer escrow MUSD for a specific Trove, with the same
  limits, and the holder accepts whenever they like.

## Proven against the real MUSD system

`test/TroveMarket.fork.t.sol` runs on a fork of Mezo testnet against the
live MUSD contracts. It opens a contract-owned Trove, sells it, has the new
owner borrow against it, then closes it.

Mezo's price oracle is a chain precompile that Foundry's EVM can't run, so
the test reads the live price over RPC and pins the feed to it.

## Repository

```
src/TroveAccount.sol         the borrower of record, controlled by an NFT
src/TrovePositions.sol       ERC-721 + clone factory; openPosition() mints and opens in one transaction
src/TroveMarket.sol          listings, equity pricing, offers, buyer and seller protections
test/TroveMarket.t.sol       25 unit tests over a mock of MUSD's borrowing rules
test/TroveMarket.fork.t.sol  end to end against live MUSD on a testnet fork
script/Deploy.s.sol          deploys over MUSD on Mezo testnet (31611) or mainnet (31612)
web/                         the market (Next.js, wagmi): browse, open, manage, list, buy, offer
scripts/abi.mjs              regenerates web/src/lib/abi.ts from the build
```

## Run it

```sh
forge test
MEZO_FORK=1 MEZO_FORK_BLOCK=$(cast block-number --rpc-url https://rpc.test.mezo.org) \
  forge test --match-contract Fork

forge script script/Deploy.s.sol --rpc-url https://rpc.test.mezo.org --broadcast --slow --interactives 1

cd web
npm install
cp .env.example .env.local   # the two printed addresses and the deploy block
npm run dev
```

## Limits and what's next

- **Only Troves opened through Assumable are transferable.** MUSD has no
  way to move an existing Trove to a new owner. Migrating one means repaying
  it and reopening it inside a TroveAccount in the same transaction, which
  needs flash liquidity in MUSD. That is the natural v2.
- Each Trove keeps MUSD's rules: the 1,800 MUSD minimum debt, the 200 MUSD
  gas reserve, and liquidation below 110%. A listed Trove can still be
  liquidated or redeemed against. The market then refuses to sell it, and
  any leftover collateral is claimable by whoever holds the NFT.

## MUSD contracts used

All addresses come from mezo-org/musd `solidity/artifacts/deployments`.

| | Testnet (31611) | Mainnet (31612) |
|---|---|---|
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` |
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` |
| InterestRateManager | `0xD4D6c36A592A2c5e86035A6bca1d57747a567f37` | `0x4a453700d157717Fe02fB62E7700ED7845048285` |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |

# Cash Out: plan

Status: **built.** You said "get to work", so I took the recommended answer to each question in
section 4:

1. **Listing.** The module refuses to cash out while a position is actively listed. Assumable is
   unchanged.
2. **NFT custody.** The module holds the NFT for one transaction under `setApprovalForAll`.
3. **First cash-out.** `openAndCashOut` opens the Trove at MUSD's minimum loan. The surplus stays in
   the wallet, and the screen says so.
4. **Backend.** It lives in Next.js route handlers in `web/`.
5. **Addresses.** They moved into `config/*.json`, with no change to what `Deploy.s.sol` deploys.
6. **Route B cap.** Route B is capped at 1,000 MUSD per order (configurable). I didn't build the
   mUSDT split.
7. **Demo currency.** The demo defaults to NGN at a labelled sample rate.

See README.md and DEMO.md. Section 4 below is kept as asked.

## 1. What exists today (Assumable)

**Contracts** (Foundry, solc 0.8.28, `evm_version = shanghai`, OpenZeppelin 5):

- `TrovePositions` (ERC-721 and clone factory). Token #n deploys a deterministic minimal
  clone, `TroveAccount` #n. Its `implementation` is **immutable**, so live clones can't be
  upgraded.
- `TroveAccount` is the borrower of record of one MUSD Trove. Holder-only functions are
  `open`, `withdrawColl`, `borrow` (calls `withdrawMUSD` and sends the MUSD to `msg.sender`),
  `close` and `refinance`. Anyone can call `addColl`, `repay` (pulls MUSD from the caller),
  `claimCollateral` and `sweep`. Invariant: **the account never holds value between calls.**
  Any MUSD or BTC it receives goes straight to the holder.
- `TroveMarket` handles listings and offers. It's **non-custodial**: the seller keeps the NFT
  and can still act on the Trove while it's listed. Buyers protect themselves with
  `maxPrice/maxDebt/minColl`, checked in the same transaction as the purchase.
- Interfaces are trimmed copies of MUSD's `IBorrowerOperations`, `ITroveManager` and
  `IPriceFeed`.
- Tests: 25 unit tests over `MockTroveManager`, which models the 110% MCR, the 200 MUSD gas
  reserve and per-Trove rates. There's one fork test against live MUSD on Mezo testnet,
  which pins the precompile-backed price feed with `vm.mockCall`.
- Deployed on testnet (31611): `TrovePositions 0x46e1…feaf`, `TroveMarket 0xeff9…f25a`,
  `TroveAccount impl 0x8c3a…611a`.

**Frontend:** Next.js 16, React 19, wagmi 3, viem 2, Tailwind 3. MUSD addresses are hardcoded
in `web/src/lib/config.ts` (including SortedTroves and HintHelpers). Hints come from
`getApproxHint` and `findInsertPosition`. Risk math is in `web/src/lib/risk.ts`.

## 2. What I checked against the docs and chain

Sources: mezo-org/documentation, mezo-org/musd, mezo-org/mezod (`precompile/assetsbridge`,
RFC-5), and live `cast` reads on both chains on 2026-10-22.

| Claim in the brief | Verdict |
|---|---|
| MUSD `0xdD46…F186` on Mezo, Ethereum and Base | ✅ mainnet. **Testnet MUSD is different**: `0x1189…C503` |
| mUSDC mainnet `0x0467…c197` | ✅ **6 decimals** (MUSD has 18). Testnet mUSDC is `0xe1a26db653708A2AD8F824E92Db9852410e33A59`, read from the pool's `token1()` |
| MUSD/mUSDC stable pool `0xEd81…c356` | ✅ **mainnet**, `stable() == true` |
| `0x525F…Dc3e` | ✅ **testnet** MUSD/mUSDC pool |
| Router | Basic-pool (Aerodrome-style) router. Mainnet `0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706`, testnet `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9`. `swapExactTokensForTokens(amountIn, minOut, Route[]{from,to,stable,factory}, to, deadline)`. Factories: mainnet `0x83FE…4248`, testnet `0x4947…Ce1A` |
| MUSD bridges via Wormhole NTT, minimum 0.01 MUSD | ✅ (NTT Manager on Mezo `0x7efb…e0bD`) |
| mUSDC to Ethereum via native bridge, ~$3 flat fee, minimum 20 | ✅ on mainnet (`getMinBridgeOutAmount(mUSDC) = 20e6` on-chain). **Testnet minimum is 10e6.** The fee is taken on the Ethereum side and is governable. Docs give 30–60 minutes to arrive |
| Liquidation at 90% LTV (~111% CR) | ⚠️ **Slightly off.** MUSD's `MCR` is 110%, so liquidation happens at **~90.9% LTV**. Also `CCR = 150%`: in Recovery Mode, new borrowing must leave the Trove at ≥150% and must not push the system's TCR below 150% |
| Redemptions hit the lowest-CR Troves first; 200 MUSD gas deposit | ✅. Also: **`minNetDebt = 1,800 MUSD`** and a **0.1% borrowing fee** (both governable) |
| Gas paid in BTC | ✅ |
| **Can a contract start a native-bridge withdrawal?** | ✅ **Yes.** `bridgeOut(token, amount, chain, recipient)` on the AssetsBridge precompile `0x7b7c…0012` uses `msg.sender` and has no EOA check. For ERC-20s it burns with `burnFrom`, so the caller approves the precompile first. Chain `0` = Ethereum and `recipient` is 20 bytes. Ethereum and Bitcoin are both enabled on both networks. Per-token **outflow limits** (per 25,000 blocks) can make it revert |
| **"Assumable's existing listing lock"** | ❌ **There isn't one.** Listings are deliberately non-custodial, and the holder can borrow while listed. Buyers are protected by `maxDebt/minColl` instead. See Q1 |
| Banxa endpoints `/api/coins/sell`, `/api/fiats/sell`, create and confirm sell order | ⚠️ That's Banxa's **legacy** API. Current docs use `GET /{partnerRef}/v2/quotes` and `POST /{partnerRef}/v2/sell` (returns a hosted-checkout URL that expires after 1 minute, then delivers status by **webhook**), with an `x-api-key` header. Banxa announced MUSD **buying** on Mezo in Dec 2025. I found **no confirmation that Banxa can sell MUSD** |

**Two findings that affect the product:**

1. **Route B liquidity is thin.** Mainnet MUSD/mUSDC reserves are about 6.8k MUSD against
   4.8k mUSDC. Router quotes today:
   - 100 MUSD → 98.89 mUSDC (−1.1%)
   - 1,000 → 965 (−3.5%)
   - 3,000 → 2,534 (**−15.5%**)

   MUSD/mUSDT is similar (1,000 → 968). Testnet: 1,000 → 841. The quote has to show this
   cost honestly. I'd cap the size of a Route B order, or split it across the mUSDC and mUSDT
   pools.
2. **A brand-new Trove must borrow at least 1,800 MUSD.** With a 40% LTV cap, that needs about
   $5,000 of BTC. A first cash-out of ₦50,000 can't open a Trove on its own (Q3).

Also relevant to the demo story: the docs say native BTC bridge-in **closed on Oct 13, 2026**.
New users bring BTC as tBTC from Ethereum, and they need a little BTC for gas.

## 3. Proposed architecture

### Contracts: **no changes to Assumable** (recommended)

**`CashOutModule`** is a new, immutable contract with no admin power over funds. The holder
grants it NFT approval once. `cashOut(tokenId, collBTC (msg.value), musdToDraw, order, sig)`
does everything in one transaction:

1. Checks: `msg.sender == ownerOf(tokenId)` and `order.owner == msg.sender`. The order isn't
   expired or used. `adapters[order.adapter]` is allowlisted. The signature comes from that
   adapter's allowlisted **order signer**, the backend. The position isn't actively listed:
   `market.listings(id)` has `seller == owner` and isn't expired.
2. Effects: mark `orderId` used.
3. Trove: the module takes the NFT (`transferFrom`, no receiver callback), calls
   `account.addColl{value}` and `account.borrow(musdToDraw)` (the MUSD comes to the module),
   then **returns the NFT to the same owner before any external call to an adapter**.
4. Safety cap: `debt / (coll × fetchPrice()) ≤ maxLtvBps` (default 4000). Admin-configurable
   with a hard ceiling, for example 60%.
5. Route: transfer exactly the order's MUSD to the adapter, then `adapter.payout(order)`.
   Check that the module's MUSD balance and every allowance are back to zero.
6. Emit `CashOut(orderId, tokenId, owner, adapter, musdAmount, ltvBps)`.

Taking custody of the NFT for one transaction lets the module act as the holder through
Assumable's existing interface. Existing testnet positions work, and the market is untouched.
`Transfer` events aren't read by the web app.

The **listing check** happens in the module, as a read of `TroveMarket`. Assumable itself
stays the same.

**Adapters** (`IOfframpAdapter.payout(Order) returns (bytes32 ref)`), allowlisted by an admin
(`Ownable2Step`):

- **`DirectMUSDAdapter` (Route A):** sends MUSD to `order.depositAddress`.
- **`SwapBridgeAdapter` (Route B):**
  1. Swap MUSD to mUSDC through the router with `order.minOut` and a deadline.
  2. Require `out ≥ max(onchain getMinBridgeOutAmount, configured minimum)`. That's 20
     mUSDC on mainnet.
  3. Approve exactly `out` to the precompile.
  4. Call `bridgeOut(mUSDC, out, 0, abi.encodePacked(order.depositAddress))`.
  5. Assert the allowance is zero.

Why signed orders rather than a fixed address list: off-ramps issue a fresh deposit address
per order. Users never pass a destination. The address comes inside an EIP-712 order that the
backend signs, bound to `{orderId, tokenId, owner, adapter, depositAddress, musdAmount,
minOut, expiry, chainId}`. A static address allowlist is still supported for the mock (Q2).

**`repay(tokenId, amount)`:** the module pulls MUSD from the caller and calls the account's
existing public `repay`. MUSD should be delivered to the user's wallet, not the account,
because `sweep` would forward it to the holder anyway.

All addresses go in `deployments/{mezo-testnet,mezo-mainnet}.json`. The deploy script and the
web/backend config read only that file. The existing hardcoded addresses in `Deploy.s.sol`
and `config.ts` move there too. That's a refactor with no behavior change, but it does touch
Assumable files (Q5).

### Safety math (`web/src/lib/cashout/safety.ts`, pure bigint, with unit tests)

- Inputs: BTC price, collateral, debt, requested fiat amount, FX rate, and fees (provider,
  swap quote, bridge flat fee, 0.1% borrowing fee).
- Outputs: required MUSD, new LTV, liquidation price (`debt × 1.10 / coll`), the drop the
  position can absorb, and the sentence "Your Bitcoin is safe unless BTC falls below $X
  (a Y% drop)."
- Covers the edge cases in the brief, plus `minNetDebt` and the Route B minimum.

### Backend (Next.js route handlers in `web/`, server-only env)

I'd keep the backend in the Next.js app so there's one deploy on the existing Vercel setup
(Q4).

- `GET /api/quote`, `POST /api/cashout` (returns the signed order) and `GET /api/order/:id`.
  The timeline steps are *loan drawn → converted → sent → paid out*, driven by the chain
  `CashOut`/`AssetsUnlocked` events plus provider status.
- Providers:
  - `MockProvider`: deterministic, time-driven, labelled **MOCK** in the API and UI.
  - `BanxaProvider`: v2 quotes and sell against the sandbox. It's active only when
    `BANXA_*` env vars are set, and returns `unavailable` otherwise. It never reports fake
    success.
  - A `ProviderAdapter` interface left open for a regional provider.
- The order-signing key lives only in env.

### Frontend

A new `/cash` route with one screen. Inputs are an amount in local currency and a payout
destination. It shows what arrives, the total cost, the safety sentence, a **Cash out**
button and a live timeline. **Pay back** runs on-ramp → MUSD → `repay`. When the position is
at risk, it links to the existing rescue sale (list on `TroveMarket`). No jargon appears on
this screen. Assumable's other pages stay as they are.

### Tests

- Unit (mocks): happy path for both routes, LTV-cap rejection, slippage rejection, non-owner,
  blocked while listed, adapter not allowlisted, bad or expired or replayed signature,
  below-minimum, no lingering allowance or MUSD, and the NFT always returned.
- Fork (testnet): the real Trove, real router and real pool, with the precompile mocked
  (Foundry can't run `bridgeOut` or the oracle). The final bridge-out is exercised on testnet
  itself to Sepolia.

## 4. Questions for you

1. **Listing lock:** none exists today. Should a listed position block cash-out? Options:
   (a) the module refuses while actively listed (I recommend this; Assumable is unchanged),
   (b) add a real lock to `TroveAccount`/`TroveMarket`. That changes Assumable, needs a
   redeploy, and leaves existing positions behind. Or (c) no block, relying on the buyer's
   `maxDebt`.
2. **NFT custody vs. changing `TroveAccount`:** OK for the module to hold the NFT for one
   transaction under `setApprovalForAll`? The alternative is adding an operator role to
   `TroveAccount`, which is cleaner but means redeploying all three contracts. I recommend
   custody.
3. **First cash-out and the 1,800 MUSD minimum:** should the first cash-out (a) open the
   Trove at the minimum and leave the surplus in the user's wallet as "available balance",
   (b) require an existing position, or (c) set a minimum first cash-out of about $1,800?
4. **Backend location:** Next.js route handlers in `web/` (recommended), or a separate
   `services/offramp`?
5. **Moving addresses into `deployments/*.json`:** OK to update `Deploy.s.sol` and
   `config.ts`? There's no behavior change.
6. **Route A in practice:** with no confirmed MUSD-accepting off-ramp, Route A runs only
   against the mock until a provider confirms. Route B is the real path but loses 3–15% at
   size today. Should I add an MUSD/mUSDT split, or a per-order cap (for example 1,000 MUSD)?
7. **Default currency for the demo:** NGN, with a mock FX rate clearly labelled?

## 5. Commit plan

1. Config file and addresses (pending Q5).
2. `CashOutModule`, interfaces and adapters, with unit tests.
3. Fork test.
4. Safety math and tests.
5. Backend with the mock and Banxa providers.
6. `/cash` UI.
7. Testnet deploy.
8. README and DEMO.md.

/**
 * Cash Out's safety math: what a payout costs, what it does to the loan, and
 * the one sentence the user sees about it. Pure bigint, no I/O, so the server
 * quote and the screen agree to the wei.
 *
 * Units: amounts are 18-decimal fixed point (USD, MUSD, BTC and fiat alike);
 * rates are basis points. MUSD is counted at $1.
 */

export const WAD = 10n ** 18n;
export const BPS = 10_000n;
/** MUSD liquidates a Trove below 110% collateral (about 90.9% LTV). */
export const MCR = 110n * 10n ** 16n;
/** MUSD's 200 MUSD liquidation reserve, added to every new Trove's debt. */
export const GAS_COMPENSATION = 200n * WAD;

export type SafetyInput = {
  /** USD per BTC, from MUSD's own price feed. */
  btcPrice: bigint;
  /** Current collateral and total debt; both 0 for a first cash-out. */
  coll: bigint;
  debt: bigint;
  /** BTC the user can add as security (already net of a gas reserve). */
  walletBtc: bigint;

  /** What the user wants to receive, in local currency. */
  fiatAmount: bigint;
  /** Local currency per USD. */
  fiatPerUsd: bigint;

  /** The provider's fee: a share of what it pays out, plus a flat part (USD). */
  providerFeeBps: bigint;
  providerFlatFeeUsd: bigint;
  /** Route B's bridge fee (USD); 0 on Route A. */
  bridgeFeeUsd: bigint;
  /** What one MUSD becomes before fees: 10,000 on Route A, the pool's rate at this size on Route B. */
  conversionBps: bigint;
  /** The least the route can deliver to the provider (USD); 20 for Route B on mainnet. */
  minDeliveredUsd: bigint;
  /** The most MUSD one order may route; 0 for no limit. */
  maxMusdPerOrder: bigint;

  /** MUSD's one-off borrowing fee (1e18 = 100%) and minimum loan. */
  borrowingRate: bigint;
  minNetDebt: bigint;

  /** The contract's cap, and where BTC top-ups aim (at or under the cap). */
  maxLtvBps: bigint;
  targetLtvBps: bigint;
};

export type BlockerCode =
  | "invalid"
  | "fees-exceed-amount"
  | "below-minimum"
  | "above-order-limit"
  | "exceeds-safe-limit";

export type Blocker = {
  code: BlockerCode;
  /** For below-minimum and the limits: the fiat amount that would work. */
  fiatLimit?: bigint;
};

export type SafetyQuote = {
  usdToReceive: bigint;
  fees: { provider: bigint; bridge: bigint; conversion: bigint; borrowing: bigint };
  totalFeesUsd: bigint;
  /** MUSD the off-ramp gets. */
  musdToSend: bigint;
  /** MUSD borrowed: more than `musdToSend` when MUSD's minimum loan applies. */
  musdBorrowed: bigint;
  /** What's left in the user's wallet from that minimum. */
  surplusMusd: bigint;
  btcToAdd: bigint;
  newColl: bigint;
  newDebt: bigint;
  isNewLoan: boolean;
  /** Basis points, rounded down as the contract's own check does. */
  ltvBps: bigint;
  liquidationPrice: bigint;
  /** How far BTC can fall before liquidation, in basis points of today's price. */
  dropBps: bigint;
  sentence: string;
  blocker: Blocker | null;
};

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** What the provider must be handed (USD) so the user receives `usdToReceive`. */
function grossUp(usdToReceive: bigint, i: SafetyInput) {
  const beforeProvider = ceilDiv((usdToReceive + i.providerFlatFeeUsd) * BPS, BPS - i.providerFeeBps);
  const delivered = beforeProvider + i.bridgeFeeUsd;
  const musd = ceilDiv(delivered * BPS, i.conversionBps);
  return { beforeProvider, delivered, musd };
}

/** The reverse of `grossUp`: what the user receives (USD) for `musd` sent. */
function netDown(musd: bigint, i: SafetyInput) {
  const delivered = (musd * i.conversionBps) / BPS;
  if (delivered <= i.bridgeFeeUsd) return 0n;
  const beforeProvider = delivered - i.bridgeFeeUsd;
  const afterPct = (beforeProvider * (BPS - i.providerFeeBps)) / BPS;
  return afterPct > i.providerFlatFeeUsd ? afterPct - i.providerFlatFeeUsd : 0n;
}

const toFiat = (usd: bigint, i: SafetyInput) => (usd * i.fiatPerUsd) / WAD;

export const ltvOf = (coll: bigint, debt: bigint, price: bigint) => {
  const value = (coll * price) / WAD;
  return value === 0n ? (debt === 0n ? 0n : BPS * 1000n) : (debt * BPS) / value;
};

export const liquidationPriceOf = (coll: bigint, debt: bigint) => (coll === 0n ? 0n : (debt * MCR) / coll);

/** Total debt after borrowing `musd` (with the fee, and the reserve on a new loan). */
function debtAfter(borrowed: bigint, i: SafetyInput, isNew: boolean) {
  return i.debt + borrowed + (borrowed * i.borrowingRate) / WAD + (isNew ? GAS_COMPENSATION : 0n);
}

/** The largest payout (fiat) the user's BTC can back at the cap, BTC top-up included. */
export function maxFiatFor(i: SafetyInput): bigint {
  const isNew = i.debt === 0n;
  const coll = i.coll + i.walletBtc;
  const ceiling = (((coll * i.btcPrice) / WAD) * i.maxLtvBps) / BPS;
  const room = ceiling - i.debt - (isNew ? GAS_COMPENSATION : 0n);
  if (room <= 0n) return 0n;
  const borrowable = (room * WAD) / (WAD + i.borrowingRate);
  if (isNew && borrowable < i.minNetDebt) return 0n;
  return toFiat(netDown(borrowable, i), i);
}

export function quoteCashOut(i: SafetyInput): SafetyQuote {
  const isNewLoan = i.debt === 0n;
  if (
    i.fiatAmount <= 0n || i.fiatPerUsd <= 0n || i.btcPrice <= 0n || i.conversionBps <= 0n ||
    i.targetLtvBps <= 0n || i.providerFeeBps >= BPS
  ) {
    return invalidQuote(i, isNewLoan);
  }
  const usdToReceive = i.fiatPerUsd > 0n ? (i.fiatAmount * WAD) / i.fiatPerUsd : 0n;
  const g = grossUp(usdToReceive, i);

  const musdToSend = g.musd;
  const musdBorrowed = isNewLoan ? max(musdToSend, i.minNetDebt) : musdToSend;
  const surplusMusd = musdBorrowed - musdToSend;
  const borrowFee = (musdBorrowed * i.borrowingRate) / WAD;
  const newDebt = debtAfter(musdBorrowed, i, isNewLoan);

  // Add BTC only if the loan would pass the cap without it, and then aim for
  // the target, a little under the cap, so a small move doesn't block the next one.
  let btcToAdd = 0n;
  if (ltvOf(i.coll, newDebt, i.btcPrice) > i.maxLtvBps) {
    const needed = ceilDiv(newDebt * BPS * WAD, i.targetLtvBps * i.btcPrice);
    btcToAdd = needed > i.coll ? needed - i.coll : 0n;
  }
  const newColl = i.coll + btcToAdd;
  const ltvBps = ltvOf(newColl, newDebt, i.btcPrice);
  const liquidationPrice = liquidationPriceOf(newColl, newDebt);
  const dropBps =
    i.btcPrice > liquidationPrice ? ((i.btcPrice - liquidationPrice) * BPS) / i.btcPrice : 0n;

  const fees = {
    provider: g.beforeProvider - usdToReceive,
    bridge: i.bridgeFeeUsd,
    conversion: musdToSend - g.delivered,
    borrowing: borrowFee,
  };
  const totalFeesUsd = fees.provider + fees.bridge + fees.conversion + fees.borrowing;

  return {
    usdToReceive,
    fees,
    totalFeesUsd,
    musdToSend,
    musdBorrowed,
    surplusMusd,
    btcToAdd,
    newColl,
    newDebt,
    isNewLoan,
    ltvBps,
    liquidationPrice,
    dropBps,
    sentence: safetySentence(liquidationPrice, dropBps),
    // Whether fees swamp the payout is judged on the fees this payout causes:
    // on a first loan, the loan fee on MUSD's minimum is mostly for the
    // surplus that stays in the wallet, not for this cash-out.
    blocker: blockerFor(i, {
      usdToReceive,
      payoutFeesUsd: fees.provider + fees.bridge + fees.conversion + (musdToSend * i.borrowingRate) / WAD,
      delivered: g.delivered,
      musdToSend,
      btcToAdd,
    }),
  };
}

function invalidQuote(i: SafetyInput, isNewLoan: boolean): SafetyQuote {
  const liquidationPrice = liquidationPriceOf(i.coll, i.debt);
  return {
    usdToReceive: 0n,
    fees: { provider: 0n, bridge: 0n, conversion: 0n, borrowing: 0n },
    totalFeesUsd: 0n,
    musdToSend: 0n,
    musdBorrowed: 0n,
    surplusMusd: 0n,
    btcToAdd: 0n,
    newColl: i.coll,
    newDebt: i.debt,
    isNewLoan,
    ltvBps: i.btcPrice > 0n ? ltvOf(i.coll, i.debt, i.btcPrice) : 0n,
    liquidationPrice,
    dropBps: 0n,
    sentence: "",
    blocker: { code: "invalid" },
  };
}

function blockerFor(
  i: SafetyInput,
  q: { usdToReceive: bigint; payoutFeesUsd: bigint; delivered: bigint; musdToSend: bigint; btcToAdd: bigint },
): Blocker | null {
  if (q.payoutFeesUsd >= q.usdToReceive) return { code: "fees-exceed-amount", fiatLimit: minFiat(i) };
  if (q.delivered < i.minDeliveredUsd) return { code: "below-minimum", fiatLimit: minFiat(i) };
  if (i.maxMusdPerOrder > 0n && q.musdToSend > i.maxMusdPerOrder) {
    return { code: "above-order-limit", fiatLimit: toFiat(netDown(i.maxMusdPerOrder, i), i) };
  }
  if (q.btcToAdd > i.walletBtc) return { code: "exceeds-safe-limit", fiatLimit: maxFiatFor(i) };
  return null;
}

/** The smallest payout (fiat) the route accepts and whose fees don't swallow it. */
function minFiat(i: SafetyInput): bigint {
  const atMinimum = i.minDeliveredUsd > i.bridgeFeeUsd ? i.minDeliveredUsd - i.bridgeFeeUsd : 0n;
  const fromMinimum = (atMinimum * (BPS - i.providerFeeBps)) / BPS;
  const usd = fromMinimum > i.providerFlatFeeUsd ? fromMinimum - i.providerFlatFeeUsd : 0n;
  // Fees are roughly fixed plus proportional; ask for at least twice the fixed
  // part, and never suggest less than one whole unit of currency.
  const fixedFees = i.providerFlatFeeUsd + i.bridgeFeeUsd;
  return max(toFiat(max(usd, fixedFees * 2n), i), WAD);
}

/** Whole dollars with thousands separators: 61234567890000000000000n -> "$61,235". */
export function formatUsd(amount: bigint): string {
  const dollars = (amount + WAD / 2n) / WAD;
  return `$${dollars.toLocaleString("en-US")}`;
}

/** "Your Bitcoin is safe unless BTC falls below $X (a Y% drop)." */
export function safetySentence(liquidationPrice: bigint, dropBps: bigint): string {
  if (liquidationPrice === 0n) return "You have no loan, so your Bitcoin can't be sold.";
  if (dropBps === 0n) return "Your Bitcoin is at risk now: BTC is below the price where it gets sold.";
  const pct = Number((dropBps + 50n) / 100n);
  return `Your Bitcoin is safe unless BTC falls below ${formatUsd(liquidationPrice)} (a ${pct}% drop).`;
}

export type Health = "safe" | "watch" | "act";

/** When to offer the way out: "act" means offer the rescue sale. */
export function healthOf(ltvBps: bigint): Health {
  if (ltvBps >= 7_000n) return "act";
  if (ltvBps >= 5_000n) return "watch";
  return "safe";
}

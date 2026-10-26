import "server-only";
import { parseUnits, type Address } from "viem";
import { BPS, WAD, quoteCashOut, type SafetyInput, type SafetyQuote } from "@/lib/cashout/safety";
import { cashOut } from "@/lib/config";
import { bridgeMinimum, findOwnedPosition, quoteSwap, readMarket, readPosition, walletBtc } from "./chain";
import type { OfframpProvider } from "./providers/types";

/** Mezo's native bridge charges about $3 per withdrawal, taken on Ethereum. */
export const BRIDGE_FEE_USD = 3n * WAD;
/** BTC top-ups aim 5 points under the cap. */
const TARGET_MARGIN_BPS = 500n;

export type CashOutQuote = SafetyQuote & {
  provider: { id: string; label: string; mock: boolean; route: "A" | "B" };
  fiat: string;
  fiatAmount: bigint;
  fiatPerUsd: bigint;
  btcPrice: bigint;
  arrival: string;
  /** Route B: the mUSDC the pool returns for `musdToSend` right now. */
  usdcOut: bigint | null;
  tokenId: bigint;
  input: SafetyInput;
};

export class QuoteError extends Error {}

export async function buildQuote(args: {
  provider: OfframpProvider;
  fiat: string;
  amount: string;
  owner: Address;
  tokenId: bigint;
}): Promise<CashOutQuote> {
  const { provider, fiat, owner } = args;
  let fiatAmount: bigint;
  try {
    fiatAmount = parseUnits(args.amount, 18);
  } catch {
    throw new QuoteError("amount must be a plain number");
  }

  // No loan named: use the one they already have, if any, rather than opening another.
  if (args.tokenId === 0n) {
    const existing = await findOwnedPosition(owner);
    if (existing) args = { ...args, tokenId: existing };
  }
  const position = args.tokenId > 0n ? await readPosition(args.tokenId) : null;
  if (args.tokenId > 0n && !position) throw new QuoteError("no such position");
  if (position && position.owner.toLowerCase() !== owner.toLowerCase()) throw new QuoteError("not your position");

  const [market, btc, pq] = await Promise.all([readMarket(), walletBtc(owner), provider.quote(fiat, args.amount)]);
  const routeB = provider.route === "B";

  const input: SafetyInput = {
    btcPrice: market.btcPrice,
    coll: position?.coll ?? 0n,
    debt: position?.debt ?? 0n,
    walletBtc: btc,
    fiatAmount,
    fiatPerUsd: parseUnits(pq.fiatPerUsd, 18),
    providerFeeBps: BigInt(pq.feeBps),
    providerFlatFeeUsd: parseUnits(pq.flatFeeUsd, 18),
    bridgeFeeUsd: routeB ? BRIDGE_FEE_USD : 0n,
    conversionBps: BPS,
    minDeliveredUsd: routeB ? (await bridgeMinimum()) * 10n ** 12n : 0n,
    maxMusdPerOrder: routeB ? cashOut.routeBMaxMusdIn : 0n,
    borrowingRate: market.borrowingRate,
    minNetDebt: market.minNetDebt,
    maxLtvBps: market.maxLtvBps,
    targetLtvBps: market.maxLtvBps > TARGET_MARGIN_BPS ? market.maxLtvBps - TARGET_MARGIN_BPS : market.maxLtvBps,
  };

  let q = quoteCashOut(input);
  let usdcOut: bigint | null = null;
  if (routeB && !q.blocker) ({ q, usdcOut } = await withPoolRate(input, q));

  return {
    ...q,
    provider: { id: provider.id, label: provider.label, mock: provider.mock, route: provider.route },
    fiat,
    fiatAmount,
    fiatPerUsd: input.fiatPerUsd,
    btcPrice: market.btcPrice,
    arrival: pq.arrival,
    usdcOut,
    tokenId: args.tokenId,
    input,
  };
}

/**
 * Route B: the pool's rate depends on size, so converge on the MUSD that, at
 * the pool's live price for that amount, delivers what the provider needs.
 * Each round prices the current amount in the real pool and re-quotes at that
 * rate; it stops once the pool delivers at least what the quote assumed.
 */
async function withPoolRate(input: SafetyInput, first: SafetyQuote) {
  let q = first;
  let conversionBps = BPS;
  for (let round = 0; round < 8; round++) {
    const usdcOut = await quoteSwap(q.musdToSend);
    const delivered = usdcOut * 10n ** 12n;
    if (delivered >= (q.musdToSend * conversionBps) / BPS) {
      input.conversionBps = conversionBps;
      return { q, usdcOut };
    }
    conversionBps = (delivered * BPS) / q.musdToSend;
    if (conversionBps === 0n) throw new QuoteError("the pool can't take this amount right now");
    q = quoteCashOut({ ...input, conversionBps });
    if (q.blocker) return { q, usdcOut: null };
  }
  throw new QuoteError("the pool's price is moving too fast to quote; try again");
}

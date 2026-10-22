"use client";

import { formatUnits } from "viem";
import type { ApiError, Currency, QuoteJson } from "./api";
import { formatUsd } from "./safety";

/** Fetches JSON from our own API, turning an `{ error }` body into a thrown message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({ error: "The server sent something unexpected." }))) as T | ApiError;
  if (!res.ok) throw new ApiFailure((body as ApiError).error ?? `Request failed (${res.status})`, body);
  return body as T;
}

export class ApiFailure extends Error {
  constructor(message: string, readonly body: unknown) {
    super(message);
  }
}

/** An 18-decimal fiat amount in its own currency: 150000e18 -> "₦150,000". */
export function money(amount: bigint | string, currency: Pick<Currency, "symbol" | "code">, digits = 0) {
  const n = Number(formatUnits(BigInt(amount), 18));
  const body = n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${currency.symbol}${body}`;
}

/** USD, 18 decimals, in local currency at the quote's rate. */
export function usdToLocal(usd: bigint | string, q: Pick<QuoteJson, "fiatPerUsd">) {
  return (BigInt(usd) * BigInt(q.fiatPerUsd)) / 10n ** 18n;
}

/** Dollars: whole above $100, with cents below, so small fees don't read as $0 or $1. */
export function dollars(usd: bigint | string) {
  const v = BigInt(usd);
  if (v >= 100n * 10n ** 18n) return formatUsd(v);
  const n = Number(formatUnits(v, 18));
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function btcAmount(v: bigint | string, digits = 5) {
  return Number(formatUnits(BigInt(v), 18)).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Why a quote can't go ahead, in words that never mention the plumbing. */
export function blockerMessage(q: QuoteJson, currency: Currency): string {
  const b = q.blocker!;
  const limit = b.fiatLimit ? money(b.fiatLimit, currency) : null;
  switch (b.code) {
    case "invalid":
      return "Enter how much you'd like to receive.";
    case "fees-exceed-amount":
      return limit && BigInt(b.fiatLimit!) > 10n ** 18n
        ? `That's so small the fees would be more than you receive. Try ${limit} or more.`
        : "That's so small the fees would be more than you receive. Try a larger amount.";
    case "below-minimum":
      return `The smallest cash-out with this partner is about ${limit}.`;
    case "above-order-limit":
      return `Cash-outs with this partner are limited to about ${limit} at a time right now. You can cash out again straight after.`;
    case "exceeds-safe-limit":
      return b.fiatLimit && BigInt(b.fiatLimit) > 0n
        ? `That's more than your Bitcoin can safely back. The most you can cash out now is about ${limit}.`
        : q.isNewLoan
          ? `Your first cash-out needs about ${btcAmount(q.btcToAdd, 4)} BTC in your wallet as security. Add Bitcoin to your wallet to start.`
          : "Your Bitcoin can't safely back any more right now. Add Bitcoin to your wallet, or pay some back first.";
  }
}

/** The contract reverts a cash-out can hit, said plainly. */
export const CASH_OUT_REVERTS: Record<string, string> = {
  LtvAboveMax: "The price of Bitcoin moved, so this amount is no longer safe. Get a fresh quote.",
  Listed: "This loan is up for sale. Take it off sale first.",
  OrderExpired: "This quote expired. Get a fresh one.",
  OrderAlreadyUsed: "This cash-out already went through.",
  AdapterNotAllowed: "This payout partner isn't available right now.",
  BadSignature: "This quote couldn't be verified. Get a fresh one.",
  DeliveredBelowMin: "Prices moved while you were confirming. Get a fresh quote.",
  InsufficientOutputAmount: "Prices moved while you were confirming. Get a fresh quote.",
  BelowBridgeMin: "This amount is now under the partner's minimum. Try a little more.",
  AboveMaxIn: "This amount is now over the partner's limit. Try a little less.",
  EnforcedPause: "Cash-outs are paused for maintenance. Your money is safe; try again later.",
  NotOwner: "This wallet doesn't own that loan.",
};

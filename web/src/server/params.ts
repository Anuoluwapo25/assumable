import "server-only";
import { isAddress, type Address } from "viem";
import { providerById } from "./providers";
import type { OfframpProvider } from "./providers/types";

export type QuoteParams = { provider: OfframpProvider; fiat: string; amount: string; owner: Address; tokenId: bigint };

/** Validates the quote parameters shared by GET /api/quote and POST /api/cashout. */
export function parseQuoteParams(p: Record<string, unknown>): QuoteParams | string {
  const provider = providerById(typeof p.provider === "string" ? p.provider : null);
  if (!provider) return "unknown provider";
  const reason = provider.unavailableReason();
  if (reason) return `${provider.label} is unavailable: ${reason}`;
  const fiat = String(p.fiat ?? "").toUpperCase();
  if (!provider.currencies().some((c) => c.code === fiat)) return `${provider.label} doesn't pay out ${fiat || "that currency"}`;
  const amount = String(p.amount ?? "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(amount)) return "amount must be a positive number";
  const owner = String(p.owner ?? "");
  if (!isAddress(owner)) return "owner must be an address";
  const tokenId = String(p.tokenId ?? "0");
  if (!/^\d+$/.test(tokenId)) return "tokenId must be a whole number";
  return { provider, fiat, amount, owner, tokenId: BigInt(tokenId) };
}

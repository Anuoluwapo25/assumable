import "server-only";
import { isAddress } from "viem";
import { serverEnv } from "../env";
import type { CreateOrderInput, FiatCurrency, OfframpProvider, ProviderOrder, ProviderQuote, ProviderStatus, StoredOrderView } from "./types";

/**
 * Banxa off-ramp (sell USDC on Ethereum for local currency): Route B.
 *
 * STUB: built against Banxa's v2 API as publicly described (GET /v2/quotes,
 * POST /v2/sell returning a hosted checkout URL, `x-api-key` auth), but not yet
 * run against the sandbox: Banxa's docs refuse automated access, and there are
 * no credentials here. It is active only when BANXA_API_KEY and
 * BANXA_PARTNER_REF are set. Request and response field names marked VERIFY
 * must be checked against the sandbox. Anything it doesn't recognise is an
 * error, never a success.
 *
 * Banxa issues the deposit address after the user finishes its checkout
 * (identity checks), so an order starts `ready: false` with a checkout URL;
 * the address is picked up from the order's status once Banxa provides it.
 */
const base = () =>
  `${serverEnv.banxa.production ? "https://api.banxa.com" : "https://api.banxa-sandbox.com"}/${serverEnv.banxa.partnerRef}/v2`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { "x-api-key": serverEnv.banxa.apiKey!, "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Banxa ${path} failed (${res.status}): ${body.slice(0, 200)}`);
  return JSON.parse(body) as T;
}

const need = <T>(v: T | undefined | null, field: string): T => {
  if (v === undefined || v === null || v === "") throw new Error(`Banxa response is missing ${field} (VERIFY field name against the sandbox)`);
  return v;
};

export const banxaProvider: OfframpProvider = {
  id: "banxa",
  label: "Banxa",
  mock: false,
  route: "B",

  unavailableReason() {
    if (!serverEnv.banxa.apiKey || !serverEnv.banxa.partnerRef) return "Banxa sandbox credentials are not configured";
    if (!serverEnv.orderSignerKey) return "ORDER_SIGNER_PRIVATE_KEY is not set";
    return null;
  },

  currencies(): FiatCurrency[] {
    // Banxa's sell currencies depend on the partner account; read them live
    // once credentials exist. Until then, offer none rather than guess.
    return [];
  },

  async quote(fiat: string, fiatAmount: string): Promise<ProviderQuote> {
    // VERIFY: query parameter and response field names.
    const q = await call<Record<string, unknown>>(
      `/quotes?${new URLSearchParams({ crypto: "USDC", blockchain: "ETH", fiat, fiatAmount, orderType: "sell" })}`,
    );
    const fiatPerUsd = need(q.cryptoPrice ?? q.price, "cryptoPrice") as string | number;
    const fee = Number(q.feeAmount ?? 0);
    return {
      fiatPerUsd: String(fiatPerUsd),
      feeBps: Number(fiatAmount) > 0 ? Math.ceil((fee / Number(fiatAmount)) * 10_000) : 0,
      flatFeeUsd: "0",
      arrival: "30–60 minutes for the bridge to Ethereum, then Banxa's payout time",
    };
  },

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    // VERIFY: body field names.
    const o = await call<Record<string, unknown>>(`/sell`, {
      method: "POST",
      body: JSON.stringify({
        externalOrderId: input.orderId,
        crypto: "USDC",
        blockchain: "ETH",
        fiat: input.fiat,
        cryptoAmount: input.usdAmount,
        refundAddress: input.owner,
        redirectUrl: process.env.NEXT_PUBLIC_SITE_URL ? `${process.env.NEXT_PUBLIC_SITE_URL}/cash` : undefined,
      }),
    });
    const providerRef = String(need(o.id ?? o.orderId, "id"));
    const wallet = (o.walletAddress ?? o.depositAddress) as string | undefined;
    if (wallet && isAddress(wallet)) return { ready: true, depositAddress: wallet, providerRef };
    return { ready: false, providerRef, checkoutUrl: String(need(o.checkoutUrl, "checkoutUrl")) };
  },

  async resume(providerRef: string): Promise<ProviderOrder> {
    const o = await call<Record<string, unknown>>(`/orders/${encodeURIComponent(providerRef)}`);
    const wallet = (o.walletAddress ?? o.depositAddress) as string | undefined; // VERIFY
    if (wallet && isAddress(wallet)) return { ready: true, depositAddress: wallet, providerRef };
    return { ready: false, providerRef, checkoutUrl: String(o.checkoutUrl ?? "") };
  },

  async status(order: StoredOrderView): Promise<ProviderStatus> {
    const o = await call<Record<string, unknown>>(`/orders/${encodeURIComponent(order.providerRef)}`);
    const s = String(o.status ?? "").toLowerCase();
    // VERIFY: Banxa's sell status values.
    if (["complete", "completed"].includes(s)) return { state: "paid", at: Date.now() };
    if (["cancelled", "declined", "expired", "refunded", "failed"].includes(s)) return { state: "failed", reason: s };
    if (["pendingpayment", "waitingpayment", "pending"].includes(s)) return { state: "awaiting_funds" };
    if (s) return { state: "processing" };
    return { state: "unknown", reason: "no status in Banxa's response" };
  },
};

import "server-only";
import { privateKeyToAccount } from "viem/accounts";
import { serverEnv } from "../env";
import type { CreateOrderInput, FiatCurrency, OfframpProvider, ProviderOrder, ProviderQuote, ProviderStatus, StoredOrderView } from "./types";

/**
 * MOCK off-ramp for the demo. Nothing here moves real money. On Route A it
 * really receives the MUSD on-chain (at its deposit address), then pretends to
 * pay out after a short delay. Exchange rates are fixed sample values, not
 * market rates. Every response that comes from it carries `mock: true`, and
 * the UI says "Demo payout" wherever it appears.
 */
const CURRENCIES: (FiatCurrency & { fiatPerUsd: string })[] = [
  { code: "NGN", symbol: "₦", name: "Nigerian naira", destinations: ["bank", "mobile_money"], fiatPerUsd: "1500" },
  { code: "KES", symbol: "KSh", name: "Kenyan shilling", destinations: ["mobile_money", "bank"], fiatPerUsd: "129" },
  { code: "GHS", symbol: "GH₵", name: "Ghanaian cedi", destinations: ["mobile_money", "bank"], fiatPerUsd: "12.5" },
  { code: "USD", symbol: "$", name: "US dollar", destinations: ["bank"], fiatPerUsd: "1" },
];

function depositAddress(owner: `0x${string}`): `0x${string}` | null {
  const m = serverEnv.mock;
  if (m.route === "B") return owner; // the USDC comes back to the user on Ethereum
  if (m.treasuryKey) return privateKeyToAccount(m.treasuryKey).address;
  if (m.musdDepositAddress) return m.musdDepositAddress;
  return serverEnv.orderSignerKey ? privateKeyToAccount(serverEnv.orderSignerKey).address : null;
}

export const mockProvider: OfframpProvider = {
  id: "mock",
  label: "Demo payout (simulated)",
  mock: true,
  route: serverEnv.mock.route,

  unavailableReason() {
    return serverEnv.orderSignerKey ? null : "ORDER_SIGNER_PRIVATE_KEY is not set";
  },

  currencies() {
    return CURRENCIES.map(({ fiatPerUsd: _, ...c }) => c);
  },

  async quote(fiat: string): Promise<ProviderQuote> {
    const c = CURRENCIES.find((x) => x.code === fiat);
    if (!c) throw new Error(`unsupported currency ${fiat}`);
    return {
      fiatPerUsd: c.fiatPerUsd,
      feeBps: 100,
      flatFeeUsd: "0",
      arrival:
        this.route === "A"
          ? "About a minute (simulated payout)"
          : "Usually within an hour (simulated payout)",
    };
  },

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const to = depositAddress(input.owner);
    if (!to) throw new Error("mock provider has no deposit address configured");
    return { ready: true, depositAddress: to, providerRef: `mock-${input.orderId.slice(2, 14)}` };
  },

  async status(order: StoredOrderView): Promise<ProviderStatus> {
    if (order.sentAt === null) return { state: "awaiting_funds" };
    const paidAt = order.sentAt + serverEnv.mock.payoutDelaySeconds * 1000;
    return Date.now() >= paidAt ? { state: "paid", at: paidAt } : { state: "processing" };
  },
};

export function mockFiatPerUsd(fiat: string) {
  return CURRENCIES.find((c) => c.code === fiat)?.fiatPerUsd ?? null;
}

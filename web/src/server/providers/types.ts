import type { Address } from "viem";

/**
 * An off-ramp: takes MUSD (Route A) or USDC on Ethereum (Route B) and pays
 * local currency out. Each provider is one adapter; add a regional one by
 * implementing this and registering it in ./index.ts.
 */
export interface OfframpProvider {
  id: string;
  label: string;
  /** Mocks are labelled as such everywhere they surface. */
  mock: boolean;
  /** A: MUSD on Mezo, sent as is. B: USDC on Ethereum, via Mezo's pool and bridge. */
  route: "A" | "B";
  /** Why it can't be used right now, or null if it can. */
  unavailableReason(): string | null;
  currencies(): FiatCurrency[];
  /** Price for paying out `fiatAmount` (plain decimal string) of `fiat`. */
  quote(fiat: string, fiatAmount: string): Promise<ProviderQuote>;
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  /** For orders that started `ready: false`: check whether the deposit address is out yet. */
  resume?(providerRef: string): Promise<ProviderOrder>;
  /** Where the payout stands, once funds have been sent on-chain. */
  status(order: StoredOrderView): Promise<ProviderStatus>;
}

export type FiatCurrency = { code: string; symbol: string; name: string; destinations: DestinationKind[] };
export type DestinationKind = "bank" | "mobile_money";

export type ProviderQuote = {
  /** Local currency per USD, as a decimal string. */
  fiatPerUsd: string;
  feeBps: number;
  /** USD, decimal string. */
  flatFeeUsd: string;
  /** Plain-language arrival estimate. */
  arrival: string;
};

export type Destination = { kind: DestinationKind; institution: string; account: string; name: string };

export type CreateOrderInput = {
  orderId: `0x${string}`;
  owner: Address;
  fiat: string;
  fiatAmount: string;
  /** USD the provider is to be handed, decimal string. */
  usdAmount: string;
  destination: Destination;
};

export type ProviderOrder =
  | { ready: true; depositAddress: Address; providerRef: string }
  /** The provider needs the user first (for example, identity checks) before it issues an address. */
  | { ready: false; providerRef: string; checkoutUrl: string };

export type StoredOrderView = {
  orderId: `0x${string}`;
  providerRef: string;
  owner: Address;
  sentAt: number | null;
};

export type ProviderStatus =
  | { state: "awaiting_funds" }
  | { state: "processing" }
  | { state: "paid"; at: number }
  | { state: "failed"; reason: string }
  | { state: "unknown"; reason: string };

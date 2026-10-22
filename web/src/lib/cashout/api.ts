/**
 * The Cash Out API's JSON shapes, shared by the route handlers and the screen.
 * Amounts travel as decimal strings of 18-decimal fixed point (bigint on both ends).
 */
import type { BlockerCode } from "./safety";

export type Currency = { code: string; symbol: string; name: string; destinations: ("bank" | "mobile_money")[] };

export type ProviderInfo = {
  id: string;
  label: string;
  mock: boolean;
  route: "A" | "B";
  available: boolean;
  unavailableReason: string | null;
  currencies: Currency[];
};

export type QuoteJson = {
  provider: { id: string; label: string; mock: boolean; route: "A" | "B" };
  fiat: string;
  fiatAmount: string;
  fiatPerUsd: string;
  btcPrice: string;
  usdToReceive: string;
  totalFeesUsd: string;
  fees: { provider: string; bridge: string; conversion: string; borrowing: string };
  musdToSend: string;
  musdBorrowed: string;
  surplusMusd: string;
  btcToAdd: string;
  newColl: string;
  newDebt: string;
  isNewLoan: boolean;
  ltvBps: string;
  liquidationPrice: string;
  dropBps: string;
  sentence: string;
  arrival: string;
  blocker: { code: BlockerCode; fiatLimit?: string } | null;
};

export type ChainOrderJson = {
  orderId: `0x${string}`;
  tokenId: string;
  owner: `0x${string}`;
  adapter: `0x${string}`;
  depositAddress: `0x${string}`;
  musdAmount: string;
  minOut: string;
  expiry: string;
};

export type CashOutJson = {
  orderId: `0x${string}`;
  mock: boolean;
  quote: QuoteJson;
  /** Null while the provider still needs the user (see checkoutUrl). */
  call: {
    fn: "cashOut" | "openAndCashOut";
    order: ChainOrderJson;
    signature: `0x${string}`;
    /** BTC to send with the call. */
    value: string;
    /** openAndCashOut only: the loan to open. */
    debt: string;
  } | null;
  checkoutUrl: string | null;
};

export type StepJson = { key: string; label: string; state: "done" | "active" | "waiting" | "failed"; at: number | null; detail?: string };

export type OrderJson = {
  orderId: `0x${string}`;
  state: "awaiting_provider" | "awaiting_signature" | "ready" | "in_progress" | "paid" | "failed" | "expired";
  mock: boolean;
  fiat: string;
  fiatAmount: string;
  route: "A" | "B";
  arrival: string;
  destination: { kind: string; institution: string; last4: string };
  tokenId: string | null;
  txHash: `0x${string}` | null;
  steps: StepJson[];
};

export type PaybackJson = {
  onrampOrderId: `0x${string}`;
  mock: boolean;
  /** MUSD to repay. */
  musdAmount: string;
  /** The most a partial repayment can be right now (MUSD's minimum loan). */
  repayable: string;
  /** How the MUSD reaches the wallet: a demo treasury sends it, or it's already there. */
  source: "treasury" | "wallet";
  fundingTx: `0x${string}` | null;
  fiatCost: string;
};

export type ApiError = { error: string };

/** JSON.stringify for objects holding bigints. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

import "server-only";
import { isAddress, isHex, type Address, type Hex } from "viem";

/**
 * Server-only settings. Secrets live in env vars (see web/.env.example) and
 * never reach the browser: none of these are NEXT_PUBLIC_.
 */
const str = (k: string) => {
  const v = process.env[k]?.trim();
  return v ? v : undefined;
};
const key = (k: string): Hex | undefined => {
  const v = str(k);
  return v && isHex(v) && v.length === 66 ? v : undefined;
};
const address = (k: string): Address | undefined => {
  const v = str(k);
  return v && isAddress(v) ? v : undefined;
};

export const serverEnv = {
  /** Signs Cash Out orders; its address is the module's `orderSigner`. */
  orderSignerKey: key("ORDER_SIGNER_PRIVATE_KEY"),
  /** Minutes a signed order stays valid. */
  orderTtlMinutes: Number(str("ORDER_TTL_MINUTES") ?? 10),
  /** Slippage allowed on Route B's swap, in basis points. */
  routeBSlippageBps: BigInt(str("ROUTE_B_SLIPPAGE_BPS") ?? 50),

  mock: {
    /** Which route the mock provider takes: A (MUSD on Mezo) or B (USDC on Ethereum). */
    route: str("MOCK_ROUTE") === "B" ? ("B" as const) : ("A" as const),
    /** Where the mock provider receives MUSD on Route A. */
    musdDepositAddress: address("MOCK_MUSD_DEPOSIT_ADDRESS"),
    /** Optional: a wallet holding testnet MUSD to play the on-ramp for Pay back. */
    treasuryKey: key("MOCK_TREASURY_PRIVATE_KEY"),
    /** Seconds from the payment landing to the simulated payout. */
    payoutDelaySeconds: Number(str("MOCK_PAYOUT_DELAY_SECONDS") ?? 20),
  },

  /**
   * Testnet only: a wallet holding testnet BTC that tops judges and testers up
   * to what a first cash-out needs, since one faucet drip isn't enough.
   */
  demoFaucetKey: key("DEMO_FAUCET_PRIVATE_KEY"),

  banxa: {
    apiKey: str("BANXA_API_KEY"),
    partnerRef: str("BANXA_PARTNER_REF"),
    /** sandbox (default) or production. */
    production: str("BANXA_ENV") === "production",
  },
};

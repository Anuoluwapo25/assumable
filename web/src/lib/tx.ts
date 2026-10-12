"use client";

import { useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, type Hash } from "viem";
import { usePublicClient } from "wagmi";

export type TxState =
  | { phase: "idle" }
  | { phase: "signing"; label: string }
  | { phase: "pending"; label: string; hash: Hash }
  | { phase: "done"; label: string; hash: Hash }
  | { phase: "error"; label: string; message: string };

// Every revert the market can raise, said the way a trader needs to hear it.
const REVERTS: Record<string, string> = {
  NotHolder: "Only the position's current owner can do that.",
  NotOwner: "Only the position's current owner can do that.",
  NotApproved: "Approve the market for your positions first.",
  InvalidPricing: "That price isn't valid.",
  NotListed: "This position isn't listed any more.",
  Expired: "That listing or offer has expired.",
  StaleListing: "The seller moved this position elsewhere; the listing is void.",
  TroveNotActive: "This Trove has been closed, liquidated or redeemed.",
  PriceAboveMax: "The price moved above what you agreed to pay. Check the new price and try again.",
  DebtAboveMax: "The seller added debt since you looked. Nothing was bought.",
  CollBelowMin: "The seller removed collateral since you looked. Nothing was bought.",
  NoEquity: "The Trove's debt is worth more than its BTC, so equity pricing gives no price.",
  NoOffer: "There's no offer from that buyer.",
  OfferBelowMin: "The buyer lowered their offer. Check it again.",
  ERC20InsufficientBalance: "Your wallet doesn't hold enough MUSD.",
  ERC20InsufficientAllowance: "Approve MUSD first.",
};

export function explain(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "You declined the request in your wallet.";
    }
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && REVERTS[name]) return REVERTS[name];
      if (revert.reason) return revert.reason;
    }
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/**
 * Sends one transaction and follows it to its receipt. The caller passes the
 * wallet call; this owns the phases in between, so every button in the app
 * reports progress and failure the same way.
 */
export function useTx(onSettled?: () => void) {
  const client = usePublicClient();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  async function run(label: string, send: () => Promise<Hash>) {
    setState({ phase: "signing", label });
    try {
      const hash = await send();
      setState({ phase: "pending", label, hash });
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      setState({ phase: "done", label, hash });
      onSettled?.();
      return true;
    } catch (error) {
      setState({ phase: "error", label, message: explain(error) });
      return false;
    }
  }

  return { state, run, reset: () => setState({ phase: "idle" }) };
}

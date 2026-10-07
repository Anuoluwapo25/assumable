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

// Every revert the vault can raise, said the way a depositor needs to hear it.
const REVERTS: Record<string, string> = {
  WithdrawalsBlockedByPendingLiquidations:
    "The Stability Pool is holding withdrawals while a Trove is waiting to be liquidated. Nothing is wrong with your deposit; try again once that liquidation clears.",
  NothingToHarvest: "There is no BTC to harvest yet. It arrives with the next liquidation.",
  SwapReturnedTooLittle:
    "The swap came back below MUSD's oracle price, so the vault refused it. Your funds are untouched.",
  ERC4626ExceededMaxWithdraw: "That is more than your position is worth.",
  ERC4626ExceededMaxRedeem: "That is more bMUSD than you hold.",
  ERC20InsufficientBalance: "Your wallet doesn't hold that much MUSD.",
  ERC20InsufficientAllowance: "The vault isn't approved to move that much MUSD yet.",
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

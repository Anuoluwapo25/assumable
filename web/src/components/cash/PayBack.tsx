"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi } from "viem";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { cashOutModuleAbi } from "@/lib/abi";
import type { Currency, PaybackJson } from "@/lib/cashout/api";
import { ApiFailure, api, dollars, money } from "@/lib/cashout/client";
import { WAD } from "@/lib/cashout/safety";
import { cashOut, musdContracts } from "@/lib/config";
import { hintsOrNone } from "@/lib/cashout/hints";
import type { Position } from "@/lib/positions";
import { explainCashOut } from "./CashOut";

type State = { phase: "idle" } | { phase: "working"; label: string } | { phase: "done"; text: string } | { phase: "error"; text: string };

/** The reverse of a cash-out in one flow: local money in, the loan paid down. */
export function PayBack({ loan, currency, onDone }: { loan: Position; currency: Currency; onDone: () => void }) {
  const { address } = useConnection();
  const client = usePublicClient();
  const write = useWriteContract();
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });

  async function run() {
    if (!address) return;
    try {
      setState({ phase: "working", label: "Preparing your payment" });
      const p = await api<PaybackJson>("/api/payback", {
        method: "POST",
        body: JSON.stringify({ tokenId: loan.id.toString(), owner: address, fiat: currency.code, amount: amount.replace(/,/g, "") }),
      });
      const musd = BigInt(p.musdAmount);

      const allowance = await client!.readContract({
        address: musdContracts.musd,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, cashOut.module!],
      });
      if (allowance < musd) {
        setState({ phase: "working", label: "Allow the payment in your wallet" });
        const h = await write.mutateAsync({ address: musdContracts.musd, abi: erc20Abi, functionName: "approve", args: [cashOut.module!, musd] });
        await client!.waitForTransactionReceipt({ hash: h });
      }

      setState({ phase: "working", label: "Confirm in your wallet" });
      const [upper, lower] = await hintsOrNone(client!, { coll: loan.coll, debt: loan.debt - musd });
      const hash = await write.mutateAsync({
        address: cashOut.module!,
        abi: cashOutModuleAbi,
        functionName: "repay",
        args: [loan.id, musd, p.onrampOrderId, upper, lower],
      });
      await client!.waitForTransactionReceipt({ hash });
      setState({ phase: "done", text: `Paid back ${dollars(musd)}. Your loan is smaller and your Bitcoin is safer.` });
      setAmount("");
      onDone();
    } catch (e) {
      if (e instanceof ApiFailure) {
        const b = e.body as { error?: string; repayable?: string; fiatPerUsd?: string; have?: string; need?: string };
        if (b.error === "above-repayable" && b.repayable && b.fiatPerUsd) {
          const most = (BigInt(b.repayable) * BigInt(b.fiatPerUsd)) / WAD;
          return setState({
            phase: "error",
            text:
              BigInt(b.repayable) === 0n
                ? "This loan is already at its smallest size. To pay back the rest, close the loan."
                : `You can pay back up to about ${money(most, currency)} now. To pay back everything, close the loan.`,
          });
        }
        if (b.error === "wallet-short") {
          return setState({ phase: "error", text: `Demo: your wallet balance is ${dollars(b.have ?? "0")}, and this needs ${dollars(b.need ?? "0")}.` });
        }
        return setState({ phase: "error", text: e.message });
      }
      setState({ phase: "error", text: explainCashOut(e) });
    }
  }

  return (
    <section id="pay-back" aria-labelledby="pay-back-title" className="rounded-[22px] bg-white p-5 ring-1 ring-ink/10 sm:rounded-[28px] sm:p-7">
      <h2 id="pay-back-title" className="text-[13px] font-semibold text-ink-soft">Pay back</h2>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (Number(amount.replace(/,/g, "")) > 0 && state.phase !== "working") void run();
        }}
      >
        <label htmlFor="pay-back-amount" className="sr-only">Amount to pay back in {currency.name}</label>
        <input
          id="pay-back-amount"
          className="input num"
          inputMode="decimal"
          autoComplete="off"
          placeholder={`${currency.symbol}0`}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
        />
        <button className="btn-outline shrink-0" disabled={!amount || state.phase === "working"}>
          {state.phase === "working" ? state.label : "Pay back"}
        </button>
      </form>
      <p className="mt-2 text-[12.5px] leading-snug text-ink-mute">
        Demo: no money is collected. The payment comes from your wallet balance.
      </p>
      {state.phase === "done" && <p className="mt-3 text-[14px] text-musd-deep" aria-live="polite">{state.text}</p>}
      {state.phase === "error" && (
        <p role="alert" className="mt-3 rounded-xl bg-stop/10 px-3 py-2.5 text-[14px] leading-snug text-stop">
          {state.text}{" "}
          {state.text.includes("close the loan") && <Link className="link" href={`/p/${loan.id}`}>Close it here</Link>}
        </p>
      )}
    </section>
  );
}

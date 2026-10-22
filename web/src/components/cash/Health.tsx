"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { formatUsd, healthOf, liquidationPriceOf, ltvOf, safetySentence } from "@/lib/cashout/safety";
import { useMarketContext, type Position } from "@/lib/positions";

/**
 * How the loan stands at today's BTC price, or at a price the user tries out.
 * When it gets close to the line, it offers the two ways out: pay some back,
 * or sell the loan to a buyer who takes it over (Assumable's market).
 */
export function Health({ loan }: { loan: Position }) {
  const { price } = useMarketContext();
  const [pct, setPct] = useState(100);
  const id = useId();
  if (price === undefined) return null;

  const at = (price * BigInt(pct)) / 100n;
  const ltv = ltvOf(loan.coll, loan.debt, at);
  const liq = liquidationPriceOf(loan.coll, loan.debt);
  const drop = at > liq ? ((at - liq) * 10_000n) / at : 0n;
  const health = healthOf(ltv);
  const simulated = pct !== 100;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`rounded-[22px] p-5 ring-1 sm:rounded-[28px] sm:p-7 ${
        health === "act" ? "bg-stop/10 ring-stop/30" : health === "watch" ? "bg-btc-pale ring-btc/30" : "bg-white ring-ink/10"
      }`}
    >
      <h2 id={`${id}-title`} className="text-[13px] font-semibold text-ink-soft">
        Your Bitcoin {simulated && <span className="ml-1 rounded-full bg-ink px-2 py-0.5 text-[11.5px] text-page">Simulation</span>}
      </h2>
      <p className="mt-2 text-[17px] font-semibold leading-snug" aria-live="polite">
        {health === "act"
          ? "BTC has fallen a long way. Your Bitcoin could be sold to cover the loan unless you act."
          : health === "watch"
            ? "BTC has fallen. Your loan is getting closer to the line where your Bitcoin is sold."
            : safetySentence(liq, drop)}
      </p>
      {health !== "safe" && <p className="mt-1 text-[15px] text-ink-soft">{safetySentence(liq, drop)}</p>}

      {health !== "safe" && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <a href="#pay-back" className="btn-ink">Pay some back</a>
          <Link href={`/p/${loan.id}`} className="btn-outline">Sell the loan instead</Link>
        </div>
      )}
      {health === "act" && (
        <p className="mt-3 text-[13.5px] leading-snug text-ink-soft">
          Selling the loan passes it, and the Bitcoin behind it, to a buyer who pays you what&apos;s left over. You walk away with
          that instead of losing it all.
        </p>
      )}

      <div className="mt-5 border-t border-ink/10 pt-4">
        <label htmlFor={id} className="flex justify-between text-[13px] font-semibold text-ink-soft">
          <span>What if BTC were…</span>
          <span className="num text-ink">{formatUsd(at)}{simulated ? ` (${pct - 100}%)` : " (today)"}</span>
        </label>
        <input
          id={id}
          type="range"
          min={20}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="mt-2 w-full accent-musd"
          aria-valuetext={`${formatUsd(at)}, ${100 - pct}% below today`}
        />
        <p className="mt-1 text-[12.5px] text-ink-mute">Try a fall in price. This only changes what you see here.</p>
      </div>
    </section>
  );
}

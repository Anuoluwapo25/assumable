"use client";

import { useQuery } from "@tanstack/react-query";
import type { Hash } from "viem";
import type { Currency, OrderJson } from "@/lib/cashout/api";
import { api, money } from "@/lib/cashout/client";
import { TxLink } from "../primitives";

/** The payout's progress, live: loan drawn -> converted -> sent -> paid out. */
export function Timeline({ orderId, hash, currency }: { orderId: `0x${string}`; hash: Hash | null; currency?: Currency }) {
  const order = useQuery({
    queryKey: ["cashout-order", orderId],
    queryFn: () => api<OrderJson>(`/api/order/${orderId}`),
    refetchInterval: (q) => (q.state.data?.state === "paid" || q.state.data?.state === "failed" ? false : 3_000),
  });
  const o = order.data;
  const sym = currency && o && currency.code === o.fiat ? currency : { symbol: `${o?.fiat ?? ""} `, code: o?.fiat ?? "" };

  return (
    <section aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="wide text-[26px] font-extrabold leading-tight tracking-[-0.03em]">
        {o?.state === "paid" ? "Paid out" : o?.state === "failed" ? "Payout failed" : "On its way"}
      </h2>
      {o && (
        <p className="mt-1 text-[15px] text-ink-soft">
          {money(o.fiatAmount, sym)} to {o.destination.kind === "bank" ? o.destination.institution : `${o.destination.institution} mobile money`} ending{" "}
          <span className="num">{o.destination.last4}</span>
          {o.mock && <span className="ml-2 rounded-full bg-btc-pale px-2 py-0.5 text-[12px] font-semibold text-ink">Demo payout</span>}
        </p>
      )}

      {o?.state === "awaiting_provider" && (
        <p className="mt-4 rounded-2xl bg-btc-pale px-4 py-3 text-[14px] text-ink">
          The payout partner opened in a new tab to confirm who you are. Come back here when you&apos;re done.
        </p>
      )}
      {o?.state === "expired" && (
        <p role="alert" className="mt-4 rounded-2xl bg-stop/10 px-4 py-3 text-[14px] text-stop">
          This quote expired before it was confirmed. Nothing was borrowed. Start again for a fresh price.
        </p>
      )}

      <ol className="mt-6 space-y-0" aria-live="polite">
        {(o?.steps ?? PLACEHOLDER).map((s, i, all) => (
          <li key={s.key} className="relative flex gap-4 pb-6 last:pb-0">
            {i < all.length - 1 && (
              <span aria-hidden className={`absolute left-[11px] top-7 h-[calc(100%-22px)] w-0.5 ${s.state === "done" ? "bg-musd" : "bg-ink-line"}`} />
            )}
            <span
              aria-hidden
              className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
                s.state === "done"
                  ? "bg-musd text-white"
                  : s.state === "active"
                    ? "animate-pulse bg-btc text-ink"
                    : s.state === "failed"
                      ? "bg-stop text-white"
                      : "bg-page text-ink-mute ring-1 ring-ink/15"
              }`}
            >
              {s.state === "done" ? "✓" : s.state === "failed" ? "!" : i + 1}
            </span>
            <div>
              <p className={`text-[15.5px] font-semibold ${s.state === "waiting" ? "text-ink-mute" : "text-ink"}`}>
                {s.label}
                <span className="sr-only"> ({s.state === "done" ? "done" : s.state === "active" ? "in progress" : s.state === "failed" ? "failed" : "not started"})</span>
              </p>
              {s.detail && <p className="text-[13.5px] text-ink-soft">{s.detail}</p>}
              {s.at && s.state === "done" && <p className="num text-[12.5px] text-ink-mute">{new Date(s.at).toLocaleTimeString()}</p>}
            </div>
          </li>
        ))}
      </ol>

      {(hash ?? o?.txHash) && (
        <p className="mt-5 text-[13px] text-ink-soft">
          Receipt: <TxLink hash={(hash ?? o?.txHash)!} />
        </p>
      )}
    </section>
  );
}

const PLACEHOLDER: OrderJson["steps"] = [
  { key: "drawn", label: "Loan drawn against your Bitcoin", state: "active", at: null },
  { key: "converted", label: "Converted to dollars", state: "waiting", at: null },
  { key: "sent", label: "Sent to the payout partner", state: "waiting", at: null },
  { key: "paid", label: "Paid out to your account", state: "waiting", at: null },
];

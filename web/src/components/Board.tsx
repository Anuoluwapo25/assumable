"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { btc, musd, ratio } from "@/lib/format";
import type { Position } from "@/lib/positions";
import { WAD, rateLabel, toneOf } from "@/lib/risk";
import { EquityBar } from "./desk";

const TONE = { safe: "text-musd", warn: "text-btc-deep", danger: "text-stop" } as const;

type SortKey = "discount" | "price" | "ratio" | "rate";
const SORTS: { id: SortKey; label: string }[] = [
  { id: "discount", label: "Best discount" },
  { id: "price", label: "Lowest price" },
  { id: "ratio", label: "Safest" },
  { id: "rate", label: "Lowest rate" },
];

/** Discount to equity in basis points; negative means a premium. */
export const discountBps = (p: Position) =>
  p.listing && p.equity > 0n ? Number(((p.equity - p.listing.price) * 10_000n) / p.equity) : 0;

export function discountLabel(p: Position) {
  const d = discountBps(p) / 100;
  return d >= 0 ? `${d.toFixed(1)}% under` : `${(-d).toFixed(1)}% over`;
}

/** The order board: every Trove for sale, one row each, cheapest equity first. */
export function Board({
  listed,
  price,
  currentRate,
  selected,
  onSelect,
}: {
  listed: Position[];
  price?: bigint;
  currentRate?: number;
  selected?: bigint;
  onSelect: (id: bigint) => void;
}) {
  const [sort, setSort] = useState<SortKey>("discount");
  const rows = useMemo(() => {
    const r = [...listed];
    const by: Record<SortKey, (a: Position, b: Position) => number> = {
      discount: (a, b) => discountBps(b) - discountBps(a),
      price: (a, b) => (a.listing!.price < b.listing!.price ? -1 : 1),
      ratio: (a, b) => (a.icr > b.icr ? -1 : 1),
      rate: (a, b) => a.rate - b.rate,
    };
    return r.sort(by[sort]);
  }, [listed, sort]);

  return (
    <div className="overflow-hidden rounded-[22px] bg-white ring-1 ring-ink/10 sm:rounded-[28px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-line px-5 py-4 sm:px-6">
        <p className="text-[13px] font-semibold text-ink-mute">
          <span className="num text-ink">{listed.length}</span> {listed.length === 1 ? "Trove" : "Troves"} for sale
        </p>
        <div className="flex flex-wrap gap-1">
          {SORTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                sort === s.id ? "bg-ink text-page" : "bg-page text-ink-mute hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="narrow w-full min-w-[720px] border-collapse text-left">
          <thead>
            <tr className="border-b border-ink-line text-[12.5px] text-ink-mute">
              <th className="py-3 pl-5 pr-3 font-semibold sm:pl-6">Trove</th>
              <th className="w-[26%] py-3 pr-3 font-semibold">Debt · equity</th>
              <th className="py-3 pr-3 text-right font-semibold">Ratio</th>
              <th className="py-3 pr-3 text-right font-semibold">Rate</th>
              <th className="py-3 pr-3 text-right font-semibold">Equity</th>
              <th className="py-3 pr-5 text-right font-semibold sm:pr-6">Price</th>
            </tr>
          </thead>
          <tbody className="whitespace-nowrap text-[15px]">
            {rows.map((p) => {
              const value = price ? (p.coll * price) / WAD : 0n;
              const active = selected === p.id;
              const rateEdge = currentRate !== undefined && p.rate < currentRate;
              return (
                <tr
                  key={p.id.toString()}
                  onClick={() => onSelect(p.id)}
                  className={`cursor-pointer border-b border-ink-line/70 transition-colors last:border-b-0 ${
                    active ? "bg-musd-mist" : "hover:bg-page/70"
                  }`}
                >
                  <td className="py-3.5 pl-5 pr-3 sm:pl-6">
                    <span className="flex items-center gap-2.5">
                      <span className={`h-2 w-2 rounded-full ${active ? "bg-musd" : "bg-btc"}`} />
                      <Link href={`/p/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold hover:text-musd">
                        #{p.id.toString()}
                      </Link>
                      <span className="num text-[13px] text-ink-mute">{btc(p.coll, 4)} BTC</span>
                    </span>
                  </td>
                  <td className="py-3.5 pr-3">
                    <EquityBar value={value} debt={p.debt} price={p.listing!.price} thin />
                    <span className="num mt-1 block text-[12px] text-ink-mute">{musd(p.debt, 0)} owed</span>
                  </td>
                  <td className={`num py-3.5 pr-3 text-right font-semibold ${TONE[toneOf(p.icr)]}`}>{ratio(p.icr)}</td>
                  <td className={`num py-3.5 pr-3 text-right ${rateEdge ? "font-semibold text-musd" : ""}`}>
                    {rateLabel(p.rate)}
                  </td>
                  <td className="num py-3.5 pr-3 text-right text-ink-soft">{musd(p.equity, 0)}</td>
                  <td className="py-3.5 pr-5 text-right sm:pr-6">
                    <span className="num block font-bold">{musd(p.listing!.price, 0)}</span>
                    <span className={`num text-[12px] ${discountBps(p) >= 0 ? "text-musd" : "text-btc-deep"}`}>
                      {discountLabel(p)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState } from "react";
import { Board, discountBps } from "@/components/Board";
import { Quiet } from "@/components/desk";
import { HowItWorks } from "@/components/HowItWorks";
import { Ledger } from "@/components/Ledger";
import { Masthead } from "@/components/Masthead";
import { Figure } from "@/components/primitives";
import { Terms } from "@/components/Terms";
import { TradeDesk } from "@/components/Trade";
import { deployed } from "@/lib/config";
import { musd } from "@/lib/format";
import { useMarketContext, usePositions } from "@/lib/positions";
import { rateLabel } from "@/lib/risk";

export default function Market() {
  const { price, currentRate } = useMarketContext();
  const positions = usePositions();
  const listed = (positions.data ?? []).filter((p) => p.active && p.listing && p.listing.price > 0n);
  const [picked, setPicked] = useState<bigint>();

  const best = listed.length ? listed.reduce((a, b) => (discountBps(b) > discountBps(a) ? b : a)) : undefined;
  const selected = listed.find((p) => p.id === picked) ?? best;
  const equityForSale = listed.reduce((sum, p) => sum + p.equity, 0n);

  return (
    <>
      <Masthead />
      <main>
        <section className="mx-auto max-w-[1240px] px-4 sm:px-8">
          <div className="grid gap-8 pb-10 pt-8 sm:pt-14 lg:grid-cols-12 lg:items-end lg:pb-12">
            <div className="animate-rise lg:col-span-8">
              <h1 className="wide max-w-[17ch] text-[42px] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-[68px] lg:text-[78px]">
                Sell your MUSD loan <span className="text-musd">without repaying it.</span>
              </h1>
              <p className="mt-6 max-w-[58ch] text-[17px] leading-[1.55] text-ink-soft sm:text-lg">
                Borrowed MUSD and spent it? You don&apos;t have to buy it back to get out. Sell the
                whole Trove: the buyer pays you for your equity and assumes the BTC, the debt and its
                locked interest rate, in one transaction.
              </p>
            </div>

            <div className="animate-rise lg:col-span-4 lg:pb-1" style={{ animationDelay: "80ms" }}>
              <p className="text-[13px] font-semibold text-ink-mute">Equity for sale</p>
              <p className="mt-1 flex items-baseline gap-2">
                <Figure
                  value={positions.data ? musd(equityForSale, 0) : undefined}
                  width="5ch"
                  className="wide text-[56px] font-extrabold leading-none tracking-[-0.045em] sm:text-[64px]"
                />
                <span className="text-[15px] font-semibold text-ink-mute">MUSD</span>
              </p>
              <p className="mt-2 text-[14px] text-ink-mute">
                {best ? (
                  <>
                    Best deal{" "}
                    <span className="num font-semibold text-musd">{(discountBps(best) / 100).toFixed(1)}% under equity</span>{" "}
                    · new Troves pay {currentRate !== undefined ? rateLabel(currentRate) : "—"}
                  </>
                ) : deployed ? (
                  "Nothing listed yet."
                ) : (
                  "Opens at launch."
                )}
              </p>
            </div>
          </div>

          <div id="board" className="grid scroll-mt-6 gap-4 lg:grid-cols-12 lg:gap-5">
            <div className="animate-rise lg:col-span-8" style={{ animationDelay: "140ms" }}>
              {!deployed ? (
                <Quiet>The market contracts aren&apos;t deployed on this network yet.</Quiet>
              ) : positions.isLoading ? (
                <Quiet>Reading the board…</Quiet>
              ) : listed.length === 0 ? (
                <Quiet>
                  Nothing for sale yet. <Link href="/open" className="link">Open a Trove</Link> and list it.
                </Quiet>
              ) : (
                <Board listed={listed} price={price} currentRate={currentRate} selected={selected?.id} onSelect={setPicked} />
              )}
            </div>
            <div className="animate-rise lg:col-span-4" style={{ animationDelay: "200ms" }}>
              <TradeDesk p={selected} price={price} currentRate={currentRate} onDone={() => void positions.refetch()} />
            </div>
          </div>
        </section>

        <HowItWorks />
        <Ledger />
      </main>
      <Terms />
    </>
  );
}

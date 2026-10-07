"use client";

import { price } from "@/lib/format";
import type { VaultState } from "@/lib/vault";
import { Desk } from "./Desk";
import { Pool } from "./Pool";
import { Figure } from "./primitives";

const ONE = 10n ** 18n;

export function Hero({ vault }: { vault: VaultState }) {
  // bMUSD starts at exactly 1 MUSD, so the distance from 1 is the whole return
  // since the first deposit, with nothing assumed about time or APY.
  const growth = vault.sharePrice === undefined ? undefined : Number(vault.sharePrice - ONE) / 1e16;

  return (
    <section className="mx-auto max-w-[1240px] px-4 sm:px-8">
      <div className="grid gap-8 pb-10 pt-8 sm:pt-14 lg:grid-cols-12 lg:items-end lg:pb-12">
        <div className="animate-rise lg:col-span-8">
          <h1 className="wide max-w-[16ch] text-[42px] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-[68px] lg:text-[80px]">
            Every liquidation on Mezo pays <span className="text-musd">this pool.</span>
          </h1>
          <p className="mt-6 max-w-[56ch] text-[17px] leading-[1.55] text-ink-soft sm:text-lg">
            When a Trove goes under, the Stability Pool takes its BTC at a discount. Backstop
            sells that BTC back into MUSD and puts it straight back in the pool, so your
            share keeps growing and you never hold BTC.
          </p>
        </div>

        <div className="animate-rise lg:col-span-4 lg:pb-1" style={{ animationDelay: "80ms" }}>
          <p className="text-[13px] font-semibold text-ink-mute">1 bMUSD is worth</p>
          <p className="mt-1 flex items-baseline gap-2">
            <Figure
              value={vault.sharePrice === undefined ? undefined : price(vault.sharePrice)}
              width="5ch"
              className="wide text-[56px] font-extrabold leading-none tracking-[-0.045em] sm:text-[64px]"
            />
            <span className="text-[15px] font-semibold text-ink-mute">MUSD</span>
          </p>
          <p className="mt-2 text-[14px] text-ink-mute">
            {growth === undefined ? (
              vault.deployed ? <Figure value={undefined} width="18ch" /> : "Starts at exactly 1.0000 at launch."
            ) : (
              <>
                <span className={`num font-semibold ${growth >= 0 ? "text-musd" : "text-stop"}`}>
                  {growth >= 0 ? "+" : "−"}
                  {Math.abs(growth).toFixed(2)}%
                </span>{" "}
                since the first deposit, all from liquidations.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="animate-rise lg:col-span-8" style={{ animationDelay: "140ms" }}>
          <Pool vault={vault} />
        </div>
        <div className="animate-rise lg:col-span-4" style={{ animationDelay: "200ms" }}>
          <Desk vault={vault} />
        </div>
      </div>
    </section>
  );
}

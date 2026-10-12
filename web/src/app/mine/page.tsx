"use client";

import Link from "next/link";
import { isAddressEqual } from "viem";
import { useConnection } from "wagmi";
import { Quiet } from "@/components/desk";
import { Masthead } from "@/components/Masthead";
import { Terms } from "@/components/Terms";
import { WalletButton, useMounted } from "@/components/Wallet";
import { btc, musd, ratio } from "@/lib/format";
import { useMarketContext, usePositions } from "@/lib/positions";
import { rateLabel, toneOf } from "@/lib/risk";

const TONE = { safe: "text-musd", warn: "text-btc-deep", danger: "text-stop" } as const;

export default function Mine() {
  const mounted = useMounted();
  const { address } = useConnection();
  const { currentRate } = useMarketContext();
  const positions = usePositions();
  const mine = address ? (positions.data ?? []).filter((p) => isAddressEqual(p.owner, address)) : [];
  const equity = mine.filter((p) => p.active).reduce((s, p) => s + p.equity, 0n);

  return (
    <>
      <Masthead />
      <main className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div className="grid gap-8 pb-10 pt-8 sm:pt-14 lg:grid-cols-12 lg:items-end lg:pb-12">
          <h1 className="wide animate-rise text-[42px] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-[68px] lg:col-span-8">
            My <span className="text-musd">Troves.</span>
          </h1>
          <div className="animate-rise lg:col-span-4">
            <p className="text-[13px] font-semibold text-ink-mute">Your equity</p>
            <p className="wide num mt-1 text-[56px] font-extrabold leading-none tracking-[-0.045em]">
              {mounted && address ? musd(equity, 0) : "—"}
              <span className="ml-2 text-[15px] font-semibold tracking-normal text-ink-mute">MUSD</span>
            </p>
          </div>
        </div>

        {!mounted || !address ? (
          <div className="rounded-[22px] bg-white py-12 text-center ring-1 ring-ink/10 sm:rounded-[28px]">
            <WalletButton />
          </div>
        ) : positions.isLoading ? (
          <Quiet>Reading your Troves…</Quiet>
        ) : mine.length === 0 ? (
          <Quiet>
            You don&apos;t hold any Troves here yet. <Link href="/open" className="link">Open one</Link> or buy one on the{" "}
            <Link href="/#board" className="link">board</Link>.
          </Quiet>
        ) : (
          <div className="overflow-x-auto rounded-[22px] bg-white ring-1 ring-ink/10 sm:rounded-[28px]">
            <table className="narrow w-full min-w-[680px] border-collapse text-left">
              <thead>
                <tr className="border-b border-ink-line text-[13px] text-ink-mute">
                  <th className="py-4 pl-5 pr-4 font-semibold sm:pl-7">Trove</th>
                  <th className="py-4 pr-4 text-right font-semibold">BTC</th>
                  <th className="py-4 pr-4 text-right font-semibold">Debt</th>
                  <th className="py-4 pr-4 text-right font-semibold">Ratio</th>
                  <th className="py-4 pr-4 text-right font-semibold">Rate</th>
                  <th className="py-4 pr-4 text-right font-semibold">Equity</th>
                  <th className="py-4 pr-5 text-right font-semibold sm:pr-7">Status</th>
                </tr>
              </thead>
              <tbody className="whitespace-nowrap text-[15px]">
                {mine.map((p) => (
                  <tr key={p.id.toString()} className="border-b border-ink-line/70 last:border-b-0 hover:bg-page/60">
                    <td className="py-3.5 pl-5 pr-4 sm:pl-7">
                      <Link href={`/p/${p.id}`} className="font-semibold hover:text-musd">#{p.id.toString()} →</Link>
                    </td>
                    <td className="num py-3.5 pr-4 text-right">{btc(p.coll, 4)}</td>
                    <td className="num py-3.5 pr-4 text-right">{musd(p.debt, 0)}</td>
                    <td className={`num py-3.5 pr-4 text-right font-semibold ${p.active ? TONE[toneOf(p.icr)] : ""}`}>{p.active ? ratio(p.icr) : "—"}</td>
                    <td className={`num py-3.5 pr-4 text-right ${currentRate !== undefined && p.rate < currentRate ? "font-semibold text-musd" : ""}`}>{rateLabel(p.rate)}</td>
                    <td className="num py-3.5 pr-4 text-right font-semibold">{musd(p.equity, 0)}</td>
                    <td className="py-3.5 pr-5 text-right text-[13.5px] sm:pr-7">
                      {!p.active ? (
                        <span className="text-ink-mute">Closed</span>
                      ) : p.listing && p.listing.price > 0n ? (
                        <span className="font-semibold text-btc-deep">Listed · {musd(p.listing.price, 0)}</span>
                      ) : (
                        <span className="text-ink-mute">Not listed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Terms />
    </>
  );
}

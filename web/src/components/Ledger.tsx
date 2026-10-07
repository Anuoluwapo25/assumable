"use client";

import { useActivity, type Entry } from "@/lib/activity";
import { btc, musd } from "@/lib/format";
import type { VaultState } from "@/lib/vault";
import { AddressLink, SectionHead, TxLink } from "./primitives";

function ago(time?: number) {
  if (!time) return "";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - time));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const KIND = {
  deposit: { word: "Deposit", dot: "bg-musd" },
  withdraw: { word: "Withdrawal", dot: "bg-ink-faint" },
  harvest: { word: "Harvest", dot: "bg-btc" },
} as const;

export function Ledger({ vault }: { vault: VaultState }) {
  const activity = useActivity();

  return (
    <section id="ledger" className="mx-auto max-w-[1240px] scroll-mt-6 px-4 pt-24 sm:px-8 sm:pt-32">
      <SectionHead title="Ledger." aside="Every deposit, withdrawal and harvest, read straight from the vault's events." />

      {!vault.deployed ? (
        <Quiet>Entries appear here from the first deposit.</Quiet>
      ) : activity.isLoading ? (
        <Quiet>Reading events…</Quiet>
      ) : activity.error ? (
        <Quiet>Couldn&rsquo;t read the vault&rsquo;s history from this RPC.</Quiet>
      ) : !activity.data?.length ? (
        <Quiet>No activity yet.</Quiet>
      ) : (
        <div className="overflow-x-auto rounded-[22px] bg-white ring-1 ring-ink/10 sm:rounded-[28px]">
          <table className="narrow w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-line text-[13px] text-ink-mute">
                <th className="py-4 pl-5 pr-4 font-semibold sm:pl-7">Event</th>
                <th className="py-4 pr-4 font-semibold">By</th>
                <th className="py-4 pr-4 text-right font-semibold">MUSD</th>
                <th className="py-4 pr-4 text-right font-semibold">Detail</th>
                <th className="py-4 pr-5 text-right font-semibold sm:pr-7">Transaction</th>
              </tr>
            </thead>
            <tbody className="whitespace-nowrap text-[15px]">
              {activity.data.map((e) => (
                <Row key={`${e.tx}-${e.kind}`} entry={e} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Row({ entry: e }: { entry: Entry }) {
  const kind = KIND[e.kind];
  return (
    <tr className="border-b border-ink-line/70 last:border-b-0 hover:bg-page/60">
      <td className="py-3.5 pl-5 pr-4 sm:pl-7">
        <span className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${kind.dot}`} />
          <span className="font-semibold">{kind.word}</span>
          <span className="text-[13px] text-ink-mute">{ago(e.time)}</span>
        </span>
      </td>
      <td className="py-3.5 pr-4 text-ink-soft">
        <AddressLink address={e.account} />
      </td>
      <td className="num py-3.5 pr-4 text-right font-semibold">
        {e.kind === "withdraw" ? "\u2212" : e.kind === "harvest" ? "+" : ""}
        {musd(e.kind === "harvest" ? e.musd - e.fee : e.musd)}
      </td>
      <td className="num py-3.5 pr-4 text-right text-ink-mute">
        {e.kind === "harvest" ? (
          <>
            <span className="text-btc-deep">{btc(e.btc)} BTC</span> sold · {musd(e.fee)} to caller
          </>
        ) : (
          <>{musd(e.shares)} bMUSD</>
        )}
      </td>
      <td className="py-3.5 pr-5 text-right text-ink-mute sm:pr-7">
        <TxLink hash={e.tx} />
      </td>
    </tr>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="rounded-[22px] bg-white py-12 text-center text-[15px] text-ink-mute ring-1 ring-ink/10 sm:rounded-[28px]">{children}</p>;
}

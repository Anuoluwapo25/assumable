"use client";

import Link from "next/link";
import { useActivity, type Entry } from "@/lib/activity";
import { deployed } from "@/lib/config";
import { btc, musd } from "@/lib/format";
import { Quiet } from "./desk";
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
  sold: { word: "Sold", dot: "bg-musd" },
  listed: { word: "Listed", dot: "bg-btc" },
  offer: { word: "Offer", dot: "bg-musd-pale" },
  opened: { word: "Opened", dot: "bg-ink-faint" },
} as const;

export function Ledger() {
  const activity = useActivity();
  return (
    <section id="ledger" className="mx-auto max-w-[1240px] scroll-mt-6 px-4 pt-24 sm:px-8 sm:pt-32">
      <SectionHead title="Ledger." aside="Every Trove opened, listed, bid on and sold, read straight from the contracts' events." />
      {!deployed ? (
        <Quiet>Entries appear here from the first Trove.</Quiet>
      ) : activity.isLoading ? (
        <Quiet>Reading events…</Quiet>
      ) : activity.error ? (
        <Quiet>Couldn&rsquo;t read the market&rsquo;s history from this RPC.</Quiet>
      ) : !activity.data?.length ? (
        <Quiet>No activity yet.</Quiet>
      ) : (
        <div className="overflow-x-auto rounded-[22px] bg-white ring-1 ring-ink/10 sm:rounded-[28px]">
          <table className="narrow w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-line text-[13px] text-ink-mute">
                <th className="py-4 pl-5 pr-4 font-semibold sm:pl-7">Event</th>
                <th className="py-4 pr-4 font-semibold">Trove</th>
                <th className="py-4 pr-4 font-semibold">By</th>
                <th className="py-4 pr-4 text-right font-semibold">MUSD</th>
                <th className="py-4 pr-5 text-right font-semibold sm:pr-7">Transaction</th>
              </tr>
            </thead>
            <tbody className="whitespace-nowrap text-[15px]">
              {activity.data.map((e) => (
                <Row key={`${e.tx}-${e.kind}-${e.id}`} entry={e} />
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
  const by = e.kind === "sold" ? e.buyer : e.kind === "listed" ? e.seller : e.kind === "offer" ? e.buyer : e.owner;
  return (
    <tr className="border-b border-ink-line/70 last:border-b-0 hover:bg-page/60">
      <td className="py-3.5 pl-5 pr-4 sm:pl-7">
        <span className="flex items-center gap-2.5">
          <span className={`h-2 w-2 rounded-full ${kind.dot}`} />
          <span className="font-semibold">{kind.word}</span>
          <span className="text-[13px] text-ink-mute">{ago(e.time)}</span>
        </span>
      </td>
      <td className="py-3.5 pr-4">
        <Link href={`/p/${e.id}`} className="link num">#{e.id.toString()}</Link>
        {e.kind === "sold" && <span className="num ml-2 text-[13px] text-btc-deep">{btc(e.coll, 4)} BTC</span>}
      </td>
      <td className="py-3.5 pr-4 text-ink-soft">
        <AddressLink address={by} />
      </td>
      <td className="num py-3.5 pr-4 text-right font-semibold">
        {e.kind === "sold" ? musd(e.price, 0) : e.kind === "offer" ? musd(e.amount, 0) : e.kind === "listed" ? (e.equityShare ? `${(Number(e.value) / 100).toFixed(1)}% eq.` : musd(e.value, 0)) : "—"}
      </td>
      <td className="py-3.5 pr-5 text-right text-ink-mute sm:pr-7">
        <TxLink hash={e.tx} />
      </td>
    </tr>
  );
}

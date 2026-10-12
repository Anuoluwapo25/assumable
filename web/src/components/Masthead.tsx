"use client";

import Link from "next/link";
import { useBlockNumber } from "wagmi";
import { chain, deployed } from "@/lib/config";
import { musd } from "@/lib/format";
import { useMarketContext } from "@/lib/positions";
import { WalletButton } from "./Wallet";

export function Masthead() {
  const { data: block } = useBlockNumber({ watch: true });
  const { price } = useMarketContext();

  return (
    <header className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-5 sm:px-8">
      <div className="flex items-center gap-5">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="wide text-[19px] font-extrabold tracking-[-0.03em]">Assumable</span>
        </Link>
        <span className="num hidden items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12.5px] text-ink-mute ring-1 ring-ink/10 md:inline-flex">
          <span className={`h-1.5 w-1.5 rounded-full ${block ? "bg-musd" : "bg-ink-faint"}`} />
          {chain.name}
          {price !== undefined && <span className="text-ink-faint">· BTC {musd(price, 0)}</span>}
        </span>
      </div>
      <nav className="flex items-center gap-1 sm:gap-2">
        <Link href="/#board" className="hidden rounded-full px-3.5 py-2 text-[14.5px] font-medium text-ink-soft hover:bg-white md:inline">
          Market
        </Link>
        <Link href="/mine" className="hidden rounded-full px-3.5 py-2 text-[14.5px] font-medium text-ink-soft hover:bg-white md:inline">
          My Troves
        </Link>
        <Link href="/#ledger" className="hidden rounded-full px-3.5 py-2 text-[14.5px] font-medium text-ink-soft hover:bg-white lg:inline">
          Ledger
        </Link>
        {deployed && (
          <Link href="/open" className="btn-btc hidden !px-4 !py-2.5 sm:inline-flex">
            Open a Trove
          </Link>
        )}
        <WalletButton className="ml-1 !py-2.5" />
      </nav>
    </header>
  );
}

/** A grain of BTC with a key: a loan that can change hands. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" className="fill-musd" />
      <path d="M0 13.5 C 4 11.5, 8 11.5, 13 13.5 S 22 15.5, 26 13.5 V 26 H 0 Z" className="fill-musd-deep" />
      <circle cx="9" cy="18.5" r="3.4" className="fill-btc" />
      <path d="M12 17.6h9v1.8h-1.6v2h-1.8v-2H12z" className="fill-white" />
    </svg>
  );
}

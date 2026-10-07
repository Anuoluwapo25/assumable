"use client";

import { useBlockNumber } from "wagmi";
import { chain } from "@/lib/config";
import { musd } from "@/lib/format";
import type { VaultState } from "@/lib/vault";
import { WalletButton } from "./Wallet";

export function Masthead({ vault }: { vault: VaultState }) {
  const { data: block } = useBlockNumber({ watch: true, query: { enabled: vault.deployed } });

  return (
    <header className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-5 sm:px-8">
      <div className="flex items-center gap-5">
        <a href="#" className="flex items-center gap-2.5">
          <Mark />
          <span className="wide text-[19px] font-extrabold tracking-[-0.03em]">Backstop</span>
        </a>
        <span className="num hidden items-center gap-2 rounded-full bg-white px-3 py-1.5 text-[12.5px] text-ink-mute ring-1 ring-ink/10 md:inline-flex">
          <span className={`h-1.5 w-1.5 rounded-full ${block ? "bg-musd" : "bg-ink-faint"}`} />
          {chain.name}
          {vault.btcPrice !== undefined && (
            <span className="text-ink-faint">· BTC {musd(vault.btcPrice, 0)}</span>
          )}
        </span>
      </div>
      <nav className="flex items-center gap-1 sm:gap-2">
        <a href="#how" className="hidden rounded-full px-3.5 py-2 text-[14.5px] font-medium text-ink-soft hover:bg-white md:inline">
          How it works
        </a>
        <a href="#ledger" className="hidden rounded-full px-3.5 py-2 text-[14.5px] font-medium text-ink-soft hover:bg-white md:inline">
          Ledger
        </a>
        <WalletButton className="ml-2 !py-2.5" />
      </nav>
    </header>
  );
}

/** A grain of BTC resting on a line of water. */
function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" className="fill-musd" />
      <path d="M0 13.5 C 4 11.5, 8 11.5, 13 13.5 S 22 15.5, 26 13.5 V 26 H 0 Z" className="fill-musd-deep" />
      <circle cx="13" cy="20" r="3.4" className="fill-btc" />
    </svg>
  );
}

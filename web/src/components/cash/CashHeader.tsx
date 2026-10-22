"use client";

import Link from "next/link";
import { WalletButton } from "../Wallet";

/** A quiet header for Cash Out: no market, no loan jargon, just home and the wallet. */
export function CashHeader() {
  return (
    <header className="mx-auto flex max-w-[560px] items-center justify-between gap-4 px-4 py-5 sm:px-8">
      <Link href="/" className="wide text-[19px] font-extrabold tracking-[-0.03em]">
        Assumable
      </Link>
      <WalletButton className="!py-2.5" />
    </header>
  );
}

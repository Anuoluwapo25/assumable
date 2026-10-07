"use client";

import { chain, vaultAddress } from "@/lib/config";
import { bps } from "@/lib/format";
import type { VaultState } from "@/lib/vault";
import { AddressLink, Figure } from "./primitives";

export function Terms({ vault }: { vault: VaultState }) {
  const contracts: [string, string | undefined][] = [
    ["Vault (bMUSD)", vaultAddress ?? undefined],
    ["MUSD", vault.asset],
    ["Stability Pool", vault.stabilityPool],
    ["Price feed", vault.priceFeed],
    ["Swapper", vault.swapper],
    ["Owner", vault.owner],
  ];

  return (
    <footer className="mt-24 bg-ink text-page sm:mt-32">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-16 sm:px-8 sm:py-20 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 className="wide text-[30px] font-bold leading-none tracking-[-0.03em] sm:text-[36px]">The terms.</h2>
          <dl className="mt-8 text-[15px]">
            <Term label="Harvest fee, to whoever calls it">
              <Figure value={bps(vault.harvestFeeBps)} width="5ch" /> <span className="text-page/40">· max 5%</span>
            </Term>
            <Term label="Swap floor, vs. the oracle">
              <Figure value={bps(vault.swapQualityBps)} width="5ch" /> <span className="text-page/40">· min 90%</span>
            </Term>
            <Term label="Deposit or withdrawal fee">None</Term>
            <Term label="Owner can move deposits">No</Term>
          </dl>
          <p className="mt-6 max-w-[46ch] text-[14px] leading-relaxed text-page/55">
            The owner can only repoint the swap venue and tune the two numbers above within
            their hard limits. A bad swapper can cost at most the floor&rsquo;s margin on one
            harvest; it never holds depositor funds.
          </p>
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          <h2 className="wide text-[30px] font-bold leading-none tracking-[-0.03em] sm:text-[36px]">The contracts.</h2>
          <dl className="mt-8 text-[15px]">
            {contracts.map(([label, address]) => (
              <Term key={label} label={label}>
                {address ? (
                  <AddressLink address={address} label={`${address.slice(0, 8)}…${address.slice(-6)}`} />
                ) : vault.deployed ? (
                  <Figure value={undefined} width="14ch" />
                ) : (
                  <span className="text-page/40">at launch</span>
                )}
              </Term>
            ))}
          </dl>
          <p className="mt-6 text-[14px] text-page/55">On {chain.name}.</p>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 border-t border-page/10 px-4 py-7 text-[13px] text-page/45 sm:px-8">
        <span className="wide font-extrabold tracking-[-0.03em] text-page">Backstop</span>
        <span className="max-w-[70ch]">
          Unaudited. Stability Pool deposits take losses if a liquidation goes badly. Only
          deposit what you understand.
        </span>
      </div>
    </footer>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-t border-page/10 py-3.5">
      <dt className="text-page/60">{label}</dt>
      <dd className="num text-right font-semibold">{children}</dd>
    </div>
  );
}

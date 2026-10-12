import { chain, marketAddress, musdContracts, positionsAddress } from "@/lib/config";
import { AddressLink } from "./primitives";

export function Terms() {
  const contracts: [string, string | null][] = [
    ["TroveMarket", marketAddress],
    ["TrovePositions (NFT)", positionsAddress],
    ["MUSD", musdContracts.musd],
    ["MUSD TroveManager", musdContracts.troveManager],
    ["MUSD price feed", musdContracts.priceFeed],
  ];

  return (
    <footer className="mt-24 bg-ink text-page sm:mt-32">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-16 sm:px-8 sm:py-20 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 className="wide text-[30px] font-bold leading-none tracking-[-0.03em] sm:text-[36px]">The terms.</h2>
          <dl className="mt-8 text-[15px]">
            <Term label="Market fee">None</Term>
            <Term label="Seller keeps the NFT while listed">Yes</Term>
            <Term label="Buyer's limits checked on-chain">Price, debt, collateral</Term>
            <Term label="Equity priced by">MUSD&rsquo;s own oracle</Term>
            <Term label="Admin keys">None</Term>
          </dl>
          <p className="mt-6 max-w-[46ch] text-[14px] leading-relaxed text-page/55">
            Nobody can move a Trove but its NFT holder. A listed Trove is still a live MUSD Trove: it
            can be liquidated below 110% or redeemed against, and the market then refuses to sell it.
          </p>
        </div>

        <div className="lg:col-span-6 lg:col-start-7">
          <h2 className="wide text-[30px] font-bold leading-none tracking-[-0.03em] sm:text-[36px]">The contracts.</h2>
          <dl className="mt-8 text-[15px]">
            {contracts.map(([label, address]) => (
              <Term key={label} label={label}>
                {address ? (
                  <AddressLink address={address} label={`${address.slice(0, 8)}…${address.slice(-6)}`} />
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
        <span className="wide font-extrabold tracking-[-0.03em] text-page">Assumable</span>
        <span className="max-w-[70ch]">
          Unaudited. A Trove you buy can be liquidated like any other; check its ratio before you buy.
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

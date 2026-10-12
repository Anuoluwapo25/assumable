import { SectionHead } from "./primitives";

// The same Trove at three moments, drawn as a bar of BTC value: ink is what's
// owed, MUSD blue is the holder's equity. Coordinates are in a 300x170 box.
function Trove({ owner, children }: { owner: "seller" | "buyer"; children?: React.ReactNode }) {
  return (
    <svg viewBox="0 0 300 170" className="block h-auto w-full" aria-hidden>
      <rect x="30" y="70" width="240" height="34" rx="17" className="fill-musd" />
      <rect x="30" y="70" width="130" height="34" rx="17" className="fill-ink" />
      <rect x="140" y="70" width="20" height="34" className="fill-ink" />
      <text x="44" y="92" className="fill-white text-[11px]" opacity="0.85">debt</text>
      <text x="172" y="92" className="fill-white text-[11px]" opacity="0.9">equity</text>
      <text x="30" y="56" className="fill-ink text-[11px]" opacity="0.5">{owner === "seller" ? "held by the seller" : "held by the buyer"}</text>
      {children}
    </svg>
  );
}

const Key = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <circle cx="0" cy="0" r="9" className="fill-btc" />
    <path d="M7 -2.5h20v5h-3.5v5h-4v-5H7z" className="fill-btc" />
  </g>
);

export function HowItWorks() {
  const steps = [
    {
      art: (
        <Trove owner="seller">
          <Key x={60} y={135} />
          <text x="98" y="139" className="fill-ink text-[11px]" opacity="0.55">NFT = control of the Trove</text>
        </Trove>
      ),
      title: "Open a Trove you can sell.",
      body: "A normal MUSD Trove, opened by a small account contract that obeys whoever holds its NFT. Borrow, repay and add BTC exactly as you would on Mezo.",
      fine: "Borrowed MUSD and withdrawn BTC go straight to you. The account never holds anything a buyer could inherit.",
    },
    {
      art: (
        <Trove owner="seller">
          <line x1="244" x2="244" y1="62" y2="112" className="stroke-btc" strokeWidth="3" />
          <text x="186" y="146" className="fill-ink text-[11px]" opacity="0.6">ask: 97% of equity</text>
          <path d="M160 125 H 270" className="stroke-musd" strokeWidth="1.5" strokeDasharray="3 3" />
        </Trove>
      ),
      title: "List its equity.",
      body: "Ask a fixed MUSD price, or a share of live equity that re-prices with BTC on its own. Buyers can also escrow offers on any Trove, listed or not.",
      fine: "You keep the NFT while listed, so you can still rescue the Trove if BTC drops.",
    },
    {
      art: (
        <Trove owner="buyer">
          <Key x={240} y={135} />
          <path d="M70 135 H 205 M197 129 L206 135 L197 141" className="stroke-ink" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.5" />
          <text x="60" y="160" className="fill-ink text-[11px]" opacity="0.55">MUSD to the seller, NFT to the buyer</text>
        </Trove>
      ),
      title: "The buyer assumes it.",
      body: "One transaction: the seller walks away with the equity and owes nothing; the buyer gets the BTC, the debt and its locked rate. Nothing is repaid or closed.",
      fine: "The buyer's limits on price, debt and collateral are checked in that same transaction, so a listing can't be changed under them.",
    },
  ];

  return (
    <section id="how" className="mx-auto max-w-[1240px] scroll-mt-6 px-4 pt-24 sm:px-8 sm:pt-32">
      <SectionHead
        title="An assumable loan, on Bitcoin."
        aside="Like an assumable mortgage: the house, the loan and its rate change hands together."
      />
      <ol className="grid gap-4 md:grid-cols-3 lg:gap-5">
        {steps.map((s, i) => (
          <li key={i} className="flex flex-col rounded-[22px] bg-white p-3 ring-1 ring-ink/10 sm:rounded-[28px]">
            <div className="overflow-hidden rounded-[16px] bg-musd-mist sm:rounded-[20px]">{s.art}</div>
            <div className="flex flex-1 flex-col px-2 pb-2 pt-5 sm:px-3">
              <p className="num text-[13px] font-bold text-musd">0{i + 1}</p>
              <h3 className="wide mt-1 text-[21px] font-bold leading-tight tracking-[-0.025em]">{s.title}</h3>
              <p className="mb-5 mt-2.5 text-[15px] leading-[1.55] text-ink-soft">{s.body}</p>
              <p className="mt-auto border-t border-ink-line pt-3 text-[13px] leading-snug text-ink-mute">
                <span className="mr-1.5 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-btc align-middle" />
                {s.fine}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

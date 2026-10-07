"use client";

import { bps } from "@/lib/format";
import type { VaultState } from "@/lib/vault";
import { SectionHead } from "./primitives";

// The same pool as the hero, at three moments. Coordinates are in a 300x170
// box; `level` is the water's surface, lower numbers being fuller.
const BEFORE = 62;

function Tank({ level, children }: { level: number; children?: React.ReactNode }) {
  const wave = `M0 ${level} C 30 ${level - 5}, 60 ${level - 5}, 90 ${level} S 150 ${level + 5}, 180 ${level} S 240 ${level - 5}, 270 ${level} S 300 ${level + 3}, 300 ${level + 3} V 170 H 0 Z`;
  return (
    <svg viewBox="0 0 300 170" className="block h-auto w-full" aria-hidden>
      <path d={wave} className="fill-musd" />
      <line x1="0" x2="300" y1={BEFORE} y2={BEFORE} className="stroke-ink" strokeWidth="1" strokeDasharray="3 4" opacity="0.35" />
      {children}
    </svg>
  );
}

const grains: [number, number, number][] = [
  [118, 158, 5], [132, 160, 4], [146, 157, 6], [160, 159, 4.5], [174, 158, 5],
  [126, 150, 4], [140, 149, 5], [154, 150, 4], [168, 151, 4.5], [147, 142, 4],
];

export function HowItWorks({ vault }: { vault: VaultState }) {
  const steps = [
    {
      art: (
        <Tank level={76}>
          {grains.map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} className="fill-btc" />
          ))}
          <text x="10" y={BEFORE - 7} className="fill-ink text-[11px]" opacity="0.5">before</text>
          <path d="M268 30 V 66 M261 59 L268 67 L275 59" className="stroke-ink" strokeWidth="2" fill="none" strokeLinecap="round" />
        </Tank>
      ),
      title: "A Trove goes under.",
      body: "The pool burns MUSD to repay the Trove's debt, and takes its BTC, worth about 10% more. The water drops a little; BTC settles on the floor.",
      fine: "The pool pushes that BTC to the vault without being asked, so the vault is built to receive it at any moment.",
    },
    {
      art: (
        <Tank level={76}>
          {grains.map(([x, y, r], i) => (
            <circle
              key={i}
              cx={x + (i % 2 ? 10 : -6)}
              cy={y - 30 - (i % 4) * 16}
              r={r * 0.8}
              className="fill-btc"
              opacity={0.95 - (i % 4) * 0.22}
            />
          ))}
          <path d="M268 66 V 30 M261 37 L268 29 L275 37" className="stroke-ink" strokeWidth="2" fill="none" strokeLinecap="round" />
        </Tank>
      ),
      title: "Anyone harvests it.",
      body: `The BTC is sold for MUSD at no less than ${bps(vault.swapQualityBps).replace("—", "99%")} of MUSD's own oracle price, so the swap can't be sandwiched. Whoever calls it keeps ${bps(vault.harvestFeeBps).replace("—", "0.5%")}.`,
      fine: "Harvesting still works while withdrawals are paused: it uses the one call the pool never blocks.",
    },
    {
      art: (
        <Tank level={46}>
          <text x="10" y={BEFORE + 15} className="fill-white text-[11px]" opacity="0.8">before</text>
        </Tank>
      ),
      title: "It goes back in, higher.",
      body: "The MUSD is redeposited in the same transaction. The pool ends fuller than before the liquidation, and your share of it grows.",
      fine: "The BTC already counted toward the share price while it waited, at the floor price, so a harvest can only move the price up.",
    },
  ];

  return (
    <section id="how" className="mx-auto max-w-[1240px] scroll-mt-6 px-4 pt-24 sm:px-8 sm:pt-32">
      <SectionHead
        title="One loop, every liquidation."
        aside="What happens between a Trove going under and your share price going up."
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

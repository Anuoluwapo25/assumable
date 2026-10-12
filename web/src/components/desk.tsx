"use client";

import type { ReactNode } from "react";

/** The trading panel: Backstop's desk, holding whichever action tabs apply. */
export function DeskShell<T extends string>({
  tabs,
  active,
  onTab,
  children,
}: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onTab: (id: T) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col rounded-[22px] bg-white p-4 ring-1 ring-ink/10 sm:rounded-[28px] sm:p-5">
      {tabs.length > 1 && (
        <div className="grid rounded-full bg-page p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }} role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              onClick={() => onTab(t.id)}
              className={`rounded-full py-2.5 text-[14px] font-semibold transition-colors ${
                active === t.id ? "bg-ink text-page" : "text-ink-mute hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-ink-line py-2.5 first:border-t-0">
      <dt className="text-ink-mute">{label}</dt>
      <dd className="num text-right font-semibold">{children}</dd>
    </div>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="mt-3 px-1 text-[14px]">{children}</dl>;
}

/** Backstop's big amount input, with its unit as a coloured chip. */
export function BigInput({
  label,
  unit,
  value,
  onChange,
  max,
  invalid,
}: {
  label: string;
  unit: "MUSD" | "BTC" | "%" | "days";
  value: string;
  onChange: (v: string) => void;
  max?: { label: string; onClick: () => void };
  invalid?: boolean;
}) {
  const chip =
    unit === "MUSD" ? "bg-musd text-white" : unit === "BTC" ? "bg-btc text-ink" : "bg-ink text-page";
  return (
    <div
      className={`mt-4 rounded-2xl bg-page px-4 pb-3 pt-3.5 ring-1 transition-shadow focus-within:ring-2 ${
        invalid ? "ring-stop focus-within:ring-stop" : "ring-transparent focus-within:ring-musd"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[13px] font-semibold text-ink-mute">{label}</label>
        {max && (
          <button
            onClick={max.onClick}
            className="num rounded-full px-2 py-0.5 text-[12.5px] text-ink-mute transition-colors hover:bg-white hover:text-musd"
          >
            {max.label} <span className="font-semibold text-musd">Max</span>
          </button>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <input
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(",", ".");
            if (/^\d*\.?\d{0,18}$/.test(v)) onChange(v);
          }}
          className={`wide num w-full min-w-0 bg-transparent font-bold ${value.length > 9 ? "text-[24px]" : "text-[32px]"} leading-tight tracking-[-0.03em] text-ink outline-none placeholder:text-ink-faint`}
        />
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold ${chip}`}>{unit}</span>
      </div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-4 px-1 text-[12.5px] leading-snug text-ink-mute">{children}</p>;
}

export function Quiet({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[22px] bg-white py-12 text-center text-[15px] text-ink-mute ring-1 ring-ink/10 sm:rounded-[28px]">
      {children}
    </p>
  );
}

/**
 * A Trove as a bar: the BTC's value split into what's owed (ink) and what's
 * the holder's (MUSD blue), with the asking price marked on the equity.
 */
export function EquityBar({ value, debt, price, thin }: { value: bigint; debt: bigint; price?: bigint; thin?: boolean }) {
  if (value === 0n) return null;
  const owed = Math.min(100, Number((debt * 10_000n) / value) / 100);
  const ask = price !== undefined ? Math.min(100, owed + Number((price * 10_000n) / value) / 100) : undefined;
  return (
    <div className={`relative w-full overflow-hidden rounded-full bg-musd ${thin ? "h-1.5" : "h-3"}`} aria-hidden>
      <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${owed}%` }} />
      {ask !== undefined && <div className="absolute inset-y-0 w-[2px] bg-btc" style={{ left: `${ask}%` }} />}
    </div>
  );
}

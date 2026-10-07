import type { ReactNode } from "react";
import { explorerAddress, explorerTx, vaultAddress } from "@/lib/config";
import { short } from "@/lib/format";
import type { TxState } from "@/lib/tx";

/** A figure that may not have loaded. Holds its space instead of jumping. */
export function Figure({
  value,
  className = "",
  width = "4ch",
}: {
  value: ReactNode | undefined;
  className?: string;
  width?: string;
}) {
  if (value === undefined || value === "—") {
    // Before launch nothing is coming, so don't pretend it's loading.
    if (vaultAddress === null) return <span className={`opacity-40 ${className}`}>—</span>;
    return (
      <span
        aria-label="loading"
        className={`pending-figure inline-block h-[0.75em] align-baseline ${className}`}
        style={{ width }}
      />
    );
  }
  return <span className={`num ${className}`}>{value}</span>;
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  const href = explorerAddress(address);
  const text = label ?? short(address);
  if (!href) return <span className="num">{text}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={address} className="num link">
      {text}
    </a>
  );
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  const href = explorerTx(hash);
  const text = children ?? short(hash, 8, 6);
  if (!href) return <span className="num">{text}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={hash} className="num link">
      {text}
    </a>
  );
}

/** One line under an action that says what the transaction is doing. */
export function TxStatus({ state, tone = "dark" }: { state: TxState; tone?: "dark" | "light" }) {
  if (state.phase === "idle") return null;

  if (state.phase === "error") {
    return (
      <p
        role="alert"
        className={`mt-3 rounded-xl px-3 py-2.5 text-[13.5px] leading-snug ${
          tone === "light" ? "bg-white text-stop" : "bg-stop/10 text-stop"
        }`}
      >
        {state.message}
      </p>
    );
  }

  const text =
    state.phase === "signing"
      ? "confirm in your wallet"
      : state.phase === "pending"
        ? "waiting for the block"
        : "done";

  return (
    <p
      className={`mt-3 flex flex-wrap items-center gap-x-2 text-[13px] ${tone === "light" ? "text-white/80" : "text-ink-mute"}`}
      aria-live="polite"
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state.phase === "done" ? (tone === "light" ? "bg-white" : "bg-musd") : "animate-pulse bg-btc"
        }`}
      />
      <span>
        <b className={`font-semibold ${tone === "light" ? "text-white" : "text-ink"}`}>{state.label}</b> {text}
      </span>
      {"hash" in state && <TxLink hash={state.hash} />}
    </p>
  );
}

export function SectionHead({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-2 sm:mb-10">
      <h2 className="wide max-w-[20ch] text-[30px] font-bold leading-[1.02] tracking-[-0.03em] sm:text-[44px]">
        {title}
      </h2>
      {aside && <div className="max-w-[38ch] text-[15px] leading-snug text-ink-mute">{aside}</div>}
    </header>
  );
}

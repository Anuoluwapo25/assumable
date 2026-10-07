"use client";

import { useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useConnection, useReadContract, useWriteContract } from "wagmi";
import { chain, vaultAddress } from "@/lib/config";
import { musd, musdCompact } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useAccountState, vaultContract, type VaultState } from "@/lib/vault";
import { Figure, TxStatus } from "./primitives";
import { useMounted, WalletButton } from "./Wallet";

type Mode = "deposit" | "withdraw";

function parse(input: string) {
  if (!input || !/^\d*\.?\d*$/.test(input)) return undefined;
  try {
    const value = parseUnits(input, 18);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Trim a WAD to an input-friendly string without rounding it up. */
function toInput(value: bigint) {
  const [whole, frac = ""] = formatUnits(value, 18).split(".");
  const kept = frac.slice(0, 4).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
}

export function Desk({ vault }: { vault: VaultState }) {
  const mounted = useMounted();
  const { chainId } = useConnection();
  const account = useAccountState(vault.asset);
  const [mode, setMode] = useState<Mode>("deposit");
  const [input, setInput] = useState("");
  // Set when the amount came from the max button, so a full exit redeems every
  // share rather than leaving dust behind from rounding.
  const [max, setMax] = useState(false);

  const write = useWriteContract();
  const tx = useTx(() => {
    account.refetch();
    vault.refetch();
  });

  const amount = parse(input);
  const connected = mounted && !!account.address;
  const wrongChain = connected && chainId !== chain.id;
  const busy = tx.state.phase === "signing" || tx.state.phase === "pending";

  const preview = useReadContract({
    ...vaultContract,
    functionName: mode === "deposit" ? "previewDeposit" : "previewWithdraw",
    args: [amount ?? 0n],
    query: { enabled: !!amount && vault.deployed },
  });

  const available = mode === "deposit" ? account.musdBalance : account.position;
  const tooMuch = amount !== undefined && available !== undefined && amount > available;
  const needsApproval =
    mode === "deposit" && amount !== undefined && account.allowance !== undefined && account.allowance < amount;
  const paused = mode === "withdraw" && vault.withdrawalsAvailable === false;

  function switchMode(next: Mode) {
    setMode(next);
    setInput("");
    setMax(false);
    tx.reset();
  }

  function fillMax() {
    if (available === undefined) return;
    setInput(toInput(available));
    setMax(true);
  }

  async function submit() {
    if (!amount || !account.address || !vault.asset || !vaultAddress) return;
    const me = account.address;

    if (mode === "deposit") {
      if (needsApproval) {
        // Exact amount, not unlimited: the approval is spent by this deposit
        // and nothing is left standing afterwards.
        const ok = await tx.run("Approve MUSD", () =>
          write.mutateAsync({ address: vault.asset!, abi: erc20Abi, functionName: "approve", args: [vaultAddress!, amount] }),
        );
        if (!ok) return;
      }
      const ok = await tx.run("Deposit", () =>
        write.mutateAsync({ ...vaultContract, functionName: "deposit", args: [amount, me] }),
      );
      if (ok) setInput("");
      return;
    }

    const ok =
      max && account.shares
        ? await tx.run("Withdraw", () =>
            write.mutateAsync({ ...vaultContract, functionName: "redeem", args: [account.shares!, me, me] }),
          )
        : await tx.run("Withdraw", () =>
            write.mutateAsync({ ...vaultContract, functionName: "withdraw", args: [amount, me, me] }),
          );
    if (ok) {
      setInput("");
      setMax(false);
    }
  }

  let action: React.ReactNode;
  if (!vault.deployed) {
    action = <button className="btn-ink w-full" disabled>Opens at launch</button>;
  } else if (!connected || wrongChain) {
    action = <WalletButton className="w-full" />;
  } else {
    const label = busy
      ? tx.state.phase === "signing"
        ? "Confirm in wallet…"
        : "Waiting for the block…"
      : !amount
        ? "Enter an amount"
        : tooMuch
          ? mode === "deposit"
            ? "More than your wallet holds"
            : "More than your position"
          : paused
            ? "Withdrawals paused"
            : mode === "deposit"
              ? needsApproval
                ? "Approve, then deposit"
                : "Deposit"
              : "Withdraw";
    action = (
      <button className="btn-ink w-full py-3.5" disabled={!amount || tooMuch || paused || busy} onClick={submit}>
        {label}
      </button>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-[22px] bg-white p-4 ring-1 ring-ink/10 sm:rounded-[28px] sm:p-5">
      <div className="grid grid-cols-2 rounded-full bg-page p-1" role="tablist">
        {(["deposit", "withdraw"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => switchMode(m)}
            className={`rounded-full py-2.5 text-[14.5px] font-semibold capitalize transition-colors ${
              mode === m ? "bg-ink text-page" : "text-ink-mute hover:text-ink"
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {connected && (
        <div className="mt-5 flex items-end justify-between gap-4 px-1">
          <div>
            <p className="text-[13px] font-semibold text-ink-mute">Your position</p>
            <p className="wide num mt-1 text-[28px] font-bold leading-none tracking-[-0.03em]">
              <Figure value={musd(account.position)} width="6ch" />
              <span className="ml-1.5 text-[13px] font-semibold tracking-normal text-ink-mute">MUSD</span>
            </p>
          </div>
          <p className="num pb-0.5 text-right text-[13px] text-ink-mute">
            <Figure value={musd(account.shares)} width="5ch" /> bMUSD
          </p>
        </div>
      )}

      <div
        className={`mt-5 rounded-2xl bg-page px-4 pb-3 pt-3.5 ring-1 transition-shadow focus-within:ring-2 ${
          tooMuch ? "ring-stop focus-within:ring-stop" : "ring-transparent focus-within:ring-musd"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor="amount" className="text-[13px] font-semibold text-ink-mute">
            {mode === "deposit" ? "You deposit" : "You withdraw"}
          </label>
          {connected && available !== undefined && (
            <button
              onClick={fillMax}
              className="num rounded-full px-2 py-0.5 text-[12.5px] text-ink-mute transition-colors hover:bg-white hover:text-musd"
            >
              {musd(available)} <span className="font-semibold text-musd">Max</span>
            </button>
          )}
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={input}
            onChange={(e) => {
              const v = e.target.value.replace(",", ".");
              if (/^\d*\.?\d{0,18}$/.test(v)) {
                setInput(v);
                setMax(false);
              }
            }}
            className={`wide num w-full min-w-0 bg-transparent font-bold ${input.length > 9 ? "text-[26px]" : "text-[38px]"} leading-tight tracking-[-0.03em] text-ink outline-none placeholder:text-ink-faint`}
          />
          <span className="rounded-full bg-musd px-2.5 py-1 text-[12px] font-bold text-white">MUSD</span>
        </div>
      </div>

      <p className="num mt-2.5 h-5 px-1 text-[13px] text-ink-mute">
        {amount && preview.data !== undefined && (
          <>
            {mode === "deposit" ? "You get" : "Burns"}{" "}
            <b className="font-semibold text-ink">{musd(preview.data, 4)} bMUSD</b>
          </>
        )}
      </p>

      {vault.deployed && (
        <dl className="mt-3 space-y-0 px-1 text-[14px]">
          <Fact label="The vault holds">
            <Figure value={musdCompact(vault.totalAssets)} width="5ch" /> MUSD
          </Fact>
          <Fact label="Withdrawals">
            {vault.withdrawalsAvailable === undefined ? (
              <Figure value={undefined} />
            ) : vault.withdrawalsAvailable ? (
              "Open"
            ) : (
              <span className="text-stop">Paused</span>
            )}
          </Fact>
          <Fact label="Fees on your deposit">None</Fact>
        </dl>
      )}

      {paused && (
        <p className="mt-2 rounded-xl bg-stop/10 px-3 py-2.5 text-[13.5px] leading-snug text-ink-soft">
          <b className="font-semibold text-stop">Paused for now.</b> The pool holds withdrawals
          while a Trove is waiting to be liquidated. Your deposit is safe and still earning; this
          clears once that liquidation goes through.
        </p>
      )}

      <div className="mt-auto pt-4">{action}</div>
      <TxStatus state={tx.state} />

      <p className="mt-4 px-1 text-[12.5px] leading-snug text-ink-mute">
        {mode === "deposit"
          ? "Goes straight into the Stability Pool. No deposit or withdrawal fee."
          : "Comes out of the pool as MUSD, never BTC."}
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-ink-line py-2.5 first:border-t-0">
      <dt className="text-ink-mute">{label}</dt>
      <dd className="num font-semibold">{children}</dd>
    </div>
  );
}

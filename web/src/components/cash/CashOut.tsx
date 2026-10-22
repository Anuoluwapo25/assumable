"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError, isAddressEqual, parseAbi, type Hash } from "viem";
import { useConnection, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { cashOutModuleAbi, swapBridgeAdapterAbi, trovePositionsAbi } from "@/lib/abi";
import type { CashOutJson, Currency, ProviderInfo, QuoteJson } from "@/lib/cashout/api";
import { CASH_OUT_REVERTS, api, blockerMessage, btcAmount, dollars, money, usdToLocal } from "@/lib/cashout/client";
import { chain, cashOut, positionsAddress } from "@/lib/config";
import { hintsOrNone } from "@/lib/cashout/hints";
import { usePositions, type Position } from "@/lib/positions";
import { WalletButton, useMounted } from "../Wallet";
import { Health } from "./Health";
import { PayBack } from "./PayBack";
import { Timeline } from "./Timeline";

/** The module's ABI plus the errors its adapters and the pool router can raise, so reverts decode. */
const cashOutCallAbi = [
  ...cashOutModuleAbi,
  ...swapBridgeAdapterAbi.filter((x) => x.type === "error"),
  ...parseAbi(["error InsufficientOutputAmount()"]),
] as const;

type Destination = { kind: "bank" | "mobile_money"; institution: string; account: string; name: string };

type Phase =
  | { step: "form" }
  | { step: "working"; label: string }
  | { step: "tracking"; orderId: `0x${string}`; hash: Hash | null }
  | { step: "error"; message: string };

/**
 * The whole of Cash Out on one screen: how much, where to, what it costs, the
 * one safety sentence, one button, then the payout's progress. The words Trove,
 * MUSD, LTV, bridge, gas and swap never appear here.
 */
export function CashOut() {
  const mounted = useMounted();
  const { address, chainId } = useConnection();
  const providers = useQuery({ queryKey: ["cashout-providers"], queryFn: () => api<ProviderInfo[]>("/api/cashout/providers") });
  const provider = providers.data?.find((p) => p.available);
  const positions = usePositions();

  const mine = useMemo(
    () => (address ? (positions.data ?? []).filter((p) => p.active && isAddressEqual(p.owner, address)) : []),
    [positions.data, address],
  );
  const [loanId, setLoanId] = useState<bigint | null>(null);
  const loan = mine.find((p) => p.id === loanId) ?? mine.find((p) => !p.listing || p.listing.price === 0n) ?? mine[0] ?? null;

  const [fiat, setFiat] = useState("NGN");
  const currency: Currency | undefined = provider?.currencies.find((c) => c.code === fiat) ?? provider?.currencies[0];
  const [amount, setAmount] = useState("");
  const [dest, setDest] = useState<Destination>({ kind: "bank", institution: "", account: "", name: "" });
  const [phase, setPhase] = useState<Phase>({ step: "form" });

  const ready = mounted && !!address && chainId === chain.id;
  const debounced = useDebounced(amount.replace(/,/g, ""), 400);
  const listed = !!loan?.listing && loan.listing.price > 0n;

  const quote = useQuery({
    queryKey: ["cashout-quote", provider?.id, currency?.code, debounced, address, loan?.id.toString()],
    enabled: ready && !!provider && !!currency && /^\d+(\.\d+)?$/.test(debounced) && Number(debounced) > 0,
    refetchInterval: 20_000,
    queryFn: () =>
      api<QuoteJson>(
        `/api/quote?${new URLSearchParams({
          provider: provider!.id,
          fiat: currency!.code,
          amount: debounced,
          owner: address!,
          tokenId: (loan?.id ?? 0n).toString(),
        })}`,
      ),
  });

  const approved = useReadContract({
    address: positionsAddress ?? undefined,
    abi: trovePositionsAbi,
    functionName: "isApprovedForAll",
    args: address && cashOut.module ? [address, cashOut.module] : undefined,
    query: { enabled: !!address && !!cashOut.module && !!positionsAddress },
  });

  const client = usePublicClient();
  const write = useWriteContract();
  const destOk = dest.institution.trim() && /^[0-9+ ]{6,24}$/.test(dest.account) && dest.name.trim();
  const q = quote.data;
  const canCashOut = ready && q && !q.blocker && destOk && !listed && phase.step !== "working" && !!cashOut.module;

  async function run() {
    if (!q || !currency || !provider || !address) return;
    try {
      // One-time permission for loans that already exist; a first cash-out opens its own.
      if (loan && !approved.data) {
        setPhase({ step: "working", label: "One-time setup: confirm in your wallet" });
        const h = await write.mutateAsync({
          address: positionsAddress!,
          abi: trovePositionsAbi,
          functionName: "setApprovalForAll",
          args: [cashOut.module!, true],
        });
        await client!.waitForTransactionReceipt({ hash: h });
        await approved.refetch();
      }

      setPhase({ step: "working", label: "Locking in your price" });
      const res = await api<CashOutJson>("/api/cashout", {
        method: "POST",
        body: JSON.stringify({
          provider: provider.id,
          fiat: currency.code,
          amount: debounced,
          owner: address,
          tokenId: (loan?.id ?? 0n).toString(),
          destination: dest,
        }),
      });
      if (!res.call) {
        // The partner needs to check who you are before it gives a payout address.
        if (res.checkoutUrl) window.open(res.checkoutUrl, "_blank", "noopener");
        setPhase({ step: "tracking", orderId: res.orderId, hash: null });
        return;
      }

      const c = res.call;
      const order = {
        ...c.order,
        tokenId: BigInt(c.order.tokenId),
        musdAmount: BigInt(c.order.musdAmount),
        minOut: BigInt(c.order.minOut),
        expiry: BigInt(c.order.expiry),
      };
      const [upper, lower] = await hintsOrNone(client!, { coll: BigInt(res.quote.newColl), debt: BigInt(res.quote.newDebt) });

      setPhase({ step: "working", label: "Confirm in your wallet" });
      const hash =
        c.fn === "cashOut"
          ? await write.mutateAsync({
              address: cashOut.module!,
              abi: cashOutCallAbi,
              functionName: "cashOut",
              args: [order, c.signature, upper, lower],
              value: BigInt(c.value),
            })
          : await write.mutateAsync({
              address: cashOut.module!,
              abi: cashOutCallAbi,
              functionName: "openAndCashOut",
              args: [order, c.signature, BigInt(c.debt), upper, lower],
              value: BigInt(c.value),
            });

      setPhase({ step: "tracking", orderId: res.orderId, hash });
      await client!.waitForTransactionReceipt({ hash });
      await api(`/api/order/${res.orderId}/tx`, { method: "POST", body: JSON.stringify({ hash }) }).catch(() => {});
      void positions.refetch();
    } catch (e) {
      setPhase({ step: "error", message: explainCashOut(e) });
    }
  }

  if (!mounted || !address || chainId !== chain.id) {
    return (
      <Card>
        <p className="text-[17px] leading-snug text-ink-soft">Connect your wallet to see what your Bitcoin can cash out.</p>
        <WalletButton className="mt-5 w-full" />
        {mounted && !hasInjectedWallet() && (
          <p role="alert" className="mt-3 rounded-xl bg-btc-pale px-3 py-2.5 text-[14px] leading-snug text-ink">
            No wallet found in this browser. Install a browser wallet such as MetaMask, then reload this page.
          </p>
        )}
      </Card>
    );
  }

  if (!cashOut.module) {
    return <Card><p className="text-ink-soft">Cash Out isn&apos;t live on {chain.name} yet.</p></Card>;
  }

  if (phase.step === "tracking") {
    return (
      <Card>
        <Timeline orderId={phase.orderId} hash={phase.hash} currency={currency} />
        <button className="btn-outline mt-6 w-full" onClick={() => { setPhase({ step: "form" }); setAmount(""); }}>
          Cash out again
        </button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {provider?.mock && <DemoBanner />}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canCashOut) void run();
          }}
          noValidate
        >
          {mine.length > 1 && (
            <Field label="Borrow against">
              {(id) => (
                <select id={id} className="input" value={loan?.id.toString()} onChange={(e) => setLoanId(BigInt(e.target.value))}>
                  {mine.map((p) => (
                    <option key={p.id.toString()} value={p.id.toString()}>
                      Loan #{p.id.toString()} · {btcAmount(p.coll, 4)} BTC
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}

          <Field label="You receive">
            {(id) => (
              <div className="flex gap-2">
                <select
                  aria-label="Currency"
                  className="input !w-[96px] shrink-0"
                  value={currency?.code ?? fiat}
                  onChange={(e) => setFiat(e.target.value)}
                >
                  {(provider?.currencies ?? []).map((c) => (
                    <option key={c.code} value={c.code}>{c.code}</option>
                  ))}
                </select>
                <input
                  id={id}
                  className="input wide num text-[28px] font-extrabold tracking-[-0.03em]"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={currency ? `${currency.symbol}0` : "0"}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
                />
              </div>
            )}
          </Field>

          <fieldset className="mt-5">
            <legend className="text-[13px] font-semibold text-ink-soft">Send it to</legend>
            <div className="mt-2 grid grid-cols-2 rounded-full bg-page p-1" role="radiogroup" aria-label="Payout method">
              {(currency?.destinations ?? ["bank"]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={dest.kind === k}
                  onClick={() => setDest({ ...dest, kind: k })}
                  className={`rounded-full py-2.5 text-[14px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-musd ${
                    dest.kind === k ? "bg-ink text-page" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {k === "bank" ? "Bank account" : "Mobile money"}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={dest.kind === "bank" ? "Bank" : "Network"} compact>
                {(id) => (
                  <input id={id} className="input" autoComplete="off" placeholder={dest.kind === "bank" ? "e.g. GTBank" : "e.g. OPay, M-Pesa"}
                    value={dest.institution} onChange={(e) => setDest({ ...dest, institution: e.target.value })} />
                )}
              </Field>
              <Field label={dest.kind === "bank" ? "Account number" : "Phone number"} compact>
                {(id) => (
                  <input id={id} className="input num" inputMode="tel" autoComplete="off"
                    value={dest.account} onChange={(e) => setDest({ ...dest, account: e.target.value.replace(/[^\d+ ]/g, "") })} />
                )}
              </Field>
              <Field label="Name on the account" compact className="sm:col-span-2">
                {(id) => (
                  <input id={id} className="input" autoComplete="name"
                    value={dest.name} onChange={(e) => setDest({ ...dest, name: e.target.value })} />
                )}
              </Field>
            </div>
          </fieldset>

          <QuoteSummary quote={q} loading={quote.isFetching && !q} error={quote.error} currency={currency} listed={listed} loan={loan} />

          <button type="submit" className="btn-ink mt-5 w-full !py-4 text-[17px]" disabled={!canCashOut}>
            {phase.step === "working" ? phase.label : q && !q.blocker && currency ? `Cash out ${money(q.fiatAmount, currency)}` : "Cash out"}
          </button>
          {phase.step === "error" && (
            <p role="alert" className="mt-3 rounded-xl bg-stop/10 px-3 py-2.5 text-[14px] leading-snug text-stop">{phase.message}</p>
          )}
          {!destOk && q && !q.blocker && (
            <p className="mt-2 text-center text-[13px] text-ink-soft">Add where to send the money to continue.</p>
          )}
        </form>
      </Card>

      {loan && currency && (
        <>
          <Health loan={loan} />
          <PayBack loan={loan} currency={currency} onDone={() => void positions.refetch()} />
        </>
      )}
    </div>
  );
}

function QuoteSummary({
  quote: q,
  loading,
  error,
  currency,
  listed,
  loan,
}: {
  quote: QuoteJson | undefined;
  loading: boolean;
  error: Error | null;
  currency: Currency | undefined;
  listed: boolean;
  loan: Position | null;
}) {
  const [open, setOpen] = useState(false);
  if (listed && loan) {
    return (
      <Notice tone="warn">
        This loan is up for sale, so it can&apos;t be borrowed against.{" "}
        <Link className="link" href={`/p/${loan.id}`}>Take it off sale</Link> to cash out.
      </Notice>
    );
  }
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  if (loading) return <p className="mt-5 text-[14px] text-ink-soft" aria-live="polite">Working out your price…</p>;
  if (!q || !currency) return null;
  if (q.blocker) return <Notice tone="warn">{blockerMessage(q, currency)}</Notice>;

  const local = (usd: string) => money(usdToLocal(usd, q), currency);
  // Two routes, one way of describing them: exchange and transfer costs are
  // shown together, so nothing here hints at swaps or bridges.
  const rows: [string, string][] = [
    ["Payout fee", q.fees.provider],
    ["Exchange and transfer", (BigInt(q.fees.conversion) + BigInt(q.fees.bridge)).toString()],
    ["Loan fee (one-off)", q.fees.borrowing],
  ].filter(([, v]) => BigInt(v) > 0n) as [string, string][];

  return (
    <div className="mt-5 space-y-3" aria-live="polite">
      <dl className="rounded-2xl bg-page px-4 py-3 text-[14.5px]">
        <div className="flex justify-between gap-4 py-1">
          <dt className="text-ink-soft">They receive</dt>
          <dd className="num font-semibold">{money(q.fiatAmount, currency)}</dd>
        </div>
        <div className="flex justify-between gap-4 py-1">
          <dt className="text-ink-soft">
            <button type="button" className="link text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              Total cost
            </button>
          </dt>
          <dd className="num font-semibold">
            {local(q.totalFeesUsd)} <span className="font-normal text-ink-soft">({dollars(q.totalFeesUsd)})</span>
          </dd>
        </div>
        {open && rows.map(([label, v]) => (
          <div key={label} className="flex justify-between gap-4 py-0.5 pl-3 text-[13.5px] text-ink-soft">
            <dt>{label}</dt>
            <dd className="num">{local(v)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 py-1">
          <dt className="text-ink-soft">Arrives</dt>
          <dd className="text-right">{q.arrival}</dd>
        </div>
        {BigInt(q.btcToAdd) > 0n && (
          <div className="flex justify-between gap-4 py-1">
            <dt className="text-ink-soft">Bitcoin held as security</dt>
            <dd className="num font-semibold">{btcAmount(q.btcToAdd, 5)} BTC</dd>
          </div>
        )}
      </dl>
      {BigInt(q.surplusMusd) > 0n && (
        <p className="text-[13.5px] leading-snug text-ink-soft">
          The smallest first loan is about {dollars(q.musdBorrowed)}, so the other {dollars(q.surplusMusd)} stays in your wallet,
          ready for paying back whenever you like.
        </p>
      )}
      <div className="rounded-2xl bg-musd-mist px-4 py-3 text-musd-deep">
        <p className="text-[12px] font-semibold uppercase tracking-[0.04em] opacity-80">After this cash-out</p>
        <p className="mt-0.5 text-[15px] font-semibold leading-snug">{q.sentence}</p>
      </div>
      <p className="text-[13px] leading-snug text-ink-soft">Your Bitcoin stays yours. You can pay back any time.</p>
    </div>
  );
}

function DemoBanner() {
  return (
    <p className="rounded-2xl bg-btc-pale px-4 py-3 text-[14px] leading-snug text-ink">
      <b>Demo payout.</b> The loan is real on {chain.name}, but no money reaches a bank or mobile wallet, and exchange rates are
      sample values.
    </p>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[22px] bg-white p-5 ring-1 ring-ink/10 sm:rounded-[28px] sm:p-7">{children}</div>;
}

export function Notice({ tone, children }: { tone: "warn" | "stop"; children: React.ReactNode }) {
  return (
    <p role={tone === "stop" ? "alert" : undefined} aria-live="polite"
      className={`mt-5 rounded-2xl px-4 py-3 text-[14.5px] leading-snug ${tone === "stop" ? "bg-stop/10 text-stop" : "bg-btc-pale text-ink"}`}>
      {children}
    </p>
  );
}

export function Field({
  label,
  children,
  compact,
  className = "",
}: {
  label: string;
  children: (id: string) => React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`${compact ? "" : "mt-5 first:mt-0"} ${className}`}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-soft">{label}</label>
      <div className="mt-1.5">{children(id)}</div>
    </div>
  );
}

/** Whether a browser wallet extension is present: without one, Connect can't do anything. */
function hasInjectedWallet() {
  return typeof window !== "undefined" && "ethereum" in window && !!(window as { ethereum?: unknown }).ethereum;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function explainCashOut(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) return "You declined in your wallet. Nothing happened.";
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    const name = revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
    if (name && CASH_OUT_REVERTS[name]) return CASH_OUT_REVERTS[name];
    if (/insufficient funds/i.test(error.message)) return "Your wallet needs a little more Bitcoin to cover this.";
  }
  // Never show raw contract or wallet errors here: they talk about Troves and gas.
  console.error(error);
  return "That didn't go through, and nothing was taken. Please try again in a moment.";
}

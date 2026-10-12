"use client";

import { isAddressEqual, type Address } from "viem";
import { useConnection, useReadContract, useWriteContract } from "wagmi";
import { troveAccountAbi, troveMarketAbi, trovePositionsAbi } from "@/lib/abi";
import { chain, marketAddress, positionsAddress } from "@/lib/config";
import { btc, musd, ratio, short } from "@/lib/format";
import { useMarketContext, useOffers, usePositions, type Position } from "@/lib/positions";
import { WAD, liquidationPrice, rateLabel, toneOf } from "@/lib/risk";
import { useTx } from "@/lib/tx";
import { discountLabel } from "./Board";
import { EquityBar, Quiet } from "./desk";
import { AddressLink, Figure, TxStatus } from "./primitives";
import { HolderDesk, TradeDesk } from "./Trade";
import { useMounted } from "./Wallet";

const TONE = { safe: "text-musd", warn: "text-btc-deep", danger: "text-stop" } as const;

export function PositionView({ id }: { id: bigint }) {
  const positions = usePositions();
  const { price, currentRate } = useMarketContext();
  const mounted = useMounted();
  const { address, chainId } = useConnection();
  const p = positions.data?.find((x) => x.id === id);
  const refresh = () => void positions.refetch();

  if (positions.isLoading) return <Wrap><Quiet>Reading Trove #{id.toString()}…</Quiet></Wrap>;
  if (!p) return <Wrap><Quiet>There is no Trove #{id.toString()}.</Quiet></Wrap>;

  const isHolder = mounted && !!address && chainId === chain.id && isAddressEqual(address, p.owner);
  const listed = p.listing && p.listing.price > 0n ? p.listing : null;

  return (
    <Wrap>
      <div className="grid gap-8 pb-10 pt-8 sm:pt-14 lg:grid-cols-12 lg:items-end lg:pb-12">
        <div className="animate-rise lg:col-span-8">
          <p className="text-[13px] font-semibold text-ink-mute">
            Held by {isHolder ? <span className="text-musd">you</span> : <AddressLink address={p.owner} />}
          </p>
          <h1 className="wide mt-2 text-[42px] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-[68px]">
            Trove <span className="text-musd">#{p.id.toString()}</span>
          </h1>
          <p className="mt-4 max-w-[56ch] text-[17px] leading-[1.55] text-ink-soft">
            {!p.active
              ? "Closed, liquidated or fully redeemed. Any leftover collateral goes to whoever holds the NFT."
              : listed
                ? `For sale${listed.pricing === "equity" ? ` at ${(Number(listed.value) / 100).toFixed(1)}% of live equity` : " at a fixed price"}. The buyer takes over ${btc(p.coll, 4)} BTC and ${musd(p.debt, 0)} MUSD of debt at ${rateLabel(p.rate)}.`
                : `${btc(p.coll, 4)} BTC against ${musd(p.debt, 0)} MUSD of debt at ${rateLabel(p.rate)}. Not listed; anyone can still make an offer.`}
          </p>
        </div>
        <div className="animate-rise lg:col-span-4 lg:pb-1" style={{ animationDelay: "80ms" }}>
          <p className="text-[13px] font-semibold text-ink-mute">{listed ? "Price" : "Equity"}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <Figure
              value={musd(listed ? listed.price : p.equity, 0)}
              className="wide text-[56px] font-extrabold leading-none tracking-[-0.045em] sm:text-[64px]"
            />
            <span className="text-[15px] font-semibold text-ink-mute">MUSD</span>
          </p>
          {listed && (
            <p className="mt-2 text-[14px] text-ink-mute">
              Equity {musd(p.equity, 0)} MUSD · <span className="font-semibold text-musd">{discountLabel(p)}</span>
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="grid gap-4 lg:col-span-8 lg:gap-5">
          <Anatomy p={p} price={price} currentRate={currentRate} />
          <Offers p={p} isHolder={isHolder} onDone={refresh} />
        </div>
        <div className="lg:col-span-4">
          {!p.active ? (
            <ClaimSurplus account={p.account} onDone={refresh} />
          ) : isHolder ? (
            <HolderDesk p={p} price={price} onDone={refresh} />
          ) : (
            <TradeDesk p={p} price={price} currentRate={currentRate} onDone={refresh} />
          )}
        </div>
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-[1240px] px-4 pb-8 sm:px-8">{children}</section>;
}

/** The Trove laid open: its BTC value split into debt and equity, and the numbers around it. */
function Anatomy({ p, price, currentRate }: { p: Position; price?: bigint; currentRate?: number }) {
  const value = price ? (p.coll * price) / WAD : 0n;
  const lp = liquidationPrice(p);
  const drop = price && price > lp ? ((price - lp) * WAD) / price : undefined;
  const listed = p.listing && p.listing.price > 0n ? p.listing : null;

  return (
    <div className="rounded-[22px] bg-white p-5 ring-1 ring-ink/10 sm:rounded-[28px] sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Label title="Debt" tone="text-ink" value={`${musd(p.debt, 0)}`} note="MUSD the owner owes" />
        <Label title="Equity" tone="text-musd" value={`${musd(p.equity, 0)}`} note="BTC value minus debt" right />
      </div>
      <div className="mt-5">
        <EquityBar value={value} debt={p.debt} price={listed?.price} />
        <div className="mt-2 flex justify-between text-[12.5px] text-ink-mute">
          <span>
            {btc(p.coll, 4)} BTC worth <span className="num">{musd(value, 0)}</span> MUSD
          </span>
          {listed && (
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-[2px] bg-btc" /> asking price
            </span>
          )}
        </div>
      </div>

      <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-ink-line pt-6 text-[14px] sm:grid-cols-4">
        <Stat label="Collateral ratio" value={<span className={TONE[toneOf(p.icr)]}>{ratio(p.icr)}</span>} note="liquidation below 110%" />
        <Stat label="Liquidated at" value={`$${musd(lp, 0)}`} note={drop !== undefined ? `BTC −${ratio(drop, 1)} from here` : undefined} />
        <Stat
          label="Interest rate"
          value={rateLabel(p.rate)}
          note={currentRate !== undefined ? (p.rate < currentRate ? `locked; new pay ${rateLabel(currentRate)}` : `new Troves pay ${rateLabel(currentRate)}`) : undefined}
        />
        <Stat label="Trove account" value={<AddressLink address={p.account} />} note="the borrower of record" />
      </dl>
    </div>
  );
}

function Label({ title, tone, value, note, right }: { title: string; tone: string; value: string; note: string; right?: boolean }) {
  return (
    <div className={right ? "text-right" : ""}>
      <p className={`text-[13px] font-semibold ${tone}`}>{title}</p>
      <p className="wide num mt-1 text-[30px] font-bold leading-none tracking-[-0.02em] sm:text-[38px]">{value}</p>
      <p className="mt-1.5 text-[13px] text-ink-mute">{note}</p>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div>
      <dt className="text-[12.5px] text-ink-mute">{label}</dt>
      <dd className="num mt-0.5 font-semibold">{value}</dd>
      {note && <dd className="text-[12px] text-ink-mute">{note}</dd>}
    </div>
  );
}

function Offers({ p, isHolder, onDone }: { p: Position; isHolder: boolean; onDone: () => void }) {
  const offers = useOffers(p.id);
  const write = useWriteContract();
  const approval = useReadContract({
    address: positionsAddress!,
    abi: trovePositionsAbi,
    functionName: "isApprovedForAll",
    args: [p.owner, marketAddress!],
    query: { enabled: isHolder },
  });
  const tx = useTx(() => {
    onDone();
    void offers.refetch();
  });

  async function accept(buyer: Address, amount: bigint) {
    if (!approval.data) {
      const ok = await tx.run("Approve market", () =>
        write.mutateAsync({
          address: positionsAddress!,
          abi: trovePositionsAbi,
          functionName: "setApprovalForAll",
          args: [marketAddress!, true],
        }),
      );
      void approval.refetch();
      if (!ok) return;
    }
    await tx.run("Accept offer", () =>
      write.mutateAsync({ address: marketAddress!, abi: troveMarketAbi, functionName: "acceptOffer", args: [p.id, buyer, amount] }),
    );
  }

  return (
    <div className="overflow-hidden rounded-[22px] bg-white ring-1 ring-ink/10 sm:rounded-[28px]">
      <div className="flex items-baseline justify-between border-b border-ink-line px-5 py-4 sm:px-7">
        <h2 className="wide text-[20px] font-bold tracking-[-0.02em]">Offers</h2>
        <span className="text-[13px] text-ink-mute">MUSD in escrow, highest first</span>
      </div>
      {!offers.data?.length ? (
        <p className="px-5 py-8 text-center text-[14.5px] text-ink-mute sm:px-7">
          {isHolder ? "No offers yet. Anyone can bid on your Trove, listed or not." : "No offers yet. Be the first."}
        </p>
      ) : (
        <table className="narrow w-full border-collapse text-left">
          <tbody className="whitespace-nowrap text-[15px]">
            {offers.data.map((o) => {
              const fits = p.debt <= o.maxDebt && p.coll >= o.minColl;
              return (
                <tr key={o.buyer} className="border-b border-ink-line/70 last:border-b-0">
                  <td className="py-3.5 pl-5 pr-4 sm:pl-7">
                    <span className="num font-bold">{musd(o.amount, 0)} MUSD</span>
                    {p.equity > 0n && (
                      <span className="num ml-2 text-[12.5px] text-ink-mute">
                        {(Number((o.amount * 10_000n) / p.equity) / 100).toFixed(1)}% of equity
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 pr-4 text-ink-soft">
                    from {short(o.buyer)}
                    <span className="ml-2 text-[12.5px] text-ink-mute">until {new Date(Number(o.expiry) * 1000).toLocaleDateString()}</span>
                  </td>
                  <td className="py-3.5 pr-5 text-right sm:pr-7">
                    {!fits ? (
                      <span className="text-[13px] text-stop">Trove changed; can&apos;t settle</span>
                    ) : isHolder ? (
                      <button className="btn-ink !px-4 !py-2 text-[13.5px]" disabled={tx.state.phase === "signing" || tx.state.phase === "pending"} onClick={() => accept(o.buyer, o.amount)}>
                        Accept
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {tx.state.phase !== "idle" && <div className="px-5 pb-4 sm:px-7"><TxStatus state={tx.state} /></div>}
    </div>
  );
}

function ClaimSurplus({ account, onDone }: { account: Address; onDone: () => void }) {
  const write = useWriteContract();
  const tx = useTx(onDone);
  return (
    <div className="rounded-[22px] bg-white p-5 ring-1 ring-ink/10 sm:rounded-[28px]">
      <p className="text-[14.5px] text-ink-soft">
        If a redemption left collateral over, the NFT holder can claim it.
      </p>
      <button
        className="btn-outline mt-4 w-full"
        disabled={tx.state.phase === "signing" || tx.state.phase === "pending"}
        onClick={() => tx.run("Claim collateral", () => write.mutateAsync({ address: account, abi: troveAccountAbi, functionName: "claimCollateral" }))}
      >
        Claim leftover collateral
      </button>
      <TxStatus state={tx.state} />
    </div>
  );
}

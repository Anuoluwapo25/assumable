"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi, formatUnits, isAddressEqual, type Address } from "viem";
import { useBalance, useConnection, useReadContract, useWriteContract } from "wagmi";
import { troveAccountAbi, troveMarketAbi, trovePositionsAbi } from "@/lib/abi";
import { chain, marketAddress, musdContracts as m, positionsAddress } from "@/lib/config";
import { btc, musd, ratio } from "@/lib/format";
import { useOffers, type Position } from "@/lib/positions";
import { GAS_COMPENSATION, WAD, icrOf, liquidationPrice, rateLabel } from "@/lib/risk";
import { useTx } from "@/lib/tx";
import { discountLabel } from "./Board";
import { BigInput, DeskShell, Fact, Facts, Note } from "./desk";
import { parseAmount } from "./fields";
import { TxStatus } from "./primitives";
import { WalletButton, useMounted } from "./Wallet";

const ZERO = "0x0000000000000000000000000000000000000000" as const;
type Run = ReturnType<typeof useTx>["run"];

const busy = (tx: ReturnType<typeof useTx>) => tx.state.phase === "signing" || tx.state.phase === "pending";
const busyLabel = (tx: ReturnType<typeof useTx>) =>
  tx.state.phase === "signing" ? "Confirm in wallet…" : "Waiting for the block…";

const toInput = (v: bigint, digits = 2) => {
  const [whole, frac = ""] = formatUnits(v, 18).split(".");
  const kept = frac.slice(0, digits).replace(/0+$/, "");
  return kept ? `${whole}.${kept}` : whole;
};
const expiryIn = (days: string, fallback: number) =>
  BigInt(Math.floor(Date.now() / 1000) + Math.max(1, Number(days) || fallback) * 86_400);

function useConnected() {
  const mounted = useMounted();
  const { address, chainId } = useConnection();
  return { address, ok: mounted && !!address && chainId === chain.id };
}

/** Approves `spender` for MUSD only when the allowance falls short. */
function useMusd(owner: Address | undefined, spender: Address | null) {
  const allowance = useReadContract({
    address: m.musd,
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner ?? ZERO, spender ?? ZERO],
    query: { enabled: !!owner && spender !== null },
  });
  const balance = useReadContract({
    address: m.musd,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner ?? ZERO],
    query: { enabled: !!owner },
  });
  const write = useWriteContract();
  return {
    balance: balance.data,
    refetch: () => {
      void allowance.refetch();
      void balance.refetch();
    },
    async ensure(run: Run, amount: bigint) {
      if ((allowance.data ?? 0n) >= amount) return true;
      // Exact amount, not unlimited: nothing is left standing afterwards.
      const ok = await run("Approve MUSD", () =>
        write.mutateAsync({ address: m.musd, abi: erc20Abi, functionName: "approve", args: [spender!, amount] }),
      );
      void allowance.refetch();
      return ok;
    },
  };
}

/** The Trove's numbers, as the desk's fact list. */
function TroveFacts({ p, price, currentRate }: { p: Position; price?: bigint; currentRate?: number }) {
  const lp = liquidationPrice(p);
  return (
    <Facts>
      <Fact label="Collateral">{btc(p.coll, 4)} BTC</Fact>
      <Fact label="Debt you take on">{musd(p.debt, 0)} MUSD</Fact>
      <Fact label="Collateral ratio">{ratio(p.icr)}</Fact>
      <Fact label="Liquidated at">
        ${musd(lp, 0)}
        {price && price > lp && (
          <span className="ml-1 font-normal text-ink-mute">(BTC −{ratio(((price - lp) * WAD) / price, 0)})</span>
        )}
      </Fact>
      <Fact label="Interest rate">
        {rateLabel(p.rate)}
        {currentRate !== undefined && p.rate < currentRate && (
          <span className="ml-1 font-normal text-musd">vs {rateLabel(currentRate)} new</span>
        )}
      </Fact>
    </Facts>
  );
}

// ===========================================================================
// Buyers
// ===========================================================================

export function TradeDesk({
  p,
  price,
  currentRate,
  onDone,
}: {
  p: Position | undefined;
  price?: bigint;
  currentRate?: number;
  onDone: () => void;
}) {
  const listed = !!p?.listing && p.listing.price > 0n;
  const [tab, setTab] = useState<"buy" | "offer">("buy");
  const tabs = listed
    ? ([
        { id: "buy", label: "Buy" },
        { id: "offer", label: "Make offer" },
      ] as const)
    : ([{ id: "offer", label: "Make offer" }] as const);
  const active = listed ? tab : "offer";

  if (!p) {
    return (
      <DeskShell tabs={[{ id: "buy", label: "Buy" }]} active="buy" onTab={() => {}}>
        <div className="grid flex-1 place-items-center py-16 text-center text-[14.5px] text-ink-mute">
          Pick a Trove on the board.
        </div>
      </DeskShell>
    );
  }

  return (
    <DeskShell tabs={tabs} active={active} onTab={setTab}>
      <div className="mt-5 flex items-end justify-between gap-4 px-1">
        <div>
          <p className="text-[13px] font-semibold text-ink-mute">
            <Link href={`/p/${p.id}`} className="hover:text-musd">Trove #{p.id.toString()} →</Link>
          </p>
          <p className="wide num mt-1 text-[30px] font-bold leading-none tracking-[-0.03em]">
            {musd(listed ? p.listing!.price : p.equity, 0)}
            <span className="ml-1.5 text-[13px] font-semibold tracking-normal text-ink-mute">MUSD</span>
          </p>
        </div>
        <p className="num pb-0.5 text-right text-[13px] text-ink-mute">
          {listed ? (
            <>
              equity {musd(p.equity, 0)}
              <br />
              <span className="text-musd">{discountLabel(p)}</span>
            </>
          ) : (
            "equity, not listed"
          )}
        </p>
      </div>
      <TroveFacts p={p} price={price} currentRate={currentRate} />
      {active === "buy" ? <Buy p={p} onDone={onDone} /> : <Offer p={p} onDone={onDone} />}
    </DeskShell>
  );
}

function Buy({ p, onDone }: { p: Position; onDone: () => void }) {
  const { address, ok } = useConnected();
  const listing = p.listing!;
  const funds = useMusd(address, marketAddress);
  const write = useWriteContract();
  const tx = useTx(() => {
    funds.refetch();
    onDone();
  });
  // Equity prices move with BTC until the block lands: allow 1% drift.
  const maxPrice = listing.pricing === "equity" ? (listing.price * 101n) / 100n : listing.price;
  const own = address && isAddressEqual(address, p.owner);
  const short = funds.balance !== undefined && funds.balance < listing.price;

  async function buy() {
    if (!(await funds.ensure(tx.run, maxPrice))) return;
    await tx.run("Buy", () =>
      write.mutateAsync({
        address: marketAddress!,
        abi: troveMarketAbi,
        functionName: "buy",
        // Exactly the Trove on screen, or nothing.
        args: [p.id, maxPrice, p.debt, p.coll],
      }),
    );
  }

  return (
    <>
      <div className="mt-auto pt-4">
        {!ok ? (
          <WalletButton className="w-full" />
        ) : (
          <button className="btn-ink w-full py-3.5" disabled={!!own || short || busy(tx)} onClick={buy}>
            {busy(tx) ? busyLabel(tx) : own ? "This is your Trove" : short ? "Not enough MUSD" : `Buy for ${musd(listing.price, 0)} MUSD`}
          </button>
        )}
      </div>
      <TxStatus state={tx.state} />
      <Note>
        The BTC, the debt and the {rateLabel(p.rate)} rate become yours in one transaction. If the seller
        weakens the Trove before it lands, nothing happens.
      </Note>
    </>
  );
}

function Offer({ p, onDone }: { p: Position; onDone: () => void }) {
  const { address, ok } = useConnected();
  const offers = useOffers(p.id);
  const mine = address ? offers.data?.find((o) => isAddressEqual(o.buyer, address)) : undefined;
  const [input, setInput] = useState("");
  const amount = parseAmount(input);
  const funds = useMusd(address, marketAddress);
  const write = useWriteContract();
  const tx = useTx(() => {
    funds.refetch();
    void offers.refetch();
    onDone();
  });
  const extra = amount ? (mine && amount <= mine.amount ? 0n : amount - (mine?.amount ?? 0n)) : 0n;
  const short = funds.balance !== undefined && extra > funds.balance;
  const own = address && isAddressEqual(address, p.owner);

  async function offer() {
    if (!amount) return;
    if (extra > 0n && !(await funds.ensure(tx.run, extra))) return;
    await tx.run(mine ? "Update offer" : "Offer", () =>
      write.mutateAsync({
        address: marketAddress!,
        abi: troveMarketAbi,
        functionName: "makeOffer",
        args: [p.id, amount, p.debt, p.coll, expiryIn("7", 7)],
      }),
    );
  }

  return (
    <>
      <BigInput label={mine ? `Your offer: ${musd(mine.amount, 0)} MUSD` : "You offer"} unit="MUSD" value={input} onChange={setInput} invalid={short} />
      <div className="mt-auto pt-4">
        {!ok ? (
          <WalletButton className="w-full" />
        ) : (
          <div className="flex gap-2">
            <button className="btn-ink flex-1 py-3.5" disabled={!amount || short || !!own || busy(tx)} onClick={offer}>
              {busy(tx) ? busyLabel(tx) : own ? "This is your Trove" : short ? "Not enough MUSD" : mine ? "Update offer" : "Escrow offer"}
            </button>
            {mine && (
              <button
                className="btn-outline"
                disabled={busy(tx)}
                onClick={() =>
                  tx.run("Cancel offer", () =>
                    write.mutateAsync({ address: marketAddress!, abi: troveMarketAbi, functionName: "cancelOffer", args: [p.id] }),
                  )
                }
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
      <TxStatus state={tx.state} />
      <Note>
        Held in escrow for 7 days, refundable any time. It only settles if the Trove still has at most{" "}
        {musd(p.debt, 0)} MUSD debt and at least {btc(p.coll, 4)} BTC.
      </Note>
    </>
  );
}

// ===========================================================================
// Holders
// ===========================================================================

export function HolderDesk({ p, price, onDone }: { p: Position; price?: bigint; onDone: () => void }) {
  const [tab, setTab] = useState<"sell" | "manage">("sell");
  return (
    <DeskShell
      tabs={[
        { id: "sell", label: p.listing && p.listing.price > 0n ? "Listing" : "Sell" },
        { id: "manage", label: "Manage" },
      ] as const}
      active={tab}
      onTab={setTab}
    >
      {tab === "sell" ? <Sell p={p} onDone={onDone} /> : <Manage p={p} price={price} onDone={onDone} />}
    </DeskShell>
  );
}

function useMarketApproval(owner: Address) {
  const approved = useReadContract({
    address: positionsAddress!,
    abi: trovePositionsAbi,
    functionName: "isApprovedForAll",
    args: [owner, marketAddress ?? ZERO],
  });
  const write = useWriteContract();
  return {
    approved: approved.data,
    async ensure(run: Run) {
      if (approved.data) return true;
      const ok = await run("Approve market", () =>
        write.mutateAsync({ address: positionsAddress!, abi: trovePositionsAbi, functionName: "setApprovalForAll", args: [marketAddress!, true] }),
      );
      void approved.refetch();
      return ok;
    },
  };
}

function Sell({ p, onDone }: { p: Position; onDone: () => void }) {
  const [mode, setMode] = useState<"equity" | "fixed">("equity");
  const [share, setShare] = useState("97");
  const [fixed, setFixed] = useState(() => toInput(p.equity, 0));
  const [floor, setFloor] = useState("");
  const approval = useMarketApproval(p.owner);
  const write = useWriteContract();
  const tx = useTx(onDone);
  const listing = p.listing && p.listing.price > 0n ? p.listing : null;

  const shareBps = Math.round(Number(share || 0) * 100);
  const fixedAmount = parseAmount(fixed);
  const floorAmount = parseAmount(floor) ?? 0n;
  const valid = mode === "equity" ? shareBps > 0 && shareBps <= 20_000 : fixedAmount !== null;
  const raw = mode === "equity" ? (p.equity * BigInt(shareBps)) / 10_000n : (fixedAmount ?? 0n);
  const preview = mode === "equity" && raw < floorAmount ? floorAmount : raw;

  async function list() {
    if (!valid || !(await approval.ensure(tx.run))) return;
    await tx.run(listing ? "Update listing" : "List", () =>
      write.mutateAsync({
        address: marketAddress!,
        abi: troveMarketAbi,
        functionName: "list",
        args: [p.id, mode === "equity" ? 1 : 0, mode === "equity" ? BigInt(shareBps) : fixedAmount!, mode === "equity" ? floorAmount : 0n, expiryIn("14", 14)],
      }),
    );
  }

  return (
    <>
      {listing && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-musd-mist px-4 py-3 text-[14px] text-musd-deep">
          <span>
            Listed at <b className="num">{musd(listing.price, 0)} MUSD</b>
          </span>
          <button
            className="font-semibold underline underline-offset-2"
            disabled={busy(tx)}
            onClick={() => tx.run("Unlist", () => write.mutateAsync({ address: marketAddress!, abi: troveMarketAbi, functionName: "unlist", args: [p.id] }))}
          >
            Unlist
          </button>
        </div>
      )}

      <div className="mt-4 flex gap-1 px-1">
        {(["equity", "fixed"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${mode === k ? "bg-ink text-page" : "bg-page text-ink-mute hover:text-ink"}`}
          >
            {k === "equity" ? "% of equity" : "Fixed price"}
          </button>
        ))}
      </div>

      {mode === "equity" ? (
        <>
          <BigInput label="Ask, as a share of live equity" unit="%" value={share} onChange={setShare} invalid={!valid} />
          <BigInput label="Never below (optional)" unit="MUSD" value={floor} onChange={setFloor} />
        </>
      ) : (
        <BigInput label="Price" unit="MUSD" value={fixed} onChange={setFixed} />
      )}

      <Facts>
        <Fact label="Equity now">{musd(p.equity, 0)} MUSD</Fact>
        <Fact label="Sells now for">
          <span className="text-musd">{musd(preview, 0)} MUSD</span>
        </Fact>
        <Fact label="Debt you leave behind">{musd(p.debt, 0)} MUSD</Fact>
        <Fact label="Fee">None</Fact>
      </Facts>

      <div className="mt-auto pt-4">
        <button className="btn-ink w-full py-3.5" disabled={!valid || busy(tx)} onClick={list}>
          {busy(tx) ? busyLabel(tx) : approval.approved === false ? "Approve, then list" : listing ? "Update listing" : "List for 14 days"}
        </button>
      </div>
      <TxStatus state={tx.state} />
      <Note>
        You keep the NFT while listed, so you can still add BTC in a crash. Equity pricing follows BTC by
        itself; over 100% asks a premium for a low locked rate.
      </Note>
    </>
  );
}

type ManageTab = "add" | "repay" | "borrow" | "withdraw" | "close";
const MANAGE: { id: ManageTab; label: string; unit: "BTC" | "MUSD" }[] = [
  { id: "add", label: "Add BTC", unit: "BTC" },
  { id: "repay", label: "Repay", unit: "MUSD" },
  { id: "borrow", label: "Borrow", unit: "MUSD" },
  { id: "withdraw", label: "Withdraw BTC", unit: "BTC" },
  { id: "close", label: "Close", unit: "MUSD" },
];

function Manage({ p, price, onDone }: { p: Position; price?: bigint; onDone: () => void }) {
  const [tab, setTab] = useState<ManageTab>("add");
  const [input, setInput] = useState("");
  const amount = parseAmount(input);
  const funds = useMusd(p.owner, p.account);
  const btcBalance = useBalance({ address: p.owner });
  const write = useWriteContract();
  const tx = useTx(() => {
    funds.refetch();
    void btcBalance.refetch();
    setInput("");
    onDone();
  });
  const a = { address: p.account, abi: troveAccountAbi } as const;
  const closeCost = p.debt - GAS_COMPENSATION;
  const meta = MANAGE.find((x) => x.id === tab)!;

  const after =
    !amount || tab === "close"
      ? null
      : tab === "add"
        ? { coll: p.coll + amount, debt: p.debt }
        : tab === "withdraw"
          ? { coll: p.coll > amount ? p.coll - amount : 0n, debt: p.debt }
          : tab === "borrow"
            ? { coll: p.coll, debt: p.debt + amount }
            : { coll: p.coll, debt: p.debt > amount ? p.debt - amount : 0n };

  async function submit() {
    // Hints only save gas; MUSD accepts zero addresses.
    const h = [ZERO, ZERO] as const;
    if (tab === "close") {
      if (!(await funds.ensure(tx.run, closeCost))) return;
      await tx.run("Close Trove", () => write.mutateAsync({ ...a, functionName: "close" }));
      return;
    }
    if (!amount) return;
    if (tab === "add") await tx.run("Add BTC", () => write.mutateAsync({ ...a, functionName: "addColl", args: h, value: amount }));
    if (tab === "withdraw") await tx.run("Withdraw BTC", () => write.mutateAsync({ ...a, functionName: "withdrawColl", args: [amount, ...h] }));
    if (tab === "borrow") await tx.run("Borrow", () => write.mutateAsync({ ...a, functionName: "borrow", args: [amount, ...h] }));
    if (tab === "repay") {
      if (!(await funds.ensure(tx.run, amount))) return;
      await tx.run("Repay", () => write.mutateAsync({ ...a, functionName: "repay", args: [amount, ...h] }));
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-1 px-1">
        {MANAGE.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setInput("");
              tx.reset();
            }}
            className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${tab === t.id ? "bg-ink text-page" : "bg-page text-ink-mute hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "close" ? (
        <Facts>
          <Fact label="You repay">{musd(closeCost, 2)} MUSD</Fact>
          <Fact label="You get back">{btc(p.coll, 4)} BTC</Fact>
          <Fact label="In your wallet">{musd(funds.balance, 2)} MUSD</Fact>
        </Facts>
      ) : (
        <>
          <BigInput
            label={meta.label}
            unit={meta.unit}
            value={input}
            onChange={setInput}
            max={
              tab === "add" && btcBalance.data
                ? { label: btc(btcBalance.data.value, 4), onClick: () => setInput(toInput(btcBalance.data!.value, 6)) }
                : tab === "repay" && funds.balance !== undefined
                  ? { label: musd(funds.balance, 0), onClick: () => setInput(toInput(funds.balance!, 2)) }
                  : undefined
            }
          />
          <Facts>
            <Fact label="Collateral ratio after">{after && price ? ratio(icrOf(after, price)) : "—"}</Fact>
          </Facts>
        </>
      )}

      <div className="mt-auto pt-4">
        <button className="btn-ink w-full py-3.5" disabled={(tab !== "close" && !amount) || busy(tx)} onClick={submit}>
          {busy(tx) ? busyLabel(tx) : meta.label}
        </button>
      </div>
      <TxStatus state={tx.state} />
      <Note>
        {tab === "close"
          ? "MUSD settles the 200 MUSD gas reserve itself. If you don't hold the MUSD, selling the Trove is the other way out."
          : "The Trove stays yours, and everything you take out comes straight to your wallet."}
      </Note>
    </>
  );
}

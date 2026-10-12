"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { decodeEventLog } from "viem";
import { useBalance, useConnection, usePublicClient, useWriteContract } from "wagmi";
import { BigInput, DeskShell, EquityBar, Fact, Facts, Note } from "@/components/desk";
import { parseAmount } from "@/components/fields";
import { Masthead } from "@/components/Masthead";
import { TxStatus } from "@/components/primitives";
import { Terms } from "@/components/Terms";
import { WalletButton, useMounted } from "@/components/Wallet";
import { trovePositionsAbi } from "@/lib/abi";
import { chain, positionsAddress } from "@/lib/config";
import { btc, musd, ratio } from "@/lib/format";
import { hintsFor } from "@/lib/hints";
import { useMarketContext } from "@/lib/positions";
import { GAS_COMPENSATION, MCR, MIN_NET_DEBT, WAD, icrOf, liquidationPrice, rateLabel } from "@/lib/risk";
import { useTx } from "@/lib/tx";

export default function OpenPage() {
  const router = useRouter();
  const mounted = useMounted();
  const { address, chainId } = useConnection();
  const { price, currentRate } = useMarketContext();
  const balance = useBalance({ address, query: { enabled: !!address } });
  const client = usePublicClient();
  const write = useWriteContract();
  const tx = useTx();

  const [collInput, setCollInput] = useState("0.05");
  const [debtInput, setDebtInput] = useState("2000");
  const coll = parseAmount(collInput);
  const borrow = parseAmount(debtInput);

  // MUSD adds its 200 MUSD gas reserve to the debt; its small borrowing fee is left out here.
  const debt = borrow ? borrow + GAS_COMPENSATION : null;
  const icr = coll && debt && price ? icrOf({ coll, debt }, price) : null;
  const value = coll && price ? (coll * price) / WAD : 0n;
  const tooSmall = borrow !== null && borrow < MIN_NET_DEBT;
  const unsafe = icr !== null && icr < MCR + 10n ** 17n;
  const lacking = !!(coll && balance.data && coll > balance.data.value);
  const connected = mounted && !!address && chainId === chain.id;
  const busy = tx.state.phase === "signing" || tx.state.phase === "pending";

  async function open() {
    if (!coll || !borrow || !debt || !positionsAddress) return;
    const [upper, lower] = await hintsFor(client!, { coll, debt });
    let hash: `0x${string}` | undefined;
    const ok = await tx.run("Open Trove", async () => {
      hash = await write.mutateAsync({
        address: positionsAddress!,
        abi: trovePositionsAbi,
        functionName: "openPosition",
        args: [borrow, upper, lower],
        value: coll,
      });
      return hash;
    });
    if (!ok || !hash) return;
    const receipt = await client!.getTransactionReceipt({ hash });
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: trovePositionsAbi, ...log });
        if (ev.eventName === "PositionCreated") return router.push(`/p/${ev.args.tokenId}`);
      } catch {
        // another contract's event
      }
    }
    router.push("/mine");
  }

  const label = busy
    ? tx.state.phase === "signing"
      ? "Confirm in wallet…"
      : "Waiting for the block…"
    : tooSmall
      ? "Borrow at least 1,800 MUSD"
      : unsafe
        ? "Too close to liquidation"
        : lacking
          ? "More BTC than your wallet holds"
          : `Open and borrow ${borrow ? musd(borrow, 0) : ""} MUSD`;

  return (
    <>
      <Masthead />
      <main className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div className="grid gap-8 pb-10 pt-8 sm:pt-14 lg:grid-cols-12 lg:items-end lg:pb-12">
          <div className="animate-rise lg:col-span-8">
            <h1 className="wide max-w-[16ch] text-[42px] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-[68px]">
              Open a Trove <span className="text-musd">you can sell.</span>
            </h1>
            <p className="mt-6 max-w-[56ch] text-[17px] leading-[1.55] text-ink-soft">
              A normal MUSD Trove, opened by an account contract that obeys whoever holds its NFT.
              Borrow and manage it as usual. When you want out, list it instead of buying the MUSD back.
            </p>
          </div>
          <div className="animate-rise lg:col-span-4 lg:pb-1" style={{ animationDelay: "80ms" }}>
            <p className="text-[13px] font-semibold text-ink-mute">Rate you lock in</p>
            <p className="wide num mt-1 text-[56px] font-extrabold leading-none tracking-[-0.045em] sm:text-[64px]">
              {currentRate !== undefined ? rateLabel(currentRate) : "—"}
            </p>
            <p className="mt-2 text-[14px] text-ink-mute">Fixed for the life of the Trove, and passed on to whoever buys it.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
          <div className="rounded-[22px] bg-white p-5 ring-1 ring-ink/10 sm:rounded-[28px] sm:p-7 lg:col-span-8">
            <p className="text-[13px] font-semibold text-ink-mute">Your Trove at today&apos;s price</p>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px] font-semibold text-ink">Debt</p>
                <p className="wide num mt-1 text-[34px] font-bold leading-none tracking-[-0.02em]">{debt ? musd(debt, 0) : "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-semibold text-musd">Your equity</p>
                <p className="wide num mt-1 text-[34px] font-bold leading-none tracking-[-0.02em]">
                  {debt && value > debt ? musd(value - debt, 0) : "—"}
                </p>
              </div>
            </div>
            <div className="mt-5">
              <EquityBar value={value} debt={debt ?? 0n} />
              <p className="mt-2 text-[12.5px] text-ink-mute">
                {coll ? btc(coll, 4) : "0"} BTC worth <span className="num">{musd(value, 0)}</span> MUSD
              </p>
            </div>
            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-ink-line pt-6 text-[14px] sm:grid-cols-3">
              <div>
                <dt className="text-[12.5px] text-ink-mute">Collateral ratio</dt>
                <dd className="num font-semibold">{icr ? ratio(icr) : "—"}</dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-ink-mute">Liquidated if BTC falls to</dt>
                <dd className="num font-semibold">{coll && debt ? `$${musd(liquidationPrice({ coll, debt }), 0)}` : "—"}</dd>
              </div>
              <div>
                <dt className="text-[12.5px] text-ink-mute">Gas reserve in the debt</dt>
                <dd className="num font-semibold">200 MUSD, refunded on close</dd>
              </div>
            </dl>
          </div>

          <div className="lg:col-span-4">
            <DeskShell tabs={[{ id: "open", label: "Open" }]} active="open" onTab={() => {}}>
              <BigInput
                label="Collateral"
                unit="BTC"
                value={collInput}
                onChange={setCollInput}
                invalid={lacking}
                max={balance.data ? { label: btc(balance.data.value, 4), onClick: () => setCollInput(((Number(balance.data!.value) / 1e18) * 0.98).toFixed(6)) } : undefined}
              />
              <BigInput label="Borrow" unit="MUSD" value={debtInput} onChange={setDebtInput} invalid={tooSmall || unsafe} />
              <Facts>
                <Fact label="You receive">{borrow ? musd(borrow, 0) : "—"} MUSD</Fact>
                <Fact label="And an NFT">Trove position</Fact>
                <Fact label="Interest">{currentRate !== undefined ? rateLabel(currentRate) : "—"} fixed</Fact>
              </Facts>
              <div className="mt-auto pt-4">
                {!connected ? (
                  <WalletButton className="w-full" />
                ) : (
                  <button className="btn-ink w-full py-3.5" disabled={!coll || !borrow || tooSmall || unsafe || lacking || !positionsAddress || busy} onClick={open}>
                    {label}
                  </button>
                )}
              </div>
              <TxStatus state={tx.state} />
              <Note>One transaction: mints the NFT, deploys its account and opens the Trove through MUSD&apos;s own contracts.</Note>
            </DeskShell>
          </div>
        </div>
      </main>
      <Terms />
    </>
  );
}

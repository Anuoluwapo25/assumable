"use client";

import { useQueryClient } from "@tanstack/react-query";
import { parseEther, parseUnits, zeroAddress } from "viem";
import { useConnection, useReadContract, useWriteContract } from "wagmi";
import { mockMusdAbi, mockStabilityPoolAbi } from "@/lib/abi";
import { chain } from "@/lib/config";
import { useTx } from "@/lib/tx";
import type { VaultState } from "@/lib/vault";
import { TxStatus } from "./primitives";
import { useMounted, WalletButton } from "./Wallet";

const FAUCET = "https://faucet.test.mezo.org";
const LIQUIDATED_BTC = parseEther("0.0005");

/**
 * Controls for the testnet demo, where the pool under the vault is the test
 * mock. Lets someone trying the app make the things happen that, on mainnet,
 * only the market makes happen: a liquidation, or the pool locking withdrawals.
 */
export function DemoPanel({ vault }: { vault: VaultState }) {
  const mounted = useMounted();
  const { address } = useConnection();
  const queryClient = useQueryClient();
  const write = useWriteContract();
  const tx = useTx(() => queryClient.invalidateQueries());

  const pool = vault.stabilityPool;
  const blocked = useReadContract({
    address: pool ?? zeroAddress,
    abi: mockStabilityPoolAbi,
    functionName: "blockWithdrawals",
    query: { enabled: !!pool, refetchInterval: 6_000 },
  });

  const connected = mounted && !!address;
  const busy = tx.state.phase === "signing" || tx.state.phase === "pending";
  const ready = connected && !!pool && !!vault.asset && !busy;

  // A Trove liquidated at 110% collateralization: the debt is the BTC's value
  // over 1.1, so the pool earns a ~10% premium, as it would on mainnet. Capped
  // so it never asks the pool to absorb more than a quarter of itself.
  function liquidationDebt() {
    const value = (LIQUIDATED_BTC * (vault.btcPrice ?? 0n)) / 10n ** 18n;
    const debt = (value * 10n) / 11n;
    const cap = (vault.poolTotal ?? 0n) / 4n;
    return debt < cap ? debt : cap;
  }

  const steps = [
    {
      title: "Get test BTC for gas",
      body: "Free from Mezo's faucet. A few thousandths of a BTC is plenty.",
      action:
        chain.id === 31611 ? (
          <a href={FAUCET} target="_blank" rel="noreferrer" className="btn border-[1.5px] border-page/30 text-page hover:bg-page hover:text-ink">
            Open faucet ↗
          </a>
        ) : (
          <span className="text-[13px] text-page/50">Not needed locally.</span>
        ),
    },
    {
      title: "Get 1,000 demo MUSD",
      body: "On Mezo you'd borrow MUSD by locking BTC in a Trove. The demo hands it out so you can skip that step. Then deposit it above.",
      action: (
        <button
          className="btn bg-page text-ink hover:bg-white"
          disabled={!ready}
          onClick={() =>
            tx.run("Get demo MUSD", () =>
              write.mutateAsync({
                address: vault.asset!,
                abi: mockMusdAbi,
                functionName: "mint",
                args: [address!, parseUnits("1000", 18)],
              }),
            )
          }
        >
          Get 1,000 MUSD
        </button>
      ),
    },
    {
      title: "Liquidate a Trove",
      body: "Sends 0.0005 BTC into the pool as a liquidated Trove's collateral. Watch it land on the floor, then harvest it.",
      action: (
        <button
          className="btn-btc"
          disabled={!ready || !vault.btcPrice || !vault.poolTotal}
          onClick={() =>
            tx.run("Liquidation", () =>
              write.mutateAsync({
                address: pool!,
                abi: mockStabilityPoolAbi,
                functionName: "simulateLiquidation",
                args: [liquidationDebt(), LIQUIDATED_BTC],
                value: LIQUIDATED_BTC,
              }),
            )
          }
        >
          Liquidate a Trove
        </button>
      ),
    },
    {
      title: blocked.data ? "Withdrawals are paused" : "Pause withdrawals",
      body: "What the real pool does while a Trove is waiting to be liquidated. Withdrawing is refused; harvesting still works.",
      action: (
        <button
          className={`btn border-[1.5px] ${blocked.data ? "border-stop bg-stop text-white hover:bg-transparent hover:text-stop" : "border-page/30 text-page hover:bg-page hover:text-ink"}`}
          disabled={!ready || blocked.data === undefined}
          onClick={() =>
            tx.run(blocked.data ? "Resume withdrawals" : "Pause withdrawals", () =>
              write.mutateAsync({
                address: pool!,
                abi: mockStabilityPoolAbi,
                functionName: "setBlockWithdrawals",
                args: [!blocked.data],
              }),
            )
          }
        >
          {blocked.data ? "Resume them" : "Pause them"}
        </button>
      ),
    },
  ];

  return (
    <section className="mx-auto max-w-[1240px] px-4 pt-6 sm:px-8">
      <div className="rounded-[22px] bg-ink p-5 text-page sm:rounded-[28px] sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-btc px-3 py-1 text-[12px] font-bold text-ink">
              Testnet demo
            </p>
            <h2 className="wide mt-3 text-[26px] font-bold leading-tight tracking-[-0.03em] sm:text-[32px]">
              Make a liquidation happen.
            </h2>
          </div>
          <p className="max-w-[54ch] text-[14px] leading-relaxed text-page/60">
            The vault here is the real contract. The Stability Pool under it is a stand-in that
            runs the real pool&rsquo;s accounting but lets you trigger liquidations, so you can
            see the whole loop without waiting for the market.
          </p>
        </div>

        <ol className="mt-7 grid gap-px overflow-hidden rounded-2xl bg-page/10 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={i} className="flex flex-col bg-ink p-5">
              <p className="num text-[13px] font-bold text-btc">0{i + 1}</p>
              <h3 className="mt-1 text-[16px] font-semibold">{s.title}</h3>
              <p className="mb-5 mt-1.5 text-[13.5px] leading-snug text-page/55">{s.body}</p>
              <div className="mt-auto">{s.action}</div>
            </li>
          ))}
        </ol>

        {!connected && (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <WalletButton className="!border-page/30 !text-page hover:!bg-page hover:!text-ink" />
            <span className="text-[13.5px] text-page/55">
              Connect to {chain.name} to use these.
            </span>
          </div>
        )}
        <TxStatus state={tx.state} tone="light" />
      </div>
    </section>
  );
}

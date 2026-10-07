"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useConnection, usePublicClient, useWriteContract } from "wagmi";
import { chain } from "@/lib/config";
import { btc, musd, musdCompact, pct } from "@/lib/format";
import { explain, useTx } from "@/lib/tx";
import { vaultContract, type VaultState } from "@/lib/vault";
import { Figure, TxStatus } from "./primitives";
import { WalletButton } from "./Wallet";

const BPS = 10_000n;
// Stands in for a caller when no wallet is connected, so the harvest can still
// be quoted. The fee transfer needs a non-zero recipient.
const QUOTE_CALLER = "0x000000000000000000000000000000000000dEaD";

/**
 * The Stability Pool, drawn as what it is: a body of MUSD that liquidations
 * drain and BTC settles to the bottom of. The vault's share is its own column
 * of water, and the BTC it is owed lies on that column's floor until a harvest
 * dissolves it back into MUSD.
 */
export function Pool({ vault }: { vault: VaultState }) {

  // The column is drawn at its true share, but never so thin it can't be seen.
  const share =
    vault.vaultInPool !== undefined && vault.poolTotal
      ? Number((vault.vaultInPool * 10_000n) / vault.poolTotal) / 10_000
      : undefined;
  const drawn = share === undefined ? 0.5 : Math.min(0.88, Math.max(0.16, share));

  // How much sediment to draw: the BTC's weight against the vault's assets,
  // exaggerated so that a fraction of a percent is still visible.
  const pending = vault.harvestableBtc ?? 0n;
  const weight =
    vault.pendingBtcValue && vault.totalAssets
      ? Number((vault.pendingBtcValue * 1_000_000n) / vault.totalAssets) / 1_000_000
      : 0;
  const live = pending > 0n ? Math.round(Math.min(110, 14 + weight * 4000)) : 0;
  const harvest = useHarvest(vault, live);
  // While a harvest's grains are rising, keep drawing them even though the
  // refreshed state already says the floor is clear.
  const grains = harvest.frozen ?? live;

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-white ring-1 ring-ink/10 sm:rounded-[28px]">
      {/* The air above the water, where the columns are labelled. */}
      <div className="relative flex h-[124px] sm:h-[132px]">
        <Label
          style={{ width: `${drawn * 100}%` }}
          title="Backstop"
          value={<Figure value={musdCompact(vault.vaultInPool)} width="5ch" />}
          note={
            <>
              <Figure value={pct(vault.vaultInPool, vault.poolTotal)} width="4ch" /> of the pool
            </>
          }
          accent
        />
        <Label
          style={{ width: `${(1 - drawn) * 100}%` }}
          title="Everyone else"
          value={
            <Figure
              value={
                vault.poolTotal !== undefined && vault.vaultInPool !== undefined
                  ? musdCompact(vault.poolTotal - vault.vaultInPool)
                  : undefined
              }
              width="5ch"
            />
          }
          note="supplying the pool directly"
        />
        {vault.withdrawalsAvailable === false && (
          <span className="absolute right-4 top-4 rounded-full bg-stop px-3 py-1 text-xs font-semibold text-white sm:right-6 sm:top-5">
            Withdrawals paused
          </span>
        )}
      </div>

      {/* The water. */}
      <div className="relative flex h-[300px] sm:h-[360px] lg:h-[420px]">
        <Column width={drawn} tone="vault">
          <Sediment grains={grains} dissolving={harvest.frozen !== null} />
        </Column>
        <Column width={1 - drawn} tone="rest" />
        {/* Floats over the whole pool, so it never depends on how wide the
            vault's column happens to be. */}
        <Floor vault={vault} harvest={harvest} pending={pending} />
        {vault.deployed === false && (
          <div className="absolute inset-0 grid place-items-center">
            <p className="wide rounded-full bg-white px-5 py-2.5 text-sm font-semibold">Opens at launch</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Label({
  style,
  title,
  value,
  note,
  accent,
}: {
  style: React.CSSProperties;
  title: string;
  value: React.ReactNode;
  note: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div style={style} className="relative min-w-0 px-4 pt-4 transition-[width] duration-700 sm:px-6 sm:pt-5">
      <p className={`text-[13px] font-semibold ${accent ? "text-musd" : "text-ink-mute"}`}>{title}</p>
      <p className="wide num mt-1 truncate text-[26px] font-bold leading-none tracking-[-0.02em] sm:text-[34px]">
        {value}
      </p>
      <p className="num mt-1.5 truncate text-[13px] text-ink-mute">{note}</p>
      {/* A tick from the label down to the surface it names. */}
      <span className={`absolute bottom-0 left-4 h-3 w-px sm:left-6 ${accent ? "bg-musd" : "bg-ink-faint"}`} />
    </div>
  );
}

function Column({
  width,
  tone,
  children,
}: {
  width: number;
  tone: "vault" | "rest";
  children?: React.ReactNode;
}) {
  const fill = tone === "vault" ? "fill-musd" : "fill-musd-pale";
  return (
    <div
      // Clip sideways so the drifting surface stays in its own column, but not
      // upward, where the crest rises above the water line.
      style={{ width: `${width * 100}%`, overflowX: "clip" }}
      className={`relative transition-[width] duration-700 ${tone === "vault" ? "bg-musd" : "bg-musd-pale"}`}
    >
      {/* The surface. Twice as wide as the column so it can drift sideways. */}
      <svg
        className="absolute -top-[13px] left-0 h-[14px] w-[calc(100%+100px)] animate-swell"
        viewBox="0 0 400 14"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          className={fill}
          d="M0 7 C 25 1, 50 1, 75 7 S 125 13, 150 7 S 200 1, 225 7 S 275 13, 300 7 S 350 1, 375 7 S 400 10, 400 10 V 14 H 0 Z"
        />
      </svg>
      {children}
    </div>
  );
}

/** Deterministic, so the grains don't reshuffle every time the data refreshes. */
function seeded(n: number) {
  let s = 0x2f6b9a1;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  return Array.from({ length: n }, () => {
    const x = next();
    // A mound: grains pile higher toward the middle of the floor.
    const mound = 1 - Math.pow(2 * x - 1, 2);
    return {
      x: 3 + x * 94,
      y: next() * mound * 46,
      size: 6 + next() * 6,
      round: next() > 0.45,
      delay: next() * 0.9,
    };
  });
}

function Sediment({ grains, dissolving }: { grains: number; dissolving: boolean }) {
  const all = useMemo(() => seeded(110), []);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-full" aria-hidden>
      {all.slice(0, grains).map((g, i) => (
        <span
          key={i}
          className="absolute animate-settle"
          style={{ left: `${g.x}%`, bottom: `${g.y}px`, animationDelay: `${g.delay}s` }}
        >
          <span
            className={`block bg-btc transition-[transform,opacity] duration-[1100ms] ease-in ${g.round ? "rounded-full" : "rotate-12 rounded-[2px]"}`}
            style={{
              width: g.size,
              height: g.size,
              transitionDelay: `${g.delay * 0.6}s`,
              transform: dissolving ? "translateY(-280px) scale(0.2)" : undefined,
              opacity: dissolving ? 0 : 1,
            }}
          />
        </span>
      ))}
    </div>
  );
}

function Floor({
  vault,
  harvest,
  pending,
}: {
  vault: VaultState;
  harvest: ReturnType<typeof useHarvest>;
  pending: bigint;
}) {
  const { address } = useConnection();
  if (!vault.deployed) return null;

  return (
    <div className="absolute left-3 right-3 top-7 sm:left-6 sm:right-auto sm:top-10 sm:w-[340px]">
      {pending > 0n ? (
        <div className="animate-rise rounded-2xl bg-white p-4 text-ink shadow-[0_1px_0_rgba(0,0,0,0.04)] sm:p-5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-btc-deep">
            <span className="h-2 w-2 rounded-full bg-btc" />
            BTC on the floor
          </p>
          <p className="wide num mt-2 text-[28px] font-bold leading-none tracking-[-0.02em]">
            <Figure value={btc(pending)} width="6ch" />
            <span className="ml-1.5 text-sm font-semibold text-ink-mute">BTC</span>
          </p>
          <p className="num mt-1.5 text-[13px] text-ink-mute">
            worth ≈ <Figure value={musd(vault.pendingBtcValue)} width="6ch" /> MUSD, already in the share price
          </p>

          <div className="mt-4">
            {!address ? (
              <>
                <p className="num mb-2.5 text-[13px] text-ink-soft">
                  Whoever harvests earns{" "}
                  <b className="font-semibold">
                    <Figure value={harvest.fee === undefined ? undefined : musd(harvest.fee)} width="4ch" /> MUSD
                  </b>
                  .
                </p>
                <WalletButton className="w-full" />
              </>
            ) : (
              <button
                className="btn-btc w-full whitespace-pre"
                disabled={harvest.out === undefined || harvest.busy || harvest.wrongChain}
                onClick={harvest.run}
              >
                {harvest.busy
                  ? "Harvesting…"
                  : harvest.fee !== undefined
                    ? `Harvest  +${musd(harvest.fee)} MUSD`
                    : "Harvest"}
              </button>
            )}
            {harvest.quoteError && (
              <p className="mt-2 text-[13px] text-stop">{harvest.quoteError}</p>
            )}
            <TxStatus state={harvest.tx.state} />
          </div>
        </div>
      ) : (
        <div className="max-w-[300px] text-white [text-shadow:0_1px_0_rgba(0,0,0,0.08)]">
          <p className="text-[13px] font-semibold text-white/70">Floor is clear</p>
          <p className="mt-1 text-[15px] leading-snug">
            The next liquidation on Mezo drops its BTC here, and it compounds from there.
          </p>
          <TxStatus state={harvest.tx.state} tone="light" />
        </div>
      )}
    </div>
  );
}

function useHarvest(vault: VaultState, grains: number) {
  const { address, chainId } = useConnection();
  const client = usePublicClient();
  const write = useWriteContract();
  const [frozen, setFrozen] = useState<number | null>(null);
  const tx = useTx();

  const has = !!vault.harvestableBtc && vault.harvestableBtc > 0n;

  // An exact quote: run the harvest without sending it. Through the public
  // client rather than wagmi's simulate hook, which needs a connected wallet,
  // and anyone looking at the page should see what a harvest would pay.
  const quote = useQuery({
    queryKey: ["harvest-quote", address, vault.harvestableBtc?.toString()],
    enabled: has && vault.deployed && !!client,
    refetchInterval: 12_000,
    retry: false,
    queryFn: async () => {
      const { result } = await client!.simulateContract({
        ...vaultContract,
        functionName: "harvest",
        args: [0n],
        account: address ?? QUOTE_CALLER,
      });
      return result;
    },
  });

  const out = quote.data;
  const fee =
    out !== undefined && vault.harvestFeeBps !== undefined ? (out * vault.harvestFeeBps) / BPS : undefined;
  const busy = tx.state.phase === "signing" || tx.state.phase === "pending";

  async function run() {
    if (out === undefined) return;
    // On top of the vault's own oracle floor, refuse anything well below the
    // quote the caller just saw.
    const minOut = (out * 995n) / 1000n;
    const ok = await tx.run("Harvest", () =>
      write.mutateAsync({ ...vaultContract, functionName: "harvest", args: [minOut] }),
    );
    if (ok) {
      setFrozen(grains);
      vault.refetch();
      setTimeout(() => setFrozen(null), 2200);
    }
  }

  return {
    out,
    fee,
    busy,
    run,
    tx,
    frozen,
    wrongChain: !!address && chainId !== chain.id,
    quoteError: has && quote.error ? `The harvest would fail right now. ${explain(quote.error)}` : null,
  };
}

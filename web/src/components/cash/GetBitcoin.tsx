"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useConnection } from "wagmi";
import { api, btcAmount } from "@/lib/cashout/client";
import { chain } from "@/lib/config";

const FAUCET = "https://faucet.test.mezo.org";

/**
 * Getting test Bitcoin, for judges and testers: one tap from a demo wallet
 * when the deployment has one, and Mezo's faucet otherwise.
 */
export function GetBitcoin({ onFunded }: { onFunded?: () => void }) {
  const { address } = useConnection();
  const demo = useQuery({ queryKey: ["demo-fund"], queryFn: () => api<{ enabled: boolean; needed?: string }>("/api/demo/fund") });
  const [state, setState] = useState<{ phase: "idle" | "working" | "done" | "error"; text?: string }>({ phase: "idle" });

  if (chain.id !== 31611) return null;

  async function fund() {
    setState({ phase: "working" });
    try {
      const r = await api<{ sent: string }>("/api/demo/fund", { method: "POST", body: JSON.stringify({ address }) });
      setState({ phase: "done", text: BigInt(r.sent) > 0n ? `Added ${btcAmount(r.sent, 4)} test BTC to your wallet.` : "Your wallet already has enough." });
      onFunded?.();
    } catch (e) {
      setState({ phase: "error", text: (e as Error).message });
    }
  }

  return (
    <div className="mt-3 rounded-2xl bg-page px-4 py-3 text-[14px] leading-snug">
      <p className="font-semibold text-ink">This is a test version with test Bitcoin.</p>
      {demo.data?.enabled ? (
        <>
          <p className="mt-1 text-ink-soft">
            Get about {btcAmount(demo.data.needed ?? "0", 3)} test BTC in one tap: enough to try your first cash-out.
          </p>
          <button className="btn-btc mt-3 w-full" onClick={() => void fund()} disabled={!address || state.phase === "working"}>
            {state.phase === "working" ? "Sending test Bitcoin…" : "Get test Bitcoin"}
          </button>
        </>
      ) : (
        <p className="mt-1 text-ink-soft">Free test Bitcoin is available from Mezo&apos;s faucet.</p>
      )}
      {state.text && (
        <p role={state.phase === "error" ? "alert" : undefined} aria-live="polite" className={`mt-2 ${state.phase === "error" ? "text-stop" : "text-musd-deep"}`}>
          {state.text}
        </p>
      )}
      <p className="mt-2 text-ink-soft">
        Or use <a className="link" href={FAUCET} target="_blank" rel="noreferrer">Mezo&apos;s faucet</a>.
      </p>
    </div>
  );
}

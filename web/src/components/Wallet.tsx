"use client";

import { useEffect, useRef, useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { chain } from "@/lib/config";
import { short } from "@/lib/format";

export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Connect, or say which network to be on, or show who is connected. */
export function WalletButton({ className = "" }: { className?: string }) {
  const mounted = useMounted();
  const { address, chainId, status } = useConnection();
  const connectors = useConnectors();
  const connect = useConnect();
  const switchChain = useSwitchChain();

  // Wallet state only exists in the browser; render the neutral button until
  // then so server and client agree.
  if (!mounted || status === "reconnecting") {
    return <button className={`btn-outline ${className}`} disabled>Connect wallet</button>;
  }

  if (!address) {
    const injected = connectors[0];
    return (
      <button
        className={`btn-outline ${className}`}
        disabled={connect.isPending}
        onClick={() => injected && connect.mutate({ connector: injected })}
        title={connect.error ? connect.error.message : undefined}
      >
        {connect.isPending ? "Waiting for wallet…" : "Connect wallet"}
      </button>
    );
  }

  if (chainId !== chain.id) {
    return (
      <button
        className={`btn-btc ${className}`}
        disabled={switchChain.isPending}
        onClick={() => switchChain.mutate({ chainId: chain.id })}
      >
        Switch to {chain.name}
      </button>
    );
  }

  return <AccountMenu address={address} className={className} />;
}

function AccountMenu({ address, className }: { address: string; className: string }) {
  const [open, setOpen] = useState(false);
  const disconnect = useDisconnect();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        className={`btn-outline num ${className}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="h-2 w-2 rounded-full bg-musd" aria-hidden />
        {short(address)}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-2xl bg-white py-1.5 text-sm shadow-[0_16px_40px_-16px_rgba(0,0,0,0.3)] ring-1 ring-ink/10">
          <button
            className="block w-full px-4 py-2.5 text-left text-ink-soft hover:bg-page hover:text-ink"
            onClick={() => {
              navigator.clipboard?.writeText(address);
              setOpen(false);
            }}
          >
            Copy address
          </button>
          <button
            className="block w-full px-4 py-2.5 text-left text-ink-soft hover:bg-page hover:text-ink"
            onClick={() => disconnect.mutate()}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

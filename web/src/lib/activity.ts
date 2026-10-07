"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hash } from "viem";
import { usePublicClient } from "wagmi";
import { backstopVaultAbi } from "./abi";
import { vaultAddress, vaultDeployBlock } from "./config";

// Without a deploy block, scan only recent history rather than asking a public
// RPC for logs from genesis, which most of them refuse.
const FALLBACK_LOOKBACK = 50_000n;
const SHOWN = 12;

export type Entry =
  | { kind: "deposit"; account: Address; musd: bigint; shares: bigint; block: bigint; tx: Hash; time?: number }
  | { kind: "withdraw"; account: Address; musd: bigint; shares: bigint; block: bigint; tx: Hash; time?: number }
  | {
      kind: "harvest";
      account: Address;
      btc: bigint;
      musd: bigint;
      fee: bigint;
      block: bigint;
      tx: Hash;
      time?: number;
    };

export function useActivity() {
  const client = usePublicClient();

  return useQuery({
    queryKey: ["activity", vaultAddress?.toLowerCase()],
    enabled: !!client && vaultAddress !== null,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Entry[]> => {
      if (!client || !vaultAddress) return [];

      const head = await client.getBlockNumber();
      const fromBlock =
        vaultDeployBlock ?? (head > FALLBACK_LOOKBACK ? head - FALLBACK_LOOKBACK : 0n);

      const logs = await client.getContractEvents({
        address: vaultAddress,
        abi: backstopVaultAbi,
        fromBlock,
        toBlock: head,
      });

      const entries: Entry[] = [];
      for (const log of logs) {
        const base = { block: log.blockNumber, tx: log.transactionHash };
        if (log.eventName === "Deposit") {
          entries.push({ kind: "deposit", account: log.args.owner!, musd: log.args.assets!, shares: log.args.shares!, ...base });
        } else if (log.eventName === "Withdraw") {
          entries.push({ kind: "withdraw", account: log.args.owner!, musd: log.args.assets!, shares: log.args.shares!, ...base });
        } else if (log.eventName === "Harvested") {
          entries.push({
            kind: "harvest",
            account: log.args.caller!,
            btc: log.args.btcSwapped!,
            musd: log.args.musdReceived!,
            fee: log.args.keeperFee!,
            ...base,
          });
        }
      }

      const recent = entries.reverse().slice(0, SHOWN);

      // Timestamps for the handful shown, one lookup per distinct block.
      const blocks = [...new Set(recent.map((e) => e.block))];
      const times = new Map(
        await Promise.all(
          blocks.map(async (n) => {
            const b = await client.getBlock({ blockNumber: n });
            return [n, Number(b.timestamp)] as const;
          }),
        ),
      );
      return recent.map((e) => ({ ...e, time: times.get(e.block) }));
    },
  });
}

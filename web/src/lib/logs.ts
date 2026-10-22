"use client";

import type { PublicClient } from "viem";

/** Mezo's RPCs (and dRPC's free tier) refuse getLogs over more than 10,000 blocks. */
const MAX_RANGE = 9_999n;
/** How many windows to ask for at once: enough to be quick, few enough not to be throttled. */
const PARALLEL = 4;

const cache = new Map<string, { upTo: bigint; logs: unknown[] }>();

/**
 * Every log matching `fetch` from `fromBlock` to the chain head, read in
 * windows the RPC accepts. Finished history never changes, so windows already
 * read are kept, keyed by `key`, and each refresh reads only the new blocks.
 */
export async function scanLogs<T>(
  client: PublicClient,
  key: string,
  fromBlock: bigint,
  fetch: (range: { fromBlock: bigint; toBlock: bigint }) => Promise<T[]>,
): Promise<T[]> {
  const head = await client.getBlockNumber();
  const known = cache.get(key);
  const start = known ? known.upTo + 1n : fromBlock;
  const logs = (known?.logs as T[] | undefined)?.slice() ?? [];

  const windows: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let b = start; b <= head; b += MAX_RANGE + 1n) {
    windows.push({ fromBlock: b, toBlock: b + MAX_RANGE < head ? b + MAX_RANGE : head });
  }
  for (let i = 0; i < windows.length; i += PARALLEL) {
    const batch = await Promise.all(windows.slice(i, i + PARALLEL).map(fetch));
    for (const part of batch) logs.push(...part);
  }
  cache.set(key, { upTo: head, logs });
  return logs;
}

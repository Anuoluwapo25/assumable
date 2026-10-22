"use client";

import { zeroAddress, type Address, type PublicClient } from "viem";
import { hintsFor } from "../hints";
import type { TroveNumbers } from "../risk";

/**
 * Hints for MUSD's sorted list, or none if they're slow to find. Hints only
 * save gas: MUSD accepts zero hints and walks the list itself. Finding them
 * can take a long time on a cold local fork, and a cash-out must never fail
 * over an optimisation.
 */
export async function hintsOrNone(
  client: PublicClient,
  after: TroveNumbers,
  ms = 5_000,
): Promise<readonly [Address, Address]> {
  const none = [zeroAddress, zeroAddress] as const;
  try {
    return await Promise.race([
      hintsFor(client, after),
      new Promise<typeof none>((resolve) => setTimeout(() => resolve(none), ms)),
    ]);
  } catch {
    return none;
  }
}

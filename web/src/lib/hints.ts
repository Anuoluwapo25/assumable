import type { Address, PublicClient } from "viem";
import { hintHelpersAbi, sortedTrovesAbi } from "./abi";
import { musdContracts } from "./config";
import type { TroveNumbers } from "./risk";

/**
 * Where a Trove will sit in SortedTroves after a change. MUSD accepts any
 * hints, but good ones save the walk through the list, and gas with it.
 */
export async function hintsFor(client: PublicClient, after: TroveNumbers): Promise<readonly [Address, Address]> {
  const nicr = after.debt === 0n ? 0n : (after.coll * 10n ** 20n) / after.debt;
  const size = await client.readContract({
    address: musdContracts.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: "getSize",
  });
  const [hint] = await client.readContract({
    address: musdContracts.hintHelpers,
    abi: hintHelpersAbi,
    functionName: "getApproxHint",
    args: [nicr, BigInt(Math.ceil(15 * Math.sqrt(Number(size)))), BigInt(Date.now())],
  });
  return client.readContract({
    address: musdContracts.sortedTroves,
    abi: sortedTrovesAbi,
    functionName: "findInsertPosition",
    args: [nicr, hint, hint],
  });
}

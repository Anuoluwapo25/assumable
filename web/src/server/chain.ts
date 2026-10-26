import "server-only";
import { createPublicClient, fallback, http, type Address } from "viem";
import {
  troveMarketAbi,
  assetsBridgeAbi,
  borrowerOperationsAbi,
  cashOutModuleAbi,
  poolRouterAbi,
  priceFeedAbi,
  troveAccountAbi,
  trovePositionsAbi,
} from "@/lib/abi";
import { bridgeContracts, cashOut, chain, marketAddress, musdContracts, poolContracts, positionsAddress, rpcUrls } from "@/lib/config";

export const publicClient = createPublicClient({ chain, transport: fallback(rpcUrls.map((u) => http(u))) });

/** BTC left in the wallet for gas: Mezo charges gas in BTC. */
export const GAS_RESERVE_BTC = 2n * 10n ** 14n; // 0.0002 BTC

export type Position = { tokenId: bigint; owner: Address; account: Address; coll: bigint; debt: bigint };

export async function readPosition(tokenId: bigint): Promise<Position | null> {
  if (!positionsAddress || tokenId === 0n) return null;
  try {
    const [owner, account] = await Promise.all([
      publicClient.readContract({ address: positionsAddress, abi: trovePositionsAbi, functionName: "ownerOf", args: [tokenId] }),
      publicClient.readContract({ address: positionsAddress, abi: trovePositionsAbi, functionName: "accountOf", args: [tokenId] }),
    ]);
    const [coll, debt] = await publicClient.readContract({ address: account, abi: troveAccountAbi, functionName: "position" });
    return { tokenId, owner, account, coll, debt };
  } catch {
    return null;
  }
}

/**
 * The caller's existing loan, if they have one: an active position they own,
 * preferring one that isn't listed for sale. A first cash-out must never open
 * a second loan for someone who already has one, whatever the page thinks.
 */
export async function findOwnedPosition(owner: Address): Promise<bigint | null> {
  if (!positionsAddress || !marketAddress) return null;
  const next = await publicClient.readContract({ address: positionsAddress, abi: trovePositionsAbi, functionName: "nextId" });
  const ids = Array.from({ length: Number(next) - 1 }, (_, i) => BigInt(i + 1));
  if (ids.length === 0) return null;
  const rows = await publicClient.multicall({
    allowFailure: true,
    contracts: ids.flatMap((id) => [
      { address: positionsAddress!, abi: trovePositionsAbi, functionName: "ownerOf" as const, args: [id] as const },
      { address: marketAddress!, abi: troveMarketAbi, functionName: "quote" as const, args: [id] as const },
      { address: marketAddress!, abi: troveMarketAbi, functionName: "listings" as const, args: [id] as const },
    ]),
  });
  const mine = ids.filter((_, i) => {
    const o = rows[3 * i];
    const q = rows[3 * i + 1];
    return o.status === "success" && (o.result as string).toLowerCase() === owner.toLowerCase()
      && q.status === "success" && (q.result as { active: boolean }).active;
  });
  const unlisted = mine.find((id) => {
    const l = rows[3 * ids.indexOf(id) + 2];
    return l.status === "success" && (l.result as readonly unknown[])[0] === "0x0000000000000000000000000000000000000000";
  });
  return unlisted ?? mine[0] ?? null;
}

/** Everything about MUSD and the module that a quote depends on. */
export async function readMarket() {
  const [btcPrice, borrowingRate, minNetDebt, maxLtvBps] = await Promise.all([
    publicClient.readContract({ address: musdContracts.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" }),
    publicClient.readContract({ address: musdContracts.borrowerOperations, abi: borrowerOperationsAbi, functionName: "borrowingRate" }),
    publicClient.readContract({ address: musdContracts.borrowerOperations, abi: borrowerOperationsAbi, functionName: "minNetDebt" }),
    cashOut.module
      ? publicClient.readContract({ address: cashOut.module, abi: cashOutModuleAbi, functionName: "maxLtvBps" }).then(BigInt)
      : Promise.resolve(BigInt(cashOut.maxLtvBps)),
  ]);
  return { btcPrice, borrowingRate, minNetDebt, maxLtvBps };
}

export async function walletBtc(owner: Address) {
  const balance = await publicClient.getBalance({ address: owner });
  return balance > GAS_RESERVE_BTC ? balance - GAS_RESERVE_BTC : 0n;
}

const route = [
  { from: musdContracts.musd, to: bridgeContracts.musdc, stable: true, factory: poolContracts.poolFactory },
] as const;

/** mUSDC (6 decimals) the real MUSD/mUSDC pool gives for `musd` right now. */
export async function quoteSwap(musd: bigint): Promise<bigint> {
  const amounts = await publicClient.readContract({
    address: poolContracts.router,
    abi: poolRouterAbi,
    functionName: "getAmountsOut",
    args: [musd, route],
  });
  return amounts[amounts.length - 1];
}

/** The bridge's live minimum for mUSDC, or our configured floor if higher. */
export async function bridgeMinimum(): Promise<bigint> {
  const onchain = await publicClient.readContract({
    address: bridgeContracts.assetsBridge,
    abi: assetsBridgeAbi,
    functionName: "getMinBridgeOutAmount",
    args: [bridgeContracts.musdc],
  });
  return onchain > cashOut.routeBMinBridgeOut ? onchain : cashOut.routeBMinBridgeOut;
}

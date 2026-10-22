import "server-only";
import { createPublicClient, fallback, http, type Address } from "viem";
import {
  assetsBridgeAbi,
  borrowerOperationsAbi,
  cashOutModuleAbi,
  poolRouterAbi,
  priceFeedAbi,
  troveAccountAbi,
  trovePositionsAbi,
} from "@/lib/abi";
import { bridgeContracts, cashOut, chain, musdContracts, poolContracts, positionsAddress, rpcUrls } from "@/lib/config";

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

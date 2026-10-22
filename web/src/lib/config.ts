import { isAddress, type Address, type Chain } from "viem";
import { mezo, mezoTestnet } from "viem/chains";
import { networks } from "./networks";

const chains: Record<string, Chain> = { mezo, mezoTestnet };

const chainKey = process.env.NEXT_PUBLIC_CHAIN ?? "mezoTestnet";
export const chain: Chain = chains[chainKey] ?? mezoTestnet;

export const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0];

/**
 * Where to go when `rpcUrl` errors or times out. Mezo's public testnet RPC
 * sometimes answers from a node far behind the rest; dRPC's public endpoint
 * is an independent second source. Not used when a custom RPC (a local fork,
 * say) is configured, so it can't quietly switch chains.
 */
const FALLBACK_RPCS: Record<number, string[]> = {
  [mezoTestnet.id]: ["https://mezo-testnet.drpc.org"],
};
export const rpcUrls: string[] = process.env.NEXT_PUBLIC_RPC_URL
  ? [rpcUrl]
  : [rpcUrl, ...(FALLBACK_RPCS[chain.id] ?? [])];

const network = networks[String(chain.id) as keyof typeof networks];

/** The live MUSD system, from config/<network>.json (via scripts/abi.mjs). */
export const musdContracts = network.musd;
/** Mezo Pools and the native bridge, for Cash Out's routes. */
export const poolContracts = network.pools;
export const bridgeContracts = network.bridge;

/** The zero address in config/*.json means "not deployed on this network". */
const addr = (v: string | null | undefined): Address | null =>
  v && isAddress(v) && !/^0x0{40}$/.test(v) ? v : null;

/** From `forge script script/Deploy.s.sol`: the env, else the network config. Null until deployed. */
export const positionsAddress = addr(process.env.NEXT_PUBLIC_POSITIONS_ADDRESS) ?? addr(network.assumable.positions);
export const marketAddress = addr(process.env.NEXT_PUBLIC_MARKET_ADDRESS) ?? addr(network.assumable.market);
export const deployed = positionsAddress !== null && marketAddress !== null;

const deployBlock = process.env.NEXT_PUBLIC_DEPLOY_BLOCK;
/** Where to start reading offer events. */
export const deployBlockNumber = deployBlock && /^\d+$/.test(deployBlock) ? BigInt(deployBlock) : 0n;

/** From `forge script script/DeployCashOut.s.sol`. Null until deployed. */
export const cashOut = {
  module: addr(process.env.NEXT_PUBLIC_CASHOUT_MODULE) ?? addr(network.cashOut.module),
  directAdapter: addr(process.env.NEXT_PUBLIC_CASHOUT_DIRECT_ADAPTER) ?? addr(network.cashOut.directAdapter),
  swapBridgeAdapter:
    addr(process.env.NEXT_PUBLIC_CASHOUT_SWAP_ADAPTER) ?? addr(network.cashOut.swapBridgeAdapter),
  maxLtvBps: network.cashOut.maxLtvBps,
  routeBMinBridgeOut: BigInt(network.cashOut.routeBMinBridgeOut),
  routeBMaxMusdIn: BigInt(network.cashOut.routeBMaxMusdIn),
};

export function explorerAddress(address: string) {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : null;
}

export function explorerTx(hash: string) {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

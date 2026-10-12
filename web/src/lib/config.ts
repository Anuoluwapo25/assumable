import { isAddress, type Address, type Chain } from "viem";
import { mezo, mezoTestnet } from "viem/chains";

const chains: Record<string, Chain> = { mezo, mezoTestnet };

const chainKey = process.env.NEXT_PUBLIC_CHAIN ?? "mezoTestnet";
export const chain: Chain = chains[chainKey] ?? mezoTestnet;

export const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0];

/** The live MUSD system, from mezo-org/musd `solidity/artifacts/deployments`. */
const MUSD = {
  [mezoTestnet.id]: {
    musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
    troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
    sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
    hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
    priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
    interestRateManager: "0xD4D6c36A592A2c5e86035A6bca1d57747a567f37",
  },
  [mezo.id]: {
    musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
    troveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
    sortedTroves: "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f",
    hintHelpers: "0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3",
    priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
    interestRateManager: "0x4a453700d157717Fe02fB62E7700ED7845048285",
  },
} as const satisfies Record<number, Record<string, Address>>;

export const musdContracts = MUSD[chain.id as keyof typeof MUSD];

const addr = (v: string | undefined): Address | null => (v && isAddress(v) ? v : null);

/** From `forge script script/Deploy.s.sol`. Null until deployed. */
export const positionsAddress = addr(process.env.NEXT_PUBLIC_POSITIONS_ADDRESS);
export const marketAddress = addr(process.env.NEXT_PUBLIC_MARKET_ADDRESS);
export const deployed = positionsAddress !== null && marketAddress !== null;

const deployBlock = process.env.NEXT_PUBLIC_DEPLOY_BLOCK;
/** Where to start reading offer events. */
export const deployBlockNumber = deployBlock && /^\d+$/.test(deployBlock) ? BigInt(deployBlock) : 0n;

export function explorerAddress(address: string) {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : null;
}

export function explorerTx(hash: string) {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

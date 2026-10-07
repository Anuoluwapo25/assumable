import { defineChain, isAddress, type Address, type Chain } from "viem";
import { mezo, mezoTestnet } from "viem/chains";

// Anvil, for running against script/DemoLocal.s.sol. Mezo's gas token is BTC,
// so the local chain says so too; that keeps every label in the app honest.
const local = defineChain({
  id: 31337,
  name: "Local",
  nativeCurrency: { decimals: 18, name: "Bitcoin", symbol: "BTC" },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const chains: Record<string, Chain> = { mezo, mezoTestnet, local };

const chainKey = process.env.NEXT_PUBLIC_CHAIN ?? "mezo";
export const chain: Chain = chains[chainKey] ?? mezo;

export const rpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0];

const vault = process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "";
/** Null until the vault is deployed; the app renders a pre-launch state. */
export const vaultAddress: Address | null = isAddress(vault) ? vault : null;

const deployBlock = process.env.NEXT_PUBLIC_VAULT_DEPLOY_BLOCK;
export const vaultDeployBlock: bigint | null =
  deployBlock && /^\d+$/.test(deployBlock) ? BigInt(deployBlock) : null;

export function explorerAddress(address: string) {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/address/${address}` : null;
}

export function explorerTx(hash: string) {
  const base = chain.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

/**
 * The testnet demo runs the vault over the test mocks, which let anyone mint
 * MUSD and trigger a liquidation. Only ever set this for that deployment: the
 * panel it turns on calls functions a real Stability Pool doesn't have.
 */
export const demoMode = process.env.NEXT_PUBLIC_DEMO === "true";

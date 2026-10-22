import { createWalletClient, fallback, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GAS_COMPENSATION, WAD } from "@/lib/cashout/safety";
import { chain, rpcUrls } from "@/lib/config";
import { GAS_RESERVE_BTC, publicClient, readMarket } from "@/server/chain";
import { serverEnv } from "@/server/env";
import { fail, json } from "@/server/http";

/** Testnet chain ids this may ever run on. Never mainnet. */
const TESTNETS = new Set([31611]);
const TARGET_MARGIN_BPS = 500n;

// Per instance: stops a burst from one address. Serverless instances don't
// share this, so the treasury's own balance is the real budget.
const g = globalThis as unknown as { __demoFunded?: Map<string, number> };
const recent = (g.__demoFunded ??= new Map());

/** What a first cash-out needs as security, plus gas, at today's price. */
async function neededBtc() {
  const { btcPrice, borrowingRate, minNetDebt, maxLtvBps } = await readMarket();
  const debt = minNetDebt + (minNetDebt * borrowingRate) / WAD + GAS_COMPENSATION;
  const target = maxLtvBps - TARGET_MARGIN_BPS;
  const coll = (debt * 10_000n * WAD) / (target * btcPrice);
  return (coll * 102n) / 100n + GAS_RESERVE_BTC * 5n;
}

export async function GET() {
  const enabled = !!serverEnv.demoFaucetKey && TESTNETS.has(chain.id);
  if (!enabled) return json({ enabled: false });
  return json({ enabled: true, needed: (await neededBtc()).toString() });
}

/**
 * POST /api/demo/fund { address }: tops a testnet wallet up to what a first
 * cash-out needs. Testnet BTC only, and only when the wallet has less.
 */
export async function POST(req: Request) {
  if (!serverEnv.demoFaucetKey || !TESTNETS.has(chain.id)) return fail("demo Bitcoin isn't available here", 404);
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  const address = body?.address ?? "";
  if (!isAddress(address)) return fail("address must be a wallet address");
  const last = recent.get(address.toLowerCase());
  if (last && Date.now() - last < 10 * 60_000) return fail("demo Bitcoin was just sent to this wallet; give it a minute", 429);

  const [needed, balance] = await Promise.all([neededBtc(), publicClient.getBalance({ address: address as Address })]);
  if (balance >= needed) return json({ sent: "0", balance: balance.toString(), hash: null });

  const account = privateKeyToAccount(serverEnv.demoFaucetKey);
  const treasury = await publicClient.getBalance({ address: account.address });
  const amount = needed - balance;
  if (treasury < amount + GAS_RESERVE_BTC) return fail("the demo Bitcoin wallet is empty right now; use the faucet instead", 503);

  recent.set(address.toLowerCase(), Date.now());
  const wallet = createWalletClient({ account, chain, transport: fallback(rpcUrls.map((u) => http(u))) });
  const hash = await wallet.sendTransaction({ to: address as Address, value: amount });
  await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  return json({ sent: amount.toString(), balance: (balance + amount).toString(), hash });
}

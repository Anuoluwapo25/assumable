import { erc20Abi, isAddress, parseUnits, type Address } from "viem";
import { createWalletClient, fallback, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PaybackJson } from "@/lib/cashout/api";
import { GAS_COMPENSATION, WAD } from "@/lib/cashout/safety";
import { chain, musdContracts, rpcUrls } from "@/lib/config";
import { publicClient, readMarket, readPosition } from "@/server/chain";
import { serverEnv } from "@/server/env";
import { fail, json } from "@/server/http";
import { newOrderId } from "@/server/orders";
import { mockFiatPerUsd } from "@/server/providers/mock";

const ONRAMP_FEE_BPS = 100n;

/**
 * POST /api/payback { tokenId, owner, fiat, amount }
 *
 * The reverse of a cash-out: local currency in, MUSD out, and the MUSD repays
 * the loan (the wallet then calls CashOutModule.repay). MOCK on-ramp: no fiat
 * is collected. If MOCK_TREASURY_PRIVATE_KEY is set, a demo treasury sends the
 * MUSD; otherwise it must already be in the wallet (for example, the surplus
 * from a first cash-out). Partial repayments stop at MUSD's minimum loan.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("expected a JSON body");
  const owner = String(body.owner ?? "");
  if (!isAddress(owner)) return fail("owner must be an address");
  const tokenId = /^\d+$/.test(String(body.tokenId ?? "")) ? BigInt(String(body.tokenId)) : 0n;
  const fiat = String(body.fiat ?? "").toUpperCase();
  const rate = mockFiatPerUsd(fiat);
  if (!rate) return fail(`can't take ${fiat || "that currency"}`);
  const amount = String(body.amount ?? "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) return fail("amount must be a positive number");

  const position = await readPosition(tokenId);
  if (!position) return fail("no such position", 404);
  const { minNetDebt } = await readMarket();
  const repayable = position.debt > GAS_COMPENSATION + minNetDebt ? position.debt - GAS_COMPENSATION - minNetDebt : 0n;

  const usd = (parseUnits(amount, 18) * WAD) / parseUnits(rate, 18);
  const musdAmount = (usd * (10_000n - ONRAMP_FEE_BPS)) / 10_000n;
  if (musdAmount === 0n) return fail("amount is too small");
  if (musdAmount > repayable) {
    return json({ error: "above-repayable", repayable: repayable.toString(), fiatPerUsd: parseUnits(rate, 18).toString() }, 422);
  }

  let fundingTx: `0x${string}` | null = null;
  let source: PaybackJson["source"] = "wallet";
  if (serverEnv.mock.treasuryKey) {
    const account = privateKeyToAccount(serverEnv.mock.treasuryKey);
    const wallet = createWalletClient({ account, chain, transport: fallback(rpcUrls.map((u) => http(u))) });
    fundingTx = await wallet.writeContract({
      address: musdContracts.musd,
      abi: erc20Abi,
      functionName: "transfer",
      args: [owner as Address, musdAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: fundingTx });
    source = "treasury";
  } else {
    const balance = await publicClient.readContract({ address: musdContracts.musd, abi: erc20Abi, functionName: "balanceOf", args: [owner as Address] });
    if (balance < musdAmount) return json({ error: "wallet-short", have: balance.toString(), need: musdAmount.toString() }, 422);
  }

  const res: PaybackJson = {
    onrampOrderId: newOrderId(),
    mock: true,
    musdAmount: musdAmount.toString(),
    repayable: repayable.toString(),
    source,
    fundingTx,
    fiatCost: parseUnits(amount, 18).toString(),
  };
  return json(res);
}

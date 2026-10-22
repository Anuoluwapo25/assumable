import { formatUnits } from "viem";
import type { CashOutJson } from "@/lib/cashout/api";
import { cashOut } from "@/lib/config";
import { fail, json } from "@/server/http";
import { chainOrderFor, newOrderId, saveOrder, signOrder, type StoredOrder } from "@/server/orders";
import { parseQuoteParams } from "@/server/params";
import type { Destination } from "@/server/providers/types";
import { buildQuote, QuoteError } from "@/server/quote";
import { quoteJson } from "@/server/serialize";

/**
 * POST /api/cashout
 *   { provider, fiat, amount, owner, tokenId, destination: { kind, institution, account, name } }
 *
 * Re-prices the request, opens a sell order with the provider, and returns
 * the provider's deposit address inside an order signed for CashOutModule,
 * ready for the wallet to send. The client never chooses where funds go.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return fail("expected a JSON body");
  const params = parseQuoteParams(body);
  if (typeof params === "string") return fail(params);
  const destination = parseDestination(body.destination);
  if (typeof destination === "string") return fail(destination);
  if (!cashOut.module) return fail("Cash Out isn't deployed on this network yet", 503);

  try {
    const q = await buildQuote(params);
    if (q.blocker) return json({ error: q.blocker.code, quote: quoteJson(q) }, 422);

    const orderId = newOrderId(params.provider.id);
    const po = await params.provider.createOrder({
      orderId,
      owner: params.owner,
      fiat: params.fiat,
      fiatAmount: params.amount,
      usdAmount: formatUnits(q.usdToReceive, 18),
      destination,
    });

    const signed = po.ready
      ? await (async () => {
          const order = chainOrderFor(q, orderId, params.owner, po.depositAddress);
          return { order, signature: await signOrder(order) };
        })()
      : null;

    const stored: StoredOrder = {
      orderId,
      createdAt: Date.now(),
      owner: params.owner,
      providerId: params.provider.id,
      providerRef: po.providerRef,
      mock: params.provider.mock,
      route: params.provider.route,
      fiat: params.fiat,
      fiatAmount: q.fiatAmount,
      usdToReceive: q.usdToReceive,
      totalFeesUsd: q.totalFeesUsd,
      musdToSend: q.musdToSend,
      musdBorrowed: q.musdBorrowed,
      surplusMusd: q.surplusMusd,
      btcToAdd: q.btcToAdd,
      tokenId: q.tokenId,
      destination: { kind: destination.kind, institution: destination.institution, last4: destination.account.slice(-4) },
      arrival: q.arrival,
      signed,
      checkoutUrl: po.ready ? null : po.checkoutUrl,
      tx: null,
    };
    saveOrder(stored);

    const res: CashOutJson = {
      orderId,
      mock: params.provider.mock,
      quote: quoteJson(q),
      call: signed && {
        fn: q.tokenId === 0n ? "openAndCashOut" : "cashOut",
        order: {
          ...signed.order,
          tokenId: signed.order.tokenId.toString(),
          musdAmount: signed.order.musdAmount.toString(),
          minOut: signed.order.minOut.toString(),
          expiry: signed.order.expiry.toString(),
        },
        signature: signed.signature,
        value: q.btcToAdd.toString(),
        debt: q.musdBorrowed.toString(),
      },
      checkoutUrl: stored.checkoutUrl,
    };
    return json(res);
  } catch (e) {
    if (e instanceof QuoteError) return fail(e.message);
    console.error(e);
    return fail(e instanceof Error ? e.message : "couldn't create the order", 502);
  }
}

function parseDestination(v: unknown): Destination | string {
  if (!v || typeof v !== "object") return "destination is required";
  const d = v as Record<string, unknown>;
  const kind = d.kind === "mobile_money" ? "mobile_money" : d.kind === "bank" ? "bank" : null;
  if (!kind) return "destination.kind must be bank or mobile_money";
  const account = String(d.account ?? "").replace(/\s+/g, "");
  if (!/^[0-9+]{6,20}$/.test(account)) return "destination.account must be 6 to 20 digits";
  const institution = String(d.institution ?? "").trim().slice(0, 60);
  if (!institution) return "destination.institution is required";
  const name = String(d.name ?? "").trim().slice(0, 80);
  if (!name) return "destination.name is required";
  return { kind, institution, account, name };
}

import type { OrderJson } from "@/lib/cashout/api";
import { isHash, isHex } from "viem";
import { fail, json } from "@/server/http";
import { getOrder, orderStatus, reconstructOrder, recordTx } from "@/server/orders";

/**
 * GET /api/order/:id[?tx=<hash>]: the payout's timeline, loan drawn ->
 * converted -> sent -> paid out. With `tx`, any server instance can answer,
 * rebuilding the order from the chain if it didn't create it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isHex(id) || id.length !== 66) return fail("no such order", 404);
  const tx = new URL(req.url).searchParams.get("tx");
  let order = getOrder(id);
  if (order && !order.tx && tx && isHash(tx)) {
    await recordTx(order, tx).catch(() => false);
  }
  if (!order && tx && isHash(tx)) order = (await reconstructOrder(id, tx).catch(() => null)) ?? undefined;
  if (!order) return fail("no such order", 404);
  try {
    const s = await orderStatus(order);
    const res: OrderJson = {
      orderId: order.orderId,
      state: s.state,
      mock: order.mock,
      fiat: order.fiat,
      fiatAmount: order.fiatAmount.toString(),
      route: order.route,
      arrival: order.arrival,
      destination: order.destination,
      tokenId: order.tx ? order.tx.tokenId.toString() : order.tokenId ? order.tokenId.toString() : null,
      txHash: order.tx?.hash ?? null,
      steps: s.steps,
    };
    return json(res);
  } catch (e) {
    console.error(e);
    return fail("couldn't read the order's status", 502);
  }
}

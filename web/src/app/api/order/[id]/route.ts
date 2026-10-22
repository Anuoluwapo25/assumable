import type { OrderJson } from "@/lib/cashout/api";
import { fail, json } from "@/server/http";
import { getOrder, orderStatus } from "@/server/orders";

/** GET /api/order/:id: the payout's timeline, loan drawn -> converted -> sent -> paid out. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const order = getOrder(id);
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

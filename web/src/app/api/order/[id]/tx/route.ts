import { isHash } from "viem";
import { fail, json } from "@/server/http";
import { getOrder, recordTx } from "@/server/orders";

/** POST /api/order/:id/tx { hash }: the wallet reports the transaction; the server checks it on-chain. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const order = getOrder(id);
  if (!order) return fail("no such order", 404);
  const body = (await req.json().catch(() => null)) as { hash?: string } | null;
  if (!body?.hash || !isHash(body.hash)) return fail("hash must be a transaction hash");
  try {
    const ok = await recordTx(order, body.hash);
    return ok ? json({ ok: true }) : fail("that transaction didn't execute this order", 422);
  } catch (e) {
    console.error(e);
    return fail("couldn't confirm the transaction yet", 502);
  }
}

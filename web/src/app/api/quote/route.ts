import { fail, json } from "@/server/http";
import { parseQuoteParams } from "@/server/params";
import { buildQuote, QuoteError } from "@/server/quote";
import { quoteJson } from "@/server/serialize";

/**
 * GET /api/quote?fiat=NGN&amount=150000&owner=0x..&tokenId=3&provider=mock
 *
 * The MUSD needed (with pool, bridge, provider and borrowing fees), the
 * resulting LTV, liquidation price and safe drop, the one safety sentence, and
 * the estimated arrival. tokenId 0 (or absent) quotes a first cash-out.
 */
export async function GET(req: Request) {
  const params = parseQuoteParams(Object.fromEntries(new URL(req.url).searchParams));
  if (typeof params === "string") return fail(params);
  try {
    return json(quoteJson(await buildQuote(params)));
  } catch (e) {
    if (e instanceof QuoteError) return fail(e.message);
    console.error(e);
    return fail("couldn't price that right now", 502);
  }
}

import "server-only";
import type { QuoteJson } from "@/lib/cashout/api";
import type { CashOutQuote } from "./quote";

export function quoteJson(q: CashOutQuote): QuoteJson {
  const s = (v: bigint) => v.toString();
  return {
    provider: q.provider,
    fiat: q.fiat,
    fiatAmount: s(q.fiatAmount),
    fiatPerUsd: s(q.fiatPerUsd),
    btcPrice: s(q.btcPrice),
    usdToReceive: s(q.usdToReceive),
    totalFeesUsd: s(q.totalFeesUsd),
    fees: { provider: s(q.fees.provider), bridge: s(q.fees.bridge), conversion: s(q.fees.conversion), borrowing: s(q.fees.borrowing) },
    musdToSend: s(q.musdToSend),
    musdBorrowed: s(q.musdBorrowed),
    surplusMusd: s(q.surplusMusd),
    btcToAdd: s(q.btcToAdd),
    newColl: s(q.newColl),
    newDebt: s(q.newDebt),
    isNewLoan: q.isNewLoan,
    ltvBps: s(q.ltvBps),
    liquidationPrice: s(q.liquidationPrice),
    dropBps: s(q.dropBps),
    sentence: q.sentence,
    arrival: q.arrival,
    blocker: q.blocker ? { code: q.blocker.code, fiatLimit: q.blocker.fiatLimit?.toString() } : null,
  };
}

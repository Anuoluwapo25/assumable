import { describe, expect, it } from "vitest";
import {
  BPS,
  GAS_COMPENSATION,
  WAD,
  formatUsd,
  healthOf,
  liquidationPriceOf,
  ltvOf,
  maxFiatFor,
  quoteCashOut,
  safetySentence,
  type SafetyInput,
} from "./safety";

const w = (n: number | string) => {
  const [a, b = ""] = String(n).split(".");
  return BigInt(a) * WAD + BigInt((b + "0".repeat(18)).slice(0, 18));
};

// An existing loan: 0.2 BTC at $80,000 ($16,000) against 2,200 MUSD, 13.75% LTV.
// Route A, a 1% provider fee, ₦1,500 to the dollar.
const base: SafetyInput = {
  btcPrice: w(80_000),
  coll: w(0.2),
  debt: w(2_200),
  walletBtc: 0n,
  fiatAmount: w(150_000),
  fiatPerUsd: w(1_500),
  providerFeeBps: 100n,
  providerFlatFeeUsd: 0n,
  bridgeFeeUsd: 0n,
  conversionBps: BPS,
  minDeliveredUsd: 0n,
  maxMusdPerOrder: 0n,
  borrowingRate: w(0.001),
  minNetDebt: w(1_800),
  maxLtvBps: 4_000n,
  targetLtvBps: 3_500n,
};

// Route B on mainnet: ~3.5% lost in the pool at this size, $3 bridge fee, 20 USDC minimum.
const routeB: Partial<SafetyInput> = {
  conversionBps: 9_650n,
  bridgeFeeUsd: w(3),
  minDeliveredUsd: w(20),
  maxMusdPerOrder: w(1_000),
};

describe("quoteCashOut", () => {
  it("prices a simple Route A cash-out", () => {
    const q = quoteCashOut(base);
    expect(q.blocker).toBeNull();
    expect(q.usdToReceive).toBe(w(100));
    // $100 after a 1% fee means handing the provider $101.0102 (rounded up).
    expect(q.musdToSend).toBe(101010101010101010102n);
    expect(q.surplusMusd).toBe(0n);
    expect(q.btcToAdd).toBe(0n);
    expect(q.newDebt).toBe(base.debt + q.musdToSend + q.musdToSend / 1000n);
    expect(q.fees.borrowing).toBe(q.musdToSend / 1000n);
    expect(q.totalFeesUsd).toBe(q.fees.provider + q.fees.borrowing);
    expect(q.ltvBps).toBe(ltvOf(base.coll, q.newDebt, base.btcPrice));
  });

  it("adds Route B's pool loss and bridge fee", () => {
    const q = quoteCashOut({ ...base, ...routeB });
    expect(q.blocker).toBeNull();
    const delivered = (q.musdToSend * 9_650n) / BPS;
    expect(delivered).toBeGreaterThanOrEqual(w("104.0101")); // $101.0101 + $3
    expect(q.fees.bridge).toBe(w(3));
    expect(q.fees.conversion).toBeGreaterThan(w(3.5));
    expect(q.totalFeesUsd).toBeGreaterThan(w(7));
  });

  it("states liquidation price and the drop it can absorb", () => {
    const q = quoteCashOut(base);
    expect(q.liquidationPrice).toBe((q.newDebt * 110n * 10n ** 16n) / base.coll);
    const expectedDrop = ((base.btcPrice - q.liquidationPrice) * BPS) / base.btcPrice;
    expect(q.dropBps).toBe(expectedDrop);
    expect(q.sentence).toMatch(/^Your Bitcoin is safe unless BTC falls below \$[\d,]+ \(a \d+% drop\)\.$/);
    expect(q.sentence).toBe(safetySentence(q.liquidationPrice, q.dropBps));
  });

  describe("tiny amounts", () => {
    it("rejects an amount under Route B's bridge minimum, and says what would work", () => {
      const q = quoteCashOut({ ...base, ...routeB, fiatAmount: w(15_000) }); // $10
      expect(q.blocker?.code).toBe("below-minimum");
      const ok = quoteCashOut({ ...base, ...routeB, fiatAmount: q.blocker!.fiatLimit! + w(1_500) });
      expect(ok.blocker).toBeNull();
    });

    it("still works for a very small Route A amount", () => {
      const q = quoteCashOut({ ...base, fiatAmount: w(1_500) }); // $1
      expect(q.blocker).toBeNull();
      expect(q.musdToSend).toBeGreaterThan(w(1));
    });

    it("rejects zero, negative or missing inputs", () => {
      expect(quoteCashOut({ ...base, fiatAmount: 0n }).blocker?.code).toBe("invalid");
      expect(quoteCashOut({ ...base, fiatAmount: -1n }).blocker?.code).toBe("invalid");
      expect(quoteCashOut({ ...base, fiatPerUsd: 0n }).blocker?.code).toBe("invalid");
      expect(quoteCashOut({ ...base, btcPrice: 0n }).blocker?.code).toBe("invalid");
      expect(quoteCashOut({ ...base, providerFeeBps: BPS }).blocker?.code).toBe("invalid");
    });
  });

  describe("fees larger than the amount", () => {
    it("rejects when fixed fees eat the payout", () => {
      // $2 requested, $5 flat provider fee.
      const q = quoteCashOut({ ...base, fiatAmount: w(3_000), providerFlatFeeUsd: w(5) });
      expect(q.blocker?.code).toBe("fees-exceed-amount");
      expect(q.totalFeesUsd).toBeGreaterThan(q.usdToReceive);
      expect(q.blocker?.fiatLimit).toBe(w(15_000)); // twice the $5 fixed fee, in naira
    });

    it("rejects a Route B amount smaller than its $3 bridge fee", () => {
      const q = quoteCashOut({ ...base, ...routeB, minDeliveredUsd: 0n, fiatAmount: w(3_000) });
      expect(q.blocker?.code).toBe("fees-exceed-amount");
    });
  });

  describe("the safety cap", () => {
    it("rejects a request the BTC can't safely back, and offers the most it can", () => {
      // ₦7,500,000 = $5,000: about 7,250 MUSD of debt against $16,000 is past 40%.
      const q = quoteCashOut({ ...base, fiatAmount: w(7_500_000) });
      expect(q.blocker?.code).toBe("exceeds-safe-limit");
      const limit = q.blocker!.fiatLimit!;
      expect(limit).toBe(maxFiatFor(base));
      const atLimit = quoteCashOut({ ...base, fiatAmount: limit });
      expect(atLimit.blocker).toBeNull();
      expect(atLimit.ltvBps).toBeLessThanOrEqual(4_000n);
      expect(quoteCashOut({ ...base, fiatAmount: limit + w(3_000) }).blocker?.code).toBe("exceeds-safe-limit");
    });

    it("tops up with wallet BTC, aiming under the cap", () => {
      const q = quoteCashOut({ ...base, fiatAmount: w(7_500_000), walletBtc: w(1) });
      expect(q.blocker).toBeNull();
      expect(q.btcToAdd).toBeGreaterThan(0n);
      expect(q.ltvBps).toBeLessThanOrEqual(3_500n);
      expect(q.ltvBps).toBeGreaterThanOrEqual(3_499n);
    });

    it("needs more BTC than the wallet has", () => {
      const q = quoteCashOut({ ...base, fiatAmount: w(7_500_000), walletBtc: w(0.01) });
      expect(q.blocker?.code).toBe("exceeds-safe-limit");
      expect(q.btcToAdd).toBeGreaterThan(w(0.01));
    });

    it("is inclusive at exactly the cap, as the contract is", () => {
      // 6,400 debt against $16,000 is exactly 40%.
      const atCap = { ...base, debt: w(6_400) - 1n, fiatAmount: 1n, fiatPerUsd: WAD, providerFeeBps: 0n, borrowingRate: 0n };
      const q = quoteCashOut(atCap);
      expect(q.newDebt).toBe(w(6_400));
      expect(q.ltvBps).toBe(4_000n);
      expect(q.btcToAdd).toBe(0n);
    });

    it("moves with the price at the boundary", () => {
      const at = { ...base, debt: w(6_400) - w(10), fiatAmount: w(15_000), providerFeeBps: 0n, borrowingRate: 0n };
      expect(quoteCashOut(at).ltvBps).toBe(4_000n);
      // A dollar lower on BTC and the same request crosses the cap.
      const lower = quoteCashOut({ ...at, btcPrice: w(79_999) });
      expect(lower.ltvBps).toBe(4_000n); // 6,400 / 15,999.8 rounds down to 40.00%
      const muchLower = quoteCashOut({ ...at, btcPrice: w(79_900) });
      expect(muchLower.blocker?.code).toBe("exceeds-safe-limit");
    });
  });

  describe("a first cash-out", () => {
    const fresh = { ...base, coll: 0n, debt: 0n, walletBtc: w(1) };

    it("borrows MUSD's minimum and leaves the rest in the wallet", () => {
      const q = quoteCashOut(fresh);
      expect(q.isNewLoan).toBe(true);
      expect(q.musdBorrowed).toBe(w(1_800));
      expect(q.surplusMusd).toBe(w(1_800) - q.musdToSend);
      expect(q.newDebt).toBe(w(1_800) + w(1.8) + GAS_COMPENSATION);
      expect(q.ltvBps).toBeLessThanOrEqual(3_500n);
    });

    it("borrows exactly the payout above the minimum", () => {
      const q = quoteCashOut({ ...fresh, fiatAmount: w(3_000_000) }); // $2,000
      expect(q.surplusMusd).toBe(0n);
      expect(q.musdBorrowed).toBe(q.musdToSend);
    });

    it("doesn't count the minimum loan's fee against a tiny first cash-out", () => {
      // ₦1,500 = $1. The loan fee on MUSD's 1,800 minimum is $1.80, but almost
      // all of that loan stays in the wallet; only this payout's share counts.
      const q = quoteCashOut({ ...fresh, fiatAmount: w(1_500) });
      expect(q.blocker).toBeNull();
      expect(q.fees.borrowing).toBe(w(1.8)); // still shown honestly in the total
    });

    it("never suggests a minimum of zero", () => {
      const q = quoteCashOut({ ...base, fiatAmount: w(1), providerFlatFeeUsd: w(0.01) });
      expect(q.blocker?.code).toBe("fees-exceed-amount");
      expect(q.blocker!.fiatLimit!).toBeGreaterThanOrEqual(WAD);
    });

    it("can't open without enough BTC for the minimum loan", () => {
      const q = quoteCashOut({ ...fresh, walletBtc: w(0.01) });
      expect(q.blocker?.code).toBe("exceeds-safe-limit");
      expect(q.blocker?.fiatLimit).toBe(0n);
    });
  });

  it("caps Route B orders at the pool's safe size", () => {
    const q = quoteCashOut({ ...base, ...routeB, walletBtc: w(1), fiatAmount: w(3_000_000) });
    expect(q.blocker?.code).toBe("above-order-limit");
    const ok = quoteCashOut({ ...base, ...routeB, walletBtc: w(1), fiatAmount: q.blocker!.fiatLimit! });
    expect(ok.blocker).toBeNull();
    expect(ok.musdToSend).toBeLessThanOrEqual(w(1_000));
  });
});

describe("helpers", () => {
  it("formats dollars", () => {
    expect(formatUsd(w("61234.5"))).toBe("$61,235");
    expect(formatUsd(0n)).toBe("$0");
  });

  it("words the edge cases plainly", () => {
    expect(safetySentence(0n, 0n)).toMatch(/no loan/);
    expect(safetySentence(w(90_000), 0n)).toMatch(/at risk now/);
    expect(safetySentence(w(30_000), 6_250n)).toBe(
      "Your Bitcoin is safe unless BTC falls below $30,000 (a 63% drop).",
    );
  });

  it("matches MUSD's 110% liquidation line", () => {
    // 1 BTC against 50,000 MUSD liquidates below $55,000.
    expect(liquidationPriceOf(w(1), w(50_000))).toBe(w(55_000));
    expect(ltvOf(w(1), w(50_000), w(100_000))).toBe(5_000n);
  });

  it("knows when to offer the rescue sale", () => {
    expect(healthOf(3_000n)).toBe("safe");
    expect(healthOf(5_500n)).toBe("watch");
    expect(healthOf(7_500n)).toBe("act");
  });
});

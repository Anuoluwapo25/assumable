export const WAD = 10n ** 18n;
export const MCR = 110n * 10n ** 16n;
/** Each Trove's 200 MUSD liquidation reserve: repaid by the protocol on close. */
export const GAS_COMPENSATION = 200n * WAD;
/** MUSD's minimum debt at opening, net of the gas reserve. */
export const MIN_NET_DEBT = 1_800n * WAD;

export type TroveNumbers = { coll: bigint; debt: bigint };

export const icrOf = (t: TroveNumbers, price: bigint) => (t.debt === 0n ? 0n : (t.coll * price) / t.debt);
export const liquidationPrice = (t: TroveNumbers) => (t.coll === 0n ? 0n : (t.debt * MCR) / t.coll);

export type Tone = "safe" | "warn" | "danger";
export const toneOf = (icr: bigint): Tone =>
  icr < 125n * 10n ** 16n ? "danger" : icr < 150n * 10n ** 16n ? "warn" : "safe";

/** Basis points (100 == 1%) as "1.00%". */
export const rateLabel = (bps: number) => `${(bps / 100).toFixed(2)}%`;

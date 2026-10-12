import { formatUnits } from "viem";

/** A WAD amount as a plain number. Display only: never feed it back on-chain. */
export function toNumber(value: bigint | undefined, decimals = 18) {
  return value === undefined ? undefined : Number(formatUnits(value, decimals));
}

export function musd(value: bigint | undefined, digits = 2) {
  const n = toNumber(value);
  if (n === undefined) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** MUSD with a k/M suffix, for figures that only need to be roughly read. */
export function musdCompact(value: bigint | undefined) {
  const n = toNumber(value);
  if (n === undefined) return "—";
  if (n < 10_000) return musd(value, 0);
  return n.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
}

export function btc(value: bigint | undefined, digits = 5) {
  const n = toNumber(value);
  if (n === undefined) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(numerator: bigint | undefined, denominator: bigint | undefined, digits = 1) {
  if (numerator === undefined || !denominator) return "—";
  const bps = Number((numerator * 10_000n) / denominator);
  return `${(bps / 100).toFixed(digits)}%`;
}

/** A 1e18-scaled ratio as a percentage: 1.425e18 -> "142.5%". */
export function ratio(value: bigint | undefined, digits = 1) {
  return value === undefined ? "—" : pct(value, 10n ** 18n, digits);
}

export function short(address: string, head = 6, tail = 4) {
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}


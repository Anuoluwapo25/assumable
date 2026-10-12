"use client";

import { parseUnits } from "viem";

export function parseAmount(input: string, decimals = 18): bigint | null {
  try {
    const v = parseUnits(input.trim() || "0", decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

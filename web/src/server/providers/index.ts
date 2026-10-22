import "server-only";
import { banxaProvider } from "./banxa";
import { mockProvider } from "./mock";
import type { OfframpProvider } from "./types";

/**
 * Registered off-ramps. A regional provider slots in here: implement
 * OfframpProvider (see ./types.ts) and add it to this list.
 */
export const providers: OfframpProvider[] = [mockProvider, banxaProvider];

export function providerById(id: string | null | undefined): OfframpProvider | undefined {
  return providers.find((p) => p.id === (id || "mock"));
}

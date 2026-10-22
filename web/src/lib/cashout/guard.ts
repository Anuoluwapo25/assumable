"use client";

import type { Address } from "viem";

type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export class WrongNetworkError extends Error {
  constructor() {
    super(
      "Your wallet is connected to a different network from this app, so nothing was sent. Switch your wallet's network and try again.",
    );
  }
}

/** `positions()`: CashOutModule's link to Assumable, a cheap identity check. */
const POSITIONS_SELECTOR = "0xba5b7982";

/**
 * Checks, through the wallet's own connection, that it's really Cash Out
 * there before anything is sent: not just some contract (an address can hold
 * different code on two chains), but one that answers `positions()` with this
 * app's Assumable deployment. A local fork and Mezo testnet share chain id
 * 31611, so a wallet can look like it's on the right chain while pointing at
 * a different one, where a payable call to an empty address would just send
 * the BTC to nowhere.
 */
export async function assertContractOnWalletChain(
  connector: { getProvider(): Promise<unknown> } | undefined,
  address: Address,
  expectedPositions: Address,
) {
  if (!connector) throw new WrongNetworkError();
  const provider = (await connector.getProvider()) as Provider;
  let answer: string | null = null;
  try {
    answer = (await provider.request({
      method: "eth_call",
      params: [{ to: address, data: POSITIONS_SELECTOR }, "latest"],
    })) as string | null;
  } catch {
    throw new WrongNetworkError();
  }
  const got = answer && answer.length >= 66 ? `0x${answer.slice(-40)}`.toLowerCase() : null;
  if (got !== expectedPositions.toLowerCase()) throw new WrongNetworkError();
}

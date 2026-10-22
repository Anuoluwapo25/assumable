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

/**
 * Checks, through the wallet's own connection, that the contract is really
 * there before anything is sent. A local fork and Mezo testnet share chain id
 * 31611, so a wallet can look like it's on the right chain while pointing at
 * a different one, where a payable call to an empty address would just send
 * the BTC to nowhere.
 */
export async function assertContractOnWalletChain(
  connector: { getProvider(): Promise<unknown> } | undefined,
  address: Address,
) {
  if (!connector) throw new WrongNetworkError();
  const provider = (await connector.getProvider()) as Provider;
  const code = (await provider.request({ method: "eth_getCode", params: [address, "latest"] })) as string | null;
  if (!code || code === "0x" || /^0x0*$/.test(code)) throw new WrongNetworkError();
}

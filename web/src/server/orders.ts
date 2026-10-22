import "server-only";
import { randomBytes } from "node:crypto";
import { decodeEventLog, parseAbiItem, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cashOutModuleAbi } from "@/lib/abi";
import { cashOut, chain } from "@/lib/config";
import { publicClient, quoteSwap } from "./chain";
import { serverEnv } from "./env";
import { providerById } from "./providers";
import type { Destination, ProviderStatus } from "./providers/types";
import type { CashOutQuote } from "./quote";

/** The struct CashOutModule verifies (src/cashout/IOfframpAdapter.sol). */
export type ChainOrder = {
  orderId: Hex;
  tokenId: bigint;
  owner: Address;
  adapter: Address;
  depositAddress: Address;
  musdAmount: bigint;
  minOut: bigint;
  expiry: bigint;
};

export type StoredOrder = {
  orderId: Hex;
  createdAt: number;
  owner: Address;
  providerId: string;
  providerRef: string;
  mock: boolean;
  route: "A" | "B";
  fiat: string;
  fiatAmount: bigint;
  usdToReceive: bigint;
  totalFeesUsd: bigint;
  musdToSend: bigint;
  musdBorrowed: bigint;
  surplusMusd: bigint;
  btcToAdd: bigint;
  tokenId: bigint;
  destination: { kind: Destination["kind"]; institution: string; last4: string };
  arrival: string;
  /** Set once the provider has issued a deposit address and the order is signed. */
  signed: { order: ChainOrder; signature: Hex } | null;
  checkoutUrl: string | null;
  /** `at` is when this server confirmed it: chain clocks (a local fork's, say) can drift. */
  tx: { hash: Hash; at: number; delivered: bigint; tokenId: bigint } | null;
};

// A cache, in memory, of what this server process created. It's an
// optimisation, not the record: on serverless hosting the request that polls
// an order often lands on a different instance, so `reconstructOrder` rebuilds
// what the timeline needs from the chain, and the provider is read from the
// order id itself.
const g = globalThis as unknown as { __cashOutOrders?: Map<Hex, StoredOrder> };
const store = (g.__cashOutOrders ??= new Map());

export const getOrder = (id: string) => store.get(id.toLowerCase() as Hex);

/** The first byte of an order id names its provider, so any instance can track it. */
const PROVIDER_CODES: Record<string, number> = { mock: 1, banxa: 2 };

export function newOrderId(providerId = "mock"): Hex {
  const id = randomBytes(32);
  id[0] = PROVIDER_CODES[providerId] ?? 0;
  return `0x${id.toString("hex")}`;
}

export function providerOfOrderId(id: Hex): string | null {
  const code = parseInt(id.slice(2, 4), 16);
  return Object.entries(PROVIDER_CODES).find(([, c]) => c === code)?.[0] ?? null;
}

/**
 * Rebuilds an order from the transaction that executed it, for an instance
 * that never saw it created. Only orders whose provider can report status
 * without stored state (the mock) come back this way.
 */
export async function reconstructOrder(orderId: Hex, hash: Hash): Promise<StoredOrder | null> {
  const providerId = providerOfOrderId(orderId);
  const provider = providerById(providerId);
  if (!provider || !provider.mock) return null;
  const order: StoredOrder = {
    orderId,
    createdAt: 0,
    owner: "0x0000000000000000000000000000000000000000",
    providerId: provider.id,
    providerRef: "",
    mock: provider.mock,
    route: provider.route,
    fiat: "",
    fiatAmount: 0n,
    usdToReceive: 0n,
    totalFeesUsd: 0n,
    musdToSend: 0n,
    musdBorrowed: 0n,
    surplusMusd: 0n,
    btcToAdd: 0n,
    tokenId: 0n,
    destination: { kind: "bank", institution: "", last4: "" },
    arrival: "",
    signed: null,
    checkoutUrl: null,
    tx: null,
  };
  if (!(await recordTx(order, hash, { useBlockTime: true }))) return null;
  saveOrder(order);
  return order;
}

const types = {
  CashOutOrder: [
    { name: "orderId", type: "bytes32" },
    { name: "tokenId", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "adapter", type: "address" },
    { name: "depositAddress", type: "address" },
    { name: "musdAmount", type: "uint256" },
    { name: "minOut", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
} as const;

export async function signOrder(order: ChainOrder): Promise<Hex> {
  if (!serverEnv.orderSignerKey) throw new Error("ORDER_SIGNER_PRIVATE_KEY is not set");
  if (!cashOut.module) throw new Error("Cash Out isn't deployed on this network");
  return privateKeyToAccount(serverEnv.orderSignerKey).signTypedData({
    domain: { name: "Assumable Cash Out", version: "1", chainId: chain.id, verifyingContract: cashOut.module },
    types,
    primaryType: "CashOutOrder",
    message: order,
  });
}

/** The on-chain order for a quote, with the slippage floor for Route B. */
export function chainOrderFor(q: CashOutQuote, orderId: Hex, owner: Address, depositAddress: Address): ChainOrder {
  const adapter = q.provider.route === "A" ? cashOut.directAdapter : cashOut.swapBridgeAdapter;
  if (!adapter) throw new Error(`the Route ${q.provider.route} adapter isn't deployed on this network`);
  const minOut =
    q.provider.route === "A"
      ? q.musdToSend
      : ((q.usdcOut ?? 0n) * (10_000n - serverEnv.routeBSlippageBps)) / 10_000n;
  return {
    orderId,
    tokenId: q.tokenId,
    owner,
    adapter,
    depositAddress,
    musdAmount: q.musdToSend,
    minOut,
    expiry: BigInt(Math.floor(Date.now() / 1000) + serverEnv.orderTtlMinutes * 60),
  };
}

export function saveOrder(o: StoredOrder) {
  store.set(o.orderId.toLowerCase() as Hex, o);
}

// ---- tracking ----------------------------------------------------------------

const cashOutEvent = parseAbiItem(
  "event CashOut(bytes32 indexed orderId, uint256 indexed tokenId, address indexed owner, address adapter, uint256 musdAmount, uint256 delivered, uint256 ltvBps)",
);

/** Records the transaction that executed an order, after checking it on-chain. */
export async function recordTx(order: StoredOrder, hash: Hash, opts: { useBlockTime?: boolean } = {}): Promise<boolean> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") return false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== cashOut.module?.toLowerCase()) continue;
    try {
      const e = decodeEventLog({ abi: cashOutModuleAbi, eventName: "CashOut", data: log.data, topics: log.topics });
      if (e.args.orderId.toLowerCase() !== order.orderId.toLowerCase()) continue;
      // Normally when this server saw it; rebuilt elsewhere, the block's time
      // (on a real chain the two agree to within seconds).
      const at = opts.useBlockTime
        ? Math.min(Date.now(), Number((await publicClient.getBlock({ blockNumber: receipt.blockNumber })).timestamp) * 1000)
        : Date.now();
      order.owner = e.args.owner;
      order.route = e.args.adapter.toLowerCase() === cashOut.directAdapter?.toLowerCase() ? "A" : "B";
      order.tx = { hash, at, delivered: e.args.delivered, tokenId: e.args.tokenId };
      return true;
    } catch {
      // another of the module's events
    }
  }
  return false;
}

/** If the client never reported the transaction, look for it. */
async function findTx(order: StoredOrder) {
  if (order.tx || !cashOut.module || !order.signed) return;
  const latest = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: cashOut.module,
    event: cashOutEvent,
    args: { orderId: order.orderId },
    fromBlock: latest > 5_000n ? latest - 5_000n : 0n,
  });
  if (logs[0]?.transactionHash) await recordTx(order, logs[0].transactionHash);
}

export type Step = { key: "drawn" | "converted" | "sent" | "paid"; label: string; state: "done" | "active" | "waiting" | "failed"; at: number | null; detail?: string };

export type OrderStatus = {
  state: "awaiting_provider" | "awaiting_signature" | "ready" | "in_progress" | "paid" | "failed" | "expired";
  steps: Step[];
  provider: ProviderStatus | null;
};

/** The timeline the screen shows: loan drawn -> converted -> sent -> paid out. */
export async function orderStatus(order: StoredOrder): Promise<OrderStatus> {
  const provider = providerById(order.providerId);

  // Providers that issue the deposit address after their own checkout.
  if (!order.signed && provider?.resume) {
    const r = await provider.resume(order.providerRef);
    if (r.ready) {
      order.signed = await signPending(order, r.depositAddress);
      order.checkoutUrl = null;
    }
  }
  await findTx(order).catch(() => {});

  const expired = !order.tx && order.signed && Number(order.signed.order.expiry) * 1000 < Date.now();
  const sentAt = order.tx?.at ?? null;
  const ps = provider && order.tx ? await provider.status({ ...order, sentAt }).catch((e: Error) => ({ state: "unknown" as const, reason: e.message })) : null;
  const paid = ps?.state === "paid";
  const failed = ps?.state === "failed";

  const at = order.tx?.at ?? null;
  const steps: Step[] = [
    // The same four plain steps whichever route carries the money: the user
    // never needs to know about pools, bridges or chains.
    { key: "drawn", label: "Borrowed against your Bitcoin", state: at ? "done" : "active", at },
    { key: "converted", label: "Money ready to send", state: at ? "done" : "waiting", at },
    { key: "sent", label: "Sent for payout", state: at ? "done" : "waiting", at },
    {
      key: "paid",
      label: order.mock ? "In your account (simulated)" : "In your account",
      state: paid ? "done" : failed ? "failed" : at ? "active" : "waiting",
      at: paid && ps?.state === "paid" ? ps.at : null,
      detail: failed && ps?.state === "failed" ? ps.reason : undefined,
    },
  ];
  const state: OrderStatus["state"] = paid
    ? "paid"
    : failed
      ? "failed"
      : at
        ? "in_progress"
        : expired
          ? "expired"
          : order.signed
            ? "ready"
            : order.checkoutUrl
              ? "awaiting_provider"
              : "awaiting_signature";
  return { state, steps, provider: ps };
}

async function signPending(order: StoredOrder, depositAddress: Address) {
  const o: ChainOrder = {
    orderId: order.orderId,
    tokenId: order.tokenId,
    owner: order.owner,
    adapter: (order.route === "A" ? cashOut.directAdapter : cashOut.swapBridgeAdapter)!,
    depositAddress,
    musdAmount: order.musdToSend,
    minOut: 0n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + serverEnv.orderTtlMinutes * 60),
  };
  // A fresh pool price for the floor: the checkout may have taken a while.
  if (order.route === "B") {
    o.minOut = ((await quoteSwap(o.musdAmount)) * (10_000n - serverEnv.routeBSlippageBps)) / 10_000n;
  } else {
    o.minOut = o.musdAmount;
  }
  return { order: o, signature: await signOrder(o) };
}

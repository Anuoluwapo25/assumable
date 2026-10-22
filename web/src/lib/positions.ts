"use client";

import { parseAbiItem, type Address } from "viem";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useReadContracts } from "wagmi";
import { interestRateManagerAbi, priceFeedAbi, troveMarketAbi, trovePositionsAbi } from "./abi";
import { deployBlockNumber, marketAddress, musdContracts as m, positionsAddress } from "./config";
import { scanLogs } from "./logs";

export type Pricing = "fixed" | "equity";

export type Position = {
  id: bigint;
  owner: Address;
  account: Address;
  active: boolean;
  coll: bigint;
  debt: bigint;
  icr: bigint;
  /** Basis points, locked when the Trove opened. */
  rate: number;
  equity: bigint;
  listing: {
    seller: Address;
    pricing: Pricing;
    /** MUSD for fixed, basis points of equity for equity pricing. */
    value: bigint;
    minPrice: bigint;
    expiry: bigint;
    /** What it costs right now; 0 if the listing is stale or expired. */
    price: bigint;
  } | null;
};

const REFRESH = 12_000;

/** BTC price and MUSD's current rate for new Troves. */
export function useMarketContext() {
  const q = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: m.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" },
      { address: m.interestRateManager, abi: interestRateManagerAbi, functionName: "interestRate" },
    ],
    query: { refetchInterval: REFRESH },
  });
  return { price: q.data?.[0], currentRate: q.data ? Number(q.data[1]) : undefined };
}

/**
 * Every position ever minted, with its live Trove and listing. Token ids are
 * sequential, so a few multicalls read the whole market without an indexer.
 */
export function usePositions() {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["positions", positionsAddress, marketAddress],
    enabled: !!client && positionsAddress !== null && marketAddress !== null,
    refetchInterval: REFRESH,
    queryFn: async (): Promise<Position[]> => {
      const p = { address: positionsAddress!, abi: trovePositionsAbi } as const;
      const mk = { address: marketAddress!, abi: troveMarketAbi } as const;
      const next = await client!.readContract({ ...p, functionName: "nextId" });
      const ids = Array.from({ length: Number(next) - 1 }, (_, i) => BigInt(i + 1));
      if (ids.length === 0) return [];

      const rows = await client!.multicall({
        allowFailure: false,
        contracts: ids.flatMap((id) => [
          { ...p, functionName: "ownerOf" as const, args: [id] as const },
          { ...p, functionName: "accountOf" as const, args: [id] as const },
          { ...mk, functionName: "quote" as const, args: [id] as const },
          { ...mk, functionName: "listings" as const, args: [id] as const },
        ]),
      });

      return ids.map((id, i) => {
        const owner = rows[4 * i] as Address;
        const account = rows[4 * i + 1] as Address;
        const q = rows[4 * i + 2] as {
          active: boolean;
          coll: bigint;
          debt: bigint;
          icr: bigint;
          interestRate: number;
          equity: bigint;
          price: bigint;
        };
        const [seller, pricing, value, minPrice, expiry] = rows[4 * i + 3] as readonly [
          Address,
          number,
          bigint,
          bigint,
          bigint,
        ];
        const listed = seller !== "0x0000000000000000000000000000000000000000";
        return {
          id,
          owner,
          account,
          active: q.active,
          coll: q.coll,
          debt: q.debt,
          icr: q.icr,
          rate: q.interestRate,
          equity: q.equity,
          listing: listed
            ? { seller, pricing: pricing === 0 ? "fixed" : "equity", value, minPrice, expiry, price: q.price }
            : null,
        };
      });
    },
  });
}

export type Offer = { buyer: Address; amount: bigint; maxDebt: bigint; minColl: bigint; expiry: bigint };

const offerMade = parseAbiItem(
  "event OfferMade(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 maxDebt, uint256 minColl, uint64 expiry)",
);

/** Live offers on one position: everyone who ever offered, re-read from storage. */
export function useOffers(tokenId: bigint) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["offers", marketAddress, tokenId.toString()],
    enabled: !!client && marketAddress !== null,
    refetchInterval: REFRESH,
    queryFn: async (): Promise<Offer[]> => {
      const logs = await scanLogs(client!, `offers:${marketAddress}:${tokenId}`, deployBlockNumber, (r) =>
        client!.getLogs({ address: marketAddress!, event: offerMade, args: { tokenId }, ...r }),
      );
      const buyers = [...new Set(logs.map((l) => l.args.buyer!))];
      if (buyers.length === 0) return [];
      const current = await client!.multicall({
        allowFailure: false,
        contracts: buyers.map((b) => ({
          address: marketAddress!,
          abi: troveMarketAbi,
          functionName: "offers" as const,
          args: [tokenId, b] as const,
        })),
      });
      return buyers
        .map((buyer, i) => {
          const [amount, maxDebt, minColl, expiry] = current[i] as readonly [bigint, bigint, bigint, bigint];
          return { buyer, amount, maxDebt, minColl, expiry };
        })
        .filter((o) => o.amount > 0n && o.expiry * 1000n > BigInt(Date.now()))
        .sort((a, b) => (a.amount > b.amount ? -1 : 1));
    },
  });
}

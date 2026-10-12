"use client";

import { useQuery } from "@tanstack/react-query";
import { parseAbiItem, type Address, type Hash } from "viem";
import { usePublicClient } from "wagmi";
import { deployBlockNumber, marketAddress, positionsAddress } from "./config";

export type Entry =
  | { kind: "sold"; id: bigint; seller: Address; buyer: Address; price: bigint; coll: bigint; debt: bigint; tx: Hash; block: bigint; time?: number }
  | { kind: "listed"; id: bigint; seller: Address; equityShare: boolean; value: bigint; tx: Hash; block: bigint; time?: number }
  | { kind: "offer"; id: bigint; buyer: Address; amount: bigint; tx: Hash; block: bigint; time?: number }
  | { kind: "opened"; id: bigint; owner: Address; tx: Hash; block: bigint; time?: number };

const sold = parseAbiItem(
  "event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 coll, uint256 debt)",
);
const listed = parseAbiItem(
  "event Listed(uint256 indexed tokenId, address indexed seller, uint8 pricing, uint256 value, uint256 minPrice, uint64 expiry)",
);
const offer = parseAbiItem(
  "event OfferMade(uint256 indexed tokenId, address indexed buyer, uint256 amount, uint256 maxDebt, uint256 minColl, uint64 expiry)",
);
const created = parseAbiItem(
  "event PositionCreated(uint256 indexed tokenId, address indexed account, address indexed owner)",
);

/** Every sale, listing, offer and new position, newest first, read from events. */
export function useActivity(limit = 25) {
  const client = usePublicClient();
  return useQuery({
    queryKey: ["activity", marketAddress, positionsAddress, limit],
    enabled: !!client && marketAddress !== null && positionsAddress !== null,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Entry[]> => {
      const from = { fromBlock: deployBlockNumber };
      const [s, l, o, c] = await Promise.all([
        client!.getLogs({ address: marketAddress!, event: sold, ...from }),
        client!.getLogs({ address: marketAddress!, event: listed, ...from }),
        client!.getLogs({ address: marketAddress!, event: offer, ...from }),
        client!.getLogs({ address: positionsAddress!, event: created, ...from }),
      ]);
      const base = (log: { transactionHash: Hash | null; blockNumber: bigint | null }) => ({
        tx: log.transactionHash!,
        block: log.blockNumber!,
      });
      const entries: Entry[] = [
        ...s.map((e) => ({ kind: "sold" as const, id: e.args.tokenId!, seller: e.args.seller!, buyer: e.args.buyer!, price: e.args.price!, coll: e.args.coll!, debt: e.args.debt!, ...base(e) })),
        ...l.map((e) => ({ kind: "listed" as const, id: e.args.tokenId!, seller: e.args.seller!, equityShare: e.args.pricing === 1, value: e.args.value!, ...base(e) })),
        ...o.map((e) => ({ kind: "offer" as const, id: e.args.tokenId!, buyer: e.args.buyer!, amount: e.args.amount!, ...base(e) })),
        ...c.map((e) => ({ kind: "opened" as const, id: e.args.tokenId!, owner: e.args.owner!, ...base(e) })),
      ]
        .sort((a, b) => (a.block > b.block ? -1 : a.block < b.block ? 1 : 0))
        .slice(0, limit);

      // Timestamps for the "3m ago" column, one read per distinct block.
      const blocks = [...new Set(entries.map((e) => e.block))];
      const times = new Map(
        await Promise.all(
          blocks.map(async (b) => [b, Number((await client!.getBlock({ blockNumber: b })).timestamp)] as const),
        ),
      );
      return entries.map((e) => ({ ...e, time: times.get(e.block) }));
    },
  });
}

import { divFloor, mulFloor, parseDecimal } from "./decimal";

/** Display-only estimates for the ticket. Exact decimal math; nothing here is sent to the server. */

export type Level = { price: string; size: string };
export type Fill = { shares: bigint; cost: bigint; avgPrice: bigint | null; complete: boolean };

type Parsed = { price: bigint; size: bigint };

function parseLevels(levels: Level[], bestFirst: "asc" | "desc"): Parsed[] {
  const parsed = levels.flatMap((l) => {
    const price = parseDecimal(l.price);
    const size = parseDecimal(l.size);
    return price === null || size === null ? [] : [{ price, size }];
  });
  const dir = bestFirst === "asc" ? 1 : -1;
  return parsed.sort((a, b) => (a.price < b.price ? -dir : a.price > b.price ? dir : 0));
}

/** Spend `amount` pUSD walking asks from the cheapest. `complete` is false when depth runs out. */
export function estimateBuy(asks: Level[], amount: bigint): Fill {
  let left = amount;
  let shares = 0n;
  for (const { price, size } of parseLevels(asks, "asc")) {
    if (left <= 0n || price <= 0n) break;
    const levelCost = mulFloor(price, size);
    if (levelCost <= left) {
      shares += size;
      left -= levelCost;
    } else {
      shares += divFloor(left, price);
      left = 0n;
    }
  }
  const cost = amount - left;
  return { shares, cost, avgPrice: shares > 0n ? divFloor(cost, shares) : null, complete: left === 0n };
}

/** Sell `shares` walking bids from the highest. `cost` is the proceeds. */
export function estimateSell(bids: Level[], shares: bigint): Fill {
  let left = shares;
  let proceeds = 0n;
  for (const { price, size } of parseLevels(bids, "desc")) {
    if (left <= 0n) break;
    const take = size < left ? size : left;
    proceeds += mulFloor(price, take);
    left -= take;
  }
  const sold = shares - left;
  return { shares: sold, cost: proceeds, avgPrice: sold > 0n ? divFloor(proceeds, sold) : null, complete: left === 0n };
}

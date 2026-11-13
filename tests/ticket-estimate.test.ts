import { describe, expect, it } from "vitest";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import { estimateBuy, estimateSell } from "@/lib/estimate";

const d = (s: string) => parseDecimal(s)!;
const f = (n: bigint | null) => (n === null ? null : formatDecimal(n));

// Deliberately unsorted: the SDK returns asks worst-first and bids worst-first (ascending).
const asks = [
  { price: "0.30", size: "100" },
  { price: "0.10", size: "10" },
  { price: "0.20", size: "20" },
];
const bids = [
  { price: "0.05", size: "100" },
  { price: "0.08", size: "10" },
  { price: "0.07", size: "20" },
];

describe("estimateBuy", () => {
  it("walks asks from the cheapest", () => {
    // 10 sh @0.10 = 1.00, then 20 sh @0.20 = 4.00; $5 buys 30 shares, avg 0.16666666
    const fill = estimateBuy(asks, d("5"));
    expect(f(fill.shares)).toBe("30");
    expect(f(fill.cost)).toBe("5");
    expect(f(fill.avgPrice)).toBe("0.16666666");
    expect(fill.complete).toBe(true);
  });
  it("takes a partial level", () => {
    const fill = estimateBuy(asks, d("2"));
    expect(f(fill.shares)).toBe("15");
    expect(f(fill.avgPrice)).toBe("0.13333333");
  });
  it("reports incomplete when depth runs out", () => {
    const fill = estimateBuy(asks, d("1000"));
    expect(fill.complete).toBe(false);
    expect(f(fill.shares)).toBe("130");
  });
  it("handles an empty book", () => {
    const fill = estimateBuy([], d("5"));
    expect(fill).toMatchObject({ shares: 0n, avgPrice: null, complete: false });
  });
});

describe("estimateSell", () => {
  it("walks bids from the highest", () => {
    // 10 sh @0.08 = 0.80, 20 sh @0.07 = 1.40 -> 30 shares = 2.20
    const fill = estimateSell(bids, d("30"));
    expect(f(fill.cost)).toBe("2.2");
    expect(f(fill.shares)).toBe("30");
    expect(fill.complete).toBe(true);
  });
  it("reports incomplete when bids are too thin", () => {
    const fill = estimateSell(bids, d("500"));
    expect(fill.complete).toBe(false);
    expect(f(fill.shares)).toBe("130");
  });
});
